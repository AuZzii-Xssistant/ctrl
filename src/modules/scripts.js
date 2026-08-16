/**
 * ScriptStash — faithful port inside CTRL.
 * All original ScriptStash features: master profile, profile selector,
 * full toolbar, filter bar, sortable table, multi-select, keyboard shortcuts,
 * context menu, profile picker overlay, duplicate, run queue with events,
 * log panel, status bar, settings modal, import/export.
 */
import { esc, toast, openModal, closeModal, confirmDialog, showContextMenu } from '../app.js';

const inv = window.__TAURI__.core.invoke;
const { listen } = window.__TAURI__.event;

// ── State ─────────────────────────────────────────────────────────────────────
const S = {
  profileId: null,    // null = Master (all scripts)
  profiles: [],
  scripts: [],
  running: false,

  filter: '',
  typeFilter: '',
  showDisabled: false,

  sortCol: 'order',
  sortDir: 1,

  sel: new Set(),     // selected script IDs
  lastClickIdx: -1,   // for shift-click

  dragSrcId: null,
  logEntries: [],
  logOpen: true,
  progress: 0,
  progressTotal: 0,
};

// ── Event listeners (attach once) ─────────────────────────────────────────────
let _listenersAttached = false;
const _unlisten = [];

function _attachListeners() {
  if (_listenersAttached) return;
  _listenersAttached = true;
  listen('ss-run-state', e => {
    S.running = e.payload.running;
    _patchToolbar();
    if (!S.running) { S.progress = 0; _patchStatusBar(); }
  }).then(u => _unlisten.push(u));
  listen('ss-run-start', e => {
    S.progressTotal = e.payload.total;
    S.progress = 0;
    _patchStatusBar();
  }).then(u => _unlisten.push(u));
  listen('ss-script-start', e => {
    S.progress = e.payload.index;
    S.progressTotal = e.payload.total;
    _patchStatusBar();
  }).then(u => _unlisten.push(u));
  listen('ss-script-done', e => {
    const { id, status } = e.payload;
    const s = S.scripts.find(x => x.id === id);
    if (s) { s.lastStatus = status; }
    _patchRow(id);
  }).then(u => _unlisten.push(u));
  listen('ss-run-done', () => {
    S.running = false;
    S.progress = 0;
    _patchToolbar();
    _patchStatusBar();
    _reload(); // refresh lastRun column
  }).then(u => _unlisten.push(u));
  listen('ss-log', e => {
    const { level, msg } = e.payload;
    S.logEntries.push({ level, msg, ts: _ts() });
    _appendLog({ level, msg, ts: _ts() });
  }).then(u => _unlisten.push(u));
}

// ── Entry ─────────────────────────────────────────────────────────────────────
export async function load(search = '') {
  S.filter = search;
  _attachListeners();

  const el = document.getElementById('scripts-scroll');
  el.style.cssText = 'overflow:hidden;padding:0;display:flex;flex-direction:column;height:100%;position:relative;';
  el.innerHTML = _skeletonHTML();

  _bindShortcuts();
  await _reload();
}

function _skeletonHTML() {
  return `
<div class="ss-wrap">
  <div class="ss-profile-bar" id="ss-profile-bar"></div>
  <div class="ss-toolbar" id="ss-toolbar"></div>
  <div class="ss-filter-bar" id="ss-filter-bar"></div>
  <div class="ss-table-wrap" id="ss-table-wrap">
    <table class="ss-table" id="ss-table">
      <thead id="ss-thead"></thead>
      <tbody id="ss-tbody"></tbody>
    </table>
  </div>
  <div class="ss-log-panel" id="ss-log-panel">
    <div class="ss-log-header" id="ss-log-header">
      <span class="ss-log-title"><i class="ti ti-terminal-2"></i> Log</span>
      <span class="ss-log-actions">
        <button class="ss-btn-xs" id="ss-log-clear" title="Clear log">Clear</button>
        <button class="ss-btn-xs" id="ss-log-toggle" title="Toggle log">▾</button>
      </span>
    </div>
    <div class="ss-log-body" id="ss-log-body"></div>
  </div>
  <div class="ss-status-bar" id="ss-status-bar"></div>
</div>`;
}

// ── Reload (full state from backend) ─────────────────────────────────────────
async function _reload() {
  const data = await inv('ss_get_state', { profileId: S.profileId }).catch(() => ({ scripts: [], profiles: [], running: false }));
  S.profiles = data.profiles || [];
  S.scripts = data.scripts || [];
  S.running = data.running || false;
  S.sel.clear();
  _renderAll();
}

function _renderAll() {
  _renderProfileBar();
  _renderToolbar();
  _renderFilterBar();
  _renderTable();
  _patchStatusBar();
}

// ── Profile bar ───────────────────────────────────────────────────────────────
function _renderProfileBar() {
  const bar = document.getElementById('ss-profile-bar');
  if (!bar) return;
  const isMaster = S.profileId === null;
  const cur = S.profiles.find(p => p.id === S.profileId);
  const label = isMaster ? '★ Master' : (cur ? cur.name : 'Unknown');

  bar.innerHTML = `
<div class="ss-profile-selector" id="ss-profile-sel">
  <span class="ss-profile-label">${esc(label)}</span>
  <i class="ti ti-chevron-down ss-profile-chevron"></i>
</div>
<div class="ss-profile-btns">
  <button class="ss-btn-xs" id="ss-prof-add" title="New profile"><i class="ti ti-plus"></i></button>
  <button class="ss-btn-xs" id="ss-prof-rename" title="Rename profile" ${isMaster ? 'disabled' : ''}><i class="ti ti-pencil"></i></button>
  <button class="ss-btn-xs" id="ss-prof-dup" title="Duplicate profile" ${isMaster ? 'disabled' : ''}><i class="ti ti-copy"></i></button>
  <button class="ss-btn-xs ss-btn-danger" id="ss-prof-del" title="Delete profile" ${isMaster ? 'disabled' : ''}><i class="ti ti-trash"></i></button>
</div>`;

  document.getElementById('ss-profile-sel').onclick = _showProfileDropdown;
  document.getElementById('ss-prof-add').onclick = _addProfile;
  document.getElementById('ss-prof-rename').onclick = _renameProfile;
  document.getElementById('ss-prof-dup').onclick = _duplicateProfile;
  document.getElementById('ss-prof-del').onclick = _deleteProfile;
}

function _showProfileDropdown(e) {
  e.stopPropagation();
  const btn = document.getElementById('ss-profile-sel');
  const rect = btn.getBoundingClientRect();
  const items = [
    { label: '★ Master', value: null, active: S.profileId === null },
    ...S.profiles.map(p => ({ label: p.name, value: p.id, count: p.scriptCount, active: S.profileId === p.id })),
  ];
  const menu = document.createElement('div');
  menu.className = 'ss-dropdown';
  menu.style.cssText = `position:fixed;top:${rect.bottom+2}px;left:${rect.left}px;min-width:${rect.width}px;z-index:9999;`;
  menu.innerHTML = items.map(it => `
    <div class="ss-dd-item ${it.active ? 'active' : ''}" data-val="${it.value}">
      ${it.label === '★ Master' ? '<span class="ss-dd-star">★</span>' : ''}
      <span class="ss-dd-name">${esc(it.label)}</span>
      ${it.count != null ? `<span class="ss-dd-count">${it.count}</span>` : ''}
    </div>`).join('');
  document.body.appendChild(menu);
  const close = () => menu.remove();
  menu.querySelectorAll('.ss-dd-item').forEach(el => el.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const val = el.dataset.val === 'null' || el.dataset.val === '' ? null : parseInt(el.dataset.val);
    S.profileId = val;
    close();
    _reload();
  }));
  setTimeout(() => document.addEventListener('click', close, { once: true }), 0);
}

async function _addProfile() {
  const name = await _prompt('New Profile', 'Profile name:', '');
  if (!name) return;
  const p = await inv('ss_add_profile', { name }).catch(() => null);
  if (!p) return toast('Failed to create profile', 'error');
  S.profiles.push(p);
  S.profileId = p.id;
  _reload();
}

async function _renameProfile() {
  if (S.profileId === null) return;
  const cur = S.profiles.find(p => p.id === S.profileId);
  const name = await _prompt('Rename Profile', 'New name:', cur?.name || '');
  if (!name) return;
  await inv('ss_rename_profile', { id: S.profileId, name });
  _reload();
}

async function _duplicateProfile() {
  if (S.profileId === null) return;
  const cur = S.profiles.find(p => p.id === S.profileId);
  const name = await _prompt('Duplicate Profile', 'New profile name:', (cur?.name || 'Profile') + ' (copy)');
  if (!name) return;
  const newp = await inv('ss_duplicate_profile', { id: S.profileId, newName: name }).catch(() => null);
  if (!newp) return toast('Failed to duplicate profile', 'error');
  _reload();
}

async function _deleteProfile() {
  if (S.profileId === null) return;
  const cur = S.profiles.find(p => p.id === S.profileId);
  const ok = await confirmDialog(`Delete profile "${cur?.name}"?`, 'This removes the profile. Scripts in no other profile will also be deleted.');
  if (!ok) return;
  await inv('ss_remove_profile', { id: S.profileId });
  S.profileId = null;
  _reload();
}

// ── Toolbar ───────────────────────────────────────────────────────────────────
function _renderToolbar() {
  const tb = document.getElementById('ss-toolbar');
  if (!tb) return;
  const hasSel = S.sel.size > 0;
  const running = S.running;
  tb.innerHTML = `
<button class="ss-btn" id="tb-add" title="Add script [Insert]"><i class="ti ti-plus"></i> Add</button>
<button class="ss-btn" id="tb-edit" title="Edit selected [F2]" ${!hasSel ? 'disabled' : ''}><i class="ti ti-pencil"></i> Edit</button>
<button class="ss-btn ss-btn-danger" id="tb-remove" title="Remove selected [Del]" ${!hasSel ? 'disabled' : ''}><i class="ti ti-trash"></i> Remove</button>
<button class="ss-btn" id="tb-toggle" title="Toggle enable/disable [Space]" ${!hasSel ? 'disabled' : ''}><i class="ti ti-player-pause"></i> Toggle</button>
<div class="ss-tb-sep"></div>
<button class="ss-btn ss-btn-run" id="tb-run-sel" title="Run selected [Enter]" ${!hasSel || running ? 'disabled' : ''}><i class="ti ti-player-play"></i> Run Selected</button>
<button class="ss-btn ss-btn-run" id="tb-run-all" title="Run all [F5]" ${running ? 'disabled' : ''}><i class="ti ti-player-play"></i> Run All</button>
<button class="ss-btn ss-btn-stop" id="tb-stop" title="Stop [Esc]" ${!running ? 'disabled' : ''}><i class="ti ti-square"></i> Stop</button>
<div class="ss-tb-sep"></div>
<button class="ss-btn ss-btn-admin" id="tb-run-sel-admin" title="Run selected as Admin" ${!hasSel || running ? 'disabled' : ''}><i class="ti ti-shield"></i> Run Sel. (Admin)</button>
<button class="ss-btn ss-btn-admin" id="tb-run-all-admin" title="Run all as Admin" ${running ? 'disabled' : ''}><i class="ti ti-shield"></i> Run All (Admin)</button>
<div class="ss-tb-sep"></div>
<button class="ss-btn" id="tb-import" title="Import profile"><i class="ti ti-file-import"></i> Import</button>
<button class="ss-btn" id="tb-export" title="Export profile"><i class="ti ti-file-export"></i> Export</button>
<button class="ss-btn" id="tb-settings" title="Settings / Shortcuts [?]"><i class="ti ti-settings"></i></button>`;

  document.getElementById('tb-add').onclick = _addScript;
  document.getElementById('tb-edit').onclick = () => _editSelected();
  document.getElementById('tb-remove').onclick = () => _removeSelected();
  document.getElementById('tb-toggle').onclick = () => _toggleSelected();
  document.getElementById('tb-run-sel').onclick = () => _runSelected(false);
  document.getElementById('tb-run-all').onclick = () => _runAll(false);
  document.getElementById('tb-stop').onclick = () => inv('ss_stop_run');
  document.getElementById('tb-run-sel-admin').onclick = () => _runSelected(true);
  document.getElementById('tb-run-all-admin').onclick = () => _runAll(true);
  document.getElementById('tb-import').onclick = _importProfile;
  document.getElementById('tb-export').onclick = _exportProfile;
  document.getElementById('tb-settings').onclick = _showSettings;
}

function _patchToolbar() {
  // Re-render toolbar (lightweight — just buttons, no DOM nuke of whole UI)
  _renderToolbar();
}

// ── Filter bar ────────────────────────────────────────────────────────────────
function _renderFilterBar() {
  const fb = document.getElementById('ss-filter-bar');
  if (!fb) return;
  fb.innerHTML = `
<input class="ss-filter-input" id="ss-filter-text" placeholder="Search scripts…" value="${esc(S.filter)}">
<select class="ss-filter-sel" id="ss-filter-type">
  <option value="">All Types</option>
  ${['ps1','bat','cmd','py','sh','vbs','js','reg','ahk'].map(t => `<option value="${t}" ${S.typeFilter===t?'selected':''}>${t}</option>`).join('')}
</select>
<label class="ss-filter-check"><input type="checkbox" id="ss-show-disabled" ${S.showDisabled?'checked':''}> Show disabled</label>
<span class="ss-filter-count" id="ss-filter-count"></span>`;

  document.getElementById('ss-filter-text').oninput = e => { S.filter = e.target.value; _renderTable(); };
  document.getElementById('ss-filter-type').onchange = e => { S.typeFilter = e.target.value; _renderTable(); };
  document.getElementById('ss-show-disabled').onchange = e => { S.showDisabled = e.target.checked; _renderTable(); };
}

// ── Table ─────────────────────────────────────────────────────────────────────
const COLS = [
  { key: 'drag',      label: '',            sort: false },
  { key: 'order',     label: '#',           sort: true  },
  { key: 'check',     label: '',            sort: false },
  { key: 'name',      label: 'Name',        sort: true  },
  { key: 'type',      label: 'Type',        sort: true  },
  { key: 'description', label: 'Description', sort: true },
  { key: 'lastStatus', label: 'Status',     sort: true  },
  { key: 'lastRun',   label: 'Last Run',    sort: true  },
  { key: 'run',       label: '',            sort: false },
];

function _renderTable() {
  const thead = document.getElementById('ss-thead');
  const tbody = document.getElementById('ss-tbody');
  if (!thead || !tbody) return;

  const rows = _filteredScripts();

  thead.innerHTML = `<tr>${COLS.map(c => `
    <th class="ss-th ${c.key === 'drag' ? 'td-grip' : ''} ${c.sort ? 'ss-sortable' : ''} ${S.sortCol===c.key ? (S.sortDir>0?'sort-asc':'sort-desc') : ''}"
        data-col="${c.key}">
      ${c.label}${c.sort && S.sortCol===c.key ? (S.sortDir>0?' ↑':' ↓') : ''}
    </th>`).join('')}</tr>`;

  thead.querySelectorAll('.ss-sortable').forEach(th => th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (S.sortCol === col) S.sortDir *= -1; else { S.sortCol = col; S.sortDir = 1; }
    _renderTable();
  }));

  tbody.innerHTML = rows.map((s, i) => _buildRow(s, i)).join('');
  _bindRowEvents(tbody, rows);

  const cnt = document.getElementById('ss-filter-count');
  if (cnt) cnt.textContent = `${rows.length} / ${S.scripts.length}`;
}

function _filteredScripts() {
  let rows = S.scripts.slice();
  if (!S.showDisabled) rows = rows.filter(s => s.enabled);
  if (S.filter) {
    const q = S.filter.toLowerCase();
    rows = rows.filter(s => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
  }
  if (S.typeFilter) rows = rows.filter(s => s.type === S.typeFilter);
  rows.sort((a, b) => {
    let av = a[S.sortCol], bv = b[S.sortCol];
    if (av == null) av = ''; if (bv == null) bv = '';
    return String(av).localeCompare(String(bv)) * S.sortDir;
  });
  return rows;
}

function _buildRow(s, i) {
  const sel = S.sel.has(s.id);
  const status = s.lastStatus || 'never';
  const statusCls = { success: 'ss-pill-ok', failed: 'ss-pill-fail', running: 'ss-pill-run', never: 'ss-pill-never' }[status] || 'ss-pill-never';
  const lastRun = s.lastRun ? _fmtTs(s.lastRun) : '—';
  return `<tr class="ss-row ${sel ? 'selected' : ''} ${!s.enabled ? 'ss-row-disabled' : ''}" data-id="${s.id}" data-idx="${i}" draggable="true">
    <td class="td-grip ss-grip" title="Drag to reorder"><i class="ti ti-grip-vertical"></i></td>
    <td class="td-ord">${i+1}</td>
    <td class="td-cb"><input type="checkbox" class="ss-row-cb" data-id="${s.id}" ${sel?'checked':''}></td>
    <td class="td-name"><span class="ss-name">${esc(s.name)}</span></td>
    <td class="td-type"><span class="ss-badge ss-badge-${s.type}">${s.type}</span></td>
    <td class="td-desc">${esc(s.description)}</td>
    <td class="td-status"><span class="ss-pill ${statusCls}">${status}</span></td>
    <td class="td-lr">${lastRun}</td>
    <td class="td-run"><button class="ss-row-run-btn" data-id="${s.id}" title="Run this script"><i class="ti ti-player-play"></i></button></td>
  </tr>`;
}

function _patchRow(id) {
  const s = S.scripts.find(x => x.id === id);
  if (!s) return;
  const tr = document.querySelector(`#ss-tbody tr[data-id="${id}"]`);
  if (!tr) return;
  const status = s.lastStatus || 'never';
  const cls = { success: 'ss-pill-ok', failed: 'ss-pill-fail', running: 'ss-pill-run', never: 'ss-pill-never' }[status] || 'ss-pill-never';
  const pill = tr.querySelector('.ss-pill');
  if (pill) { pill.className = `ss-pill ${cls}`; pill.textContent = status; }
}

function _bindRowEvents(tbody, rows) {
  // Row click (selection)
  tbody.querySelectorAll('.ss-row').forEach(tr => {
    tr.addEventListener('click', e => {
      if (e.target.closest('.ss-row-run-btn') || e.target.closest('.ss-row-cb')) return;
      const id = parseInt(tr.dataset.id);
      const idx = parseInt(tr.dataset.idx);
      if (e.shiftKey && S.lastClickIdx >= 0) {
        const lo = Math.min(S.lastClickIdx, idx), hi = Math.max(S.lastClickIdx, idx);
        rows.slice(lo, hi+1).forEach(s => S.sel.add(s.id));
      } else if (e.ctrlKey || e.metaKey) {
        S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id);
      } else {
        S.sel.clear(); S.sel.add(id);
      }
      S.lastClickIdx = idx;
      _refreshSelUI();
    });

    // Context menu
    tr.addEventListener('contextmenu', e => {
      e.preventDefault();
      const id = parseInt(tr.dataset.id);
      if (!S.sel.has(id)) { S.sel.clear(); S.sel.add(id); _refreshSelUI(); }
      _showRowContextMenu(e, id);
    });

    // Drag
    tr.addEventListener('dragstart', e => { S.dragSrcId = parseInt(tr.dataset.id); tr.classList.add('dragging'); });
    tr.addEventListener('dragend', () => { S.dragSrcId = null; tbody.querySelectorAll('.dragging,.drag-over').forEach(el => el.classList.remove('dragging','drag-over')); });
    tr.addEventListener('dragover', e => { e.preventDefault(); tr.classList.add('drag-over'); });
    tr.addEventListener('dragleave', () => tr.classList.remove('drag-over'));
    tr.addEventListener('drop', async e => {
      e.preventDefault();
      tr.classList.remove('drag-over');
      if (S.dragSrcId === null || S.dragSrcId === parseInt(tr.dataset.id)) return;
      const filtered = _filteredScripts();
      const ids = filtered.map(s => s.id);
      const fromIdx = ids.indexOf(S.dragSrcId);
      const toIdx = ids.indexOf(parseInt(tr.dataset.id));
      if (fromIdx < 0 || toIdx < 0) return;
      ids.splice(fromIdx, 1);
      ids.splice(toIdx, 0, S.dragSrcId);
      await inv('ss_reorder_scripts', { profileId: S.profileId, orderedIds: ids });
      _reload();
    });
  });

  // Checkboxes
  tbody.querySelectorAll('.ss-row-cb').forEach(cb => cb.addEventListener('change', () => {
    const id = parseInt(cb.dataset.id);
    cb.checked ? S.sel.add(id) : S.sel.delete(id);
    _refreshSelUI();
  }));

  // Quick run buttons
  tbody.querySelectorAll('.ss-row-run-btn').forEach(btn => btn.addEventListener('click', async e => {
    e.stopPropagation();
    const id = parseInt(btn.dataset.id);
    await inv('ss_run_now', { profileId: S.profileId, scriptId: id, runAsAdmin: false });
  }));
}

function _refreshSelUI() {
  document.querySelectorAll('#ss-tbody .ss-row').forEach(tr => {
    const id = parseInt(tr.dataset.id);
    tr.classList.toggle('selected', S.sel.has(id));
    const cb = tr.querySelector('.ss-row-cb');
    if (cb) cb.checked = S.sel.has(id);
  });
  _renderToolbar();
}

// ── Context menu ──────────────────────────────────────────────────────────────
function _showRowContextMenu(e, id) {
  const s = S.scripts.find(x => x.id === id);
  if (!s) return;
  showContextMenu(e, [
    { label: 'Edit', icon: 'ti-pencil', action: () => _openScriptModal(s) },
    { label: 'Duplicate', icon: 'ti-copy', action: () => _duplicateScript(id) },
    { label: 'Manage Profiles', icon: 'ti-folders', action: () => _showProfilePicker(id) },
    { type: 'sep' },
    { label: s.enabled ? 'Disable' : 'Enable', icon: s.enabled ? 'ti-player-pause' : 'ti-player-play', action: () => _toggleScripts([id]) },
    { label: 'Copy Content', icon: 'ti-clipboard', action: () => { navigator.clipboard.writeText(s.content || ''); toast('Copied', 'ok'); } },
    { type: 'sep' },
    { label: 'Run This', icon: 'ti-player-play', action: () => inv('ss_run_now', { profileId: S.profileId, scriptId: id, runAsAdmin: false }) },
    { label: 'Run as Admin', icon: 'ti-shield', action: () => inv('ss_run_now', { profileId: S.profileId, scriptId: id, runAsAdmin: true }) },
    { type: 'sep' },
    { label: 'Delete', icon: 'ti-trash', danger: true, action: () => _removeScripts([id]) },
  ]);
}

// ── Profile picker overlay ────────────────────────────────────────────────────
async function _showProfilePicker(scriptId) {
  const s = S.scripts.find(x => x.id === scriptId);
  if (!s) return;
  const current = new Set(s.inProfiles || []);

  openModal('ss-profile-picker', `
<div class="ss-modal">
  <div class="ss-modal-header"><h3>Manage Profiles</h3></div>
  <div class="ss-modal-body">
    <p style="color:var(--text-2);font-size:12px;margin-bottom:8px;">Select which profiles this script belongs to:</p>
    <div class="ss-profile-checklist" id="ss-pp-list">
      ${S.profiles.map(p => `
        <label class="ss-pp-item">
          <input type="checkbox" class="ss-pp-cb" data-pid="${p.id}" ${current.has(p.id)?'checked':''}>
          <span>${esc(p.name)}</span>
          <span class="ss-dd-count">${p.scriptCount}</span>
        </label>`).join('')}
    </div>
  </div>
  <div class="ss-modal-footer">
    <button class="ss-btn" id="ss-pp-cancel">Cancel</button>
    <button class="ss-btn ss-btn-primary" id="ss-pp-save">Save</button>
  </div>
</div>`);

  document.getElementById('ss-pp-cancel').onclick = () => closeModal('ss-profile-picker');
  document.getElementById('ss-pp-save').onclick = async () => {
    const ids = [...document.querySelectorAll('.ss-pp-cb:checked')].map(cb => parseInt(cb.dataset.pid));
    await inv('ss_set_script_profiles', { scriptId, profileIds: ids });
    closeModal('ss-profile-picker');
    _reload();
  };
}

// ── Script modal (add/edit) ────────────────────────────────────────────────────
async function _addScript() {
  _openScriptModal(null);
}

function _editSelected() {
  if (S.sel.size !== 1) return;
  const id = [...S.sel][0];
  const s = S.scripts.find(x => x.id === id);
  if (s) _openScriptModal(s);
}

function _openScriptModal(s) {
  const isNew = !s;
  openModal('ss-script-modal', `
<div class="ss-modal" id="ss-script-form">
  <div class="ss-modal-header"><h3>${isNew ? 'Add Script' : 'Edit Script'}</h3></div>
  <div class="ss-modal-body">
    <div class="ss-form-row">
      <label>Name</label>
      <input class="ss-input" id="sm-name" value="${esc(s?.name||'')}" placeholder="Script name" autofocus>
    </div>
    <div class="ss-form-row">
      <label>Type</label>
      <select class="ss-input" id="sm-type">
        ${['ps1','bat','cmd','py','sh','vbs','js','reg','ahk'].map(t => `<option value="${t}" ${(s?.type||'ps1')===t?'selected':''}>${t}</option>`).join('')}
      </select>
    </div>
    <div class="ss-form-row">
      <label>Description</label>
      <input class="ss-input" id="sm-desc" value="${esc(s?.description||'')}" placeholder="Optional description">
    </div>
    <div class="ss-form-row">
      <label><input type="checkbox" id="sm-admin" ${s?.runAsAdmin?'checked':''}> Run as Administrator</label>
    </div>
    <div class="ss-form-row" style="flex-direction:column">
      <label>Script Content</label>
      <textarea class="ss-textarea" id="sm-content" rows="12" placeholder="Script content…">${esc(s?.content||'')}</textarea>
    </div>
  </div>
  <div class="ss-modal-footer">
    <button class="ss-btn" id="sm-cancel">Cancel [Esc]</button>
    <button class="ss-btn ss-btn-primary" id="sm-save">Save [Ctrl+S]</button>
  </div>
</div>`);

  const save = async () => {
    const data = {
      name: document.getElementById('sm-name').value.trim(),
      type: document.getElementById('sm-type').value,
      description: document.getElementById('sm-desc').value.trim(),
      content: document.getElementById('sm-content').value,
      runAsAdmin: document.getElementById('sm-admin').checked,
    };
    if (!data.name) { document.getElementById('sm-name').focus(); return; }
    if (isNew) {
      await inv('ss_add_script', { profileId: S.profileId, data });
    } else {
      await inv('ss_edit_script', { scriptId: s.id, data });
    }
    closeModal('ss-script-modal');
    _reload();
  };

  document.getElementById('sm-save').onclick = save;
  document.getElementById('sm-cancel').onclick = () => closeModal('ss-script-modal');
  document.getElementById('ss-script-form').addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); closeModal('ss-script-modal'); }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
  });
}

// ── Bulk actions ──────────────────────────────────────────────────────────────
async function _removeSelected() { await _removeScripts([...S.sel]); }
async function _toggleSelected() { await _toggleScripts([...S.sel]); }

async function _removeScripts(ids) {
  if (!ids.length) return;
  const ok = await confirmDialog(`Remove ${ids.length} script(s)?`, S.profileId === null ? 'This permanently deletes them (Master view).' : 'This removes them from this profile. Scripts in no other profile are also deleted.');
  if (!ok) return;
  await inv('ss_remove_scripts', { profileId: S.profileId, ids });
  _reload();
}

async function _toggleScripts(ids) {
  if (!ids.length) return;
  await inv('ss_toggle_scripts', { profileId: S.profileId, ids });
  _reload();
}

async function _duplicateScript(id) {
  await inv('ss_duplicate_script', { profileId: S.profileId, scriptId: id });
  _reload();
}

// ── Run actions ───────────────────────────────────────────────────────────────
async function _runSelected(admin) {
  if (!S.sel.size) return;
  await inv('ss_start_run', { profileId: S.profileId, ids: [...S.sel], runAsAdmin: admin });
}

async function _runAll(admin) {
  await inv('ss_start_run', { profileId: S.profileId, ids: null, runAsAdmin: admin });
}

// ── Import / Export ───────────────────────────────────────────────────────────
async function _importProfile() {
  // Rust handles file picking and reading
  const json = await inv('ss_import_pick_file').catch(() => null);
  if (json === null) return; // cancelled
  if (!json) return toast('Could not read file', 'error');
  const added = await inv('ss_import_profile', { profileId: S.profileId, json }).catch(() => -1);
  if (added < 0) return toast('Import failed', 'error');
  toast(`Imported ${added} script(s)`, 'ok');
  _reload();
}

async function _exportProfile() {
  const json = await inv('ss_export_profile', { profileId: S.profileId }).catch(() => null);
  if (!json) return toast('Export failed', 'error');
  const cur = S.profiles.find(p => p.id === S.profileId);
  const suggested = `${(cur?.name || 'master').toLowerCase().replace(/\s+/g, '_')}_export.json`;
  const ok = await inv('ss_export_pick_file', { json, suggested }).catch(() => false);
  if (!ok) return;
  toast('Exported', 'ok');
}

// ── Settings modal ────────────────────────────────────────────────────────────
function _showSettings() {
  openModal('ss-settings', `
<div class="ss-modal">
  <div class="ss-modal-header"><h3><i class="ti ti-settings"></i> Settings &amp; Shortcuts</h3></div>
  <div class="ss-modal-body">
    <h4 style="margin:0 0 8px;color:var(--amber)">Keyboard Shortcuts</h4>
    <table class="ss-shortcuts-table">
      <tbody>
        ${[
          ['Insert', 'Add script'],
          ['F2', 'Edit selected'],
          ['Del', 'Remove selected'],
          ['Space', 'Toggle enable/disable'],
          ['Enter', 'Run selected'],
          ['F5', 'Run all'],
          ['Esc', 'Stop run / close modal'],
          ['Ctrl+A', 'Select all'],
          ['Ctrl+S', 'Save (in modal)'],
          ['?', 'Show this dialog'],
        ].map(([k, d]) => `<tr><td><kbd>${k}</kbd></td><td>${d}</td></tr>`).join('')}
      </tbody>
    </table>
    <h4 style="margin:16px 0 8px;color:var(--amber)">Script Types</h4>
    <table class="ss-shortcuts-table">
      <tbody>
        ${[
          ['ps1 / bat / cmd / py / sh', 'Interactive — opens visible console window with pause'],
          ['vbs / js', 'Silent — wscript.exe (background)'],
          ['reg', 'Silent — regedit /s (background)'],
          ['ahk', 'Silent — autohotkey.exe (background)'],
        ].map(([k, d]) => `<tr><td><kbd>${k}</kbd></td><td>${d}</td></tr>`).join('')}
      </tbody>
    </table>
  </div>
  <div class="ss-modal-footer">
    <button class="ss-btn ss-btn-primary" id="ss-settings-close">Close</button>
  </div>
</div>`);
  document.getElementById('ss-settings-close').onclick = () => closeModal('ss-settings');
}

// ── Log panel ─────────────────────────────────────────────────────────────────
function _appendLog(entry) {
  const body = document.getElementById('ss-log-body');
  if (!body) return;
  const cls = { info: 'log-info', ok: 'log-ok', warn: 'log-warn', error: 'log-error' }[entry.level] || 'log-info';
  const line = document.createElement('div');
  line.className = `ss-log-line ${cls}`;
  line.innerHTML = `<span class="ss-log-ts">${entry.ts}</span> <span>${esc(entry.msg)}</span>`;
  body.appendChild(line);
  body.scrollTop = body.scrollHeight;

  document.getElementById('ss-log-clear').onclick = () => { S.logEntries = []; body.innerHTML = ''; };
  document.getElementById('ss-log-toggle').onclick = () => {
    S.logOpen = !S.logOpen;
    body.style.display = S.logOpen ? '' : 'none';
    document.getElementById('ss-log-toggle').textContent = S.logOpen ? '▾' : '▸';
  };
}

function _patchStatusBar() {
  const bar = document.getElementById('ss-status-bar');
  if (!bar) return;
  if (S.running && S.progressTotal > 0) {
    const pct = Math.round((S.progress / S.progressTotal) * 100);
    bar.innerHTML = `<div class="ss-progress-bar"><div class="ss-progress-fill" style="width:${pct}%"></div></div><span>${S.progress}/${S.progressTotal}</span>`;
  } else if (S.running) {
    bar.innerHTML = `<span class="ss-status-running"><i class="ti ti-loader"></i> Running…</span>`;
  } else {
    bar.innerHTML = `<span class="ss-status-idle">${S.scripts.length} scripts · ${S.profiles.length} profiles</span>`;
  }
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
let _shortcutsBound = false;
function _bindShortcuts() {
  if (_shortcutsBound) return;
  _shortcutsBound = true;
  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName;
    const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (inInput && e.key !== 'Escape') return;
    if (document.querySelector('.modal-overlay')) return; // modal open

    switch (e.key) {
      case 'Insert': e.preventDefault(); _addScript(); break;
      case 'F2': e.preventDefault(); _editSelected(); break;
      case 'Delete': e.preventDefault(); _removeSelected(); break;
      case ' ':
        if (!inInput) { e.preventDefault(); _toggleSelected(); }
        break;
      case 'Enter': e.preventDefault(); _runSelected(false); break;
      case 'F5': e.preventDefault(); _runAll(false); break;
      case 'Escape': if (S.running) inv('ss_stop_run'); break;
      case '?': if (!inInput) _showSettings(); break;
      case 'a':
      case 'A':
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); _selectAll(); }
        break;
    }
  });
}

function _selectAll() {
  const rows = _filteredScripts();
  rows.forEach(s => S.sel.add(s.id));
  _refreshSelUI();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _ts() {
  const d = new Date();
  return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`;
}

function _fmtTs(ts) {
  // ts is a unix seconds string from Rust
  const n = parseInt(ts);
  if (!n || isNaN(n)) return ts;
  const d = new Date(n * 1000);
  return d.toLocaleString();
}

async function _prompt(title, label, defaultVal) {
  return new Promise(resolve => {
    openModal('ss-prompt', `
<div class="ss-modal ss-modal-sm">
  <div class="ss-modal-header"><h3>${esc(title)}</h3></div>
  <div class="ss-modal-body">
    <label style="display:block;margin-bottom:4px;font-size:12px;color:var(--text-2)">${esc(label)}</label>
    <input class="ss-input" id="ss-prompt-input" value="${esc(defaultVal)}" style="width:100%">
  </div>
  <div class="ss-modal-footer">
    <button class="ss-btn" id="ss-prompt-cancel">Cancel</button>
    <button class="ss-btn ss-btn-primary" id="ss-prompt-ok">OK</button>
  </div>
</div>`);
    const inp = document.getElementById('ss-prompt-input');
    inp.select();
    const done = (val) => { closeModal('ss-prompt'); resolve(val); };
    document.getElementById('ss-prompt-ok').onclick = () => done(inp.value.trim());
    document.getElementById('ss-prompt-cancel').onclick = () => done(null);
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') done(inp.value.trim());
      if (e.key === 'Escape') done(null);
    });
  });
}
