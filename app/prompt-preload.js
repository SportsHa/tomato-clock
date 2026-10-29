'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('promptApi', {
  onData: (fn) => ipcRenderer.on('prompt:data', (e, data) => fn(data)),
  act: (action) => ipcRenderer.send('prompt:action', action),
  close: () => ipcRenderer.send('prompt:close')
});
