// Safe bridge between the window (UI) and the launcher's background code.
const { contextBridge, ipcRenderer, webUtils } = require('electron')

const CHANNELS = ['task', 'log', 'game', 'toast', 'auth-code', 'auth-done', 'instances-changed', 'win-state', 'packs-changed', 'assoc-changed', 'bedrock-versions-changed', 'crash', 'update-available']

contextBridge.exposeInMainWorld('api', {
  call: async (name, ...args) => {
    const r = await ipcRenderer.invoke(name, ...args)
    if (!r.ok) { const e = new Error(r.error); e.code = r.code; throw e }
    return r.data
  },
  on: (channel, fn) => {
    if (!CHANNELS.includes(channel)) return () => {}
    const h = (_e, payload) => fn(payload)
    ipcRenderer.on(channel, h)
    return () => ipcRenderer.removeListener(channel, h)
  },
  // For drag-and-drop: get the real path of a dropped file.
  filePath: file => webUtils.getPathForFile(file)
})
