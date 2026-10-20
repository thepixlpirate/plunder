// Searching and installing from Modrinth and CurseForge (mods, packs, shaders, modpacks, Bedrock add-ons).
const fs = require('fs')
const path = require('path')
const AdmZip = require('adm-zip')
const { getJson, download, pool } = require('./net')
const store = require('./store')
const instances = require('./instances')
const events = require('./events')

const MR = 'https://api.modrinth.com/v2'
const CF = 'https://api.curseforge.com/v1'
const CF_JAVA = 432
const CF_BEDROCK = 78022
const CF_CLASS = { mod: 6, resourcepack: 12, shader: 6552, modpack: 4471 }
const CF_CLASS_FOLDER = { 6: 'mods', 12: 'resourcepacks', 6552: 'shaderpacks' }
const CF_LOADER = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 }
const SUPPORTED_LOADERS = ['fabric', 'quilt', 'forge', 'neoforge']

// Keys copied from websites sometimes pick up spaces, quotes or invisible characters.
function cleanKey (k) { return String(k || '').replace(/[\s"'`\u200B-\u200D\u2060\uFEFF]/g, '') }

function cfHeaders () {
  const key = cleanKey(store.get().settings.curseforgeKey)
  if (!key) {
    const e = new Error('CurseForge needs a free API key. Add one in Settings → CurseForge.')
    e.code = 'NO_CF_KEY'
    throw e
  }
  return { 'x-api-key': key }
}
async function cf (p, opts = {}) {
  try {
    return await getJson(CF + p, { ...opts, headers: cfHeaders() })
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      const err = new Error("CurseForge didn't accept your API key. In Settings → CurseForge, paste the key again (use the copy button on the console's API Keys page) and click Test.")
      err.code = 'CF_BAD_KEY'
      throw err
    }
    throw e
  }
}

// Checks the saved key with a tiny request.
async function testCurseforgeKey () {
  const r = await cf('/games?pageSize=50')
  return { ok: true, games: (r.data || []).length }
}

// Look up CurseForge's id for Bedrock once (falls back to the known id).
let bedrockGameId = null
async function cfBedrockId () {
  if (bedrockGameId) return bedrockGameId
  try {
    const games = (await cf('/games?pageSize=50')).data
    const g = games.find(x => /bedrock/i.test(x.slug || x.name))
    bedrockGameId = g ? g.id : CF_BEDROCK
  } catch { bedrockGameId = CF_BEDROCK }
  return bedrockGameId
}

// Keep downloaded files inside the folder they belong to.
function safeJoin (base, rel) {
  const p = path.resolve(base, rel)
  if (!p.startsWith(path.resolve(base) + path.sep)) throw new Error('Unsafe file path in pack: ' + rel)
  return p
}

// ---------- Search ----------
async function search ({ source = 'modrinth', type = 'mod', query = '', mc, loader, sort = 'relevance', offset = 0, edition = 'java' }) {
  if (source === 'curseforge' || edition === 'bedrock') return searchCF({ type, query, mc, loader, sort, offset, edition })
  const facets = [[`project_type:${type}`]]
  if (mc) facets.push([`versions:${mc}`])
  if (type === 'mod' && loader && loader !== 'vanilla') facets.push(loader === 'quilt' ? ['categories:quilt', 'categories:fabric'] : [`categories:${loader}`])
  if (type === 'modpack') facets.push(SUPPORTED_LOADERS.map(l => `categories:${l}`))
  const idx = { relevance: 'relevance', downloads: 'downloads', follows: 'follows', newest: 'newest', updated: 'updated' }[sort] || 'relevance'
  const url = `${MR}/search?query=${encodeURIComponent(query)}&facets=${encodeURIComponent(JSON.stringify(facets))}&index=${idx}&offset=${offset}&limit=20`
  const r = await getJson(url)
  return {
    total: r.total_hits,
    hits: r.hits.map(h => ({
      source: 'modrinth',
      id: h.project_id,
      slug: h.slug,
      title: h.title,
      author: h.author,
      description: h.description,
      icon: h.icon_url || null,
      banner: (h.gallery && h.gallery[0]) || h.featured_gallery || null,
      downloads: h.downloads,
      follows: h.follows,
      categories: (h.display_categories || h.categories || []).slice(0, 4),
      versions: h.versions,
      updated: h.date_modified,
      url: `https://modrinth.com/${h.project_type}/${h.slug}`
    }))
  }
}

async function searchCF ({ type, query, mc, loader, sort, offset, edition }) {
  const sortField = { relevance: 2, downloads: 6, follows: 2, newest: 11, updated: 3 }[sort] || 2
  const params = new URLSearchParams({ gameId: edition === 'bedrock' ? await cfBedrockId() : CF_JAVA, searchFilter: query, sortField, sortOrder: 'desc', index: offset, pageSize: 20 })
  if (edition !== 'bedrock') {
    params.set('classId', CF_CLASS[type] || 6)
    if (mc) params.set('gameVersion', mc)
    if (type === 'mod' && CF_LOADER[loader]) params.set('modLoaderType', CF_LOADER[loader])
  }
  const r = await cf('/mods/search?' + params)
  return {
    total: r.pagination ? r.pagination.totalCount : r.data.length,
    hits: r.data.map(m => ({
      source: 'curseforge',
      id: String(m.id),
      slug: m.slug,
      title: m.name,
      author: (m.authors && m.authors[0] && m.authors[0].name) || '',
      description: m.summary,
      icon: (m.logo && (m.logo.thumbnailUrl || m.logo.url)) || null,
      banner: (m.screenshots && m.screenshots[0] && m.screenshots[0].thumbnailUrl) || null,
      downloads: m.downloadCount,
      follows: m.thumbsUpCount || 0,
      categories: (m.categories || []).map(c => c.name).slice(0, 4),
      updated: m.dateModified,
      url: (m.links && m.links.websiteUrl) || `https://www.curseforge.com/minecraft/search?search=${encodeURIComponent(m.name)}`
    }))
  }
}

// ---------- Install into a Java instance ----------
function installedProjects (inst) {
  const map = {}
  for (const [key, m] of Object.entries(inst.content || {})) if (m.projectId) map[`${m.source}:${m.projectId}`] = key
  return map
}

async function installContent ({ instanceId, source, projectId, type = 'mod', title, icon }) {
  const inst = instances.get(instanceId)
  if (inst.edition === 'bedrock') return installBedrockAddon({ instanceId, projectId, title, icon })
  const t = events.task(`Installing ${title || 'content'}`, { instanceId })
  try {
    const seen = new Set()
    const installed = []
    const skipped = []
    const run = source === 'curseforge' ? installCFOne : installMROne
    await run(inst, projectId, type, { title, icon }, seen, installed, skipped, t)
    t.done(installed.length > 1 ? `Installed ${installed.length} files (with dependencies)` : 'Installed')
    return { installed, skipped }
  } catch (e) { t.fail(e); throw e }
}

async function installMROne (inst, projectId, type, meta, seen, installed, skipped, t, versionId) {
  if (seen.has(projectId)) return
  seen.add(projectId)
  const already = installedProjects(instances.get(inst.id))[`modrinth:${projectId}`]
  if (already && !versionId) return
  let version
  if (versionId) version = await getJson(`${MR}/version/${versionId}`)
  else {
    const q = new URLSearchParams({ game_versions: JSON.stringify([inst.mc]) })
    if (type === 'mod') q.set('loaders', JSON.stringify(inst.loader === 'quilt' ? ['quilt', 'fabric'] : [inst.loader]))
    const list = await getJson(`${MR}/project/${projectId}/version?${q}`)
    version = list.find(v => v.version_type === 'release') || list[0]
  }
  if (!version) throw new Error(`${meta.title || 'This project'} has no version for Minecraft ${inst.mc}${type === 'mod' ? ' + ' + inst.loader : ''}.`)
  if (!meta.title || !meta.icon) {
    try { const p = await getJson(`${MR}/project/${projectId}`); meta = { title: p.title, icon: p.icon_url, ptype: p.project_type } } catch {}
  }
  const ptype = meta.ptype || type
  const folder = instances.FOLDERS[ptype] || 'mods'
  const file = version.files.find(f => f.primary) || version.files[0]
  const dest = path.join(instances.gameDir(inst), folder, path.basename(file.filename))
  t.update(null, `Downloading ${file.filename}`)
  await download(file.url, dest, { sha1: file.hashes && file.hashes.sha1, onProgress: (g, n) => n && t.update(g / n) })
  instances.recordContent(inst.id, `${folder}/${path.basename(file.filename)}`, { source: 'modrinth', projectId, versionId: version.id, versionName: version.version_number, title: meta.title, icon: meta.icon })
  installed.push(file.filename)
  for (const dep of version.dependencies || []) {
    if (dep.dependency_type !== 'required') continue
    let pid = dep.project_id
    if (!pid && dep.version_id) { try { pid = (await getJson(`${MR}/version/${dep.version_id}`)).project_id } catch {} }
    if (pid) await installMROne(inst, pid, 'mod', {}, seen, installed, skipped, t)
  }
}

async function installCFOne (inst, modId, type, meta, seen, installed, skipped, t) {
  if (seen.has(String(modId))) return
  seen.add(String(modId))
  if (installedProjects(instances.get(inst.id))[`curseforge:${modId}`]) return
  const q = new URLSearchParams({ gameVersion: inst.mc, pageSize: 50 })
  if (type === 'mod' && CF_LOADER[inst.loader]) q.set('modLoaderType', CF_LOADER[inst.loader])
  const files = (await cf(`/mods/${modId}/files?${q}`)).data.sort((a, b) => new Date(b.fileDate) - new Date(a.fileDate))
  const file = files.find(f => f.releaseType === 1) || files[0]
  let mod = null
  try { mod = (await cf(`/mods/${modId}`)).data } catch {}
  const title = meta.title || (mod && mod.name) || file?.displayName
  if (!file) throw new Error(`${title || 'This project'} has no file for Minecraft ${inst.mc}${type === 'mod' ? ' + ' + inst.loader : ''}.`)
  if (!file.downloadUrl) {
    skipped.push({ title, url: mod && mod.links && mod.links.websiteUrl })
    events.send('toast', { kind: 'warn', text: `${title}'s author only allows downloads from the CurseForge website. Click “Open page” to download it, then drag the file onto the instance.`, url: mod && mod.links && mod.links.websiteUrl })
    return
  }
  const folder = CF_CLASS_FOLDER[mod && mod.classId] || instances.FOLDERS[type] || 'mods'
  const dest = path.join(instances.gameDir(inst), folder, path.basename(file.fileName))
  t.update(null, `Downloading ${file.fileName}`)
  await download(file.downloadUrl, dest, { onProgress: (g, n) => n && t.update(g / n) })
  instances.recordContent(inst.id, `${folder}/${path.basename(file.fileName)}`, { source: 'curseforge', projectId: String(modId), versionId: String(file.id), versionName: file.displayName, title, icon: meta.icon || (mod && mod.logo && mod.logo.thumbnailUrl) })
  installed.push(file.fileName)
  for (const dep of file.dependencies || []) {
    if (dep.relationType === 3) await installCFOne(inst, dep.modId, 'mod', {}, seen, installed, skipped, t)
  }
}

// ---------- Bedrock add-ons (CurseForge) ----------
async function installBedrockAddon ({ instanceId, projectId, title, icon }) {
  const inst = instances.get(instanceId)
  const t = events.task(`Getting ${title || 'add-on'}`, { instanceId })
  try {
    const files = (await cf(`/mods/${projectId}/files?pageSize=20`)).data.sort((a, b) => new Date(b.fileDate) - new Date(a.fileDate))
    const file = files[0]
    if (!file) throw new Error('No downloadable file for this add-on.')
    if (!file.downloadUrl) {
      let url = null
      try { url = (await cf(`/mods/${projectId}`)).data.links.websiteUrl } catch {}
      events.send('toast', { kind: 'warn', text: `${title}'s author only allows downloads from the CurseForge website. Download it there, then drag the file into this profile.`, url })
      t.done('Needs manual download')
      return { manual: true, url }
    }
    const dest = path.join(instances.gameDir(inst), path.basename(file.fileName))
    await download(file.downloadUrl, dest, { onProgress: (g, n) => n && t.update(g / n) })
    const i2 = instances.get(instanceId)
    i2.addons = (i2.addons || []).filter(a => a.file !== path.basename(file.fileName))
    i2.addons.push({ file: path.basename(file.fileName), title, icon, source: 'curseforge', projectId: String(projectId), added: Date.now() })
    instances.save(i2)
    if (/\.(mcpack|mcaddon|mcworld|mctemplate)$/i.test(dest)) {
      const bedrock = require('./bedrock')
      try {
        const r = await bedrock.importFile(dest)
        t.done('Installed into Minecraft')
        events.send('toast', { kind: 'ok', text: `Installed ${bedrock.describeImport(r)} into Minecraft. If Minecraft is open, restart it to see it.` })
        events.send('packs-changed')
      } catch (e) { t.fail(e); events.send('toast', { kind: 'error', text: e.message }) }
    } else { t.done('Downloaded'); require('electron').shell.showItemInFolder(dest) }
    return { file: dest }
  } catch (e) { t.fail(e); throw e }
}

// ---------- Modpacks ----------
function loaderFromDeps (deps) {
  if (deps['fabric-loader']) return { loader: 'fabric', loaderVersion: deps['fabric-loader'] }
  if (deps['quilt-loader']) return { loader: 'quilt', loaderVersion: deps['quilt-loader'] }
  if (deps.neoforge) return { loader: 'neoforge', loaderVersion: deps.neoforge }
  if (deps.forge) return { loader: 'forge', loaderVersion: deps.forge }
  return { loader: 'vanilla' }
}

function extractOverrides (zip, prefixes, dir) {
  for (const e of zip.getEntries()) {
    const pre = prefixes.find(p => e.entryName.startsWith(p + '/'))
    if (!pre || e.isDirectory) continue
    const rel = e.entryName.slice(pre.length + 1)
    if (!rel) continue
    const dest = safeJoin(dir, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, e.getData())
  }
}

async function installModpack ({ source, projectId, title, icon, file: localFile }) {
  const t = events.task(`Installing modpack ${title || ''}`.trim())
  let inst
  try {
    let zipPath, files, deps, mc, cfManifest
    if (localFile) {
      // A pack file from disk: Modrinth (.mrpack) or CurseForge (.zip with manifest.json)
      zipPath = localFile
      const zip = new AdmZip(localFile)
      if (zip.getEntry('modrinth.index.json')) {
        source = 'modrinth'
        const index = JSON.parse(zip.readAsText('modrinth.index.json'))
        title = title || index.name || path.basename(localFile, path.extname(localFile))
        deps = index.dependencies; mc = deps.minecraft
        files = index.files.filter(x => !x.env || x.env.client !== 'unsupported')
      } else if (zip.getEntry('manifest.json')) {
        source = 'curseforge'
        cfManifest = JSON.parse(zip.readAsText('manifest.json'))
        title = title || cfManifest.name || path.basename(localFile, path.extname(localFile))
        mc = cfManifest.minecraft.version
        const primary = (cfManifest.minecraft.modLoaders || []).find(l => l.primary) || (cfManifest.minecraft.modLoaders || [])[0]
        const [lname, ...lver] = primary ? primary.id.split('-') : ['vanilla']
        deps = { [lname === 'fabric' ? 'fabric-loader' : lname === 'quilt' ? 'quilt-loader' : lname]: lver.join('-') }
      } else throw new Error("That file isn't a Modrinth (.mrpack) or CurseForge modpack.")
    } else if (source === 'curseforge') {
      const mod = (await cf(`/mods/${projectId}`)).data
      title = title || mod.name
      icon = icon || (mod.logo && mod.logo.thumbnailUrl)
      const file = mod.latestFiles.sort((a, b) => new Date(b.fileDate) - new Date(a.fileDate)).find(f => f.releaseType === 1) || mod.latestFiles[0]
      if (!file || !file.downloadUrl) throw new Error('This modpack can only be downloaded from the CurseForge website.')
      zipPath = path.join(store.P.cache, 'packs', `cf-${file.id}.zip`)
      t.update(null, 'Downloading pack…')
      await download(file.downloadUrl, zipPath, { onProgress: (g, n) => n && t.update(g / n) })
      const zip = new AdmZip(zipPath)
      cfManifest = JSON.parse(zip.readAsText('manifest.json'))
      mc = cfManifest.minecraft.version
      const primary = (cfManifest.minecraft.modLoaders || []).find(l => l.primary) || cfManifest.minecraft.modLoaders[0]
      const [lname, ...lver] = primary ? primary.id.split('-') : ['vanilla']
      deps = { [lname === 'fabric' ? 'fabric-loader' : lname === 'quilt' ? 'quilt-loader' : lname]: lver.join('-') }
    } else {
      const project = await getJson(`${MR}/project/${projectId}`)
      title = title || project.title
      icon = icon || project.icon_url
      const vs = await getJson(`${MR}/project/${projectId}/version`)
      const v = vs.find(x => x.version_type === 'release' && x.loaders.some(l => SUPPORTED_LOADERS.includes(l))) || vs.find(x => x.loaders.some(l => SUPPORTED_LOADERS.includes(l))) || vs[0]
      if (!v) throw new Error('No versions found for this modpack.')
      const f = v.files.find(x => x.primary) || v.files[0]
      zipPath = path.join(store.P.cache, 'packs', `mr-${v.id}.mrpack`)
      t.update(null, 'Downloading pack…')
      await download(f.url, zipPath, { sha1: f.hashes && f.hashes.sha1, onProgress: (g, n) => n && t.update(g / n) })
      const index = JSON.parse(new AdmZip(zipPath).readAsText('modrinth.index.json'))
      deps = index.dependencies
      mc = deps.minecraft
      files = index.files.filter(x => !x.env || x.env.client !== 'unsupported')
    }

    const L = loaderFromDeps(deps)
    if (L.unsupported) throw new Error(`${title} uses ${L.unsupported}. This launcher supports Fabric and Quilt modpacks for now.`)
    t.update(null, 'Creating instance…')
    inst = await instances.create({ edition: 'java', name: title, mc, loader: L.loader, loaderVersion: L.loaderVersion, icon, modpack: { source, projectId } })
    const dir = instances.gameDir(inst)
    const zip = new AdmZip(zipPath)
    let done = 0
    const skipped = []

    if (source === 'curseforge') {
      const ids = cfManifest.files.filter(f => f.required !== false).map(f => f.fileID)
      const modIds = [...new Set(cfManifest.files.map(f => f.projectID))]
      const [fileInfo, modInfo] = await Promise.all([
        cf('/mods/files', { method: 'POST', body: { fileIds: ids } }),
        cf('/mods', { method: 'POST', body: { modIds } })
      ])
      const mods = Object.fromEntries(modInfo.data.map(m => [m.id, m]))
      await pool(fileInfo.data, 6, async f => {
        const m = mods[f.modId]
        if (!f.downloadUrl) { skipped.push({ title: (m && m.name) || f.displayName, url: m && m.links && m.links.websiteUrl }); return }
        const folder = CF_CLASS_FOLDER[m && m.classId] || 'mods'
        await download(f.downloadUrl, path.join(dir, folder, path.basename(f.fileName)))
        instances.recordContent(inst.id, `${folder}/${path.basename(f.fileName)}`, { source: 'curseforge', projectId: String(f.modId), versionId: String(f.id), versionName: f.displayName, title: m && m.name, icon: m && m.logo && m.logo.thumbnailUrl })
        t.update(++done / fileInfo.data.length, `Downloading mods (${done}/${fileInfo.data.length})`)
      })
      extractOverrides(zip, [cfManifest.overrides || 'overrides'], dir)
    } else {
      await pool(files, 6, async f => {
        const dest = safeJoin(dir, f.path)
        await download(f.downloads[0], dest, { sha1: f.hashes && f.hashes.sha1 })
        t.update(++done / files.length, `Downloading mods (${done}/${files.length})`)
      })
      extractOverrides(zip, ['overrides', 'client-overrides'], dir)
    }
    t.done(skipped.length ? `Installed — ${skipped.length} file(s) need manual download` : 'Modpack ready to play')
    if (skipped.length) events.send('toast', { kind: 'warn', text: `${skipped.length} mod(s) in this pack must be downloaded from CurseForge's website: ${skipped.map(s => s.title).join(', ')}` })
    return { instance: inst, skipped }
  } catch (e) {
    if (inst) { try { instances.remove(inst.id) } catch {} }
    t.fail(e)
    throw e
  }
}

module.exports = { cf, CF_LOADER, cleanKey, testCurseforgeKey, search, installContent, installModpack }
