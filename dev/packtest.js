const { app } = require('electron')
const path = require('path'), fs = require('fs'), os = require('os')
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-'))
app.setPath('userData', path.join(T, 'plunder'))
const log = (...a) => console.log('[test]', ...a)
const mk = (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c) }
app.whenReady().then(async () => {
  const cm = path.join(T, 'com.mojang')
  mk(path.join(cm, 'behavior_packs', 'farmBP', 'manifest.json'), `{
    // Hershel style farming add-on
    "format_version": 2,
    "header": { "name": "pack.name", "description": "pack.description", "uuid": "AAAA-1", "version": [1, 2, 0], },
    "modules": [ { "type": "data", "uuid": "m1", "version": [1,0,0] }, ],
    /* depends on the RP */
    "dependencies": [ { "uuid": "bbbb-2", "version": [1, 2, 0] } ]
  }`)
  mk(path.join(cm, 'behavior_packs', 'farmBP', 'texts', 'en_US.lang'), 'pack.name=Hershel\'s Homestead\npack.description=Farming with tractors')
  mk(path.join(cm, 'resource_packs', 'farmRP', 'manifest.json'), '﻿{"header":{"name":"Homestead Resources","uuid":"BBBB-2","version":[1,2,0]},"modules":[{"type":"resources"}]}')
  mk(path.join(cm, 'resource_packs', 'Faithful', 'Faithful 32x', 'manifest.json'), '{"header":{"name":"§6Faithful 32x","uuid":"cccc-3","version":[1,0,0]},"modules":[{"type":"resources"}]}')
  mk(path.join(cm, 'development_behavior_packs', 'testbp', 'manifest.json'), '{"header":{"name":"My Dev Pack","uuid":"dddd-4","version":[0,1,0]},"modules":[{"type":"script"}]}')
  const w = path.join(cm, 'minecraftWorlds', 'abc=')
  mk(path.join(w, 'level.dat'), 'x'); mk(path.join(w, 'levelname.txt'), 'Farm World')
  mk(path.join(w, 'world_behavior_packs.json'), '[{"pack_id":"aaaa-1","version":[1,2,0]}]')
  mk(path.join(w, 'world_resource_packs.json'), '[{"pack_id":"bbbb-2","version":[1,2,0]},{"pack_id":"eeee-5","version":[1,0,0]}]')
  mk(path.join(w, 'resource_packs', 'mapRP', 'manifest.json'), '{"header":{"name":"Map Textures","uuid":"eeee-5","version":[1,0,0]},"modules":[{"type":"resources"}]}')
  const store = require('../src/lib/store')
  store.get().settings.bedrockDataPath = cm; store.save()
  try {
    const packs = require('../src/lib/bedrock').packs()
    for (const p of packs) log(JSON.stringify({ name: p.name, kind: p.kind, parts: p.parts, worlds: p.worlds, dev: p.dev, embedded: p.embedded, v: p.version, desc: p.description }))
  } catch (e) { log('FAIL', e.stack) }
  require('../src/main.js')
  setTimeout(async () => {
    const { BrowserWindow } = require('electron')
    const win = BrowserWindow.getAllWindows()[0]
    await win.webContents.executeJavaScript("go('instance',{id:S.instances.find(i=>i.edition==='bedrock').id})")
    await new Promise(r => setTimeout(r, 1500))
    fs.writeFileSync(process.argv[process.argv.length - 1], (await win.webContents.capturePage()).toPNG())
    await win.webContents.executeJavaScript("go('bedrock-addons',{tab:'installed'})")
    await new Promise(r => setTimeout(r, 1200))
    log('addons page text', (await win.webContents.executeJavaScript("document.getElementById('tab-body').innerText.replace(/\\s+/g,' ').slice(0,260)")))
    app.exit(0)
  }, 4000)
})
