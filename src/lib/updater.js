// Plunder updating itself from GitHub Releases.
// Set the repository in Settings → Updates (e.g. "yourname/plunder"). Each release needs a file named Plunder.exe.
const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawn } = require('child_process')
const { app } = require('electron')
const store = require('./store')
const events = require('./events')
const { getJson, download } = require('./net')
const paths = require('./paths')

const cmp = (a, b) => {
  const x = String(a).replace(/^v/i, '').split(/[.-]/).map(n => parseInt(n, 10) || 0)
  const y = String(b).replace(/^v/i, '').split(/[.-]/).map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0)
  return 0
}
const DEFAULT_REPO = 'thepixlpirate/plunder'
const repo = () => String(store.get().settings.updateRepo || DEFAULT_REPO).trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '').replace(/\.git$/, '')

let latest = null
async function check () {
  const r = repo()
  if (!r) return { configured: false, current: app.getVersion() }
  if (!/^[\w.-]+\/[\w.-]+$/.test(r)) throw new Error('The update repository should look like “yourname/plunder”.')
  let rel
  try { rel = await getJson(`https://api.github.com/repos/${r}/releases/latest`) } catch (e) {
    if (e.status === 404) return { configured: true, current: app.getVersion(), noReleases: true }
    throw e
  }
  const asset = (rel.assets || []).find(a => /^plunder.*\.exe$/i.test(a.name))
  latest = { version: String(rel.tag_name || rel.name || '').replace(/^v/i, ''), notes: rel.body || '', url: asset && asset.browser_download_url, size: asset && asset.size, page: rel.html_url }
  const newer = latest.version && cmp(latest.version, app.getVersion()) > 0
  return { configured: true, current: app.getVersion(), latest: latest.version, newer: !!newer, hasFile: !!latest.url, notes: latest.notes, page: latest.page }
}

async function checkQuietly () {
  try {
    const r = await check()
    if (r.newer) events.send('update-available', r)
  } catch (e) { console.error('update check', e.message) }
}

async function install () {
  if (!latest) await check()
  if (!latest || !latest.url) throw new Error('The latest release has no Plunder.exe file attached.')
  const exe = process.env.PORTABLE_EXECUTABLE_FILE
  if (!exe) throw new Error('Self-update works for the single-file Plunder.exe. Download the new version manually this time.')
  const t = events.task(`Downloading Plunder ${latest.version}`)
  const dest = path.join(paths.base, 'cache', 'update', 'Plunder-new.exe')
  try {
    await download(latest.url, dest, { onProgress: (g, n) => n && t.update(g / n) })
    t.done('Restarting to finish the update…')
  } catch (e) { t.fail(e); throw e }
  // Windows locks a running exe, so a tiny script swaps the files once Plunder has closed, then reopens it.
  const script = path.join(os.tmpdir(), `plunder-update-${Date.now()}.cmd`)
  fs.writeFileSync(script, [
    '@echo off',
    'set n=0',
    ':retry',
    `move /Y "${dest}" "${exe}" >nul 2>&1 && goto done`,
    'set /a n+=1',
    'if %n% geq 90 goto done',
    'timeout /t 1 /nobreak >nul',
    'goto retry',
    ':done',
    `start "" "${exe}"`,
    '(goto) 2>nul & del "%~f0"'
  ].join('\r\n'))
  spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  setTimeout(() => app.quit(), 400)
  return true
}

module.exports = { check, checkQuietly, install, cmp }
