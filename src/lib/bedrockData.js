// Separate worlds / add-ons / settings per Bedrock profile.
// Minecraft always reads %APPDATA%\Minecraft Bedrock. For a profile with its own folder, Plunder
// moves the real folder aside (renamed, never deleted) and puts a junction (a folder shortcut) in
// its place that points at the profile's folder. Switching back restores the real folder.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const store = require('./store')

const SHARED_SUFFIX = ' (Plunder shared)'
const appData = () => process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming')
const NAMES = { release: 'Minecraft Bedrock', preview: 'Minecraft Bedrock Preview' }
const live = kind => path.join(appData(), NAMES[kind] || NAMES.release)
const stash = kind => live(kind) + SHARED_SUFFIX
const kindOf = inst => (inst && inst.bedrockVersion && /-preview$/.test(inst.bedrockVersion)) ? 'preview' : 'release'
const profileDir = inst => path.join(store.P.instances, inst.id, 'bedrock-data')

function lstat (p) { try { return fs.lstatSync(p) } catch { return null } }
function isLink (p) { const s = lstat(p); return !!s && s.isSymbolicLink() }
function linkTarget (p) { try { return path.resolve(fs.readlinkSync(p)) } catch { return null } }
// Removes only the shortcut itself — never anything inside it.
function removeLink (p) {
  if (!isLink(p)) return
  try { fs.unlinkSync(p) } catch { fs.rmdirSync(p) }
}
function makeLink (target, p) {
  fs.mkdirSync(target, { recursive: true })
  fs.symlinkSync(target, p, 'junction')
}

function gameRunning () {
  if (process.platform !== 'win32') return false
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Minecraft.Windows.exe', '/NH'], { windowsHide: true }).toString()
    return /Minecraft\.Windows\.exe/i.test(out)
  } catch { return false }
}

// Puts the real (shared) folder back. Safe to call any time.
function restoreShared (kind) {
  const l = live(kind), s = stash(kind)
  if (isLink(l)) removeLink(l)
  if (!lstat(l) && lstat(s)) fs.renameSync(s, l)
}

// Which profile's folder is live right now (null = the normal shared folder).
function activeTarget (kind) {
  const l = live(kind)
  return isLink(l) ? linkTarget(l) : null
}

function activate (inst) {
  if (!inst || inst.edition !== 'bedrock') return { changed: false }
  const kind = kindOf(inst)
  const want = inst.bedrockIsolated ? path.resolve(profileDir(inst)) : null
  const cur = activeTarget(kind)
  if ((cur || null) === (want || null) && (want || !lstat(stash(kind)))) return { changed: false }
  if (gameRunning()) throw new Error('Close Minecraft first — Plunder needs to switch which worlds and add-ons it uses.')
  const l = live(kind), s = stash(kind)
  if (!want) { restoreShared(kind); return { changed: true } }
  if (isLink(l)) removeLink(l)
  else if (lstat(l)) {
    if (lstat(s)) throw new Error(`Both “${path.basename(l)}” and “${path.basename(s)}” exist in AppData. Plunder stopped so nothing gets mixed up — open %APPDATA% and keep the one with your worlds.`)
    fs.renameSync(l, s)
  }
  makeLink(want, l)
  return { changed: true }
}

// Copy the normal Minecraft data (worlds, add-ons, settings) into a profile's own folder.
async function copySharedInto (inst) {
  const kind = kindOf(inst)
  const src = lstat(stash(kind)) ? stash(kind) : (isLink(live(kind)) ? null : live(kind))
  if (!src || !lstat(src)) throw new Error("There's no normal Minecraft folder to copy from yet.")
  const dest = profileDir(inst)
  fs.mkdirSync(dest, { recursive: true })
  await fs.promises.cp(src, dest, { recursive: true, force: false, errorOnExist: false, filter: p => path.basename(p) !== 'session.lock' })
}

function sizeOf (dir) {
  let total = 0
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { try { total += fs.statSync(p).size } catch {} } } }
  try { walk(dir) } catch {}
  return total
}

// On start-up: fix anything left half-done (e.g. a crash, or a profile folder that was deleted).
function repair () {
  for (const kind of ['release', 'preview']) {
    try {
      const l = live(kind)
      if (isLink(l) && !lstat(linkTarget(l) || '')) restoreShared(kind)
      if (!lstat(l) && lstat(stash(kind))) fs.renameSync(stash(kind), l)
    } catch (e) { console.error('bedrock data repair', e.message) }
  }
}

// When Plunder closes, put the normal folder back so Minecraft opened outside Plunder works as usual.
function restoreAllOnQuit () {
  if (gameRunning()) return
  for (const kind of ['release', 'preview']) { try { restoreShared(kind) } catch {} }
}

function status (inst) {
  const kind = kindOf(inst)
  const dir = profileDir(inst)
  return { kind, isolated: !!inst.bedrockIsolated, dir, size: inst.bedrockIsolated ? sizeOf(dir) : null, active: (activeTarget(kind) || null) === (inst.bedrockIsolated ? path.resolve(dir) : null) }
}

module.exports = { activate, restoreShared, restoreAllOnQuit, repair, copySharedInto, status, profileDir, kindOf, gameRunning }
