// Small helpers for talking to the internet: JSON requests and file downloads with progress.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { Readable } = require('stream')
const { pipeline } = require('stream/promises')

const UA = 'Plunder/1.7 (personal Minecraft launcher)'

function offline (url, e) {
  const err = new Error(`Can't reach ${new URL(url).host} — check your internet connection.`)
  err.cause = e
  return err
}

async function getJson (url, opts = {}) {
  let res
  try {
    res = await fetch(url, {
    method: opts.method || 'GET',
    headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined
    })
  } catch (e) { throw offline(url, e) }
  if (!res.ok) {
    let detail = ''
    try { detail = (await res.text()).slice(0, 200) } catch {}
    const err = new Error(`Request failed (${res.status}) for ${new URL(url).host}${detail ? ': ' + detail : ''}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

function sha1File (file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1')
    fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject)
  })
}

// Download a file to `dest`. Skips if it already exists with the right sha1.
async function download (url, dest, { sha1, headers, onProgress } = {}) {
  if (sha1 && fs.existsSync(dest)) {
    try { if ((await sha1File(dest)) === sha1) return dest } catch {}
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  let res
  try { res = await fetch(url, { headers: { 'User-Agent': UA, ...(headers || {}) }, redirect: 'follow' }) } catch (e) { throw offline(url, e) }
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}): ${path.basename(dest)}`)
  const total = Number(res.headers.get('content-length')) || 0
  let got = 0
  const tmp = dest + '.part'
  const stream = Readable.fromWeb(res.body)
  if (onProgress) stream.on('data', c => { got += c.length; onProgress(got, total) })
  await pipeline(stream, fs.createWriteStream(tmp))
  fs.renameSync(tmp, dest)
  return dest
}

// Run async jobs with a concurrency limit.
async function pool (items, limit, worker) {
  let i = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      await worker(items[idx], idx)
    }
  })
  await Promise.all(runners)
}

module.exports = { offline, getJson, download, pool, sha1File, UA }
