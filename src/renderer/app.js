/* Plunder — interface */
const bridge = window.api
const S = {
  state: null, // settings, accounts, history…
  instances: [],
  page: 'java-home',
  params: {},
  tasks: new Map(),
  logs: {},
  running: new Set(),
  collapsed: {},
  mc: null,
  bedrock: null,
  cache: {},
  hooks: {}
}

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const attr = esc
function timeAgo (t) {
  if (!t) return 'Never played'
  const s = Math.max(1, (Date.now() - t) / 1000)
  const u = [[31536000, 'year'], [2592000, 'month'], [604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']]
  for (const [n, l] of u) if (s >= n) { const v = Math.floor(s / n); return `${v} ${l}${v > 1 ? 's' : ''} ago` }
  return 'just now'
}
function fmtNum (n) {
  if (n == null) return '0'
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(n)
}
function fmtBytes (b) {
  if (!b) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++ }
  return `${b.toFixed(i ? 1 : 0)} ${u[i]}`
}
function fmtDate (t) { return new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) }
const LOADER = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' }
function versionLabel (inst) {
  if (!inst) return ''
  if (inst.edition === 'bedrock') {
    if (inst.bedrockVersion) return `Bedrock ${inst.bedrockVersion.replace(/-preview$/, ' Preview')}`
    return S.bedrock && S.bedrock.version && !S.bvActiveDev ? `Bedrock ${shortBedrock(S.bedrock.version)} (Store)` : 'Bedrock (Store version)'
  }
  return `Java ${inst.mc}${inst.loader && inst.loader !== 'vanilla' ? ' · ' + LOADER[inst.loader] : ''}`
}
function shortBedrock (v) {
  // Store versions look like 1.21.10101.0 → show 1.21.101
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!m) return v
  const patch = m[3].length > 2 ? String(Number(m[3].slice(0, -2))) : m[3]
  return `${m[1]}.${m[2]}.${patch}`
}
const instIcon = inst => inst.icon || blockIcon(inst.id, inst.edition)
const instArt = (inst, w, h) => landscape(inst.seed || inst.id, w, h)
const javaInstances = () => S.instances.filter(i => i.edition === 'java')
const bedrockInstances = () => S.instances.filter(i => i.edition === 'bedrock')
const findInst = id => S.instances.find(i => i.id === id)
function selectedInst (edition) {
  const list = edition === 'bedrock' ? bedrockInstances() : javaInstances()
  return list.find(i => i.id === (S.state.selected || {})[edition]) || list[0] || null
}
async function call (name, ...args) {
  try { return await bridge.call(name, ...args) } catch (e) { toast(e.message, 'error'); throw e }
}
const quiet = (name, ...args) => bridge.call(name, ...args).catch(() => null)
function debounce (fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) } }
const avatarUrl = acc => acc && acc.uuid ? `https://mc-heads.net/avatar/${acc.uuid}/64` : blockIcon('steve', 'java')
const activeAccount = () => (S.state.accounts || []).find(a => a.id === S.state.activeAccount)
function img (src, cls = '', fbSeed = 'x', alt = '') {
  return `<img class="${cls}" src="${attr(src || blockIcon(fbSeed, 'java'))}" data-fb="${attr(blockIcon(fbSeed, 'java'))}" alt="${attr(alt)}" loading="lazy">`
}

/* ---------- toasts ---------- */
function toast (text, kind = 'info', opts = {}) {
  const el = document.createElement('div')
  el.className = `toast ${kind}`
  const ic = { error: 'alert', warn: 'alert', ok: 'check', info: 'info' }[kind] || 'info'
  el.innerHTML = `${icon(ic)}<div class="t">${esc(text)}${opts.url ? `<div><button class="btn sm" data-url="${attr(opts.url)}">${icon('external', 'sm')} Open page</button></div>` : ''}</div><button aria-label="Dismiss">${icon('x', 'sm')}</button>`
  el.querySelector(':scope > button').onclick = () => el.remove()
  const u = el.querySelector('[data-url]')
  if (u) u.onclick = () => bridge.call('open:url', opts.url)
  $('#toasts').appendChild(el)
  setTimeout(() => el.remove(), kind === 'error' || opts.url ? 12000 : 5000)
}

/* ---------- menus + modals ---------- */
let menuEl = null
function closeMenu () { if (menuEl) { menuEl.remove(); menuEl = null } }
function showMenu (anchor, items, { align = 'right' } = {}) {
  closeMenu()
  const m = document.createElement('div')
  m.className = 'menu'
  m.innerHTML = '<div class="menu-scroll">' + items.map((it, i) => it === '-' ? '<hr>' : it.label && it.heading ? `<div class="lbl">${esc(it.label)}</div>` : `<button data-mi="${i}" class="${it.danger ? 'danger' : ''} ${it.on ? 'on' : ''}">${it.img ? `<img src="${attr(it.img)}" style="width:22px;height:22px;border-radius:5px;image-rendering:pixelated;object-fit:cover">` : icon(it.icon || 'chevRight', 'sm')}<span style="flex:1">${esc(it.label)}</span>${it.on ? icon('check', 'sm') : ''}${it.sub ? `<small class="dim">${esc(it.sub)}</small>` : ''}</button>`).join('') + '</div>'
  document.body.appendChild(m)
  const r = anchor.getBoundingClientRect()
  const mw = Math.max(m.offsetWidth, 200)
  let left = align === 'left' ? r.left : r.right - mw
  left = Math.max(8, Math.min(left, innerWidth - mw - 8))
  let top = r.bottom + 6
  if (top + m.offsetHeight > innerHeight - 8) top = Math.max(8, r.top - m.offsetHeight - 6)
  m.style.left = left + 'px'; m.style.top = top + 'px'
  m.addEventListener('click', e => {
    const b = e.target.closest('[data-mi]')
    if (!b) return
    const it = items[+b.dataset.mi]
    closeMenu()
    it.run && it.run()
  })
  menuEl = m
}
document.addEventListener('mousedown', e => { if (menuEl && !menuEl.contains(e.target)) closeMenu() })

function modal ({ title, body, foot, wide, onClose }) {
  const root = $('#modal-root')
  const bd = document.createElement('div')
  bd.className = 'backdrop'
  bd.innerHTML = `<div class="modal" style="${wide ? 'width:min(720px,calc(100vw - 40px))' : ''}"><div class="modal-head"><h2>${esc(title)}</h2><button class="btn ghost sm icon" data-close>${icon('x', 'sm')}</button></div><div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`
  const close = () => { bd.remove(); onClose && onClose() }
  bd.addEventListener('mousedown', e => { if (e.target === bd) close() })
  bd.querySelector('[data-close]').onclick = close
  root.appendChild(bd)
  return { el: bd.querySelector('.modal'), close }
}
function confirmBox (title, text, { ok = 'Confirm', danger = false } = {}) {
  return new Promise(resolve => {
    let done = false
    const m = modal({
      title,
      body: `<p class="muted" style="margin:0">${text}</p>`,
      foot: `<button class="btn ghost" data-no>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(ok)}</button>`,
      onClose: () => { if (!done) resolve(false) }
    })
    m.el.querySelector('[data-no]').onclick = () => m.close()
    m.el.querySelector('[data-yes]').onclick = () => { done = true; m.close(); resolve(true) }
  })
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (menuEl) return closeMenu()
    const b = document.querySelector('#modal-root .backdrop:last-child [data-close]')
    if (b) b.click()
  }
})
// Broken remote image → fall back to a generated block icon.
document.addEventListener('error', e => {
  const t = e.target
  if (t && t.tagName === 'IMG' && t.dataset.fb && t.src !== t.dataset.fb) t.src = t.dataset.fb
}, true)

/* ---------- navigation ---------- */
function go (page, params = {}) {
  S.page = page
  S.params = params
  if (S.hooks.timer) clearInterval(S.hooks.timer)
  S.hooks = {}
  closeMenu()
  renderAll()
  $('#main').scrollTop = 0
}
function editionOfPage () {
  if (S.page === 'instance') { const i = findInst(S.params.id); return i ? i.edition : 'java' }
  if (S.page.startsWith('bedrock')) return 'bedrock'
  if (S.page === 'settings') return S.lastEdition || 'java'
  return 'java'
}
function renderAll () {
  if (S.page !== 'settings') S.lastEdition = editionOfPage()
  renderSidebar()
  renderRight()
  renderMain()
}

/* ---------- sidebar ---------- */
function navBtn (page, ic, label) {
  const active = S.page === page
  return `<button class="nav ${active ? 'active' : ''}" data-act="go" data-page="${page}" title="${label}">${icon(ic)}<span>${label}</span></button>`
}
function instRow (inst) {
  const active = S.page === 'instance' && S.params.id === inst.id
  return `<button class="inst-row ${active ? 'active' : ''}" data-act="open-instance" data-id="${inst.id}" title="${attr(inst.name)}">
    <img src="${attr(instIcon(inst))}" alt=""><span class="t"><span class="n">${esc(inst.name)}</span><span class="v">${esc(versionLabel(inst))}</span></span>
    ${S.running.has(inst.id) ? '<span class="dot" title="Running"></span>' : ''}</button>`
}
function renderSidebar () {
  const acc = activeAccount()
  const java = javaInstances(), bed = bedrockInstances()
  $('#sidebar').innerHTML = `
  <div class="side-scroll">
    <div class="side-section ${S.collapsed.java ? 'collapsed' : ''}">
      <button class="side-head" data-act="collapse" data-k="java">${icon('java')}<span>Minecraft Java</span>${icon('chevUp', 'sm chev')}</button>
      <div class="side-body">
        ${navBtn('java-home', 'home', 'Home')}
        ${navBtn('java-instances', 'box', 'Installations')}
        ${navBtn('java-mods', 'puzzle', 'Mods')}
        ${navBtn('java-modpacks', 'layers', 'Modpacks')}
        ${navBtn('java-worlds', 'globe', 'Worlds')}
        ${navBtn('java-servers', 'server', 'Servers')}
        <div class="side-sub"><span>Java instances</span><button data-act="new-instance" data-edition="java" title="New Java instance">${icon('plus', 'sm')}</button></div>
        ${java.length ? java.map(instRow).join('') : '<div class="side-empty">No instances yet</div>'}
      </div>
    </div>
    <div class="side-section ${S.collapsed.bedrock ? 'collapsed' : ''}">
      <button class="side-head" data-act="collapse" data-k="bedrock"><img class="grass" src="${attr(blockIcon('grass-head', 'bedrock'))}" alt=""><span>Minecraft Bedrock</span>${icon('chevUp', 'sm chev')}</button>
      <div class="side-body">
        ${navBtn('bedrock-home', 'home', 'Home')}
        ${navBtn('bedrock-instances', 'box', 'Installations')}
        ${navBtn('bedrock-addons', 'puzzle', 'Add-ons')}
        ${navBtn('bedrock-worlds', 'globe', 'Worlds')}
        ${navBtn('bedrock-servers', 'server', 'Servers')}
        <div class="side-sub"><span>Bedrock installations</span><button data-act="new-instance" data-edition="bedrock" title="New Bedrock installation">${icon('plus', 'sm')}</button></div>
        ${bed.length ? bed.map(instRow).join('') : '<div class="side-empty">No installations yet</div>'}
      </div>
    </div>
  </div>
  <div class="side-foot">
    ${navBtn('skins', 'image', 'Skins & capes')}
    ${navBtn('settings', 'settings', 'Settings')}
    <button class="acct-row" data-act="acct-menu"><span class="avatar">${img(avatarUrl(acc), '', 'steve')}</span><span class="n">${acc ? esc(acc.name) : 'Sign in'}</span>${icon('chevDown', 'sm')}</button>
  </div>`
}

/* ---------- right panel ---------- */
function taskHtml (t) {
  const pct = t.progress == null ? null : Math.round(t.progress * 100)
  return `<div class="task ${t.error ? 'err' : t.done ? 'ok' : ''}"><b>${esc(t.label)}</b><small>${esc(t.error || t.detail || (t.done ? 'Done' : 'Working…'))}</small>${!t.done ? `<div class="bar ${pct == null ? 'indet' : ''}"><i style="width:${pct || 0}%"></i></div>` : ''}</div>`
}
function renderRight () {
  const acc = activeAccount()
  const ed = editionOfPage()
  const hist = (S.state.history || []).map(h => ({ h, inst: findInst(h.instanceId) })).filter(x => x.inst).slice(0, 6)
  const tasks = [...S.tasks.values()]
  $('#rightbar').innerHTML = `<div class="rightbar-inner">
    <div class="acct-card">
      <span class="avatar lg">${img(avatarUrl(acc), '', 'steve')}</span>
      <div class="t"><b>${acc ? esc(acc.name) : 'Not signed in'}</b><small>${acc ? 'Minecraft account' : 'Sign in with Microsoft'}</small></div>
      ${acc ? `<button class="kebab" data-act="acct-menu">${icon('chevDown')}</button>` : '<button class="btn primary sm" data-act="add-account">Sign in</button>'}
    </div>
    <div class="rb-title">Edition</div>
    <div class="edition-toggle">
      <button class="${ed === 'java' ? 'on' : ''}" data-act="go" data-page="java-home">${icon('java')} Java</button>
      <button class="${ed === 'bedrock' ? 'on' : ''}" data-act="go" data-page="bedrock-home">${icon('cube')} Bedrock</button>
    </div>
    ${tasks.length ? `<div class="tasks" id="tasks">${tasks.map(taskHtml).join('')}</div>` : ''}
    <div class="rb-title">Recent Play History</div>
    <div class="hist">
      ${hist.length ? hist.map(({ h, inst }) => `
        <button class="hist-item" data-act="${h.world ? 'play-world' : 'play'}" data-id="${inst.id}" data-world="${attr(h.world || '')}" title="Play again">
          <img src="${attr(h.world ? landscape('w' + inst.id + h.world, 160, 180) : instArt(inst, 160, 180))}" alt="">
          <span class="t"><b>${esc(h.world || inst.name)}</b>
            <small>${icon(inst.edition === 'bedrock' ? 'cube' : 'java', 'xs')} ${esc(versionLabel(inst))}</small>
            <small>${icon('clock', 'xs')} ${timeAgo(h.at)}</small></span>
        </button>`).join('') : '<div class="rb-empty">Games you play show up here so you can jump back in with one click.</div>'}
    </div>
  </div>`
}
let rightQueued = false
function queueRight () {
  if (rightQueued) return
  rightQueued = true
  requestAnimationFrame(() => {
    rightQueued = false
    const el = $('#tasks')
    const tasks = [...S.tasks.values()]
    if (el && tasks.length) el.innerHTML = tasks.map(taskHtml).join('')
    else renderRight()
    const hp = $('#hero-progress')
    if (hp) hp.innerHTML = heroProgress(hp.dataset.id)
  })
}

/* ---------- main ---------- */
function statusPill () {
  const ids = [...S.running]
  if (!ids.length) return '<div class="status-pill"><span class="dot"></span>No game running</div>'
  const inst = findInst(ids[0])
  return `<div class="status-pill on"><span class="dot"></span>Playing ${esc(inst ? inst.name : 'Minecraft')}${ids.length > 1 ? ` +${ids.length - 1}` : ''}<button data-act="kill" data-id="${ids[0]}">Stop</button></div>`
}
function topbar (ic, label, extra = '') {
  return `<div class="topbar"><div class="crumb">${icon(ic)}<span>${label}</span>${extra}</div>${statusPill()}</div>`
}
function renderMain () {
  const pages = {
    'java-home': pageJavaHome,
    'java-instances': () => pageInstances('java'),
    'java-mods': pageMods,
    'java-modpacks': pageModpacks,
    'java-worlds': pageJavaWorlds,
    instance: pageInstance,
    'bedrock-home': pageBedrockHome,
    'bedrock-instances': () => pageInstances('bedrock'),
    'bedrock-versions': () => pageInstances('bedrock'),
    'bedrock-addons': pageBedrockAddons,
    'bedrock-worlds': pageBedrockWorlds,
    'java-servers': () => pageServers('java'),
    skins: pageSkins,
    'bedrock-servers': () => pageServers('bedrock'),
    settings: pageSettings
  }
  ;(pages[S.page] || pageJavaHome)()
}

/* ---------- hero (shared by both homes) ---------- */
function heroProgress (id) {
  const t = [...S.tasks.values()].find(x => x.instanceId === id && !x.done)
  if (!t) return ''
  const pct = t.progress == null ? null : Math.round(t.progress * 100)
  return `<div class="row" style="justify-content:space-between;font-size:12.5px;color:var(--muted)"><span>${esc(t.detail || t.label)}</span><span>${pct == null ? '' : pct + '%'}</span></div><div class="bar ${pct == null ? 'indet' : ''}"><i style="width:${pct || 0}%"></i></div>`
}
function playButton (inst, big = true) {
  if (S.running.has(inst.id)) return `<button class="btn-play stop" data-act="kill" data-id="${inst.id}">${icon('stop', 'fill')} STOP</button>`
  const busy = [...S.tasks.values()].some(t => t.instanceId === inst.id && !t.done)
  if (busy) return '<button class="btn-play" disabled><span class="spinner"></span> STARTING</button>'
  return `<button class="btn-play" data-act="play" data-id="${inst.id}">${icon('play')} PLAY</button>`
}
function hero (inst, edition) {
  if (!inst) {
    return `<div class="hero"><img class="hero-art" src="${attr(landscape('welcome-' + edition, 632, 320))}" alt="">
      <div class="hero-body"><div class="hero-name"><div><h2>${edition === 'java' ? 'Create your first instance' : 'Create your first installation'}</h2><small>${edition === 'java' ? 'Pick a Minecraft version and (optionally) a mod loader like Fabric or Forge.' : 'Pick a version and name — Plunder sets up the rest.'}</small></div></div>
      <div class="hero-actions"><button class="btn-play" data-act="new-instance" data-edition="${edition}">${icon('plus')} NEW ${edition === 'java' ? 'INSTANCE' : 'INSTALLATION'}</button>${edition === 'java' ? `<button class="btn" style="height:50px" data-act="import-open">${icon('download', 'sm')} Import from another launcher</button>` : ''}</div></div></div>`
  }
  const sub = edition === 'java'
    ? `Minecraft Java Edition${inst.loader !== 'vanilla' ? ' · ' + LOADER[inst.loader] + ' ' + (inst.loaderVersion || '') : ''}`
    : `Minecraft Bedrock Edition · ${esc(versionLabel(inst).replace(/^Bedrock /, ''))}`
  return `<div class="hero">
    <img class="hero-art" src="${attr(instArt(inst, 632, 320))}" alt="">
    <div class="hero-body">
      <div class="hero-name"><img src="${attr(instIcon(inst))}" alt="">
        <div><h2>${esc(inst.name)} <button data-act="instance-settings" data-id="${inst.id}" title="Edit">${icon('pencil', 'sm')}</button></h2><small>${esc(sub)}</small></div></div>
      <div class="hero-actions">
        <button class="picker" data-act="pick-instance" data-edition="${edition}">${icon(edition === 'java' ? 'java' : 'cube')}<span>${esc(edition === 'java' ? versionLabel(inst) : inst.name)}</span>${icon('chevDown')}</button>
        ${playButton(inst)}
      </div>
      <div class="hero-progress" id="hero-progress" data-id="${inst.id}">${heroProgress(inst.id)}</div>
    </div>
    <button class="hero-more" data-act="inst-menu" data-id="${inst.id}" title="More">${icon('more')}</button>
  </div>`
}

/* ---------- Java home ---------- */
function pageJavaHome () {
  const inst = selectedInst('java')
  $('#main').innerHTML = `${topbar('home', 'Home')}
    <div class="hello"><h1>Ready to set sail?</h1><p>Yer next adventure be just a click away.</p></div>
    ${hero(inst, 'java')}
    <div class="section">
      <div class="section-head"><h3>${icon('clock')} Recent Worlds / Launch Profiles</h3><button class="link-btn" data-act="go" data-page="java-worlds">View all ${icon('chevRight', 'sm')}</button></div>
      <div class="grid3" id="recent-worlds">${'<div class="skeleton"></div>'.repeat(3)}</div>
    </div>
    <div class="section">
      <div class="section-head"><div><h3>${icon('map')} Discover</h3><p>Popular modpacks worth plundering — one click to install</p></div><button class="link-btn" data-act="go" data-page="java-modpacks">View all ${icon('chevRight', 'sm')}</button></div>
      <div class="grid2" id="discover">${'<div class="skeleton" style="height:106px"></div>'.repeat(2)}</div>
    </div>
    ${statsSection('java')}`
  loadRecentWorlds()
  loadDiscover()
  loadStats('java')
}
async function loadRecentWorlds () {
  const el = $('#recent-worlds')
  const worlds = (await quiet('worlds:java')) || []
  if (!el || !document.body.contains(el)) return
  S.cache.javaWorlds = worlds
  if (worlds.length) {
    el.innerHTML = worlds.slice(0, 3).map(w => `
      <div class="card world-card" role="button" data-act="play-world" data-id="${w.instanceId}" data-world="${attr(w.folder)}" title="Play this world">
        <img src="${attr(w.icon || landscape('w' + w.instanceId + w.folder, 160, 160))}" alt="">
        <div class="t"><b>${esc(w.name)}</b><small>${esc(`Java ${w.mc}${w.loader !== 'vanilla' ? ' · ' + LOADER[w.loader] : ''}`)}</small><small class="when">${icon('clock', 'xs')} ${timeAgo(w.lastPlayed)}</small></div>
        <button class="kebab" data-act="world-menu" data-id="${w.instanceId}" data-world="${attr(w.folder)}">${icon('vmore', 'sm')}</button>
      </div>`).join('')
  } else {
    const list = javaInstances().slice(0, 3)
    el.innerHTML = list.length
      ? list.map(i => `<div class="card world-card" role="button" data-act="play" data-id="${i.id}"><img src="${attr(instArt(i, 160, 160))}" alt=""><div class="t"><b>${esc(i.name)}</b><small>${esc(versionLabel(i))}</small><small class="when">${icon('clock', 'xs')} ${timeAgo(i.lastPlayed)}</small></div><button class="kebab" data-act="inst-menu" data-id="${i.id}">${icon('vmore', 'sm')}</button></div>`).join('')
      : `<div class="card" style="grid-column:1/-1"><div class="empty" style="padding:28px">${icon('globe')}<h4>No worlds yet</h4><p>Create an instance and start a world — it'll show up here.</p><button class="btn primary" data-act="new-instance" data-edition="java">${icon('plus', 'sm')} New instance</button></div></div>`
  }
}
async function loadDiscover () {
  const el = $('#discover')
  if (!S.cache.discover) {
    try { S.cache.discover = (await bridge.call('content:search', { source: 'modrinth', type: 'modpack', sort: 'downloads' })).hits } catch { S.cache.discover = null }
  }
  if (!el || !document.body.contains(el)) return
  const hits = (S.cache.discover || []).slice(0, 2)
  if (!hits.length) { el.innerHTML = '<div class="card muted" style="grid-column:1/-1;padding:20px">Couldn\'t reach Modrinth right now. Check your internet connection.</div>'; return }
  el.innerHTML = hits.map(h => `
    <button class="card disc-card" data-act="install-modpack" data-source="modrinth" data-pid="${h.id}" data-title="${attr(h.title)}" data-icon="${attr(h.icon || '')}">
      ${img(h.icon, '', h.id)}
      <span class="t"><b>${esc(h.title)}</b><small>Modpack <span class="dim">•</span> ${esc((h.categories.find(c => LOADER[c]) || 'fabric').replace(/^./, c => c.toUpperCase()))} ${esc((h.versions || []).slice(-1)[0] || '')}</small><small>${icon('download', 'xs')} ${fmtNum(h.downloads)}</small></span>
      ${icon('chevRight', 'chev')}
    </button>`).join('')
}

/* ---------- Installations ---------- */
function instCard (inst) {
  return `<div class="card inst-card">
    <div class="art" data-act="open-instance" data-id="${inst.id}"><img src="${attr(instArt(inst, 520, 220))}" alt=""><img class="ico" src="${attr(instIcon(inst))}" alt="">${S.running.has(inst.id) ? '<span class="run tag green">● Running</span>' : ''}</div>
    <div class="body">
      <b data-act="open-instance" data-id="${inst.id}">${esc(inst.name)}</b>
      <div class="meta">${inst.edition === 'java' ? `<span class="tag">${icon('java', 'xs')} ${esc(inst.mc)}</span><span class="tag purple">${LOADER[inst.loader]}</span>` : `<span class="tag">${icon('cube', 'xs')} ${esc(versionLabel(inst).replace(/^Bedrock /, ''))}</span>${inst.bedrockIsolated ? '<span class="tag purple">Own worlds</span>' : '<span class="tag">Shared worlds</span>'}${inst.bedrockVersion && S.cache.bvInstalled && !S.cache.bvInstalled.includes(inst.bedrockVersion) ? ([...S.tasks.values()].some(t => !t.done && t.label.includes(inst.bedrockVersion.replace(/-preview$/, ''))) ? '<span class="tag amber">Downloading…</span>' : '<span class="tag amber">Not downloaded</span>') : ''}`}${inst.modpack ? '<span class="tag amber">Modpack</span>' : ''}</div>
      <div class="foot"><small>${inst.lastPlayed ? 'Played ' + timeAgo(inst.lastPlayed) : 'Never played'}</small>
        <button class="btn sm primary" data-act="play" data-id="${inst.id}" ${S.running.has(inst.id) ? 'disabled' : ''}>${icon('play', 'sm')} Play</button>
        <button class="btn sm icon ghost" data-act="inst-menu" data-id="${inst.id}">${icon('vmore', 'sm')}</button></div>
    </div></div>`
}
function pageInstances (edition) {
  const list = edition === 'java' ? javaInstances() : bedrockInstances()
  if (edition === 'bedrock') return pageBedrockInstances(list)
  $('#main').innerHTML = `${topbar('box', 'Installations')}
    <div class="page-title"><div><h1>Installations</h1><p>Each instance has its own version, mods, worlds and settings — nothing gets mixed up.</p></div>
      <div class="row"><button class="btn" data-act="import-pack-file">${icon('layers', 'sm')} Import modpack file</button><button class="btn" data-act="import-open">${icon('download', 'sm')} Import from another launcher</button><button class="btn primary" data-act="new-instance" data-edition="java">${icon('plus', 'sm')} New instance</button></div></div>
    <div class="gridauto">${list.map(instCard).join('')}<button class="new-card" data-act="new-instance" data-edition="java"><div>${icon('plus', 'lg')}<span>New instance</span></div></button></div>`
}

/* ---------- Instance page ---------- */
function pageInstance () {
  const inst = findInst(S.params.id)
  if (!inst) return go('java-instances')
  const java = inst.edition === 'java'
  const tab = S.params.tab || (java ? 'content' : 'addons')
  const tabs = java
    ? [['content', 'puzzle', 'Content'], ['worlds', 'globe', 'Worlds'], ['settings', 'sliders', 'Settings'], ['log', 'terminal', 'Log']]
    : [['addons', 'puzzle', 'Add-ons'], ['settings', 'sliders', 'Settings']]
  $('#main').innerHTML = `${topbar(java ? 'box' : 'cube', `<button data-act="go" data-page="${java ? 'java-instances' : 'bedrock-instances'}">Installations</button>`, `<span class="sep">/</span><span>${esc(inst.name)}</span>`)}
    <div class="inst-head"><img src="${attr(instArt(inst, 1200, 300))}" alt=""><div class="over"></div>
      <div class="info"><img src="${attr(instIcon(inst))}" alt="">
        <div><h1>${esc(inst.name)}</h1><div class="meta">${java ? `<span class="tag">${icon('java', 'xs')} Java ${esc(inst.mc)}</span><span class="tag purple">${LOADER[inst.loader]}${inst.loaderVersion ? ' ' + esc(inst.loaderVersion) : ''}</span>` : `<span class="tag">${icon('cube', 'xs')} ${esc(versionLabel(inst))}</span>`}<span class="tag">${icon('clock', 'xs')} ${inst.lastPlayed ? timeAgo(inst.lastPlayed) : 'Never played'}</span>${inst.playTime ? `<span class="tag">${Math.round(inst.playTime / 3600000 * 10) / 10} h played</span>` : ''}</div></div>
        <div class="acts">${java ? `<button class="btn icon" data-act="quick-settings" data-id="${inst.id}" title="Quick settings">${icon('sliders', 'sm')}</button>` : ''}<button class="btn icon" data-act="open-folder" data-id="${inst.id}" title="Open folder">${icon('folder', 'sm')}</button><button class="btn icon" data-act="inst-menu" data-id="${inst.id}">${icon('more', 'sm')}</button>${playButton(inst)}</div>
      </div></div>
    <div id="hero-progress" data-id="${inst.id}" style="margin-bottom:12px">${heroProgress(inst.id)}</div>
    <div class="tabs">${tabs.map(([k, ic, l]) => `<button class="${tab === k ? 'on' : ''}" data-act="inst-tab" data-tab="${k}">${icon(ic, 'sm')} ${l}${k === 'content' || k === 'addons' ? `<span class="count" id="count-${k}">…</span>` : ''}</button>`).join('')}</div>
    <div id="tab-body"></div>`
  const fn = { content: tabContent, worlds: tabWorlds, settings: tabSettings, log: tabLog, addons: tabAddons }[tab] || (java ? tabContent : tabAddons)
  fn(inst)
}

async function tabContent (inst) {
  const body = $('#tab-body')
  const keepScroll = $('#main').scrollTop
  const keepQ = $('#content-q') ? $('#content-q').value : ''
  const keepHeight = body.offsetHeight
  body.style.minHeight = keepHeight + 'px'
  const filter = S.params.filter || 'all'
  body.innerHTML = `<div class="row wrap" style="margin-bottom:14px">
      <div class="chips">${[['all', 'All'], ['mod', 'Mods'], ['resourcepack', 'Resource packs'], ['shader', 'Shaders']].map(([k, l]) => `<button class="chip ${filter === k ? 'on' : ''}" data-act="content-filter" data-f="${k}">${l}</button>`).join('')}</div>
      <div class="spacer"></div>
      <div class="search" style="max-width:260px"><span>${icon('search', 'sm')}</span><input class="input" id="content-q" placeholder="Filter installed…" style="height:38px"></div>
      <button class="btn" data-act="add-files" data-id="${inst.id}">${icon('upload', 'sm')} Add files</button>
      <button class="btn icon" data-act="check-updates" data-id="${inst.id}" id="upd-btn" title="Check for updates">${icon('refresh', 'sm')}</button>
      <button class="btn primary" data-act="browse-for" data-id="${inst.id}">${icon('search', 'sm')} Browse content</button>
    </div>
    <div id="upd-bar"></div><div id="deps-bar"></div>
    ${inst.loader === 'vanilla' ? `<div class="notice" style="margin-bottom:14px">${icon('info')}<div>This is a <b>Vanilla</b> instance, so it can use resource packs but not mods. Create a <b>Fabric</b>, <b>Quilt</b>, <b>Forge</b> or <b>NeoForge</b> instance to use mods.</div></div>` : ''}
    <div class="card list" id="content-list"><div class="skeleton" style="height:60px;margin:10px"></div></div>
    <div class="dropzone">${icon('upload', 'sm')} Drag mod <b>.jar</b> files or pack <b>.zip</b> files anywhere onto this window to add them.</div>`
  if ($('#content-q')) $('#content-q').value = keepQ
  $('#main').scrollTop = keepScroll
  const items = (await quiet('content:list', inst.id)) || []
  const draw = () => {
    const q = ($('#content-q') ? $('#content-q').value : '').toLowerCase()
    const shown = items.filter(i => (filter === 'all' || i.type === filter) && (!q || i.title.toLowerCase().includes(q) || i.file.toLowerCase().includes(q)))
    const c = $('#count-content'); if (c) c.textContent = items.length
    const list = $('#content-list')
    if (!list) return
    if (!shown.length) {
      list.innerHTML = `<div class="empty">${icon('puzzle')}<h4>${items.length ? 'Nothing matches' : 'No content yet'}</h4><p>${items.length ? 'Try a different filter.' : 'Find mods, resource packs and shaders on Modrinth or CurseForge.'}</p>${items.length ? '' : `<button class="btn primary" data-act="browse-for" data-id="${inst.id}">${icon('search', 'sm')} Browse content</button>`}</div>`
      return
    }
    list.innerHTML = shown.map(i => `
      <div class="list-row ${i.enabled ? '' : 'off'}">
        ${i.icon ? img(i.icon, '', i.title) : `<span class="ph">${icon(i.type === 'mod' ? 'puzzle' : i.type === 'shader' ? 'sparkles' : 'image', 'sm')}</span>`}
        <div class="t"><b>${esc(i.title)}</b><small>${esc(i.file)}${i.version ? ' · ' + esc(i.version) : ''} · ${fmtBytes(i.size)}</small></div>
        ${(() => { const u = ((S.cache.updates || {})[inst.id] || {})[i.key]; const busy = S.cache.updating && S.cache.updating.has(inst.id + '|' + i.key)
          return u ? (busy ? '<button class="btn sm" disabled><span class="spinner"></span> Updating</button>' : `<button class="btn sm primary" data-act="update-one" data-id="${inst.id}" data-key="${attr(i.key)}" title="Update to ${attr(u.versionName || 'the newest version')}">${icon('download', 'sm')} Update</button>`) : '' })()}
        ${i.url ? `<a href="#" class="tag tag-link ${i.source === 'modrinth' ? 'green' : 'amber'}" data-act="open-url" data-url="${attr(i.url)}" title="Open its ${i.source === 'modrinth' ? 'Modrinth' : 'CurseForge'} page">${i.source === 'modrinth' ? 'Modrinth' : 'CurseForge'} ${icon('external', 'xs')}</a>` : `<span class="tag ${i.source === 'modrinth' ? 'green' : i.source === 'curseforge' ? 'amber' : ''}">${i.source === 'file' ? 'Local file' : i.source === 'modrinth' ? 'Modrinth' : 'CurseForge'}</span>`}
        <span class="tag">${{ mod: 'Mod', resourcepack: 'Resource pack', shader: 'Shader' }[i.type]}</span>
        <div class="acts"><button class="switch ${i.enabled ? 'on' : ''}" data-act="content-toggle" data-id="${inst.id}" data-key="${attr(i.key)}" title="${i.enabled ? 'Disable' : 'Enable'}"></button>
          <button class="btn sm icon ghost danger" data-act="content-delete" data-id="${inst.id}" data-key="${attr(i.key)}" data-title="${attr(i.title)}" title="Remove">${icon('trash', 'sm')}</button></div>
      </div>`).join('')
  }
  draw()
  const qi = $('#content-q'); if (qi) qi.oninput = draw
  S.hooks.refreshContent = () => tabContent(findInst(inst.id) || inst)
  drawUpdBar(inst)
  if (inst.loader !== 'vanilla') quiet('deps:check', inst.id).then(r => drawDeps(inst, r))
  $('#main').scrollTop = keepScroll
  body.style.minHeight = ''
}

function worldRow (w, backups) {
  const key = `${w.edition}|${w.instanceId || w.root}|${w.folder}`
  const open = S.cache.openBackups === key
  return `<div class="list-row">
      <img src="${attr(w.icon || landscape('w' + (w.instanceId || 'b') + w.folder, 120, 120))}" alt="">
      <div class="t"><b>${esc(w.name)}</b><small>${w.edition === 'java' ? esc(w.instanceName) + ' · Java ' + esc(w.mc) + ' · ' : ''}Played ${timeAgo(w.lastPlayed)}${w.playSeconds > 60 ? ' · ' + fmtDur(w.playSeconds * 1000) + ' in this world' : ''} · ${w.backups} backup${w.backups === 1 ? '' : 's'}</small></div>
      <div class="acts">
        ${w.edition === 'java' ? `<button class="btn sm primary" data-act="play-world" data-id="${w.instanceId}" data-world="${attr(w.folder)}">${icon('play', 'sm')} Play</button>` : ''}
        <button class="btn sm" data-act="backup-world" data-edition="${w.edition}" data-id="${attr(w.instanceId || '')}" data-world="${attr(w.folder)}" data-root="${attr(w.root || '')}">${icon('archive', 'sm')} Back up</button>
        <button class="btn sm ${open ? 'primary' : ''}" data-act="toggle-backups" data-key="${attr(key)}">${icon('restore', 'sm')} Backups</button>
        <button class="btn sm icon ghost" data-act="open-world" data-edition="${w.edition}" data-id="${attr(w.instanceId || '')}" data-world="${attr(w.folder)}" data-root="${attr(w.root || '')}" title="Open folder">${icon('folder', 'sm')}</button>
        ${w.edition === 'java' ? `<button class="btn sm icon ghost danger" data-act="delete-world" data-id="${w.instanceId}" data-world="${attr(w.folder)}" title="Delete world">${icon('trash', 'sm')}</button>` : ''}
      </div></div>
    ${open ? `<div class="sub-list">${backups && backups.length ? backups.map(b => `<div class="bk">${icon('archive', 'xs')}<span>${fmtDate(b.created)} · ${fmtBytes(b.size)}</span>
        <button class="btn sm" data-act="restore-backup" data-b="${attr(JSON.stringify(b))}">${icon('restore', 'sm')} Restore as copy</button>
        ${b.edition === 'bedrock' ? `<button class="btn sm ghost" data-act="import-backup" data-b="${attr(JSON.stringify(b))}">Import into Minecraft</button>` : ''}
        <button class="btn sm icon ghost" data-act="show-backup" data-b="${attr(JSON.stringify(b))}" title="Show file">${icon('folder', 'sm')}</button>
        <button class="btn sm icon ghost danger" data-act="delete-backup" data-b="${attr(JSON.stringify(b))}" title="Delete backup">${icon('trash', 'sm')}</button></div>`).join('') : '<div class="bk dim">No backups yet — click “Back up” to make one.</div>'}</div>` : ''}`
}
async function worldsList (el, edition, instanceId) {
  const worlds = edition === 'java' ? ((await quiet('worlds:java', instanceId)) || []) : ((await quiet('worlds:bedrock')) || [])
  let backups = null
  const open = S.cache.openBackups
  if (open) {
    const [ed, owner, folder] = open.split('|')
    if (ed === edition) backups = (await quiet('worlds:backups', ed, ed === 'java' ? owner : folder, folder)) || []
  }
  if (!el || !document.body.contains(el)) return
  el.innerHTML = worlds.length
    ? worlds.map(w => worldRow(w, `${w.edition}|${w.instanceId || w.root}|${w.folder}` === open ? backups : null)).join('')
    : `<div class="empty">${icon('globe')}<h4>No worlds found</h4><p>${edition === 'java' ? 'Play the game and create a world — it will appear here, ready to back up.' : "Couldn't find any Bedrock worlds yet. Play Bedrock once, or set its folder in Settings."}</p></div>`
  S.hooks.refreshWorlds = () => worldsList(el, edition, instanceId)
}
function tabWorlds (inst) {
  $('#tab-body').innerHTML = `<div class="row" style="margin-bottom:14px"><span class="muted" style="font-size:13px">Bring in a world from anywhere — it's copied, the original stays put.</span><div class="spacer"></div><button class="btn" data-act="import-world" data-id="${inst.id}" data-kind="folder">${icon('folder', 'sm')} Import world folder</button><button class="btn" data-act="import-world" data-id="${inst.id}" data-kind="zip">${icon('archive', 'sm')} Import world .zip</button><button class="btn" data-act="import-open" data-id="${inst.id}">${icon('download', 'sm')} From another launcher</button></div>
    <div class="card list" id="worlds-list"><div class="skeleton" style="height:60px;margin:10px"></div></div>`
  worldsList($('#worlds-list'), 'java', inst.id)
}
// RAM slider: goes up to all the memory this PC has.
function memoryField (val, fallbackLabel) {
  const total = S.state.totalMemMB || 16384
  const max = Math.max(1024, Math.floor(total / 256) * 256)
  val = Math.min(Math.max(512, Number(val) || 4096), max)
  return `<label class="field"><span>Memory (RAM)</span>
    <div class="row"><input type="range" id="mem" min="512" max="${max}" step="256" value="${val}">
      <input class="input" id="mem-gb" type="number" min="0.5" max="${(max / 1024).toFixed(2)}" step="0.25" value="${(val / 1024).toFixed(2).replace(/\.?0+$/, '')}" style="width:92px;height:36px"><span class="muted">GB of ${(total / 1024).toFixed(1)} GB</span></div>
    <span class="hint" id="mem-hint">${fallbackLabel || '4–6 GB suits most modpacks. Leave some memory for Windows.'}</span></label>`
}
function bindMemory () {
  const r = $('#mem'), n = $('#mem-gb'), hint = $('#mem-hint')
  if (!r || !n) return
  const total = S.state.totalMemMB || 16384
  const base = hint.textContent
  const warn = () => {
    const v = Number(r.value)
    hint.textContent = v > total * 0.75 ? `⚠ That's most of your PC's memory (${(total / 1024).toFixed(1)} GB). Windows and other apps may slow down or Minecraft may crash.` : base
    hint.style.color = v > total * 0.75 ? 'var(--amber)' : ''
  }
  r.oninput = () => { n.value = (r.value / 1024).toFixed(2).replace(/\.?0+$/, ''); warn() }
  n.oninput = () => { const mb = Math.round(Number(n.value) * 1024); if (mb >= 512) { r.value = Math.min(mb, Number(r.max)); warn() } }
  n.onchange = () => { n.value = (r.value / 1024).toFixed(2).replace(/\.?0+$/, '') }
  warn()
}
function tabSettings (inst) {
  const java = inst.edition === 'java'
  const mem = inst.memoryMax || S.state.settings.memoryMax
  $('#tab-body').innerHTML = `<div class="card settings-block"><div class="form-grid">
    <label class="field full"><span>Name</span><input class="input" id="f-name" value="${attr(inst.name)}"></label>
    ${java ? `<div class="full">${memoryField(mem)}</div>
    <label class="field"><span>Auto-join server</span><input class="input" id="f-server" placeholder="e.g. play.example.com" value="${attr(inst.server || '')}"><span class="hint">Leave empty to open the main menu.</span></label>
    <label class="field"><span>Extra Java arguments</span><input class="input" id="f-jvm" placeholder="Advanced — usually leave empty" value="${attr(inst.jvmArgs || '')}"></label>` : `<label class="field full"><span>Version</span><select class="input" id="f-bv"><option>Loading…</option></select><span class="hint">Pick any version — new ones download automatically.</span></label>
    <div class="full" id="bdata-block"></div>
    <label class="field full"><span>Notes</span><textarea class="input" id="f-notes" rows="3" placeholder="Anything you want to remember about this profile">${esc(inst.notes || '')}</textarea></label>`}
    <div class="full row"><button class="btn" data-act="pick-icon" data-id="${inst.id}">${icon('image', 'sm')} Change icon</button>${inst.icon ? `<button class="btn ghost" data-act="reset-icon" data-id="${inst.id}">Reset icon</button>` : ''}<div class="spacer"></div><button class="btn primary" data-act="save-instance" data-id="${inst.id}">${icon('check', 'sm')} Save changes</button></div>
  </div></div>
  <div class="card settings-block"><h3>${icon('trash')} Delete ${java ? 'instance' : 'installation'}</h3><p>Removes it and ${java ? 'all of its mods and worlds' : 'its saved add-on files'}. Back up worlds you want to keep first.</p><button class="btn danger" data-act="delete-instance" data-id="${inst.id}">${icon('trash', 'sm')} Delete ${esc(inst.name)}</button></div>`
  bindMemory()
  if (!java) { bedrockVersionOptions(inst.bedrockVersion).then(h => { const el = $('#f-bv'); if (el) el.innerHTML = h }); drawBdata(inst) }
}
function tabLog (inst) {
  $('#tab-body').innerHTML = `<div class="row" style="margin-bottom:10px"><span class="muted" style="font-size:13px">Live output from the game. Useful when something crashes.</span><div class="spacer"></div><button class="btn sm" data-act="explain-crash" data-id="${inst.id}">${icon('info', 'sm')} Explain last crash</button><button class="btn sm" data-act="copy-log" data-id="${inst.id}">${icon('copy', 'sm')} Copy</button><button class="btn sm" data-act="open-folder" data-id="${inst.id}" data-sub="logs">${icon('folder', 'sm')} Logs folder</button></div><pre class="log" id="log">${esc((S.logs[inst.id] || ['Nothing yet — press Play to see the game log here.']).join(''))}</pre>`
  const l = $('#log'); l.scrollTop = l.scrollHeight
}

/* ---------- Browse (shared by Mods, Modpacks, Bedrock add-ons) ---------- */
function cfKeyNotice (msg) {
  return `<div class="notice warn">${icon('key')}<div><b>${msg ? esc(msg) : 'CurseForge needs a free API key.'}</b> ${msg ? '' : 'It takes about a minute: go to Settings → CurseForge and follow the steps.'}<div class="mt" style="margin-top:10px"><button class="btn sm primary" data-act="go" data-page="settings">${icon('settings', 'sm')} Open Settings</button></div></div></div>`
}
function resultHtml (h, btn) {
  return `<div class="card result">
    ${img(h.icon, 'ico', h.id)}
    <div style="min-width:0"><h4>${esc(h.title)} <small>by ${esc(h.author || 'unknown')}</small></h4><p>${esc(h.description)}</p>
      <div class="tags">${h.categories.map(c => `<span class="tag">${esc(c)}</span>`).join('')}</div></div>
    <div class="side">
      ${h.downloads != null ? `<span class="stat">${icon('download', 'sm')}<b>${fmtNum(h.downloads)}</b> downloads</span>` : h.source === 'planetminecraft' ? '<span class="stat">Planet Minecraft</span>' : h.source === 'modbay' ? '<span class="stat">ModBay</span>' : ''}
      ${h.follows ? `<span class="stat">${icon('heart', 'sm')}<b>${fmtNum(h.follows)}</b> ${h.source === 'modrinth' ? 'followers' : 'likes'}</span>` : ''}
      ${h.updated ? `<span class="stat">${icon('clock', 'sm')} Updated ${timeAgo(new Date(h.updated).getTime())}</span>` : ''}
      <div class="btns"><button class="btn sm icon ghost" data-url="${attr(h.url)}" data-act="open-url" title="Open page">${icon('external', 'sm')}</button>${btn}</div>
    </div></div>`
}
async function runSearch ({ el, query, reset, button, extraNotice }) {
  const key = JSON.stringify(query)
  if (reset) S.cache.search = { key, hits: [], total: 0, offset: 0 }
  const st = S.cache.search
  if (!st || st.key !== key) return
  if (reset) el.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>'
  let r
  try { r = await bridge.call('content:search', { ...query, offset: st.offset }) } catch (e) {
    if (S.cache.search !== st) return
    el.innerHTML = e.code === 'NO_CF_KEY' ? cfKeyNotice() : e.code === 'CF_BAD_KEY' ? cfKeyNotice(e.message) : `<div class="notice warn">${icon('alert')}<div><b>Search failed.</b> ${esc(e.message)}</div></div>`
    return
  }
  if (S.cache.search !== st) return
  st.hits = st.hits.concat(r.hits)
  st.total = r.total
  st.offset += r.hits.length
  const draw = () => {
    el.innerHTML = (extraNotice || '') + (st.hits.length
      ? st.hits.map(h => resultHtml(h, button(h))).join('') + (st.offset < st.total ? '<div class="row" style="justify-content:center;margin-top:8px"><button class="btn" data-act="load-more">Load more</button></div>' : '')
      : `<div class="empty">${icon('search')}<h4>No results</h4><p>Try different words or another source.</p></div>`)
  }
  draw()
  st.redraw = draw
  st.more = () => runSearch({ el, query, reset: false, button, extraNotice })
}

/* ---------- Mods page ---------- */
function pageMods () {
  const java = javaInstances()
  const p = S.params
  const inst = findInst(p.instanceId) || selectedInst('java')
  p.instanceId = inst && inst.id
  p.source = p.source || 'modrinth'
  p.type = p.type || (inst && inst.loader === 'vanilla' ? 'resourcepack' : 'mod')
  p.sort = p.sort || 'relevance'
  $('#main').innerHTML = `${topbar('puzzle', 'Mods')}
    <div class="page-title"><div><h1>Mods & content</h1><p>Search Modrinth and CurseForge. Only things that work with your instance's version are shown.</p></div></div>
    ${!java.length ? `<div class="card"><div class="empty">${icon('box')}<h4>Create an instance first</h4><p>Mods are installed into an instance. Make one with a mod loader (Fabric, Quilt, Forge or NeoForge) to get started.</p><button class="btn primary" data-act="new-instance" data-edition="java">${icon('plus', 'sm')} New instance</button></div></div>` : `
    <div class="browse-bar">
      <div class="row wrap">
        <span class="muted">Install to</span>
        <button class="picker" style="height:42px;max-width:320px" data-act="mods-pick-instance"><img src="${attr(instIcon(inst))}" style="width:24px;height:24px;border-radius:5px;image-rendering:pixelated"><span>${esc(inst.name)} · ${esc(versionLabel(inst))}</span>${icon('chevDown', 'sm')}</button>
        <div class="spacer"></div>
        <div class="seg">${[['modrinth', 'Modrinth'], ['curseforge', 'CurseForge']].map(([k, l]) => `<button class="${p.source === k ? 'on' : ''}" data-act="mods-param" data-k="source" data-v="${k}">${l}</button>`).join('')}</div>
      </div>
      <div class="row wrap">
        <div class="chips">${[['mod', 'Mods'], ['resourcepack', 'Resource packs'], ['shader', 'Shaders']].map(([k, l]) => `<button class="chip ${p.type === k ? 'on' : ''}" data-act="mods-param" data-k="type" data-v="${k}">${l}</button>`).join('')}</div>
      </div>
      <div class="row">
        <div class="search">${icon('search')}<input class="input" id="q" placeholder="Search ${p.source === 'modrinth' ? 'Modrinth' : 'CurseForge'}…" value="${attr(p.q || '')}"></div>
        <select class="input" id="sort" style="width:180px;height:44px">${[['relevance', 'Relevance'], ['downloads', 'Most downloads'], ['follows', 'Most followed'], ['updated', 'Recently updated'], ['newest', 'Newest']].map(([k, l]) => `<option value="${k}" ${p.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>
    </div>
    <div class="results" id="results"></div>`}`
  if (!java.length) return
  const installedSet = () => {
    const i = findInst(p.instanceId)
    const set = new Set()
    for (const m of Object.values((i && i.content) || {})) if (m.projectId) set.add(`${m.source}:${m.projectId}`)
    return set
  }
  const button = h => {
    const k = `${h.source}:${h.id}`
    if (installedSet().has(k)) return `<button class="btn sm done" disabled>${icon('check', 'sm')} Installed</button>`
    if (S.cache.installing && S.cache.installing.has(k)) return '<button class="btn sm" disabled><span class="spinner"></span> Installing</button>'
    if (p.type === 'mod' && inst.loader === 'vanilla') return '<button class="btn sm" disabled title="Vanilla instances can\'t use mods">Needs a mod loader</button>'
    return `<button class="btn sm primary" data-act="install-content" data-source="${h.source}" data-pid="${h.id}" data-title="${attr(h.title)}" data-icon="${attr(h.icon || '')}">${icon('download', 'sm')} Install</button>`
  }
  const search = () => runSearch({
    el: $('#results'),
    reset: true,
    button,
    query: { source: p.source, type: p.type, query: p.q || '', mc: inst.mc, loader: inst.loader, sort: p.sort }
  })
  $('#q').oninput = debounce(e => { p.q = e.target.value; search() }, 350)
  $('#sort').onchange = e => { p.sort = e.target.value; search() }
  S.hooks.instancesChanged = () => S.cache.search && S.cache.search.redraw && S.cache.search.redraw()
  search()
}

/* ---------- Modpacks ---------- */
function pageModpacks () {
  const p = S.params
  p.source = p.source || 'modrinth'
  p.sort = p.sort || 'relevance'
  $('#main').innerHTML = `${topbar('layers', 'Modpacks')}
    <div class="page-title"><div><h1>Modpacks</h1><p>Installing a modpack creates a brand-new instance with everything set up.</p></div>
      <div class="seg">${[['modrinth', 'Modrinth'], ['curseforge', 'CurseForge']].map(([k, l]) => `<button class="${p.source === k ? 'on' : ''}" data-act="packs-param" data-k="source" data-v="${k}">${l}</button>`).join('')}</div></div>
    <div class="browse-bar"><div class="row">
      <div class="search">${icon('search')}<input class="input" id="q" placeholder="Search modpacks…" value="${attr(p.q || '')}"></div>
      <select class="input" id="sort" style="width:180px;height:44px">${[['relevance', 'Relevance'], ['downloads', 'Most downloads'], ['follows', 'Most followed'], ['updated', 'Recently updated'], ['newest', 'Newest']].map(([k, l]) => `<option value="${k}" ${p.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div></div>
    <div class="results" id="results"></div>`
  const notice = `<div class="notice" style="margin-bottom:4px">${icon('info')}<div>Fabric, Quilt, Forge and NeoForge modpacks all install automatically into a new instance.</div></div>`
  const button = h => S.cache.installing && S.cache.installing.has('pack:' + h.id)
    ? '<button class="btn sm" disabled><span class="spinner"></span> Installing</button>'
    : `<button class="btn sm primary" data-act="install-modpack" data-source="${h.source}" data-pid="${h.id}" data-title="${attr(h.title)}" data-icon="${attr(h.icon || '')}" data-direct="1">${icon('download', 'sm')} Install</button>`
  const search = () => runSearch({ el: $('#results'), reset: true, button, extraNotice: notice, query: { source: p.source, type: 'modpack', query: p.q || '', sort: p.sort } })
  $('#q').oninput = debounce(e => { p.q = e.target.value; search() }, 350)
  $('#sort').onchange = e => { p.sort = e.target.value; search() }
  search()
}

/* ---------- Java worlds ---------- */
function pageJavaWorlds () {
  $('#main').innerHTML = `${topbar('globe', 'Worlds')}
    <div class="page-title"><div><h1>Java worlds</h1><p>Every world from every instance. Back up before big changes — restoring always makes a copy, so nothing gets overwritten.</p></div>
      <div class="row"><button class="btn" data-act="import-world-menu">${icon('download', 'sm')} Import</button><button class="btn" data-act="open-backups">${icon('folder', 'sm')} Backups folder</button></div></div>
    <div class="card list" id="worlds-list"><div class="skeleton" style="height:60px;margin:10px"></div></div>`
  worldsList($('#worlds-list'), 'java')
}

/* ---------- Bedrock ---------- */
function bedrockNotice () {
  if (!S.bedrock) return ''
  if (S.state.platform !== 'win32') return `<div class="notice warn" style="margin-bottom:18px">${icon('info')}<div>Bedrock features need Windows with Minecraft Bedrock installed.</div></div>`
  if (!S.bedrock.version && !S.bedrock.roots.length) return `<div class="notice warn" style="margin-bottom:18px">${icon('alert')}<div><b>Minecraft Bedrock wasn't found on this PC.</b> Install it from the Microsoft Store or Xbox app, open it once, then come back. <button class="btn sm" style="margin-left:8px" data-act="open-url" data-url="https://www.minecraft.net/en-us/download">Get Minecraft</button></div></div>`
  return ''
}
function pmcCard (h) {
  return `<button class="card disc-card" data-act="web-open" data-site="planetminecraft" data-url="${attr(h.url)}">${img(h.icon, '', h.id)}<span class="t"><b>${esc(h.title)}</b><small>Planet Minecraft <span class="dim">•</span> ${esc(h.author || 'community')}</small><small>${icon('download', 'xs')} Open & download</small></span>${icon('chevRight', 'chev')}</button>`
}
function pageBedrockHome () {
  const inst = selectedInst('bedrock')
  $('#main').innerHTML = `${topbar('home', 'Home')}
    <div class="hello"><h1>Ready to set sail?</h1><p>Each installation has its own version, like Java.</p></div>
    ${bedrockNotice()}
    ${hero(inst, 'bedrock')}
    <div class="section">
      <div class="section-head"><h3>${icon('clock')} Recent Worlds</h3><button class="link-btn" data-act="go" data-page="bedrock-worlds">View all ${icon('chevRight', 'sm')}</button></div>
      <div class="grid3" id="recent-worlds">${'<div class="skeleton"></div>'.repeat(3)}</div>
    </div>
    <div class="section">
      <div class="section-head"><div><h3>${icon('map')} Discover</h3><p>Fresh Bedrock add-ons from Planet Minecraft</p></div><button class="link-btn" data-act="go" data-page="bedrock-addons">View all ${icon('chevRight', 'sm')}</button></div>
      <div class="grid2" id="discover">${'<div class="skeleton" style="height:106px"></div>'.repeat(2)}</div>
    </div>
    ${statsSection('bedrock')}`
  loadStats('bedrock')
  ;(async () => {
    const el = $('#recent-worlds')
    const worlds = (await quiet('worlds:bedrock')) || []
    if (!el || !document.body.contains(el)) return
    el.innerHTML = worlds.length ? worlds.slice(0, 3).map(w => `
      <div class="card world-card" role="button" data-act="play" data-id="${inst ? inst.id : ''}" title="Open Minecraft">
        <img src="${attr(w.icon || landscape('bw' + w.folder, 160, 160))}" alt="">
        <div class="t"><b>${esc(w.name)}</b><small>${icon('cube', 'xs')} ${esc(versionLabel({ edition: 'bedrock' }))}</small><small class="when">${icon('clock', 'xs')} ${timeAgo(w.lastPlayed)}</small></div>
        <button class="kebab" data-act="bworld-menu" data-world="${attr(w.folder)}" data-root="${attr(w.root)}">${icon('vmore', 'sm')}</button></div>`).join('')
      : `<div class="card" style="grid-column:1/-1"><div class="empty" style="padding:28px">${icon('globe')}<h4>No Bedrock worlds found</h4><p>Once you've played Bedrock on this PC, your worlds show up here.</p></div></div>`
  })()
  ;(async () => {
    const el = $('#discover')
    let hits = S.cache.bdiscover
    if (!hits) { try { hits = (await bridge.call('web:search', { site: 'planetminecraft', cat: 'addons' })).hits; if (hits.length) S.cache.bdiscover = hits } catch { hits = [] } }
    if (!el || !document.body.contains(el)) return
    el.innerHTML = hits.length ? hits.slice(0, 2).map(pmcCard).join('')
      : `<div class="card" style="grid-column:1/-1;padding:18px"><div class="row"><span class="muted">Couldn't load Planet Minecraft in the background.</span><div class="spacer"></div><button class="btn primary sm" data-act="web-open" data-site="planetminecraft" data-url="">${icon('external', 'sm')} Browse Planet Minecraft</button></div></div>`
  })()
}

function bedrockProfilePicker (inst, act) {
  return `<span class="muted">Profile</span><button class="picker" style="height:42px;max-width:300px" data-act="${act}"><img src="${attr(instIcon(inst))}" style="width:24px;height:24px;border-radius:5px;image-rendering:pixelated"><span>${esc(inst.name)}</span>${icon('chevDown', 'sm')}</button>`
}
const PMC_CATS = [['addons', 'Add-ons'], ['textures', 'Texture packs'], ['maps', 'Maps']]
function pageBedrockAddons () {
  const inst = selectedInst('bedrock')
  const p = S.params
  p.tab = p.tab || 'browse'
  p.source = p.source || 'planetminecraft'
  p.cat = p.cat || 'addons'
  if (!inst) { $('#main').innerHTML = topbar('puzzle', 'Add-ons') + '<div class="skeleton"></div>'; return }
  $('#main').innerHTML = `${topbar('puzzle', 'Add-ons')}
    <div class="page-title"><div><h1>Bedrock add-ons</h1><p>Find add-ons, texture packs and maps on Planet Minecraft, ModBay or CurseForge. Downloads are installed straight into Minecraft and kept in your profile.</p></div></div>
    ${bedrockNotice()}
    <div class="row wrap" style="margin-bottom:16px">${bedrockProfilePicker(inst, 'bedrock-pick')}<div class="spacer"></div><button class="btn" data-act="add-files" data-id="${inst.id}">${icon('upload', 'sm')} Add files</button><button class="btn" data-act="web-open" data-site="${p.source === 'modbay' ? 'modbay' : 'planetminecraft'}" data-url="">${icon('external', 'sm')} Add-on browser</button></div>
    <div class="tabs">${[['browse', 'search', 'Find add-ons'], ['installed', 'cube', `Installed <span class="count" id="inst-count">${S.cache.gamePacks ? S.cache.gamePacks.length + (inst.addons || []).length : '…'}</span>`]].map(([k, ic, l]) => `<button class="${p.tab === k ? 'on' : ''}" data-act="baddons-tab" data-tab="${k}">${icon(ic, 'sm')} ${l}</button>`).join('')}</div>
    <div id="tab-body"></div>`
  if (p.tab === 'browse') {
    const web = p.source === 'planetminecraft' || p.source === 'modbay'
    const SITE_NAMES = { planetminecraft: 'Planet Minecraft', modbay: 'ModBay', curseforge: 'CurseForge' }
    const sorts = p.source === 'modbay' ? [] : web ? [['', 'Newest first'], ['popular', 'Popular'], ['downloads', 'Most downloads'], ['updated', 'Recently updated']] : [['relevance', 'Popular'], ['downloads', 'Most downloads'], ['updated', 'Recently updated'], ['newest', 'Newest']]
    $('#tab-body').innerHTML = `<div class="browse-bar">
      <div class="row wrap">${web ? `<div class="chips">${PMC_CATS.map(([k, l]) => `<button class="chip ${p.cat === k ? 'on' : ''}" data-act="baddons-param" data-k="cat" data-v="${k}">${l}</button>`).join('')}</div>` : ''}<div class="spacer"></div>
        <div class="seg">${[['planetminecraft', 'Planet Minecraft'], ['modbay', 'ModBay'], ['curseforge', 'CurseForge']].map(([k, l]) => `<button class="${p.source === k ? 'on' : ''}" data-act="baddons-param" data-k="source" data-v="${k}">${l}</button>`).join('')}</div></div>
      <div class="row"><div class="search">${icon('search')}<input class="input" id="q" placeholder="Search ${SITE_NAMES[p.source]}…" value="${attr(p.q || '')}"></div>
      ${sorts.length ? `<select class="input" id="sort" style="width:190px;height:44px">${sorts.map(([k, l]) => `<option value="${k}" ${(p.sort || '') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ''}</div></div>
      <div class="results" id="results"></div>`
    if (web) {
      const search = () => runWeb($('#results'), p.source, { cat: p.cat, query: p.q || '', sort: p.sort || '' }, inst)
      $('#q').oninput = debounce(e => { p.q = e.target.value; search() }, 600)
      if ($('#sort')) $('#sort').onchange = e => { p.sort = e.target.value; search() }
      search()
    } else {
      const has = h => (findInst(inst.id).addons || []).some(a => a.projectId === h.id)
      const button = h => S.cache.installing && S.cache.installing.has('cf:' + h.id) ? '<button class="btn sm" disabled><span class="spinner"></span> Getting</button>'
        : `<button class="btn sm ${has(h) ? '' : 'primary'}" data-act="install-content" data-source="curseforge" data-pid="${h.id}" data-title="${attr(h.title)}" data-icon="${attr(h.icon || '')}" data-bedrock="1">${icon('download', 'sm')} ${has(h) ? 'Get again' : 'Get'}</button>`
      const search = () => runSearch({ el: $('#results'), reset: true, button, query: { edition: 'bedrock', source: 'curseforge', query: p.q || '', sort: p.sort || 'relevance' } })
      $('#q').oninput = debounce(e => { p.q = e.target.value; search() }, 350)
      $('#sort').onchange = e => { p.sort = e.target.value; search() }
      S.hooks.instancesChanged = () => S.cache.search && S.cache.search.redraw && S.cache.search.redraw()
      search()
    }
  } else {
    $('#tab-body').innerHTML = addonSectionsHtml(inst)
    loadGamePacks($('#game-packs'), $('#gp-count')).then(() => { const c = $('#inst-count'); if (c && S.cache.gamePacks) c.textContent = S.cache.gamePacks.length + (inst.addons || []).length })
  }
}
// Planet Minecraft / ModBay results (read from the site in the background).
async function runWeb (el, siteId, q, inst) {
  const token = S.cache.webToken = Math.random()
  const name = siteId === 'modbay' ? 'ModBay' : 'Planet Minecraft'
  let page = 1
  let hits = []
  const btn = h => siteId === 'modbay'
    ? (S.cache.installing && S.cache.installing.has('web:' + h.url) ? '<button class="btn sm" disabled><span class="spinner"></span> Getting</button>' : `<button class="btn sm primary" data-act="web-get" data-url="${attr(h.url)}" data-title="${attr(h.title)}">${icon('download', 'sm')} Get</button>`)
    : `<button class="btn sm primary" data-act="web-open" data-site="${siteId}" data-url="${attr(h.url)}">${icon('download', 'sm')} Open & download</button>`
  const help = siteId === 'modbay'
    ? `<div class="notice" style="margin-bottom:4px">${icon('info')}<div><b>Get</b> downloads the add-on straight into <b>${esc(inst.name)}</b> and installs it into Minecraft. If a page has several files, Plunder opens it so you can pick one.</div></div>`
    : `<div class="notice" style="margin-bottom:4px">${icon('info')}<div>Planet Minecraft has no download button for apps, so <b>Open & download</b> shows the page in Plunder's built-in browser. Click the download button there — Plunder installs it into Minecraft and keeps a copy in <b>${esc(inst.name)}</b>.</div></div>`
  const draw = more => {
    el.innerHTML = help + (hits.length
      ? hits.map(h => resultHtml(h, btn(h))).join('') + (more ? '<div class="row" style="justify-content:center;margin-top:8px"><button class="btn" data-act="web-more">Load more</button></div>' : '')
      : `<div class="card"><div class="empty">${icon('map')}<h4>Nothing found here</h4><p>${name} didn't return results in the background. You can still browse it directly.</p><button class="btn primary" data-act="web-open" data-site="${siteId}" data-url="">${icon('external', 'sm')} Browse ${name}</button></div></div>`)
  }
  S.cache.webRedraw = () => draw(false)
  const load = async () => {
    try {
      const r = await bridge.call('web:search', { ...q, site: siteId, page })
      if (S.cache.webToken !== token) return
      hits = hits.concat(r.hits.filter(h => !hits.some(x => x.url === h.url)))
      S.cache.webRedraw = () => draw(r.hasMore && r.hits.length)
      draw(r.hasMore && r.hits.length)
    } catch (e) {
      if (S.cache.webToken !== token) return
      el.innerHTML = `<div class="notice warn">${icon('alert')}<div><b>Couldn't reach ${name}.</b> ${esc(e.message)} <button class="btn sm" style="margin-left:8px" data-act="web-open" data-site="${siteId}" data-url="">Open in browser</button></div></div>`
    }
  }
  el.innerHTML = help + '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>'
  S.cache.webMore = () => { page++; const b = el.querySelector('[data-act="web-more"]'); if (b) { b.disabled = true; b.innerHTML = '<span class="spinner"></span>' } load() }
  await load()
}
// Add-ons installed in Minecraft itself (read from the game's folders).
function gamePacksHtml (packs) {
  if (!packs) return '<div class="skeleton" style="height:60px;margin:10px"></div>'
  if (!packs.length) {
    return `<div class="empty" style="padding:28px">${icon('cube')}<h4>No add-ons found in Minecraft</h4><p>${S.bedrock && !S.bedrock.roots.length ? "Plunder couldn't find Bedrock's data folder. Open Minecraft Bedrock once, or set the folder in Settings → Bedrock." : 'Add-ons you import into Minecraft show up here.'}</p></div>`
  }
  return packs.map(pk => `<div class="list-row">${pk.icon ? `<img src="${attr(pk.icon)}" alt="">` : `<span class="ph">${icon('puzzle', 'sm')}</span>`}
    <div class="t"><b>${esc(pk.name)}</b><small>${pk.worlds.length ? `${icon('globe', 'xs')} Used in ${pk.worlds.slice(0, 3).map(esc).join(', ')}${pk.worlds.length > 3 ? ` +${pk.worlds.length - 3} more` : ''}` : 'Installed, not turned on in any world yet'}${pk.description ? ' · ' + esc(pk.description) : ''}</small></div>
    ${pk.worlds.length ? '<span class="tag green">Active</span>' : ''}${pk.dev ? '<span class="tag amber">Development</span>' : ''}${pk.embedded ? '<span class="tag">Inside world</span>' : ''}
    <span class="tag purple">${esc(pk.kind)}</span>${pk.version ? `<span class="tag">v${esc(pk.version)}</span>` : ''}</div>`).join('')
}
async function loadGamePacks (el, countEl) {
  if (S.cache.gamePacks) { el.innerHTML = gamePacksHtml(S.cache.gamePacks); if (countEl) countEl.textContent = S.cache.gamePacks.length }
  const packs = (await quiet('bedrock:packs')) || []
  S.cache.gamePacks = packs
  if (!document.body.contains(el)) return
  el.innerHTML = gamePacksHtml(packs)
  if (countEl) countEl.textContent = packs.length
}
function addonSectionsHtml (inst) {
  return `<div class="section-head" style="margin-top:4px"><div><h3>${icon('cube')} Installed in Minecraft <span class="count" id="gp-count">…</span></h3><p>Every add-on and pack Minecraft Bedrock has on this PC — Bedrock shares these across all profiles.</p></div><button class="btn sm" data-act="refresh-packs">${icon('refresh', 'sm')} Refresh</button></div>
    <div class="card list" id="game-packs">${gamePacksHtml(S.cache.gamePacks)}</div>
    <div class="section-head mt-l"><div><h3>${icon('download')} Saved by Plunder <span class="count">${(inst.addons || []).length}</span></h3><p>Files you got through Plunder, kept here so you can re-import them any time.</p></div></div>
    ${addonListHtml(inst, true)}`
}
function addonListHtml (inst, compact) {
  const list = inst.addons || []
  const src = { planetminecraft: 'Planet Minecraft', modbay: 'ModBay', curseforge: 'CurseForge', file: 'Local file' }
  return `<div class="card list">${list.length ? list.map(a => `<div class="list-row">${a.icon ? img(a.icon, '', a.file) : `<span class="ph">${icon('puzzle', 'sm')}</span>`}<div class="t"><b>${esc(a.title || a.file)}</b><small>${esc(a.file)} · added ${timeAgo(a.added)}</small></div>
      <span class="tag ${a.source === 'curseforge' ? 'amber' : a.source === 'planetminecraft' || a.source === 'modbay' ? 'green' : ''}">${src[a.source] || 'File'}</span>
      <div class="acts"><button class="btn sm primary" data-act="import-addon" data-id="${inst.id}" data-file="${attr(a.file)}">${icon('upload', 'sm')} Install into Minecraft</button><button class="btn sm icon ghost danger" data-act="remove-addon" data-id="${inst.id}" data-file="${attr(a.file)}">${icon('trash', 'sm')}</button></div></div>`).join('')
    : `<div class="empty" style="padding:${compact ? '22px' : '40px'}">${icon('puzzle')}<h4>Nothing saved through Plunder yet</h4><p>Find add-ons on Planet Minecraft, ModBay or CurseForge, or drop .mcpack / .mcaddon files onto the window.</p></div>`}</div>
    <div class="dropzone">${icon('upload', 'sm')} Drop <b>.mcpack</b>, <b>.mcaddon</b> or <b>.mcworld</b> files anywhere to save them here.</div>`
}
function tabAddons (inst) {
  const c = $('#count-addons'); if (c) c.textContent = (inst.addons || []).length
  $('#tab-body').innerHTML = `<div class="row" style="margin-bottom:14px"><div class="spacer"></div><button class="btn" data-act="add-files" data-id="${inst.id}">${icon('upload', 'sm')} Add files</button><button class="btn primary" data-act="browse-bedrock" data-id="${inst.id}">${icon('search', 'sm')} Find add-ons</button></div>` + addonSectionsHtml(inst)
  loadGamePacks($('#game-packs'), $('#gp-count')).then(() => { const c = $('#count-addons'); if (c && S.cache.gamePacks) c.textContent = S.cache.gamePacks.length + (inst.addons || []).length })
}
function pageBedrockWorlds () {
  $('#main').innerHTML = `${topbar('globe', 'Worlds')}
    <div class="page-title"><div><h1>Bedrock worlds</h1><p>Backups are saved as .mcworld files — you can restore them here or import them into Minecraft on any device.</p></div>
      <div class="row"><button class="btn" data-act="bedrock-import-world">${icon('download', 'sm')} Import world</button><button class="btn" data-act="open-backups">${icon('archive', 'sm')} Backups folder</button><button class="btn" data-act="open-bedrock-data">${icon('folder', 'sm')} Game folder</button></div></div>
    ${bedrockNotice()}
    <div class="card list" id="worlds-list"><div class="skeleton" style="height:60px;margin:10px"></div></div>`
  worldsList($('#worlds-list'), 'bedrock')
}

/* ---------- Playtime stats ---------- */
function fmtDur (ms) {
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m} min`
  const h = m / 60
  return h < 10 ? `${h.toFixed(1).replace(/\.0$/, '')} h` : `${Math.round(h)} h`
}
function statsSection (edition) {
  return `<div class="section"><div class="section-head"><div><h3>${icon('signal')} Your stats</h3><p>Time spent playing ${edition === 'java' ? 'Java' : 'Bedrock'} in Plunder</p></div></div><div id="stats-box"><div class="skeleton" style="height:120px"></div></div></div>`
}
async function loadStats (edition) {
  const el = $('#stats-box'); if (!el) return
  const r = (await quiet('stats:get')) || { sessions: [] }
  if (!document.body.contains(el)) return
  const list = (edition === 'java' ? javaInstances() : bedrockInstances())
  const ids = new Set(list.map(i => i.id))
  const sess = r.sessions.filter(s => ids.has(s.instanceId))
  const total = list.reduce((a, i) => a + (i.playTime || 0), 0)
  const weekAgo = Date.now() - 7 * 864e5
  const week = sess.filter(s => s.start >= weekAgo).reduce((a, s) => a + s.ms, 0)
  const longest = sess.reduce((a, s) => Math.max(a, s.ms), 0)
  const top = [...list].filter(i => i.playTime).sort((a, b) => b.playTime - a.playTime).slice(0, 4)
  const max = top[0] ? top[0].playTime : 1
  // Last 7 days, one bar per day
  const days = Array.from({ length: 7 }, (_, k) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (6 - k)); return d })
  const perDay = days.map(d => sess.filter(s => s.start >= d.getTime() && s.start < d.getTime() + 864e5).reduce((a, s) => a + s.ms, 0))
  const dayMax = Math.max(...perDay, 1)
  el.innerHTML = `<div class="stats-grid">
    <div class="card stat-tile"><small>Total played</small><b>${fmtDur(total)}</b></div>
    <div class="card stat-tile"><small>This week</small><b>${fmtDur(week)}</b></div>
    <div class="card stat-tile"><small>Sessions</small><b>${sess.length}</b></div>
    <div class="card stat-tile"><small>Longest session</small><b>${longest ? fmtDur(longest) : '—'}</b></div>
  </div>
  <div class="grid2" style="margin-top:14px">
    <div class="card" style="padding:16px"><div class="muted" style="font-size:13px;margin-bottom:12px">Most played</div>${top.length ? top.map(i => `<div class="stat-bar"><span>${esc(i.name)}</span><div class="bar"><i style="width:${Math.max(4, Math.round(i.playTime / max * 100))}%"></i></div><small>${fmtDur(i.playTime)}</small></div>`).join('') : '<span class="dim" style="font-size:13px">Play something and it shows up here.</span>'}</div>
    <div class="card" style="padding:16px"><div class="muted" style="font-size:13px;margin-bottom:12px">Last 7 days</div><div class="week-bars">${perDay.map((v, k) => `<div title="${fmtDur(v)}"><i style="height:${v ? Math.max(6, Math.round(v / dayMax * 100)) : 2}%"></i><small>${days[k].toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2)}</small></div>`).join('')}</div></div>
  </div>`
}

/* ---------- Quick settings ---------- */
function quickSettings (id) {
  const inst = findInst(id); if (!inst) return
  const sizes = [['', 'Default (854 × 480)'], ['1280x720', '1280 × 720'], ['1600x900', '1600 × 900'], ['1920x1080', '1920 × 1080'], ['2560x1440', '2560 × 1440']]
  const cur = inst.width ? `${inst.width}x${inst.height}` : ''
  const saved = ((S.cache.servers || []).filter(s => s.edition === 'java'))
  const m = modal({
    title: `Quick settings · ${inst.name}`,
    body: `<div class="setting" style="border-top:0;padding-top:0"><div class="t"><b>Start in fullscreen</b><small>Opens the game fullscreen.</small></div><button class="switch ${inst.fullscreen ? 'on' : ''}" id="qs-fs"></button></div>
      <label class="field"><span>Window size</span><select class="input" id="qs-size">${sizes.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('')}${cur && !sizes.some(x => x[0] === cur) ? `<option value="${cur}" selected>${cur.replace('x', ' × ')}</option>` : ''}</select></label>
      <label class="field"><span>Join a server when the game starts</span><input class="input" id="qs-srv" list="qs-srv-list" placeholder="Leave empty for the main menu" value="${attr(inst.server || '')}"><datalist id="qs-srv-list">${saved.map(s => `<option value="${attr(s.port === 25565 ? s.host : s.host + ':' + s.port)}">${esc(s.name)}</option>`).join('')}</datalist></label>
      ${memoryField(inst.memoryMax || S.state.settings.memoryMax)}`,
    foot: '<button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok>' + icon('check', 'sm') + ' Save</button>'
  })
  bindMemory()
  const fs = m.el.querySelector('#qs-fs')
  fs.onclick = () => fs.classList.toggle('on')
  m.el.querySelector('[data-x]').onclick = m.close
  m.el.querySelector('[data-ok]').onclick = async () => {
    const [w, h] = (m.el.querySelector('#qs-size').value || '').split('x').map(Number)
    await call('instances:update', id, { fullscreen: fs.classList.contains('on'), width: w || null, height: h || null, server: m.el.querySelector('#qs-srv').value.trim(), memoryMax: Number($('#mem').value) })
    m.close(); await refresh(); toast('Saved', 'ok'); renderMain()
  }
  if (!S.cache.servers) quiet('servers:list').then(l => { S.cache.servers = l || [] })
}

/* ---------- Skins & capes ---------- */
// Draws a flat front (or back) view of a Minecraft skin.
function drawSkin (canvas, src, slim, back) {
  const img = new Image()
  img.onload = () => {
    const S2 = 8, g = canvas.getContext('2d')
    canvas.width = 16 * S2; canvas.height = 32 * S2
    g.imageSmoothingEnabled = false
    g.clearRect(0, 0, canvas.width, canvas.height)
    const legacy = img.height === 32
    const aw = slim ? 3 : 4
    const part = (sx, sy, w, h, dx, dy, flip) => {
      g.save()
      if (flip) { g.translate((dx + w) * S2, dy * S2); g.scale(-1, 1); g.drawImage(img, sx, sy, w, h, 0, 0, w * S2, h * S2) } else g.drawImage(img, sx, sy, w, h, dx * S2, dy * S2, w * S2, h * S2)
      g.restore()
    }
    const f = back ? 1 : 0 // back faces sit further right on the skin sheet
    // head, body
    part(8 + f * 16, 8, 8, 8, 4, 0); part(40 + f * 16, 8, 8, 8, 4, 0)
    part(20 + f * 12, 20, 8, 12, 4, 8); if (!legacy) part(20 + f * 12, 36, 8, 12, 4, 8)
    // arms (viewer's left = player's right on front)
    const rx = back ? 12 : 0, lx = back ? 0 : 12
    part(44 + (back ? aw + 4 : 0), 20, aw, 12, rx + (4 - aw), 8); if (!legacy) part(44 + (back ? aw + 4 : 0), 36, aw, 12, rx + (4 - aw), 8)
    if (legacy) part(44 + (back ? aw + 4 : 0), 20, aw, 12, lx, 8, true)
    else { part(36 + (back ? aw + 4 : 0), 52, aw, 12, lx, 8); part(52 + (back ? aw + 4 : 0), 52, aw, 12, lx, 8) }
    // legs
    const rl = back ? 8 : 4, ll = back ? 4 : 8
    part(4 + f * 8, 20, 4, 12, rl, 20); if (!legacy) part(4 + f * 8, 36, 4, 12, rl, 20)
    if (legacy) part(4 + f * 8, 20, 4, 12, ll, 20, true)
    else { part(20 + f * 8, 52, 4, 12, ll, 20); part(4 + f * 8, 52, 4, 12, ll, 20) }
  }
  img.src = src
}
function drawCape (canvas, url) {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => { const g = canvas.getContext('2d'); const k = img.width / 64; canvas.width = 50; canvas.height = 80; g.imageSmoothingEnabled = false; g.drawImage(img, 1 * k, 1 * k, 10 * k, 16 * k, 0, 0, 50, 80) }
  img.src = url
}
async function pageSkins () {
  const acc = activeAccount()
  $('#main').innerHTML = `${topbar('user', 'Skins & capes')}
    <div class="page-title"><div><h1>Skins & capes</h1><p>Keep a library of skins and switch with one click. Changes show in-game for Java and Bedrock.</p></div>
      <div class="row"><button class="btn" data-act="skin-add" data-v="classic">${icon('upload', 'sm')} Add skin…</button></div></div>
    ${!acc ? `<div class="notice warn">${icon('user')}<div>Sign in with your Microsoft account to see and change your skin. <button class="btn sm primary" style="margin-left:8px" data-act="add-account">Sign in</button></div></div>` : ''}
    <div class="skin-top">
      <div class="card skin-now"><div class="muted" style="font-size:13px">Wearing now</div><div class="skin-pair"><canvas id="sk-front"></canvas><canvas id="sk-back"></canvas></div><b id="sk-name">${acc ? esc(acc.name) : ''}</b><small class="muted" id="sk-variant"></small>
        <div class="row" style="justify-content:center;margin-top:10px"><button class="btn sm" data-act="skin-save-current" ${acc ? '' : 'disabled'}>${icon('download', 'sm')} Save to library</button></div></div>
      <div class="card" style="padding:18px;flex:1;min-width:0"><div class="muted" style="font-size:13px;margin-bottom:12px">Capes</div><div class="cape-row" id="capes"><span class="dim" style="font-size:13px">${acc ? 'Loading…' : 'Sign in to see your capes.'}</span></div></div>
    </div>
    <div class="section-head mt-l"><h3>${icon('image')} Your skin library</h3></div>
    <div class="skin-grid" id="skin-lib"></div>
    <div class="dropzone">${icon('upload', 'sm')} Tip: drag skin PNG files onto this page to add them.</div>`
  const drawLib = async () => {
    const lib = (await quiet('skins:list')) || []
    const el = $('#skin-lib'); if (!el) return
    el.innerHTML = lib.length ? lib.map(s => `<div class="card skin-card"><canvas data-skin="${attr(s.id)}"></canvas><input class="input skin-name" data-act-input="skin-rename" data-id="${attr(s.id)}" value="${attr(s.name)}">
      <div class="seg" style="width:100%"><button class="${s.variant === 'classic' ? 'on' : ''}" data-act="skin-variant" data-id="${attr(s.id)}" data-v="classic">Wide arms</button><button class="${s.variant === 'slim' ? 'on' : ''}" data-act="skin-variant" data-id="${attr(s.id)}" data-v="slim">Slim arms</button></div>
      <div class="row" style="width:100%"><button class="btn sm primary" style="flex:1;justify-content:center" data-act="skin-wear" data-id="${attr(s.id)}" ${acc ? '' : 'disabled'}>Wear</button><button class="btn sm icon ghost danger" data-act="skin-remove" data-id="${attr(s.id)}">${icon('trash', 'sm')}</button></div></div>`).join('')
      : `<div class="card" style="grid-column:1/-1"><div class="empty" style="padding:26px">${icon('image')}<h4>No saved skins yet</h4><p>Add a skin PNG, or save the one you're wearing.</p></div></div>`
    for (const c of el.querySelectorAll('canvas[data-skin]')) { const s = lib.find(x => x.id === c.dataset.skin); drawSkin(c, s.image, s.variant === 'slim') }
    for (const i of el.querySelectorAll('[data-act-input="skin-rename"]')) i.onchange = () => quiet('skins:update', i.dataset.id, { name: i.value })
  }
  S.hooks.skinLib = drawLib
  drawLib()
  if (!acc) return
  const drawProfile = p => {
    if (!p || S.page !== 'skins') return
    if (p.skin && p.skin.image) { drawSkin($('#sk-front'), p.skin.image, p.skin.variant === 'slim'); drawSkin($('#sk-back'), p.skin.image, p.skin.variant === 'slim', true) }
    $('#sk-variant').textContent = p.skin ? (p.skin.variant === 'slim' ? 'Slim arms' : 'Wide arms') : 'Default skin'
    $('#capes').innerHTML = `<button class="cape ${p.capes.some(c => c.active) ? '' : 'on'}" data-act="skin-cape" data-id=""><span class="cape-none">${icon('x')}</span><small>No cape</small></button>` +
      p.capes.map(c => `<button class="cape ${c.active ? 'on' : ''}" data-act="skin-cape" data-id="${attr(c.id)}"><canvas data-cape="${attr(c.url)}"></canvas><small>${esc(c.alias || 'Cape')}</small></button>`).join('') +
      (p.capes.length ? '' : '<span class="dim" style="font-size:13px;align-self:center;margin-left:8px">You don\'t own any capes yet (they come from events and Minecraft purchases).</span>')
    for (const c of document.querySelectorAll('canvas[data-cape]')) drawCape(c, c.dataset.cape.replace(/^http:/, 'https:'))
  }
  S.hooks.skinProfile = drawProfile
  try { drawProfile(await bridge.call('skins:profile')) } catch (e) { const el = $('#capes'); if (el) el.innerHTML = `<span class="dim" style="font-size:13px">${esc(e.message)}</span>` }
}

/* ---------- Updates ---------- */
async function loadUpdateStatus (manual) {
  const el = $('#upd-status'); if (!el) return
  el.innerHTML = '<span class="row"><span class="spinner"></span> Checking…</span>'
  try {
    const r = await bridge.call('update:check')
    if (!$('#upd-status')) return
    if (!r.configured) el.innerHTML = `<span class="muted">No update source set yet. You're on Plunder ${esc(r.current)}.</span>`
    else if (r.noReleases) el.innerHTML = `<span class="muted">No releases published on ${esc(S.state.settings.updateRepo || 'thepixlpirate/plunder')} yet. You're on Plunder ${esc(r.current)}.</span>`
    else if (r.newer) el.innerHTML = `<div class="notice">${icon('download')}<div style="flex:1"><b>Plunder ${esc(r.latest)} is available</b> (you have ${esc(r.current)}).${r.hasFile ? '' : ' <span class="dim">That release has no Plunder.exe attached.</span>'}</div>${r.hasFile ? `<button class="btn sm primary" data-act="update-install">Update now</button>` : ''}</div>`
    else el.innerHTML = `<span class="ok-text">${icon('check', 'sm')} You're up to date (Plunder ${esc(r.current)}).</span>`
  } catch (e) { if ($('#upd-status')) el.innerHTML = `<span style="color:var(--amber)">${esc(e.message)}</span>` }
}

/* ---------- Dependency warnings + crash helper ---------- */
function depsHtml (inst, r, compact) {
  if (!r || (!r.missing.length && !r.conflicts.length)) return ''
  return `<div class="notice warn" style="margin-bottom:14px">${icon('alert')}<div style="flex:1">
    ${r.missing.length ? `<b>Missing required mods:</b><div class="stack" style="gap:6px;margin:8px 0">${r.missing.map(m => `<div class="row" style="gap:8px"><span class="tag amber">${esc(m.id)}</span><span class="dim" style="font-size:12.5px">needed by ${m.neededBy.map(esc).join(', ')}</span><div class="spacer"></div>${compact ? '' : `<button class="btn sm" data-act="deps-install" data-id="${inst.id}" data-mod="${attr(m.id)}">${icon('download', 'sm')} Install</button>`}</div>`).join('')}</div>` : ''}
    ${r.conflicts.length ? `<b>Mods that don't work together:</b><div class="stack" style="gap:6px;margin:8px 0">${r.conflicts.map(c => `<div class="row" style="gap:8px"><span>${esc(c.mod)}</span><span class="dim">↔</span><span>${esc(c.with)}</span><div class="spacer"></div>${compact ? '' : `<button class="btn sm" data-act="crash-disable" data-id="${inst.id}" data-file="${attr(c.file)}">Turn off ${esc(c.mod)}</button>`}</div>`).join('')}</div>` : ''}
  </div></div>`
}
function drawDeps (inst, r) { const el = $('#deps-bar'); if (el) el.innerHTML = depsHtml(inst, r) }
// Before Play: warn about missing/conflicting mods. Resolves true to continue.
async function depsGate (inst) {
  const r = await quiet('deps:check', inst.id)
  if (!r || (!r.missing.length && !r.conflicts.length)) return true
  return new Promise(res => {
    let done = false
    const m = modal({ title: 'Some mods have problems', wide: true, body: `<p class="muted" style="margin:0">The game will probably crash with these. You can fix them on the Content tab.</p>${depsHtml(inst, r, true)}`,
      foot: '<button class="btn ghost" data-any>Play anyway</button><button class="btn primary" data-fix>Fix them</button>', onClose: () => { if (!done) res(false) } })
    m.el.querySelector('[data-any]').onclick = () => { done = true; m.close(); res(true) }
    m.el.querySelector('[data-fix]').onclick = () => { done = true; m.close(); res(false); go('instance', { id: inst.id, tab: 'content' }) }
  })
}
function showCrash (c) {
  const a = c.analysis
  const inst = findInst(c.instanceId)
  modal({
    title: `${c.name} crashed`,
    wide: true,
    body: !a ? `<p class="muted" style="margin:0">Minecraft closed with error code ${esc(c.code)}, but there was no crash report. Check the Log tab for details.</p>` : `
      <div class="notice warn">${icon('alert')}<div><b>${esc(a.summary)}</b><br>${esc(a.fix)}</div></div>
      ${a.suspects.length ? `<div><div class="muted" style="margin-bottom:8px">Most likely cause</div><div class="card list">${a.suspects.map(su => `<div class="list-row"><span class="ph">${icon('puzzle', 'sm')}</span><div class="t"><b>${esc(su.name)}</b><small>${esc(su.why)} · ${esc(su.file)}</small></div><div class="acts"><button class="btn sm" data-act="crash-disable" data-id="${c.instanceId}" data-file="${attr(su.file)}">Turn off</button></div></div>`).join('')}</div></div>` : ''}
      ${a.deps ? depsHtml(inst || { id: c.instanceId }, a.deps) : ''}
      ${a.detail ? `<details><summary class="muted" style="cursor:pointer">Technical detail</summary><pre class="log" style="height:auto;max-height:180px;margin-top:8px">${esc(a.detail)}</pre></details>` : ''}
      <div class="row">${a.file ? `<button class="btn sm" data-act="crash-open" data-file="${attr(a.file)}">${icon('file', 'sm')} Open crash report</button>` : ''}<button class="btn sm" data-act="go-log" data-id="${c.instanceId}">${icon('terminal', 'sm')} View log</button></div>`
  })
}

/* ---------- Modpack export ---------- */
function exportModal (id) {
  const inst = findInst(id); if (!inst) return
  const m = modal({
    title: `Export “${inst.name}”`,
    body: `<p class="muted" style="margin:0">Saves a <b>.mrpack</b> file you can send to friends. They open it in Plunder (or the Modrinth App, Prism…) and get the exact same mods and settings. Mods from Modrinth are linked, so the file stays small.</p>
      <label class="field"><span>Pack name</span><input class="input" id="ex-name" value="${attr(inst.name)}"></label>
      <label class="field"><span>Version</span><input class="input" id="ex-ver" value="1.0.0"></label>
      <label class="check"><input type="checkbox" id="ex-opt" checked><span>Include game settings & keybinds</span></label>
      <label class="check"><input type="checkbox" id="ex-srv"><span>Include server list</span></label>
      <label class="check"><input type="checkbox" id="ex-wld"><span>Include worlds <span class="dim">(makes the file much bigger)</span></span></label>`,
    foot: '<button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-go>' + icon('upload', 'sm') + ' Export…</button>'
  })
  m.el.querySelector('[data-x]').onclick = m.close
  m.el.querySelector('[data-go]').onclick = async e => {
    const q = s => m.el.querySelector(s)
    e.currentTarget.disabled = true
    try {
      const r = await bridge.call('modpack:export', id, { name: q('#ex-name').value.trim() || inst.name, version: q('#ex-ver').value.trim() || '1.0.0', includeOptions: q('#ex-opt').checked, includeServers: q('#ex-srv').checked, includeWorlds: q('#ex-wld').checked })
      m.close()
      if (r) toast(`Exported (${fmtBytes(r.size)}): ${r.linked} linked from Modrinth, ${r.packed} packed inside.`, 'ok')
    } catch (err) { toast(err.message, 'error'); e.currentTarget.disabled = false }
  }
}

/* ---------- Mod updates ---------- */
function drawUpdBar (inst) {
  const el = $('#upd-bar'); if (!el) return
  const u = (S.cache.updates || {})[inst.id]
  if (!u) { el.innerHTML = ''; return }
  const n = Object.keys(u).length
  el.innerHTML = n
    ? `<div class="notice" style="margin-bottom:14px;align-items:center">${icon('download')}<div style="flex:1"><b>${n} update${n === 1 ? '' : 's'} available.</b> ${S.cache.updErrors && S.cache.updErrors[inst.id] ? `<span class="dim">${esc(S.cache.updErrors[inst.id])}</span>` : ''}</div><button class="btn sm primary" data-act="update-all" data-id="${inst.id}" ${S.cache.updatingAll === inst.id ? 'disabled' : ''}>${S.cache.updatingAll === inst.id ? '<span class="spinner"></span> Updating…' : icon('download', 'sm') + ' Update all'}</button></div>`
    : `<div class="notice" style="margin-bottom:14px">${icon('check')}<div>Everything is up to date. ${S.cache.updErrors && S.cache.updErrors[inst.id] ? `<span class="dim">${esc(S.cache.updErrors[inst.id])}</span>` : ''}</div></div>`
}

/* ---------- Per-profile Bedrock folders ---------- */
async function drawBdata (inst) {
  const el = $('#bdata-block'); if (!el) return
  const st = await quiet('bdata:status', inst.id)
  if (!st || !$('#bdata-block')) return
  el.innerHTML = `<div class="setting" style="border:1px solid var(--line);border-radius:10px;padding:14px 16px">
      <div class="t"><b>Own worlds, add-ons & settings</b><small>${st.isolated
        ? `This installation has its own folder${st.size != null ? ` (${fmtBytes(st.size)})` : ''}. ${st.active ? 'It\'s the one Minecraft uses right now.' : 'Plunder switches to it when you select or play this installation.'}`
        : 'Off — this installation uses your normal Minecraft worlds and add-ons, shared with other “shared” installations.'}</small></div>
      <button class="switch ${st.isolated ? 'on' : ''}" data-act="bdata-toggle" data-id="${inst.id}"></button></div>
    ${st.isolated ? `<div class="row" style="margin-top:10px"><button class="btn sm" data-act="bdata-copy" data-id="${inst.id}">${icon('copy', 'sm')} Copy my normal worlds & add-ons in</button><button class="btn sm ghost" data-act="bdata-open" data-id="${inst.id}">${icon('folder', 'sm')} Open folder</button></div>` : ''}`
}

/* ---------- Bedrock installations ---------- */
const bvId = (version, kind) => version + (kind === 'preview' ? '-preview' : '')
async function pageBedrockInstances (list) {
  $('#main').innerHTML = `${topbar('box', 'Installations')}
    <div class="page-title"><div><h1>Installations</h1><p>Each installation has its own Bedrock version — and, if you like, its own worlds, add-ons and settings.</p></div>
      <button class="btn primary" data-act="new-instance" data-edition="bedrock">${icon('plus', 'sm')} New installation</button></div>
    <div id="bv-req"></div>
    <div class="gridauto">${list.map(instCard).join('')}<button class="new-card" data-act="new-instance" data-edition="bedrock"><div>${icon('plus', 'lg')}<span>New installation</span></div></button></div>
    <div class="section-head mt-l"><div><h3>${icon('layers')} Game versions on this PC</h3><p>Downloaded once and shared by any installations that use them.</p></div><button class="btn sm" data-act="bv-folder">${icon('folder', 'sm')} Open folder</button></div>
    <div class="card list" id="bv-installed"><div class="skeleton" style="height:60px;margin:10px"></div></div>`
  const [st, inst] = await Promise.all([quiet('bv:check'), quiet('bv:installed')])
  if (S.page !== 'bedrock-instances' && S.page !== 'bedrock-versions') return
  S.cache.bvCheck = st
  S.cache.bvInstalled = (inst || []).map(v => v.id)
  // Re-draw cards now that we know which versions are downloaded.
  const grid = document.querySelector('#main .gridauto')
  if (grid) grid.innerHTML = bedrockInstances().map(instCard).join('') + `<button class="new-card" data-act="new-instance" data-edition="bedrock"><div>${icon('plus', 'lg')}<span>New installation</span></div></button>`
  const req = $('#bv-req')
  if (st && st.supported) {
    S.bvActiveDev = !!(st.active.release && st.active.release.dev)
    const missing = []
    if (!st.devMode) missing.push(bvReqRow(false, 'Developer Mode is off', 'Needed to play any version other than the Store one. Windows Settings → System → For developers → Developer Mode.', `<button class="btn sm primary" data-act="bv-dev">${icon('external', 'sm')} Open setting</button>`))
    if (!st.gamingServices) missing.push(bvReqRow(false, 'Gaming Services is missing', 'Comes with the Xbox app. Install the Xbox app from the Microsoft Store.', `<button class="btn sm" data-act="open-url" data-url="https://www.xbox.com/apps/xbox-app-for-pc">Get the Xbox app</button>`))
    if (!st.active.release) missing.push(bvReqRow(false, 'Minecraft hasn\'t been installed from the Store', 'Needed once so Windows has your license key. Install Minecraft from the Microsoft Store or Xbox app.', `<button class="btn sm" data-act="open-url" data-url="https://www.minecraft.net/en-us/download">Get Minecraft</button>`))
    req.innerHTML = (missing.length ? `<div class="card settings-block" style="margin-bottom:18px"><h3>${icon('settings')} Finish setting up</h3><p>Only needed for installations that use a version other than the Store one.</p>${missing.join('')}</div>` : '') +
      (st.active.release && st.active.release.dev ? `<div class="notice" style="margin-bottom:18px">${icon('info')}<div>Plunder's ${st.active.release.plunder ? 'Bedrock ' + esc(st.active.release.plunder) : 'copy'} is the Minecraft in Windows right now (the Store copy is set aside while you use Plunder's versions). <button class="btn sm" style="margin-left:8px" data-act="bv-restore" data-kind="release">${icon('restore', 'sm')} Restore Store version</button></div></div>` : '')
  } else if (st && !st.supported) req.innerHTML = ''
  const act = st && st.supported ? st.active : {}
  const il = $('#bv-installed')
  il.innerHTML = inst && inst.length ? inst.map(v => {
    const live = act[v.kind] && act[v.kind].plunder === v.id
    const users = bedrockInstances().filter(i => i.bedrockVersion === v.id)
    return `<div class="list-row"><span class="ph">${icon('cube', 'sm')}</span><div class="t"><b>Bedrock ${esc(v.version)}${v.kind === 'preview' ? ' Preview' : ''}</b><small>${fmtBytes(v.size)}${users.length ? ' · used by ' + users.map(u => esc(u.name)).join(', ') : ' · not used by any installation'}</small></div>
      ${live ? '<span class="tag green">Active in Windows</span>' : ''}
      <div class="acts"><button class="btn sm icon ghost danger" data-act="bv-remove" data-id="${attr(v.id)}" title="Delete this version">${icon('trash', 'sm')}</button></div></div>`
  }).join('') : `<div class="empty" style="padding:22px"><p style="margin:0">None yet — they download automatically when you make an installation with a new version.</p></div>`
}

async function newBedrockInstallModal () {
  const m = modal({
    title: 'New Bedrock installation',
    body: `<label class="field"><span>Name</span><input class="input" id="ni-name" placeholder="e.g. Survival with friends"></label>
      <label class="field"><span>Version</span><select class="input" id="ni-bv"><option>Loading versions…</option></select><span class="hint" id="ni-bv-hint"></span></label>
      <label class="check"><input type="checkbox" id="ni-iso" checked><span><b>Own worlds, add-ons & settings</b> — kept separate from your other installations</span></label>
      <label class="check" style="margin-left:27px"><input type="checkbox" id="ni-copy"><span>Start with a copy of my current worlds and add-ons</span></label>
      <div id="ni-warn"></div>`,
    foot: '<button class="btn ghost" data-close2>Cancel</button><button class="btn primary" data-create>Create installation</button>'
  })
  const el = m.el
  el.querySelector('[data-close2]').onclick = m.close
  const sel = el.querySelector('#ni-bv')
  const [inst, avail, st] = await Promise.all([quiet('bv:installed'), quiet('bv:available'), S.cache.bvCheck ? S.cache.bvCheck : quiet('bv:check')])
  if (!document.body.contains(el)) return
  const have = new Set((inst || []).map(v => v.id))
  const opt = (v, k, label) => `<option value="${attr(bvId(v, k))}" data-dl="${have.has(bvId(v, k)) ? '' : '1'}" data-v="${attr(v)}" data-k="${k}">${esc(label)}</option>`
  const storeLabel = st && st.active && st.active.release && !st.active.release.dev ? `Store version (${shortBedrock(st.active.release.version)})` : 'Store version'
  const rel = (avail || []).filter(v => v.kind === 'release'), pre = (avail || []).filter(v => v.kind === 'preview')
  sel.innerHTML = `<optgroup label="On this PC"><option value="" data-dl="">${esc(storeLabel)}</option>${(inst || []).map(v => opt(v.version, v.kind, `Bedrock ${v.version}${v.kind === 'preview' ? ' Preview' : ''} ✓`)).join('')}</optgroup>
    ${rel.length ? `<optgroup label="Releases — downloads automatically">${rel.filter(v => !have.has(bvId(v.version, 'release'))).map(v => opt(v.version, 'release', `Bedrock ${v.version}`)).join('')}</optgroup>` : ''}
    ${pre.length ? `<optgroup label="Previews — downloads automatically">${pre.filter(v => !have.has(bvId(v.version, 'preview'))).map(v => opt(v.version, 'preview', `Bedrock ${v.version} Preview`)).join('')}</optgroup>` : ''}`
  if (!avail) sel.insertAdjacentHTML('beforeend', '<option disabled>Couldn\'t load more versions — check your internet</option>')
  const update = () => {
    const o = sel.selectedOptions[0]
    const dl = o && o.dataset.dl
    el.querySelector('#ni-bv-hint').innerHTML = !o || !o.value ? 'Plays whatever version the Microsoft Store has installed.' : dl ? 'Not on this PC yet — Plunder downloads it from Microsoft (1–2 GB). Windows asks for permission once.' : 'Already downloaded.'
    el.querySelector('#ni-warn').innerHTML = o && o.value && st && st.supported && !st.devMode
      ? `<div class="notice warn">${icon('alert')}<div>Other versions need <b>Developer Mode</b> turned on in Windows. <button class="btn sm" style="margin-left:6px" data-act="bv-dev">Open setting</button></div></div>` : ''
    if (o && o.value && !el.querySelector('#ni-name').dataset.touched) el.querySelector('#ni-name').placeholder = 'e.g. ' + o.textContent.replace(' ✓', '')
  }
  sel.onchange = update
  el.querySelector('#ni-name').oninput = e => { e.target.dataset.touched = '1' }
  update()
  el.querySelector('[data-create]').onclick = async e => {
    const o = sel.selectedOptions[0]
    const btn = e.currentTarget
    if (o && o.value && st && st.supported && !st.devMode) { toast('Turn on Developer Mode first, then create the installation.', 'warn'); return }
    btn.disabled = true
    const name = el.querySelector('#ni-name').value.trim() || (o && o.value ? o.textContent.replace(' ✓', '') : 'Bedrock')
    try {
      const inst2 = await bridge.call('instances:create', { edition: 'bedrock', name, bedrockVersion: (o && o.value) || null, bedrockIsolated: el.querySelector('#ni-iso').checked, copyShared: el.querySelector('#ni-iso').checked && el.querySelector('#ni-copy').checked })
      m.close()
      await refresh(); await quiet('select', 'bedrock', inst2.id); S.state.selected.bedrock = inst2.id
      if (o && o.dataset.dl) {
        toast(`Downloading Bedrock ${o.dataset.v} for “${name}”. Watch the progress on the right — you can keep using Plunder.`, 'info')
        bridge.call('bv:install', { version: o.dataset.v, kind: o.dataset.k })
          .then(() => { toast(`“${name}” is ready to play.`, 'ok'); if (S.page === 'bedrock-instances') renderMain() })
          .catch(err => { toast(`Couldn't download Bedrock ${o.dataset.v}: ${err.message}`, 'error'); if (S.page === 'bedrock-instances') renderMain() })
        setTimeout(() => { if (S.page === 'bedrock-instances') renderMain() }, 600)
      }
      go('bedrock-instances')
    } catch (err) { btn.disabled = false; toast(err.message, 'error') }
  }
}

/* ---------- Bedrock versions ---------- */
async function bedrockVersionOptions (selected) {
  const [list, avail] = await Promise.all([quiet('bv:installed'), quiet('bv:available')])
  const have = new Set((list || []).map(v => v.id))
  const o = (id, v, k, label, dl) => `<option value="${attr(id)}" data-dl="${dl ? '1' : ''}" data-v="${attr(v)}" data-k="${k}" ${id === selected ? 'selected' : ''}>${esc(label)}</option>`
  const rel = (avail || []).filter(v => v.kind === 'release' && !have.has(bvId(v.version, 'release')))
  const pre = (avail || []).filter(v => v.kind === 'preview' && !have.has(bvId(v.version, 'preview')))
  return `<optgroup label="On this PC"><option value="" data-dl="">Store version (whatever the Microsoft Store installed)</option>` +
    (list || []).map(v => o(v.id, v.version, v.kind, `Bedrock ${v.version}${v.kind === 'preview' ? ' Preview' : ''} ✓`, false)).join('') + '</optgroup>' +
    (rel.length ? `<optgroup label="Releases — downloads automatically">${rel.map(v => o(bvId(v.version, 'release'), v.version, 'release', `Bedrock ${v.version}`, true)).join('')}</optgroup>` : '') +
    (pre.length ? `<optgroup label="Previews — downloads automatically">${pre.map(v => o(bvId(v.version, 'preview'), v.version, 'preview', `Bedrock ${v.version} Preview`, true)).join('')}</optgroup>` : '') +
    (selected && !have.has(selected) && !(avail || []).some(v => bvId(v.version, v.kind) === selected) ? `<option value="${attr(selected)}" selected>${esc(selected)} (not downloaded)</option>` : '')
}
function bvReqRow (ok, title, text, action) {
  return `<div class="setting"><div class="t"><b>${ok ? `<span class="ok-text">${icon('check', 'sm')}</span>` : `<span style="color:var(--amber)">${icon('alert', 'sm')}</span>`} ${title}</b><small>${text}</small></div>${!ok && action ? action : ''}</div>`
}
async function pageBedrockVersions () {
  const p = S.params
  p.kind = p.kind || 'release'
  $('#main').innerHTML = `${topbar('layers', 'Versions')}
    <div class="page-title"><div><h1>Bedrock versions</h1><p>Keep several Bedrock versions side by side and pick one per profile — like Java. All versions share the same worlds, so back up a world before opening it in an older version.</p></div>
      <button class="btn" data-act="bv-folder">${icon('folder', 'sm')} Versions folder</button></div>
    <div class="card settings-block" id="bv-req"><h3>${icon('settings')} One-time setup</h3><p>Checking this PC…</p></div>
    <div class="section-head mt-l"><h3>${icon('box')} Installed versions</h3></div>
    <div class="card list" id="bv-installed"><div class="skeleton" style="height:60px;margin:10px"></div></div>
    <div class="section-head mt-l"><div><h3>${icon('download')} Get another version</h3><p>Downloaded straight from Microsoft (about 1–2 GB each). Windows asks for permission once per install.</p></div>
      <div class="seg">${[['release', 'Releases'], ['preview', 'Previews']].map(([k, l]) => `<button class="${p.kind === k ? 'on' : ''}" data-act="bv-kind" data-v="${k}">${l}</button>`).join('')}</div></div>
    <div class="search" style="margin-bottom:12px">${icon('search')}<input class="input" id="bv-q" placeholder="Filter versions, e.g. 1.21.1" value="${attr(p.q || '')}"></div>
    <div class="card list" id="bv-available"><div class="skeleton" style="height:60px;margin:10px"></div></div>`
  const [st, inst, avail] = await Promise.all([quiet('bv:check'), quiet('bv:installed'), quiet('bv:available')])
  if (S.page !== 'bedrock-versions') return
  S.cache.bvCheck = st
  const req = $('#bv-req')
  if (!st || !st.supported) req.innerHTML = `<h3>${icon('info')} Windows only</h3><p style="margin:0">Running different Bedrock versions only works on Windows.</p>`
  else {
    const relActive = st.active.release
    req.innerHTML = `<h3>${icon('settings')} One-time setup</h3><p>Plunder uses the same method as the open-source MCLauncher. It needs:</p>
      ${bvReqRow(st.devMode, 'Developer Mode is on', 'Lets Plunder register game versions stored in its own folder. Windows Settings → System → For developers → Developer Mode.', `<button class="btn sm primary" data-act="bv-dev">${icon('external', 'sm')} Open setting</button>`)}
      ${bvReqRow(st.gamingServices, 'Gaming Services is installed', 'Comes with the Xbox app. Install the Xbox app from the Microsoft Store if this is missing.', `<button class="btn sm" data-act="open-url" data-url="https://www.xbox.com/apps/xbox-app-for-pc">Get the Xbox app</button>`)}
      ${bvReqRow(!!relActive, 'Minecraft was installed from the Store at least once', relActive ? (relActive.dev ? `Plunder's ${relActive.plunder ? 'Bedrock ' + esc(relActive.plunder) : 'copy'} is active right now. To get the Store copy back, use “Restore Store version”.` : `Store version ${esc(shortBedrock(relActive.version))} is installed — that also provides the unlock key Plunder needs.`) : 'Needed once so Windows has your license key. Install Minecraft from the Microsoft Store or Xbox app.', `<button class="btn sm" data-act="open-url" data-url="https://www.minecraft.net/en-us/download">Get Minecraft</button>`)}
      <div class="notice mt">${icon('info')}<div>Installing or playing a different version <b>replaces the Store copy</b> while you use it (your worlds and settings stay). You can bring the Store copy back any time.${relActive && relActive.dev ? ` <button class="btn sm" style="margin-left:8px" data-act="bv-restore" data-kind="release">${icon('restore', 'sm')} Restore Store version</button>` : ''}</div></div>`
    S.bvActiveDev = !!(relActive && relActive.dev)
  }
  const act = st && st.supported ? st.active : {}
  const il = $('#bv-installed')
  il.innerHTML = inst && inst.length ? inst.map(v => {
    const live = act[v.kind] && act[v.kind].plunder === v.id
    const users = bedrockInstances().filter(i => i.bedrockVersion === v.id)
    return `<div class="list-row"><span class="ph">${icon('cube', 'sm')}</span><div class="t"><b>Bedrock ${esc(v.version)}${v.kind === 'preview' ? ' Preview' : ''}</b><small>${fmtBytes(v.size)}${users.length ? ' · used by ' + users.map(u => esc(u.name)).join(', ') : ' · not used by any profile yet'}</small></div>
      ${live ? '<span class="tag green">Active in Windows</span>' : ''}
      <div class="acts"><button class="btn sm primary" data-act="bv-play" data-id="${attr(v.id)}">${icon('play', 'sm')} Play</button><button class="btn sm" data-act="bv-new-profile" data-id="${attr(v.id)}">${icon('plus', 'sm')} New profile</button><button class="btn sm icon ghost danger" data-act="bv-remove" data-id="${attr(v.id)}" title="Delete">${icon('trash', 'sm')}</button></div></div>`
  }).join('') : `<div class="empty" style="padding:26px">${icon('layers')}<h4>No extra versions yet</h4><p>Pick one below. Profiles without a version keep using the Store version.</p></div>`
  const draw = () => {
    const el = $('#bv-available'); if (!el) return
    if (!avail) { el.innerHTML = `<div class="notice warn" style="margin:12px">${icon('alert')}<div>Couldn't load the version list. Check your internet connection.</div></div>`; return }
    const q = (p.q || '').trim()
    const have = new Set((inst || []).map(v => v.version + '|' + v.kind))
    const rows = avail.filter(v => v.kind === p.kind && (!q || v.version.startsWith(q) || v.version.includes(q)))
    const shown = rows.slice(0, q ? 200 : 40)
    el.innerHTML = shown.length ? shown.map(v => {
      const got = have.has(v.version + '|' + v.kind)
      const going = [...S.tasks.values()].some(t => !t.done && t.label.includes(v.version))
      return `<div class="list-row"><span class="ph">${icon(v.kind === 'preview' ? 'sparkles' : 'cube', 'sm')}</span><div class="t"><b>Bedrock ${esc(v.version)}${v.kind === 'preview' ? ' Preview' : ''}</b><small>${v.kind === 'preview' ? 'Preview (needs Minecraft Preview installed from the Store once)' : 'Release'}</small></div>
        <div class="acts">${got ? '<span class="tag green">Installed</span>' : going ? '<button class="btn sm" disabled><span class="spinner"></span> Installing</button>' : `<button class="btn sm primary" data-act="bv-install" data-v="${attr(v.version)}" data-kind="${v.kind}">${icon('download', 'sm')} Install</button>`}</div></div>`
    }).join('') + (rows.length > shown.length ? `<div class="list-row"><span class="muted" style="font-size:13px">${rows.length - shown.length} older versions hidden — type in the filter to find one.</span></div>` : '')
      : `<div class="empty" style="padding:24px"><p style="margin:0">No versions match.</p></div>`
  }
  draw()
  S.hooks.bvRedraw = draw
  $('#bv-q').oninput = debounce(e => { p.q = e.target.value; draw() }, 200)
}

/* ---------- Servers (Java + Bedrock) ---------- */
const srvKey = s => s.id || `game|${s.edition}|${s.host}|${s.port}`
function srvCard (s, saved) {
  const st = (S.cache.srvStatus || {})[srvKey(s)]
  const java = s.edition === 'java'
  const state = !st ? '<span class="srv-state wait"><span class="spinner"></span> Checking…</span>'
    : st.online ? `<span class="srv-state on"><i></i> Online · ${st.ping} ms</span>` : `<span class="srv-state off"><i></i> ${esc(st.error === 'No response' || st.error === 'Offline' ? 'Offline' : st.error || 'Offline')}</span>`
  const pl = st && st.online ? st.players : null
  const pct = pl && pl.max ? Math.min(100, Math.round(pl.online / pl.max * 100)) : 0
  const iconSrc = (st && st.favicon) || s.icon || landscape('srv' + s.host, 96, 96)
  return `<div class="card srv-card ${st && !st.online ? 'is-off' : ''}">
    <div class="srv-top"><img src="${attr(iconSrc)}" alt=""><div class="t"><b>${esc(s.name)}</b><small>${esc(s.host)}${(java && s.port === 25565) || (!java && s.port === 19132) ? '' : ':' + s.port}</small></div>${state}</div>
    <div class="srv-motd">${st && st.online && st.motd ? esc(st.motd) : st && !st.online ? 'This server isn\'t answering right now.' : '&nbsp;'}</div>
    <div class="srv-players">
      <div class="row"><span>${icon('users', 'sm')} ${pl ? `<b>${fmtNum(pl.online)}</b> / ${fmtNum(pl.max)} players online` : '— players'}</span><div class="spacer"></div>${st && st.online && st.version ? `<span class="tag">${esc(st.version)}</span>` : ''}</div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      ${pl && pl.sample && pl.sample.length ? `<div class="srv-names">${pl.sample.map(n => `<span class="tag">${esc(n)}</span>`).join('')}${pl.online > pl.sample.length ? `<span class="dim">+${pl.online - pl.sample.length} more</span>` : ''}</div>` : ''}
    </div>
    <div class="srv-acts">
      <button class="btn sm primary" data-act="srv-join" data-edition="${s.edition}" data-host="${attr(s.host)}" data-port="${s.port}" data-inst="${attr(s.instanceId || '')}">${icon('play', 'sm')} Join</button>
      ${!java ? `<button class="btn sm" data-act="add-server-game" data-name="${attr(s.name)}" data-host="${attr(s.host)}" data-port="${s.port}" title="Adds it to Minecraft's Servers tab">${icon('plus', 'sm')} Add to game list</button>` : ''}
      <div class="spacer"></div>
      ${saved ? `<button class="btn sm icon ghost" data-act="srv-edit" data-id="${s.id}" title="Edit">${icon('pencil', 'sm')}</button><button class="btn sm icon ghost danger" data-act="srv-remove" data-id="${s.id}" title="Remove">${icon('trash', 'sm')}</button>`
        : `<button class="btn sm" data-act="srv-adopt" data-edition="${s.edition}" data-name="${attr(s.name)}" data-host="${attr(s.host)}" data-port="${s.port}" data-inst="${attr(s.instanceId || '')}">${icon('star', 'sm')} Save to Plunder</button>`}
    </div></div>`
}
async function pageServers (edition) {
  const java = edition === 'java'
  const def = java ? 25565 : 19132
  $('#main').innerHTML = `${topbar('server', 'Servers')}
    <div class="page-title"><div><h1>${java ? 'Java' : 'Bedrock'} servers</h1><p>Your saved servers with live status — who's online, ping and version. Refreshes every 30 seconds.</p></div>
      <button class="btn" data-act="srv-refresh">${icon('refresh', 'sm')} Refresh</button></div>
    <div class="card settings-block"><h3>${icon('plus')} Add a server</h3><p>Default ${java ? 'Java' : 'Bedrock'} port is ${def}. You can also type it as address:port.</p>
      <div class="row wrap"><input class="input" id="s-name" placeholder="Name (e.g. Friends Server)" style="flex:1;min-width:180px"><input class="input" id="s-host" placeholder="Address (e.g. play.example.com)" style="flex:1.4;min-width:220px"><input class="input" id="s-port" value="${def}" style="width:110px"><button class="btn primary" data-act="srv-add" data-edition="${edition}">${icon('plus', 'sm')} Save</button></div></div>
    <div class="section-head mt-l"><h3>${icon('anchor')} Saved in Plunder</h3></div>
    <div class="srv-grid" id="srv-saved"><div class="skeleton"></div><div class="skeleton"></div></div>
    <div class="section-head mt-l"><div><h3>${icon(java ? 'java' : 'cube')} In Minecraft's own server list</h3><p>${java ? 'Servers you added inside each Java instance\'s Multiplayer screen.' : 'Servers from Bedrock\'s Servers tab.'}</p></div></div>
    <div class="srv-grid" id="srv-game"><div class="skeleton"></div></div>`
  const [saved, game] = await Promise.all([quiet('servers:list'), quiet('servers:game')])
  if (S.page !== (java ? 'java-servers' : 'bedrock-servers')) return
  S.cache.servers = saved || []
  const mine = S.cache.servers.filter(s => s.edition === edition)
  const gameList = ((game && game[edition]) || []).filter(g => !mine.some(m => m.host === g.host && m.port === g.port))
  const draw = () => {
    const a = $('#srv-saved'), b = $('#srv-game'); if (!a || !b) return
    a.innerHTML = mine.length ? mine.map(s => srvCard(s, true)).join('') : `<div class="card" style="grid-column:1/-1"><div class="empty" style="padding:28px">${icon('server')}<h4>No saved servers yet</h4><p>Add one above${gameList.length ? ' or save one from the list below' : ''}.</p></div></div>`
    b.innerHTML = gameList.length ? gameList.map(s => srvCard({ ...s, edition }, false)).join('') : `<div class="card" style="grid-column:1/-1;padding:18px"><span class="muted">${java ? 'No other servers found in your instances.' : 'No other servers in Bedrock\'s list' + (S.bedrock && !S.bedrock.roots.length ? " (couldn't find Bedrock's data folder)" : '') + '.'}</span></div>`
  }
  const refresh = async () => {
    const all = [...mine, ...gameList.map(g => ({ ...g, edition }))].map(s => ({ ...s, id: srvKey(s) }))
    draw()
    const r = await quiet('servers:status', all)
    if (r) { S.cache.srvStatus = { ...(S.cache.srvStatus || {}), ...r }; draw() }
  }
  S.hooks.srvRefresh = refresh
  refresh()
  S.hooks.timer = setInterval(() => { if (document.visibilityState === 'visible') refresh() }, 30000)
}

/* ---------- Settings ---------- */
function pageSettings () {
  const st = S.state.settings
  const accs = S.state.accounts || []
  $('#main').innerHTML = `${topbar('settings', 'Settings')}
    <div class="page-title"><div><h1>Settings</h1></div></div>
    <div class="card settings-block"><h3>${icon('user')} Microsoft accounts</h3><p>Sign in with the Microsoft account that owns Minecraft. Your password is never seen by Plunder.</p>
      <div class="list">${accs.map(a => `<div class="list-row" style="padding-left:0;padding-right:0"><span class="avatar">${img(avatarUrl(a), '', 'steve')}</span><div class="t"><b>${esc(a.name)}</b><small>${a.id === S.state.activeAccount ? 'Active account' : 'Signed in'}</small></div>
        <div class="acts">${a.id !== S.state.activeAccount ? `<button class="btn sm" data-act="select-account" data-id="${a.id}">Use this account</button>` : '<span class="tag green">Active</span>'}<button class="btn sm ghost danger" data-act="remove-account" data-id="${a.id}">${icon('logout', 'sm')} Sign out</button></div></div>`).join('')}</div>
      <button class="btn primary" data-act="add-account" style="margin-top:10px">${icon('plus', 'sm')} Add Microsoft account</button></div>

    <div class="card settings-block"><h3>${icon('sidebar')} Layout</h3><p>Make room for the main view. The buttons at the top of the window do the same thing.</p>
      <div class="setting"><div class="t"><b>Compact left sidebar</b><small>Shrinks the left sidebar to icons only.</small></div><button class="switch ${st.leftCollapsed ? 'on' : ''}" data-act="toggle-layout" data-k="leftCollapsed"></button></div>
      <div class="setting"><div class="t"><b>Show right panel</b><small>Account, edition switch and recent play history.</small></div><button class="switch ${!st.rightHidden ? 'on' : ''}" data-act="toggle-layout" data-k="rightHidden"></button></div></div>

    <div class="card settings-block"><h3>${icon('key')} CurseForge</h3><p>CurseForge needs a free personal API key before apps can search it. Modrinth and Planet Minecraft work without one.</p>
      <ol class="steps"><li>Open the <a href="#" data-act="open-url" data-url="https://console.curseforge.com/#/api-keys">CurseForge for Studios console → API keys</a> and sign in.</li><li>Click the <b>copy</b> icon next to your key (copying by selecting the text can miss characters).</li><li>Paste it below, then click <b>Save & test</b>.</li></ol>
      <div class="row"><input class="input" id="cf-key" type="password" placeholder="Paste your CurseForge API key (starts with $2a$10$)" value="${attr(st.curseforgeKey)}" spellcheck="false" autocomplete="off"><button class="btn" data-act="toggle-key">${icon('search', 'sm')} Show</button><button class="btn primary" data-act="save-cf">${icon('check', 'sm')} Save & test</button></div>
      <div id="cf-result" class="mt" style="font-size:13px"></div></div>

    <div class="card settings-block"><h3>${icon('java')} Java Edition</h3><p>Java is downloaded automatically for each Minecraft version — you don't need to install anything.</p>
      ${memoryField(st.memoryMax, 'Default for instances that don\'t set their own.')}
      <div class="form-grid mt">
        <label class="field"><span>Custom Java path</span><input class="input" id="java-path" placeholder="Leave empty (recommended)" value="${attr(st.javaPath)}"></label>
        <label class="field"><span>Extra Java arguments (all instances)</span><input class="input" id="jvm-args" placeholder="Advanced — usually leave empty" value="${attr(st.jvmArgs)}"></label>
      </div>
      <div class="setting mt"><div class="t"><b>Keep Plunder open while playing</b><small>Turn off to minimize Plunder when the game starts.</small></div><button class="switch ${st.keepOpen ? 'on' : ''}" data-act="toggle-setting" data-k="keepOpen"></button></div>
      <div class="setting"><div class="t"><b>Show snapshots</b><small>Include test versions when creating instances.</small></div><button class="switch ${st.showSnapshots ? 'on' : ''}" data-act="toggle-setting" data-k="showSnapshots"></button></div>
      <div class="row mt"><div class="spacer"></div><button class="btn primary" data-act="save-java">${icon('check', 'sm')} Save Java settings</button></div></div>

    <div class="card settings-block"><h3>${icon('cube')} Bedrock Edition</h3><p>Where Minecraft Bedrock keeps worlds and packs on this PC.</p>
      <div class="stack">${S.bedrock && S.bedrock.roots.length ? S.bedrock.roots.map(r => `<div class="row" style="font-size:13px"><span class="tag green">Found</span><code style="color:var(--muted);word-break:break-all">${esc(r)}</code></div>`).join('') : '<div class="muted" style="font-size:13px">Not found automatically.</div>'}</div>
      <div class="row mt"><button class="btn" data-act="pick-bedrock-data">${icon('folder', 'sm')} Choose folder…</button>${S.bedrock && S.bedrock.roots.length ? `<button class="btn ghost" data-act="open-bedrock-data">${icon('external', 'sm')} Open</button>` : ''}<span class="hint">Installed version: ${S.bedrock && S.bedrock.version ? esc(shortBedrock(S.bedrock.version)) : 'unknown'}</span></div></div>

    <div class="card settings-block"><h3>${icon('archive')} Automatic world backups</h3><p>Plunder backs up worlds that changed before you play, so a bad mod or an older Bedrock version can't ruin them. Old automatic backups are cleaned up.</p>
      <div class="form-grid"><label class="field"><span>When</span><select class="input" id="ab-mode">${[['daily', 'Once a day (before playing)'], ['launch', 'Every time I play'], ['off', 'Off']].map(([v, l]) => `<option value="${v}" ${(st.autoBackup || 'daily') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field"><span>Keep the newest</span><select class="input" id="ab-keep">${[3, 5, 10, 20].map(n => `<option value="${n}" ${(st.autoBackupKeep || 5) === n ? 'selected' : ''}>${n} automatic backups per world</option>`).join('')}</select></label></div>
      <p class="hint" style="margin:10px 0 0">Backups you make yourself are never deleted automatically.</p></div>

    <div class="card settings-block"><h3>${icon('refresh')} Updates</h3><p>Plunder can update itself from a GitHub repository's releases (each release needs a <b>Plunder.exe</b> file). It checks when Plunder starts.</p>
      <div class="row"><input class="input" id="upd-repo" placeholder="e.g. yourname/plunder" value="${attr(st.updateRepo || '')}"><button class="btn" data-act="update-save">${icon('check', 'sm')} Save & check</button></div>
      <div id="upd-status" class="mt" style="font-size:13px"></div></div>

    <div class="card settings-block" id="assoc-block"><h3>${icon('puzzle')} Add-on files</h3><p>Make Plunder the app that opens <b>.mcaddon</b>, <b>.mcpack</b> and <b>.mcworld</b> files. Double-click one (or open it from your downloads) and Plunder installs it into Minecraft and keeps a copy in your Bedrock profile.</p>
      <div id="assoc-status" class="muted" style="font-size:13px">Checking…</div>
      <div class="row mt"><button class="btn primary" data-act="assoc-setup">${icon('check', 'sm')} Open add-on files with Plunder</button><button class="btn ghost" data-act="assoc-remove">Undo</button></div>
      <p class="hint" style="margin:10px 0 0">Windows asks you to confirm once: in the box that pops up, pick <b>Plunder</b> and click <b>Always</b>.</p></div>

    <div class="card settings-block"><h3>${icon('folder')} Storage</h3><p>${S.state.portable ? 'Plunder is running <b>portable</b>: everything it saves is in the one “Plunder Data” folder next to Plunder.exe. Move both together to take Plunder anywhere (even a USB stick).' : 'Instances, backups and downloaded game files live here.'}</p>
      <div class="row"><code style="color:var(--muted);font-size:13px;word-break:break-all;flex:1">${esc(S.state.dataDir)}</code><button class="btn" data-act="open-data">${icon('folder', 'sm')} Open</button><button class="btn" data-act="open-backups">${icon('archive', 'sm')} Backups</button></div></div>
    <p class="dim" style="font-size:12.5px">Plunder ${esc(S.state.version)} · Not affiliated with Mojang or Microsoft.</p>`
  bindMemory()
  loadAssocStatus()
  loadUpdateStatus()
  $('#ab-mode').onchange = e => quiet('settings:set', { autoBackup: e.target.value }).then(x => { if (x) S.state.settings = x })
  $('#ab-keep').onchange = e => quiet('settings:set', { autoBackupKeep: Number(e.target.value) }).then(x => { if (x) S.state.settings = x })
}
async function loadAssocStatus () {
  const el = $('#assoc-status'); if (!el) return
  const st = await quiet('assoc:status')
  if (!$('#assoc-status')) return
  if (!st || !st.supported) { el.textContent = 'Only available on Windows.'; return }
  const exts = Object.entries(st.defaults || {})
  el.innerHTML = st.allDefault ? `<span class="ok-text">${icon('check', 'sm')} Plunder opens all Minecraft add-on files.</span>`
    : exts.map(([e, on]) => `<span class="tag ${on ? 'green' : ''}" style="margin-right:6px">${on ? '✓' : '✕'} ${e}</span>`).join('') + `<span style="margin-left:6px">${exts.some(([, on]) => on) ? 'Some files still open in another app.' : 'Add-on files currently open in another app (usually Minecraft).'}</span>`
}


/* ---------- modals ---------- */
async function newInstanceModal (edition = 'java') {
  if (edition === 'bedrock') return newBedrockInstallModal()
  const m = modal({
    title: 'New Java instance',
    body: `<label class="field"><span>Name</span><input class="input" id="ni-name" placeholder="e.g. Vanilla Survival"></label>
      <div class="form-grid">
        <label class="field"><span>Minecraft version</span><select class="input" id="ni-ver"><option>Loading…</option></select></label>
        <label class="field"><span>Mod loader</span><div class="seg" id="ni-loader" style="width:100%"><button class="on" data-l="vanilla">Vanilla</button><button data-l="fabric">Fabric</button><button data-l="quilt">Quilt</button><button data-l="forge">Forge</button><button data-l="neoforge">NeoForge</button></div></label>
      </div>
      <label class="field" id="ni-lv-wrap" style="display:none"><span>Loader version</span><select class="input" id="ni-lv"></select><span class="hint">The newest stable version is picked for you.</span></label>
      <div class="hint">Vanilla = the normal game (resource packs work). Fabric, Quilt, Forge or NeoForge = needed for mods — pick the one your mods are made for.</div>`,
    foot: '<button class="btn ghost" data-close2>Cancel</button><button class="btn primary" data-create>Create instance</button>'
  })
  const el = m.el
  el.querySelector('[data-close2]').onclick = m.close
  let loader = 'vanilla'
  const verSel = el.querySelector('#ni-ver')
  try {
    if (!S.mc) S.mc = await bridge.call('versions:minecraft')
    const list = S.mc.versions.filter(v => v.type === 'release' || (S.state.settings.showSnapshots && v.type === 'snapshot'))
    verSel.innerHTML = list.map(v => `<option value="${attr(v.id)}" ${v.id === S.mc.latest.release ? 'selected' : ''}>${esc(v.id)}${v.type === 'snapshot' ? ' (snapshot)' : ''}</option>`).join('')
  } catch (e) { verSel.innerHTML = '<option value="">Couldn\'t load versions — check internet</option>' }
  const loadLV = async () => {
    const wrap = el.querySelector('#ni-lv-wrap'), sel = el.querySelector('#ni-lv')
    if (loader === 'vanilla') { wrap.style.display = 'none'; return }
    wrap.style.display = ''
    sel.innerHTML = '<option>Loading…</option>'
    try {
      const lv = await bridge.call('versions:loader', loader, verSel.value)
      sel.innerHTML = lv.length ? lv.slice(0, 40).map((v, i) => `<option value="${attr(v.version)}" ${i === lv.findIndex(x => x.stable) ? 'selected' : ''}>${esc(v.version)}${v.stable ? '' : ' (beta)'}</option>`).join('') : `<option value="">${LOADER[loader]} doesn't support ${esc(verSel.value)} yet</option>`
    } catch { sel.innerHTML = '<option value="">Couldn\'t load — check internet</option>' }
  }
  el.querySelector('#ni-loader').onclick = e => {
    const b = e.target.closest('button[data-l]'); if (!b) return
    loader = b.dataset.l
    el.querySelectorAll('#ni-loader button').forEach(x => x.classList.toggle('on', x === b))
    loadLV()
  }
  verSel.onchange = loadLV
  el.querySelector('[data-create]').onclick = async e => {
    const btn = e.currentTarget
    if (!verSel.value) return
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Creating…'
    try {
      const inst = await bridge.call('instances:create', { edition: 'java', name: el.querySelector('#ni-name').value, mc: verSel.value, loader, loaderVersion: loader !== 'vanilla' ? el.querySelector('#ni-lv').value : null })
      m.close()
      await refresh()
      await quiet('select', 'java', inst.id)
      S.state.selected.java = inst.id
      toast(`${inst.name} is ready. Press Play — the first launch downloads the game.`, 'ok')
      go('java-home')
    } catch (err) {
      toast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Create instance'
    }
  }
}

/* ---------- Import from other launchers ---------- */
const LOADER_ALL = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' }
async function importModal (targetId) {
  const m = modal({
    title: 'Import from another launcher',
    wide: true,
    body: '<div id="imp-body"><div class="row" style="justify-content:center;padding:34px"><span class="spinner"></span><span class="muted">Looking for Modrinth, AstralRinth, Prism, CurseForge and other launchers…</span></div></div>',
    foot: '<button class="btn" data-pick>' + icon('folder', 'sm') + ' Pick a folder…</button><div class="spacer"></div><button class="btn ghost" data-x>Close</button>'
  })
  const body = () => m.el.querySelector('#imp-body')
  m.el.querySelector('[data-x]').onclick = m.close
  m.el.querySelector('[data-pick]').onclick = async () => {
    try { const e = await bridge.call('import:pickFolder'); if (e) importStep2(m, e, targetId) } catch (err) { toast(err.message, 'error') }
  }
  let found = []
  try { found = await bridge.call('import:detect') } catch (e) { found = [] }
  if (!document.body.contains(m.el)) return
  if (!found.length) {
    body().innerHTML = `<div class="empty" style="padding:30px">${icon('search')}<h4>No other launchers found automatically</h4><p>Click <b>Pick a folder…</b> and choose the instance folder from your other launcher — the one with <b>saves</b> or <b>mods</b> inside.<br><span class="dim">Modrinth App and AstralRinth keep them in %APPDATA%\\ModrinthApp\\profiles and %APPDATA%\\AstralRinthApp\\profiles.</span></p></div>`
    return
  }
  const groups = {}
  for (const f of found) (groups[f.launcher] = groups[f.launcher] || []).push(f)
  S.cache.importFound = found
  body().innerHTML = `<p class="muted" style="margin:0 0 6px">Pick what to bring over. Everything is <b>copied</b> — your other launcher keeps its files.</p>` + Object.entries(groups).map(([l, list]) => `
    <div class="side-sub" style="padding:12px 0 6px"><span>${esc(l)}</span></div>
    <div class="card list">${list.map(f => `<div class="list-row"><img src="${attr(blockIcon(f.dir, 'java'))}" alt="">
      <div class="t"><b>${esc(f.name)}</b><small>${f.mc ? 'Java ' + esc(f.mc) : 'Version unknown'}${f.loader ? ' · ' + LOADER_ALL[f.loader] : ''} · ${f.counts.worlds} world${f.counts.worlds === 1 ? '' : 's'} · ${f.counts.mods} mod${f.counts.mods === 1 ? '' : 's'}${f.counts.resourcepacks ? ' · ' + f.counts.resourcepacks + ' packs' : ''}</small></div>
      <button class="btn sm primary" data-imp="${found.indexOf(f)}">Import…</button></div>`).join('')}</div>`).join('')
  body().querySelectorAll('[data-imp]').forEach(b => { b.onclick = () => importStep2(m, found[+b.dataset.imp], targetId) })
}

async function importStep2 (m, src, targetId) {
  const body = m.el.querySelector('#imp-body')
  m.el.querySelector('.modal-head h2').textContent = `Import “${src.name}”`
  const foot = m.el.querySelector('.modal-foot')
  const unsupported = false
  const java = javaInstances()
  let into = targetId ? 'existing' : 'new'
  let loader = unsupported ? 'vanilla' : (src.loader || 'vanilla')
  if (!S.mc) { try { S.mc = await bridge.call('versions:minecraft') } catch {} }
  const versions = S.mc ? S.mc.versions.filter(v => v.type === 'release' || v.id === src.mc).map(v => v.id) : []
  if (src.mc && !versions.includes(src.mc)) versions.unshift(src.mc)
  const selVer = src.mc || (S.mc && S.mc.latest.release) || versions[0]
  const chk = (k, label, n, on = true, dis = false) => `<label class="check ${dis ? 'dis' : ''}"><input type="checkbox" data-w="${k}" ${on && !dis ? 'checked' : ''} ${dis ? 'disabled' : ''}><span>${label}${n != null ? ` <span class="dim">(${n})</span>` : ''}</span></label>`
  body.innerHTML = `
    <div class="notice" style="margin-bottom:4px">${icon('info')}<div>From <b>${esc(src.launcher)}</b>: ${src.mc ? 'Java ' + esc(src.mc) : 'version unknown'}${src.loader ? ' · ' + LOADER_ALL[src.loader] : ''}${src.guessed && src.mc ? ' <span class="dim">(guessed from the mods — check it below)</span>' : ''}<br><span class="dim" style="word-break:break-all">${esc(src.dir)}</span></div></div>
    ${unsupported ? `<div class="notice warn">${icon('alert')}<div>This instance uses <b>${LOADER_ALL[src.loader]}</b>, which Plunder can't run yet. Worlds, resource packs, shaders and settings import fine; ${LOADER_ALL[src.loader]} mods won't work, so they're left out.</div></div>` : ''}
    <div class="row"><span class="muted">Import into</span><div class="seg" id="imp-into"><button data-v="new" class="${into === 'new' ? 'on' : ''}">A new instance</button><button data-v="existing" class="${into === 'existing' ? 'on' : ''}" ${java.length ? '' : 'disabled'}>An existing instance</button></div></div>
    <div id="imp-new" style="${into === 'new' ? '' : 'display:none'}" class="stack">
      <label class="field"><span>Name</span><input class="input" id="imp-name" value="${attr(src.name)}"></label>
      <div class="form-grid">
        <label class="field"><span>Minecraft version</span><select class="input" id="imp-ver">${versions.map(v => `<option ${v === selVer ? 'selected' : ''}>${esc(v)}</option>`).join('') || '<option value="">Couldn\'t load versions</option>'}</select></label>
        <label class="field"><span>Mod loader</span><div class="seg" id="imp-loader">${['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'].map(l => `<button data-l="${l}" class="${loader === l ? 'on' : ''}">${LOADER_ALL[l]}</button>`).join('')}</div></label>
      </div>
    </div>
    <div id="imp-existing" style="${into === 'existing' ? '' : 'display:none'}"><label class="field"><span>Instance</span><select class="input" id="imp-target">${java.map(i => `<option value="${i.id}" ${i.id === targetId ? 'selected' : ''}>${esc(i.name)} — ${esc(versionLabel(i))}</option>`).join('')}</select></label></div>
    <div><div class="muted" style="margin-bottom:8px">What to bring over</div>
      <div class="check-grid">
        ${chk('worlds', 'Worlds', src.counts.worlds, true, !src.counts.worlds)}
        ${chk('mods', 'Mods', src.counts.mods, !unsupported, !src.counts.mods || unsupported)}
        ${chk('resourcepacks', 'Resource packs', src.counts.resourcepacks, true, !src.counts.resourcepacks)}
        ${chk('shaderpacks', 'Shader packs', src.counts.shaderpacks, true, !src.counts.shaderpacks)}
        ${chk('options', 'Settings & keybinds', null, true, !src.hasOptions)}
        ${chk('servers', 'Server list', null, true, !src.hasServers)}
        ${chk('screenshots', 'Screenshots', null, false, !src.hasScreenshots)}
      </div>
      ${src.worlds.length ? `<details class="mt"><summary class="muted" style="cursor:pointer">Choose which worlds (${src.worlds.length})</summary><div class="check-grid mt">${src.worlds.map(w => `<label class="check"><input type="checkbox" data-world="${attr(w)}" checked><span>${esc(w)}</span></label>`).join('')}</div></details>` : ''}
    </div>
    <div id="imp-warn"></div>`
  foot.innerHTML = '<button class="btn ghost" data-back>Back</button><div class="spacer"></div><button class="btn primary" data-go>' + icon('download', 'sm') + ' Import</button>'
  const warn = () => {
    const mods = body.querySelector('[data-w="mods"]')
    const target = into === 'new' ? loader : ((findInst(body.querySelector('#imp-target') && body.querySelector('#imp-target').value) || {}).loader)
    body.querySelector('#imp-warn').innerHTML = mods && mods.checked && target === 'vanilla' ? `<div class="notice warn">${icon('alert')}<div>Mods need a mod loader. ${into === 'new' ? 'Pick one above' : 'Pick an instance with a mod loader'}, or untick Mods.</div></div>` : ''
  }
  body.querySelector('#imp-into').onclick = e => {
    const b = e.target.closest('button[data-v]'); if (!b || b.disabled) return
    into = b.dataset.v
    body.querySelectorAll('#imp-into button').forEach(x => x.classList.toggle('on', x === b))
    body.querySelector('#imp-new').style.display = into === 'new' ? '' : 'none'
    body.querySelector('#imp-existing').style.display = into === 'existing' ? '' : 'none'
    warn()
  }
  body.querySelector('#imp-loader').onclick = e => {
    const b = e.target.closest('button[data-l]'); if (!b) return
    loader = b.dataset.l
    body.querySelectorAll('#imp-loader button').forEach(x => x.classList.toggle('on', x === b))
    warn()
  }
  body.onchange = warn
  warn()
  foot.querySelector('[data-back]').onclick = () => { m.close(); importModal(targetId) }
  foot.querySelector('[data-go]').onclick = async e => {
    const btn = e.currentTarget
    const what = {}
    body.querySelectorAll('[data-w]').forEach(c => { what[c.dataset.w] = c.checked })
    if (what.worlds) { const picked = [...body.querySelectorAll('[data-world]')].filter(c => c.checked).map(c => c.dataset.world); what.worlds = picked.length === src.worlds.length ? true : picked }
    const target = into === 'new'
      ? { create: { name: body.querySelector('#imp-name').value.trim() || src.name, mc: body.querySelector('#imp-ver').value, loader, loaderVersion: loader === src.loader ? src.loaderVersion : null } }
      : { instanceId: body.querySelector('#imp-target').value }
    if (target.create && !target.create.mc) return toast('Pick a Minecraft version', 'warn')
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Importing…'
    try {
      const r = await bridge.call('import:run', { dir: src.dir, target, what })
      m.close()
      await refresh()
      const d = r.done
      const bits = [d.worlds && `${d.worlds} world${d.worlds > 1 ? 's' : ''}`, d.mods && `${d.mods} mod${d.mods > 1 ? 's' : ''}`, d.resourcepacks && `${d.resourcepacks} resource pack${d.resourcepacks > 1 ? 's' : ''}`, d.shaderpacks && `${d.shaderpacks} shader pack${d.shaderpacks > 1 ? 's' : ''}`, ...d.other].filter(Boolean)
      toast(`Imported ${bits.length ? bits.join(', ') : 'nothing new'} into ${r.instance.name}.`, 'ok')
      go('instance', { id: r.instance.id, tab: d.worlds && !d.mods ? 'worlds' : 'content' })
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.innerHTML = icon('download', 'sm') + ' Import' }
  }
}

let loginModal = null
function showLogin () {
  if (loginModal) return
  loginModal = modal({
    title: 'Sign in with Microsoft',
    body: `<div id="login-body"><div class="row" style="justify-content:center;padding:30px"><span class="spinner"></span><span class="muted">Contacting Microsoft…</span></div></div>`,
    onClose: () => { loginModal = null; quiet('accounts:cancel') }
  })
}
function showLoginCode (c) {
  if (!loginModal) showLogin()
  const body = loginModal.el.querySelector('#login-body')
  body.innerHTML = `${c.reauth ? `<div class="notice warn">${icon('info')}<div>Your sign-in for <b>${esc(c.reauth)}</b> expired. Enter this code to continue.</div></div>` : ''}
    <ol class="steps" style="margin-bottom:6px"><li>Click the button below — it copies your code and opens Microsoft's sign-in page.</li><li>Paste the code there and sign in with the account that owns Minecraft.</li><li>Come back here — this window closes by itself.</li></ol>
    <div class="code-box"><div class="code">${esc(c.code)}</div><p>${esc(c.url.replace(/^https?:\/\//, ''))}</p></div>
    <button class="btn primary" style="height:46px;justify-content:center" id="login-go">${icon('copy', 'sm')} Copy code & open Microsoft</button>
    <div class="row" style="justify-content:center"><span class="spinner"></span><span class="muted">Waiting for you to finish signing in…</span></div>`
  body.querySelector('#login-go').onclick = () => { bridge.call('clipboard', c.code); bridge.call('open:url', c.url.startsWith('https') ? c.url : 'https://www.microsoft.com/link') }
}
async function addAccount () {
  showLogin()
  try {
    const acc = await bridge.call('accounts:add')
    if (loginModal) { const m = loginModal; loginModal = null; m.close() }
    toast(`Signed in as ${acc.name}`, 'ok')
    await refresh(); renderAll()
  } catch (e) {
    if (!loginModal) return
    loginModal.el.querySelector('#login-body').innerHTML = `<div class="notice warn">${icon('alert')}<div>${esc(e.message)}</div></div><button class="btn primary" id="login-retry">Try again</button>`
    loginModal.el.querySelector('#login-retry').onclick = () => { const m = loginModal; loginModal = null; m.close(); setTimeout(addAccount, 50) }
  }
}

/* ---------- actions ---------- */
async function installModpack (d, btn) {
  const k = 'pack:' + d.pid
  S.cache.installing = S.cache.installing || new Set()
  if (S.cache.installing.has(k)) return
  if (!d.direct) {
    const ok = await confirmBox(`Install ${d.title}?`, 'This creates a new instance with the modpack and everything it needs. Big packs can take a few minutes.', { ok: 'Install' })
    if (!ok) return
  }
  S.cache.installing.add(k)
  if (S.cache.search && S.cache.search.redraw) S.cache.search.redraw()
  try {
    const r = await bridge.call('modpack:install', { source: d.source, projectId: d.pid, title: d.title, icon: d.icon || null })
    await refresh()
    await quiet('select', 'java', r.instance.id)
    S.state.selected.java = r.instance.id
    toast(`${d.title} installed — it's selected on Home, ready to play.`, 'ok')
  } catch (e) { toast(e.message, 'error') } finally {
    S.cache.installing.delete(k)
    if (S.cache.search && S.cache.search.redraw) S.cache.search.redraw()
  }
}

const ACTIONS = {
  'win:min': () => bridge.call('win:min'),
  'win:max': () => bridge.call('win:max'),
  'win:close': () => bridge.call('win:close'),
  go: d => go(d.page),
  collapse: d => { S.collapsed[d.k] = !S.collapsed[d.k]; renderSidebar() },
  'open-instance': d => go('instance', { id: d.id }),
  'inst-tab': d => go('instance', { ...S.params, tab: d.tab }),
  'instance-settings': d => go('instance', { id: d.id, tab: 'settings' }),
  'new-instance': d => newInstanceModal(d.edition),
  'add-account': () => addAccount(),
  'acct-menu': (d, el) => {
    const accs = S.state.accounts || []
    showMenu(el, [
      ...(accs.length ? [{ heading: true, label: 'Accounts' }] : []),
      ...accs.map(a => ({ label: a.name, img: avatarUrl(a), on: a.id === S.state.activeAccount, run: async () => { await call('accounts:select', a.id); await refresh(); renderAll() } })),
      ...(accs.length ? ['-'] : []),
      { label: 'Skins & capes', icon: 'image', run: () => go('skins') },
      { label: 'Add Microsoft account', icon: 'plus', run: addAccount },
      ...(activeAccount() ? [{ label: `Sign out ${activeAccount().name}`, icon: 'logout', danger: true, run: () => ACTIONS['remove-account']({ id: S.state.activeAccount }) }] : [])
    ], { align: el.classList.contains('acct-row') ? 'left' : 'right' })
  },
  'select-account': async d => { await call('accounts:select', d.id); await refresh(); renderAll() },
  'remove-account': async d => {
    const a = (S.state.accounts || []).find(x => x.id === d.id)
    if (!await confirmBox('Sign out?', `Remove <b>${esc(a ? a.name : 'this account')}</b> from the launcher? You can sign in again any time.`, { ok: 'Sign out', danger: true })) return
    await call('accounts:remove', d.id); await refresh(); renderAll()
  },
  'pick-instance': (d, el) => {
    const ed = d.edition
    const list = ed === 'bedrock' ? bedrockInstances() : javaInstances()
    const cur = selectedInst(ed)
    showMenu(el, [
      ...list.map(i => ({ label: i.name, sub: ed === 'java' ? versionLabel(i) : '', img: instIcon(i), on: cur && i.id === cur.id, run: async () => { await quiet('select', ed, i.id); S.state.selected[ed] = i.id; renderMain() } })),
      '-',
      { label: ed === 'java' ? 'New instance' : 'New installation', icon: 'plus', run: () => newInstanceModal(ed) }
    ], { align: 'left' })
  },
  'bedrock-pick': (d, el) => ACTIONS['pick-instance']({ edition: 'bedrock' }, el),
  'mods-pick-instance': (d, el) => {
    showMenu(el, javaInstances().map(i => ({ label: i.name, sub: versionLabel(i), img: instIcon(i), on: i.id === S.params.instanceId, run: () => { S.params.instanceId = i.id; S.params.type = i.loader === 'vanilla' && S.params.type === 'mod' ? 'resourcepack' : S.params.type; quiet('select', 'java', i.id); S.state.selected.java = i.id; renderMain() } })), { align: 'left' })
  },
  'mods-param': d => { S.params[d.k] = d.v; renderMain() },
  'packs-param': d => { S.params[d.k] = d.v; renderMain() },
  'baddons-tab': d => { S.params.tab = d.tab; renderMain() },
  'browse-bedrock': async d => { await quiet('select', 'bedrock', d.id); S.state.selected.bedrock = d.id; go('bedrock-addons', { tab: 'browse' }) },
  'manage-servers': async d => { await quiet('select', 'bedrock', d.id); S.state.selected.bedrock = d.id; go('bedrock-servers') },
  'browse-for': d => { const i = findInst(d.id); go('java-mods', { instanceId: d.id, type: i && i.loader === 'vanilla' ? 'resourcepack' : 'mod' }) },
  'load-more': (d, el) => { el.disabled = true; el.innerHTML = '<span class="spinner"></span>'; S.cache.search && S.cache.search.more && S.cache.search.more() },
  'open-url': d => bridge.call('open:url', d.url),
  play: async d => {
    if (!d.id) return
    const inst = findInst(d.id)
    if (!inst) return
    if (inst.edition === 'java' && !activeAccount()) { toast('Sign in with your Microsoft account first.', 'warn'); return addAccount() }
    await quiet('select', inst.edition, inst.id)
    S.state.selected[inst.edition] = inst.id
    if (inst.edition === 'java' && inst.loader !== 'vanilla' && !d.force && !(await depsGate(inst))) return
    await call('instances:launch', inst.id, {})
    if (inst.edition === 'bedrock') { toast(inst.bedrockVersion ? `Starting Bedrock ${inst.bedrockVersion}…` : 'Opening Minecraft Bedrock…', 'ok'); await refresh(); renderRight() }
  },
  'play-world': async d => {
    const inst = findInst(d.id)
    if (!inst) return
    if (inst.edition === 'bedrock' || !d.world) return ACTIONS.play(d)
    if (!activeAccount()) { toast('Sign in with your Microsoft account first.', 'warn'); return addAccount() }
    await call('instances:launch', inst.id, { world: d.world })
  },
  kill: d => bridge.call('instances:kill', d.id),
  'inst-menu': (d, el) => {
    const inst = findInst(d.id); if (!inst) return
    const java = inst.edition === 'java'
    showMenu(el, [
      { label: 'Play', icon: 'play', run: () => ACTIONS.play(d) },
      { label: 'Open instance page', icon: 'box', run: () => go('instance', { id: d.id }) },
      ...(java ? [{ label: 'Add mods', icon: 'puzzle', run: () => ACTIONS['browse-for'](d) }, { label: 'Worlds & backups', icon: 'globe', run: () => go('instance', { id: d.id, tab: 'worlds' }) }] : [{ label: 'Add-ons', icon: 'puzzle', run: () => go('bedrock-addons') }]),
      { label: 'Open folder', icon: 'folder', run: () => bridge.call('instances:open', d.id) },
      ...(java ? [{ label: 'Quick settings', icon: 'sliders', run: () => quickSettings(d.id) }, { label: 'Export as modpack…', icon: 'upload', run: () => exportModal(d.id) }] : []),
      { label: 'Edit', icon: 'pencil', run: () => go('instance', { id: d.id, tab: 'settings' }) },
      '-',
      { label: 'Delete', icon: 'trash', danger: true, run: () => ACTIONS['delete-instance'](d) }
    ])
  },
  'open-folder': d => bridge.call('instances:open', d.id, d.sub),
  'delete-instance': async d => {
    const inst = findInst(d.id); if (!inst) return
    if (!await confirmBox(`Delete ${esc(inst.name)}?`, inst.edition === 'java' ? 'This permanently deletes the instance, its mods <b>and its worlds</b>. Back up any worlds you want to keep first.' : 'This removes the profile and its saved add-on files. Your Minecraft worlds are not touched.', { ok: 'Delete', danger: true })) return
    await call('instances:delete', d.id)
    await refresh()
    toast(`${inst.name} deleted`, 'ok')
    go(inst.edition === 'java' ? 'java-instances' : 'bedrock-instances')
  },
  'save-instance': async d => {
    const patch = { name: $('#f-name').value.trim() || findInst(d.id).name }
    if ($('#mem')) patch.memoryMax = Number($('#mem').value)
    if ($('#f-server')) patch.server = $('#f-server').value.trim()
    if ($('#f-jvm')) patch.jvmArgs = $('#f-jvm').value.trim()
    if ($('#f-notes')) patch.notes = $('#f-notes').value
    if ($('#f-bv')) {
      patch.bedrockVersion = $('#f-bv').value || null
      const o = $('#f-bv').selectedOptions[0]
      if (o && o.dataset.dl) {
        toast(`Downloading Bedrock ${o.dataset.v}. Watch the progress on the right.`, 'info')
        bridge.call('bv:install', { version: o.dataset.v, kind: o.dataset.k }).then(() => toast(`Bedrock ${o.dataset.v} is ready.`, 'ok')).catch(e => toast(e.message, 'error'))
      }
    }
    await call('instances:update', d.id, patch)
    await refresh(); renderAll(); toast('Saved', 'ok')
  },
  'pick-icon': async d => { const r = await call('instances:pickIcon', d.id); if (r) { await refresh(); renderAll() } },
  'reset-icon': async d => { await call('instances:update', d.id, { icon: null }); await refresh(); renderAll() },
  'content-filter': d => { S.params.filter = d.f; tabContent(findInst(S.params.id)) },
  'content-toggle': async (d, el) => {
    // Flip just this row — no redraw, so the list stays where you are.
    const row = el.closest('.list-row')
    const on = !el.classList.contains('on')
    el.classList.toggle('on', on); if (row) row.classList.toggle('off', !on)
    el.title = on ? 'Disable' : 'Enable'
    try { await call('content:toggle', d.id, d.key) } catch { el.classList.toggle('on', !on); if (row) row.classList.toggle('off', on) }
  },
  'content-delete': async d => {
    if (!await confirmBox('Remove this?', `Remove <b>${esc(d.title)}</b> from this instance?`, { ok: 'Remove', danger: true })) return
    await call('content:delete', d.id, d.key); await refresh(); tabContent(findInst(d.id))
  },
  'add-files': async d => {
    const n = await call('content:addFiles', d.id, [])
    if (n) { toast(`Added ${n} file${n > 1 ? 's' : ''}`, 'ok'); await refresh(); renderMain() }
  },
  'install-content': async d => {
    const bed = !!d.bedrock
    const instId = bed ? selectedInst('bedrock').id : S.params.instanceId
    const k = bed ? 'cf:' + d.pid : `${d.source}:${d.pid}`
    S.cache.installing = S.cache.installing || new Set()
    S.cache.installing.add(k)
    S.cache.search && S.cache.search.redraw && S.cache.search.redraw()
    try {
      const r = await bridge.call('content:install', { instanceId: instId, source: d.source, projectId: d.pid, type: S.params.type || 'mod', title: d.title, icon: d.icon || null })
      if (r && r.manual && r.url) toast(`${d.title} must be downloaded from CurseForge's website.`, 'warn', { url: r.url })
      else if (!bed) toast(`${d.title} installed${r.installed && r.installed.length > 1 ? ` with ${r.installed.length - 1} dependenc${r.installed.length > 2 ? 'ies' : 'y'}` : ''}`, 'ok')
      // Bedrock installs report their own result.
    } catch (e) { toast(e.message, 'error') } finally {
      S.cache.installing.delete(k)
      await refresh()
      S.cache.search && S.cache.search.redraw && S.cache.search.redraw()
    }
  },
  'install-modpack': (d, el) => installModpack(d, el),
  'copy-log': d => { bridge.call('clipboard', (S.logs[d.id] || []).join('')); toast('Log copied', 'ok') },
  'world-menu': (d, el) => showMenu(el, [
    { label: 'Play this world', icon: 'play', run: () => ACTIONS['play-world'](d) },
    { label: 'Back up now', icon: 'archive', run: () => ACTIONS['backup-world']({ edition: 'java', id: d.id, world: d.world }) },
    { label: 'Open folder', icon: 'folder', run: () => bridge.call('worlds:openJava', d.id, d.world) },
    { label: 'All backups', icon: 'restore', run: () => { S.cache.openBackups = `java|${d.id}|${d.world}`; go('java-worlds') } }
  ]),
  'bworld-menu': (d, el) => showMenu(el, [
    { label: 'Back up now', icon: 'archive', run: () => ACTIONS['backup-world']({ edition: 'bedrock', world: d.world, root: d.root }) },
    { label: 'Open folder', icon: 'folder', run: () => bridge.call('worlds:openBedrock', d.world, d.root) }
  ]),
  'backup-world': async d => {
    await call('worlds:backup', { edition: d.edition, instanceId: d.id, folder: d.world, root: d.root })
    toast('Backup saved', 'ok')
    S.hooks.refreshWorlds && S.hooks.refreshWorlds()
  },
  'toggle-backups': d => { S.cache.openBackups = S.cache.openBackups === d.key ? null : d.key; S.hooks.refreshWorlds && S.hooks.refreshWorlds() },
  'restore-backup': async d => {
    const b = JSON.parse(d.b)
    if (!await confirmBox('Restore backup?', `This adds the backup from <b>${fmtDate(b.created)}</b> as a <b>new copy</b> of the world. Your current world stays untouched.`, { ok: 'Restore' })) return
    await call('worlds:restore', b); toast('World restored as a copy', 'ok'); S.hooks.refreshWorlds && S.hooks.refreshWorlds()
  },
  'import-backup': async d => { const r = await call('worlds:importBackup', JSON.parse(d.b)); toast(`Installed ${r} into Minecraft.`, 'ok') },
  'show-backup': d => call('worlds:showBackup', JSON.parse(d.b)),
  'delete-backup': async d => {
    if (!await confirmBox('Delete backup?', 'This backup file will be permanently deleted.', { ok: 'Delete', danger: true })) return
    await call('worlds:deleteBackup', JSON.parse(d.b)); S.hooks.refreshWorlds && S.hooks.refreshWorlds()
  },
  'open-world': d => d.edition === 'java' ? call('worlds:openJava', d.id, d.world) : call('worlds:openBedrock', d.world, d.root),
  'delete-world': async d => {
    if (!await confirmBox('Delete world?', `Permanently delete <b>${esc(d.world)}</b>? Make a backup first if you might want it back.`, { ok: 'Delete world', danger: true })) return
    await call('worlds:deleteJava', d.id, d.world); S.hooks.refreshWorlds && S.hooks.refreshWorlds()
  },
  'open-backups': () => call('worlds:openBackups'),
  'open-bedrock-data': () => call('bedrock:openData'),
  'pick-bedrock-data': async () => { const r = await call('bedrock:pickData'); if (r) { S.bedrock = await quiet('bedrock:info'); await refresh(); renderMain() } },
  'open-data': () => call('open:data'),
  'import-addon': async d => { const r = await call('bedrock:importAddon', d.id, d.file); toast(`Installed ${r} into Minecraft. If Minecraft is open, restart it to see it.`, 'ok') },
  'remove-addon': async d => { await call('bedrock:removeAddon', d.id, d.file); await refresh(); renderMain() },
  'import-open': d => importModal(d.id || null),
  'quick-settings': d => quickSettings(d.id),
  'update-save': async () => { S.state.settings = await call('settings:set', { updateRepo: $('#upd-repo').value.trim() }); loadUpdateStatus(true) },
  'update-install': async (d, el) => { el.disabled = true; el.innerHTML = '<span class="spinner"></span> Downloading…'; try { await bridge.call('update:install') } catch (e) { toast(e.message, 'error'); el.disabled = false; el.textContent = 'Update now' } },
  'skin-add': async d => { const n = await call('skins:add', d.v || 'classic'); if (n) { toast(`Added ${n} skin${n > 1 ? 's' : ''}.`, 'ok'); S.hooks.skinLib && S.hooks.skinLib() } },
  'skin-variant': async d => { await call('skins:update', d.id, { variant: d.v }); S.hooks.skinLib && S.hooks.skinLib() },
  'skin-remove': async d => { if (!await confirmBox('Delete this skin?', 'It\'s removed from your library (not from your account).', { ok: 'Delete', danger: true })) return; await call('skins:remove', d.id); S.hooks.skinLib && S.hooks.skinLib() },
  'skin-wear': async (d, el) => { el.disabled = true; el.innerHTML = '<span class="spinner"></span>'; try { const p = await bridge.call('skins:wear', d.id); S.hooks.skinProfile && S.hooks.skinProfile(p); toast('Skin changed! It shows in-game next time you join a world.', 'ok') } catch (e) { toast(e.message, 'error') } el.disabled = false; el.textContent = 'Wear' },
  'skin-save-current': async () => { try { await bridge.call('skins:saveCurrent'); toast('Saved your current skin to the library.', 'ok'); S.hooks.skinLib && S.hooks.skinLib() } catch (e) { toast(e.message, 'error') } },
  'skin-cape': async (d, el) => { document.querySelectorAll('.cape').forEach(c => c.classList.remove('on')); el.classList.add('on'); try { const p = await bridge.call('skins:cape', d.id || null); S.hooks.skinProfile && S.hooks.skinProfile(p); toast(d.id ? 'Cape changed.' : 'Cape hidden.', 'ok') } catch (e) { toast(e.message, 'error') } },
  'deps-install': async d => {
    try { await bridge.call('deps:install', d.id, d.mod); toast(`Installed ${d.mod}.`, 'ok') } catch (e) { toast(`Couldn't find “${d.mod}” on Modrinth automatically. Search for it with Browse content. (${e.message})`, 'error') }
    await refresh(); S.hooks.refreshContent && S.hooks.refreshContent()
  },
  'crash-disable': async (d, el) => {
    try { await bridge.call('content:disableFile', d.id, d.file); el.disabled = true; el.textContent = 'Turned off'; toast(`Turned off ${d.file}. Try playing again.`, 'ok') } catch (e) { toast(e.message, 'error') }
    S.hooks.refreshContent && S.hooks.refreshContent()
  },
  'crash-open': d => call('crash:open', d.file),
  'go-log': d => { const b = document.querySelector('#modal-root .backdrop:last-child [data-close]'); if (b) b.click(); go('instance', { id: d.id, tab: 'log' }) },
  'explain-crash': async d => {
    const a = await quiet('crash:analyze', d.id)
    if (!a) return toast('No crash report or log found for this instance yet.', 'info')
    showCrash({ instanceId: d.id, name: findInst(d.id).name, analysis: a })
  },
  'import-pack-file': async () => {
    try {
      const r = await bridge.call('modpack:importFile', null)
      if (r) { await refresh(); toast(`Modpack “${r.instance.name}” installed.`, 'ok'); go('instance', { id: r.instance.id }) }
    } catch (e) { toast(e.message, 'error') }
  },
  'export-pack': d => exportModal(d.id),
  'check-updates': async (d, el) => {
    el.disabled = true; el.innerHTML = '<span class="spinner"></span>'
    try {
      const r = await bridge.call('updates:check', d.id)
      S.cache.updates = S.cache.updates || {}; S.cache.updates[d.id] = r.updates
      S.cache.updErrors = S.cache.updErrors || {}; S.cache.updErrors[d.id] = r.errors.join(' ')
    } catch (e) { toast(e.message, 'error') }
    if (S.hooks.refreshContent) S.hooks.refreshContent()
  },
  'update-one': async d => {
    S.cache.updating = S.cache.updating || new Set(); S.cache.updating.add(d.id + '|' + d.key)
    S.hooks.refreshContent && S.hooks.refreshContent()
    try { await bridge.call('updates:one', d.id, d.key); delete S.cache.updates[d.id][d.key] } catch (e) { toast(e.message, 'error') }
    S.cache.updating.delete(d.id + '|' + d.key)
    await refresh(); S.hooks.refreshContent && S.hooks.refreshContent()
  },
  'update-all': async d => {
    S.cache.updatingAll = d.id; drawUpdBar(findInst(d.id))
    try {
      const r = await bridge.call('updates:all', d.id)
      toast(r.failed.length ? `Updated ${r.updated}. Couldn't update: ${r.failed.join(', ')}` : `Updated ${r.updated} item${r.updated === 1 ? '' : 's'}.`, r.failed.length ? 'warn' : 'ok')
      const left = await bridge.call('updates:check', d.id); S.cache.updates[d.id] = left.updates
    } catch (e) { toast(e.message, 'error') }
    S.cache.updatingAll = null
    await refresh(); S.hooks.refreshContent && S.hooks.refreshContent()
  },
  'bdata-toggle': async d => {
    const inst = findInst(d.id); const on = !inst.bedrockIsolated
    let copy = false
    if (on) {
      const m = await new Promise(res => {
        const md = modal({ title: 'Give this installation its own folder?', body: `<p class="muted" style="margin:0">From now on, <b>${esc(inst.name)}</b> keeps its own worlds, add-ons and settings. Your normal worlds stay safe and are used by your other installations.</p><label class="check"><input type="checkbox" id="cp" checked><span>Start with a copy of my current worlds and add-ons</span></label>`, foot: '<button class="btn ghost" data-n>Cancel</button><button class="btn primary" data-y>Turn on</button>', onClose: () => res(null) })
        md.el.querySelector('[data-n]').onclick = () => md.close()
        md.el.querySelector('[data-y]').onclick = () => { const c = md.el.querySelector('#cp').checked; res({ copy: c }); md.close() }
      })
      if (!m) return
      copy = m.copy
    } else if (!await confirmBox('Use the normal folder again?', `<b>${esc(inst.name)}</b> will use your normal Minecraft worlds and add-ons. Its own folder is kept (not deleted), so you can turn this back on later.`, { ok: 'Switch' })) return
    try { await bridge.call('instances:setIsolated', d.id, on, copy); toast(on ? 'This installation now has its own worlds and add-ons.' : 'This installation uses your normal folder again.', 'ok') } catch (e) { toast(e.message, 'error') }
    await refresh(); drawBdata(findInst(d.id))
  },
  'bdata-copy': async d => {
    if (!await confirmBox('Copy your worlds in?', 'Copies your normal worlds, add-ons and settings into this installation. Anything with the same name that\'s already here is kept.', { ok: 'Copy' })) return
    const t = toast; try { await bridge.call('bdata:copyShared', d.id); t('Copied.', 'ok') } catch (e) { t(e.message, 'error') }
    drawBdata(findInst(d.id))
  },
  'bdata-open': d => call('bdata:open', d.id),
  'bv-kind': d => { S.params.kind = d.v; renderMain() },
  'bv-folder': () => call('bv:openFolder'),
  'bv-dev': () => call('bv:devSettings'),
  'bv-restore': async d => {
    if (!await confirmBox('Restore the Store version?', 'Plunder will take its version off Windows and open the Microsoft Store page so you can reinstall the official copy. Your worlds and settings stay.', { ok: 'Restore' })) return
    await call('bv:restoreStore', d.kind || 'release'); toast('Click Install (or Get) in the Microsoft Store to bring the official copy back.', 'info'); renderMain()
  },
  'bv-install': async d => {
    const st = S.cache.bvCheck
    if (st && st.supported && !st.devMode) { toast('Turn on Developer Mode first (button in One-time setup).', 'warn'); return }
    if (!await confirmBox(`Install Bedrock ${esc(d.v)}?`, 'Plunder downloads it from Microsoft (about 1–2 GB), then Windows asks for permission to unpack it. While it unpacks, the Store copy of Minecraft is taken off — your worlds and settings stay. Close Minecraft before you start.', { ok: 'Install' })) return
    setTimeout(() => S.hooks.bvRedraw && S.hooks.bvRedraw(), 300)
    try { await bridge.call('bv:install', { version: d.v, kind: d.kind }); toast(`Bedrock ${d.v} is installed. Pick it in a profile's settings, or click Play.`, 'ok') } catch (e) { toast(e.message, 'error') }
    if (S.page === 'bedrock-versions') renderMain()
  },
  'bv-remove': async d => {
    if (!await confirmBox('Delete this version?', `Delete Bedrock ${esc(d.id)} from Plunder? Profiles using it switch back to the Store version. Worlds aren't touched.`, { ok: 'Delete', danger: true })) return
    await call('bv:remove', d.id); await refresh(); renderMain()
  },
  'bv-play': async d => {
    try { await bridge.call('bv:launch', d.id); toast('Starting Minecraft…', 'ok') } catch (e) { toast(e.message, 'error') }
    renderMain()
  },
  'bv-new-profile': async d => {
    const inst = await call('instances:create', { edition: 'bedrock', name: 'Bedrock ' + d.id.replace(/-preview$/, ' Preview'), bedrockVersion: d.id })
    await refresh(); await quiet('select', 'bedrock', inst.id); S.state.selected.bedrock = inst.id; go('bedrock-home')
  },
  'assoc-setup': async () => { await call('assoc:setup'); toast('In the Windows box: pick Plunder, then click “Always”.', 'info'); setTimeout(loadAssocStatus, 8000) },
  'assoc-remove': async () => { await call('assoc:remove'); toast('Plunder no longer offers to open add-on files. Pick another app the next time you open one.', 'ok'); loadAssocStatus() },
  'refresh-packs': () => { S.cache.gamePacks = null; const el = $('#game-packs'); if (el) { el.innerHTML = gamePacksHtml(null); loadGamePacks(el, $('#gp-count')) } },
  'import-world': async d => {
    try {
      const r = await bridge.call('import:world', d.id, d.kind)
      if (r) { toast(`World “${r.name}” imported`, 'ok'); S.hooks.refreshWorlds && S.hooks.refreshWorlds() }
    } catch (e) { toast(e.message, 'error') }
  },
  'import-world-menu': (d, el) => {
    const java = javaInstances()
    if (!java.length) return importModal()
    showMenu(el, [
      { label: 'Everything from another launcher…', icon: 'download', run: () => importModal() },
      '-',
      { heading: true, label: 'A single world into…' },
      ...java.map(i => ({ label: i.name, sub: versionLabel(i), img: instIcon(i), run: () => showMenu(el, [{ label: 'World folder…', icon: 'folder', run: () => ACTIONS['import-world']({ id: i.id, kind: 'folder' }) }, { label: 'World .zip…', icon: 'archive', run: () => ACTIONS['import-world']({ id: i.id, kind: 'zip' }) }]) }))
    ])
  },
  'bedrock-import-world': async () => {
    const done = await call('bedrock:importWorld')
    if (done && done.length) { toast(`Installed ${done.join(', ')} into Minecraft.`, 'ok'); S.hooks.refreshWorlds && S.hooks.refreshWorlds() }
  },
  'web-open': d => call('web:open', d.url || '', (selectedInst('bedrock') || {}).id, d.site || 'planetminecraft'),
  'web-more': () => S.cache.webMore && S.cache.webMore(),
  'web-get': async d => {
    const k = 'web:' + d.url
    S.cache.installing = S.cache.installing || new Set()
    S.cache.installing.add(k); S.cache.webRedraw && S.cache.webRedraw()
    try {
      const r = await bridge.call('web:get', { url: d.url, title: d.title, instanceId: (selectedInst('bedrock') || {}).id })
      if (r && r.opened) toast(r.count > 1 ? `${d.title} has ${r.count} files — pick one in the add-on browser.` : `Opened ${d.title} so you can download it.`, 'info')
      else toast(`Downloading ${d.title}…`, 'ok')
    } catch (e) { toast(e.message, 'error') } finally { S.cache.installing.delete(k); S.cache.webRedraw && S.cache.webRedraw() }
  },
  'baddons-param': d => { S.params[d.k] = d.v; if (d.k === 'source') S.params.sort = ''; renderMain() },
  'srv-refresh': () => { S.cache.srvStatus = {}; S.hooks.srvRefresh && S.hooks.srvRefresh() },
  'srv-add': async d => {
    const host = $('#s-host').value.trim()
    if (!host) return toast('Enter the server address', 'warn')
    const list = [...(S.cache.servers || []), { name: $('#s-name').value.trim(), host, port: Number($('#s-port').value), edition: d.edition }]
    S.cache.servers = await call('servers:save', list)
    toast('Server saved', 'ok'); renderMain()
  },
  'srv-adopt': async d => {
    S.cache.servers = await call('servers:save', [...(S.cache.servers || []), { name: d.name, host: d.host, port: Number(d.port), edition: d.edition, instanceId: d.inst || null }])
    toast('Saved to Plunder', 'ok'); renderMain()
  },
  'srv-remove': async d => {
    const sv = (S.cache.servers || []).find(x => x.id === d.id)
    if (!await confirmBox('Remove server?', `Remove <b>${esc(sv ? sv.name : 'this server')}</b> from your saved servers?`, { ok: 'Remove', danger: true })) return
    S.cache.servers = await call('servers:save', (S.cache.servers || []).filter(x => x.id !== d.id)); renderMain()
  },
  'srv-edit': d => {
    const sv = (S.cache.servers || []).find(x => x.id === d.id); if (!sv) return
    const m = modal({
      title: 'Edit server',
      body: `<label class="field"><span>Name</span><input class="input" id="e-name" value="${attr(sv.name)}"></label><div class="form-grid"><label class="field"><span>Address</span><input class="input" id="e-host" value="${attr(sv.host)}"></label><label class="field"><span>Port</span><input class="input" id="e-port" value="${sv.port}"></label></div>`,
      foot: '<button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok>Save</button>'
    })
    m.el.querySelector('[data-x]').onclick = m.close
    m.el.querySelector('[data-ok]').onclick = async () => {
      const list = (S.cache.servers || []).map(x => x.id === sv.id ? { ...x, name: m.el.querySelector('#e-name').value.trim(), host: m.el.querySelector('#e-host').value.trim(), port: Number(m.el.querySelector('#e-port').value) } : x)
      S.cache.servers = await call('servers:save', list); m.close(); renderMain()
    }
  },
  'srv-join': async (d, el) => {
    if (d.edition === 'bedrock') { await call('bedrock:join', d.host, d.port); return toast(`Opening Minecraft and joining ${d.host}…`, 'ok') }
    const addr = Number(d.port) === 25565 ? d.host : `${d.host}:${d.port}`
    const java = javaInstances()
    if (!java.length) return toast('Create a Java instance first.', 'warn')
    const joinWith = async inst => {
      if (!activeAccount()) { toast('Sign in with your Microsoft account first.', 'warn'); return addAccount() }
      await call('instances:launch', inst.id, { server: addr })
      toast(`Launching ${inst.name} and joining ${d.host}…`, 'ok')
    }
    const pre = java.find(i => i.id === d.inst)
    if (pre || java.length === 1) return joinWith(pre || java[0])
    const st = (S.cache.srvStatus || {})[srvKey({ id: (S.cache.servers || []).find(x => x.host === d.host && x.port === Number(d.port))?.id, edition: 'java', host: d.host, port: Number(d.port) })]
    const ver = st && st.version ? st.version : ''
    showMenu(el, [{ heading: true, label: ver ? `Server runs ${ver}` : 'Join with which instance?' }, ...java.map(i => ({ label: i.name, sub: versionLabel(i), img: instIcon(i), on: ver && ver.includes(i.mc), run: () => joinWith(i) }))], { align: 'left' })
  },
  'toggle-left': async () => { S.state.settings = await call('settings:set', { leftCollapsed: !S.state.settings.leftCollapsed }); applyLayout() },
  'toggle-right': async () => { S.state.settings = await call('settings:set', { rightHidden: !S.state.settings.rightHidden }); applyLayout() },
  'toggle-layout': async (d, el) => {
    const v = !S.state.settings[d.k]
    S.state.settings = await call('settings:set', { [d.k]: v })
    el.classList.toggle('on', d.k === 'rightHidden' ? !v : v)
    applyLayout()
  },
  'add-server-game': async d => { await call('bedrock:addServer', d.name, d.host, d.port); toast('Minecraft will open and add it to your Servers tab', 'ok') },
  'toggle-key': () => { const i = $('#cf-key'); i.type = i.type === 'password' ? 'text' : 'password' },
  'save-cf': async () => {
    const out = $('#cf-result')
    S.state.settings = await call('settings:set', { curseforgeKey: $('#cf-key').value })
    $('#cf-key').value = S.state.settings.curseforgeKey
    if (!S.state.settings.curseforgeKey) { out.innerHTML = '<span class="muted">Key removed.</span>'; return }
    out.innerHTML = '<span class="row"><span class="spinner"></span> Testing your key with CurseForge…</span>'
    try {
      await bridge.call('cf:test')
      out.innerHTML = `<span class="ok-text">${icon('check', 'sm')} Key works — CurseForge is ready.</span>`
      S.cache.search = null
    } catch (e) {
      out.innerHTML = `<div class="notice warn">${icon('alert')}<div>${esc(e.message)}<br><span class="dim">Saved key is ${S.state.settings.curseforgeKey.length} characters long${S.state.settings.curseforgeKey.startsWith('$2a$') ? '' : " and doesn't start with $2a$ like CurseForge keys usually do"}.</span></div></div>`
    }
  },
  'toggle-setting': async (d, el) => { const v = !S.state.settings[d.k]; S.state.settings = await call('settings:set', { [d.k]: v }); el.classList.toggle('on', v) },
  'save-java': async () => {
    S.state.settings = await call('settings:set', { memoryMax: Number($('#mem').value), javaPath: $('#java-path').value.trim(), jvmArgs: $('#jvm-args').value.trim() })
    toast('Java settings saved', 'ok')
  }
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]')
  if (!el || el.disabled) return
  if (el.tagName === 'A') e.preventDefault()
  // Clicks on a kebab inside a clickable card shouldn't also trigger the card.
  e.stopPropagation()
  const fn = ACTIONS[el.dataset.act]
  if (fn) Promise.resolve(fn({ ...el.dataset }, el)).catch(() => {})
})

/* ---------- drag & drop files ---------- */
function dropTarget () {
  if (S.page === 'instance') return S.params.id
  const ed = editionOfPage()
  if (S.page === 'java-mods' && S.params.instanceId) return S.params.instanceId
  const i = selectedInst(ed)
  return i && i.id
}
let dragDepth = 0
window.addEventListener('dragenter', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; $('#drop-overlay').classList.add('show') } })
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#drop-overlay').classList.remove('show') })
window.addEventListener('dragover', e => e.preventDefault())
window.addEventListener('drop', async e => {
  e.preventDefault(); dragDepth = 0; $('#drop-overlay').classList.remove('show')
  let paths = [...e.dataTransfer.files].map(f => bridge.filePath(f)).filter(Boolean)
  if (S.page === 'skins') {
    let n = 0
    for (const p of paths.filter(p => /\.png$/i.test(p))) { try { await bridge.call('skins:addPath', p, 'classic'); n++ } catch (err) { toast(err.message, 'error') } }
    if (n) { toast(`Added ${n} skin${n > 1 ? 's' : ''}.`, 'ok'); S.hooks.skinLib && S.hooks.skinLib() }
    return
  }
  const packs = paths.filter(p => /\.mrpack$/i.test(p))
  for (const p of packs) {
    toast(`Installing modpack ${p.split(/[\\/]/).pop()}…`, 'info')
    bridge.call('modpack:importFile', p).then(async r => { await refresh(); toast(`Modpack “${r.instance.name}” installed.`, 'ok'); renderAll() }).catch(err => toast(err.message, 'error'))
  }
  paths = paths.filter(p => !/\.mrpack$/i.test(p))
  if (!paths.length) return
  const id = dropTarget()
  if (!id) return toast('Create an instance first, then drop files onto it.', 'warn')
  const n = await call('content:addFiles', id, paths)
  const inst = findInst(id)
  toast(n ? `Added ${n} file${n > 1 ? 's' : ''} to ${inst ? inst.name : 'instance'}` : 'Those files aren\'t mods, packs or add-ons.', n ? 'ok' : 'warn')
  await refresh(); renderMain()
})

/* ---------- live updates from the launcher ---------- */
bridge.on('task', t => {
  S.tasks.set(t.id, t)
  if (t.done) setTimeout(() => { S.tasks.delete(t.id); queueRight(); if (t.instanceId) refreshPlayButtons() }, t.error ? 15000 : 4000)
  queueRight()
  if (t.instanceId && (t.done || !S._seen?.has(t.id))) { (S._seen = S._seen || new Set()).add(t.id); refreshPlayButtons() }
})
bridge.on('log', ({ instanceId, line }) => {
  const arr = S.logs[instanceId] = S.logs[instanceId] || []
  arr.push(line.endsWith('\n') ? line : line + '\n')
  if (arr.length > 3000) arr.splice(0, arr.length - 3000)
  const el = $('#log')
  if (el && S.page === 'instance' && S.params.id === instanceId) {
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 30
    el.textContent += arr[arr.length - 1]
    if (atBottom) el.scrollTop = el.scrollHeight
  }
})
bridge.on('game', async g => {
  if (g.running) S.running.add(g.instanceId); else S.running.delete(g.instanceId)
  await refresh()
  renderSidebar(); renderRight(); refreshPlayButtons()
})
bridge.on('packs-changed', () => { S.cache.gamePacks = null; const el = $('#game-packs'); if (el) loadGamePacks(el, $('#gp-count')); S.hooks.refreshWorlds && S.hooks.refreshWorlds() })
bridge.on('assoc-changed', () => loadAssocStatus())
bridge.on('crash', c => showCrash(c))
bridge.on('update-available', r => toast(`Plunder ${r.latest} is available. Go to Settings → Updates to install it.`, 'info'))
bridge.on('bedrock-versions-changed', () => { if (S.page === 'bedrock-versions') renderMain() })
bridge.on('toast', t => toast(t.text, t.kind || 'info', { url: t.url }))
bridge.on('auth-code', c => showLoginCode(c))
bridge.on('auth-done', () => { if (loginModal) { const m = loginModal; loginModal = null; m.close() } })
bridge.on('instances-changed', debounce(async () => {
  await refresh()
  renderSidebar()
  S.hooks.instancesChanged && S.hooks.instancesChanged()
}, 250))

// Re-render only the parts showing play state, so typing in inputs isn't interrupted.
function refreshPlayButtons () {
  const pill = document.querySelector('.status-pill'); if (pill) pill.outerHTML = statusPill()
  if (['java-home', 'bedrock-home', 'instance', 'java-instances'].includes(S.page)) {
    if (S.page === 'instance' && ['settings'].includes(S.params.tab)) { const b = document.querySelector('.inst-head .btn-play'); const inst = findInst(S.params.id); if (b && inst) b.outerHTML = playButton(inst); return }
    if (S.page === 'instance' && S.params.tab === 'log') { const b = document.querySelector('.inst-head .btn-play'); const inst = findInst(S.params.id); if (b && inst) b.outerHTML = playButton(inst); return }
    renderMain()
  }
}

async function refresh () {
  const [state, instances] = await Promise.all([bridge.call('state:get'), bridge.call('instances:list')])
  S.state = state
  S.instances = instances
  S.running = new Set(state.running)
}

/* ---------- layout toggles ---------- */
function applyLayout () {
  const st = (S.state && S.state.settings) || {}
  $('#app').classList.toggle('left-collapsed', !!st.leftCollapsed)
  $('#app').classList.toggle('right-hidden', !!st.rightHidden)
  document.body.classList.toggle('right-hidden', !!st.rightHidden)
  const l = $('#toggle-left'), r = $('#toggle-right')
  if (l) l.title = st.leftCollapsed ? 'Expand sidebar' : 'Collapse sidebar'
  if (r) { r.title = st.rightHidden ? 'Show right panel' : 'Hide right panel'; r.classList.toggle('on', !st.rightHidden) }
}

/* ---------- start ---------- */
;(async () => {
  $('#logo').innerHTML = LOGO_SVG
  $('#drop-icon').innerHTML = icon('upload')
  $('#toggle-left').innerHTML = icon('sidebar', 'sm')
  $('#toggle-right').innerHTML = icon('panelRight', 'sm')
  await refresh()
  applyLayout()
  // Make sure there's always a Bedrock profile to hold add-ons & servers.
  if (!bedrockInstances().length) { try { await bridge.call('instances:create', { edition: 'bedrock', name: 'My Bedrock' }); await refresh() } catch {} }
  renderAll()
  if (S.state.migratedFrom) toast(`Moved your Plunder data into the “Plunder Data” folder next to Plunder.exe — everything stays in one place now.`, 'ok')
  S.bedrock = await quiet('bedrock:info') || { version: null, roots: [] }
  quiet('bv:check').then(st => { if (st && st.supported) { S.cache.bvCheck = st; S.bvActiveDev = !!(st.active.release && st.active.release.dev) } })
  renderAll()
})()
