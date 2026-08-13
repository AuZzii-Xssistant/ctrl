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

// ── Output drawer ────────────────────────────────────────────────────────────
export function showOutput(text, ok = true) {
  const out = document.getElementById('output-text');
  const ts  = document.getElementById('output-ts');
  const dot = document.getElementById('output-new-dot');
  out.innerHTML = `<span class="${ok ? 'out-ok' : 'out-err'}">${esc(text)}</span>`;
  if (ts) ts.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (dot) dot.style.display = '';
  // If already open, scroll to bottom
  const body = document.getElementById('output-body');
  if (body && document.getElementById('output-drawer').classList.contains('open')) {
    requestAnimationFrame(() => requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; }));
  }
}

function _toggleOutputDrawer() {
  const drawer = document.getElementById('output-drawer');
  const dot    = document.getElementById('output-new-dot');
  const icon   = document.querySelector('#output-toggle i');
  drawer.classList.toggle('open');
  if (dot) dot.style.display = 'none';
  if (icon) icon.className = drawer.classList.contains('open') ? 'ti ti-chevron-down' : 'ti ti-chevron-up';
  if (drawer.classList.contains('open')) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const body = document.getElementById('output-body');
      if (body) body.scrollTop = body.scrollHeight;
    }));
  }
}

document.getElementById('output-header').addEventListener('click', e => {
  if (e.target.closest('#output-clear, #output-copy, #output-toggle')) return;
  _toggleOutputDrawer();
});
document.getElementById('output-toggle').addEventListener('click', _toggleOutputDrawer);

document.getElementById('output-clear').addEventListener('click', e => {
  e.stopPropagation();
  document.getElementById('output-text').innerHTML = '';
  const ts = document.getElementById('output-ts');
  if (ts) ts.textContent = '';
  const dot = document.getElementById('output-new-dot');
  if (dot) dot.style.display = 'none';
});
document.getElementById('output-copy').addEventListener('click', e => {
  e.stopPropagation();
  const text = document.getElementById('output-text').innerText;
  navigator.clipboard.writeText(text).then(() => toast('Copied', 'ok')).catch(() => toast('Copy failed', 'err'));
});

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
  return { ps1: 'ti-terminal-2', py: 'ti-brand-python', bat: 'ti-terminal', cmd: 'ti-terminal' }[type] || 'ti-file';
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

/** Shared pane header with optional inline search */
export function paneHeader(icon, title, btnLabel, btnFn, searchId) {
  const btn = btnLabel ? `<button class="action-btn btn-secondary" onclick="${btnFn}" style="font-size:10px;padding:3px 10px"><i class="ti ti-plus"></i> ${esc(btnLabel)}</button>` : '';
  const srch = searchId ? `<input class="pane-search" id="${searchId}" placeholder="Filter…" autocomplete="off" />` : '';
  return `<div class="pane-header"><div class="pane-header-title"><i class="ti ${esc(icon)}"></i>${esc(title)}</div>${srch}${btn}</div><div class="pane-divider"></div>`;
}

// ── Init ────────────────────────────────────────────────────────────────────
_paneLoaders['dash']();
