// Multiple Bedrock versions, side by side (Windows only).
// Works the same way as MCLauncher (github.com/MCMrARM/mc-w10-version-launcher):
//  1) Download the official game package (.msixvc) for a version from Microsoft's servers.
//  2) Let Windows "stage" it — Windows can only unlock it because you own Minecraft.
//  3) Copy the unlocked game into Plunder's folder (one folder per version).
//  4) When you play, register that folder as "Minecraft" with Windows (Developer Mode) and start it.
// All versions share the same worlds/settings folder (%APPDATA%\Minecraft Bedrock), like the official launcher.
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFile, spawn } = require('child_process')
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom')
const store = require('./store')
const events = require('./events')
const { getJson, download } = require('./net')

const LIST_URL = 'https://raw.githubusercontent.com/MinecraftBedrockArchiver/GdkLinks/refs/heads/master/urls.min.json'
const FAMILY = { release: 'Microsoft.MinecraftUWP_8wekyb3d8bbwe', preview: 'Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe' }
const PKGNAME = { release: 'Microsoft.MinecraftUWP', preview: 'Microsoft.MinecraftWindowsBeta' }
const STORE_ID = { release: '9NBLGGH2JHXJ', preview: '9P5X4QVLC2XR' }
const SHIM = 'GDKLaunchShim.exe'
const HELPER = 'GDKDecryptHelper.exe'

const root = () => path.join(store.P.base, 'bedrock')
const versionsDir = () => path.join(root(), 'v')
const toolsDir = () => path.join(root(), 'tools')
const safeName = v => String(v).replace(/[^0-9A-Za-z._-]/g, '')
const dirFor = (version, kind) => path.join(versionsDir(), safeName(version) + (kind === 'preview' ? '-preview' : ''))

function needWindows () { if (process.platform !== 'win32') throw new Error('Bedrock versions only work on Windows.') }

// ---------- PowerShell helpers ----------
const PS_HEAD = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Management.Deployment.PackageManager,Windows.Management.Deployment,ContentType=WindowsRuntime] | Out-Null
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperationWithProgress\`2' })[0]
function Await-Deploy($op) {
  $t = $asTask.MakeGenericMethod([Windows.Management.Deployment.DeploymentResult], [Windows.Management.Deployment.DeploymentProgress]).Invoke($null, @($op))
  try { $t.Wait(-1) | Out-Null } catch { $ex = $_.Exception; while ($ex.InnerException) { $ex = $ex.InnerException }; throw $ex.Message }
  $t.Result
}
`

function runPs (script, { timeout = 120000 } = {}) {
  needWindows()
  const file = path.join(os.tmpdir(), `plunder-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`)
  fs.writeFileSync(file, '﻿' + script, 'utf8')
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      try { fs.rmSync(file, { force: true }) } catch {}
      const out = String(stdout || '').trim()
      if (err) return reject(new Error((String(stderr || '').trim().split(/\r?\n/).find(l => l.trim() && !/^\s*(At |\+|CategoryInfo|FullyQualifiedErrorId)/.test(l)) || err.message).replace(/^.*?: /, '')))
      resolve(out)
    })
  })
}
const psStr = s => "'" + String(s).replace(/'/g, "''") + "'"

// Runs a script as administrator (one Windows "allow changes?" prompt). Progress lines go to a log file.
function runPsElevated (script, onLog) {
  needWindows()
  const id = `${process.pid}-${Date.now()}`
  const dir = path.join(os.tmpdir(), 'plunder-elevated-' + id)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'run.ps1')
  const log = path.join(dir, 'log.txt')
  const result = path.join(dir, 'result.json')
  const wrapped = `${PS_HEAD}
function Log($m) { Add-Content -LiteralPath ${psStr(log)} -Value $m }
try {
${script}
  Set-Content -LiteralPath ${psStr(result)} -Value (ConvertTo-Json @{ ok = $true; data = $RESULT } -Depth 5)
} catch {
  Set-Content -LiteralPath ${psStr(result)} -Value (ConvertTo-Json @{ ok = $false; error = "$($_.Exception.Message)" })
}`
  fs.writeFileSync(file, '﻿' + wrapped, 'utf8')
  return new Promise((resolve, reject) => {
    const launcher = `try { Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',${psStr('"' + file + '"')} } catch { exit 5 }`
    const p = spawn('powershell.exe', ['-NoProfile', '-Command', launcher], { windowsHide: true })
    let seen = 0
    const poll = setInterval(() => {
      try {
        const lines = fs.readFileSync(log, 'utf8').split(/\r?\n/).filter(Boolean)
        for (const l of lines.slice(seen)) onLog && onLog(l)
        seen = lines.length
      } catch {}
    }, 700)
    p.on('exit', code => {
      clearInterval(poll)
      let r = null
      try { r = JSON.parse(fs.readFileSync(result, 'utf8').replace(/^﻿/, '')) } catch {}
      try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
      if (code === 5 || (!r && code !== 0)) return reject(new Error('Windows permission was declined, so the version could not be installed.'))
      if (!r) return reject(new Error('The installer stopped unexpectedly.'))
      if (!r.ok) return reject(new Error(r.error))
      resolve(r.data)
    })
  })
}

// ---------- Tools (shim + decrypt helper) ----------
function bundledTools () {
  const candidates = [path.join(process.resourcesPath || '', 'bedrock-tools'), path.join(__dirname, '..', '..', 'build', 'bedrock-tools')]
  return candidates.find(d => fs.existsSync(path.join(d, SHIM)))
}
function ensureTools () {
  const src = bundledTools()
  if (!src) throw new Error("Plunder's Bedrock helper files are missing. Re-download Plunder.")
  fs.mkdirSync(toolsDir(), { recursive: true })
  for (const f of fs.readdirSync(src)) {
    const from = path.join(src, f), to = path.join(toolsDir(), f)
    if (fs.statSync(from).isFile() && (!fs.existsSync(to) || fs.statSync(to).size !== fs.statSync(from).size)) fs.copyFileSync(from, to)
  }
  return toolsDir()
}

// ---------- Version lists ----------
async function available () {
  const cache = path.join(store.P.cache, 'bedrock-versions.json')
  let data
  try { data = await getJson(LIST_URL); store.writeJson(cache, data) } catch (e) { data = store.readJson(cache); if (!data) throw e }
  const out = []
  for (const kind of ['release', 'preview']) {
    for (const [version, urls] of Object.entries(data[kind] || {})) if (urls && urls.length) out.push({ version, kind, urls })
  }
  const num = v => v.split('.').map(n => Number(n) || 0)
  out.sort((a, b) => { const x = num(a.version), y = num(b.version); for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0 })
  return out
}

function readManifest (dir) {
  try {
    const doc = new DOMParser().parseFromString(fs.readFileSync(path.join(dir, 'AppxManifest.xml'), 'utf8'), 'text/xml')
    const id = doc.getElementsByTagName('Identity')[0]
    const app = doc.getElementsByTagName('Application')[0]
    return { name: id.getAttribute('Name'), version: id.getAttribute('Version'), appId: app ? app.getAttribute('Id') : 'Game' }
  } catch { return null }
}

function installed () {
  const base = versionsDir()
  if (!fs.existsSync(base)) return []
  const out = []
  for (const f of fs.readdirSync(base)) {
    const dir = path.join(base, f)
    const m = readManifest(dir)
    if (!m || !fs.existsSync(path.join(dir, 'Minecraft.Windows.exe'))) continue
    const kind = /beta/i.test(m.name) ? 'preview' : 'release'
    out.push({ id: f, version: f.replace(/-preview$/, ''), kind, dir, packageVersion: m.version })
  }
  return out.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))
}

// ---------- What's set up on this PC ----------
async function check () {
  if (process.platform !== 'win32') return { supported: false }
  const out = await runPs(`
$ErrorActionPreference = 'SilentlyContinue'
$dev = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModelUnlock').AllowDevelopmentWithoutDevLicense
$gs = [bool](Get-AppxPackage -Name Microsoft.GamingServices)
$mc = @()
foreach ($n in @('Microsoft.MinecraftUWP','Microsoft.MinecraftWindowsBeta')) {
  foreach ($p in (Get-AppxPackage -Name $n)) { $mc += @{ name = $p.Name; version = "$($p.Version)"; dev = [bool]$p.IsDevelopmentMode; location = "$($p.InstallLocation)" } }
}
ConvertTo-Json @{ devMode = ($dev -eq 1); gamingServices = $gs; minecraft = @($mc) } -Depth 4 -Compress
`, { timeout: 30000 })
  const r = JSON.parse(out || '{}')
  const mc = [].concat(r.minecraft || []).filter(Boolean)
  const norm = p => path.resolve(String(p || '')).toLowerCase()
  const inst = installed()
  const active = {}
  for (const p of mc) {
    const kind = /beta/i.test(p.name) ? 'preview' : 'release'
    const mine = inst.find(i => norm(i.dir) === norm(p.location))
    active[kind] = { version: p.version, dev: p.dev, plunder: mine ? mine.id : null, location: p.location }
  }
  return { supported: true, devMode: !!r.devMode, gamingServices: !!r.gamingServices, active, storeInstalled: { release: !!(active.release && !active.release.dev), preview: !!(active.preview && !active.preview.dev) }, dataDir: root() }
}

// ---------- Install a version ----------
let busy = false
const installing = new Set()
const isInstalling = id => installing.has(id)
async function install ({ version, kind = 'release' }) {
  needWindows()
  if (busy) throw new Error('Another Bedrock version is being installed. Please wait for it to finish.')
  const list = await available()
  const entry = list.find(v => v.version === version && v.kind === kind)
  if (!entry) throw new Error(`Bedrock ${version} isn't in the version list.`)
  const target = dirFor(version, kind)
  if (fs.existsSync(path.join(target, 'Minecraft.Windows.exe'))) return { id: path.basename(target), already: true }
  const st = await check()
  if (!st.devMode) throw Object.assign(new Error('Turn on Developer Mode in Windows Settings first (Plunder → Bedrock → Versions shows how).'), { code: 'NO_DEV_MODE' })
  busy = true
  installing.add(path.basename(target))
  try { await backupLocalState(kind) } catch {}
  const t = events.task(`Installing Bedrock ${version}${kind === 'preview' ? ' Preview' : ''}`)
  const pkgFile = path.join(store.P.cache, 'bedrock', path.basename(new URL(entry.urls[0]).pathname))
  try {
    // 1) Download (about 1–2 GB)
    let ok = false, lastErr
    for (const url of entry.urls) {
      try {
        await download(url, pkgFile, { onProgress: (g, n) => t.update(n ? g / n : null, `Downloading from Microsoft… ${n ? Math.round(g / 1048576) + ' / ' + Math.round(n / 1048576) + ' MB' : Math.round(g / 1048576) + ' MB'}`) })
        ok = true; break
      } catch (e) { lastErr = e }
    }
    if (!ok) throw lastErr
    // 2–4) Stage, unlock and copy (needs administrator)
    const tools = ensureTools()
    fs.mkdirSync(versionsDir(), { recursive: true })
    t.update(null, 'Waiting for Windows permission (click Yes)…')
    const family = FAMILY[kind]
    const steps = { stage: 'Unpacking with Windows (this takes a few minutes)…', unlock: 'Unlocking the game with your license…', move: 'Copying game files into Plunder…', clean: 'Cleaning up…' }
    await runPsElevated(`
$pm = New-Object Windows.Management.Deployment.PackageManager
$family = ${psStr(family)}
$target = ${psStr(target)}
$helper = ${psStr(path.join(tools, HELPER))}
Log 'stage'
# Windows can only stage one copy, so take the current one off first (worlds/settings are kept).
foreach ($p in $pm.FindPackages($family)) {
  try { Await-Deploy ($pm.RemovePackageAsync($p.Id.FullName, [Windows.Management.Deployment.RemovalOptions]::PreserveApplicationData)) | Out-Null }
  catch { Await-Deploy ($pm.RemovePackageAsync($p.Id.FullName)) | Out-Null }
}
try { Await-Deploy ($pm.StagePackageAsync([Uri]${psStr(pkgFile)}, $null)) | Out-Null }
catch { throw "Windows couldn't unpack this version. Make sure Minecraft ${kind === 'preview' ? 'Preview ' : ''}is installed from the Microsoft Store or Xbox app at least once (that installs the unlock key). Details: $($_.Exception.Message)" }
$pkgs = @($pm.FindPackages($family))
if ($pkgs.Count -ne 1) { throw "Expected one staged copy of Minecraft but found $($pkgs.Count)." }
$src = $pkgs[0].InstalledLocation.Path
$item = Get-Item -LiteralPath $src -Force
if ($item.LinkType -and $item.Target) { $src = @($item.Target)[0] }
$exe = Join-Path $src 'Minecraft.Windows.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw "Minecraft.Windows.exe wasn't found in $src" }
[xml]$mf = Get-Content -LiteralPath (Join-Path $src 'AppxManifest.xml')
$appId = @($mf.Package.Applications.Application)[0].Id
Log 'unlock'
$tmpExe = Join-Path $env:TEMP ("Minecraft.Windows_" + [guid]::NewGuid() + ".exe")
$done = $tmpExe + '.done'
$hlog = [IO.Path]::GetTempFileName()
Invoke-CommandInDesktopPackage -PackageFamilyName $family -AppId $appId -Command $helper -Args ('"{0}" "{1}" "{2}" "{3}"' -f $exe, $tmpExe, $hlog, $done)
for ($i = 0; $i -lt 900 -and -not (Test-Path -LiteralPath $done); $i++) { Start-Sleep -Milliseconds 200 }
if (-not (Test-Path -LiteralPath $tmpExe)) { throw "The game couldn't be unlocked. This usually means Minecraft isn't owned by (or installed for) this Windows user. Helper log: $(Get-Content -Raw -LiteralPath $hlog)" }
Log 'move'
if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
if ([IO.Path]::GetPathRoot($src) -eq [IO.Path]::GetPathRoot($target)) {
  [IO.Directory]::Move($src, $target)
} else {
  robocopy $src $target /E /XF Minecraft.Windows.exe /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Copying game files failed (robocopy code $LASTEXITCODE)." }
}
Remove-Item -LiteralPath (Join-Path $target 'Minecraft.Windows.exe') -Force -ErrorAction SilentlyContinue
Move-Item -LiteralPath $tmpExe -Destination (Join-Path $target 'Minecraft.Windows.exe')
# Let the logged-in user manage the files later (delete, re-register) without admin.
icacls $target /grant "*S-1-5-32-545:(OI)(CI)M" /T /C /Q | Out-Null
Log 'clean'
foreach ($p in $pm.FindPackages($family)) { try { Await-Deploy ($pm.RemovePackageAsync($p.Id.FullName, [Windows.Management.Deployment.RemovalOptions]::RemoveForAllUsers)) | Out-Null } catch {} }
$RESULT = @{ appId = $appId }
`, line => { if (steps[line]) t.update(null, steps[line]) })
    try { fs.rmSync(pkgFile, { force: true }) } catch {}
    t.done('Installed')
    events.send('bedrock-versions-changed')
    return { id: path.basename(target) }
  } catch (e) {
    t.fail(e)
    throw e
  } finally { busy = false; installing.delete(path.basename(target)) }
}

// ---------- Make a version the one Windows runs, then start it ----------
function patchManifest (dir) {
  const file = path.join(dir, 'AppxManifest.xml')
  const backup = path.join(dir, 'AppxManifest_original.xml')
  if (!fs.existsSync(backup)) fs.copyFileSync(file, backup)
  const doc = new DOMParser().parseFromString(fs.readFileSync(backup, 'utf8'), 'text/xml')
  const pkg = doc.documentElement
  // The Store's launcher helper doesn't work outside the Store, so start through the shim instead.
  const apps = doc.getElementsByTagName('Application')
  for (let i = 0; i < apps.length; i++) {
    const ex = apps[i].getAttribute('Executable')
    if (ex === 'GameLaunchHelper.exe' || ex === 'Minecraft.Windows.exe') apps[i].setAttribute('Executable', SHIM)
  }
  // Store-only install hooks can't be registered from a folder.
  for (const n of Array.from(pkg.childNodes)) if (n.nodeType === 1 && n.localName === 'Extensions') pkg.removeChild(n)
  const caps = doc.getElementsByTagName('*')
  const drop = []
  for (let i = 0; i < caps.length; i++) if (caps[i].localName === 'Capability' && caps[i].getAttribute('Name') === 'customInstallActions') drop.push(caps[i])
  for (const c of drop) c.parentNode.removeChild(c)
  fs.writeFileSync(file, new XMLSerializer().serializeToString(doc), 'utf8')
}

async function backupLocalState (kind) {
  // Very old (pre-2025) Bedrock kept worlds inside the Store package. Keep a copy before that package is removed.
  const ls = path.join(process.env.LOCALAPPDATA || '', 'Packages', FAMILY[kind], 'LocalState', 'games', 'com.mojang')
  if (!fs.existsSync(path.join(ls, 'minecraftWorlds'))) return
  const dest = path.join(store.P.backups, 'bedrock-store-data-' + new Date().toISOString().slice(0, 10))
  if (fs.existsSync(dest)) return
  await fs.promises.cp(ls, dest, { recursive: true })
}

async function activate (id) {
  needWindows()
  const v = installed().find(x => x.id === id)
  if (!v && isInstalling(id)) throw new Error(`Bedrock ${id} is still downloading — watch the progress on the right, then press Play again.`)
  if (!v) throw new Error('That Bedrock version is no longer installed. Pick another one in this installation\'s settings.')
  const m = readManifest(v.dir)
  ensureTools()
  fs.copyFileSync(path.join(toolsDir(), SHIM), path.join(v.dir, SHIM))
  patchManifest(v.dir)
  const st = await check()
  if (!st.devMode) throw Object.assign(new Error('Developer Mode is off in Windows Settings. Turn it on to play other Bedrock versions.'), { code: 'NO_DEV_MODE' })
  const cur = st.active[v.kind]
  const same = cur && path.resolve(cur.location).toLowerCase() === path.resolve(v.dir).toLowerCase()
  if (!same) {
    if (cur && !cur.dev) await backupLocalState(v.kind)
    await runPs(`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
foreach ($p in (Get-AppxPackage -Name ${psStr(m.name)})) {
  if ($p.IsDevelopmentMode) { Remove-AppxPackage -Package $p.PackageFullName -PreserveApplicationData } else { Remove-AppxPackage -Package $p.PackageFullName }
}
Add-AppxPackage -Register ${psStr(path.join(v.dir, 'AppxManifest.xml'))}
`, { timeout: 180000 }).catch(e => {
      if (/0x80073D02|in use/i.test(e.message)) throw new Error('Close Minecraft first, then press Play again.')
      if (/0x80073CFF|developer/i.test(e.message)) throw new Error('Windows refused: turn on Developer Mode in Settings → System → For developers.')
      throw new Error("Windows couldn't switch Minecraft versions: " + e.message)
    })
  }
  return { family: FAMILY[v.kind], appId: m.appId || 'Game', switched: !same }
}

async function launch (id) {
  const t = events.task('Starting Bedrock')
  try {
    t.update(null, 'Switching Minecraft version…')
    const r = await activate(id)
    t.update(null, 'Starting Minecraft…')
    spawn('explorer.exe', [`shell:AppsFolder\\${r.family}!${r.appId}`], { detached: true, stdio: 'ignore' }).unref()
    require('./bedrock').resetVersionCache && require('./bedrock').resetVersionCache()
    t.done(r.switched ? 'Switched version and started' : 'Started')
    return r
  } catch (e) { t.fail(e); throw e }
}

// Removes Plunder's copy from Windows and points you to the Store to get the official copy back.
async function restoreStore (kind = 'release') {
  needWindows()
  await runPs(`
$ProgressPreference = 'SilentlyContinue'
foreach ($p in (Get-AppxPackage -Name ${psStr(PKGNAME[kind])})) { if ($p.IsDevelopmentMode) { Remove-AppxPackage -Package $p.PackageFullName -PreserveApplicationData } }
`, { timeout: 120000 })
  require('electron').shell.openExternal(`ms-windows-store://pdp/?productid=${STORE_ID[kind]}`)
}

async function remove (id) {
  const v = installed().find(x => x.id === id)
  if (!v) return
  if (process.platform === 'win32') {
    await runPs(`
$ProgressPreference = 'SilentlyContinue'
foreach ($p in (Get-AppxPackage -Name ${psStr(PKGNAME[v.kind])})) { if ($p.IsDevelopmentMode -and ($p.InstallLocation -eq ${psStr(v.dir)})) { Remove-AppxPackage -Package $p.PackageFullName -PreserveApplicationData } }
`).catch(() => {})
  }
  await fs.promises.rm(v.dir, { recursive: true, force: true })
  events.send('bedrock-versions-changed')
}

function sizeOf (dir) {
  let total = 0
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { try { total += fs.statSync(p).size } catch {} } } }
  try { walk(dir) } catch {}
  return total
}

module.exports = { isInstalling, available, installed, check, install, launch, activate, remove, restoreStore, patchManifest, sizeOf, FAMILY }
