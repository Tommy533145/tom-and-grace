const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tomGraceDesktop', {
  connect: (url) => ipcRenderer.invoke('tom-grace:connect', url)
});
