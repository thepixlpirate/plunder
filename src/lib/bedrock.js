// Bedrock Edition helpers. Bedrock is installed from the Microsoft Store / Xbox app,
// so this launcher opens it, manages its worlds, add-ons and server list.
const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const { execFile } = require('child_process')
const { shell } = require('electron')
const store = require('./store')

// All the places Bedrock keeps its "com.mojang" folder (newer versions moved it).
function roots () {
  const out = []
  const add = p => { if (p && fs.existsSync(p) && !out.includes(p)) out.push(p) }
  add(store.get().settings.bedrockDataPath)
  const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  const users = path.join(appdata, 'Minecraft Bedrock', 'Users')
  if (fs.existsSync(users)) {
    for (const u of fs.readdirSync(users)) add(path.join(users, u, 'games', 'com.mojang'))
  }
  add(path.join(local, 'Packages', 'Microsoft.MinecraftUWP_8wekyb3d8bbwe', 'LocalState', 'games', 'com.mojang'))
  return out
}

let versionCache
function resetVersionCache () { versionCache = undefined }
function installedVersion () {
  if (versionCache !== undefined) return Promise.resolve(versionCache)
  if (process.platform !== 'win32') { versionCache = null; return Promise.resolve(null) }
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-Command', '(Get-AppxPackage -Name Microsoft.MinecraftUWP).Version'], { timeout: 10000, windowsHide: true }, (err, stdout) => {
      const v = !err && String(stdout).trim()
      versionCache = v || null
      resolve(versionCache)
    })
  })
}

function readName (dir) {
  try { return fs.readFileSync(path.join(dir, 'levelname.txt'), 'utf8').trim() } catch { return path.basename(dir) }
}

function worlds () {
  const out = []
  for (const r of roots()) {
    const wdir = path.join(r, 'minecraftWorlds')
    if (!fs.existsSync(wdir)) continue
    for (const folder of fs.readdirSync(wdir)) {
      const dir = path.join(wdir, folder)
      if (!fs.existsSync(path.join(dir, 'level.dat'))) continue
      let icon = null
      for (const n of ['world_icon.jpeg', 'world_icon.jpg', 'world_icon.png']) {
        const f = path.join(dir, n)
        if (fs.existsSync(f)) { icon = require('./worlds').imgData(f); break }
      }
      out.push({ edition: 'bedrock', folder, root: r, dir, name: readName(dir).replace(/§./g, ''), icon, lastPlayed: fs.statSync(path.join(dir, 'level.dat')).mtimeMs })
    }
  }
  return out.sort((a, b) => b.lastPlayed - a.lastPlayed)
}

function findWorld (folder, root) {
  const w = worlds().find(x => x.folder === folder && (!root || x.root === root))
  if (!w) throw new Error('Bedrock world not found')
  return w
}

const NOT_FOUND = "Couldn't find Bedrock's data folder. Open Minecraft Bedrock once, or set the folder in Settings → Bedrock."
// Newer Bedrock keeps packs in a shared folder and worlds in a per-player folder.
function packRoot () {
  const rs = roots()
  const hasPacks = r => ['behavior_packs', 'resource_packs'].some(f => fs.existsSync(path.join(r, f)))
  return rs.find(r => /[\\/]Shared[\\/]/i.test(r) && hasPacks(r)) || rs.find(hasPacks) || rs.find(r => /[\\/]Shared[\\/]/i.test(r)) || rs[0]
}
function worldRoot () {
  const rs = roots()
  const hasWorlds = r => fs.existsSync(path.join(r, 'minecraftWorlds'))
  return rs.find(r => !/[\\/]Shared[\\/]/i.test(r) && hasWorlds(r)) || rs.find(hasWorlds) || rs.find(r => !/[\\/]Shared[\\/]/i.test(r)) || rs[0]
}
function newWorldFolder () {
  const r = worldRoot()
  if (!r) throw new Error(NOT_FOUND)
  let id
  do { id = crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, 'x').slice(0, 12) } while (fs.existsSync(path.join(r, 'minecraftWorlds', id)))
  return path.join(r, 'minecraftWorlds', id)
}

// Add-on manifests often contain comments or trailing commas, which strict JSON rejects.
function looseJson (file) {
  try {
    let t = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    t = t.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n\r]*|\/\*[\s\S]*?\*\//g, (m, str) => str || '')
    t = t.replace(/,\s*([}\]])/g, '$1')
    return JSON.parse(t)
  } catch { return null }
}

// Packs often name themselves "pack.name" and keep the real name in texts/en_US.lang.
function packName (dir, raw, fallback) {
  let name = raw || fallback
  if (/^pack\./i.test(String(name))) {
    try {
      const lang = fs.readFileSync(path.join(dir, 'texts', 'en_US.lang'), 'utf8')
      const m = lang.match(new RegExp('^' + String(raw).replace(/\./g, '\\.') + '=(.*)$', 'm'))
      name = m ? m[1].trim() : fallback
    } catch { name = fallback }
  }
  return String(name).replace(/§./g, '').trim()
}

function readPack (dir, kindHint) {
  let manifest = path.join(dir, 'manifest.json')
  if (!fs.existsSync(manifest)) {
    // Some imports leave the pack one folder deeper.
    const sub = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).map(n => path.join(dir, n)).find(n => fs.existsSync(path.join(n, 'manifest.json')))
    if (!sub) return null
    dir = sub; manifest = path.join(dir, 'manifest.json')
  }
  const m = looseJson(manifest)
  if (!m || !m.header) return null
  const types = (m.modules || []).map(x => String(x.type || '').toLowerCase())
  const kind = types.includes('resources') ? 'resource' : (types.some(t => ['data', 'script', 'javascript', 'client_data'].includes(t)) ? 'behavior' : kindHint)
  const icon = fs.existsSync(path.join(dir, 'pack_icon.png')) ? require('./worlds').imgData(path.join(dir, 'pack_icon.png')) : null
  return {
    uuid: String(m.header.uuid || '').toLowerCase(),
    kind,
    name: packName(dir, m.header.name, path.basename(dir)),
    description: packName(dir, m.header.description, '').slice(0, 200),
    version: Array.isArray(m.header.version) ? m.header.version.join('.') : String(m.header.version || ''),
    deps: (m.dependencies || []).map(d => String(d.uuid || '').toLowerCase()).filter(Boolean),
    icon,
    dir
  }
}

// Everything installed in Minecraft Bedrock: add-ons (behavior + resource packs paired up),
// development packs and packs embedded inside worlds — plus which worlds use each one.
function packs () {
  const found = []
  const worldsUsing = {}
  for (const r of roots()) {
    for (const [folder, kind, dev] of [['behavior_packs', 'behavior', false], ['resource_packs', 'resource', false], ['development_behavior_packs', 'behavior', true], ['development_resource_packs', 'resource', true]]) {
      const d = path.join(r, folder)
      if (!fs.existsSync(d)) continue
      for (const p of fs.readdirSync(d)) {
        const pk = readPack(path.join(d, p), kind)
        if (pk) found.push({ ...pk, dev, world: null })
      }
    }
    const wdir = path.join(r, 'minecraftWorlds')
    if (!fs.existsSync(wdir)) continue
    for (const w of fs.readdirSync(wdir)) {
      const dir = path.join(wdir, w)
      const wname = readName(dir).replace(/§./g, '')
      for (const f of ['world_behavior_packs.json', 'world_resource_packs.json']) {
        const list = looseJson(path.join(dir, f))
        for (const e of Array.isArray(list) ? list : []) {
          const id = String(e.pack_id || '').toLowerCase()
          if (id) (worldsUsing[id] = worldsUsing[id] || new Set()).add(wname)
        }
      }
      for (const [folder, kind] of [['behavior_packs', 'behavior'], ['resource_packs', 'resource']]) {
        const d = path.join(dir, folder)
        if (!fs.existsSync(d)) continue
        for (const p of fs.readdirSync(d)) {
          const pk = readPack(path.join(d, p), kind)
          if (pk) found.push({ ...pk, dev: false, world: wname })
        }
      }
    }
  }
  // Pair behavior packs with the resource pack they depend on, so an add-on shows once.
  const used = new Set()
  const out = []
  const byUuid = {}
  for (const p of found) if (p.uuid && !byUuid[p.uuid]) byUuid[p.uuid] = p
  const seen = new Set()
  for (const p of found.filter(x => x.kind === 'behavior')) {
    const key = p.uuid + '|' + (p.world || '')
    if (seen.has(key)) continue
    seen.add(key)
    const partner = p.deps.map(u => found.find(x => x.uuid === u && x.kind === 'resource' && (x.world || '') === (p.world || ''))).find(Boolean)
    if (partner) used.add(partner)
    const ws = new Set([...(worldsUsing[p.uuid] || []), ...(partner ? worldsUsing[partner.uuid] || [] : [])])
    if (p.world) ws.add(p.world)
    out.push({ name: p.name, description: p.description || (partner && partner.description) || '', version: p.version, icon: p.icon || (partner && partner.icon) || null, parts: partner ? ['Behavior', 'Resource'] : ['Behavior'], dev: p.dev, embedded: p.world, worlds: [...ws], kind: partner ? 'Add-on' : 'Behavior pack' })
  }
  for (const p of found.filter(x => x.kind !== 'behavior' && !used.has(x))) {
    const key = p.uuid + '|' + (p.world || '')
    if (seen.has(key)) continue
    seen.add(key)
    const ws = new Set(worldsUsing[p.uuid] || [])
    if (p.world) ws.add(p.world)
    out.push({ name: p.name, description: p.description, version: p.version, icon: p.icon, parts: ['Resource'], dev: p.dev, embedded: p.world, worlds: [...ws], kind: 'Resource pack' })
  }
  return out.sort((a, b) => (b.worlds.length > 0) - (a.worlds.length > 0) || a.name.localeCompare(b.name))
}

// Servers saved inside the game itself.
function gameServers () {
  const out = []
  for (const r of roots()) {
    const f = path.join(r, 'minecraftpe', 'external_servers.txt')
    if (!fs.existsSync(f)) continue
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const parts = line.split(':')
      if (parts.length >= 4) out.push({ name: parts[1], host: parts[2], port: Number(parts[3]) || 19132, inGame: true })
    }
  }
  return out
}

function play () { return shell.openExternal('minecraft://') }

function joinServer (host, port = 19132) {
  return shell.openExternal(`minecraft://connect/?serverUrl=${encodeURIComponent(host)}&serverPort=${Number(port) || 19132}`)
}

function addServerToGame (name, host, port = 19132) {
  return shell.openExternal(`minecraft://?addExternalServer=${encodeURIComponent(name)}|${encodeURIComponent(host)}:${Number(port) || 19132}`)
}

// Opening a .mcpack/.mcaddon/.mcworld makes Minecraft import it.
// Installs .mcaddon / .mcpack / .mcworld / .mctemplate files straight into Minecraft's folders.
// (Plunder does this itself so it also works when Plunder is the app that opens these files.)
const PACK_EXTS = ['.mcaddon', '.mcpack', '.mcworld', '.mctemplate']
const safeName = s => String(s || 'pack').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'pack'

function unzipTo (file) {
  const AdmZip = require('adm-zip')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plunder-import-'))
  let zip
  try { zip = new AdmZip(file) } catch { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error(`${path.basename(file)} isn't a valid Minecraft file (it couldn't be opened as an archive).`) }
  for (const e of zip.getEntries()) {
    const dest = path.resolve(tmp, e.entryName)
    if (!dest.startsWith(path.resolve(tmp) + path.sep)) continue // ignore unsafe paths
    if (e.isDirectory) { fs.mkdirSync(dest, { recursive: true }); continue }
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, e.getData())
  }
  return tmp
}

function findLevelDir (d, depth = 0) {
  if (fs.existsSync(path.join(d, 'level.dat'))) return d
  if (depth > 2) return null
  for (const c of fs.readdirSync(d)) { const p = path.join(d, c); if (fs.statSync(p).isDirectory()) { const r = findLevelDir(p, depth + 1); if (r) return r } }
  return null
}

function installPackDir (dir, result) {
  const root = packRoot()
  if (!root) throw new Error(NOT_FOUND)
  const pk = readPack(dir, 'behavior')
  if (!pk) return
  const folder = pk.kind === 'resource' ? 'resource_packs' : 'behavior_packs'
  const base = path.join(root, folder)
  fs.mkdirSync(base, { recursive: true })
  // Updating an add-on: replace the old copy that has the same id.
  let dest = null
  for (const f of fs.readdirSync(base)) {
    const ex = readPack(path.join(base, f), pk.kind)
    if (ex && ex.uuid && ex.uuid === pk.uuid) { dest = path.join(base, f); break }
  }
  const updated = !!dest
  if (dest) fs.rmSync(dest, { recursive: true, force: true })
  else {
    dest = path.join(base, safeName(pk.name))
    for (let i = 2; fs.existsSync(dest); i++) dest = path.join(base, `${safeName(pk.name)} ${i}`)
  }
  fs.cpSync(pk.dir, dest, { recursive: true })
  result.packs.push({ name: pk.name, kind: pk.kind === 'resource' ? 'Resource pack' : 'Behavior pack', version: pk.version, updated })
}

function installFromFolder (dir, result, depth = 0) {
  if (fs.existsSync(path.join(dir, 'manifest.json'))) return installPackDir(dir, result)
  if (fs.existsSync(path.join(dir, 'level.dat'))) return installWorldDir(dir, result, path.basename(dir))
  if (depth > 3) return
  for (const c of fs.readdirSync(dir)) {
    const p = path.join(dir, c)
    const st = fs.statSync(p)
    if (st.isDirectory()) installFromFolder(p, result, depth + 1)
    else if (PACK_EXTS.includes(path.extname(c).toLowerCase())) installInto(p, result, depth + 1)
  }
}

function installWorldDir (dir, result, fallback, template) {
  const r = worldRoot()
  if (!r) throw new Error(NOT_FOUND)
  let dest
  if (template) {
    dest = path.join(r, 'world_templates', safeName(fallback))
    for (let i = 2; fs.existsSync(dest); i++) dest = path.join(r, 'world_templates', `${safeName(fallback)} ${i}`)
  } else dest = newWorldFolder()
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.cpSync(dir, dest, { recursive: true })
  const name = readName(dest).replace(/§./g, '') || fallback
  result[template ? 'templates' : 'worlds'].push(name)
}

function installInto (file, result, depth = 0) {
  const ext = path.extname(file).toLowerCase()
  const tmp = unzipTo(file)
  try {
    if (ext === '.mcworld' || ext === '.mctemplate') {
      const lvl = findLevelDir(tmp)
      if (!lvl) throw new Error(`${path.basename(file)} doesn't contain a Minecraft world.`)
      installWorldDir(lvl, result, path.basename(file, ext), ext === '.mctemplate')
    } else {
      installFromFolder(tmp, result, depth)
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}

async function importFile (file) {
  if (!fs.existsSync(file)) throw new Error('File not found: ' + path.basename(file))
  if (!roots().length) throw new Error(NOT_FOUND)
  const result = { packs: [], worlds: [], templates: [] }
  installInto(file, result)
  if (!result.packs.length && !result.worlds.length && !result.templates.length) throw new Error(`${path.basename(file)} doesn't contain any Minecraft packs or worlds.`)
  return result
}

function describeImport (r) {
  const parts = []
  if (r.packs.length) {
    const names = [...new Set(r.packs.map(p => p.name))]
    parts.push(`${names.join(', ')}${r.packs.some(p => p.updated) ? ' (updated)' : ''}`)
  }
  if (r.worlds.length) parts.push(`world “${r.worlds.join('”, “')}”`)
  if (r.templates.length) parts.push(`world template “${r.templates.join('”, “')}”`)
  return parts.join(' + ')
}

module.exports = { resetVersionCache, PACK_EXTS, describeImport, packRoot, worldRoot, roots, installedVersion, worlds, findWorld, newWorldFolder, packs, gameServers, play, joinServer, addServerToGame, importFile }
