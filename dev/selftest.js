// Runs inside Electron: exercises the real backend (no internet needed) then screenshots the real window.
const { app } = require('electron')
const path = require('path'), fs = require('fs'), os = require('os')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'amy-'))
app.setPath('userData', tmp)
app.whenReady().then(async () => {
  const log = (...a) => console.log('[test]', ...a)
  try {
    const instances = require('../src/lib/instances')
    const worlds = require('../src/lib/worlds')
    const inst = await instances.create({ edition: 'java', name: 'Test Vanilla', mc: '1.21.1', loader: 'vanilla' })
    const bed = await instances.create({ edition: 'bedrock', name: 'Bed' })
    log('created', instances.list().length, 'instances')
    const jar = path.join(tmp, 'coolmod.jar'); fs.writeFileSync(jar, 'x')
    const zip = path.join(tmp, 'pack.zip'); fs.writeFileSync(zip, 'x')
    const mcp = path.join(tmp, 'thing.mcpack'); fs.writeFileSync(mcp, 'x')
    log('added', instances.addFiles(inst.id, [jar, zip, mcp]), 'java files;', instances.addFiles(bed.id, [mcp, jar]), 'bedrock files')
    let c = instances.listContent(inst.id); log('content', c.map(x => x.key + ':' + x.enabled).join(', '))
    c = instances.toggleContent(inst.id, 'mods/coolmod.jar'); log('after toggle', c.map(x => x.file + ':' + x.enabled).join(', '))
    c = instances.toggleContent(inst.id, 'mods/coolmod.jar'); log('after re-toggle', c.find(x => x.type === 'mod').enabled)
    c = instances.deleteContent(inst.id, 'resourcepacks/pack.zip'); log('after delete', c.length)
    // fake world
    const wdir = path.join(instances.gameDir(inst), 'saves', 'My World')
    fs.mkdirSync(path.join(wdir, 'region'), { recursive: true })
    fs.writeFileSync(path.join(wdir, 'level.dat'), 'lvl'); fs.writeFileSync(path.join(wdir, 'region', 'r.0.0.mca'), Buffer.alloc(50000, 7)); fs.writeFileSync(path.join(wdir, 'session.lock'), 'lock')
    log('worlds', worlds.javaWorlds().map(w => w.name))
    const b = await worlds.backup({ edition: 'java', instanceId: inst.id, folder: 'My World' })
    log('backup file', path.basename(b.file), fs.statSync(b.file).size, 'bytes')
    const list = worlds.listBackups('java', inst.id, 'My World'); log('backups', list.length)
    const r = await worlds.restore(list[0]); log('restored to', path.basename(r.dir), fs.existsSync(path.join(r.dir, 'region', 'r.0.0.mca')))
    log('worlds now', worlds.javaWorlds(inst.id).map(w => w.name))
    try { await worlds.restore({ ...list[0], file: '../../launcher.json' }) } catch (e) { log('traversal blocked:', e.message) }
    instances.update(inst.id, { name: 'Renamed', memoryMax: 6144, evil: 1 }); log('updated', instances.get(inst.id).name, instances.get(inst.id).evil)
    // Launch without account should fail with friendly message
    try { await instances.launch(inst.id) } catch (e) { log('launch w/o account:', e.message) }
    log('bedrock roots (linux):', require('../src/lib/bedrock').roots())
    try { await require('../src/lib/content').search({ source: 'curseforge' }) } catch (e) { log('cf no key:', e.code) }
    instances.remove(bed.id); log('after remove', instances.list().length)
  } catch (e) { console.log('[test] FAIL', e.stack) }
  // Boot the real UI and screenshot it
  require('../src/main.js')
  const { BrowserWindow: BW } = require('electron')
  const w0 = BW.getAllWindows()[0]
  w0.webContents.on('console-message', (_e, level, msg, line, src) => console.log('[test] console', level, msg, src + ':' + line))
  w0.webContents.on('preload-error', (_e, p, err) => console.log('[test] preload-error', err.message))
  setTimeout(async () => {
    const { BrowserWindow } = require('electron')
    const w = BrowserWindow.getAllWindows()[0]
    const seq = ["go('java-instances')", "go('java-mods')", "go('java-modpacks')", "go('java-worlds')", "go('instance',{id:S.instances.find(i=>i.edition==='java').id})", "go('instance',{id:S.instances.find(i=>i.edition==='java').id,tab:'worlds'})", "go('instance',{id:S.instances.find(i=>i.edition==='java').id,tab:'settings'})", "go('instance',{id:S.instances.find(i=>i.edition==='java').id,tab:'log'})", "go('bedrock-home')", "go('bedrock-addons')", "S.params.tab='profile';renderMain()", "S.params.tab='game';renderMain()", "go('bedrock-worlds')", "go('bedrock-servers')", "go('instance',{id:S.instances.find(i=>i.edition==='bedrock').id})", "go('java-servers')", "go('bedrock-servers')", "ACTIONS['toggle-left']()", "ACTIONS['toggle-right']()", "go('instance',{id:S.instances.find(i=>i.edition==='java').id,tab:'settings'})", "go('settings')", "newInstanceModal('java')", "document.querySelector('[data-close]').click();newInstanceModal('bedrock')", "document.querySelector('[data-close]').click();go('java-home')", "ACTIONS['toggle-left']()", "ACTIONS['toggle-right']()", "go('bedrock-addons')", "S.params.source='modbay';renderMain()", "go('java-instances');importModal()", "document.querySelector('[data-x]').click();go('java-worlds')", "go('bedrock-worlds')", "go('bedrock-instances')", "go('skins')", "quickSettings(S.instances.find(i=>i.edition==='java').id)", "document.querySelector('[data-close]').click()", "exportModal(S.instances.find(i=>i.edition==='java').id)", "document.querySelector('[data-close]').click()", "go('instance',{id:S.instances.find(i=>i.edition==='java').id,tab:'log'})", "newInstanceModal('bedrock')", "document.querySelector('[data-close]').click()", "go('instance',{id:S.instances.find(i=>i.edition==='bedrock').id,tab:'settings'})", "newInstanceModal('bedrock')", "document.querySelector('[data-close]').click();go('instance',{id:S.instances.find(i=>i.edition==='bedrock').id,tab:'settings'})"]
    for (const js of seq) { await w.webContents.executeJavaScript(js); await new Promise(r => setTimeout(r, 500)) }
    const img = await w.webContents.capturePage()
    fs.writeFileSync(process.argv[process.argv.length - 1], img.toPNG())
    const errs = await w.webContents.executeJavaScript(`JSON.stringify({S: typeof S, page: S.page, cls: document.getElementById('app').className, mem: S.state.totalMemMB, results: (document.getElementById('results')||{}).innerText?.slice(0,160)})`)
    console.log('[test] UI text:', errs.replace(/\s+/g, ' '))
    app.exit(0)
  }, 6000)
})
