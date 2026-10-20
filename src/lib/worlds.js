// Worlds for Java instances and Bedrock, plus backing them up and restoring them.
const fs = require('fs')
const path = require('path')
const archiver = require('archiver')
const extract = require('extract-zip')
const store = require('./store')
const instances = require('./instances')
const bedrock = require('./bedrock')
const events = require('./events')

function imgData (file) {
  try {
    const st = fs.statSync(file)
    if (st.size > 2_000_000) return null
    const ext = path.extname(file).slice(1).toLowerCase().replace('jpg', 'jpeg')
    return `data:image/${ext};base64,` + fs.readFileSync(file).toString('base64')
  } catch { return null }
}

function stamp () {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}
const clean = s => String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 60) || 'world'

function folderSize (dir) {
  let total = 0
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else { try { total += fs.statSync(p).size } catch {} }
    }
  }
  try { walk(dir) } catch {}
  return total
}

// Reads how long you've played a Java world from its statistics files.
function worldPlaySeconds (dir) {
  let ticks = 0
  try {
    const sd = path.join(dir, 'stats')
    for (const f of fs.readdirSync(sd)) {
      const j = JSON.parse(fs.readFileSync(path.join(sd, f), 'utf8'))
      const c = (j.stats && j.stats['minecraft:custom']) || {}
      ticks = Math.max(ticks, c['minecraft:play_time'] || c['minecraft:play_one_minute'] || 0)
    }
  } catch {}
  return Math.round(ticks / 20)
}

// ---------- Java ----------
function javaWorlds (instanceId) {
  const list = instanceId ? [instances.get(instanceId)] : instances.list().filter(i => i.edition === 'java')
  const out = []
  for (const inst of list) {
    const saves = path.join(instances.gameDir(inst), 'saves')
    if (!fs.existsSync(saves)) continue
    for (const folder of fs.readdirSync(saves)) {
      const dir = path.join(saves, folder)
      const level = path.join(dir, 'level.dat')
      if (!fs.existsSync(level)) continue
      out.push({
        edition: 'java',
        instanceId: inst.id,
        instanceName: inst.name,
        mc: inst.mc,
        loader: inst.loader,
        folder,
        name: folder,
        icon: imgData(path.join(dir, 'icon.png')),
        lastPlayed: fs.statSync(level).mtimeMs,
        backups: listBackups('java', inst.id, folder).length,
        playSeconds: worldPlaySeconds(dir)
      })
    }
  }
  return out.sort((a, b) => b.lastPlayed - a.lastPlayed)
}

function backupDir (edition, owner) {
  const d = path.join(store.P.backups, edition, clean(owner))
  fs.mkdirSync(d, { recursive: true })
  return d
}

function zipFolder (src, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest + '.part')
    const zip = archiver('zip', { zlib: { level: 6 } })
    out.on('close', () => { fs.renameSync(dest + '.part', dest); resolve(dest) })
    zip.on('error', reject)
    zip.on('warning', e => { if (e.code !== 'ENOENT') reject(e) })
    zip.on('progress', p => onProgress && p.entries.total && onProgress(p.entries.processed / p.entries.total))
    zip.pipe(out)
    // Skip session.lock: Java holds it open while the game runs.
    zip.glob('**/*', { cwd: src, dot: true, ignore: ['session.lock'] })
    zip.finalize()
  })
}

async function backup ({ edition, instanceId, folder, root, auto }) {
  let src, dest, label
  if (edition === 'java') {
    const inst = instances.get(instanceId)
    src = path.join(instances.gameDir(inst), 'saves', path.basename(folder))
    dest = path.join(backupDir('java', inst.id), `${clean(folder)}__${stamp()}${auto ? '__auto' : ''}.zip`)
    label = folder
  } else {
    const w = bedrock.findWorld(folder, root)
    src = w.dir
    dest = path.join(backupDir('bedrock', folder), `${clean(w.name)}__${stamp()}${auto ? '__auto' : ''}.mcworld`)
    label = w.name
  }
  if (!fs.existsSync(src)) throw new Error('World folder not found')
  const t = events.task(`${auto ? 'Auto-backup: ' : 'Backing up '}${label}`)
  try {
    await zipFolder(src, dest, p => t.update(p, 'Compressing…'))
    t.done('Backup saved')
    return { file: dest }
  } catch (e) { t.fail(e); throw e }
}

function listBackups (edition, owner, folder) {
  const out = []
  const eds = edition ? [edition] : ['java', 'bedrock']
  for (const ed of eds) {
    const base = path.join(store.P.backups, ed)
    if (!fs.existsSync(base)) continue
    const owners = owner ? [clean(owner)] : fs.readdirSync(base)
    for (const o of owners) {
      const dir = path.join(base, o)
      if (!fs.existsSync(dir)) continue
      for (const f of fs.readdirSync(dir)) {
        if (!/\.(zip|mcworld)$/i.test(f)) continue
        const [world] = f.replace(/\.(zip|mcworld)$/i, '').split('__')
        if (folder && world !== clean(folder) && ed === 'java') continue
        const st = fs.statSync(path.join(dir, f))
        out.push({ edition: ed, owner: o, world, file: f, size: st.size, created: st.mtimeMs })
      }
    }
  }
  return out.sort((a, b) => b.created - a.created)
}

function backupPath (b) {
  const p = path.join(store.P.backups, b.edition === 'bedrock' ? 'bedrock' : 'java', clean(b.owner), path.basename(b.file))
  if (!fs.existsSync(p)) throw new Error('Backup file not found')
  return p
}

// Restores as a NEW world next to the existing one, so nothing is ever overwritten.
async function restore (b) {
  const file = backupPath(b)
  const t = events.task(`Restoring ${b.world}`)
  try {
    let target
    if (b.edition === 'java') {
      const inst = instances.get(b.owner)
      const saves = path.join(instances.gameDir(inst), 'saves')
      let name = b.world
      if (fs.existsSync(path.join(saves, name))) name = `${b.world} (restored ${stamp().slice(0, 16)})`
      target = path.join(saves, name)
    } else {
      target = bedrock.newWorldFolder()
    }
    fs.mkdirSync(target, { recursive: true })
    await extract(file, { dir: path.resolve(target) })
    if (b.edition === 'bedrock') {
      const ln = path.join(target, 'levelname.txt')
      try { fs.writeFileSync(ln, fs.readFileSync(ln, 'utf8').trim() + ' (restored)') } catch {}
    }
    t.done('World restored')
    return { dir: target }
  } catch (e) { t.fail(e); throw e }
}

function deleteBackup (b) { fs.rmSync(backupPath(b), { force: true }) }

function deleteJavaWorld (instanceId, folder) {
  const inst = instances.get(instanceId)
  fs.rmSync(path.join(instances.gameDir(inst), 'saves', path.basename(folder)), { recursive: true, force: true })
}

// ---------- Automatic backups ----------
// Backs up worlds that changed since their last backup, then keeps only the newest few automatic ones.
async function autoBackup ({ edition, instanceId }) {
  const st = store.get().settings
  const mode = st.autoBackup || 'daily'
  if (mode === 'off') return { made: 0 }
  const keep = Math.max(1, Number(st.autoBackupKeep) || 5)
  const DAY = 24 * 3600 * 1000
  let list
  if (edition === 'java') {
    const inst = instances.get(instanceId)
    const saves = path.join(instances.gameDir(inst), 'saves')
    list = (fs.existsSync(saves) ? fs.readdirSync(saves) : []).filter(f => fs.existsSync(path.join(saves, f, 'level.dat')))
      .map(f => ({ folder: f, owner: inst.id, name: f, changed: fs.statSync(path.join(saves, f, 'level.dat')).mtimeMs }))
  } else {
    list = bedrock.worlds().map(w => ({ folder: w.folder, root: w.root, owner: w.folder, name: w.name, changed: w.lastPlayed }))
  }
  let made = 0
  for (const w of list) {
    const all = listBackups(edition, w.owner, edition === 'java' ? w.folder : null).filter(b => edition === 'java' || b.world === clean(w.name))
    const newest = all[0] ? all[0].created : 0
    const autos = all.filter(b => /__auto\.(zip|mcworld)$/i.test(b.file))
    if (w.changed <= newest) continue // nothing new since the last backup
    if (mode === 'daily' && autos[0] && Date.now() - autos[0].created < DAY) continue
    try {
      await backup({ edition, instanceId, folder: w.folder, root: w.root, auto: true })
      made++
    } catch (e) { console.error('auto backup', w.name, e.message) }
    const fresh = listBackups(edition, w.owner, edition === 'java' ? w.folder : null).filter(b => /__auto\.(zip|mcworld)$/i.test(b.file) && (edition === 'java' || b.world === clean(w.name)))
    for (const old of fresh.slice(keep)) { try { deleteBackup(old) } catch {} }
  }
  return { made }
}

module.exports = { autoBackup,  javaWorlds, backup, listBackups, restore, deleteBackup, backupPath, deleteJavaWorld, imgData, folderSize }
