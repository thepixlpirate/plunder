// Minecraft skins & capes: a saved skin library in Plunder Data plus changing what you wear
// through Minecraft's official account service.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const store = require('./store')
const auth = require('./auth')

const API = 'https://api.minecraftservices.com/minecraft/profile'
const dir = () => path.join(store.P.base, 'skins')
const indexFile = () => path.join(dir(), 'skins.json')

function pngSize (buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}
function library () { return store.readJson(indexFile(), []) }
function saveLibrary (list) { store.writeJson(indexFile(), list) }
const dataUrl = buf => 'data:image/png;base64,' + buf.toString('base64')

function list () {
  return library().map(s => {
    try { return { ...s, image: dataUrl(fs.readFileSync(path.join(dir(), s.file))) } } catch { return null }
  }).filter(Boolean)
}

function addFromBuffer (buf, name, variant = 'classic') {
  const sz = pngSize(buf)
  if (!sz || sz.w !== 64 || (sz.h !== 64 && sz.h !== 32)) throw new Error('A Minecraft skin must be a 64×64 (or old-style 64×32) PNG image.')
  const id = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12)
  fs.mkdirSync(dir(), { recursive: true })
  fs.writeFileSync(path.join(dir(), id + '.png'), buf)
  const lib = library().filter(s => s.id !== id)
  lib.unshift({ id, name: String(name || 'Skin').slice(0, 40), variant: variant === 'slim' ? 'slim' : 'classic', file: id + '.png', added: Date.now() })
  saveLibrary(lib)
  return id
}
function addFile (file, variant) { return addFromBuffer(fs.readFileSync(file), path.basename(file, path.extname(file)), variant) }
function update (id, patch) {
  const lib = library()
  const s = lib.find(x => x.id === id); if (!s) return
  if (patch.name) s.name = String(patch.name).slice(0, 40)
  if (patch.variant) s.variant = patch.variant === 'slim' ? 'slim' : 'classic'
  saveLibrary(lib)
}
function remove (id) {
  const lib = library(); const s = lib.find(x => x.id === id)
  if (s) fs.rmSync(path.join(dir(), s.file), { force: true })
  saveLibrary(lib.filter(x => x.id !== id))
}

async function token () { return (await auth.getLaunchAuth()).access_token }
async function api (method, url, body, isForm) {
  const res = await fetch(url, { method, headers: { Authorization: 'Bearer ' + await token(), ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined })
  if (res.status === 429) throw new Error('Minecraft says you changed skins too often — wait a minute and try again.')
  if (!res.ok) throw new Error(`Minecraft's account service said no (${res.status}).`)
  const txt = await res.text()
  return txt ? JSON.parse(txt) : {}
}

async function profile () {
  const p = await api('GET', API)
  const skin = (p.skins || []).find(s => s.state === 'ACTIVE')
  let image = null
  if (skin && skin.url) {
    try { const r = await fetch(skin.url.replace(/^http:/, 'https:')); image = dataUrl(Buffer.from(await r.arrayBuffer())) } catch {}
  }
  return {
    name: p.name,
    skin: skin ? { variant: (skin.variant || 'CLASSIC').toLowerCase(), url: skin.url, image } : null,
    capes: (p.capes || []).map(c => ({ id: c.id, alias: c.alias, active: c.state === 'ACTIVE', url: c.url }))
  }
}

async function wear (id) {
  const s = library().find(x => x.id === id)
  if (!s) throw new Error('Skin not found')
  const form = new FormData()
  form.append('variant', s.variant)
  form.append('file', new Blob([fs.readFileSync(path.join(dir(), s.file))], { type: 'image/png' }), 'skin.png')
  await api('POST', API + '/skins', form, true)
  return profile()
}
async function saveCurrent () {
  const p = await profile()
  if (!p.skin || !p.skin.image) throw new Error("Couldn't download your current skin.")
  return addFromBuffer(Buffer.from(p.skin.image.split(',')[1], 'base64'), `${p.name}'s skin`, p.skin.variant)
}
async function setCape (capeId) {
  if (capeId) await api('PUT', API + '/capes/active', { capeId })
  else await api('DELETE', API + '/capes/active')
  return profile()
}

module.exports = { list, addFile, update, remove, profile, wear, saveCurrent, setCape, pngSize }
