// Sends live updates (progress bars, logs, game status) from the background to the window.
let win = null
const tasks = new Map()

function setWindow (w) { win = w }
function send (channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

// A "task" is a progress item shown in the launcher (e.g. "Downloading Java").
function task (label, extra = {}) {
  const id = Math.random().toString(36).slice(2)
  const t = { id, label, progress: null, detail: '', ...extra }
  tasks.set(id, t)
  send('task', t)
  return {
    id,
    update (progress, detail) {
      t.progress = progress
      if (detail !== undefined) t.detail = detail
      send('task', t)
    },
    label (l) { t.label = l; send('task', t) },
    done (detail) { t.done = true; t.progress = 1; if (detail) t.detail = detail; send('task', t); tasks.delete(id) },
    fail (err) { t.done = true; t.error = String(err && err.message ? err.message : err); send('task', t); tasks.delete(id) }
  }
}

module.exports = { setWindow, send, task }
