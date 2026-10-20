const $ = id => document.getElementById(id)
for (const id of ['back', 'forward', 'reload', 'folder', 'external']) $(id).onclick = () => window.pmc.nav(id)
let lastKey = ''
function drawTabs (s) {
  const key = s.site + '|' + (s.cats || []).map(c => c.id).join(',')
  if (key === lastKey) return
  lastKey = key
  const mk = (el, items, cmd, on) => {
    el.innerHTML = ''
    for (const it of items) {
      const b = document.createElement('button')
      b.textContent = it.label || it.name
      if (it.id === on) b.className = 'on'
      b.onclick = () => window.pmc.nav(cmd, it.id)
      el.appendChild(b)
    }
  }
  mk($('sites'), s.sites || [], 'site', s.site)
  mk($('cats'), s.cats || [], 'home', null)
}
window.pmc.on('pmc:state', s => {
  $('back').disabled = !s.back
  $('forward').disabled = !s.forward
  $('title').textContent = (s.title || s.url || '').replace(/\s*[|»-]\s*(Planet Minecraft|ModBay).*$/i, '')
  $('spin').classList.toggle('on', !!s.loading)
  $('target').textContent = 'Saving to ' + (s.target || 'Bedrock')
  drawTabs(s)
})
window.pmc.on('pmc:download', d => {
  const el = $('dl')
  el.className = 'dl' + (d.error ? ' err' : '')
  el.textContent = d.error ? `✕ ${d.name} failed` : d.done ? `✓ ${d.name} saved` : `↓ ${d.name} ${d.progress != null ? Math.round(d.progress * 100) + '%' : ''}`
})
window.pmc.nav('ready')
