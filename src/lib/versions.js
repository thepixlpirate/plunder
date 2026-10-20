// Minecraft + mod loader version lists, and installing loaders (Fabric / Quilt / Forge / NeoForge).
const fs = require('fs')
const path = require('path')
const { getJson, download } = require('./net')
const store = require('./store')

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const LOADERS = {
  fabric: { meta: 'https://meta.fabricmc.net/v2', label: 'Fabric' },
  quilt: { meta: 'https://meta.quiltmc.org/v3', label: 'Quilt' },
  forge: { label: 'Forge', forgeLike: true },
  neoforge: { label: 'NeoForge', forgeLike: true }
}
const FORGE_META = 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml'
const FORGE_PROMOS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json'
const NEO_VERSIONS = 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge'

async function getText (url) {
  const res = await fetch(url, { headers: { 'User-Agent': require('./net').UA } })
  if (!res.ok) throw new Error(`Request failed (${res.status}) for ${new URL(url).host}`)
  return res.text()
}

// NeoForge numbers follow Minecraft: MC 1.21.1 -> 21.1.x ; MC 26.3 -> 26.3.0.x ; MC 26.3.1 -> 26.3.1.x
function neoPrefix (mc) {
  const p = mc.split('.')
  if (p[0] === '1') return `${p[1]}.${p[2] || 0}.`
  return `${p[0]}.${p[1]}.${p[2] || 0}.`
}

async function forgeLikeVersions (loader, mc) {
  if (loader === 'forge') {
    const xml = await getText(FORGE_META)
    const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]).filter(v => v.startsWith(mc + '-'))
    let promos = {}
    try { promos = (await getJson(FORGE_PROMOS)).promos || {} } catch {}
    const rec = promos[mc + '-recommended'], latest = promos[mc + '-latest']
    return all.map(v => v.slice(mc.length + 1)).reverse().map(v => ({ version: v, stable: v === rec || (!rec && v === latest), recommended: v === rec }))
      .sort((a, b) => (b.recommended - a.recommended))
  }
  const data = await getJson(NEO_VERSIONS)
  const pre = neoPrefix(mc)
  return (data.versions || []).filter(v => v.startsWith(pre)).reverse().map(v => ({ version: v, stable: !/beta|alpha/i.test(v) }))
}

function installerUrl (loader, mc, v) {
  if (loader === 'forge') return `https://maven.minecraftforge.net/net/minecraftforge/forge/${mc}-${v}/forge-${mc}-${v}-installer.jar`
  return `https://maven.neoforged.net/releases/net/neoforged/neoforge/${v}/neoforge-${v}-installer.jar`
}

// Downloads the Forge/NeoForge installer (Plunder's game library uses it to set up the loader).
async function forgeInstaller (loader, mc, v, onProgress) {
  const file = path.join(store.P.shared, 'installers', `${loader}-${loader === 'forge' ? mc + '-' : ''}${v}-installer.jar`)
  if (fs.existsSync(file) && fs.statSync(file).size > 10000) return file
  await download(installerUrl(loader, mc, v), file, { onProgress: (g, n) => onProgress && n && onProgress(g / n) })
  return file
}

let manifestCache = null
async function manifest () {
  const file = path.join(store.P.cache, 'version_manifest.json')
  if (manifestCache) return manifestCache
  try {
    manifestCache = await getJson(MANIFEST)
    store.writeJson(file, manifestCache)
  } catch (e) {
    manifestCache = store.readJson(file)
    if (!manifestCache) throw e
  }
  return manifestCache
}

async function minecraftVersions () {
  const m = await manifest()
  return { latest: m.latest, versions: m.versions.map(v => ({ id: v.id, type: v.type, releaseTime: v.releaseTime })) }
}

// The full version JSON for one Minecraft version (tells us which Java it needs).
async function versionJson (mc) {
  const file = path.join(store.P.cache, 'versions', mc + '.json')
  const cached = store.readJson(file)
  if (cached) return cached
  const m = await manifest()
  const v = m.versions.find(x => x.id === mc)
  if (!v) throw new Error(`Unknown Minecraft version ${mc}`)
  const json = await getJson(v.url)
  store.writeJson(file, json)
  return json
}

async function loaderVersions (loader, mc) {
  if (!LOADERS[loader]) return []
  if (LOADERS[loader].forgeLike) return forgeLikeVersions(loader, mc)
  const list = await getJson(`${LOADERS[loader].meta}/versions/loader/${encodeURIComponent(mc)}`)
  return list.map(x => ({ version: x.loader.version, stable: x.loader.stable !== false && !/beta|pre/i.test(x.loader.version) }))
}

// Writes the loader's version profile into the shared versions folder and returns its id.
async function installLoader (loader, mc, loaderVersion) {
  if (!LOADERS[loader]) throw new Error('Unsupported loader ' + loader)
  if (LOADERS[loader].forgeLike) {
    if (!loaderVersion) {
      const list = await loaderVersions(loader, mc)
      if (!list.length) throw new Error(`${LOADERS[loader].label} isn't available for Minecraft ${mc}.`)
      loaderVersion = (list.find(x => x.recommended) || list.find(x => x.stable) || list[0]).version
    }
    return { id: null, loaderVersion }
  }
  if (!loaderVersion) {
    const list = await loaderVersions(loader, mc)
    if (!list.length) throw new Error(`${LOADERS[loader].label} does not support Minecraft ${mc} yet.`)
    loaderVersion = (list.find(x => x.stable) || list[0]).version
  }
  const profile = await getJson(`${LOADERS[loader].meta}/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(loaderVersion)}/profile/json`)
  const id = profile.id
  const dir = path.join(store.P.shared, 'versions', id)
  fs.mkdirSync(dir, { recursive: true })
  store.writeJson(path.join(dir, id + '.json'), profile)
  return { id, loaderVersion }
}

module.exports = { forgeInstaller,  minecraftVersions, versionJson, loaderVersions, installLoader, LOADERS }
