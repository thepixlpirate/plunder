// Reads what each mod jar says about itself: its id, name, what it needs and what it breaks.
// Supports Fabric/Quilt (fabric.mod.json / quilt.mod.json, incl. mods bundled inside other mods)
// and Forge/NeoForge (mods.toml / neoforge.mods.toml).
const fs = require('fs')
const path = require('path')
const AdmZip = require('adm-zip')
const instances = require('./instances')

// Always provided by the game / loader itself.
const BUILTIN = new Set(['minecraft', 'java', 'fabricloader', 'fabric-loader', 'quilt_loader', 'quilt_base', 'forge', 'neoforge', 'mixinextras'])
const cache = new Map() // file -> { mtime, info }

function looseJson (txt) {
  try { return JSON.parse(txt) } catch {}
  try { return JSON.parse(txt.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n\r]*|\/\*[\s\S]*?\*\//g, (m, s) => s || '').replace(/,\s*([}\]])/g, '$1')) } catch { return null }
}
const keysOf = v => !v ? [] : Array.isArray(v) ? v.map(x => typeof x === 'string' ? x : x && x.id).filter(Boolean) : Object.keys(v)

function readFabric (zip, out, depth = 0) {
  const fm = zip.getEntry('fabric.mod.json')
  const qm = zip.getEntry('quilt.mod.json')
  if (qm) {
    const j = looseJson(zip.readAsText(qm))
    const ql = j && j.quilt_loader
    if (ql && ql.id) {
      out.provides.add(ql.id)
      for (const p of keysOf(ql.provides)) out.provides.add(p)
      if (!depth) { out.id = ql.id; out.name = (ql.metadata && ql.metadata.name) || ql.id }
      if (!depth) for (const d of [].concat(ql.depends || [])) { const id = typeof d === 'string' ? d : d && (d.id || (Array.isArray(d.any) && d.any[0])); if (id && !(d && d.optional)) out.depends.push(String(id).replace(/^.*:/, '')) }
      if (!depth) for (const d of [].concat(ql.breaks || [])) { const id = typeof d === 'string' ? d : d && d.id; if (id) out.breaks.push(String(id).replace(/^.*:/, '')) }
    }
  } else if (fm) {
    const j = looseJson(zip.readAsText(fm))
    if (j && j.id) {
      out.provides.add(j.id)
      for (const p of keysOf(j.provides)) out.provides.add(p)
      if (!depth) { out.id = j.id; out.name = j.name || j.id; out.depends.push(...keysOf(j.depends)); out.breaks.push(...keysOf(j.breaks)) }
      // Mods bundled inside this mod (Fabric API ships ~40 of these).
      if (depth < 2) for (const n of [].concat(j.jars || [])) {
        const e = n && n.file && zip.getEntry(n.file)
        if (!e) continue
        try { readFabric(new AdmZip(e.getData()), out, depth + 1) } catch {}
      }
    }
  }
}

function readForge (zip, out) {
  const e = zip.getEntry('META-INF/neoforge.mods.toml') || zip.getEntry('META-INF/mods.toml')
  if (!e) return false
  const toml = zip.readAsText(e)
  const ids = [...toml.matchAll(/^\s*modId\s*=\s*"([^"]+)"/gm)].map(m => m[1])
  const blocks = toml.split(/\[\[\s*mods\s*\]\]/).slice(1)
  for (const b of blocks) { const m = b.match(/^\s*modId\s*=\s*"([^"]+)"/m); if (m) out.provides.add(m[1]) }
  out.id = [...out.provides][0] || ids[0] || null
  const nm = toml.match(/^\s*displayName\s*=\s*"([^"]+)"/m)
  out.name = nm ? nm[1] : out.id
  for (const dep of toml.split(/\[\[\s*dependencies\.[^\]]+\]\]/).slice(1)) {
    const id = (dep.match(/^\s*modId\s*=\s*"([^"]+)"/m) || [])[1]
    if (!id) continue
    const mandatory = /^\s*mandatory\s*=\s*true/m.test(dep) || /^\s*type\s*=\s*"required"/im.test(dep)
    const incompatible = /^\s*type\s*=\s*"incompatible"/im.test(dep)
    if (incompatible) out.breaks.push(id)
    else if (mandatory) out.depends.push(id)
  }
  return true
}

function info (file) {
  let st
  try { st = fs.statSync(file) } catch { return null }
  const hit = cache.get(file)
  if (hit && hit.mtime === st.mtimeMs) return hit.info
  const out = { file, id: null, name: null, provides: new Set(), depends: [], breaks: [] }
  try {
    const zip = new AdmZip(file)
    if (!readForge(zip, out)) readFabric(zip, out)
  } catch {}
  const res = { ...out, provides: [...out.provides] }
  cache.set(file, { mtime: st.mtimeMs, info: res })
  return res
}

// Everything installed and enabled in an instance.
function scan (instanceId) {
  const inst = instances.get(instanceId)
  const dir = path.join(instances.gameDir(inst), 'mods')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(f => /\.jar$/i.test(f)).map(f => ({ ...info(path.join(dir, f)), fileName: f })).filter(m => m.id)
}

// Missing requirements and known conflicts.
function check (instanceId) {
  const inst = instances.get(instanceId)
  const mods = scan(instanceId)
  const have = new Set([...BUILTIN])
  for (const m of mods) for (const p of m.provides) have.add(p)
  if (inst.loader === 'quilt') { have.add('fabric'); have.add('fabric-api') }
  const missing = new Map()
  const conflicts = []
  for (const m of mods) {
    for (const d of m.depends) {
      if (have.has(d) || /^fabric-.*-v\d+$/.test(d) && have.has('fabric-api')) continue
      if (!missing.has(d)) missing.set(d, [])
      missing.get(d).push(m.name || m.id)
    }
    for (const b of m.breaks) if (have.has(b) && b !== m.id) {
      const other = mods.find(x => x.provides.includes(b))
      conflicts.push({ mod: m.name || m.id, file: m.fileName, with: other ? (other.name || other.id) : b, withFile: other && other.fileName })
    }
  }
  return {
    mods: mods.length,
    missing: [...missing.entries()].map(([id, by]) => ({ id, neededBy: [...new Set(by)] })),
    conflicts
  }
}

module.exports = { info, scan, check }
