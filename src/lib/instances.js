// Java and Bedrock instances: create, edit, delete, launch, and manage their files.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { Client } = require('minecraft-launcher-core')
// The game library only knows "1.x" version numbers. Since 2026 Minecraft is numbered 26.x,
// so teach it that those (and NeoForge) always use the modern Forge setup.
;(() => {
  const Handler = require('minecraft-launcher-core/components/handler')
  const original = Handler.prototype.isModernForge
  Handler.prototype.isModernForge = function (json) {
    const base = String((json && json.inheritsFrom) || '')
    if (base && !base.startsWith('1.')) return true
    return original.call(this, json)
  }
})()
const store = require('./store')
const versions = require('./versions')
const { ensureJava } = require('./java')
const auth = require('./auth')
const events = require('./events')

const running = new Map() // instanceId -> child process

const dirOf = id => path.join(store.P.instances, id)
const gameDir = inst => path.join(dirOf(inst.id), inst.edition === 'bedrock' ? 'addons' : 'minecraft')
const metaFile = id => path.join(dirOf(id), 'instance.json')

function safeId (id) {
  if (!/^[a-zA-Z0-9-]+$/.test(String(id))) throw new Error('Bad instance id')
  return id
}

function list () {
  const out = []
  const ids = fs.existsSync(store.P.instances) ? fs.readdirSync(store.P.instances) : []
  for (const id of ids) {
    const m = store.readJson(metaFile(id))
    if (m) out.push({ ...m, running: running.has(m.id) })
  }
  return out.sort((a, b) => (b.lastPlayed || b.created || 0) - (a.lastPlayed || a.created || 0))
}

function get (id) {
  const m = store.readJson(metaFile(safeId(id)))
  if (!m) throw new Error('Instance not found')
  return m
}

function save (inst) {
  store.writeJson(metaFile(inst.id), inst)
  events.send('instances-changed')
  return inst
}

async function create (opts) {
  const id = crypto.randomUUID()
  const edition = opts.edition === 'bedrock' ? 'bedrock' : 'java'
  const inst = {
    id,
    edition,
    name: (opts.name || '').trim() || (edition === 'java' ? `Minecraft ${opts.mc}` : 'Bedrock Profile'),
    created: Date.now(),
    lastPlayed: null,
    playTime: 0,
    icon: opts.icon || null,
    seed: Math.floor(Math.random() * 1e9)
  }
  if (edition === 'java') {
    if (!opts.mc) throw new Error('Pick a Minecraft version')
    Object.assign(inst, {
      mc: opts.mc,
      loader: ['fabric', 'quilt', 'forge', 'neoforge'].includes(opts.loader) ? opts.loader : 'vanilla',
      loaderVersion: opts.loaderVersion || null,
      customId: null,
      memoryMax: Number(opts.memoryMax) || null,
      jvmArgs: '',
      server: '',
      content: {},
      modpack: opts.modpack || null
    })
    if (inst.loader !== 'vanilla') {
      const r = await versions.installLoader(inst.loader, inst.mc, inst.loaderVersion)
      inst.customId = r.id
      inst.loaderVersion = r.loaderVersion
    }
  } else {
    Object.assign(inst, { addons: [], servers: [], bedrockVersion: opts.bedrockVersion || null, bedrockIsolated: !!opts.bedrockIsolated })
  }
  fs.mkdirSync(gameDir(inst), { recursive: true })
  save(inst)
  return inst
}

function update (id, patch) {
  const inst = get(id)
  const allowed = ['name', 'memoryMax', 'jvmArgs', 'server', 'icon', 'notes', 'bedrockVersion', 'bedrockIsolated', 'width', 'height', 'fullscreen']
  for (const k of allowed) if (k in patch) inst[k] = patch[k]
  return save(inst)
}

function remove (id) {
  if (running.has(id)) throw new Error('Close the game before deleting this instance.')
  try {
    const inst = get(id)
    if (inst.edition === 'bedrock' && inst.bedrockIsolated) {
      const bd = require('./bedrockData')
      if (bd.status(inst).active) { if (bd.gameRunning()) throw new Error('Close Minecraft before deleting this profile.'); bd.restoreShared(bd.kindOf(inst)) }
    }
  } catch (e) { if (/Close Minecraft/.test(e.message)) throw e }
  fs.rmSync(dirOf(safeId(id)), { recursive: true, force: true })
  const data = store.get()
  data.history = data.history.filter(h => h.instanceId !== id)
  store.save()
  events.send('instances-changed')
}

// ---------- Content (mods, resource packs, shaders) ----------
const FOLDERS = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' }

function listContent (id) {
  const inst = get(id)
  const out = []
  for (const [type, folder] of Object.entries(FOLDERS)) {
    const dir = path.join(gameDir(inst), folder)
    if (!fs.existsSync(dir)) continue
    for (const file of fs.readdirSync(dir)) {
      const full = path.join(dir, file)
      let st
      try { st = fs.statSync(full) } catch { continue }
      if (st.isDirectory() && type === 'mod') continue
      const enabled = !file.endsWith('.disabled')
      const baseName = enabled ? file : file.slice(0, -'.disabled'.length)
      // Only real content: mods are .jar, packs are .zip or folders. Skips settings files other
      // mods leave next to them (Respack Opts .rpo, shader .txt settings, .json, hidden files…).
      if (file.startsWith('.')) continue
      if (!st.isDirectory() && !(type === 'mod' ? /\.jar$/i : /\.zip$/i).test(baseName)) continue
      const key = `${folder}/${baseName}`
      const meta = (inst.content || {})[key] || {}
      out.push({ type, file, key, enabled, size: st.size, title: meta.title || baseName.replace(/\.(jar|zip)$/i, '').replace(/§[0-9a-fk-or]/gi, '').trim() || baseName, icon: meta.icon || null, source: meta.source || 'file', projectId: meta.projectId || null, version: meta.versionName || null, url: meta.projectId ? (meta.source === 'modrinth' ? `https://modrinth.com/project/${meta.projectId}` : meta.source === 'curseforge' ? (meta.url || `https://www.curseforge.com/projects/${meta.projectId}`) : null) : null })
    }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title))
}

function contentPath (inst, key, enabled) {
  const [folder, ...rest] = key.split('/')
  if (!Object.values(FOLDERS).includes(folder)) throw new Error('Bad content path')
  const name = path.basename(rest.join('/'))
  return path.join(gameDir(inst), folder, enabled ? name : name + '.disabled')
}

function toggleContent (id, key) {
  const inst = get(id)
  const on = contentPath(inst, key, true)
  const off = contentPath(inst, key, false)
  if (fs.existsSync(on)) fs.renameSync(on, off)
  else if (fs.existsSync(off)) fs.renameSync(off, on)
  return listContent(id)
}

function deleteContent (id, key) {
  const inst = get(id)
  for (const p of [contentPath(inst, key, true), contentPath(inst, key, false)]) fs.rmSync(p, { recursive: true, force: true })
  // Remove settings files other mods keep beside it (Respack Opts .rpo, shader .txt).
  const on = contentPath(inst, key, true)
  for (const ext of ['.rpo', '.txt']) fs.rmSync(on + ext, { force: true })
  if (inst.content) { delete inst.content[key]; save(inst) }
  return listContent(id)
}

// Copy files the user picked/dropped into the right folder (by file type).
function addFiles (id, files) {
  const inst = get(id)
  let added = 0
  for (const f of files) {
    const ext = path.extname(f).toLowerCase()
    if (inst.edition === 'bedrock') {
      if (!['.mcpack', '.mcaddon', '.mcworld', '.mctemplate', '.zip'].includes(ext)) continue
      const dest = path.join(gameDir(inst), path.basename(f))
      fs.copyFileSync(f, dest)
      inst.addons = (inst.addons || []).filter(a => a.file !== path.basename(f))
      inst.addons.push({ file: path.basename(f), title: path.basename(f, ext), source: 'file', added: Date.now() })
      added++
      continue
    }
    let folder = null
    if (ext === '.jar') folder = 'mods'
    else if (ext === '.zip') folder = /shader/i.test(path.basename(f)) ? 'shaderpacks' : 'resourcepacks'
    if (!folder) continue
    fs.mkdirSync(path.join(gameDir(inst), folder), { recursive: true })
    fs.copyFileSync(f, path.join(gameDir(inst), folder, path.basename(f)))
    added++
  }
  save(inst)
  return added
}

function recordContent (id, key, meta) {
  const inst = get(id)
  inst.content = inst.content || {}
  inst.content[key] = meta
  save(inst)
}

// ---------- Launching Java ----------
async function launch (id, opts = {}) {
  const inst = get(id)
  if (inst.edition !== 'java') throw new Error('Not a Java instance')
  if (running.has(id)) throw new Error('This instance is already running.')
  const settings = store.get().settings
  const t = events.task(`Starting ${inst.name}`, { instanceId: id })
  try {
    t.update(null, 'Backing up changed worlds…')
    try { await require('./worlds').autoBackup({ edition: 'java', instanceId: id }) } catch (e) { console.error('auto backup', e) }
    t.update(null, 'Signing in…')
    let askedCode = false
    const authorization = await auth.getLaunchAuth(code => { askedCode = true; events.send('auth-code', code) })
    if (askedCode) events.send('auth-done')

    t.update(null, 'Checking Minecraft version…')
    const vj = await versions.versionJson(inst.mc)
    const component = (vj.javaVersion && vj.javaVersion.component) || 'jre-legacy'
    t.update(0, `Getting Java ${vj.javaVersion ? vj.javaVersion.majorVersion : 8}…`)
    const javaPath = await ensureJava(component, (d, n) => t.update(d / n, `Downloading Java (${d}/${n} files)`))

    let forgeJar = null
    if (inst.loader === 'forge' || inst.loader === 'neoforge') {
      if (!inst.loaderVersion) { const r = await versions.installLoader(inst.loader, inst.mc, null); inst.loaderVersion = r.loaderVersion; save(inst) }
      t.update(0, `Getting ${inst.loader === 'forge' ? 'Forge' : 'NeoForge'} ${inst.loaderVersion}…`)
      forgeJar = await versions.forgeInstaller(inst.loader, inst.mc, inst.loaderVersion, p => t.update(p))
      // The game library caches one Forge setup per Minecraft version; clear it when switching loader versions.
      const cacheDir = path.join(store.P.shared, 'forge', inst.mc)
      const marker = path.join(cacheDir, 'plunder-loader.txt')
      const want = `${inst.loader}-${inst.loaderVersion}`
      if (!fs.existsSync(marker) || fs.readFileSync(marker, 'utf8') !== want) {
        fs.rmSync(path.join(cacheDir, 'version.json'), { force: true })
        fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(marker, want)
      }
    } else if (inst.loader !== 'vanilla') {
      const vf = path.join(store.P.shared, 'versions', inst.customId || '_', `${inst.customId}.json`)
      if (!inst.customId || !fs.existsSync(vf)) {
        t.update(null, 'Installing mod loader…')
        const r = await versions.installLoader(inst.loader, inst.mc, inst.loaderVersion)
        inst.customId = r.id
        save(inst)
      }
    }

    const max = Number(inst.memoryMax || settings.memoryMax) || 4096
    const min = Math.min(Number(settings.memoryMin) || 1024, max)
    const jvm = `${settings.jvmArgs || ''} ${inst.jvmArgs || ''}`.trim().split(/\s+/).filter(Boolean)
    const gd = gameDir(inst)
    const launchOpts = {
      root: store.P.shared,
      authorization,
      javaPath,
      version: { number: inst.mc, type: vj.type || 'release', ...(inst.customId && !forgeJar ? { custom: inst.customId } : {}) },
      ...(forgeJar ? { forge: forgeJar } : {}),
      memory: { max: `${max}M`, min: `${min}M` },
      customArgs: jvm,
      ...(inst.fullscreen || inst.width ? { window: { ...(inst.width ? { width: String(inst.width), height: String(inst.height || Math.round(inst.width * 9 / 16)) } : {}), ...(inst.fullscreen ? { fullscreen: true } : {}) } } : {}),
      overrides: { gameDirectory: gd, cwd: gd, detached: false, maxSockets: 16 }
    }
    if (opts.world) launchOpts.quickPlay = { type: 'singleplayer', identifier: opts.world }
    else if (opts.server || inst.server) launchOpts.quickPlay = { type: 'multiplayer', identifier: opts.server || inst.server }

    const client = new Client()
    let lastErr = ''
    const LABELS = { assets: 'Downloading game assets', natives: 'Preparing natives', classes: 'Downloading libraries', 'classes-custom': 'Downloading mod loader libraries', 'classes-maven-custom': 'Downloading mod loader libraries' }
    client.on('progress', p => t.update(p.total ? p.task / p.total : null, `${LABELS[p.type] || 'Downloading ' + p.type} (${p.task}/${p.total})`))
    client.on('debug', d => {
      const s = String(d)
      if (/error|failed|couldn't/i.test(s)) lastErr = s
      events.send('log', { instanceId: id, line: s })
    })
    let recent = ''
    client.on('data', d => { const l = String(d); recent = (recent + l).slice(-120000); events.send('log', { instanceId: id, line: l }) })

    t.update(null, 'Downloading game files…')
    const started = Date.now()
    const child = await client.launch(launchOpts)
    if (!child) throw new Error(lastErr.replace('[MCLC]: ', '') || 'Minecraft failed to start. Check the log tab for details.')

    running.set(id, child)
    inst.lastPlayed = Date.now()
    save(inst)
    store.addHistory({ instanceId: id, edition: 'java', world: opts.world || null })
    t.done('Game launched')
    events.send('game', { instanceId: id, running: true, name: inst.name })

    client.on('close', code => {
      running.delete(id)
      try {
        const i2 = get(id)
        i2.playTime = (i2.playTime || 0) + (Date.now() - started)
        save(i2)
        store.addSession({ instanceId: id, edition: 'java', start: started, ms: Date.now() - started })
      } catch {}
      events.send('game', { instanceId: id, running: false, code, name: inst.name })
      // A non-zero exit or a fresh crash report means it crashed — explain why.
      const reportDir = path.join(gameDir(inst), 'crash-reports')
      const newReport = fs.existsSync(reportDir) && fs.readdirSync(reportDir).some(f => { try { return fs.statSync(path.join(reportDir, f)).mtimeMs >= started } catch { return false } })
      if ((code && code !== 0) || newReport) {
        let analysis = null
        try { analysis = require('./crash').analyze(id, started, recent) } catch (e) { console.error('crash analyze', e) }
        events.send('crash', { instanceId: id, name: inst.name, code, analysis })
      }
    })
    return { ok: true }
  } catch (e) {
    t.fail(e)
    throw e
  }
}

function kill (id) {
  const c = running.get(id)
  if (c) c.kill()
}

function anyRunning () { return [...running.keys()] }

module.exports = { list, get, save, create, update, remove, dirOf, gameDir, listContent, toggleContent, deleteContent, addFiles, recordContent, launch, kill, anyRunning, FOLDERS }
