// The only things the game page may ask the desktop app to do: save and open level files.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  saveLevelFile: (name, text) => ipcRenderer.invoke('level:save', { name, text }),
  openLevelFile: () => ipcRenderer.invoke('level:open'),
});
