// Minimal preload. The UI talks to the bundled Express server over HTTP,
// so no privileged bridge is required. Kept for future native integrations
// (e.g. exposing app version) while preserving contextIsolation security.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  platform: process.platform,
  // License helpers usable from the in-app License page.
  license: {
    enterKey: () => ipcRenderer.invoke('license:open-manager'),
    copyMachineId: () => ipcRenderer.invoke('license:copy-machine'),
  },
});
