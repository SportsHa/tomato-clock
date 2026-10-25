'use strict';
(function () {
  const api = window.api;
  const DAY = 86400000;
  const CIRC = 2 * Math.PI * 118;
  const appEl = document.getElementById('app');

  let db = null;
  let timer = null;
  let menuOpen = false;
  let archOpen = false;
  let dataDirInfo = { dir: '', fallback: false, source: '' };
  let period = 'week';

  const IC = {
    star: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 3.4l2.7 5.5 6 .9-4.3 4.2 1 5.9L12 17l-5.4 2.9 1-5.9L3.3 9.8l6-.9z"/></svg>',
    starOn: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 3.4l2.7 5.5 6 .9-4.3 4.2 1 5.9L12 17l-5.4 2.9 1-5.9L3.3 9.8l6-.9z"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5a2 2 0 0 1 2-2h3.2l1.6 1.8H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    export: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="M8 11.5l4 4 4-4"/><path d="M4 20h16"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V9"/><path d="M8 12.5l4-4 4 4"/><path d="M4 4h16"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4.5 7h15M9.5 7V5h5v2M7 7l.9 12h8.2L17 7"/></svg>',
    pencil: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M4 20l4.2-1 9.6-9.6-3.2-3.2L5 15.8 4 20z"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.6l4.6 4.6L19 7.4"/></svg>'
  };

  /* ---------- 数据 ---------- */
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function defaults() {
    return {
      v: 1, tasks: [], pomodoros: [], timer: null,
      settings: { goal: 8, focus: 25, rest: 5, autoRest: true, sound: true, notify: false, lang: 'zh', theme: 'light' }
    };
  }
  // 外观：light / dark（深色参照 DSH 桌面端）
  function applyTheme(th) {
    const dark = th === 'dark';
    document.body.classList.toggle('dark', dark);
  }
  // 快捷键（菜单里展示的文案必须与实际绑定一致）
  const SHORTCUTS = { stats: 'Ctrl + 1', settings: 'Ctrl + 2', resetSize: 'Ctrl + 0' };
  function sc(id) { return SHORTCUTS[id] || ''; }
  function save() { api.save(db); }

  /* ---------- 时间 ---------- */
  function dayStart(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function today0() { return dayStart(Date.now()); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmt(ms) {
    if (ms < 0) ms = 0;
    const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return h > 0 ? h + ':' + pad(m) + ':' + pad(ss) : pad(m) + ':' + pad(ss);
  }
  function mmdd(ts) { const d = new Date(ts); return pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function weekdays() { return currentLang === 'en'
    ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    : ['周日', '周一', '周二', '周三', '周四', '周五', '周六']; }
  function wd(ts) { return weekdays()[new Date(ts).getDay()]; }
  function minsTotal(list) { return list.reduce((a, p) => a + p.minutes, 0); }
  function cnt(from, to) { let n = 0; db.pomodoros.forEach(p => { if (p.startAt >= from && p.startAt < to) n++; }); return n; }
  function sumMins(from, to) { let m = 0; db.pomodoros.forEach(p => { if (p.startAt >= from && p.startAt < to) m += p.minutes; }); return m; }
  function tailPath(p) {
    if (!p) return '';
    const segs = String(p).split(/[\\\\/]/).filter(Boolean);
    if (segs.length <= 2) return p;
    return '…\\' + segs.slice(-2).join('\\');
  }

  function shortPath(p) {
    if (!p) return '';
    const parts = String(p).split(/[\\\\/]/).filter(Boolean);
    if (parts.length <= 3) return p;
    return '…' + String(p).slice(-Math.min(38, String(p).length));
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /* ---------- 计时（引擎在主进程，这里只做镜像与渲染） ---------- */
  async function startTimer(taskId, minutes, mode) {
    timer = await api.timerStart({ taskId, mode: mode || 'focus', minutes });
    render();
  }
  async function pauseTimer() {
    if (!timer) return;
    timer = await api.timerPause();
    render();
  }
  async function resumeTimer() {
    if (!timer || timer.running) return;
    timer = await api.timerResume();
    render();
  }
  async function resetTimer() {
    if (!timer) return;
    timer = await api.timerReset();
    render();
  }
  async function stopTimer() {
    timer = await api.timerStop();
    render();
  }

  // 主进程报时完成：记账 + 提示 + 可选自动进入休息
  function onTimerDone(d) {
    const minutes = Math.round(d.totalMs / 60000);
    if (d.mode === 'focus') {
      db.pomodoros.push({ id: uid(), taskId: d.taskId, startAt: d.finishedAt - d.totalMs, endAt: d.finishedAt, minutes });
      save();
      beep();
      notify(t('notify.focusTitle'), t('notify.focusBody', minutes));
      if (db.settings.autoRest) {
        api.timerStart({ taskId: d.taskId, mode: 'break', minutes: db.settings.rest }).then(s => {
          timer = s; render();
        });
        return;
      }
    } else {
      beep();
      notify(t('notify.restTitle'), t('notify.restBody'));
    }
    timer = null;
    render();
  }

  // 顺时针倒计时：缺口从 12 点起、顺时针扩大；配合 .ring svg 的 rotate(-90deg)
  function ringPath(f) {
    const cx = 131, cy = 131, r = 118;
    const f2 = Math.max(0.0001, Math.min(1, f));
    const end = Math.PI * 2, span = Math.PI * 2 * f2, start = end - span;
    const pt = a => [(cx + r * Math.cos(a)).toFixed(2), (cy + r * Math.sin(a)).toFixed(2)];
    if (f2 >= 0.9999) {
      return 'M ' + cx + ' ' + (cy - r) + ' A ' + r + ' ' + r + ' 0 1 1 ' + cx + ' ' + (cy + r)
        + ' A ' + r + ' ' + r + ' 0 1 1 ' + cx + ' ' + (cy - r);
    }
    const a = pt(start), b = pt(end);
    return 'M ' + a[0] + ' ' + a[1] + ' A ' + r + ' ' + r + ' 0 ' + (f2 > 0.5 ? 1 : 0) + ' 1 ' + b[0] + ' ' + b[1];
  }
  function paintTimer() {
    if (!timer) { document.title = t('app.name'); return; }
    document.title = (timer.running ? '' : '⏸ ') + fmt(timer.remainingMs) + ' · ' + t('app.name');
    const frac = Math.max(0, Math.min(1, timer.remainingMs / timer.totalMs));
    const tm = document.getElementById('tm');
    if (tm) tm.textContent = fmt(timer.remainingMs);
    const ringEl = document.getElementById('ringProg');
    if (ringEl) ringEl.setAttribute('d', ringPath(frac));
    const rs = document.getElementById('rstime');
    if (rs) rs.textContent = fmt(timer.remainingMs);
  }

  /* ---------- 声音/通知 ---------- */
  function beep() {
    if (!db.settings.sound) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ac = new AC();
      [0, 0.18].forEach((d, i) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine'; o.frequency.value = i ? 880 : 660;
        g.gain.setValueAtTime(0.0001, ac.currentTime + d);
        g.gain.exponentialRampToValueAtTime(0.16, ac.currentTime + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + d + 0.16);
        o.connect(g); g.connect(ac.destination); o.start(ac.currentTime + d); o.stop(ac.currentTime + d + 0.18);
      });
      setTimeout(() => { try { ac.close(); } catch (e) {} }, 900);
    } catch (e) {}
  }
  function notify(title, body) {
    if (!db.settings.notify) return;
    try { new Notification(title, { body }); } catch (e) {}
  }

  /* ---------- 框架 ---------- */
  function titlebar() {
    return '<div class="titlebar"><span class="brand"></span><span class="nm">' + t('app.name') + '</span>'
      + '<span class="win"><span class="wbtn min" id="wm">−</span><span class="wbtn close" id="wx">✕</span></span></div>';
  }
  function frame(body) {
    appEl.innerHTML = titlebar() + '<div class="vbody">' + body + '</div>';
    const wm = document.getElementById('wm'), wx = document.getElementById('wx');
    if (wm) wm.onclick = () => api.minimize();
    if (wx) wx.onclick = () => api.close();
    paintTimer();
  }
  let toastTimer = null;
  function toast(msg) {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; appEl.appendChild(el); }
    el.textContent = msg; el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('on'), 1800);
  }

  /* ---------- 弹窗 ---------- */
  function dialog(opts) {
    const mask = document.createElement('div');
    mask.className = 'mask';
    mask.innerHTML = '<div class="dlg' + (opts.warn ? ' warn' : '') + '"><h3>' + esc(opts.title) + '</h3>'
      + (opts.body ? '<p class="dbody">' + esc(opts.body) + '</p>' : '')
      + (opts.input !== undefined ? '<input id="dlgInput">' : '')
      + '<div class="row2"><button class="no" id="dlgNo">' + esc(opts.cancelText || t('btn.cancel')) + '</button>'
      + '<button class="ok" id="dlgOk">' + esc(opts.okText || t('btn.save')) + '</button></div></div>';
    appEl.appendChild(mask);
    const inp = mask.querySelector('#dlgInput');
    if (inp) { inp.value = opts.input || ''; inp.focus(); inp.select(); }
    const close = () => mask.remove();
    const ok = () => { const v = inp ? inp.value.trim() : null; close(); opts.onOk(v); };
    mask.querySelector('#dlgOk').onclick = ok;
    mask.querySelector('#dlgNo').onclick = close;
    if (inp) inp.onkeydown = e => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') close(); };
  }

  /* ---------- 派生 ---------- */
  function todayPoms() { const s = today0(); return db.pomodoros.filter(p => p.startAt >= s).sort((a, b) => a.startAt - b.startAt); }
  function activeTasks() { return db.tasks.filter(t => !t.archivedAt); }
  function archivedTasks() { return db.tasks.filter(t => !!t.archivedAt); }
  function taskById(id) { return db.tasks.find(t => t.id === id); }
  function cellsHTML() {
    const goal = db.settings.goal, tp = todayPoms();
    const n = Math.max(goal, tp.length);
    // 格子数随番茄数增长；宽度自动收缩，保证永不裁切（10 个以上会明显变细）
    const gap = 4, avail = 238;
    const w = Math.max(8, Math.min(17, Math.floor((avail - gap * (n - 1)) / n)));
    let out = '';
    for (let i = 0; i < n; i++) {
      const p = tp[i];
      let cls = 'cell';
      if (p) cls += p.minutes >= 20 ? ' k25' : (p.minutes >= 10 ? ' k15' : ' k5');
      const isOver = !!(p && i >= goal);
      if (isOver) cls += ' over';                      // 超出每日目标的部分
      const gapX = (isOver && i === goal) ? ';margin-left:8px' : '';  // 目标边界留空隙
      out += '<div class="' + cls + '" style="width:' + w + 'px' + gapX + '"></div>';
    }
    return out;
  }

  /* ---------- 视图：任务 ---------- */
  function renderTasks() {
    let list = activeTasks().slice().sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0));
    const arch = archivedTasks();
    const tp = todayPoms(), tm = minsTotal(tp);
    const todayIds = new Set(tp.map(p => p.taskId));
    const todayCounts = new Map();
    tp.forEach(p => todayCounts.set(p.taskId, (todayCounts.get(p.taskId) || 0) + 1));
    const activeId = timer ? timer.taskId : null;
    const isRun = !!(timer && timer.running);

    let rows = list.map(task => {
      const todayCount = todayCounts.get(task.id) || 0;
      const hasToday = todayCount > 0;
      const isThisRun = !!(timer && timer.taskId === task.id && timer.running);
      const isThisTimer = !!(timer && timer.taskId === task.id);
      const cls = 'row' + (hasToday ? ' today' : '') + (isThisRun ? ' run' : '') + (isThisTimer ? ' current' : '') + (task.starred ? ' starred' : '');
      let segs = '';
      for (let i = 0; i < todayCount; i++) segs += '<i></i>';

      const bar = hasToday ? '<span class="segs">' + segs + '</span>' : '';
      const onMin = (timer && timer.taskId === task.id) ? Math.round(timer.totalMs / 60000) : 0;
      const chips = [5, 15, 25].map(m => '<span class="chip num' + (m === onMin ? ' on' : '') + '" data-min="' + m + '">' + m + '</span>').join('');
      return '<div class="' + cls + '" data-id="' + task.id + '">'
        + bar
        + '<span class="star" data-act="star" title="' + esc(t('task.star')) + '">' + (task.starred ? IC.starOn : IC.star) + '</span>'
        + '<span class="t">' + esc(task.title) + '</span>'
        + '<span class="acts">'
        + '<span class="a" data-act="del" title="' + esc(t('task.del')) + '">' + IC.trash + '</span>'
        + '<span class="a" data-act="edit" title="' + esc(t('task.rename')) + '">' + IC.pencil + '</span>'
        + '</span>'
        + '<span class="chips">' + chips + '</span>'
        + '<span class="donebtn" data-act="done" title="' + esc(t('task.done')) + '">' + IC.check + '</span>'
        + '</div>';
    }).join('');

    if (!list.length) rows = '<div class="empty">' + esc(t('task.empty')) + '<br>' + esc(t('task.emptyHint')) + '</div>';

    let archHTML = '';
    if (arch.length) {
      archHTML = '<div class="done" id="archToggle">' + t('task.archived', arch.length) + ' ' + (archOpen ? '⌃' : '›') + '</div>';
      if (archOpen) {
        archHTML += '<div class="arch">' + arch.map(a =>
          '<div class="arow"><span class="t">' + esc(a.title) + '</span><span class="r" data-restore="' + a.id + '">' + esc(t('task.restore')) + '</span></div>'
        ).join('') + '</div>';
      }
    }

    frame(
      '<div class="bar"><h2>' + t('nav.tasks') + '</h2><span class="sp"></span>'
      + '<span class="ico" id="btnAdd">＋</span><span class="ico" id="btnMenu">☰</span></div>'
      + (menuOpen ? '<div class="menu" id="menu">'
        + '<div class="mi" data-go="#/stats">' + t('nav.stats') + '<span class="k">' + sc('stats') + '</span></div>'
        + '<div class="mi" data-go="#/settings">' + t('nav.settings') + '<span class="k">' + sc('settings') + '</span></div>'
        + '<div class="hr"></div>'
        + '<div class="mi" data-act="resetSize">' + t('menu.resetSize') + '<span class="k">' + sc('resetSize') + '</span></div></div>' : '')
      + runningStrip()
      + '<div class="list">' + rows + archHTML + '</div>'
      + '<div class="todaybar"><div class="cells">' + cellsHTML() + '</div>'
      + '<span class="todaytxt">' + t('today.sum', tp.length, db.settings.goal, Math.floor(tm / 60), tm % 60) + '</span>'
      + '<span class="chev" id="goStats">›</span></div>'
    );
    wireTasks();
  }

  function runningStrip() {
    if (!timer) return '';
    const task = taskById(timer.taskId);
    const name = task ? task.title : '';
    const paused = !timer.running;
    const clock = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.8"/><path d="M9 2h6"/></svg>';
    return '<div class="runstrip' + (paused ? ' paused' : '') + '" id="runstrip" data-id="' + (timer.taskId || '') + '">'
      + '<span class="rs-name">' + esc(name) + '</span>'
      + '<span class="rs-time">' + clock + '<b id="rstime">' + fmt(timer.remainingMs) + '</b></span></div>';
  }

  function wireTasks() {
    const stripEl = document.getElementById('runstrip');
    if (stripEl) stripEl.onclick = () => { const id = stripEl.dataset.id; if (id) location.hash = '#/task/' + id; };
    const add = document.getElementById('btnAdd'); if (add) add.onclick = newTask;
    const mb = document.getElementById('btnMenu'); if (mb) mb.onclick = () => { menuOpen = !menuOpen; render(); };
    document.querySelectorAll('.mi').forEach(el => el.onclick = () => {
      menuOpen = false;
      if (el.dataset.act === 'resetSize') { api.resetSize(); render(); return; }
      location.hash = el.dataset.go;
      render();
    });
    const gs = document.getElementById('goStats'); if (gs) gs.onclick = () => { location.hash = '#/stats'; };
    const at = document.getElementById('archToggle'); if (at) at.onclick = () => { archOpen = !archOpen; render(); };
    document.querySelectorAll('[data-restore]').forEach(el => el.onclick = e => {
      e.stopPropagation();
      const task = taskById(el.dataset.restore);
      if (task) { task.archivedAt = null; save(); render(); }
    });
    document.querySelectorAll('.row').forEach(row => {
      const id = row.dataset.id;
      row.addEventListener('click', e => {
        const chip = e.target.closest('.chip');
        if (chip) { startFor(id, parseInt(chip.dataset.min, 10)); return; }
        const act = e.target.closest('[data-act]');
        if (act) {
          e.stopPropagation();
          const k = act.dataset.act, task = taskById(id);
          if (k === 'edit') renameTask(task);
          else if (k === 'star') { task.starred = !task.starred; save(); render(); }
          else if (k === 'done') {
            if (timer && timer.taskId === id && (timer.running || timer.remainingMs < timer.totalMs)) { toast(t('task.stopFirst')); return; }
            task.archivedAt = Date.now(); save(); toast(t('task.archivedToast')); render();
          } else if (k === 'del') delTask(task);
          return;
        }
        location.hash = '#/task/' + id;
      });
    });
  }

  function newTask() {
    dialog({ title: t('task.new'), input: '', okText: t('btn.save'), onOk: v => {
      if (!v) return;
      db.tasks.unshift({ id: uid(), title: v, createdAt: Date.now(), archivedAt: null });
      save(); render();
    }});
  }
  function renameTask(task) {
    dialog({ title: t('task.rename'), input: task.title, okText: t('btn.save'), onOk: v => {
      if (!v) return; task.title = v; save(); render();
    }});
  }
  function delTask(task) {
    dialog({ title: t('task.del'), body: t('task.delConfirm', task.title), okText: t('task.del'), onOk: () => {
      db.tasks = db.tasks.filter(x => x.id !== task.id); save(); render();
    }});
  }
  function startFor(id, minutes) { location.hash = '#/task/' + id; startTimer(id, minutes, 'focus'); }
  function startWithGuard(id, minutes) {
    const inProgress = timer && timer.taskId === id && (timer.running || timer.remainingMs < timer.totalMs);
    if (inProgress) {
      dialog({ title: t('switch.title'), body: t('switch.body'), okText: t('switch.ok'),
        onOk: () => startTimer(id, minutes, 'focus') });
      return;
    }
    startTimer(id, minutes, 'focus');
  }
  function stopSession() {
    if (!timer) return;
    const isFocus = timer.mode === 'focus';
    dialog({
      title: isFocus ? t('stop.title') : t('stop.titleRest'),
      body: isFocus ? t('stop.body') : t('stop.bodyRest'),
      cancelText: isFocus ? t('btn.keepFocus') : t('btn.keepRest'), okText: t('btn.stop'),
      onOk: () => { stopTimer(); }
    });
  }

  /* ---------- 视图：任务页 ---------- */
  function renderTask(id) {
    const task = taskById(id);
    if (!task) { location.hash = '#/tasks'; return; }
    const mine = (timer && timer.taskId === id) ? timer : null;
    const total = mine ? mine.totalMs : db.settings.focus * 60000;
    const remaining = mine ? mine.remainingMs : total;
    const mode = mine ? mine.mode : 'focus';
    const running = !!(mine && mine.running);
    const frac = mine ? Math.max(0, Math.min(1, mine.remainingMs / mine.totalMs)) : 1;
    const active = !!(mine && (running || mine.remainingMs < mine.totalMs));
    const stage = mode === 'break' ? (running ? t('state.rest') : t('state.paused'))
      : (running ? t('state.focus') : (remaining < total ? t('state.paused') : ''));
    const primary = mine ? (running ? t('btn.pause') : t('btn.resume')) : t('btn.start');
    const tp = todayPoms();

    frame(
      '<div class="tb2"><span class="back" id="back">←</span>'
      + '<span class="title">' + esc(task.title) + '</span><span class="ico" id="btnMore">⋯</span></div>'
      + '<div class="center">'
      + '<div class="ring' + (mode === 'break' ? ' break' : '') + '">'
      + '<svg width="262" height="262">'
      + '<circle cx="131" cy="131" r="118" fill="none" stroke="#E6F0F8" stroke-width="5"/>'
      + '<path id="ringProg" d="' + ringPath(frac) + '" fill="none" stroke="' + (mode === 'break' ? '#6AACF6' : '#2C7BCB') + '" stroke-width="5" stroke-linecap="round"/>'
      + '</svg>'
      + '<div class="in"><div class="tm" id="tm">' + fmt(remaining) + '</div>'
      + (stage ? '<div class="st" id="stage">' + stage + '</div>' : '')
      + '</div></div>'
      + '<div class="acts2">'
      + '<button class="btn p" id="btnPrimary">' + primary + '</button>'
      + '<button class="btn g" id="btnSecondary">' + (active ? t('btn.stop') : t('btn.done')) + '</button>'
      + '</div>'
      + '<div class="link"><u data-nav="tasks">' + t('btn.switch') + '</u> · <u data-min="15">15 ' + t('unit.min') + '</u> · <u data-min="5">5 ' + t('unit.min') + '</u></div>'
      + '</div>'
      + '<div class="todaybar"><div class="cells">' + cellsHTML() + '</div>'
      + '<span class="todaytxt">' + t('today.count', tp.length + 1, db.settings.goal) + '</span>'
      + '</div>'
    );
    document.getElementById('back').onclick = () => { location.hash = '#/tasks'; };
    document.getElementById('btnMore').onclick = () => renameTask(task);

    document.getElementById('btnPrimary').onclick = () => {
      if (!timer || timer.taskId !== id) { startTimer(id, Math.round(total / 60000), 'focus'); return; }
      if (timer.running) pauseTimer(); else resumeTimer();
    };
    document.getElementById('btnSecondary').onclick = () => {
      if (active) { stopSession(); return; }
      task.archivedAt = Date.now(); save();
      if (timer && timer.taskId === id) { stopTimer(); }
      toast(t('task.archivedToast'));
      location.hash = '#/tasks';
    };
    document.querySelectorAll('.link u').forEach(u => {
      u.onclick = () => {
        if (u.dataset.nav === 'tasks') { location.hash = '#/tasks'; return; }
        startWithGuard(id, parseInt(u.dataset.min, 10));
      };
    });
  }

  /* ---------- 视图：统计 ---------- */
  function heatHTML() {
    const t0 = today0(), byDay = {};
    db.pomodoros.forEach(p => { const k = dayStart(p.startAt); byDay[k] = (byDay[k] || 0) + 1; });
    const startW = t0 - ((new Date(t0).getDay() + 6) % 7) * DAY - 52 * 7 * DAY;
    let out = '';
    for (let w = 0; w < 53; w++) {
      out += '<div class="hw">';
      for (let d = 0; d < 7; d++) {
        const k = startW + (w * 7 + d) * DAY, n = byDay[k] || 0;
        let lv = 0;
        if (n >= 7) lv = 4; else if (n >= 5) lv = 3; else if (n >= 3) lv = 2; else if (n >= 1) lv = 1;
        out += '<div class="hc' + (lv ? ' l' + lv : '') + '" title="' + mmdd(k) + ' · ' + n + '"></div>';
      }
      out += '</div>';
    }
    return out;
  }
  function heatLabels() {
    const t0 = today0();
    const startW = t0 - ((new Date(t0).getDay() + 6) % 7) * DAY - 52 * 7 * DAY;
    let out = '';
    for (let w = 0; w < 53; w++) {
      let lab = '';
      for (let k = 0; k < 7; k++) {
        const d = new Date(startW + (w * 7 + k) * DAY);
        if (d.getDate() === 1) { lab = (d.getMonth() + 1) + (currentLang === 'en' ? '' : '月'); break; }
      }
      out += '<span>' + lab + '</span>';
    }
    return out;
  }

  /* ---------- 统计：日期/任务聚合 ---------- */
  function dayKeyOf(ms) { const d = new Date(ms); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function fmtHM(mins) {
    if (currentLang === 'en') return Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
    return Math.floor(mins / 60) + ' 时 ' + (mins % 60) + ' 分';
  }
  function mmddText(ms) { const d = new Date(ms); return (d.getMonth() + 1) + '/' + d.getDate(); }
  function mdLong(ms) {
    const d = new Date(ms);
    return currentLang === 'en' ? (d.getMonth() + 1) + '/' + d.getDate() : (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }
  function taskDot(taskId) {
    const pal = ['#2C7BCB', '#E08A3C', '#41C678', '#8E6BD1', '#D95B6B', '#3FA9B8'];
    let h = 0; const s = String(taskId || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973;
    return pal[h % pal.length];
  }

  let selDay = null;
  let openMonths = null;   // 全部历史里展开的月份集合
  let openDays = null;     // 展开的日期集合

  function renderStats() {
    const all = db.pomodoros;
    const now = new Date(), t0 = today0();
    let from, to;
    if (period === 'week') {
      const dow = (new Date(t0).getDay() + 6) % 7;
      from = t0 - dow * DAY; to = from + 7 * DAY;
    } else if (period === 'month') {
      from = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      to = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
    } else {
      from = new Date(now.getFullYear(), 0, 1).getTime();
      to = new Date(now.getFullYear() + 1, 0, 1).getTime();
    }
    if (!selDay || selDay < from || selDay >= to) selDay = (t0 >= from && t0 < to) ? t0 : from;

    const n = period === 'week' ? 7 : (period === 'month' ? Math.round((to - from) / DAY) : 12);
    const cells = [];
    for (let i = 0; i < n; i++) {
      let s, e;
      if (period === 'year') { s = new Date(now.getFullYear(), i, 1).getTime(); e = new Date(now.getFullYear(), i + 1, 1).getTime(); }
      else { s = from + i * DAY; e = s + DAY; }
      let c = 0, m = 0;
      for (let j = 0; j < all.length; j++) {
        const p = all[j];
        if (p.startAt >= s && p.startAt < e) { c++; m += p.minutes || 0; }
      }
      cells.push({ s, e, n: c, mins: m });
    }

    const maxN = Math.max.apply(null, cells.map(c => c.n).concat([1]));
    const step = Math.max(1, Math.ceil(maxN / 4));
    const top = step * 4;
    const yTicks = [];
    for (let i = 0; i <= 4; i++) yTicks.push(top - i * step);   // 上大下小

    const selIdx = Math.max(0, cells.findIndex(c => selDay >= c.s && selDay < c.e));
    const cols = cells.map((c, i) => {
      const h = c.n ? Math.max(5, Math.round(c.n / top * 100)) : 0;
      const body = c.n
        ? '<span class="bval">' + c.n + '</span><div class="cbar' + (i === selIdx ? ' sel' : '') + '" style="height:' + h + '%"></div>'
        : '<div class="cbar zero"></div>';
      return '<div class="ccol" data-s="' + c.s + '">' + body + '</div>';
    }).join('');

    const xlabs = cells.map((c, i) => {
      let txt = '', sub = '';
      if (period === 'week') { txt = mmddText(c.s); sub = wd(c.s); }
      else if (period === 'month') { const dm2 = new Date(c.s); txt = (i === 0 || (i + 1) % 5 === 0) ? String(dm2.getDate()) : ''; }
      else { txt = currentLang === 'en' ? String(i + 1) : (i + 1) + '月'; }
      return '<span class="' + (i === selIdx ? 'on' : '') + '">' + txt + (sub ? '<i>' + sub + '</i>' : '') + '</span>';
    }).join('');

    const sel = cells[selIdx] || { n: 0, mins: 0 };
    const pomsIn = all.filter(p => p.startAt >= from && p.startAt < to);
    const pn = pomsIn.length, pm = pomsIn.reduce((a, p) => a + (p.minutes || 0), 0);
    const goal = db.settings.goal;
    const dm = new Map();
    pomsIn.forEach(p => { const k = dayKeyOf(p.startAt); dm.set(k, (dm.get(k) || 0) + 1); });
    let goalDays = 0; dm.forEach(v => { if (v >= goal) goalDays++; });

    const share = new Map();
    pomsIn.forEach(p => {
      if (!taskById(p.taskId)) return;   // 已删除任务不进排行（历史事实仍保留在总时长与历史页）
      const o = share.get(p.taskId) || 0;
      share.set(p.taskId, o + (p.minutes || 0));
    });
    const shareTotal = [...share.values()].reduce((a, b) => a + b, 0);
    const rank = [...share.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const rankHTML = rank.length ? rank.map(([tid, mins], i) => {
      const task = taskById(tid);
      const pct = shareTotal ? Math.round(mins / shareTotal * 100) : 0;
      return '<div class="rk"><span class="no n' + (i + 1) + '">' + (i + 1) + '</span>'
        + '<span class="nm">' + esc(task ? task.title : t('task.removed')) + '</span>'
        + '<span class="mt num">' + fmtHM(mins) + '</span>'
        + '<span class="pc num">' + pct + '%</span></div>';
    }).join('') : '<div class="rk empty">' + t('stats.noRecord') + '</div>';

    const pname = period === 'week' ? t('period.thisWeek') : (period === 'month' ? t('period.thisMonth') : t('period.thisYear'));

    frame(
      '<div class="tb2 page"><span class="back" id="back">←</span><span class="title">' + t('nav.stats') + '</span><span class="ico"></span></div>'
      + '<div class="pane" style="flex:1;overflow-y:auto">'
      + '<div class="seg">'
      + '<span data-p="week" class="' + (period === 'week' ? 'on' : '') + '">' + t('period.week') + '</span>'
      + '<span data-p="month" class="' + (period === 'month' ? 'on' : '') + '">' + t('period.month') + '</span>'
      + '<span data-p="year" class="' + (period === 'year' ? 'on' : '') + '">' + t('period.year') + '</span></div>'
      + '<div class="selday"><div class="sd">' + mdLong(selDay) + ' · ' + wd(selDay) + '</div>'
      + '<div class="sv"><b class="num">' + sel.n + '</b><span>' + t('unit.pcs') + '</span>'
      + '<em class="num">' + fmtHM(sel.mins) + '</em></div></div>'
      + '<div class="chartwrap">'
      + '<div class="plot"><div class="grid"><i></i><i></i><i></i><i></i><i></i></div>'
      + '<div class="cols">' + cols + '</div>'
      + '<div class="guide" style="left:' + ((selIdx + 0.5) / n * 100).toFixed(2) + '%"></div></div>'
      + '<div class="yax">' + yTicks.map(v => '<span>' + v + '</span>').join('') + '</div>'
      + '</div>'
      + '<div class="xax' + (period === 'month' ? ' month' : '') + '">' + xlabs + '</div>'
      + '<div class="kpis">'
      + '<div class="kpi"><div class="k">' + t('stats.poms') + '</div><div class="v num">' + pn + '</div></div>'
      + '<div class="kpi"><div class="k">' + t('stats.duration') + '</div><div class="v num">' + fmtHM(pm) + '</div></div>'
      + '<div class="kpi"><div class="k">' + t('stats.goalDays') + '</div><div class="v num">' + goalDays + '</div></div>'
      + '</div>'
      + '<div class="sec" style="display:flex;align-items:center">' + t('stats.share') + '<span class="period-note">' + pname + '</span></div>'
      + '<div class="ranklist">' + rankHTML + '</div>'
      + '<div class="srlink" id="goHist"><span>' + t('stats.all') + '</span><span class="ar">›</span></div>'
      + '<div class="sec">' + t('stats.yearHeat') + '</div>'
      + '<div class="heatscroll"><div class="heatlab">' + heatLabels() + '</div><div class="heat">' + heatHTML() + '</div></div>'
      + '</div>'
    );
    document.getElementById('back').onclick = () => { location.hash = '#/tasks'; };
    document.querySelectorAll('.seg span').forEach(el => el.onclick = () => { period = el.dataset.p; selDay = null; renderStats(); });
    document.querySelectorAll('.ccol').forEach(el => el.onclick = () => { selDay = Number(el.dataset.s); renderStats(); });
    document.getElementById('goHist').onclick = () => { location.hash = '#/history'; };
    const hs = document.querySelector('.heatscroll');
    if (hs) hs.scrollLeft = hs.scrollWidth;
  }

  /* ---------- 视图：全部历史（按月分组 + 任务明细） ---------- */
  function renderHistory() {
    const all = db.pomodoros.slice().sort((a, b) => a.startAt - b.startAt);
    const months = new Map();
    let totalM = 0, daySet = new Set();
    all.forEach(p => {
      const d = new Date(p.startAt);
      const mk = d.getFullYear() + '-' + (d.getMonth() + 1);
      if (!months.has(mk)) months.set(mk, { y: d.getFullYear(), m: d.getMonth() + 1, days: new Map(), n: 0, mins: 0 });
      const M = months.get(mk);
      M.n++; M.mins += p.minutes || 0; totalM += p.minutes || 0;
      const ds = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const dk = String(ds);
      daySet.add(dk);
      if (!M.days.has(dk)) M.days.set(dk, { ts: ds, tasks: new Map(), n: 0, mins: 0 });
      const D = M.days.get(dk);
      D.n++; D.mins += p.minutes || 0;
      const o = D.tasks.get(p.taskId) || { n: 0, mins: 0 };
      o.n++; o.mins += p.minutes || 0; D.tasks.set(p.taskId, o);
    });

    const mkKeys = [...months.keys()].sort((a, b) => {
      const A = months.get(a), B = months.get(b);
      return (B.y - A.y) || (B.m - A.m);
    });

    // 日期折叠状态：默认只展开最近一天
    const newestDayKey = (() => {
      for (const mkk of mkKeys) {
        const MM = months.get(mkk);
        const ks = [...MM.days.keys()].map(Number).sort((a, b) => b - a);
        if (ks.length) return String(ks[0]);
      }
      return null;
    })();
    if (!openDays) {
      try {
        const saved = JSON.parse(localStorage.getItem('tomato:histOpenDays') || 'null');
        openDays = new Set(saved === null ? (newestDayKey ? [newestDayKey] : []) : saved);
      } catch (e) { openDays = new Set(newestDayKey ? [newestDayKey] : []); }
    }

    // 月份折叠状态：默认只展开最近一个月；展开状态持久化
    if (!openMonths) {
      try { openMonths = new Set(JSON.parse(localStorage.getItem('tomato:histOpen') || 'null') || [mkKeys[0]]); }
      catch (e) { openMonths = new Set([mkKeys[0]]); }
    }
    let html = '';
    mkKeys.forEach(mk => {
      const M = months.get(mk);
      const open = openMonths.has(mk);
      const dayKeys = [...M.days.keys()].map(Number).sort((a, b) => b - a);
      let rows = '';
      if (open) dayKeys.forEach(dk => {
        const D = M.days.get(String(dk));
        const dKey = String(dk);
        const dOpen = openDays.has(dKey);
        const entries = [...D.tasks.entries()].sort((a, b) => b[1].n - a[1].n);
        rows += '<div class="dgroup' + (dOpen ? ' open' : '') + '">'
          + '<div class="dhead" data-dk="' + dKey + '"><span class="car">' + (dOpen ? '▾' : '▸') + '</span>'
          + '<b>' + mdLong(dk) + '</b><span class="wd">' + wd(dk) + '</span>'
          + '<span class="num">' + D.n + ' ' + t('unit.pcs') + ' · ' + fmtHM(D.mins) + '</span></div>';
        if (dOpen) entries.forEach(([tid, o]) => {
          const task = taskById(tid);
          rows += '<div class="trow"><span class="dot" style="background:' + taskDot(tid) + '"></span>'
            + '<span class="nm">' + esc(task ? task.title : t('task.removed')) + '</span>'
            + '<span class="num">' + o.n + ' ' + t('unit.pcs') + ' · ' + fmtHM(o.mins) + '</span></div>';
        });
        rows += '</div>';
      });
      html += '<div class="mgroup' + (open ? ' open' : '') + '">'
        + '<div class="mhead" data-mk="' + mk + '"><span class="car">' + (open ? '▾' : '▸') + '</span>'
        + '<b>' + (M.y) + (currentLang === 'en' ? '/' : '年') + M.m + (currentLang === 'en' ? '' : '月') + '</b>'
        + '<span class="num">' + M.n + ' ' + t('unit.pcs') + ' · ' + fmtHM(M.mins) + '</span></div>' + rows + '</div>';
    });

    frame(
      '<div class="tb2 page"><span class="back" id="back">←</span><span class="title">' + t('nav.history') + '</span><span class="ico"></span></div>'
      + '<div class="pane" style="flex:1;overflow-y:auto">'
      + '<div class="histsum">' + t('stats.recap', daySet.size, all.length, Math.floor(totalM / 60), totalM % 60) + '</div>'
      + (html || '<div class="empty" style="padding:24px 0">' + t('stats.noRecord') + '</div>')
      + '</div>'
    );
    document.querySelectorAll('.mhead').forEach(el => el.onclick = () => {
      const mk = el.dataset.mk;
      if (openMonths.has(mk)) openMonths.delete(mk); else openMonths.add(mk);
      try { localStorage.setItem('tomato:histOpen', JSON.stringify([...openMonths])); } catch (e) {}
      renderHistory();
    });
    document.querySelectorAll('.dhead').forEach(el => el.onclick = () => {
      const dk = el.dataset.dk;
      if (openDays.has(dk)) openDays.delete(dk); else openDays.add(dk);
      try { localStorage.setItem('tomato:histOpenDays', JSON.stringify([...openDays])); } catch (e) {}
      renderHistory();
    });
    document.getElementById('back').onclick = () => { location.hash = '#/stats'; };
  }

  /* ---------- 视图：设置 ---------- */
  function stepRow(label, key, val, unit) {
    return '<div class="sr"><span class="lab">' + label + '</span>'
      + '<span class="stepper"><span data-step="' + key + '" data-len="-1">−</span>'
      + '<b class="num">' + val + '</b>'
      + '<span data-step="' + key + '" data-len="1">＋</span></span>'
      + '<span class="hint">' + unit + '</span></div>';
  }
  function switchRow(label, key, on) {
    return '<div class="sr"><span class="lab">' + label + '</span>'
      + '<span class="sw' + (on ? ' on' : '') + '" data-sw="' + key + '"></span></div>';
  }
  function renderSettings() {
    const s = db.settings;
    frame(
      '<div class="tb2 page"><span class="back" id="back">←</span><span class="title">' + t('nav.settings') + '</span><span class="ico"></span></div>'
      + '<div class="setsec">'
      + '<div class="h">' + t('set.lang') + '</div>'
      + '<div class="sr"><span class="lab">' + (currentLang === 'en' ? 'Interface' : '界面语言') + '</span>'
      + '<span class="stepper" style="border:none"><span data-lang="zh" style="width:auto;padding:0 10px;' + (s.lang === 'zh' ? 'color:#2C7BCB;font-weight:600' : '') + '">中文</span>'
      + '<span data-lang="en" style="width:auto;padding:0 10px;' + (s.lang === 'en' ? 'color:#2C7BCB;font-weight:600' : '') + '">English</span></span></div>'
      + '<div class="h">' + t('set.appearance') + '</div>'
      + '<div class="sr"><span class="lab">' + t('set.theme') + '</span>'
      + '<span class="stepper" style="border:none"><span data-theme="light" style="width:auto;padding:0 10px;' + (s.theme !== 'dark' ? 'color:#2C7BCB;font-weight:600' : '') + '">' + t('set.themeLight') + '</span>'
      + '<span data-theme="dark" style="width:auto;padding:0 10px;' + (s.theme === 'dark' ? 'color:#2C7BCB;font-weight:600' : '') + '">' + t('set.themeDark') + '</span></span></div>'
      + '<div class="h">' + t('set.timer') + '</div>'
      + stepRow(t('set.focus'), 'focus', s.focus, t('unit.min'))
      + stepRow(t('set.rest'), 'rest', s.rest, t('unit.min'))
      + switchRow(t('set.autoRest'), 'autoRest', s.autoRest)
      + '<div class="h">' + t('set.goal') + '</div>'
      + stepRow(t('set.dailyGoal'), 'goal', s.goal, t('unit.pcs'))
      + '<div class="sr"><span class="lab">' + t('set.cells') + '</span><span class="val">' + t('set.cellsHint') + '</span></div>'
      + '<div class="h">' + t('set.remind') + '</div>'
      + switchRow(t('set.sound'), 'sound', s.sound)
      + switchRow(t('set.notify'), 'notify', s.notify)
      + '<div class="h">' + t('set.data') + '</div>'
      + switchRow(t('set.autostart'), 'autostart', !!s.autostart)
      + '<div class="sr pathrow" id="openDir" title="' + esc(dataDirInfo.dir || '') + '">'
      + '<span class="lab">' + t('set.dataDir') + '</span>'
      + '<span class="val path"><span class="ptxt" title="' + esc(dataDirInfo.dir || '') + '">' + esc(tailPath(dataDirInfo.dir)) + '</span>'
      + '<span class="ico-line">' + IC.folder + '</span></span></div>'
      + (dataDirInfo.fallback ? '<div class="warn">' + t('set.dataDirFallback') + '</div>' : '')
      + '<div class="sr sub" id="changeDir"><span class="lab">' + t('set.changeDir') + '</span><span class="val"><span class="ico-line">' + IC.folder + '</span></span></div>'
      + '<div class="hint">' + t('set.changeDirHint') + '</div>'
      + '<div class="h">' + t('set.localData') + '</div>'
      + '<div class="sr" id="exportData"><span class="lab">' + t('set.export') + '</span><span class="val"><span class="ico-line">' + IC.export + '</span></span></div>'
      + '<div class="sr" id="importData"><span class="lab">' + t('set.import') + '</span><span class="val"><span class="ico-line">' + IC.upload + '</span></span></div>'
      + '<div class="sr rowdanger" id="clear"><span class="lab">' + t('set.clear') + '</span><span class="val"><span class="ico-line">' + IC.trash + '</span></span></div>'
      + '</div>'
      + '<div class="footnote">' + t('set.foot') + '</div>'
    );
    document.getElementById('back').onclick = () => { location.hash = '#/tasks'; };
    document.querySelectorAll('[data-step]').forEach(el => el.onclick = () => {
      const k = el.dataset.step, len = el.dataset.len === '1' ? 1 : -1;
      const bounds = { focus: [1, 120], rest: [1, 60], goal: [1, 20] }[k];
      s[k] = Math.max(bounds[0], Math.min(bounds[1], s[k] + len));
      save(); renderSettings();
    });
    document.querySelectorAll('[data-sw]').forEach(el => el.onclick = () => {
      const k = el.dataset.sw;
      s[k] = !s[k];
      if (k === 'autostart' && api.autostart) api.autostart(!!s[k]);
      save(); renderSettings();
    });
    document.querySelectorAll('.sr [data-theme]').forEach(el => el.onclick = () => {
      s.theme = el.dataset.theme; applyTheme(s.theme); save(); renderSettings();
    });
    document.querySelectorAll('[data-lang]').forEach(el => el.onclick = () => {
      s.lang = el.dataset.lang; setLang(s.lang); if (api.setLang) api.setLang(s.lang); save(); render();
    });
    document.getElementById('clear').onclick = () => {
      const tCount = db.tasks.length, pCount = db.pomodoros.length;
      dialog({
        title: t('set.clear'),
        warn: true,
        body: t('set.clearConfirmN', tCount, pCount) + '\n\n' + t('set.clearBackupNote'),
        okText: t('set.clearNext'),
        onOk: () => {
          // 二次确认：真正清空前再问一遍
          dialog({
            title: t('set.clear'),
            warn: true,
            body: t('set.clearAgain'),
            okText: t('set.clear'),
            onOk: async () => {
              const lang = s.lang;
              db = defaults(); db.settings.lang = lang; timer = null;
              await api.clear();
              save(); toast(t('set.cleared')); location.hash = '#/tasks';
            }
          });
        }
      });
    };

    /* --- 数据位置 / 导出 / 导入 --- */
    const openDirEl = document.getElementById('openDir');
    if (openDirEl) openDirEl.onclick = () => api.openDataDir();

    const exportEl = document.getElementById('exportData');
    if (exportEl) exportEl.onclick = async () => {
      const r = await api.exportData();
      if (r && r.ok) toast(t('set.exported', r.file));
      else if (r && !r.canceled) toast(t('set.dirFailed', r.error || 'error'));
    };

    const changeEl = document.getElementById('changeDir');
    if (changeEl) changeEl.onclick = async () => {
      const pick = await api.pickDataDir();
      if (!pick || !pick.ok) return;
      const target = pick.dir;
      dialog({
        title: t('set.changeDir'),
        body: target + '\n\n' + (currentLang === 'en'
          ? 'Copy current data there? Old files are kept as backup.'
          : '把当前数据复制到该目录？旧位置的文件会改名保留备份。'),
        okText: t('set.changeDir'),
        onOk: async () => {
          const r = await api.setDataDir(target);
          if (r && r.ok) {
            dataDirInfo = await api.dataDir();
            db = await api.load() || db;
            toast(t('set.dirChanged'));
            renderSettings();
          } else {
            toast(t('set.dirFailed', (r && r.error) || 'error'));
          }
        }
      });
    };

    const importEl = document.getElementById('importData');
    if (importEl) importEl.onclick = async () => {
      const pick = await api.importPick();
      if (!pick || !pick.ok) {
        if (pick && pick.error === 'bad-format') toast(t('set.importBad'));
        return;
      }
      const c = pick.counts || { tasks: 0, pomodoros: 0 };
      dialog({
        title: t('set.import'),
        body: t('set.importConfirm', c.tasks, c.pomodoros),
        okText: t('set.import'),
        onOk: async () => {
          const r = await api.importApply(pick.file);
          if (r && r.ok) {
            db = await api.load() || defaults();
            db.settings = Object.assign(defaults().settings, db.settings);
            setLang(db.settings.lang || currentLang);
            timer = await api.timerGet();
            toast(t('set.imported', r.counts.tasks, r.counts.pomodoros));
            location.hash = '#/tasks';
            render();
          } else {
            toast(t('set.dirFailed', (r && r.error) || 'error'));
          }
        }
      });
    };
  }

  /* ---------- 路由 ---------- */
  function render() {
    const h = location.hash || '#/tasks';
    if (h.indexOf('#/task/') === 0) renderTask(h.slice(7));
    else if (h === '#/stats') renderStats();
    else if (h === '#/settings') renderSettings();
    else if (h === '#/history') renderHistory();
    else renderTasks();
    paintTimer();
  }

  /* ---------- 启动 ---------- */
  async function boot() {
    db = await api.load();
    if (!db || !db.settings) db = defaults();
    db.settings = Object.assign(defaults().settings, db.settings);
    setLang(db.settings.lang || 'zh');
    applyTheme(db.settings.theme || 'light');
    if (api.setLang) api.setLang(getLang());

    // 计时状态由主进程持有（关窗口也能继续走）
    timer = await api.timerGet();
    try { dataDirInfo = (await api.dataDir()) || dataDirInfo; } catch (e) {}
    api.onTick(s => { timer = s; paintTimer(); });
    api.onState(s => { timer = s; render(); });
    api.onDone(d => onTimerDone(d));
    if (api.onUiCmd) api.onUiCmd(cmd => {
      if (cmd === 'stats') location.hash = '#/stats';
      else if (cmd === 'settings') location.hash = '#/settings';
      else if (cmd === 'resetSize') api.resetSize();
    });

    if (!location.hash) location.hash = '#/tasks';
    render();
  }

  window.addEventListener('hashchange', () => { menuOpen = false; render(); });
  // 双击任意页面标题栏 = 恢复默认窗口尺寸（420×680 并居中），任务列表页/统计页都可用
  document.addEventListener('dblclick', e => {
    if (!e.target.closest) return;
    if (!e.target.closest('.tb2, .bar')) return;
    if (e.target.closest('#back, #btnAdd, #btnMenu')) return;
    api.resetSize();
  });
  // 点击菜单以外的地方 → 收起菜单
  document.addEventListener('mousedown', e => {
    if (!menuOpen) return;
    if (!e.target.closest) return;
    if (e.target.closest('#menu') || e.target.closest('#btnMenu')) return;
    menuOpen = false;
    render();
  }, true);
  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && location.hash.indexOf('#/task/') === 0) {
      e.preventDefault();
      const b = document.getElementById('btnPrimary');
      if (b) b.click();
    }
    if (e.key === 'Escape' && location.hash !== '#/tasks') location.hash = '#/tasks';

  });
  boot();
})();
