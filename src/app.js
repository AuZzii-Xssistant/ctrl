'use strict';

// ── Tauri bridge ────────────────────────────────────────────────────────────
export const invoke = window.__TAURI__.core.invoke;
const { getCurrentWindow } = window.__TAURI__.window;
const appWindow = getCurrentWindow();

// ── Window controls ─────────────────────────────────────────────────────────
document.getElementById('btn-close').addEventListener('click', () => invoke('close_window'));
document.getElementById('btn-min').addEventListener('click',   () => invoke('minimize_window'));
document.getElementById('btn-max').addEventListener('click',   () => invoke('toggle_maximize'));

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
  activity: ()  => import('./modules/activity.js').then(m => m.load()),
  settings: ()  => import('./modules/settings.js').then(m => m.load()),
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

// ── Terminal / Output drawer ─────────────────────────────────────────────────
let _term       = null;
let _termFit    = null;
let _termInited = false;
let _ptyStarted = false;
let _needsFit   = false;  // window resized while drawer was closed — fit+resize PTY on next open
let _lastCols   = 0;
let _lastRows   = 0;
let _shells     = [];
let _curShell   = null;
const { listen } = window.__TAURI__.event;

// Always write directly — xterm is init'd eagerly so _term is always set
function _termWrite(s) { _term?.write(s); }

function _bumpTs() {
  const dot = document.getElementById('output-new-dot');
  const ts  = document.getElementById('output-ts');
  if (dot) dot.style.display = '';
  if (ts)  ts.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── Run queue — prevent concurrent admin/streaming runs ───────────────────────
let _runLock = false;
export function acquireRun() { if (_runLock) return false; _runLock = true; return true; }
export function releaseRun() { _runLock = false; }

// Run-event listeners wired immediately — buffered until xterm mounts
listen('run-start', () => {
  _openDrawer();
  _termWrite('\r\n\x1b[90m──────────────────── run ────────────────────\x1b[0m\r\n');
  _bumpTs();
});
listen('run-output', e => _termWrite(e.payload));
listen('run-done',   e => {
  const ok = e.payload === true;
  _termWrite(`\r\n\x1b[90m──────────────── ${ok ? '\x1b[32mdone ✓' : '\x1b[31mfailed ✗'}\x1b[90m ────────────────\x1b[0m\r\n`);
  // Release focus so keystrokes don't get eaten by xterm after a run finishes
  _term?.blur();
});
listen('pty-data', e => _termWrite(e.payload));
listen('pty-exit', () => {
  _ptyStarted = false;
  _termWrite('\r\n\x1b[33m[shell exited — click New Shell to restart]\x1b[0m\r\n');
});

// ── Shell picker ──────────────────────────────────────────────────────────────

async function _loadShells() {
  try { _shells = await invoke('list_shells'); } catch { _shells = []; }
  if (!_shells.length) _shells = [{ name: 'Windows PowerShell', path: 'powershell', args: ['-NoLogo'] }];
  _curShell = _shells[0];
  _buildShellPicker();
}

function _shellLabel(name) {
  if (/PowerShell 7|pwsh/i.test(name))  return 'PS7';
  if (/Windows PowerShell/i.test(name)) return 'PS5';
  if (/Command/i.test(name))            return 'CMD';
  if (/WSL/i.test(name))                return 'WSL';
  if (/Git/i.test(name))                return 'Bash';
  return name.slice(0, 4);
}

function _buildShellPicker() {
  const wrap = document.getElementById('term-shell-toggle');
  if (!wrap) return;
  wrap.innerHTML = _shells.map((s, i) =>
    `<button class="term-sh-btn${i === 0 ? ' active' : ''}" data-idx="${i}" title="${s.name}">${_shellLabel(s.name)}</button>`
  ).join('');
  wrap.querySelectorAll('.term-sh-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      wrap.querySelectorAll('.term-sh-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _curShell = _shells[+btn.dataset.idx];
      await invoke('pty_close').catch(() => {});
      _ptyStarted = false;
      _term?.clear();
      _startPtyShell();
    });
  });
}

// ── xterm lifecycle ───────────────────────────────────────────────────────────

// xterm.js and FitAddon are loaded synchronously before this module (index.html lines 214-215)
// so we can init immediately — no lazy init, no event buffering needed.
function _initTerm() {
  if (_termInited || !window.Terminal) return;
  _termInited = true;
  const body = document.getElementById('output-body');
  _term = new window.Terminal({
    theme: {
      background: '#0d0d0d', foreground: '#d4d4d4', cursor: '#f0a500',
      black: '#1a1a1a', red: '#ef4444', green: '#10b981', yellow: '#f5a623',
      blue: '#60a5fa', magenta: '#a78bfa', cyan: '#34d399', white: '#e5e7eb',
      brightBlack: '#4b5563', brightWhite: '#f9fafb',
    },
    fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace",
    fontSize: 12, cursorBlink: true, scrollback: 10000, convertEol: true,
    allowProposedApi: true,
  });
  _termFit = new window.FitAddon.FitAddon();
  _term.loadAddon(_termFit);
  _term.open(body);
  _term.onData(data => invoke('pty_write', { data }).catch(() => {}));
  // Don't fit/resize yet — drawer is closed; _doOpen will fit on first real open
}
_initTerm();

function _fitTerm() {
  if (!_termFit || !_termInited) return;
  try {
    _termFit.fit();
    // Only send resize to PTY when dimensions actually changed — prevents
    // PowerShell from redrawing its prompt on every drawer open/close
    const c = _term?.cols ?? 80, r = _term?.rows ?? 24;
    if (_ptyStarted && (c !== _lastCols || r !== _lastRows)) {
      _lastCols = c; _lastRows = r;
      invoke('pty_resize', { cols: c, rows: r }).catch(() => {});
    }
  } catch {}
}

async function _startPtyShell() {
  if (!_curShell || _ptyStarted) return;
  try {
    await invoke('pty_open', {
      shell: _curShell.path,
      args:  _curShell.args,
      cols:  _term?.cols ?? 80,
      rows:  _term?.rows ?? 24,
    });
    _ptyStarted = true;
  } catch (err) {
    _termWrite(`\r\n\x1b[31m[PTY error: ${err}]\x1b[0m\r\n`);
  }
}

// ── Drawer open/close ─────────────────────────────────────────────────────────

function _openDrawer() {
  const d = document.getElementById('output-drawer');
  if (!d || d.classList.contains('open')) return;
  _doOpen(d);
}

function _doOpen(d) {
  d.classList.add('open');
  document.querySelector('#output-toggle i')?.setAttribute('class', 'ti ti-chevron-down');
  setTimeout(_onDrawerOpened, 220);
}

function _toggleOutputDrawer() {
  const d = document.getElementById('output-drawer');
  const wasOpen = d.classList.contains('open');
  d.classList.toggle('open');
  document.getElementById('output-new-dot')?.style.setProperty('display', 'none');
  document.querySelector('#output-toggle i')?.setAttribute('class', wasOpen ? 'ti ti-chevron-up' : 'ti ti-chevron-down');
  if (!wasOpen) setTimeout(_onDrawerOpened, 220);
  else _term?.blur(); // release xterm focus so typing doesn't go to the PTY
}

function _onDrawerOpened() {
  if (!_ptyStarted) {
    // First open: fit and start shell (PTY resize is fine here, shell not running yet)
    _fitTerm();
    _startPtyShell();
  } else if (_needsFit) {
    // Window was resized while drawer was closed — fit and resize PTY now
    _needsFit = false;
    _fitTerm();
  } else {
    // Ordinary re-open: re-layout xterm canvas WITHOUT resizing PTY
    // Resizing PTY causes PS/Oh-My-Posh to redraw the prompt mid-output
    try {
      _termFit?.fit();
      // Keep tracking vars in sync so _fitTerm's guard stays accurate
      _lastCols = _term?.cols ?? _lastCols;
      _lastRows = _term?.rows ?? _lastRows;
    } catch {}
  }
  _term?.focus();
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Show admin/static output in the terminal (not streamed). No-op on empty. */
export function showOutput(text, ok = true) {
  if (!text) return; // non-admin output already streamed via events; ignore empty
  const col   = ok ? '\x1b[32m' : '\x1b[31m';
  const clean = text.replace(/\r\n/g, '\r\n').replace(/(?<!\r)\n/g, '\r\n');
  _termWrite(`\r\n${col}${clean}\x1b[0m\r\n`);
  _bumpTs();
  _openDrawer();
}

// ── Event wiring ──────────────────────────────────────────────────────────────

// Track window resize — if drawer is open, fit immediately; if closed, defer to next open
window.addEventListener('resize', () => {
  if (!_termFit || !_termInited) return;
  if (document.getElementById('output-drawer')?.classList.contains('open')) {
    _fitTerm(); // drawer visible — resize xterm and PTY now
  } else {
    _needsFit = true; // drawer hidden — remember to resize PTY when it opens next
  }
});

document.getElementById('output-header').addEventListener('click', e => {
  if (e.target.closest('#output-clear,#output-copy,#output-toggle,#term-shell-toggle,#term-new-shell,#term-admin-shell')) return;
  _toggleOutputDrawer();
});
document.getElementById('output-toggle').addEventListener('click', _toggleOutputDrawer);

document.getElementById('output-clear').addEventListener('click', e => {
  e.stopPropagation();
  // Clear xterm display AND send clear/cls to the shell so prompt redraws
  _term?.clear();
  if (_ptyStarted) {
    // WSL / Git Bash use 'clear'; Windows shells use 'cls'
    const isUnix = /wsl|bash/i.test(_curShell?.name ?? '');
    invoke('pty_write', { data: isUnix ? 'clear\r' : 'cls\r' }).catch(() => {});
  }
  document.getElementById('output-new-dot')?.style.setProperty('display', 'none');
});

document.getElementById('output-copy').addEventListener('click', e => {
  e.stopPropagation();
  const sel = _term?.getSelection();
  if (!sel) { toast('Select text first', 'info'); return; }
  // navigator.clipboard needs secure context; execCommand works reliably in WebView2
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

document.getElementById('term-new-shell')?.addEventListener('click', async e => {
  e.stopPropagation();
  await invoke('pty_close').catch(() => {});
  _ptyStarted = false;
  _term?.clear();
  _openDrawer();
  await _startPtyShell();
});

// ── Admin elevation state ─────────────────────────────────────────────────────

// Sync visible/background setting to Rust on startup
invoke('set_admin_visible', { visible: localStorage.getItem('ctrl-admin-visible') !== 'background' });

invoke('is_elevated').then(elevated => {
  if (!elevated) return;
  const btn = document.getElementById('term-admin-shell');
  if (btn) {
    btn.classList.add('elevated');
    btn.title = 'Running as Administrator';
    btn.innerHTML = '<i class="ti ti-shield-check"></i> admin';
  }
});

// Click: open external admin terminal
document.getElementById('term-admin-shell')?.addEventListener('click', e => {
  e.stopPropagation();
  invoke('open_elevated_terminal')
    .then(() => toast('Admin terminal opened', 'ok'))
    .catch(err => toast(String(err), 'err'));
});

// Right-click: toggle visible vs background mode for admin scripts
document.getElementById('term-admin-shell')?.addEventListener('contextmenu', e => {
  e.stopPropagation();
  const isVisible = localStorage.getItem('ctrl-admin-visible') !== 'background';
  showContextMenu(e, [
    {
      label: `${isVisible ? '✓ ' : ''}Visible terminal (show window when running)`,
      icon: 'ti-terminal-2',
      fn: () => { localStorage.setItem('ctrl-admin-visible', 'visible'); invoke('set_admin_visible', { visible: true }); toast('Admin scripts: visible terminal', 'info'); },
    },
    {
      label: `${!isVisible ? '✓ ' : ''}Background (silent, output shown when done)`,
      icon: 'ti-terminal',
      fn: () => { localStorage.setItem('ctrl-admin-visible', 'background'); invoke('set_admin_visible', { visible: false }); toast('Admin scripts: background', 'info'); },
    },
  ]);
});

_loadShells();

// ── Custom modal ─────────────────────────────────────────────────────────────
let _confirmResolve = null;

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
  if (_confirmResolve) { _confirmResolve(false); _confirmResolve = null; }
}

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
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); _searchEl.focus(); _searchEl.select(); }
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
  { key: 'tools',     label: 'Tools',     icon: 'ti-tool',          pane: 'tools' },
  { key: 'scripts',   label: 'Scripts',   icon: 'ti-code',          pane: 'scripts' },
  { key: 'fixes',     label: 'Fixes',     icon: 'ti-bolt',          pane: 'fixes' },
  { key: 'projects',  label: 'Projects',  icon: 'ti-archive',       pane: 'projects' },
  { key: 'workflows', label: 'Workflows', icon: 'ti-player-play',   pane: 'workflows' },
  { key: 'snippets',  label: 'Snippets',  icon: 'ti-blockquote',    pane: 'snippets' },
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
      html += `<div class="sr-item" data-pane="${s.pane}">
        <i class="ti ${s.icon}" style="color:var(--text3);font-size:14px;flex-shrink:0"></i>
        <span class="sr-item-name">${esc(item.name)}</span>
        <span class="sr-item-meta">${esc(item.meta)}</span>
      </div>`;
    }
  }
  if (!total) html = `<div class="sr-empty">No results</div>`;
  _searchRes.innerHTML = html;
  _searchRes.classList.add('open');
  _searchRes.querySelectorAll('.sr-item[data-pane]').forEach(el => {
    el.addEventListener('click', () => {
      const q = _searchEl.value.trim();
      _searchRes.classList.remove('open');
      _searchEl.value = '';
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
