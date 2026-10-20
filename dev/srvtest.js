// Runs in Electron: fake Java + Bedrock servers, check status parsing, NBT reading, PMC window.
const { app } = require('electron')
const path = require('path'), fs = require('fs'), os = require('os'), net = require('net'), dgram = require('dgram')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'plunder-')))
const log = (...a) => console.log('[test]', ...a)
function varint (n) { const o = []; n >>>= 0; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b) } while (n); return Buffer.from(o) }
app.whenReady().then(async () => {
  // Fake Java server
  const jsrv = net.createServer(sock => {
    sock.once('data', () => {
      const json = Buffer.from(JSON.stringify({ version: { name: 'Paper 1.21.1', protocol: 767 }, players: { max: 20, online: 3, sample: [{ name: 'Alice', id: 'x' }, { name: '§aBob', id: 'y' }] }, description: { text: '§6Welcome ', extra: [{ text: 'aboard!' }] }, favicon: 'data:image/png;base64,AAAA' }))
      const body = Buffer.concat([varint(0), varint(json.length), json])
      sock.write(Buffer.concat([varint(body.length), body]))
    })
  }).listen(25599)
  // Fake Bedrock server
  const bsrv = dgram.createSocket('udp4')
  bsrv.on('message', (msg, rinfo) => {
    if (msg[0] !== 0x01) return
    const str = Buffer.from('MCPE;§bOurTech Bedrock;766;1.21.101;4;10;123456;Survival World;Survival;1;19132;19133;')
    const out = Buffer.alloc(35 + str.length)
    out[0] = 0x1c; msg.copy(out, 1, 1, 9); Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex').copy(out, 17); out.writeUInt16BE(str.length, 33); str.copy(out, 35)
    bsrv.send(out, rinfo.port, rinfo.address)
  })
  bsrv.bind(19199)
  await new Promise(r => setTimeout(r, 300))
  try {
    const servers = require('../src/lib/servers')
    log('java', JSON.stringify(await servers.javaStatus('127.0.0.1', 25599)))
    log('bedrock', JSON.stringify(await servers.bedrockStatus('127.0.0.1', 19199)))
    log('java offline', JSON.stringify(await servers.javaStatus('127.0.0.1', 25598)))
    log('bedrock offline', JSON.stringify(await servers.bedrockStatus('127.0.0.1', 19198, 2000)))
    log('save', JSON.stringify(servers.save([{ name: 'A', host: 'play.ourtech.us:25577', edition: 'java' }, { name: '', host: 'bed.example.com', port: 19140, edition: 'bedrock' }, { host: '' }]).map(s => [s.name, s.host, s.port, s.edition])))
    const many = await servers.statusMany([{ id: 'a', edition: 'java', host: '127.0.0.1', port: 25599 }, { id: 'b', edition: 'bedrock', host: '127.0.0.1', port: 19199 }])
    log('many', Object.keys(many).join(','), many.a.online, many.b.online)
    // NBT servers.dat
    const instances = require('../src/lib/instances')
    const inst = await instances.create({ edition: 'java', name: 'T', mc: '1.21.1', loader: 'vanilla' })
    const s8 = (t) => { const b = Buffer.from(t); const l = Buffer.alloc(2); l.writeUInt16BE(b.length); return Buffer.concat([l, b]) }
    const entry = Buffer.concat([Buffer.from([8]), s8('name'), s8('§eMy SMP'), Buffer.from([8]), s8('ip'), s8('smp.example.net:25570'), Buffer.from([1]), s8('hidden'), Buffer.from([0]), Buffer.from([0])])
    const cnt = Buffer.alloc(4); cnt.writeInt32BE(1)
    const nbt = Buffer.concat([Buffer.from([10]), s8(''), Buffer.from([9]), s8('servers'), Buffer.from([10]), cnt, entry, Buffer.from([0])])
    fs.writeFileSync(path.join(instances.gameDir(inst), 'servers.dat'), nbt)
    log('servers.dat', JSON.stringify(servers.javaGameServers(instances).map(s => [s.name, s.host, s.port, s.instanceName])))
    // Migration of old Bedrock profile servers
    const b = await instances.create({ edition: 'bedrock', name: 'Bed' })
    const bi = instances.get(b.id); bi.servers = [{ name: 'Old', host: 'old.example.com', port: 19132 }]; instances.save(bi)
    servers.migrateProfileServers(instances)
    log('migrated', servers.list().map(s => s.name + '/' + s.edition).join(', '), 'profile servers left:', instances.get(b.id).servers.length)
    // CF key cleaning
    const content = require('../src/lib/content')
    log('clean key', JSON.stringify(content.cleanKey(' "$2a$10$abc​def" \n')))
    // memory
    log('totalmem MB', Math.floor(os.totalmem() / 1048576))
    // Planet Minecraft (no internet here: should fail gracefully, not crash)
    const pmc = require('../src/lib/pmc')
    pmc.hookDownloads()
    log('pmc url', pmc.listUrl({ cat: 'addons' }), pmc.listUrl({ cat: 'addons', query: 'furniture', sort: 'popular', page: 2 }), pmc.listUrl({ cat: 'textures', query: 'faithful' }))
    const t0 = Date.now()
    try { const r = await pmc.search({ cat: 'addons' }); log('pmc search result', r.hits.length, 'hits in', Date.now() - t0, 'ms') } catch (e) { log('pmc search error (expected offline):', e.message) }
    pmc.openBrowser('', b.id)
    await new Promise(r => setTimeout(r, 2500))
    const { BrowserWindow } = require('electron')
    const w = BrowserWindow.getAllWindows().find(x => x.getTitle().includes('Planet'))
    log('pmc window open:', !!w, w && w.contentView.children.length, 'child view')
    if (w) { const img = await w.webContents.capturePage(); fs.writeFileSync(process.argv[process.argv.length - 1], img.toPNG()) }
  } catch (e) { log('FAIL', e.stack) }
  app.exit(0)
})
