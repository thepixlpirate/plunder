// Checks installed mods / resource packs / shaders for newer versions and updates them
// (Modrinth matched by file fingerprint, like the Modrinth App; CurseForge by project).
const fs = require('fs')
const path = require('path')
const { getJson, download, sha1File } = require('./net')
const instances = require('./instances')
const events = require('./events')

const MR = 'https://api.modrinth.com/v2'
const FOLDER_TYPE = { mods: 'mod', resourcepacks: 'resourcepack', shaderpacks: 'shader' }
const cache = new Map() // instanceId -> { at, updates }

function mrLoaders (type, inst) {
  if (type === 'mod') return inst.loader === 'quilt' ? ['quilt', 'fabric'] : [inst.loader]
  if (type === 'resourcepack') return ['minecraft']
  return ['iris', 'optifine', 'canvas', 'vanilla']
}

async function check (instanceId) {
  const inst = instances.get(instanceId)
  if (inst.edition !== 'java') return {}
  const items = instances.listContent(instanceId)
  const gd = instances.gameDir(inst)
  const updates = {}
  const errors = []

  // ---- Modrinth: send each file's fingerprint, get back the newest compatible version ----
  const byType = {}
  for (const it of items) {
    if (it.source === 'curseforge') continue
    if (it.type === 'mod' && inst.loader === 'vanilla') continue
    try {
      const hash = await sha1File(path.join(gd, it.key.split('/')[0], it.file))
      ;(byType[it.type] = byType[it.type] || []).push({ it, hash })
    } catch {}
  }
  for (const [type, list] of Object.entries(byType)) {
    try {
      const res = await getJson(`${MR}/version_files/update`, { method: 'POST', body: { hashes: list.map(x => x.hash), algorithm: 'sha1', loaders: mrLoaders(type, inst), game_versions: [inst.mc] } })
      for (const { it, hash } of list) {
        const v = res[hash]
        if (!v) continue
        const file = v.files.find(f => f.primary) || v.files[0]
        if (!file || (file.hashes && file.hashes.sha1 === hash)) continue
        updates[it.key] = { source: 'modrinth', projectId: v.project_id, versionId: v.id, versionName: v.version_number, url: file.url, filename: file.filename, sha1: file.hashes && file.hashes.sha1 }
      }
    } catch (e) { errors.push('Modrinth: ' + e.message) }
  }

  // ---- CurseForge: newest release file for this Minecraft version + loader ----
  const cfItems = items.filter(it => it.source === 'curseforge' && it.projectId)
  if (cfItems.length) {
    const content = require('./content')
    for (const it of cfItems) {
      try {
        const meta = (inst.content || {})[it.key] || {}
        const q = new URLSearchParams({ gameVersion: inst.mc, pageSize: 50 })
        if (it.type === 'mod' && content.CF_LOADER[inst.loader]) q.set('modLoaderType', content.CF_LOADER[inst.loader])
        const files = (await content.cf(`/mods/${it.projectId}/files?${q}`)).data.sort((a, b) => new Date(b.fileDate) - new Date(a.fileDate))
        const f = files.find(x => x.releaseType === 1) || files[0]
        if (f && String(f.id) !== String(meta.versionId) && f.fileName !== it.file.replace(/\.disabled$/, '')) {
          updates[it.key] = { source: 'curseforge', projectId: it.projectId, versionId: String(f.id), versionName: f.displayName, url: f.downloadUrl, filename: f.fileName, manual: !f.downloadUrl }
        }
      } catch (e) {
        if (e.code === 'NO_CF_KEY' || e.code === 'CF_BAD_KEY') { errors.push('CurseForge: ' + e.message); break }
      }
    }
  }
  cache.set(instanceId, { at: Date.now(), updates })
  return { updates, errors: [...new Set(errors)], checked: items.length }
}

async function updateOne (instanceId, key, quiet) {
  const inst = instances.get(instanceId)
  let u = (cache.get(instanceId) || { updates: {} }).updates[key]
  if (!u) { await check(instanceId); u = cache.get(instanceId).updates[key] }
  if (!u) return { skipped: true }
  if (u.manual || !u.url) throw new Error('This CurseForge file can only be downloaded from the CurseForge website.')
  const [folder] = key.split('/')
  const dir = path.join(instances.gameDir(inst), folder)
  const oldName = path.basename(key)
  const wasDisabled = !fs.existsSync(path.join(dir, oldName)) && fs.existsSync(path.join(dir, oldName + '.disabled'))
  const t = quiet ? null : events.task(`Updating ${(inst.content && inst.content[key] && inst.content[key].title) || oldName}`, { instanceId })
  try {
    const newName = path.basename(u.filename)
    const tmp = path.join(dir, newName + '.plunder-update')
    await download(u.url, tmp, { sha1: u.sha1, onProgress: (g, n) => t && n && t.update(g / n) })
    // Remove the old file only after the new one downloaded fine.
    for (const n of [oldName, oldName + '.disabled']) fs.rmSync(path.join(dir, n), { force: true })
    fs.renameSync(tmp, path.join(dir, newName + (wasDisabled ? '.disabled' : '')))
    const i2 = instances.get(instanceId)
    const meta = (i2.content || {})[key] || {}
    i2.content = i2.content || {}
    delete i2.content[key]
    i2.content[`${folder}/${newName}`] = { ...meta, source: u.source, projectId: u.projectId, versionId: u.versionId, versionName: u.versionName }
    instances.save(i2)
    const c = cache.get(instanceId); if (c) delete c.updates[key]
    t && t.done('Updated')
    return { updated: true, newKey: `${folder}/${newName}` }
  } catch (e) { t && t.fail(e); throw e }
}

async function updateAll (instanceId) {
  const c = cache.get(instanceId) || (await check(instanceId), cache.get(instanceId))
  const keys = Object.keys(c.updates).filter(k => !c.updates[k].manual)
  const t = events.task(`Updating ${keys.length} item${keys.length === 1 ? '' : 's'}`, { instanceId })
  let done = 0
  const failed = []
  for (const k of keys) {
    t.update(done / keys.length, path.basename(k))
    try { await updateOne(instanceId, k, true) } catch (e) { failed.push(path.basename(k)) }
    done++
  }
  t.done(failed.length ? `${done - failed.length} updated, ${failed.length} failed` : 'All up to date')
  return { updated: done - failed.length, failed }
}

module.exports = { check, updateOne, updateAll }
