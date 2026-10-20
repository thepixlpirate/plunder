// Website sources for Bedrock add-ons: Planet Minecraft and ModBay.
// Neither site has a public API, so Plunder:
//  1) reads their listing pages in a hidden browser to show results inside the launcher,
//  2) for ModBay, downloads the add-on file directly ("Get"), and
//  3) opens a small built-in browser for anything else. Anything downloaded there is caught,
//     saved into your Bedrock profile and handed to Minecraft to import.
const { BrowserWindow, WebContentsView, session, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const store = require('./store')
const events = require('./events')

const PART = 'persist:plunder-web'

const SITES = {
  planetminecraft: {
    name: 'Planet Minecraft',
    base: 'https://www.planetminecraft.com',
    itemRe: /^https:\/\/www\.planetminecraft\.com\/(mod|texture-pack|project|skin|data-pack)\/[^/?#]+\/?$/,
    authorSel: 'a[href*="/member/"]',
    cats: {
      addons: { label: 'Add-ons', path: '/mods/tag/bedrock/', searchPath: '/mods/', searchParams: { platform: '2' } },
      textures: { label: 'Texture packs', path: '/texture-packs/', params: { platform: '2' } },
      maps: { label: 'Maps', path: '/projects/', params: { platform: '2' } }
    },
    listUrl ({ cat = 'addons', query = '', sort = '', page = 1, alt = false }) {
      const c = this.cats[cat] || this.cats.addons
      const u = new URL(this.base + (query && c.searchPath && !alt ? c.searchPath : c.path))
      for (const [k, v] of Object.entries((query && !alt && c.searchParams) || c.params || {})) u.searchParams.set(k, v)
      if (query) u.searchParams.set('keywords', query)
      const ORD = { downloads: 'order_downloads', popular: 'order_popularity', updated: 'order_updated', newest: 'order_latest' }
      if (ORD[sort]) u.searchParams.set('order', ORD[sort])
      if (page > 1) u.searchParams.set('p', String(page))
      return u.toString()
    }
  },
  modbay: {
    name: 'ModBay',
    base: 'https://modbay.org',
    itemRe: /^https:\/\/modbay\.org\/(mods|maps|textures|seeds|skins|shaders)\/\d+-[^/?#]+\.html$/,
    authorSel: 'a[href*="/user/"]',
    directDownload: true,
    cats: {
      addons: { label: 'Add-ons', path: '/mods/' },
      textures: { label: 'Texture packs', path: '/textures/' },
      maps: { label: 'Maps', path: '/maps/' }
    },
    listUrl ({ cat = 'addons', query = '', page = 1 }) {
      if (query) {
        const u = new URL(this.base + '/index.php')
        u.searchParams.set('do', 'search'); u.searchParams.set('subaction', 'search'); u.searchParams.set('story', query)
        if (page > 1) { u.searchParams.set('search_start', String(page)); u.searchParams.set('full_search', '0'); u.searchParams.set('result_from', String((page - 1) * 20 + 1)) }
        return u.toString()
      }
      const c = this.cats[cat] || this.cats.addons
      return this.base + c.path + (page > 1 ? `page/${page}/` : '')
    }
  }
}

function site (id) { return SITES[id] || SITES.planetminecraft }
function ses () { return session.fromPartition(PART) }

// ---------- 1) Reading listings ----------
let reader = null
let queue = Promise.resolve()
const cache = new Map()

function scrapeScript (s) {
  return `(() => {
  const RE = ${s.itemRe.toString()};
  const seen = new Map();
  const text = el => (el && el.textContent || '').replace(/\\s+/g, ' ').trim();
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.href.split('#')[0].split('?')[0];
    if (!RE.test(href)) continue;
    if (a.closest('aside, footer, nav, [class*="sidebar"], [class*="comment"], [class*="top-"], [id*="sidebar"]')) continue;
    let box = a.closest('li, article') || a.closest('[class*="resource"], [class*="short"], [class*="post"], [class*="item"]') || a.parentElement;
    for (let i = 0; i < 4 && box && box.querySelectorAll('a[href]').length < 2; i++) box = box.parentElement;
    const cur = seen.get(href) || { url: href, title: '', image: '', author: '', description: '', versions: '' };
    const t = text(a);
    if (t.length > cur.title.length && t.length < 160) cur.title = t;
    if (box) {
      const img = [...box.querySelectorAll('img')].find(i => !/avatar|member|badge|logo|icon|flag/i.test(i.className + ' ' + (i.getAttribute('src') || '')));
      const src = img && (img.getAttribute('data-src') || img.getAttribute('data-original') || img.currentSrc || img.src);
      if (src && !cur.image && !/^data:/.test(src)) cur.image = src;
      if (!cur.title && img && img.alt) cur.title = img.alt;
      const au = box.querySelector(${JSON.stringify(s.authorSel)});
      if (au && !cur.author) cur.author = text(au);
      const d = box.querySelector('[class*="desc"], [class*="text"], p');
      if (d && !cur.description) cur.description = text(d).slice(0, 220);
    }
    seen.set(href, cur);
  }
  const items = [...seen.values()].filter(x => x.title && x.title.length > 2);
  const next = !![...document.querySelectorAll('a[href]')].find(a => /(page\\/|[?&]p=|search_start=)\\d+/.test(a.href) && /next|›|»|→/i.test(a.textContent + ' ' + a.className + ' ' + (a.rel || '')));
  return { title: document.title, items, next, url: location.href };
})()`
}

function getReader () {
  if (reader && !reader.isDestroyed()) return reader
  reader = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { partition: PART, sandbox: true } })
  reader.webContents.setAudioMuted(true)
  reader.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  return reader
}

function load (w, url) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); resolve() }, 25000)
    const ok = () => { cleanup(); resolve() }
    const bad = (_e, code, desc, _u, isMain) => { if (isMain === false || code === -3) return; cleanup(); reject(new Error(`Couldn't open the site (${desc || code}).`)) }
    const cleanup = () => { clearTimeout(timer); w.webContents.removeListener('did-finish-load', ok); w.webContents.removeListener('did-fail-load', bad) }
    w.webContents.once('did-finish-load', ok)
    w.webContents.on('did-fail-load', bad)
    w.loadURL(url).catch(() => {})
  })
}
const wait = ms => new Promise(r => setTimeout(r, ms))

async function scrape (s, url) {
  const w = getReader()
  await load(w, url)
  let res
  for (let i = 0; i < 8; i++) {
    await wait(i === 0 ? 900 : 1500)
    try { res = await w.webContents.executeJavaScript(scrapeScript(s), true) } catch { res = null }
    // Cloudflare's "checking your browser" page clears itself after a few seconds.
    if (res && res.items.length) break
    if (res && !/just a moment|attention required|checking/i.test(res.title) && i >= 2) break
  }
  return res || { items: [], next: false, title: '' }
}

function runQueued (fn) {
  const job = queue.then(fn)
  queue = job.catch(() => {})
  return job
}

function searchOnce (siteId, url) {
  const s = site(siteId)
  const hit = cache.get(url)
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return Promise.resolve(hit.data)
  return runQueued(async () => {
    const r = await scrape(s, url)
    const data = {
      url,
      hasMore: r.next,
      blocked: !r.items.length && /just a moment|attention|access denied|forbidden/i.test(r.title || ''),
      hits: r.items.map(x => ({
        source: siteId,
        id: x.url,
        title: x.title,
        author: x.author,
        description: x.description,
        icon: x.image ? new URL(x.image, s.base).toString() : null,
        downloads: null,
        categories: [x.url.replace(s.base, '').split('/')[1].replace(/-/g, ' ').replace(/s$/, '')],
        url: x.url
      }))
    }
    if (data.hits.length) cache.set(url, { at: Date.now(), data })
    return data
  })
}

async function search (opts = {}) {
  const siteId = opts.site || 'planetminecraft'
  const s = site(siteId)
  let r = await searchOnce(siteId, s.listUrl(opts))
  // If a keyword search comes back empty, try the other search page the site offers.
  if (!r.hits.length && opts.query && siteId === 'planetminecraft' && (opts.cat || 'addons') === 'addons') r = await searchOnce(siteId, s.listUrl({ ...opts, alt: true }))
  // ModBay: if the search link didn't work, type into the site's own search box instead.
  if (!r.hits.length && opts.query && siteId === 'modbay' && (opts.page || 1) === 1) r = await formSearch(siteId, opts.query)
  return r
}

function formSearch (siteId, query) {
  const s = site(siteId)
  return runQueued(async () => {
    const w = getReader()
    await load(w, s.base + '/')
    await wait(800)
    const submitted = await w.webContents.executeJavaScript(`(() => {
      const i = document.querySelector('input[name="story"], input[type="search"], input[name="q"], input[name="s"]');
      if (!i) return false;
      i.value = ${JSON.stringify(query)};
      const f = i.form; if (!f) return false;
      if (f.requestSubmit) f.requestSubmit(); else f.submit();
      return true;
    })()`, true).catch(() => false)
    if (!submitted) return { hits: [], hasMore: false }
    await new Promise(res => { const t = setTimeout(res, 15000); w.webContents.once('did-finish-load', () => { clearTimeout(t); res() }) })
    let r = null
    for (let i = 0; i < 4; i++) {
      await wait(900)
      try { r = await w.webContents.executeJavaScript(scrapeScript(s), true) } catch {}
      if (r && r.items.length) break
    }
    const items = (r && r.items) || []
    return { hasMore: false, hits: items.map(x => ({ source: siteId, id: x.url, title: x.title, author: x.author, description: x.description, icon: x.image ? new URL(x.image, s.base).toString() : null, downloads: null, categories: [x.url.replace(s.base, '').split('/')[1].replace(/s$/, '')], url: x.url })) }
  })
}

// ---------- 2) One-click "Get" for ModBay ----------
let pendingMeta = null

const DOWNLOAD_LINKS = `(() => {
  const text = el => (el && el.textContent || '').replace(/\\s+/g, ' ').trim();
  const links = [...document.querySelectorAll('a[href]')].filter(a => /\\/download\\/id\\d+|\\.(mcaddon|mcpack|mcworld|mctemplate)(\\?|$)/i.test(a.href)).map(a => ({ href: a.href, text: text(a) }));
  const og = document.querySelector('meta[property="og:image"]');
  const h1 = document.querySelector('h1');
  return { links, title: text(h1) || document.title, image: og ? og.content : '' };
})()`

async function getDirect ({ url, instanceId, title }) {
  const s = Object.values(SITES).find(x => url.startsWith(x.base))
  if (!s || !s.directDownload) { openBrowser(url, instanceId); return { opened: true } }
  return runQueued(async () => {
    const w = getReader()
    await load(w, url)
    let info = null
    for (let i = 0; i < 6; i++) {
      await wait(i ? 1500 : 700)
      try { info = await w.webContents.executeJavaScript(DOWNLOAD_LINKS, true) } catch {}
      if (info && info.links.length) break
    }
    const unique = info ? [...new Map(info.links.map(l => [l.href, l])).values()] : []
    const files = unique.filter(l => /mcaddon|mcpack|mcworld|mctemplate/i.test(l.text + l.href))
    const pick = files.length === 1 ? files[0] : (files.length === 0 && unique.length === 1 ? unique[0] : null)
    if (!pick) {
      // Several files (or none found) — let the person choose on the page.
      openBrowser(url, instanceId)
      return { opened: true, count: unique.length }
    }
    pendingMeta = { title: (info.title || title || '').replace(/\s*[|»-]\s*ModBay.*$/i, ''), icon: info.image || null, url, instanceId, source: 'modbay' }
    w.webContents.downloadURL(pick.href)
    return { started: true, file: pick.text }
  })
}

// ---------- 3) The built-in browser window ----------
let win = null
let view = null
let target = { instanceId: null, name: '' }
let currentSite = 'planetminecraft'
const BAR = 56

function sendBar (ch, payload) { if (win && !win.isDestroyed()) win.webContents.send(ch, payload) }
function layout () {
  if (!win || !view) return
  const [w, h] = win.getContentSize()
  view.setBounds({ x: 0, y: BAR, width: w, height: Math.max(0, h - BAR) })
}
function navState () {
  if (!view) return
  const wc = view.webContents
  const url = wc.getURL()
  const s = Object.entries(SITES).find(([, x]) => url.startsWith(x.base))
  if (s) currentSite = s[0]
  const cur = site(currentSite)
  sendBar('pmc:state', {
    url, title: wc.getTitle(), back: wc.navigationHistory.canGoBack(), forward: wc.navigationHistory.canGoForward(), loading: wc.isLoading(), target: target.name,
    site: currentSite, siteName: cur.name, sites: Object.entries(SITES).map(([id, x]) => ({ id, name: x.name })), cats: Object.entries(cur.cats).map(([id, c]) => ({ id, label: c.label }))
  })
}

function openBrowser (url, instanceId, siteId) {
  const instances = require('./instances')
  if (instanceId) { try { const i = instances.get(instanceId); target = { instanceId: i.id, name: i.name } } catch {} }
  if (siteId && SITES[siteId]) currentSite = siteId
  const known = url && Object.values(SITES).some(x => url.startsWith(x.base))
  if (!known) url = site(currentSite).listUrl({ cat: 'addons' })
  if (win && !win.isDestroyed()) {
    view.webContents.loadURL(url)
    win.show(); win.focus(); navState()
    return
  }
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600,
    title: 'Plunder · Add-on browser',
    backgroundColor: '#0d0b14',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, '..', 'pmc-preload.js'), contextIsolation: true, sandbox: true }
  })
  win.setMenu(null)
  win.loadFile(path.join(__dirname, '..', 'renderer', 'pmc-bar.html'))
  view = new WebContentsView({ webPreferences: { partition: PART, sandbox: true, contextIsolation: true } })
  win.contentView.addChildView(view)
  layout()
  win.on('resize', layout)
  win.on('closed', () => { win = null; view = null })
  const wc = view.webContents
  wc.setWindowOpenHandler(({ url: u }) => { if (/^https?:\/\//.test(u)) wc.loadURL(u); return { action: 'deny' } })
  for (const ev of ['did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-start-loading', 'did-stop-loading']) wc.on(ev, navState)
  wc.loadURL(url)
}

ipcMain.on('pmc:nav', (_e, cmd, arg) => {
  if (!view) return
  const wc = view.webContents
  if (cmd === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
  else if (cmd === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
  else if (cmd === 'reload') wc.reload()
  else if (cmd === 'home') wc.loadURL(site(currentSite).listUrl({ cat: arg || 'addons' }))
  else if (cmd === 'site' && SITES[arg]) { currentSite = arg; wc.loadURL(site(arg).listUrl({ cat: 'addons' })) }
  else if (cmd === 'external') shell.openExternal(wc.getURL())
  else if (cmd === 'folder' && target.instanceId) {
    const instances = require('./instances')
    try { shell.openPath(instances.gameDir(instances.get(target.instanceId))) } catch {}
  } else if (cmd === 'ready') navState()
})

// Catch downloads from the built-in browser and from one-click "Get".
let downloadsHooked = false
function hookDownloads () {
  if (downloadsHooked) return
  downloadsHooked = true
  ses().on('will-download', (_e, item, wc) => {
    const instances = require('./instances')
    const meta = wc && reader && !reader.isDestroyed() && wc === reader.webContents ? pendingMeta : null
    if (meta) pendingMeta = null
    let inst = null
    try { inst = instances.get((meta && meta.instanceId) || target.instanceId || store.get().selected.bedrock) } catch {}
    if (!inst) inst = instances.list().find(i => i.edition === 'bedrock') || null
    const name = item.getFilename()
    const dir = inst ? instances.gameDir(inst) : path.join(store.P.cache, 'addon-downloads')
    fs.mkdirSync(dir, { recursive: true })
    const dest = path.join(dir, path.basename(name))
    item.setSavePath(dest)
    const pageUrl = meta ? meta.url : (view ? view.webContents.getURL() : '')
    const fromSite = Object.entries(SITES).find(([, x]) => pageUrl.startsWith(x.base))
    const source = (meta && meta.source) || (fromSite ? fromSite[0] : 'web')
    const pageTitle = (meta ? meta.title : (view && view.webContents.getTitle()) || '').replace(/\s*[|–»-]\s*(Planet Minecraft|ModBay).*$/i, '').trim()
    const t = events.task(`Downloading ${name}`, { instanceId: inst && inst.id })
    item.on('updated', () => {
      const total = item.getTotalBytes()
      const p = total ? item.getReceivedBytes() / total : null
      t.update(p)
      sendBar('pmc:download', { name, progress: p })
    })
    item.once('done', (_e2, state) => {
      if (state !== 'completed') { t.fail(state === 'cancelled' ? 'Download cancelled' : 'Download failed'); sendBar('pmc:download', { name, error: true }); events.send('toast', { kind: 'error', text: `Download of ${name} failed.` }); return }
      sendBar('pmc:download', { name, done: true })
      const ext = path.extname(name).toLowerCase()
      if (inst) {
        const i2 = instances.get(inst.id)
        i2.addons = (i2.addons || []).filter(a => a.file !== path.basename(name))
        i2.addons.push({ file: path.basename(name), title: pageTitle || path.basename(name, ext), icon: meta ? meta.icon : null, source, url: pageUrl, added: Date.now() })
        instances.save(i2)
      }
      if (['.mcpack', '.mcaddon', '.mcworld', '.mctemplate'].includes(ext)) {
        const bedrock = require('./bedrock')
        bedrock.importFile(dest).then(r => {
          t.done('Installed into Minecraft')
          events.send('toast', { kind: 'ok', text: `Installed ${bedrock.describeImport(r) || pageTitle || name} into Minecraft. If Minecraft is open, restart it to see it.` })
          events.send('packs-changed')
        }).catch(e => { t.fail(e); events.send('toast', { kind: 'error', text: e.message }) })
      } else {
        t.done('Saved to your Bedrock profile')
        events.send('toast', { kind: 'warn', text: `${name} isn't a Minecraft add-on file (.mcpack/.mcaddon). It was saved to your profile's folder — some creators zip their packs, so you may need to unzip it first.` })
        shell.showItemInFolder(dest)
      }
    })
  })
}

module.exports = { search, getDirect, openBrowser, hookDownloads, SITES }
