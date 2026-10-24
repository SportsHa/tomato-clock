'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, globalShortcut, screen, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;
let tray = null;
let quitting = false;

/* ---------- 界面语言（托盘菜单也跟着走） ---------- */
const L = {
  zh: {
    app: '番茄钟', show: '显示 / 隐藏', stop: '停止当前计时', quit: '退出',
    focus: '专注中 · ', rest: '休息中 · ', paused: '番茄钟 · 已暂停 ', idle: '番茄钟'
  },
  en: {
    app: 'Tomato Clock', show: 'Show / Hide', stop: 'Stop current session', quit: 'Quit',
    focus: 'Focusing · ', rest: 'On break · ', paused: 'Tomato Clock · Paused ', idle: 'Tomato Clock'
  }
};
let lang = 'zh';
function T() { return L[lang] || L.zh; }

/* ---------- 数据目录（可配置；默认放安装目录下的 data\） ---------- */
function userDataFile(name) { return path.join(app.getPath('userData'), name); }

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}
function writeJson(file, obj) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch (e) { return false; }
}

const POINTER_FILE = () => userDataFile('storage-location.json');

function defaultDataDir() {
  // 默认放用户目录：覆盖安装会先跑卸载器并清空安装目录，数据放安装目录里会丢
  return app.getPath('userData');
}

function canWriteDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.write-probe');
    fs.writeFileSync(probe, 'ok', 'utf8');
    fs.unlinkSync(probe);
    return true;
  } catch (e) { return false; }
}

let DATA_DIR = null;
let DATA_DIR_INFO = { dir: '', fallback: false, source: 'default' };

function resolveDataDir() {
  const ptr = readJson(POINTER_FILE());
  let dir = (ptr && typeof ptr.dir === 'string' && ptr.dir.trim()) ? ptr.dir : defaultDataDir();
  let source = (ptr && ptr.dir) ? 'pointer' : 'default';
  let fallback = false;
  if (!canWriteDir(dir)) {                    // 安装目录不可写时退回用户目录
    dir = app.getPath('userData');
    source = 'fallback';
    fallback = true;
    canWriteDir(dir);
  }
  DATA_DIR = dir;
  // 一次性迁移：新位置还没有 data.json，但旧位置（userData）有 → 复制过来，旧文件保留
  try {
    const legacyDir = app.getPath('userData');
    if (path.resolve(dir) !== path.resolve(legacyDir)) {
      const newData = path.join(dir, 'data.json');
      const oldData = path.join(legacyDir, 'data.json');
      if (!fs.existsSync(newData) && fs.existsSync(oldData)) {
        fs.copyFileSync(oldData, newData);
        const oldTimer = path.join(legacyDir, 'timer.json');
        if (!fs.existsSync(path.join(dir, 'timer.json')) && fs.existsSync(oldTimer)) {
          fs.copyFileSync(oldTimer, path.join(dir, 'timer.json'));
        }
      }
    }
  } catch (e) {}
  DATA_DIR_INFO = { dir, fallback, source };
  return dir;
}

function dataDirPath() { return DATA_DIR || resolveDataDir(); }
function dataFile() { return path.join(dataDirPath(), 'data.json'); }
function timerFile() { return path.join(dataDirPath(), 'timer.json'); }

function readData() { return readJson(dataFile()); }

function writeData(obj) {
  writeJson(dataFile(), obj);
  const key = new Date().toISOString().slice(0, 10);
  const bak = path.join(dataDirPath(), 'backup-' + key + '.json');
  if (!fs.existsSync(bak)) { try { fs.copyFileSync(dataFile(), bak); } catch (e) {} }
}

function dataCounts(obj) {
  const o = (obj && obj.data) ? obj.data : obj;
  return {
    tasks: (o && Array.isArray(o.tasks)) ? o.tasks.length : 0,
    pomodoros: (o && Array.isArray(o.pomodoros)) ? o.pomodoros.length : 0
  };
}

/* ---------- 窗口状态记忆 ---------- */
const STATE_FILE = () => userDataFile('window-state.json');

function loadWindowBounds() {
  const s = readJson(STATE_FILE());
  if (!s || !s.width || !s.height) return null;
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.max(360, Math.min(1200, s.width));
  const height = Math.max(480, Math.min(1600, s.height));
  // 位置一律夹回工作区内：宁可挪回屏幕，也不要恢复到看不见的地方
  let x, y;
  if (Number.isFinite(s.x) && Number.isFinite(s.y)) {
    x = Math.min(Math.max(s.x, area.x), Math.max(area.x, area.x + area.width - width));
    y = Math.min(Math.max(s.y, area.y), Math.max(area.y, area.y + area.height - height));
  }
  return { width, height, x, y };
}

let saveBoundsTimer = null;
function scheduleSaveBounds() {
  if (!win || win.isDestroyed()) return;
  clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(() => {
    if (!win || win.isDestroyed() || win.isMinimized() || win.isMaximized()) return;
    const b = win.getBounds();
    writeJson(STATE_FILE(), b);
  }, 400);
}

/* ---------- 计时引擎（主进程） ---------- */
let timer = null;          // {taskId, mode, totalMs, remainingMs, endAt, running}
let tickHandle = null;

const TIMER_FILE = () => timerFile();

function loadTimer() {
  const t = readJson(TIMER_FILE());
  if (!t || !t.totalMs) return null;
  if (t.running && t.endAt) t.remainingMs = Math.max(0, t.endAt - Date.now());
  timer = t;
  return t;
}

function persistTimer() {
  if (timer) writeJson(TIMER_FILE(), timer);
  else { try { fs.unlinkSync(TIMER_FILE()); } catch (e) {} }
}

function snapshot() {
  if (!timer) return null;
  return {
    taskId: timer.taskId,
    mode: timer.mode,
    totalMs: timer.totalMs,
    remainingMs: Math.max(0, timer.remainingMs),
    running: !!timer.running
  };
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function startTicker() {
  if (tickHandle) return;
  tickHandle = setInterval(onTick, 500);
}

function stopTicker() {
  if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
}

function onTick() {
  if (!timer || !timer.running) return;
  timer.remainingMs = Math.max(0, timer.endAt - Date.now());
  updateTray();
  send('timer:tick', snapshot());
  if (timer.remainingMs <= 0) finishTimer();
}

function finishTimer() {
  if (!timer) return;
  const done = { mode: timer.mode, taskId: timer.taskId, totalMs: timer.totalMs, finishedAt: Date.now() };
  timer = null;
  persistTimer();
  stopTicker();
  updateTray();
  send('timer:done', done);
  send('timer:state', null);
}

function startTimer(taskId, mode, minutes) {
  const totalMs = Math.max(1000, Math.round(minutes * 60000));
  timer = { taskId, mode: mode || 'focus', totalMs, remainingMs: totalMs, endAt: Date.now() + totalMs, running: true };
  persistTimer();
  startTicker();
  updateTray();
  send('timer:state', snapshot());
  return snapshot();
}

function pauseTimer() {
  if (!timer || !timer.running) return snapshot();
  timer.remainingMs = Math.max(0, timer.endAt - Date.now());
  timer.running = false;
  timer.endAt = null;
  persistTimer();
  stopTicker();
  updateTray();
  send('timer:state', snapshot());
  return snapshot();
}

function resumeTimer() {
  if (!timer || timer.running) return snapshot();
  timer.endAt = Date.now() + timer.remainingMs;
  timer.running = true;
  persistTimer();
  startTicker();
  updateTray();
  send('timer:state', snapshot());
  return snapshot();
}

function resetTimer() {
  if (!timer) return null;
  timer.remainingMs = timer.totalMs;
  timer.endAt = null;
  timer.running = false;
  persistTimer();
  stopTicker();
  updateTray();
  send('timer:state', snapshot());
  return snapshot();
}

function stopTimer() {
  timer = null;
  persistTimer();
  stopTicker();
  updateTray();
  send('timer:state', null);
  return null;
}

/* ---------- 托盘 ---------- */
const TRAY_DIR = path.join(__dirname, 'assets', 'tray');
const iconCache = {};
let lastMenuEnabled = null;

function trayImage(file) {
  if (!iconCache[file]) iconCache[file] = nativeImage.createFromPath(path.join(TRAY_DIR, file));
  return iconCache[file];
}

function updateTray() {
  if (!tray) return;
  if (lastMenuEnabled !== !!timer) { lastMenuEnabled = !!timer; buildTrayMenu(); }
  if (!timer) {
    tray.setImage(trayImage('idle.png'));
    tray.setToolTip(T().idle);
    return;
  }
  const totalSec = Math.ceil(timer.remainingMs / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  const clock = String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
  if (!timer.running) {
    tray.setImage(trayImage('idle.png'));
    tray.setToolTip(T().paused + clock);
    return;
  }
  const minutesLeft = Math.min(60, Math.max(0, Math.ceil(timer.remainingMs / 60000)));
  const prefix = (timer.mode === 'break') ? 'brk' : 'm';
  tray.setImage(trayImage(prefix + minutesLeft + '.png'));
  tray.setToolTip((timer.mode === 'break' ? T().rest : T().focus) + clock);
}

function buildTrayMenu() {
  if (!tray) return;
  const d = T();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: d.show, click: toggleWindow },
    { label: d.stop, enabled: !!timer, click: () => { if (timer) stopTimer(); } },
    { type: 'separator' },
    { label: d.quit, click: () => { quitting = true; app.quit(); } }
  ]));
}

function createTray() {
  tray = new Tray(trayImage('idle.png'));
  tray.setToolTip(T().idle);
  tray.on('click', toggleWindow);
  buildTrayMenu();
}

/* ---------- 窗口 ---------- */
function createWindow() {
  const b = loadWindowBounds();
  win = new BrowserWindow({
    width: b ? b.width : 420,
    height: b ? b.height : 680,
    x: b ? b.x : undefined,
    y: b ? b.y : undefined,
    minWidth: 360,
    minHeight: 583,   // 与 360 宽构成黄金比
    frame: false,
    show: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#FFFFFF',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  const viewArg = process.argv.find(a => a.startsWith('--view='));
  const hash = viewArg ? '#' + viewArg.split('=')[1] : '';
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), hash ? { hash: hash.slice(1) } : undefined);

  const startHidden = process.argv.includes('--minimized');
  win.once('ready-to-show', () => { if (!startHidden) win.show(); });

  // 应用内快捷键：在主进程拦截，避开 Chromium 自带的 Ctrl+0 缩放等加速键
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (!(input.control || input.meta) || input.alt) return;
    const k = (input.key || '').toLowerCase();
    const code = (input.code || '').toLowerCase();
    if (k === '1' || code === 'digit1' || k === 't' || code === 'keyt') { e.preventDefault(); win.webContents.send('ui:cmd', 'stats'); }
    else if (k === '2' || code === 'digit2' || k === ',' || code === 'comma') { e.preventDefault(); win.webContents.send('ui:cmd', 'settings'); }
    else if (k === '0' || k === 'numpad0' || code === 'digit0' || code === 'numpad0') { e.preventDefault(); win.webContents.send('ui:cmd', 'resetSize'); }
  });
  win.on('resize', scheduleSaveBounds);
  win.on('move', scheduleSaveBounds);
  win.on('close', e => {
    if (!quitting) { e.preventDefault(); scheduleSaveBounds(); win.hide(); }
  });
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible() && !win.isMinimized()) { win.hide(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/* ---------- IPC ---------- */
ipcMain.handle('data:load', () => readData());
ipcMain.handle('data:save', (e, obj) => { writeData(obj); return true; });
ipcMain.handle('data:clear', () => {
  try {
    if (fs.existsSync(dataFile())) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(dataFile(), path.join(dataDirPath(), 'data-before-clear-' + stamp + '.json'));
    }
    fs.unlinkSync(dataFile());
  } catch (e) {}
  return true;
});

/* --- 数据位置 --- */
ipcMain.handle('data:dir', () => ({
  dir: dataDirPath(),
  fallback: DATA_DIR_INFO.fallback,
  source: DATA_DIR_INFO.source,
  isPackaged: app.isPackaged,
  defaultDir: defaultDataDir()
}));

ipcMain.handle('data:setDir', (e, newDir) => {
  try {
    if (!newDir || typeof newDir !== 'string') return { ok: false, error: 'bad-path' };
    if (path.resolve(newDir) === path.resolve(dataDirPath())) {
      return { ok: true, unchanged: true, dir: dataDirPath() };
    }
    if (!canWriteDir(newDir)) return { ok: false, error: 'not-writable' };

    const srcDir = dataDirPath();
    const files = ['data.json', 'timer.json'];
    for (const f of files) {
      const s = path.join(srcDir, f);
      if (fs.existsSync(s)) fs.copyFileSync(s, path.join(newDir, f));
    }
    // 校验：复制过去的任务/番茄数量必须与源一致
    const srcCounts = dataCounts(readJson(path.join(srcDir, 'data.json')));
    const dstCounts = dataCounts(readJson(path.join(newDir, 'data.json')));
    if (srcCounts.tasks !== dstCounts.tasks || srcCounts.pomodoros !== dstCounts.pomodoros) {
      return { ok: false, error: 'verify-failed', from: srcCounts, to: dstCounts };
    }
    writeJson(POINTER_FILE(), { dir: newDir, at: Date.now() });
    // 旧文件改名保留（不删除）
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    for (const f of files) {
      const s = path.join(srcDir, f);
      if (fs.existsSync(s)) { try { fs.renameSync(s, s + '.bak-' + stamp); } catch (err) {} }
    }
    resolveDataDir();
    return { ok: true, dir: dataDirPath(), counts: dstCounts };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('data:pickDir', async () => {
  try {
    const r = await dialog.showOpenDialog(win, {
      title: '选择数据存储文件夹',
      properties: ['openDirectory', 'createDirectory']
    });
    if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
    return { ok: true, dir: r.filePaths[0] };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('data:openDir', async () => {
  const err = await shell.openPath(dataDirPath());
  return err ? { ok: false, error: err } : { ok: true };
});

/* --- 导出 / 导入 --- */
ipcMain.handle('data:export', async () => {
  try {
    const d = new Date();
    const stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    const r = await dialog.showSaveDialog(win, {
      title: '导出番茄钟数据',
      defaultPath: path.join(app.getPath('documents'), '番茄钟数据-' + stamp + '.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    const current = readData() || { v: 1, tasks: [], pomodoros: [], settings: {} };
    const payload = {
      schema: 2,
      exportedAt: new Date().toISOString(),
      appVersion: app.getVersion(),
      counts: dataCounts(current),
      data: current
    };
    fs.writeFileSync(r.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { ok: true, file: r.filePath, counts: payload.counts };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('data:importPick', async () => {
  try {
    const r = await dialog.showOpenDialog(win, {
      title: '选择要导入的番茄钟数据',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
    const file = r.filePaths[0];
    const raw = readJson(file);
    if (!raw) return { ok: false, error: 'unreadable' };
    const body = (raw && raw.data) ? raw.data : raw;
    if (!body || !Array.isArray(body.tasks) || !Array.isArray(body.pomodoros)) {
      return { ok: false, error: 'bad-format' };
    }
    return { ok: true, file, counts: dataCounts(body), exportedAt: raw.exportedAt || null };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('data:importApply', (e, file) => {
  try {
    const raw = readJson(file);
    if (!raw) return { ok: false, error: 'unreadable' };
    const body = (raw && raw.data) ? raw.data : raw;
    if (!body || !Array.isArray(body.tasks) || !Array.isArray(body.pomodoros)) {
      return { ok: false, error: 'bad-format' };
    }
    // 覆盖前先备份当前数据
    if (fs.existsSync(dataFile())) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(dataFile(), path.join(dataDirPath(), 'data-before-import-' + stamp + '.json'));
    }
    writeData(body);
    if (timer) { timer = null; persistTimer(); stopTicker(); updateTray(); }
    return { ok: true, counts: dataCounts(body) };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('timer:get', () => snapshot());
ipcMain.handle('timer:start', (e, p) => startTimer(p.taskId, p.mode, p.minutes));
ipcMain.handle('timer:pause', () => pauseTimer());
ipcMain.handle('timer:resume', () => resumeTimer());
ipcMain.handle('timer:reset', () => resetTimer());
ipcMain.handle('timer:stop', () => stopTimer());

ipcMain.on('app:lang', (e, l) => {
  lang = l === 'en' ? 'en' : 'zh';
  buildTrayMenu();
  updateTray();
});

ipcMain.on('win:resetSize', () => {
  if (!win) return;
  win.setSize(420, 680, false);
  win.center();
});
ipcMain.on('win:minimize', () => { if (win) win.minimize(); });
ipcMain.on('win:close', () => { if (win) win.hide(); });
ipcMain.handle('app:autostart', (e, on) => {
  try {
    app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath, args: ['--minimized'] });
    return app.getLoginItemSettings().openAtLogin;
  } catch (err) { return false; }
});
ipcMain.on('app:quit', () => { quitting = true; app.quit(); });

/* ---------- 生命周期 ---------- */
// 抢锁：旧实例被强杀时锁可能短暂残留，重试几次再放弃（避免「双击没反应」）
function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (e) {}
}
let gotLock = app.requestSingleInstanceLock();
for (let i = 0; !gotLock && i < 4; i++) {
  sleepSync(400);
  gotLock = app.requestSingleInstanceLock();
}

if (!gotLock) {
  // 真的有另一个实例在跑：它已收到 second-instance 事件并会把窗口弹出来，这里静默退出即可
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  });

  app.whenReady().then(() => {
    resolveDataDir();
    const savedData = readData();
    if (savedData && savedData.settings && savedData.settings.lang) lang = savedData.settings.lang === 'en' ? 'en' : 'zh';
    loadTimer();
    createWindow();
    createTray();
    updateTray();
    if (timer && timer.running) startTicker();
    globalShortcut.register('CommandOrControl+Alt+P', toggleWindow);
  });

  app.on('window-all-closed', e => e.preventDefault());
  app.on('before-quit', () => { quitting = true; stopTicker(); });
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
