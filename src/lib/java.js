// Downloads the exact Java version each Minecraft version needs, straight from Mojang,
// so you never have to install Java yourself.
const fs = require('fs')
const path = require('path')
const { getJson, download, pool } = require('./net')
const store = require('./store')

const ALL = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json'

function platformKey () {
  if (process.platform === 'win32') return process.arch === 'arm64' ? 'windows-arm64' : (process.arch === 'ia32' ? 'windows-x86' : 'windows-x64')
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-os-arm64' : 'mac-os'
  return 'linux'
}

function javaExe (dir) {
  if (process.platform === 'win32') return path.join(dir, 'bin', 'javaw.exe')
  if (process.platform === 'darwin') return path.join(dir, 'jre.bundle', 'Contents', 'Home', 'bin', 'java')
  return path.join(dir, 'bin', 'java')
}

// component: e.g. "java-runtime-delta" (Java 21), "java-runtime-gamma" (17), "jre-legacy" (8)
async function ensureJava (component = 'java-runtime-delta', onProgress = () => {}) {
  const custom = store.get().settings.javaPath
  if (custom && fs.existsSync(custom)) return custom

  const dir = path.join(store.P.runtimes, component)
  const exe = javaExe(dir)
  const marker = path.join(dir, '.complete')
  if (fs.existsSync(exe) && fs.existsSync(marker)) return exe

  const all = await getJson(ALL)
  const list = (all[platformKey()] || {})[component]
  if (!list || !list.length) throw new Error(`Mojang has no Java "${component}" for this computer.`)
  const manifest = await getJson(list[0].manifest.url)
  const entries = Object.entries(manifest.files)

  for (const [rel, f] of entries) if (f.type === 'directory') fs.mkdirSync(path.join(dir, rel), { recursive: true })
  const files = entries.filter(([, f]) => f.type === 'file')
  let done = 0
  await pool(files, 8, async ([rel, f]) => {
    const dest = path.join(dir, rel)
    await download(f.downloads.raw.url, dest, { sha1: f.downloads.raw.sha1 })
    if (f.executable && process.platform !== 'win32') fs.chmodSync(dest, 0o755)
    onProgress(++done, files.length)
  })
  if (process.platform !== 'win32') {
    for (const [rel, f] of entries) {
      if (f.type === 'link') { try { fs.symlinkSync(f.target, path.join(dir, rel)) } catch {} }
    }
  }
  fs.writeFileSync(marker, new Date().toISOString())
  return exe
}

module.exports = { ensureJava }
