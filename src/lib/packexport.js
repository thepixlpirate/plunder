// Export a Java instance as a Modrinth modpack (.mrpack) that friends can import in Plunder,
// the Modrinth App, Prism and most other launchers.
// Mods found on Modrinth are listed by download link (small file); anything else is packed inside.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const AdmZip = require('adm-zip')
const { getJson } = require('./net')
const instances = require('./instances')
const events = require('./events')

const LOADER_KEY = { fabric: 'fabric-loader', quilt: 'quilt-loader', forge: 'forge', neoforge: 'neoforge' }
const hash = (buf, algo) => crypto.createHash(algo).update(buf).digest('hex')

function walk (dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, base, out)
    else out.push(path.relative(base, p).split(path.sep).join('/'))
  }
  return out
}

async function exportPack (instanceId, dest, opts = {}) {
  const inst = instances.get(instanceId)
  if (inst.edition !== 'java') throw new Error('Only Java instances can be exported as a modpack.')
  const gd = instances.gameDir(inst)
  const t = events.task(`Exporting ${inst.name}`, { instanceId })
  try {
    const zip = new AdmZip()
    const files = []
    // Content folders: try to link Modrinth files instead of copying them.
    const candidates = []
    for (const folder of ['mods', 'resourcepacks', 'shaderpacks']) {
      for (const rel of walk(path.join(gd, folder))) {
        if (rel.includes('/')) continue
        if (folder === 'mods' ? !/\.jar$/i.test(rel) : !/\.zip$/i.test(rel)) continue // skips .disabled and helper files
        const buf = fs.readFileSync(path.join(gd, folder, rel))
        candidates.push({ path: `${folder}/${rel}`, buf, sha1: hash(buf, 'sha1'), sha512: hash(buf, 'sha512') })
      }
    }
    t.update(null, 'Matching files with Modrinth…')
    let found = {}
    if (candidates.length) {
      try { found = await getJson('https://api.modrinth.com/v2/version_files', { method: 'POST', body: { hashes: candidates.map(c => c.sha1), algorithm: 'sha1' } }) } catch (e) { console.error('export lookup', e.message) }
    }
    let linked = 0, packed = 0
    for (const c of candidates) {
      const v = found[c.sha1]
      const f = v && v.files.find(x => x.hashes && x.hashes.sha1 === c.sha1)
      if (f && f.url) {
        files.push({ path: c.path, hashes: { sha1: c.sha1, sha512: c.sha512 }, env: { client: 'required', server: 'optional' }, downloads: [f.url], fileSize: c.buf.length })
        linked++
      } else {
        zip.addFile(`overrides/${c.path}`, c.buf); packed++
      }
    }
    // Settings people usually want to share.
    t.update(null, 'Adding settings…')
    for (const rel of walk(path.join(gd, 'config'))) zip.addFile(`overrides/config/${rel}`, fs.readFileSync(path.join(gd, 'config', rel)))
    if (opts.includeOptions !== false && fs.existsSync(path.join(gd, 'options.txt'))) zip.addFile('overrides/options.txt', fs.readFileSync(path.join(gd, 'options.txt')))
    if (opts.includeServers && fs.existsSync(path.join(gd, 'servers.dat'))) zip.addFile('overrides/servers.dat', fs.readFileSync(path.join(gd, 'servers.dat')))
    if (opts.includeWorlds) for (const rel of walk(path.join(gd, 'saves'))) { if (!rel.endsWith('session.lock')) zip.addFile(`overrides/saves/${rel}`, fs.readFileSync(path.join(gd, 'saves', rel))) }
    const dependencies = { minecraft: inst.mc }
    if (LOADER_KEY[inst.loader]) dependencies[LOADER_KEY[inst.loader]] = inst.loaderVersion
    const index = { formatVersion: 1, game: 'minecraft', versionId: opts.version || '1.0.0', name: opts.name || inst.name, summary: opts.summary || `Exported from Plunder`, files, dependencies }
    zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify(index, null, 2)))
    t.update(null, 'Saving…')
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    zip.writeZip(dest)
    t.done(`Saved ${path.basename(dest)}`)
    return { file: dest, linked, packed, size: fs.statSync(dest).size }
  } catch (e) { t.fail(e); throw e }
}

module.exports = { exportPack }
