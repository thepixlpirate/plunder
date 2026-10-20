const { app } = require('electron')
const path = require('path'), fs = require('fs'), os = require('os')
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-'))
app.setPath('userData', path.join(T, 'plunder'))
const log = (...a) => console.log('[test]', ...a)
app.whenReady().then(async () => {
  try {
    const AdmZip = require('adm-zip')
    const APP = path.join(T, 'AppData', 'Roaming'), HOME = path.join(T, 'home')
    process.env.APPDATA = APP; process.env.LOCALAPPDATA = path.join(T, 'AppData', 'Local'); process.env.HOME = HOME
    const mk = (p, c = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c) }
    const fabricJar = (p, mc) => { const z = new AdmZip(); z.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'm', depends: { minecraft: mc } }))); fs.mkdirSync(path.dirname(p), { recursive: true }); z.writeZip(p) }
    const forgeJar = p => { const z = new AdmZip(); z.addFile('META-INF/mods.toml', Buffer.from('x')); fs.mkdirSync(path.dirname(p), { recursive: true }); z.writeZip(p) }
    // Modrinth App with app.db
    const mr = path.join(APP, 'ModrinthApp')
    fabricJar(path.join(mr, 'profiles', 'Fabric Fun', 'mods', 'sodium.jar'), '~1.21.1')
    mk(path.join(mr, 'profiles', 'Fabric Fun', 'saves', 'World A', 'level.dat'))
    mk(path.join(mr, 'profiles', 'Fabric Fun', 'saves', 'World A', 'session.lock'))
    mk(path.join(mr, 'profiles', 'Fabric Fun', 'options.txt'), 'fov:90')
    const initSql = require('sql.js'); const SQL = await initSql({ locateFile: f => path.join(path.dirname(require.resolve('sql.js')), f) })
    const db = new SQL.Database(); db.run("CREATE TABLE profiles (path TEXT, name TEXT, game_version TEXT, mod_loader TEXT, mod_loader_version TEXT, icon_path TEXT)"); db.run("INSERT INTO profiles VALUES ('Fabric Fun','Fabric Fun!','1.21.1','fabric','0.16.9',NULL)")
    fs.writeFileSync(path.join(mr, 'app.db'), Buffer.from(db.export()))
    // AstralRinth without db (guess)
    const ar = path.join(APP, 'AstralRinthApp')
    fabricJar(path.join(ar, 'profiles', 'Skyblock', 'mods', 'a.jar'), '1.20.1'); fabricJar(path.join(ar, 'profiles', 'Skyblock', 'mods', 'b.jar'), '1.20.1')
    mk(path.join(ar, 'profiles', 'Skyblock', 'saves', 'Sky', 'level.dat'))
    // Prism
    const pr = path.join(APP, 'PrismLauncher', 'instances', 'quilty')
    mk(path.join(pr, 'instance.cfg'), 'InstanceType=OneSix\nname=Quilt Pack\n')
    mk(path.join(pr, 'mmc-pack.json'), JSON.stringify({ components: [{ uid: 'net.minecraft', version: '1.20.4' }, { uid: 'org.quiltmc.quilt-loader', version: '0.26.0' }] }))
    mk(path.join(pr, '.minecraft', 'resourcepacks', 'Faithful.zip'))
    // CurseForge forge instance
    const cf = path.join(HOME, 'curseforge', 'minecraft', 'Instances', 'ATM9')
    mk(path.join(cf, 'minecraftinstance.json'), JSON.stringify({ name: 'All the Mods 9', gameVersion: '1.20.1', baseModLoader: { name: 'forge-47.2.0' } }))
    forgeJar(path.join(cf, 'mods', 'create.jar')); mk(path.join(cf, 'saves', 'ATM World', 'level.dat'))
    // Official launcher
    const om = path.join(APP, '.minecraft')
    mk(path.join(om, 'launcher_profiles.json'), JSON.stringify({ profiles: { a: { name: 'Latest', lastVersionId: '1.21.4', lastUsed: '2026-10-01' } } }))
    mk(path.join(om, 'saves', 'Old Survival', 'level.dat')); mk(path.join(om, 'servers.dat'))

    const importer = require('../src/lib/importer')
    const found = await importer.detect()
    for (const f of found) log('found', f.launcher, '|', f.name, '|', f.mc, f.loader, f.loaderVersion, '| guessed', f.guessed, JSON.stringify(f.counts))
    const instances = require('../src/lib/instances')
    const fab = found.find(f => f.launcher === 'Modrinth App')
    // creating a fabric instance needs internet (loader profile) — import into a vanilla one, then mods go in anyway for the copy test
    const r = await importer.importInstance({ dir: fab.dir, target: { create: { name: 'Imported', mc: '1.21.1', loader: 'vanilla' } }, what: { worlds: true, mods: true, options: true, resourcepacks: true } })
    const gd = instances.gameDir(r.instance)
    log('import done', JSON.stringify(r.done), 'files:', fs.readdirSync(path.join(gd, 'saves')), fs.readdirSync(path.join(gd, 'mods')), fs.readFileSync(path.join(gd, 'options.txt'), 'utf8'), 'session.lock copied?', fs.existsSync(path.join(gd, 'saves', 'World A', 'session.lock')))
    const r2 = await importer.importInstance({ dir: fab.dir, target: { instanceId: r.instance.id }, what: { worlds: true } })
    log('second import worlds', fs.readdirSync(path.join(gd, 'saves')))
    // world from zip
    const z = new AdmZip(); z.addFile('My Zipped World/level.dat', Buffer.from('l')); z.addFile('My Zipped World/region/r.0.0.mca', Buffer.from('r')); z.writeZip(path.join(T, 'w.zip'))
    log('zip world', JSON.stringify(await importer.importWorld(r.instance.id, path.join(T, 'w.zip'))), fs.readdirSync(path.join(gd, 'saves')))
    log('inspect prism folder', JSON.stringify((({ launcher, name, mc, loader }) => ({ launcher, name, mc, loader }))(importer.inspect(pr))))
    try { importer.inspect(T) } catch (e) { log('inspect empty:', e.message.slice(0, 60)) }
    // ModBay
    const web = require('../src/lib/websrc')
    log('modbay urls', web.SITES.modbay.listUrl({ cat: 'addons' }), web.SITES.modbay.listUrl({ cat: 'maps', page: 3 }), web.SITES.modbay.listUrl({ query: 'furniture' }))
    log('modbay item regex', web.SITES.modbay.itemRe.test('https://modbay.org/mods/7686-hart-logistics.html'), web.SITES.modbay.itemRe.test('https://modbay.org/mods/page/2/'))
  } catch (e) { log('FAIL', e.stack) }
  app.exit(0)
})
