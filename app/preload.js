'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  /* 数据 */
  load: () => ipcRenderer.invoke('data:load'),
  save: (obj) => ipcRenderer.invoke('data:save', obj),
  clear: () => ipcRenderer.invoke('data:clear'),

  /* 数据位置 */
  dataDir: () => ipcRenderer.invoke('data:dir'),
  setDataDir: (dir) => ipcRenderer.invoke('data:setDir', dir),
  pickDataDir: () => ipcRenderer.invoke('data:pickDir'),
  openDataDir: () => ipcRenderer.invoke('data:openDir'),

  /* 导出 / 导入 */
  exportData: () => ipcRenderer.invoke('data:export'),
  importPick: () => ipcRenderer.invoke('data:importPick'),
  importApply: (file) => ipcRenderer.invoke('data:importApply', file),

  /* 计时（引擎在主进程） */
  timerGet: () => ipcRenderer.invoke('timer:get'),
  timerStart: (p) => ipcRenderer.invoke('timer:start', p),
  timerPause: () => ipcRenderer.invoke('timer:pause'),
  timerResume: () => ipcRenderer.invoke('timer:resume'),
  timerReset: () => ipcRenderer.invoke('timer:reset'),
  timerStop: () => ipcRenderer.invoke('timer:stop'),

  /* 事件 */
  onTick: (fn) => ipcRenderer.on('timer:tick', (e, s) => fn(s)),
  onState: (fn) => ipcRenderer.on('timer:state', (e, s) => fn(s)),
  onDone: (fn) => ipcRenderer.on('timer:done', (e, d) => fn(d)),
  onUiCmd: (fn) => ipcRenderer.on('ui:cmd', (e, cmd) => fn(cmd)),

  /* 窗口 */
  minimize: () => ipcRenderer.send('win:minimize'),
  resetSize: () => ipcRenderer.send('win:resetSize'),
  close: () => ipcRenderer.send('win:close'),
  autostart: (on) => ipcRenderer.invoke('app:autostart', on),
  setLang: (l) => ipcRenderer.send('app:lang', l),
  quit: () => ipcRenderer.send('app:quit')
});
