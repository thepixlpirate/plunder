// Live server status: asks each server directly how many players are on, its message (MOTD),
// version and ping — the same way Minecraft's own server list does.
const net = require('net')
const dgram = require('dgram')
const dns = require('dns').promises
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const store = require('./store')

const strip = s => String(s || '').replace(/§./g, '').trim()

// Java "chat component" text → plain text.
function flatten (c) {
  if (c == null) return ''
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map(flatten).join('')
  return (c.text || c.translate || '') + (c.extra ? c.extra.map(flatten).join('') : '')
}

// ---------- Java (Server List Ping) ----------
function varint (n) {
  const out = []
  n >>>= 0
  do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b) } while (n)
  return Buffer.from(out)
}
function readVarint (buf, off) {
  let num = 0, shift = 0, b
  do {
    if (off >= buf.length) return null
    b = buf[off++]
    num |= (b & 0x7f) << shift
    shift += 7
    if (shift > 35) throw new Error('bad varint')
  } while (b & 0x80)
  return { value: num, off }
}
function packet (id, ...parts) {
  const body = Buffer.concat([varint(id), ...parts])
  return Buffer.concat([varint(body.length), body])
}
function mcString (s) { const b = Buffer.from(s, 'utf8'); return Buffer.concat([varint(b.length), b]) }

async function resolveJava (host, port) {
  if (port && port !== 25565) return { host, port }
  if (net.isIP(host)) return { host, port: port || 25565 }
  try {
    const srv = await dns.resolveSrv('_minecraft._tcp.' + host)
    if (srv && srv[0]) return { host: srv[0].name, port: srv[0].port }
  } catch {}
  return { host, port: port || 25565 }
}

function javaStatus (hostIn, portIn, timeout = 5000) {
  return resolveJava(hostIn, Number(portIn) || 25565).then(({ host, port }) => new Promise(resolve => {
    const start = Date.now()
    let buf = Buffer.alloc(0)
    let done = false
    const sock = net.connect({ host, port })
    const finish = r => { if (done) return; done = true; clearTimeout(timer); sock.destroy(); resolve(r) }
    const timer = setTimeout(() => finish({ online: false, error: 'No response' }), timeout)
    sock.on('error', e => finish({ online: false, error: e.code === 'ENOTFOUND' ? 'Address not found' : e.code === 'ECONNREFUSED' ? 'Offline' : (e.code || e.message) }))
    sock.on('connect', () => {
      const p = Buffer.alloc(2); p.writeUInt16BE(port)
      sock.write(packet(0x00, varint(-1), mcString(hostIn), p, varint(1)))
      sock.write(packet(0x00))
    })
    sock.on('data', d => {
      buf = Buffer.concat([buf, d])
      try {
        const len = readVarint(buf, 0); if (!len || buf.length < len.off + len.value) return
        const id = readVarint(buf, len.off)
        const sl = readVarint(buf, id.off)
        const json = JSON.parse(buf.slice(sl.off, sl.off + sl.value).toString('utf8'))
        finish({
          online: true,
          ping: Date.now() - start,
          version: strip(json.version && json.version.name),
          protocol: json.version && json.version.protocol,
          players: { online: (json.players && json.players.online) || 0, max: (json.players && json.players.max) || 0, sample: ((json.players && json.players.sample) || []).map(p => strip(p.name)).filter(n => n && !/^\s*$/.test(n)).slice(0, 12) },
          motd: strip(flatten(json.description)),
          favicon: typeof json.favicon === 'string' && json.favicon.startsWith('data:image/') ? json.favicon : null
        })
      } catch (e) { finish({ online: false, error: 'Unexpected reply' }) }
    })
  }))
}

// ---------- Bedrock (RakNet unconnected ping) ----------
const MAGIC = Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex')
function bedrockStatus (host, port, timeout = 4000) {
  port = Number(port) || 19132
  return new Promise(resolve => {
    const fam = net.isIPv6(host) ? 'udp6' : 'udp4'
    const sock = dgram.createSocket(fam)
    const start = Date.now()
    let done = false
    const finish = r => { if (done) return; done = true; clearTimeout(timer); clearInterval(retry); try { sock.close() } catch {} ; resolve(r) }
    const timer = setTimeout(() => finish({ online: false, error: 'No response' }), timeout)
    const ping = Buffer.alloc(33)
    ping[0] = 0x01
    ping.writeBigInt64BE(BigInt(Date.now()), 1)
    MAGIC.copy(ping, 9)
    crypto.randomBytes(8).copy(ping, 25)
    const send = () => sock.send(ping, port, host, err => { if (err) finish({ online: false, error: err.code === 'ENOTFOUND' ? 'Address not found' : (err.code || err.message) }) })
    const retry = setInterval(send, 1200) // UDP can drop packets — try a few times
    sock.on('error', e => finish({ online: false, error: e.code || e.message }))
    sock.on('message', msg => {
      if (msg[0] !== 0x1c || msg.length < 35) return
      const len = msg.readUInt16BE(33)
      const parts = msg.slice(35, 35 + len).toString('utf8').split(';')
      finish({
        online: true,
        ping: Date.now() - start,
        edition: parts[0],
        motd: strip([parts[1], parts[7]].filter(Boolean).join(' — ')),
        protocol: Number(parts[2]) || null,
        version: parts[3] || '',
        players: { online: Number(parts[4]) || 0, max: Number(parts[5]) || 0, sample: [] },
        gamemode: parts[8] || ''
      })
    })
    send()
  })
}

function status (s) {
  const host = String(s.host || '').trim()
  if (!host) return Promise.resolve({ online: false, error: 'No address' })
  return s.edition === 'bedrock' ? bedrockStatus(host, s.port) : javaStatus(host, s.port)
}

async function statusMany (list) {
  const out = {}
  await Promise.all((list || []).slice(0, 60).map(async s => {
    try { out[s.id || `${s.edition}|${s.host}|${s.port}`] = await status(s) } catch (e) { out[s.id] = { online: false, error: e.message } }
  }))
  return out
}

// ---------- Saved list ----------
function parseAddress (addr, edition) {
  let host = String(addr || '').trim().replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '')
  let port = null
  const m = host.match(/^\[?([^\]]+)\]?:(\d+)$/)
  if (m && (m[1].includes('.') || m[1].includes(':'))) { host = m[1]; port = Number(m[2]) }
  return { host, port: port || (edition === 'bedrock' ? 19132 : 25565), explicit: !!port }
}

function list () { return store.get().servers || [] }
function save (servers) {
  const clean = (servers || []).map(s => {
    const edition = s.edition === 'bedrock' ? 'bedrock' : 'java'
    const a = parseAddress(s.host, edition)
    return { id: s.id || crypto.randomUUID(), edition, name: String(s.name || a.host).slice(0, 60), host: a.host, port: a.explicit ? a.port : (Number(s.port) || a.port), instanceId: s.instanceId || null }
  }).filter(s => s.host)
  store.get().servers = clean
  store.save()
  return clean
}

// Older versions stored Bedrock servers inside a profile — move them to the shared list once.
function migrateProfileServers (instances) {
  let changed = false
  const cur = list()
  for (const inst of instances.list()) {
    if (inst.edition !== 'bedrock' || !(inst.servers || []).length) continue
    for (const s of inst.servers) {
      if (!cur.some(c => c.edition === 'bedrock' && c.host === s.host && c.port === s.port)) cur.push({ name: s.name, host: s.host, port: s.port, edition: 'bedrock' })
    }
    inst.servers = []
    instances.save(inst)
    changed = true
  }
  if (changed) save(cur)
}

// ---------- Servers saved inside Java's own multiplayer list (servers.dat, NBT) ----------
function readNbt (buf) {
  let o = 0
  const str = () => { const n = buf.readUInt16BE(o); o += 2; const s = buf.toString('utf8', o, o + n); o += n; return s }
  const payload = t => {
    switch (t) {
      case 1: return buf.readInt8(o++)
      case 2: { const v = buf.readInt16BE(o); o += 2; return v }
      case 3: { const v = buf.readInt32BE(o); o += 4; return v }
      case 4: { const v = buf.readBigInt64BE(o); o += 8; return Number(v) }
      case 5: { const v = buf.readFloatBE(o); o += 4; return v }
      case 6: { const v = buf.readDoubleBE(o); o += 8; return v }
      case 7: { const n = buf.readInt32BE(o); o += 4; o += n; return null }
      case 8: return str()
      case 9: { const et = buf[o++]; const n = buf.readInt32BE(o); o += 4; const a = []; for (let i = 0; i < n; i++) a.push(payload(et)); return a }
      case 10: { const obj = {}; for (;;) { const tt = buf[o++]; if (tt === 0) break; const name = str(); obj[name] = payload(tt) } return obj }
      case 11: { const n = buf.readInt32BE(o); o += 4 + n * 4; return null }
      case 12: { const n = buf.readInt32BE(o); o += 4 + n * 8; return null }
      default: throw new Error('bad nbt')
    }
  }
  const t = buf[o++]
  str()
  return payload(t)
}

function javaGameServers (instances) {
  const out = []
  for (const inst of instances.list().filter(i => i.edition === 'java')) {
    const f = path.join(instances.gameDir(inst), 'servers.dat')
    if (!fs.existsSync(f)) continue
    try {
      const root = readNbt(fs.readFileSync(f))
      for (const s of (root.servers || [])) {
        if (!s.ip) continue
        const a = parseAddress(s.ip, 'java')
        out.push({ edition: 'java', name: strip(s.name) || a.host, host: a.host, port: a.port, instanceId: inst.id, instanceName: inst.name, icon: s.icon ? 'data:image/png;base64,' + s.icon : null })
      }
    } catch {}
  }
  return out
}

module.exports = { status, statusMany, list, save, parseAddress, migrateProfileServers, javaGameServers, javaStatus, bedrockStatus }
