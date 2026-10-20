// Makes Plunder the app that opens Minecraft add-on files (.mcaddon, .mcpack, .mcworld, .mctemplate).
// Windows only lets the person themselves pick the default app, so Plunder:
//  1) registers itself as an option for these file types (current user only, no admin needed), then
//  2) shows Windows' "How do you want to open this file?" box so you can pick Plunder → Always.
const { execFile, spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const store = require('./store')
const { exePath } = require('./paths')

const PROGID = 'Plunder.MinecraftFile'
const EXTS = ['.mcaddon', '.mcpack', '.mcworld', '.mctemplate', '.mrpack']
const C = 'HKCU\\Software\\Classes'
const TEST_NAME = 'Plunder - pick me.mcaddon'

function reg (args) {
  return new Promise((resolve, reject) => {
    execFile('reg.exe', args, { windowsHide: true }, (err, stdout) => err ? reject(err) : resolve(String(stdout)))
  })
}
const quiet = p => p.catch(() => null)

function needWindows () { if (process.platform !== 'win32') throw new Error('This only works on Windows.') }

async function register () {
  needWindows()
  const exe = exePath()
  const app = path.basename(exe)
  const cmd = `"${exe}" "%1"`
  await reg(['add', `${C}\\${PROGID}`, '/ve', '/d', 'Minecraft add-on (Plunder)', '/f'])
  await reg(['add', `${C}\\${PROGID}`, '/v', 'FriendlyTypeName', '/d', 'Minecraft add-on', '/f'])
  await reg(['add', `${C}\\${PROGID}\\DefaultIcon`, '/ve', '/d', `"${exe}",0`, '/f'])
  await reg(['add', `${C}\\${PROGID}\\shell\\open\\command`, '/ve', '/d', cmd, '/f'])
  await reg(['add', `${C}\\Applications\\${app}`, '/v', 'FriendlyAppName', '/d', 'Plunder', '/f'])
  await reg(['add', `${C}\\Applications\\${app}\\shell\\open\\command`, '/ve', '/d', cmd, '/f'])
  for (const ext of EXTS) {
    await reg(['add', `${C}\\${ext}\\OpenWithProgids`, '/v', PROGID, '/t', 'REG_NONE', '/f'])
    await reg(['add', `${C}\\Applications\\${app}\\SupportedTypes`, '/v', ext, '/d', '', '/f'])
  }
  store.get().assoc = { exe, app, at: Date.now() }
  store.save()
  return { exe }
}

// Opens Windows' "open with" chooser on a tiny sample file so the person can pick Plunder → Always.
function chooseDefault () {
  needWindows()
  const f = path.join(os.tmpdir(), TEST_NAME)
  fs.writeFileSync(f, '')
  spawn('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', f], { detached: true, stdio: 'ignore', windowsHide: false }).unref()
}

async function status () {
  if (process.platform !== 'win32') return { supported: false }
  const out = {}
  for (const ext of EXTS) {
    const r = await quiet(reg(['query', `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${ext}\\UserChoice`, '/v', 'ProgId']))
    const m = r && r.match(/ProgId\s+REG_SZ\s+(.+)/i)
    const progId = m ? m[1].trim() : ''
    out[ext] = progId === PROGID || /plunder/i.test(progId)
  }
  return { supported: true, registered: !!store.get().assoc, defaults: out, allDefault: Object.values(out).every(Boolean) }
}

async function unregister () {
  needWindows()
  const a = store.get().assoc || { app: path.basename(exePath()) }
  await quiet(reg(['delete', `${C}\\${PROGID}`, '/f']))
  await quiet(reg(['delete', `${C}\\Applications\\${a.app}`, '/f']))
  for (const ext of EXTS) await quiet(reg(['delete', `${C}\\${ext}\\OpenWithProgids`, '/v', PROGID, '/f']))
  delete store.get().assoc
  store.save()
}

// If the portable exe was moved or renamed, quietly point Windows at the new location.
async function refreshIfMoved () {
  const a = store.get().assoc
  if (process.platform !== 'win32' || !a || a.exe === exePath()) return
  if (a.app && a.app !== path.basename(exePath())) await quiet(reg(['delete', `${C}\\Applications\\${a.app}`, '/f']))
  await quiet(register())
}

const isTestFile = f => path.basename(f) === TEST_NAME

module.exports = { register, chooseDefault, status, unregister, refreshIfMoved, isTestFile, EXTS }
