// Generates a blocky landscape picture for each instance/world (so every card has art).
const ART_CACHE = new Map()

function rng (seed) {
  let a = (seed >>> 0) || 1
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}
function hashStr (s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) } return h >>> 0 }
function hex (c) { const n = parseInt(c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255] }
function mix (a, b, t) { const A = hex(a), B = hex(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})` }

const PALETTES = {
  sunset: { sky: ['#2a1650', '#6b2f86', '#d9677a', '#ffb36b'], sun: '#ffe2a0', far: '#6a4a8c', mid: '#3d2b62', near: '#1f3b2a', grass: '#3e8b3b', water: '#3a2f78', snow: '#e9dcff' },
  dusk: { sky: ['#0f1b3d', '#284a8a', '#7d78c9', '#f2a6c2'], sun: '#fff1d6', far: '#4c5aa0', mid: '#2c3772', near: '#173225', grass: '#2f7a46', water: '#22306e', snow: '#dfe7ff' },
  day: { sky: ['#3d6fd6', '#6f9ff0', '#a9cdfb', '#e4f1ff'], sun: '#fff8d0', far: '#6d8fb8', mid: '#4a7a5a', near: '#2e5e34', grass: '#58a83f', water: '#3f78c8', snow: '#ffffff' },
  night: { sky: ['#07061a', '#1a1145', '#3b1f72', '#6b3aa0'], sun: '#efe6ff', far: '#2c2260', mid: '#1c1645', near: '#101d1a', grass: '#244f34', water: '#19134a', snow: '#c9b8ff' },
  nether: { sky: ['#1a0610', '#3d0b1f', '#6e1530', '#b43a2c'], sun: '#ff9b3d', far: '#4a1426', mid: '#2e0b19', near: '#1b0710', grass: '#7a1f2b', water: '#ff6a1a', snow: '#9b3df5' },
  cherry: { sky: ['#3a2a6e', '#8a5fb8', '#f0a3c8', '#ffd9e6'], sun: '#fff0f5', far: '#9c79b8', mid: '#6c4b8c', near: '#2d4a2f', grass: '#5aa54a', water: '#6a5fb8', snow: '#ffe3ef' }
}

function landscape (seedish, w = 640, h = 340, theme) {
  const seed = typeof seedish === 'number' ? seedish : hashStr(seedish)
  const key = `${seed}|${w}|${h}|${theme || ''}`
  if (ART_CACHE.has(key)) return ART_CACHE.get(key)
  const r = rng(seed)
  const names = Object.keys(PALETTES).filter(n => n !== 'nether')
  const pal = PALETTES[theme] || PALETTES[names[Math.floor(r() * names.length)]]
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d')
  const px = Math.max(3, Math.round(w / 150))
  const horizon = Math.round(h * (0.62 + r() * 0.06) / px) * px

  // Sky in soft bands
  for (let y = 0; y < horizon; y += px) {
    const t = y / horizon
    const seg = Math.min(2, Math.floor(t * 3))
    const local = Math.round(((t * 3) - seg) * 6) / 6
    g.fillStyle = mix(pal.sky[seg], pal.sky[seg + 1], local)
    g.fillRect(0, y, w, px)
  }
  // Stars for dark palettes
  if (pal === PALETTES.night || pal === PALETTES.dusk) {
    g.fillStyle = 'rgba(255,255,255,.75)'
    for (let i = 0; i < 40; i++) g.fillRect(Math.floor(r() * w / px) * px, Math.floor(r() * horizon * 0.6 / px) * px, px / 1.5, px / 1.5)
  }
  // Sun / moon (blocky)
  const sx = w * (0.35 + r() * 0.35), sy = horizon - h * (0.12 + r() * 0.22), sr = h * 0.075
  for (let ring = 3; ring >= 0; ring--) {
    g.fillStyle = ring ? `rgba(255,220,170,${0.07 * (4 - ring)})` : pal.sun
    const rr = sr + ring * px * 2
    for (let y = -rr; y <= rr; y += px) for (let x = -rr; x <= rr; x += px) if (x * x + y * y <= rr * rr) g.fillRect(Math.round((sx + x) / px) * px, Math.round((sy + y) / px) * px, px, px)
  }
  // Clouds
  g.fillStyle = 'rgba(255,255,255,.18)'
  for (let i = 0; i < 6; i++) {
    const cx = Math.floor(r() * w / px) * px, cy = Math.floor(r() * horizon * 0.55 / px) * px
    const cw = (6 + Math.floor(r() * 14)) * px
    g.fillRect(cx, cy, cw, px * 2); g.fillRect(cx + px * 2, cy - px, cw - px * 5, px)
  }
  // Mountain layers
  const layer = (color, base, amp, freq, snow) => {
    const ph = [r() * 10, r() * 10, r() * 10]
    for (let x = 0; x < w; x += px) {
      const n = Math.sin(x * freq + ph[0]) * 0.55 + Math.sin(x * freq * 2.3 + ph[1]) * 0.3 + Math.sin(x * freq * 5.1 + ph[2]) * 0.15
      const top = Math.round((base - amp * (n * 0.5 + 0.5)) / px) * px
      g.fillStyle = color
      g.fillRect(x, top, px, h - top)
      if (snow && top < base - amp * 0.62) { g.fillStyle = snow; g.fillRect(x, top, px, px * 2) }
    }
  }
  layer(pal.far, horizon, h * 0.42, 0.012 + r() * 0.006, pal.snow)
  layer(pal.mid, horizon + px, h * 0.24, 0.02 + r() * 0.01)
  // Water with reflections
  const waterTop = horizon + px * 2
  g.fillStyle = pal.water
  g.fillRect(0, waterTop, w, h - waterTop)
  for (let y = waterTop; y < h; y += px * 2) {
    g.fillStyle = `rgba(255,255,255,${0.04 + r() * 0.05})`
    g.fillRect(Math.floor(r() * w / px) * px, y, (8 + Math.floor(r() * 30)) * px, px)
  }
  g.fillStyle = pal.sun; g.globalAlpha = 0.35
  for (let y = waterTop; y < h; y += px * 2) g.fillRect(Math.round((sx - sr + r() * sr) / px) * px, y, Math.round(sr * (0.6 + r()) / px) * px, px)
  g.globalAlpha = 1
  // A little pirate ship out on the water (most pictures get one)
  if (r() < 0.7) {
    const unit = px
    const cx = Math.round((w * (0.42 + r() * 0.2)) / unit) * unit
    const base = waterTop + unit * 3
    const hullW = 16
    const hull = mix('#4a2c17', '#000000', 0.15)
    for (let row = 0; row < 4; row++) {
      const inset = row
      g.fillStyle = row === 0 ? '#6b4423' : hull
      g.fillRect(cx + (inset - hullW / 2) * unit, base + (row - 3) * unit, (hullW - inset * 2) * unit, unit)
    }
    g.fillStyle = '#e9b04c'; g.fillRect(cx - (hullW / 2 - 1) * unit, base - 3 * unit, unit, unit); g.fillRect(cx + (hullW / 2 - 2) * unit, base - 3 * unit, unit, unit)
    g.fillStyle = '#2b1a0e'
    g.fillRect(cx - unit, base - 15 * unit, unit, 12 * unit)
    g.fillRect(cx + 4 * unit, base - 11 * unit, unit, 8 * unit)
    const sail = r() < 0.5 ? '#7c3aed' : '#efe7d6'
    g.fillStyle = sail
    g.fillRect(cx - 5 * unit, base - 14 * unit, 9 * unit, 4 * unit)
    g.fillRect(cx - 4 * unit, base - 10 * unit, 7 * unit, 3 * unit)
    g.fillRect(cx + 2 * unit, base - 10 * unit, 5 * unit, 4 * unit)
    g.fillStyle = '#120a1f'; g.fillRect(cx, base - 17 * unit, 3 * unit, 2 * unit)
    g.fillStyle = '#ffffff'; g.fillRect(cx + unit, base - 17 * unit, unit, unit)
    g.fillStyle = 'rgba(255,255,255,.18)'
    g.fillRect(cx - (hullW / 2 + 1) * unit, base + unit, (hullW + 2) * unit, unit)
  }
  // Grassy shores on both sides with blocky trees
  const shore = (fromLeft) => {
    const width = w * (0.25 + r() * 0.15)
    for (let x = 0; x < width; x += px) {
      const xx = fromLeft ? x : w - x - px
      const t = x / width
      const top = Math.round((h - (h - waterTop) * (1.15 - t * 0.9) - Math.sin(x * 0.05) * px * 2) / px) * px
      g.fillStyle = pal.near; g.fillRect(xx, top + px, px, h - top)
      g.fillStyle = pal.grass; g.fillRect(xx, top, px, px * 1.5)
      if (r() < 0.09 && t < 0.85) {
        const th = (3 + Math.floor(r() * 3)) * px
        g.fillStyle = '#3b2616'; g.fillRect(xx, top - th, px, th)
        g.fillStyle = mix(pal.grass, '#0d2a12', 0.45)
        g.fillRect(xx - px * 2, top - th - px * 3, px * 5, px * 3)
        g.fillRect(xx - px, top - th - px * 4, px * 3, px)
      }
    }
  }
  shore(true); shore(false)
  // Subtle vignette
  const v = g.createLinearGradient(0, 0, 0, h)
  v.addColorStop(0, 'rgba(10,6,20,.05)'); v.addColorStop(1, 'rgba(10,6,20,.35)')
  g.fillStyle = v; g.fillRect(0, 0, w, h)
  const url = c.toDataURL('image/png')
  ART_CACHE.set(key, url)
  return url
}

// A small grass-block style icon used for instances without a custom icon.
function blockIcon (seedish, edition) {
  const seed = typeof seedish === 'number' ? seedish : hashStr(seedish)
  const key = 'blk' + seed + edition
  if (ART_CACHE.has(key)) return ART_CACHE.get(key)
  const r = rng(seed)
  const c = document.createElement('canvas'); c.width = c.height = 64
  const g = c.getContext('2d')
  const tops = edition === 'bedrock' ? ['#5fbf4a', '#4fa83c', '#6fcf55'] : [['#5fbf4a', '#4fa83c', '#6fcf55'], ['#9b6cf0', '#7c4ddb', '#b48cff'], ['#e8e8f0', '#cfd0dc', '#ffffff'], ['#e3c27a', '#c9a35a', '#f0d690']][Math.floor(r() * 4)]
  const side = ['#7a5232', '#6a4528', '#86603c']
  const s = 8
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const set = y < 2 || (y === 2 && r() < 0.5) ? tops : side
    g.fillStyle = set[Math.floor(r() * set.length)]
    g.fillRect(x * s, y * s, s, s)
  }
  const url = c.toDataURL()
  ART_CACHE.set(key, url)
  return url
}
