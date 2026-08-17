'use strict';

// ── Tauri bridge ────────────────────────────────────────────────────────────
export const invoke = window.__TAURI__.core.invoke;
const { getCurrentWindow } = window.__TAURI__.window;
const appWindow = getCurrentWindow();

// ── Window controls ─────────────────────────────────────────────────────────
document.getElementById('btn-close').addEventListener('click', () => invoke('close_window'));
document.getElementById('btn-min').addEventListener('click',   () => invoke('minimize_window'));
document.getElementById('btn-max').addEventListener('click',   () => invoke('toggle_maximize'));
document.getElementById('btn-bug')?.addEventListener('click',   () => invoke('open_path', { path: 'https://github.com/AuZzii-Xssistant/ctrl/issues' }));
document.getElementById('btn-heart')?.addEventListener('click', () => invoke('open_path', { path: 'https://ko-fi.com' }));

// ── Pane router ─────────────────────────────────────────────────────────────
let _activePane = 'dash';

const _paneLoaders = {
  dash:     ()  => import('./modules/dashboard.js').then(m => m.load()),
  fixes:    (s) => import('./modules/fixes.js').then(m => m.load(s)),
  scripts:  (s) => import('./modules/scripts.js').then(m => m.load(s)),
  builder:  ()  => import('./modules/builder.js').then(m => m.load()),
  tools:    (s) => import('./modules/tools.js').then(m => m.load(s)),
  projects: (s) => import('./modules/projects.js').then(m => m.load(s)),
  workflows:()  => import('./modules/workflows.js').then(m => m.load()),
  backup:   ()  => import('./modules/backup.js').then(m => m.load()),
  tweaks:   ()  => import('./modules/tweaks.js').then(m => m.load()),
  env:      ()  => import('./modules/env.js').then(m => m.load()),
  snippets: ()  => import('./modules/snippets.js').then(m => m.load()),
  compare:   ()  => import('./modules/compare.js').then(m => m.load()),
  activity:  ()  => import('./modules/activity.js').then(m => m.load()),
  changelog: ()  => import('./modules/changelog.js').then(m => m.load()),
  settings:  ()  => import('./modules/settings.js').then(m => m.load()),
};

export function goPane(id, search = '') {
  if (_activePane === id && !search) return;
  document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(id + '-pane').classList.add('active');
  document.querySelector(`.nav-btn[data-pane="${id}"]`)?.classList.add('active');
  _activePane = id;
  _paneLoaders[id]?.(search);
}

document.querySelectorAll('.nav-btn[data-pane]').forEach(btn => {
  btn.addEventListener('click', () => goPane(btn.dataset.pane));
});

// ── Toast v2 ─────────────────────────────────────────────────────────────────
const _TOAST_ICONS = { ok: 'ti-circle-check', err: 'ti-circle-x', info: 'ti-info-circle' };
let _toastTimer;
export function toast(msg, type = 'info') {
  const el   = document.getElementById('toast');
  el.querySelector('.toast-icon').className = `ti ${_TOAST_ICONS[type] || 'ti-info-circle'} toast-icon`;
  el.querySelector('.toast-msg').textContent = msg;
  el.className = ''; // reset animation
  void el.offsetWidth; // force reflow so animation restarts
  el.className = `show t-${type}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.className = el.className.replace('show', '').trim(); }, 2800);
}

// ── Terminal / Output drawer — multi-tab PTY ─────────────────────────────────
const { listen } = window.__TAURI__.event;

let _shells    = [];
let _needsFit  = false; // window resized while drawer closed

// Tab state: each entry owns one xterm + one PTY session
const _tabs = [];      // [{id, name, shell, term, fit, div, started, runLock, unlisten, lastCols, lastRows}]
let _activeTabId   = 0;
let _nextTabId     = 1;
let _runTargetTabId = 0; // tab receiving the current script run

function _activeTab() { return _tabs.find(t => t.id === _activeTabId) || null; }

function _shellLabel(name) {
  // Full names for tab sidebar
  if (/PowerShell 7|pwsh/i.test(name))  return 'PowerShell 7';
  if (/Windows PowerShell/i.test(name)) return 'PowerShell 5';
  if (/Command/i.test(name))            return 'Command Prompt';
  if (/WSL/i.test(name))                return 'WSL';
  if (/Git/i.test(name))                return 'Git Bash';
  return name;
}
function _shellShort(name) {
  // Short names for header picker buttons
  if (/PowerShell 7|pwsh/i.test(name))  return 'PS7';
  if (/Windows PowerShell/i.test(name)) return 'PS5';
  if (/Command/i.test(name))            return 'CMD';
  if (/WSL/i.test(name))                return 'WSL';
  if (/Git/i.test(name))                return 'Bash';
  return name.slice(0, 5);
}

const _XTERM_THEME = {
  background: '#0d0d0d', foreground: '#d4d4d4', cursor: '#f0a500',
  black: '#1a1a1a', red: '#ef4444', green: '#10b981', yellow: '#f5a623',
  blue: '#60a5fa', magenta: '#a78bfa', cyan: '#34d399', white: '#e5e7eb',
  brightBlack: '#4b5563', brightWhite: '#f9fafb',
};

async function _spawnTab(shell) {
  const id  = _nextTabId++;
  const body = document.getElementById('output-body');

  const div = document.createElement('div');
  div.className = 'term-tab-body';
  body.appendChild(div);

  const term = new window.Terminal({
    theme: _XTERM_THEME,
    fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace",
    fontSize: 12, cursorBlink: true, scrollback: 10000, convertEol: true,
    allowProposedApi: true,
  });
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(div);

  const tab = { id, name: _shellLabel(shell.name), shell, term, fit, div,
                started: false, runLock: false, unlisten: [], lastCols: 0, lastRows: 0 };

  term.onData(data => {
    if (!tab.runLock) invoke('pty_write', { tabId: id, data }).catch(() => {});
  });

  const u1 = await listen(`pty-data-${id}`, e => term.write(e.payload));
  const u2 = await listen(`pty-exit-${id}`, () => {
    tab.started  = false;
    tab.runLock  = false;
    term.write('\r\n\x1b[33m[Process exited — press any key to restart]\x1b[0m\r\n');
    // One-shot restart on next keypress
    const disp = term.onData(() => { disp.dispose(); _startTabPty(tab); });
    _renderTabBar();
  });
  tab.unlisten = [u1, u2];
  _tabs.push(tab);

  _switchToTab(id);
  await _startTabPty(tab);
  return tab;
}

async function _startTabPty(tab) {
  if (tab.started) return;
  try {
    await invoke('pty_open', {
      tabId: tab.id,
      shell: tab.shell.path,
      args:  tab.shell.args,
      cols:  tab.term.cols || 80,
      rows:  tab.term.rows || 24,
    });
    tab.started = true;
  } catch(err) {
    tab.term.write(`\r\n\x1b[31m[PTY error: ${err}]\x1b[0m\r\n`);
  }
}

function _switchToTab(id) {
  _activeTabId = id;
  _tabs.forEach(t => { t.div.style.display = t.id === id ? '' : 'none'; });
  const tab = _activeTab();
  if (tab) {
    requestAnimationFrame(() => {
      try { tab.fit.fit(); } catch {}
      const c = tab.term.cols || 80, r = tab.term.rows || 24;
      if (tab.started && (c !== tab.lastCols || r !== tab.lastRows)) {
        tab.lastCols = c; tab.lastRows = r;
        invoke('pty_resize', { tabId: id, cols: c, rows: r }).catch(() => {});
      }
      if (document.getElementById('output-drawer')?.classList.contains('open')) tab.term.focus();
    });
  }
  _renderTabBar();
}

async function _closeTab(id) {
  const idx = _tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  const tab = _tabs[idx];
  for (const u of tab.unlisten) u();
  await invoke('pty_close', { tabId: id }).catch(() => {});
  tab.div.remove();
  _tabs.splice(idx, 1);
  if (_activeTabId === id) {
    const next = _tabs[Math.min(idx, _tabs.length - 1)];
    if (next) _switchToTab(next.id);
    else { _activeTabId = 0; _renderTabBar(); }
  } else {
    _renderTabBar();
  }
}

function _renderTabBar() {
  const wrap = document.getElementById('term-tab-sidebar');
  if (!wrap) return;
  wrap.innerHTML = _tabs.map(t =>
    `<div class="term-tab${t.id === _activeTabId ? ' active' : ''}${t.runLock ? ' running' : ''}" data-tab="${t.id}">
      <span class="term-tab-name">${t.name}</span>
      <button class="term-tab-x" data-close="${t.id}" title="Close tab">×</button>
    </div>`
  ).join('');
  wrap.querySelectorAll('.term-tab').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      if (!e.target.closest('.term-tab-x')) _switchToTab(+el.dataset.tab);
    });
  });
  wrap.querySelectorAll('.term-tab-x').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); _closeTab(+btn.dataset.close); });
  });
}

function _buildShellPicker() {
  const wrap = document.getElementById('term-shell-toggle');
  if (!wrap) return;
  wrap.innerHTML = _shells.map((s, i) =>
    `<button class="term-sh-btn" data-idx="${i}" title="New ${s.name} tab">${_shellShort(s.name)}</button>`
  ).join('');
  wrap.querySelectorAll('.term-sh-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      await _spawnTab(_shells[+btn.dataset.idx]);
      _openDrawer();
    });
  });
}

async function _loadShells() {
  try { _shells = await invoke('list_shells'); } catch { _shells = []; }
  if (!_shells.length) _shells = [{ name: 'Windows PowerShell', path: 'powershell', args: ['-NoLogo'] }];
  _buildShellPicker();
  // Pre-spawn first tab so the drawer opens instantly
  _needsFit = true;
  await _spawnTab(_shells[0]);
}

// ── Run queue — per-tab locking, spawns new tab if active is busy ─────────────
export async function acquireRun() {
  let tab = _activeTab();
  if (!tab || tab.runLock) {
    const shell = tab?.shell || _shells[0] || { name: 'Windows PowerShell', path: 'powershell', args: ['-NoLogo'] };
    tab = await _spawnTab(shell);
    _openDrawer();
  }
  tab.runLock = true;
  _runTargetTabId = tab.id;
  _renderTabBar();
  return true;
}

export function releaseRun() {
  const tab = _tabs.find(t => t.id === _runTargetTabId);
  if (tab) { tab.runLock = false; _renderTabBar(); }
  _runTargetTabId = 0;
}

// Run-event listeners
let _pendingDrawerOpen = false;
let _elevatedPid = 0;
listen('run-start', () => {
  const d = document.getElementById('output-drawer');
  _pendingDrawerOpen = !d?.classList.contains('open');
  _openDrawer();
  document.getElementById('output-new-dot')?.style.setProperty('display', '');
});
listen('run-output', e => _activeTab()?.term.write(e.payload));  // admin mode status
listen('run-done',   () => { _activeTab()?.term.blur(); _elevatedPid = 0; });
listen('elevated-pid', e => { _elevatedPid = e.payload; });
listen('run-pty-cmd', async e => {
  const tab = _tabs.find(t => t.id === _runTargetTabId) || _activeTab();
  if (!tab) return;
  for (let i = 0; i < 30 && !tab.started; i++)
    await new Promise(r => setTimeout(r, 100));
  if (!tab.started) return;
  // If the drawer was collapsed, its fit() hasn't run against the real visible
  // size yet — writing the command before that resize lands corrupts PSReadLine's
  // redraw (garbled "&" line, phantom history popup). Wait out the drawer's own
  // 220ms open transition, then fit+resize, before typing anything.
  if (_pendingDrawerOpen) await new Promise(r => setTimeout(r, 260));
  try { tab.fit.fit(); } catch {}
  const c = tab.term.cols || 80, r = tab.term.rows || 24;
  if (c !== tab.lastCols || r !== tab.lastRows) {
    tab.lastCols = c; tab.lastRows = r;
    await invoke('pty_resize', { tabId: tab.id, cols: c, rows: r }).catch(() => {});
  }
  invoke('pty_write', { tabId: tab.id, data: e.payload + '\r' }).catch(() => {});
});

// Stop button — kills the currently-executing script: unblocks the Rust-side
// poll, kills+respawns the PTY tab running it (internal), and taskkills any
// spawned external elevated console (admin runs).
export async function stopCurrentRun() {
  invoke('stop_current_run').catch(() => {});
  const tab = _tabs.find(t => t.id === _runTargetTabId) || _activeTab();
  if (tab?.started) {
    await invoke('pty_close', { tabId: tab.id }).catch(() => {});
    tab.started = false;
    tab.term.write('\r\n\x1b[33m[Stopped]\x1b[0m\r\n');
    await _startTabPty(tab);
  }
  if (_elevatedPid) { invoke('kill_process', { pid: _elevatedPid }).catch(() => {}); _elevatedPid = 0; }
}

// ── Drawer open/close ─────────────────────────────────────────────────────────

function _openDrawer() {
  const d = document.getElementById('output-drawer');
  if (!d || d.classList.contains('open')) return;
  _doOpen(d);
}

function _doOpen(d) {
  d.classList.add('open');
  setTimeout(() => _onDrawerOpened(false), 220);
}

function _toggleOutputDrawer() {
  const d = document.getElementById('output-drawer');
  const wasOpen = d.classList.contains('open');
  d.classList.toggle('open');
  document.getElementById('output-new-dot')?.style.setProperty('display', 'none');
  if (!wasOpen) setTimeout(() => _onDrawerOpened(true), 220);
  else _activeTab()?.term.blur();
}

function _onDrawerOpened(userInitiated = false) {
  const tab = _activeTab();
  if (!tab) return;
  requestAnimationFrame(() => {
    if (_needsFit) _needsFit = false;
    try { tab.fit.fit(); } catch {}
    const c = tab.term.cols || 80, r = tab.term.rows || 24;
    if (tab.started) invoke('pty_resize', { tabId: tab.id, cols: c, rows: r }).catch(() => {});
    if (userInitiated) tab.term.focus();
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export function showOutput(text, ok = true) {
  if (!text) return;
  const col   = ok ? '\x1b[32m' : '\x1b[31m';
  const clean = text.replace(/\r\n/g, '\r\n').replace(/(?<!\r)\n/g, '\r\n');
  _activeTab()?.term.write(`\r\n${col}${clean}\x1b[0m\r\n`);
  document.getElementById('output-new-dot')?.style.setProperty('display', '');
  _openDrawer();
}

// ── Event wiring ──────────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
  const tab = _activeTab();
  if (!tab) return;
  if (document.getElementById('output-drawer')?.classList.contains('open')) {
    try { tab.fit.fit(); } catch {}
    const c = tab.term.cols || 80, r = tab.term.rows || 24;
    if (tab.started) invoke('pty_resize', { tabId: tab.id, cols: c, rows: r }).catch(() => {});
  } else {
    _needsFit = true;
  }
});

document.getElementById('output-header').addEventListener('click', e => {
  if (e.target.closest('#output-clear,#output-copy,#term-shell-toggle,#term-admin-shell')) return;
  _toggleOutputDrawer();
});

document.getElementById('output-clear').addEventListener('click', e => {
  e.stopPropagation();
  const tab = _activeTab();
  tab?.term.clear();
  if (tab?.started) invoke('pty_write', { tabId: tab.id, data: '\x0c' }).catch(() => {});
  document.getElementById('output-new-dot')?.style.setProperty('display', 'none');
});

document.getElementById('output-copy').addEventListener('click', e => {
  e.stopPropagation();
  const sel = _activeTab()?.term.getSelection();
  if (!sel) { toast('Select text first', 'info'); return; }
  try {
    const ta = document.createElement('textarea');
    ta.value = sel;
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    toast('Copied', 'ok');
  } catch { toast('Copy failed', 'err'); }
});

// ── Admin elevation state ─────────────────────────────────────────────────────

invoke('is_elevated').then(elevated => {
  if (!elevated) return;
  const btn = document.getElementById('term-admin-shell');
  if (btn) {
    btn.classList.add('elevated');
    btn.title = 'Running as Administrator';
    btn.innerHTML = '<i class="ti ti-shield-check"></i> admin';
  }
});

document.getElementById('term-admin-shell')?.addEventListener('click', e => {
  e.stopPropagation();
  invoke('open_elevated_terminal')
    .then(() => toast('Admin terminal opened', 'ok'))
    .catch(err => toast(String(err), 'err'));
});

_loadShells();

// ── Custom modal ─────────────────────────────────────────────────────────────
let _confirmResolve = null;
let _promptResolve = null;

export function openModal(title, bodyHtml) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  // Disable browser autocomplete/autofill on all modal inputs
  document.querySelectorAll('#modal-body input, #modal-body textarea, #modal-body select').forEach(el => {
    el.setAttribute('autocomplete', 'off');
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('spellcheck', 'false');
  });
  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('global-search').disabled = true;
  // Enter key: move to next input, or click primary btn on last field
  setTimeout(() => {
    const inputs = [...document.querySelectorAll('#modal-body input:not([type=checkbox]), #modal-body select, #modal-body textarea')];
    inputs.forEach((inp, i) => {
      inp.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        if (inp.tagName === 'TEXTAREA') return; // let textarea use Enter normally
        e.preventDefault();
        const next = inputs[i + 1];
        if (next) next.focus();
        else document.querySelector('#modal-body .btn-primary, #modal-box .btn-primary')?.click();
      });
    });
    inputs[0]?.focus();
  }, 50);
}

export function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  document.getElementById('global-search').disabled = false;
  if (_confirmResolve) { _confirmResolve(false); _confirmResolve = null; }
  if (_promptResolve)  { _promptResolve(null);   _promptResolve = null; }
}

/** Replaces browser prompt(). Returns Promise<string|null>. */
export function promptText(title, label, defaultVal = '') {
  return new Promise(resolve => {
    _promptResolve = resolve;
    openModal(title, `
      <div class="form-row">
        <label class="form-label">${esc(label)}</label>
        <input class="form-input" id="pt-input" value="${esc(defaultVal)}">
      </div>
      <div class="form-actions">
        <button class="action-btn btn-ghost" onclick="window._modalCancel()">Cancel</button>
        <button class="action-btn btn-primary" onclick="window._promptOk()">OK</button>
      </div>`);
    document.getElementById('pt-input')?.select();
  });
}
window._promptOk = () => {
  const v = document.getElementById('pt-input')?.value ?? '';
  document.getElementById('modal-overlay').classList.remove('open');
  if (_promptResolve) { _promptResolve(v); _promptResolve = null; }
  _confirmResolve = null;
};

/** Replaces browser confirm(). Returns Promise<boolean>. */
export function confirmDialog(message, danger = false) {
  return new Promise(resolve => {
    _confirmResolve = resolve;
    const btnClass = danger ? 'btn-danger' : 'btn-primary';
    openModal('Confirm', `
      <p class="modal-confirm-msg">${esc(message)}</p>
      <div class="form-actions">
        <button class="action-btn btn-ghost" onclick="window._modalCancel()">Cancel</button>
        <button class="action-btn ${btnClass}" onclick="window._modalOk()">Confirm</button>
      </div>`);
  });
}

// Expose closeModal globally so onclick="closeModal()" works in any module's HTML strings
window.closeModal = closeModal;

window._modalOk = () => {
  document.getElementById('modal-overlay').classList.remove('open');
  if (_confirmResolve) { _confirmResolve(true); _confirmResolve = null; }
};
window._modalCancel = () => closeModal();

// Modal closes on Escape only (not backdrop click — too easy to lose form data)
document.getElementById('modal-x').addEventListener('click', closeModal);

// Ctrl+S in any open modal clicks its primary (Save) button instead of triggering browser save.
document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
  if (!document.getElementById('modal-overlay').classList.contains('open')) return;
  e.preventDefault();
  document.querySelector('#modal-body .btn-primary, #modal-box .btn-primary')?.click();
});

// ── Context menu ─────────────────────────────────────────────────────────────
const _ctxMenu = document.getElementById('ctx-menu');

export function showContextMenu(e, items) {
  // items: [{label, icon, action, danger?}, '---']
  e.preventDefault();
  _ctxMenu.innerHTML = items.map(item => {
    if (item === '---') return '<div class="ctx-divider"></div>';
    return `<button class="ctx-item${item.danger ? ' danger' : ''}" data-action="${esc(item.action)}">
      <i class="ti ${item.icon}"></i>${esc(item.label)}</button>`;
  }).join('');
  _ctxMenu.querySelectorAll('.ctx-item').forEach((btn, i) => {
    const item = items.filter(x => x !== '---')[i];
    btn.addEventListener('click', () => { hideContextMenu(); item.fn?.(); });
  });
  const x = Math.min(e.clientX, window.innerWidth  - 160);
  const y = Math.min(e.clientY, window.innerHeight - (_ctxMenu.offsetHeight || 120));
  _ctxMenu.style.left = x + 'px';
  _ctxMenu.style.top  = y + 'px';
  _ctxMenu.classList.add('open');
}

export function hideContextMenu() { _ctxMenu.classList.remove('open'); }
document.addEventListener('click', hideContextMenu);

// Suppress browser default context menu everywhere — we use our own
document.addEventListener('contextmenu', e => e.preventDefault());

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { hideContextMenu(); closeModal(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    if (document.getElementById('modal-overlay').classList.contains('open')) return;
    e.preventDefault(); _searchEl.focus(); _searchEl.select();
  }
  // Prevent browser built-in shortcuts that shouldn't work in a desktop app
  if (e.ctrlKey || e.metaKey) {
    const blocked = ['f', 'g', 'h', 'u', 'p', 'j', 'r'];
    if (blocked.includes(e.key.toLowerCase())) e.preventDefault();
  }
});

// ── Live stat refresh ────────────────────────────────────────────────────────
window._refreshStats = async () => {
  try {
    const stats = await invoke('get_stats');
    const el = document.getElementById('dash-scroll');
    if (!el) return;
    const vals = [stats.tools, stats.scripts, stats.fixes, stats.projects, stats.workflows ?? 0];
    el.querySelectorAll('.stat-cell').forEach((c, i) => {
      c.querySelector('.stat-num').textContent = vals[i];
    });
  } catch {}
};

// ── Global search ────────────────────────────────────────────────────────────
const _searchEl  = document.getElementById('global-search');
const _searchRes = document.getElementById('search-results');
let _searchTimer;

_searchEl.addEventListener('input', () => {
  clearTimeout(_searchTimer);
  const q = _searchEl.value.trim();
  if (!q) { _searchRes.classList.remove('open'); return; }
  _searchTimer = setTimeout(() => doSearch(q), 200);
});

_searchEl.addEventListener('keydown', e => {
  if (e.key === 'Escape') { _searchEl.value = ''; _searchRes.classList.remove('open'); _searchEl.blur(); return; }
  const items = [..._searchRes.querySelectorAll('.sr-item')];
  if (!items.length) return;
  const cur = _searchRes.querySelector('.sr-active');
  let idx = items.indexOf(cur);
  if (e.key === 'ArrowDown') { e.preventDefault(); idx = (idx + 1) % items.length; }
  else if (e.key === 'ArrowUp') { e.preventDefault(); idx = (idx - 1 + items.length) % items.length; }
  else if (e.key === 'Enter' && cur) { cur.click(); return; }
  else return;
  items.forEach(i => i.classList.remove('sr-active'));
  items[idx].classList.add('sr-active');
});

document.addEventListener('click', e => {
  if (!e.target.closest('#search-wrap')) _searchRes.classList.remove('open');
});

async function doSearch(q) {
  try {
    const data = await invoke('global_search', { query: q });
    renderSearch(data);
  } catch {}
}

const _searchSections = [
  { key: 'quick_launch', label: 'Quick Launch', icon: 'ti-rocket',       pane: 'tools', launch: 'ql' },
  { key: 'apps',         label: 'Apps',          icon: 'ti-device-desktop', pane: 'tools', launch: 'app' },
  { key: 'tools',        label: 'Tools',         icon: 'ti-tool',          pane: 'tools' },
  { key: 'scripts',      label: 'Scripts',       icon: 'ti-code',          pane: 'scripts' },
  { key: 'fixes',        label: 'Fixes',         icon: 'ti-bolt',          pane: 'fixes' },
  { key: 'projects',     label: 'Projects',      icon: 'ti-archive',       pane: 'projects' },
  { key: 'workflows',    label: 'Workflows',     icon: 'ti-player-play',   pane: 'workflows' },
  { key: 'snippets',     label: 'Snippets',      icon: 'ti-blockquote',    pane: 'snippets' },
];

function renderSearch(data) {
  let html = '';
  let total = 0;
  for (const s of _searchSections) {
    const items = data[s.key] || [];
    if (!items.length) continue;
    total += items.length;
    html += `<div class="sr-section">${s.label}</div>`;
    for (const item of items) {
      const launchAttr = s.launch ? ` data-launch="${s.launch}" data-launch-meta="${esc(item.meta)}"` : '';
      html += `<div class="sr-item" data-pane="${s.pane}"${launchAttr}>
        <i class="ti ${s.icon}" style="color:var(--text3);font-size:14px;flex-shrink:0"></i>
        <span class="sr-item-name">${esc(item.name)}</span>
        <span class="sr-item-meta">${esc(item.meta)}</span>
      </div>`;
    }
  }
  if (!total) html = `<div class="sr-empty">No results</div>`;
  _searchRes.innerHTML = html;
  _searchRes.classList.add('open');
  _searchRes.querySelectorAll('.sr-item').forEach(el => {
    el.addEventListener('click', async () => {
      const q = _searchEl.value.trim();
      _searchRes.classList.remove('open');
      _searchEl.value = '';
      // For QL/app items, launch directly instead of navigating
      if (el.dataset.launch === 'ql') {
        invoke('launch_shortcut', { cmd: el.dataset.launchMeta }).catch(() => {});
        return;
      }
      if (el.dataset.launch === 'app') {
        invoke('launch_external', { path: el.dataset.launchMeta }).catch(() => {});
        return;
      }
      goPane(el.dataset.pane, q);
    });
  });
}

// ── Helpers (exported for modules) ──────────────────────────────────────────
export function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = item[key] || 'General';
    (acc[k] = acc[k] || []).push(item);
    return acc;
  }, {});
}

export function sectionHdr(label, count) {
  return `<div class="section-hdr"><span class="section-label">${esc(label)}</span><div class="section-line"></div>${count != null ? `<span class="section-count">${count}</span>` : ''}</div>`;
}

export function emptyState(icon, msg, btnLabel, btnFn) {
  return `<div class="empty-state"><i class="ti ${icon}"></i><p>${esc(msg)}</p>${btnLabel ? `<button class="action-btn btn-secondary" onclick="${btnFn}">${esc(btnLabel)}</button>` : ''}</div>`;
}

export function scriptIcon(type) {
  return { ps1: 'ti-terminal-2', py: 'ti-brand-python', bat: 'ti-terminal', cmd: 'ti-terminal',
           ahk: 'ti-keyboard', vbs: 'ti-script', rb: 'ti-brand-ruby', sh: 'ti-terminal' }[type] || 'ti-file';
}

/** Time-ago helper */
export function timeAgo(isoStr) {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Skeleton grid (n cards) or rows */
export function skeletonCards(n = 4) {
  return `<div class="card-grid">${'<div class="card skel-card skeleton"></div>'.repeat(n)}</div>`;
}
export function skeletonRows(n = 3) {
  return `<div class="row-list">${'<div class="skel-row skeleton"></div>'.repeat(n)}</div>`;
}

/** Shared pane header with optional inline search and optional sticky note card */
export function paneHeader(icon, title, btnLabel, btnFn, searchId, note) {
  const btn = btnLabel ? `<button class="action-btn btn-secondary" onclick="${btnFn}" style="font-size:10px;padding:3px 10px"><i class="ti ti-plus"></i> ${esc(btnLabel)}</button>` : '';
  const srch = searchId ? `<input class="pane-search" id="${searchId}" placeholder="Filter…" autocomplete="off" />` : '';
  const noteHtml = note ? `<div class="pane-header-note">${note}</div>` : '';
  return `<div class="pane-header${note ? ' pane-header-sticky' : ''}"><div class="pane-header-row"><div class="pane-header-title"><i class="ti ${esc(icon)}"></i>${esc(title)}</div>${srch}${btn}</div>${noteHtml}</div><div class="pane-divider"></div>`;
}

// ── Init ────────────────────────────────────────────────────────────────────
_paneLoaders['dash']();
