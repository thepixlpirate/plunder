// Where everything lives on disk, plus a tiny JSON settings store.
const fs = require('fs')
const path = require('path')
const { app } = require('electron')

const base = require('./paths').base
const P = {
  base,
  shared: path.join(base, 'shared'), // versions, libraries, assets (shared by all Java instances)
  runtimes: path.join(base, 'runtimes'), // auto-downloaded Java
  instances: path.join(base, 'instances'),
  backups: path.join(base, 'backups'),
  auth: path.join(base, 'auth'),
  cache: path.join(base, 'cache'),
  file: path.join(base, 'launcher.json')
}
// Folders are created only when something is actually saved in them, to keep the data folder tidy.

const DEFAULTS = {
  settings: {
    curseforgeKey: '',
    memoryMax: 4096,
    memoryMin: 1024,
    javaPath: '',
    jvmArgs: '',
    keepOpen: true,
    bedrockDataPath: '',
    showSnapshots: false,
    leftCollapsed: false,
    rightHidden: false,
    autoBackup: 'daily',
    autoBackupKeep: 5,
    updateRepo: 'thepixlpirate/plunder'
  },
  servers: [], // { id, name, host, port, edition: 'java' | 'bedrock' }
  accounts: [], // { id, name, uuid }
  activeAccount: null,
  selected: { java: null, bedrock: null },
  history: [], // { instanceId, edition, at, world? }
  sessions: [] // { instanceId, edition, start, ms } — for playtime stats
}

let data
function load () {
  try { data = { ...structuredClone(DEFAULTS), ...JSON.parse(fs.readFileSync(P.file, 'utf8')) } } catch { data = structuredClone(DEFAULTS) }
  data.settings = { ...DEFAULTS.settings, ...data.settings }
  data.selected = { ...DEFAULTS.selected, ...data.selected }
}
function save () {
  fs.writeFileSync(P.file + '.tmp', JSON.stringify(data, null, 2))
  fs.renameSync(P.file + '.tmp', P.file)
}
load()

function readJson (file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}
function writeJson (file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(obj, null, 2))
}

module.exports = {
  addSession (s) {
    if (!s || !(s.ms > 30000)) return // ignore very short sessions (crashes on start)
    data.sessions = [...(data.sessions || []), s].slice(-2000)
    save()
  },
  P,
  get: () => data,
  save,
  readJson,
  writeJson,
  addHistory (entry) {
    data.history = [{ ...entry, at: Date.now() }, ...data.history.filter(h => !(h.instanceId === entry.instanceId && h.world === entry.world))].slice(0, 30)
    save()
  }
}
