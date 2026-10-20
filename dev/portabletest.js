// Simulates the portable exe: data must land in "<exe dir>/Plunder Data". Then opens a .mcaddon via argv.
const path = require('path'), fs = require('fs'), os = require('os')
const T = process.env.PT_DIR
process.env.PORTABLE_EXECUTABLE_DIR = path.join(T, 'usb')
fs.mkdirSync(process.env.PORTABLE_EXECUTABLE_DIR, { recursive: true })
const log = (...a) => console.log('[test]', ...a)
const { app } = require('electron')
const tree = (d, pre = '') => fs.readdirSync(d).sort().map(n => { const p = path.join(d, n); return pre + n + (fs.statSync(p).isDirectory() ? '/' : '') }).join('  ')
app.whenReady().then(() => {
  const store = require('../src/lib/store')
  store.get().settings.bedrockDataPath = path.join(T, 'com.mojang'); store.save()
})
require('../src/main.js')
setTimeout(async () => {
  try {
    log('usb folder:', tree(path.join(T, 'usb')))
    log('Plunder Data:', tree(path.join(T, 'usb', 'Plunder Data')))
    log('BP installed:', tree(path.join(T, 'com.mojang', 'behavior_packs')))
    log('RP installed:', tree(path.join(T, 'com.mojang', 'resource_packs')))
    log('worlds:', tree(path.join(T, 'com.mojang', 'minecraftWorlds')))
    const insts = require('../src/lib/instances').list().filter(i => i.edition === 'bedrock')
    log('saved in profile:', JSON.stringify(insts.map(i => (i.addons || []).map(a => a.file + ' → ' + a.title))))
    const { BrowserWindow } = require('electron')
    const w = BrowserWindow.getAllWindows().find(x => x.getTitle() === 'Plunder')
    log('toasts:', await w.webContents.executeJavaScript("[...document.querySelectorAll('.toast')].map(t=>t.innerText.replace(/\\s+/g,' ')).join(' || ')"))
    log('assoc status (linux):', JSON.stringify(await require('../src/lib/assoc').status()))
    // Update the same add-on again: should replace, not duplicate
    const bedrock = require('../src/lib/bedrock')
    const r = await bedrock.importFile(process.argv[process.argv.length - 2])
    log('reinstall:', bedrock.describeImport(r), '| BP now:', tree(path.join(T, 'com.mojang', 'behavior_packs')))
    try { await bedrock.importFile(path.join(T, 'junk.mcpack')) } catch (e) { log('junk file:', e.message) }
  } catch (e) { log('FAIL', e.stack) }
  app.exit(0)
}, 7000)
