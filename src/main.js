// Plunder — main process. Creates the window and answers requests from the UI.
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const paths = require('./lib/paths') // must come first: decides where data lives

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0) }
app.setAppUserModelId('com.plunder.launcher')

const store = require('./lib/store')
const events = require('./lib/events')
const auth = require('./lib/auth')
const versions = require('./lib/versions')
const instances = require('./lib/instances')
const content = require('./lib/content')
const worlds = require('./lib/worlds')
const bedrock = require('./lib/bedrock')
const servers = require('./lib/servers')
const websrc = require('./lib/websrc')
const importer = require('./lib/importer')
const assoc = require('./lib/assoc')
const bversions = require('./lib/bedrockVersions')
const bdata = require('./lib/bedrockData')
const updates = require('./lib/updates')
const packexport = require('./lib/packexport')
const modinfo = require('./lib/modinfo')
const crash = require('./lib/crash')
const updater = require('./lib/updater')
const skins = require('./lib/skins')

let win
function createWindow () {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    backgroundColor: '#0d0b14',
    title: 'Plunder',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  events.setWindow(win)
  try { servers.migrateProfileServers(instances) } catch (e) { console.error(e) }
  websrc.hookDownloads()
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  win.once('ready-to-show', () => win.show())
  win.webContents.on('did-finish-load', () => {
    if (uiReady) return
    // Give the page a moment to set up its listeners, then handle any file Plunder was opened with.
    setTimeout(() => { uiReady = true; if (pendingFiles.length) openAddonFiles(pendingFiles.splice(0)) }, 1200)
  })
  assoc.refreshIfMoved().catch(() => {})
  setTimeout(() => updater.checkQuietly(), 8000)
  // Closing the main window closes everything (including the hidden Planet Minecraft reader).
  win.on('closed', () => { win = null; app.quit() })
  win.on('maximize', () => events.send('win-state', { maximized: true }))
  win.on('unmaximize', () => events.send('win-state', { maximized: false }))
  // Links open in the normal web browser, never inside the launcher.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' } })
  win.webContents.on('will-navigate', e => e.preventDefault())
}

// ---------- Opening .mcaddon / .mcpack / .mcworld files with Plunder ----------
const pendingFiles = []
let uiReady = false
function filesFromArgv (argv) {
  return (argv || []).slice(1).filter(a => typeof a === 'string' && [...bedrock.PACK_EXTS, '.mrpack'].includes(path.extname(a).toLowerCase()) && fs.existsSync(a))
}
async function openAddonFiles (files) {
  for (const f of files) {
    if (assoc.isTestFile(f)) {
      try { fs.rmSync(f, { force: true }) } catch {}
      events.send('toast', { kind: 'ok', text: 'Done! Plunder now opens .mcaddon, .mcpack and .mcworld files.' })
      events.send('assoc-changed')
      continue
    }
    const name = path.basename(f)
    if (/\.mrpack$/i.test(f)) {
      content.installModpack({ file: f })
        .then(r => { events.send('toast', { kind: 'ok', text: `Modpack “${r.instance.name}” installed as a new instance.` }); events.send('instances-changed') })
        .catch(e => events.send('toast', { kind: 'error', text: e.message }))
      continue
    }
    const t = events.task(`Installing ${name}`)
    try {
      const r = await bedrock.importFile(f)
      // Keep a copy in the selected Bedrock profile so it can be re-imported later.
      try {
        const d = store.get()
        const inst = instances.list().find(i => i.id === d.selected.bedrock && i.edition === 'bedrock') || instances.list().find(i => i.edition === 'bedrock')
        if (inst) {
          const dest = path.join(instances.gameDir(inst), name)
          fs.mkdirSync(path.dirname(dest), { recursive: true })
          if (path.resolve(dest) !== path.resolve(f)) fs.copyFileSync(f, dest)
          inst.addons = (inst.addons || []).filter(a => a.file !== name)
          inst.addons.push({ file: name, title: bedrock.describeImport(r) || path.basename(name, path.extname(name)), source: 'file', added: Date.now() })
          instances.save(inst)
        }
      } catch (e) { console.error('save copy failed', e) }
      t.done('Installed into Minecraft')
      events.send('toast', { kind: 'ok', text: `Installed ${bedrock.describeImport(r)} into Minecraft. If Minecraft is open, restart it to see it.` })
      events.send('packs-changed')
    } catch (e) {
      t.fail(e)
      events.send('toast', { kind: 'error', text: e.message })
    }
  }
}
function queueFiles (files) {
  if (!files.length) return
  if (uiReady) openAddonFiles(files); else pendingFiles.push(...files)
}
queueFiles(filesFromArgv(process.argv))

app.on('second-instance', (_e, argv) => {
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus() }
  queueFiles(filesFromArgv(argv))
})
if (app.isReady()) createWindow(); else app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => bdata.restoreAllOnQuit())
try {
  bdata.repair()
  const sel = store.get().selected.bedrock
  if (sel) bdata.activate(instances.get(sel))
} catch (e) { console.error('bedrock data', e.message) }


// Every request from the UI goes through here. Errors are passed back as friendly messages.
function handle (name, fn) {
  ipcMain.handle(name, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) } } catch (err) {
      console.error(name, err)
      return { ok: false, error: String(err && err.message ? err.message : err), code: err && err.code }
    }
  })
}

const publicState = () => {
  const d = store.get()
  return { settings: d.settings, accounts: d.accounts, activeAccount: d.activeAccount, selected: d.selected, history: d.history }
}

// Window
handle('win:min', () => win.minimize())
handle('win:max', () => (win.isMaximized() ? win.unmaximize() : win.maximize()))
handle('win:close', () => win.close())

// App state + settings
handle('state:get', () => ({ ...publicState(), version: app.getVersion(), platform: process.platform, dataDir: store.P.base, portable: paths.portable, migratedFrom: paths.migratedFrom, running: instances.anyRunning(), totalMemMB: Math.floor(require('os').totalmem() / 1048576) }))
handle('settings:set', patch => {
  const d = store.get()
  const allowed = Object.keys(d.settings)
  for (const k of Object.keys(patch || {})) if (allowed.includes(k)) d.settings[k] = patch[k]
  if ('curseforgeKey' in (patch || {})) d.settings.curseforgeKey = content.cleanKey(d.settings.curseforgeKey)
  store.save()
  return d.settings
})
handle('select', (edition, id) => {
  store.get().selected[edition === 'bedrock' ? 'bedrock' : 'java'] = id; store.save()
  // The selected Bedrock profile's worlds/add-ons become the live ones (unless Minecraft is open).
  if (edition === 'bedrock') { try { if (bdata.activate(instances.get(id)).changed) events.send('packs-changed') } catch {} }
})

// Accounts
handle('accounts:add', () => auth.addAccount(code => events.send('auth-code', code)))
handle('accounts:cancel', () => auth.cancel())
handle('accounts:remove', id => auth.removeAccount(id))
handle('accounts:select', id => { const d = store.get(); if (d.accounts.some(a => a.id === id)) { d.activeAccount = id; store.save() } })

// Versions
handle('versions:minecraft', () => versions.minecraftVersions())
handle('versions:loader', (loader, mc) => versions.loaderVersions(loader, mc))

// Instances
handle('instances:list', () => instances.list())
handle('instances:create', async opts => {
  const inst = await instances.create(opts)
  if (inst.edition === 'bedrock' && inst.bedrockIsolated && opts.copyShared) { try { await bdata.copySharedInto(inst) } catch (e) { console.error(e) } }
  return inst
})
handle('instances:update', (id, patch) => instances.update(id, patch))
handle('instances:delete', id => instances.remove(id))
// Bedrock runs outside Plunder, so watch for its window to count play time.
let bedrockWatch = null
function watchBedrock (instanceId) {
  if (process.platform !== 'win32') return
  if (bedrockWatch) clearInterval(bedrockWatch.timer)
  const w = bedrockWatch = { instanceId, started: null, misses: 0 }
  const isRunning = () => new Promise(res => require('child_process').execFile('tasklist', ['/FI', 'IMAGENAME eq Minecraft.Windows.exe', '/NH'], { windowsHide: true }, (e, out) => res(!e && /Minecraft\.Windows\.exe/i.test(String(out)))))
  w.timer = setInterval(async () => {
    const on = await isRunning()
    if (on && !w.started) w.started = Date.now()
    if (!on) {
      w.misses++
      if (w.started) {
        const ms = Date.now() - w.started
        clearInterval(w.timer); bedrockWatch = null
        try { const i = instances.get(instanceId); i.playTime = (i.playTime || 0) + ms; instances.save(i) } catch {}
        store.addSession({ instanceId, edition: 'bedrock', start: w.started, ms })
      } else if (w.misses > 20) { clearInterval(w.timer); bedrockWatch = null } // never started
    }
  }, 15000)
}

handle('instances:launch', async (id, opts) => {
  const inst = instances.get(id)
  if (inst.edition === 'bedrock') {
    inst.lastPlayed = Date.now()
    instances.save(inst)
    store.addHistory({ instanceId: id, edition: 'bedrock' })
    store.get().selected.bedrock = id; store.save()
    if (bdata.activate(inst).changed) events.send('packs-changed')
    try { await worlds.autoBackup({ edition: 'bedrock', instanceId: id }) } catch (e) { console.error('auto backup', e) }
    watchBedrock(id)
    if (inst.bedrockVersion) return bversions.launch(inst.bedrockVersion).then(() => true)
    return bversions.check().catch(() => null).then(st => {
      const a = st && st.active && st.active.release
      if (a && a.dev) throw new Error(`This profile uses the Store version, but Plunder's Bedrock ${a.plunder || a.version} is the one in Windows right now. Pick a version in this profile's Settings, or use “Restore Store version” on Bedrock → Versions.`)
      return bedrock.play()
    })
  }
  // Start in the background; progress arrives as "task" updates.
  instances.launch(id, opts || {}).then(() => {
    if (!store.get().settings.keepOpen && win) win.minimize()
  }).catch(e => events.send('toast', { kind: 'error', text: e.message }))
  return true
})
handle('instances:kill', id => instances.kill(id))
handle('instances:open', (id, sub) => {
  const inst = instances.get(id)
  const dir = path.join(instances.gameDir(inst), sub ? path.basename(sub) : '')
  fs.mkdirSync(dir, { recursive: true })
  return shell.openPath(dir)
})
handle('instances:pickIcon', async id => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose an icon', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }], properties: ['openFile'] })
  if (r.canceled || !r.filePaths[0]) return null
  const inst = instances.get(id)
  const ext = path.extname(r.filePaths[0])
  const dest = path.join(instances.dirOf(id), 'icon' + ext)
  fs.copyFileSync(r.filePaths[0], dest)
  inst.icon = worlds.imgData(dest)
  instances.save(inst)
  return inst.icon
})

// Content (mods etc.)
handle('content:list', id => instances.listContent(id))
handle('content:toggle', (id, key) => instances.toggleContent(id, key))
handle('content:delete', (id, key) => instances.deleteContent(id, key))
handle('content:addFiles', async (id, files) => {
  if (!files || !files.length) {
    const inst = instances.get(id)
    const filters = inst.edition === 'bedrock'
      ? [{ name: 'Bedrock add-ons', extensions: ['mcpack', 'mcaddon', 'mcworld', 'mctemplate', 'zip'] }]
      : [{ name: 'Mods & packs', extensions: ['jar', 'zip'] }]
    const r = await dialog.showOpenDialog(win, { title: 'Add files', filters, properties: ['openFile', 'multiSelections'] })
    if (r.canceled) return 0
    files = r.filePaths
  }
  return instances.addFiles(id, files)
})
handle('content:search', q => content.search(q))
handle('updates:check', id => updates.check(id))
handle('updates:one', (id, key) => updates.updateOne(id, key))
handle('updates:all', id => updates.updateAll(id))
handle('cf:test', () => content.testCurseforgeKey())

// Planet Minecraft (Bedrock)
// Import from other launchers
handle('import:detect', () => importer.detect())
handle('import:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Pick the instance folder from your other launcher', properties: ['openDirectory'] })
  if (r.canceled || !r.filePaths[0]) return null
  return importer.inspect(r.filePaths[0])
})
handle('import:run', opts => importer.importInstance(opts))
handle('import:world', async (instanceId, kind) => {
  const r = kind === 'zip'
    ? await dialog.showOpenDialog(win, { title: 'Pick a world .zip', filters: [{ name: 'World zip', extensions: ['zip'] }], properties: ['openFile'] })
    : await dialog.showOpenDialog(win, { title: 'Pick a world folder (the one with level.dat inside)', properties: ['openDirectory'] })
  if (r.canceled || !r.filePaths[0]) return null
  return importer.importWorld(instanceId, r.filePaths[0])
})
handle('bedrock:importWorld', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Pick a Bedrock world', filters: [{ name: 'Bedrock worlds & packs', extensions: ['mcworld', 'mcpack', 'mcaddon', 'mctemplate'] }], properties: ['openFile', 'multiSelections'] })
  if (r.canceled) return 0
  const done = []
  for (const f of r.filePaths) done.push(bedrock.describeImport(await bedrock.importFile(f)))
  events.send('packs-changed')
  return done
})

handle('web:search', q => websrc.search(q || {}))
handle('web:open', (url, instanceId, site) => websrc.openBrowser(url, instanceId, site))
handle('web:get', opts => websrc.getDirect(opts || {}))

// Servers
handle('servers:list', () => servers.list())
handle('servers:save', list => servers.save(list))
handle('servers:status', list => servers.statusMany(list))
handle('servers:game', () => ({ java: servers.javaGameServers(instances), bedrock: bedrock.gameServers() }))
handle('content:install', opts => content.installContent(opts))
handle('modpack:install', opts => content.installModpack(opts))
// Updates
handle('update:check', () => updater.check())
handle('update:install', () => updater.install())

// Skins
handle('skins:list', () => skins.list())
handle('skins:add', async variant => {
  const r = await dialog.showOpenDialog(win, { title: 'Pick a skin (PNG)', filters: [{ name: 'Skin', extensions: ['png'] }], properties: ['openFile', 'multiSelections'] })
  if (r.canceled) return 0
  for (const f of r.filePaths) skins.addFile(f, variant)
  return r.filePaths.length
})
handle('skins:addPath', (file, variant) => skins.addFile(file, variant))
handle('skins:update', (id, patch) => skins.update(id, patch))
handle('skins:remove', id => skins.remove(id))
handle('skins:profile', () => skins.profile())
handle('skins:wear', id => skins.wear(id))
handle('skins:saveCurrent', () => skins.saveCurrent())
handle('skins:cape', id => skins.setCape(id))

// Stats
handle('stats:get', () => ({ sessions: store.get().sessions || [] }))

handle('deps:check', id => modinfo.check(id))
handle('deps:install', async (id, modId) => {
  // Most mod ids match their Modrinth page name, so try that.
  return content.installContent({ instanceId: id, source: 'modrinth', projectId: modId, type: 'mod' })
})
handle('crash:analyze', id => crash.analyze(id, 0))
handle('crash:open', file => file && fs.existsSync(file) && shell.openPath(file))
handle('content:disableFile', (id, fileName) => instances.toggleContent(id, 'mods/' + path.basename(fileName)))
handle('modpack:export', async (id, opts) => {
  const inst = instances.get(id)
  const r = await dialog.showSaveDialog(win, { title: 'Export as modpack', defaultPath: path.join(app.getPath('desktop'), `${inst.name.replace(/[<>:"/\\|?*]/g, '')}.mrpack`), filters: [{ name: 'Modrinth modpack', extensions: ['mrpack'] }] })
  if (r.canceled || !r.filePath) return null
  const out = await packexport.exportPack(id, r.filePath, opts || {})
  shell.showItemInFolder(out.file)
  return out
})
handle('modpack:importFile', async file => {
  if (!file) {
    const r = await dialog.showOpenDialog(win, { title: 'Import a modpack file', filters: [{ name: 'Modpacks', extensions: ['mrpack', 'zip'] }], properties: ['openFile'] })
    if (r.canceled || !r.filePaths[0]) return null
    file = r.filePaths[0]
  }
  return content.installModpack({ file })
})

// Worlds + backups
handle('worlds:java', id => worlds.javaWorlds(id))
handle('worlds:bedrock', () => bedrock.worlds().map(({ dir, ...w }) => ({ ...w, backups: worlds.listBackups('bedrock', w.folder).length })))
handle('worlds:backup', w => worlds.backup(w))
handle('worlds:backups', (edition, owner, folder) => worlds.listBackups(edition, owner, folder))
handle('worlds:restore', b => worlds.restore(b))
handle('worlds:deleteBackup', b => worlds.deleteBackup(b))
handle('worlds:showBackup', b => shell.showItemInFolder(worlds.backupPath(b)))
handle('worlds:importBackup', async b => bedrock.describeImport(await bedrock.importFile(worlds.backupPath(b))))
handle('worlds:openJava', (id, folder) => shell.openPath(path.join(instances.gameDir(instances.get(id)), 'saves', path.basename(folder))))
handle('worlds:openBedrock', (folder, root) => shell.openPath(bedrock.findWorld(folder, root).dir))
handle('worlds:openBackups', () => { fs.mkdirSync(store.P.backups, { recursive: true }); return shell.openPath(store.P.backups) })
handle('worlds:deleteJava', (id, folder) => worlds.deleteJavaWorld(id, folder))

// Bedrock
handle('bedrock:info', async () => ({ version: await bedrock.installedVersion(), roots: bedrock.roots() }))
handle('bedrock:packs', () => bedrock.packs().map(({ dir, ...p }) => p))
handle('bedrock:gameServers', () => bedrock.gameServers())
handle('bedrock:join', (host, port) => bedrock.joinServer(host, port))
handle('bedrock:addServer', (name, host, port) => bedrock.addServerToGame(name, host, port))
handle('bedrock:importAddon', (id, file) => {
  const inst = instances.get(id)
  return bedrock.importFile(path.join(instances.gameDir(inst), path.basename(file))).then(r => { events.send('packs-changed'); return bedrock.describeImport(r) })
})

// "Open add-on files with Plunder"
// Bedrock versions
handle('bv:check', () => bversions.check())
handle('bv:available', () => bversions.available())
handle('bv:installed', () => bversions.installed().map(v => ({ ...v, size: bversions.sizeOf(v.dir) })))
handle('bv:installing', id => bversions.isInstalling(id))
handle('bv:install', opts => bversions.install(opts))
handle('bv:remove', async id => {
  await bversions.remove(id)
  for (const i of instances.list()) if (i.bedrockVersion === id) { const x = instances.get(i.id); x.bedrockVersion = null; instances.save(x) }
})
handle('bdata:status', id => bdata.status(instances.get(id)))
handle('bdata:copyShared', async id => { const inst = instances.get(id); await bdata.copySharedInto(inst); events.send('packs-changed'); return bdata.status(inst) })
handle('bdata:open', id => { const d = bdata.profileDir(instances.get(id)); fs.mkdirSync(d, { recursive: true }); return shell.openPath(d) })
handle('instances:setIsolated', async (id, on, copy) => {
  const inst = instances.get(id)
  if (bdata.gameRunning()) throw new Error('Close Minecraft first.')
  inst.bedrockIsolated = !!on
  instances.save(inst)
  if (on && copy) await bdata.copySharedInto(inst)
  if (store.get().selected.bedrock === id) bdata.activate(inst)
  events.send('packs-changed')
  return bdata.status(inst)
})
handle('bv:launch', id => bversions.launch(id).then(() => true))
handle('bv:restoreStore', kind => bversions.restoreStore(kind))
handle('bv:devSettings', () => shell.openExternal('ms-settings:developers'))
handle('bv:openFolder', () => { const d = path.join(store.P.base, 'bedrock', 'v'); fs.mkdirSync(d, { recursive: true }); return shell.openPath(d) })

handle('assoc:status', () => assoc.status())
handle('assoc:setup', async () => { await assoc.register(); assoc.chooseDefault(); return true })
handle('assoc:remove', () => assoc.unregister())
handle('bedrock:removeAddon', (id, file) => {
  const inst = instances.get(id)
  fs.rmSync(path.join(instances.gameDir(inst), path.basename(file)), { force: true })
  inst.addons = (inst.addons || []).filter(a => a.file !== file)
  instances.save(inst)
})
handle('bedrock:servers:set', (id, servers) => {
  const inst = instances.get(id)
  inst.servers = (servers || []).map(s => ({ name: String(s.name || s.host).slice(0, 60), host: String(s.host).trim(), port: Number(s.port) || 19132 })).filter(s => s.host)
  instances.save(inst)
  return inst.servers
})
handle('bedrock:openData', () => { const r = bedrock.roots()[0]; if (!r) throw new Error("Couldn't find Bedrock's data folder."); return shell.openPath(r) })
handle('bedrock:pickData', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Pick the com.mojang folder', properties: ['openDirectory'] })
  if (r.canceled) return null
  store.get().settings.bedrockDataPath = r.filePaths[0]
  store.save()
  return r.filePaths[0]
})

// Misc
handle('open:url', url => { if (/^https:\/\//.test(url)) return shell.openExternal(url) })
handle('open:data', () => shell.openPath(store.P.base))
handle('clipboard', text => require('electron').clipboard.writeText(String(text)))
