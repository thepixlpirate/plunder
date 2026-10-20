// Decides where Plunder keeps its data. Must run before anything else touches the disk.
//  • Portable (the single Plunder.exe): everything goes in ONE folder next to the exe, "Plunder Data".
//  • Installed/unzipped copy: same, if a "Plunder Data" folder or "portable.txt" sits next to the exe.
//  • Otherwise (developer runs): the normal AppData folder.
const { app } = require('electron')
const fs = require('fs')
const path = require('path')

const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath)
const portable = !!process.env.PORTABLE_EXECUTABLE_DIR || (app.isPackaged && (fs.existsSync(path.join(exeDir, 'Plunder Data')) || fs.existsSync(path.join(exeDir, 'portable.txt'))))
const base = portable ? path.join(exeDir, 'Plunder Data') : app.getPath('userData')
const chromium = path.join(base, '.browser')

fs.mkdirSync(base, { recursive: true })
// Chromium's own caches/cookies go in one hidden sub-folder instead of cluttering things up.
app.setPath('userData', chromium)
app.setPath('sessionData', chromium)
try { app.setAppLogsPath(path.join(chromium, 'logs')) } catch {}
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
app.commandLine.appendSwitch('disk-cache-size', String(20 * 1024 * 1024))
if (process.platform === 'win32') {
  try { require('child_process').execFile('attrib', ['+h', chromium], { windowsHide: true }, () => {}) } catch {}
}

// Bring data over from older locations the first time (AppData copy, or the old "Amethyst" name).
function migrate () {
  if (fs.existsSync(path.join(base, 'launcher.json'))) return null
  const appData = app.getPath('appData')
  const candidates = ['plunder', 'Plunder', 'amethyst-launcher', 'Amethyst Launcher'].map(n => path.join(appData, n)).filter(d => path.resolve(d) !== path.resolve(base))
  const old = candidates.find(d => fs.existsSync(path.join(d, 'launcher.json')))
  if (!old) return null
  for (const name of ['launcher.json', 'instances', 'shared', 'runtimes', 'backups', 'auth', 'cache']) {
    const from = path.join(old, name), to = path.join(base, name)
    if (!fs.existsSync(from) || fs.existsSync(to)) continue
    try { fs.renameSync(from, to) } catch {
      // Different drive (e.g. a USB stick): copy instead, then remove the old copy.
      fs.cpSync(from, to, { recursive: true })
      try { fs.rmSync(from, { recursive: true, force: true }) } catch {}
    }
  }
  try { fs.writeFileSync(path.join(old, 'MOVED TO PLUNDER.txt'), 'Your Plunder data moved to: ' + base) } catch {}
  return old
}
let migratedFrom = null
try { migratedFrom = migrate() } catch (e) { console.error('migration failed', e) }

module.exports = { base, portable, exeDir, chromium, migratedFrom, exePath: () => process.env.PORTABLE_EXECUTABLE_FILE || process.execPath }
