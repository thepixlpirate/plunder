// Bridge for the Planet Minecraft browser toolbar.
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('pmc', {
  nav: (cmd, arg) => ipcRenderer.send('pmc:nav', cmd, arg),
  on: (ch, fn) => { if (['pmc:state', 'pmc:download'].includes(ch)) ipcRenderer.on(ch, (_e, p) => fn(p)) }
})
