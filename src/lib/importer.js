// Import worlds, mods, packs and settings from other launchers (Modrinth App, AstralRinth,
// Prism/MultiMC, CurseForge, GDLauncher, the official launcher) or from any folder.
// Files are always COPIED — the other launcher keeps its own.
const fs = require('fs')
const path = require('path')
const os = require('os')
const AdmZip = require('adm-zip')
const extract = require('extract-zip')
const store = require('./store')
const instances = require('./instances')
const events = require('./events')
const { getJson, sha1File } = require('./net')

const exists = p => { try { fs.accessSync(p); return true } catch { return false } }
const isDir = p => { try { return fs.statSync(p).isDirectory() } catch { return false } }
const ls = p => { try { return fs.readdirSync(p) } catch { return [] } }
const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
const LOADERS = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']
const normLoader = l => { l = String(l || '').toLowerCase(); return LOADERS.includes(l) ? l : (l.includes('neoforge') ? 'neoforge' : l.includes('forge') ? 'forge' : l.includes('quilt') ? 'quilt' : l.includes('fabric') ? 'fabric' : 'vanilla') }

function dirs () {
  const home = os.homedir()
  return {
    home,
    appdata: process.env.APPDATA || (process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : path.join(home, '.config')),
    local: process.env.LOCALAPPDATA || (process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : path.join(home, '.local', 'share'))
  }
}

// What's inside a game folder.
function summarize (gameDir) {
  const worlds = ls(path.join(gameDir, 'saves')).filter(w => exists(path.join(gameDir, 'saves', w, 'level.dat')))
  const mods = ls(path.join(gameDir, 'mods')).filter(f => /\.jar(\.disabled)?$/i.test(f))
  const rp = ls(path.join(gameDir, 'resourcepacks')).filter(f => !f.startsWith('.') && (/\.zip$/i.test(f) || isDir(path.join(gameDir, 'resourcepacks', f))))
  const sp = ls(path.join(gameDir, 'shaderpacks')).filter(f => !f.startsWith('.') && (/\.zip$/i.test(f) || isDir(path.join(gameDir, 'shaderpacks', f))))
  return {
    worlds,
    counts: { worlds: worlds.length, mods: mods.length, resourcepacks: rp.length, shaderpacks: sp.length },
    hasOptions: exists(path.join(gameDir, 'options.txt')),
    hasServers: exists(path.join(gameDir, 'servers.dat')),
    hasScreenshots: ls(path.join(gameDir, 'screenshots')).length > 0
  }
}
const hasContent = s => s.counts.worlds || s.counts.mods || s.counts.resourcepacks || s.counts.shaderpacks || s.hasOptions

// ---------- Guessing version/loader from the mod files ----------
function guessFromMods (gameDir) {
  const loaders = {}
  const versions = {}
  const jars = ls(path.join(gameDir, 'mods')).filter(f => /\.jar$/i.test(f)).slice(0, 40)
  for (const j of jars) {
    try {
      const z = new AdmZip(path.join(gameDir, 'mods', j))
      const has = n => !!z.getEntry(n)
      let l = null
      if (has('quilt.mod.json')) l = 'quilt'
      else if (has('fabric.mod.json')) l = 'fabric'
      else if (has('META-INF/neoforge.mods.toml')) l = 'neoforge'
      else if (has('META-INF/mods.toml')) l = 'forge'
      if (l) loaders[l] = (loaders[l] || 0) + 1
      if (has('fabric.mod.json')) {
        const m = JSON.parse(z.readAsText('fabric.mod.json'))
        const dep = m.depends && m.depends.minecraft
        for (const d of [].concat(dep || [])) {
          const v = String(d).match(/^[~=]?\s*(1\.\d+(?:\.\d+)?)$/)
          if (v) versions[v[1]] = (versions[v[1]] || 0) + 1
        }
      }
    } catch {}
  }
  const top = o => Object.entries(o).sort((a, b) => b[1] - a[1])[0]
  return { loader: top(loaders) ? top(loaders)[0] : null, mc: top(versions) ? top(versions)[0] : null }
}

function entry (launcher, name, gameDir, meta = {}) {
  if (!isDir(gameDir)) return null
  const s = summarize(gameDir)
  if (!hasContent(s)) return null
  let { mc, loader, loaderVersion } = meta
  if (!mc || !loader) {
    const g = guessFromMods(gameDir)
    mc = mc || g.mc
    loader = loader || g.loader || (s.counts.mods ? null : 'vanilla')
  }
  return { launcher, name: name || path.basename(gameDir), dir: gameDir, mc: mc || null, loader: loader ? normLoader(loader) : null, loaderVersion: loaderVersion || null, guessed: !meta.mc, ...s }
}

// ---------- Modrinth App / AstralRinth / other Modrinth-based launchers ----------
let SQL = null
async function sqlite () {
  if (SQL) return SQL
  const init = require('sql.js')
  SQL = await init({ locateFile: f => path.join(path.dirname(require.resolve('sql.js')), f) })
  return SQL
}
function launcherLabel (folder) {
  if (/astral/i.test(folder)) return 'AstralRinth'
  if (/modrinth|theseus/i.test(folder)) return 'Modrinth App'
  return folder.replace(/[._-]+/g, ' ').replace(/\bapp\b/i, 'App')
}
async function modrinthFamily (root, folder) {
  const out = []
  const profiles = path.join(root, 'profiles')
  const meta = {}
  const db = path.join(root, 'app.db')
  if (exists(db)) {
    try {
      const S = await sqlite()
      const d = new S.Database(fs.readFileSync(db))
      const r = d.exec('SELECT * FROM profiles')
      if (r[0]) {
        const cols = r[0].columns
        for (const row of r[0].values) {
          const o = Object.fromEntries(cols.map((c, i) => [c, row[i]]))
          meta[o.path] = { name: o.name, mc: o.game_version, loader: o.mod_loader, loaderVersion: o.mod_loader_version }
        }
      }
      d.close()
    } catch (e) { console.error('modrinth db', e.message) }
  }
  for (const p of ls(profiles)) {
    const dir = path.join(profiles, p)
    let m = meta[p]
    if (!m) {
      const pj = readJson(path.join(dir, 'profile.json')) // older Modrinth (Theseus) versions
      if (pj && pj.metadata) m = { name: pj.metadata.name, mc: pj.metadata.game_version, loader: pj.metadata.loader, loaderVersion: pj.metadata.loader_version && pj.metadata.loader_version.id }
    }
    const e = entry(launcherLabel(folder), (m && m.name) || p, dir, m || {})
    if (e) out.push(e)
  }
  return out
}

// ---------- Prism / PolyMC / MultiMC ----------
function prismFamily (root, label) {
  const out = []
  for (const i of ls(path.join(root, 'instances'))) {
    const dir = path.join(root, 'instances', i)
    const cfg = path.join(dir, 'instance.cfg')
    if (!exists(cfg)) continue
    const nameLine = fs.readFileSync(cfg, 'utf8').split(/\r?\n/).find(l => l.startsWith('name='))
    const pack = readJson(path.join(dir, 'mmc-pack.json'))
    const meta = {}
    for (const c of (pack && pack.components) || []) {
      if (c.uid === 'net.minecraft') meta.mc = c.version
      if (c.uid === 'net.fabricmc.fabric-loader') { meta.loader = 'fabric'; meta.loaderVersion = c.version }
      if (c.uid === 'org.quiltmc.quilt-loader') { meta.loader = 'quilt'; meta.loaderVersion = c.version }
      if (c.uid === 'net.minecraftforge') meta.loader = 'forge'
      if (c.uid === 'net.neoforged') meta.loader = 'neoforge'
    }
    if (meta.mc && !meta.loader) meta.loader = 'vanilla'
    const gd = exists(path.join(dir, '.minecraft')) ? path.join(dir, '.minecraft') : path.join(dir, 'minecraft')
    const e = entry(label, nameLine ? nameLine.slice(5) : i, gd, meta)
    if (e) out.push(e)
  }
  return out
}

// ---------- Find everything ----------
async function detect () {
  const { home, appdata, local } = dirs()
  const out = []
  const seenRoots = new Set()
  const scanRoot = async (base) => {
    for (const folder of ls(base)) {
      const root = path.join(base, folder)
      if (seenRoots.has(root) || !isDir(root)) continue
      try {
        if (isDir(path.join(root, 'profiles')) && (exists(path.join(root, 'app.db')) || /rinth|theseus|modrinth/i.test(folder))) {
          seenRoots.add(root); out.push(...await modrinthFamily(root, folder))
        } else if (/^(PrismLauncher|PolyMC|MultiMC|ElyPrismLauncher|PollyMC|FjordLauncher)$/i.test(folder) && isDir(path.join(root, 'instances'))) {
          seenRoots.add(root); out.push(...prismFamily(root, folder.replace(/Launcher$/i, ' Launcher').trim()))
        } else if (/^gdlauncher_next$/i.test(folder)) {
          seenRoots.add(root)
          for (const i of ls(path.join(root, 'instances'))) {
            const c = readJson(path.join(root, 'instances', i, 'config.json')) || {}
            const l = c.loader || {}
            const e = entry('GDLauncher', i, path.join(root, 'instances', i), { mc: l.mcVersion, loader: l.loaderType, loaderVersion: l.loaderVersion })
            if (e) out.push(e)
          }
        }
      } catch (e) { console.error('import scan', root, e.message) }
    }
  }
  await scanRoot(appdata)
  if (local !== appdata) await scanRoot(local)

  // CurseForge app
  const cfDirs = [path.join(home, 'curseforge', 'minecraft', 'Instances'), path.join(home, 'Documents', 'Curse', 'Minecraft', 'Instances')]
  for (const cfDir of cfDirs) {
    for (const i of ls(cfDir)) {
      const dir = path.join(cfDir, i)
      const mi = readJson(path.join(dir, 'minecraftinstance.json')) || {}
      const bl = (mi.baseModLoader && mi.baseModLoader.name) || ''
      const parts = bl.split('-')
      const e = entry('CurseForge', mi.name || i, dir, { mc: mi.gameVersion, loader: bl ? parts[0] : (mi.gameVersion ? 'vanilla' : null), loaderVersion: parts[1] })
      if (e) out.push(e)
    }
  }

  // Official Minecraft Launcher
  const mc = path.join(appdata, process.platform === 'darwin' ? 'minecraft' : '.minecraft')
  if (isDir(mc)) {
    const lp = readJson(path.join(mc, 'launcher_profiles.json'))
    const profs = lp && lp.profiles ? Object.values(lp.profiles) : []
    const parseVer = v => {
      const m = String(v || '').match(/^fabric-loader-([\d.]+)-(.+)$/) || String(v || '').match(/^quilt-loader-([\d.]+)-(.+)$/)
      if (m) return { mc: m[2], loader: v.startsWith('quilt') ? 'quilt' : 'fabric', loaderVersion: m[1] }
      if (/^\d+\.\d+(\.\d+)?$/.test(v)) return { mc: v, loader: 'vanilla' }
      return {}
    }
    const main = profs.filter(p => !p.gameDir).sort((a, b) => String(b.lastUsed || '').localeCompare(String(a.lastUsed || '')))[0]
    const e = entry('Minecraft Launcher', '.minecraft (main folder)', mc, main ? parseVer(main.lastVersionId) : {})
    if (e) out.push(e)
    for (const p of profs.filter(p => p.gameDir && path.resolve(p.gameDir) !== path.resolve(mc))) {
      const e2 = entry('Minecraft Launcher', p.name || path.basename(p.gameDir), p.gameDir, parseVer(p.lastVersionId))
      if (e2) out.push(e2)
    }
  }
  return out
}

// A folder the person picked by hand: find the real game folder inside and read what we can.
function inspect (dir) {
  const candidates = [dir, path.join(dir, '.minecraft'), path.join(dir, 'minecraft')]
  const gameDir = candidates.find(c => isDir(c) && hasContent(summarize(c)))
  if (!gameDir) throw new Error("That folder doesn't contain any Minecraft worlds, mods or packs. Pick the instance folder (the one with 'saves' or 'mods' inside).")
  // Try known metadata files next to it.
  const parent = gameDir === dir ? dir : path.dirname(gameDir)
  const pack = readJson(path.join(parent, 'mmc-pack.json'))
  if (pack) {
    const p = prismFamily(path.dirname(path.dirname(parent)), 'Prism Launcher').find(x => x.dir === gameDir)
    if (p) return { ...p, launcher: 'Folder' }
  }
  const mi = readJson(path.join(parent, 'minecraftinstance.json'))
  if (mi) {
    const bl = (mi.baseModLoader && mi.baseModLoader.name) || ''
    return entry('Folder', mi.name, gameDir, { mc: mi.gameVersion, loader: bl ? bl.split('-')[0] : 'vanilla', loaderVersion: bl.split('-')[1] })
  }
  const pj = readJson(path.join(parent, 'profile.json'))
  if (pj && pj.metadata) return entry('Folder', pj.metadata.name, gameDir, { mc: pj.metadata.game_version, loader: pj.metadata.loader })
  return entry('Folder', path.basename(parent), gameDir, {})
}

// ---------- Copying ----------
function freeName (dir, name) {
  if (!exists(path.join(dir, name))) return name
  for (let i = 2; ; i++) { const n = `${name} (imported${i > 2 ? ' ' + (i - 1) : ''})`; if (!exists(path.join(dir, n))) return n }
}
const copyDir = (src, dest) => fs.promises.cp(src, dest, { recursive: true, force: false, errorOnExist: false, filter: s => path.basename(s) !== 'session.lock' })

async function importInstance ({ dir, target = {}, what = {} }) {
  if (!dir || !isDir(dir)) throw new Error('Source folder not found')
  const src = summarize(dir)
  let inst
  if (target.instanceId) inst = instances.get(target.instanceId)
  else {
    const c = target.create || {}
    inst = await instances.create({ edition: 'java', name: c.name, mc: c.mc, loader: c.loader, loaderVersion: c.loaderVersion })
  }
  const gd = instances.gameDir(inst)
  const t = events.task(`Importing into ${inst.name}`, { instanceId: inst.id })
  const done = { worlds: 0, mods: 0, resourcepacks: 0, shaderpacks: 0, other: [] }
  try {
    const worlds = what.worlds === true ? src.worlds : (Array.isArray(what.worlds) ? what.worlds.filter(w => src.worlds.includes(w)) : [])
    const steps = worlds.length + ['mods', 'resourcepacks', 'shaderpacks', 'options', 'servers', 'screenshots'].filter(k => what[k]).length
    let step = 0
    const tick = label => t.update(steps ? ++step / steps : null, label)

    fs.mkdirSync(path.join(gd, 'saves'), { recursive: true })
    for (const w of worlds) {
      tick(`Copying world “${w}”…`)
      await copyDir(path.join(dir, 'saves', w), path.join(gd, 'saves', freeName(path.join(gd, 'saves'), w)))
      done.worlds++
    }
    for (const k of ['mods', 'resourcepacks', 'shaderpacks']) {
      if (!what[k] || !isDir(path.join(dir, k))) continue
      tick(`Copying ${k === 'mods' ? 'mods' : k === 'resourcepacks' ? 'resource packs' : 'shader packs'}…`)
      fs.mkdirSync(path.join(gd, k), { recursive: true })
      for (const f of ls(path.join(dir, k))) {
        if (f.startsWith('.') || (k === 'mods' && !/\.jar(\.disabled)?$/i.test(f))) continue
        if (exists(path.join(gd, k, f))) continue
        await copyDir(path.join(dir, k, f), path.join(gd, k, f))
        done[k]++
      }
    }
    if (what.options) {
      tick('Copying settings & keybinds…')
      for (const f of ['options.txt', 'optionsof.txt', 'optionsshaders.txt']) {
        if (!exists(path.join(dir, f))) continue
        if (exists(path.join(gd, f))) fs.copyFileSync(path.join(gd, f), path.join(gd, f + '.before-import'))
        fs.copyFileSync(path.join(dir, f), path.join(gd, f))
      }
      if (isDir(path.join(dir, 'config')) && what.mods) await copyDir(path.join(dir, 'config'), path.join(gd, 'config'))
      done.other.push('settings')
    }
    if (what.servers && exists(path.join(dir, 'servers.dat'))) {
      tick('Copying server list…')
      if (exists(path.join(gd, 'servers.dat'))) fs.copyFileSync(path.join(gd, 'servers.dat'), path.join(gd, 'servers.dat.before-import'))
      fs.copyFileSync(path.join(dir, 'servers.dat'), path.join(gd, 'servers.dat'))
      done.other.push('servers')
    }
    if (what.screenshots && isDir(path.join(dir, 'screenshots'))) {
      tick('Copying screenshots…')
      await copyDir(path.join(dir, 'screenshots'), path.join(gd, 'screenshots'))
      done.other.push('screenshots')
    }
    t.update(null, 'Looking up mod names…')
    if (done.mods) await identifyMods(inst.id).catch(() => {})
    t.done('Import finished')
    events.send('instances-changed')
    return { instance: instances.get(inst.id), done }
  } catch (e) { t.fail(e); throw e }
}

// Match imported mod files against Modrinth so they show proper names and icons.
async function identifyMods (instanceId) {
  const inst = instances.get(instanceId)
  const gd = instances.gameDir(inst)
  const files = {}
  for (const k of ['mods', 'resourcepacks', 'shaderpacks']) {
    for (const f of ls(path.join(gd, k))) {
      const key = `${k}/${f.replace(/\.disabled$/, '')}`
      if ((inst.content || {})[key]) continue
      const full = path.join(gd, k, f)
      if (!fs.statSync(full).isFile()) continue
      try { files[await sha1File(full)] = key } catch {}
    }
  }
  const hashes = Object.keys(files)
  if (!hashes.length) return 0
  const versions = await getJson('https://api.modrinth.com/v2/version_files', { method: 'POST', body: { hashes, algorithm: 'sha1' } })
  const ids = [...new Set(Object.values(versions).map(v => v.project_id))]
  const projects = ids.length ? await getJson(`https://api.modrinth.com/v2/projects?ids=${encodeURIComponent(JSON.stringify(ids))}`) : []
  const byId = Object.fromEntries(projects.map(p => [p.id, p]))
  let n = 0
  for (const [hash, v] of Object.entries(versions)) {
    const p = byId[v.project_id]
    if (!p || !files[hash]) continue
    instances.recordContent(instanceId, files[hash], { source: 'modrinth', projectId: p.id, versionId: v.id, versionName: v.version_number, title: p.title, icon: p.icon_url })
    n++
  }
  return n
}

// Import one world from a folder or a .zip into a Java instance.
async function importWorld (instanceId, src) {
  const inst = instances.get(instanceId)
  const saves = path.join(instances.gameDir(inst), 'saves')
  fs.mkdirSync(saves, { recursive: true })
  const findLevel = (d, depth = 0) => {
    if (exists(path.join(d, 'level.dat'))) return d
    if (depth > 2) return null
    for (const c of ls(d)) { const p = path.join(d, c); if (isDir(p)) { const r = findLevel(p, depth + 1); if (r) return r } }
    return null
  }
  let worldDir, tmp = null
  if (isDir(src)) worldDir = findLevel(src)
  else if (/\.zip$/i.test(src)) {
    tmp = path.join(store.P.cache, 'world-import-' + Date.now())
    await extract(src, { dir: path.resolve(tmp) })
    worldDir = findLevel(tmp)
  }
  if (!worldDir) { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); throw new Error("Couldn't find a Minecraft world there (no level.dat). Pick the world folder or a world .zip.") }
  const base = worldDir === tmp ? path.basename(src, path.extname(src)) : path.basename(worldDir)
  const name = freeName(saves, base)
  await copyDir(worldDir, path.join(saves, name))
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
  return { name }
}

module.exports = { detect, inspect, importInstance, importWorld, identifyMods, summarize }
