// Secure bridge for the activation window. Exposes only the few license
// operations the activation page needs, over Electron IPC.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('license', {
  getInfo: () => ipcRenderer.invoke('license:info'),
  activate: (key) => ipcRenderer.invoke('license:activate', key),
  quit: () => ipcRenderer.invoke('license:quit'),
  openSupport: () => ipcRenderer.invoke('license:support'),
});
