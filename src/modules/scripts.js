import { esc, toast, openModal, closeModal, confirmDialog, showContextMenu, showOutput, acquireRun, releaseRun, stopCurrentRun } from '../app.js';

const inv = window.__TAURI__.core.invoke;
const { listen } = window.__TAURI__.event;

// ── State ─────────────────────────────────────────────────────────────────────
const S = {
  profileId: null,
  profiles: [],
  scripts: [],
  running: false,
  filter: '',
  typeFilter: '',
  showDisabled: localStorage.getItem('ss-showDisabled') === '1',
  sortCol: 'order',
  sortDir: 1,
  sel: new Set(),
  lastClickIdx: -1,
  dragSrcId: null,
  progress: 0,
  progressTotal: 0,
  _dropdownOpen: false,
};

// ── Event listeners (once) ────────────────────────────────────────────────────
let _listenersAttached = false;
function _attachListeners() {
  if (_listenersAttached) return;
  _listenersAttached = true;
  listen('ss-run-state', e => {
    S.running = e.payload.running;
    _renderToolbar();
    if (!S.running) { S.progress = 0; _patchStatusBar(); }
  });
  listen('ss-run-start', e => { S.progressTotal = e.payload.total; S.progress = 0; _patchStatusBar(); });
  listen('ss-script-start', e => { S.progress = e.payload.index; S.progressTotal = e.payload.total; _patchStatusBar(); });
  listen('ss-script-done', e => {
    const s = S.scripts.find(x => x.id === e.payload.id);
    if (s) { s.lastStatus = e.payload.status; _patchRow(s.id); }
  });
  listen('ss-run-done', () => { S.running = false; S.progress = 0; _renderToolbar(); _patchStatusBar(); _reload(); });
  // External editor saved the temp file — sync content back into memory, no re-render needed (not shown in table).
  listen('script-synced', e => {
    const s = S.scripts.find(x => x.id === e.payload.id);
    if (s) { s.content = e.payload.content; toast(`Synced: ${s.name}`, 'ok'); }
  });
}

// ── Entry ─────────────────────────────────────────────────────────────────────
export async function load(search = '') {
  S.filter = search;
  _attachListeners();
  const el = document.getElementById('scripts-scroll');
  el.style.cssText = 'overflow:hidden;display:flex;flex-direction:column;';
  el.innerHTML = `
<div class="sc-wrap">
  <div class="sc-header" id="sc-header">
    <span class="sc-title"><i class="ti ti-code"></i> Scripts</span>
    <div class="sc-profile-area" id="sc-profile-area"></div>
  </div>
  <div class="sc-toolbar" id="sc-toolbar"></div>
  <div class="sc-filter-bar" id="sc-filter-bar"></div>
  <div class="sc-table-wrap">
    <table class="sc-table">
      <thead id="sc-thead"></thead>
      <tbody id="sc-tbody"></tbody>
    </table>
  </div>
  <div class="sc-status-bar" id="sc-status-bar"></div>
</div>`;
  _bindShortcuts();
  await _reload();
}

async function _reload() {
  const data = await inv('ss_get_state', { profileId: S.profileId }).catch(() => ({ scripts: [], profiles: [], running: false }));
  S.profiles = data.profiles || [];
  S.scripts  = data.scripts  || [];
  S.running  = data.running  || false;
  S.sel.clear();
  _renderHeader();
  _renderToolbar();
  _renderFilterBar();
  _renderTable();
  _patchStatusBar();
}

// ── Header (title left, profile selector right) ───────────────────────────────
function _renderHeader() {
  const area = document.getElementById('sc-profile-area');
  if (!area) return;
  const isMaster = S.profileId === null;
  const cur = S.profiles.find(p => p.id === S.profileId);
  const label = isMaster ? '★ Master' : (cur?.name || 'Unknown');

  area.innerHTML = `
<div class="sc-prof-sel" id="sc-prof-sel" title="Switch profile">
  <i class="ti ti-folders sc-prof-icon"></i>
  <span class="sc-prof-label">${esc(label)}</span>
  <i class="ti ti-chevron-down sc-prof-chevron"></i>
</div>
<div class="sc-prof-btns">
  <button class="sc-btn sc-btn-icon" id="ph-add"    title="New profile"><i class="ti ti-plus"></i></button>
  <button class="sc-btn sc-btn-icon" id="ph-rename" title="Rename" ${isMaster?'disabled':''}><i class="ti ti-pencil"></i></button>
  <button class="sc-btn sc-btn-icon" id="ph-dup"    title="Duplicate" ${isMaster?'disabled':''}><i class="ti ti-copy"></i></button>
  <button class="sc-btn sc-btn-icon sc-btn-danger" id="ph-del" title="Delete" ${isMaster?'disabled':''}><i class="ti ti-trash"></i></button>
</div>`;

  const sel = document.getElementById('sc-prof-sel');
  sel.onclick = e => { e.stopPropagation(); _toggleProfileDropdown(sel); };
  document.getElementById('ph-add').onclick    = _addProfile;
  document.getElementById('ph-rename').onclick = _renameProfile;
  document.getElementById('ph-dup').onclick    = _duplicateProfile;
  document.getElementById('ph-del').onclick    = _deleteProfile;
}

let _ddMenu = null;
function _toggleProfileDropdown(anchor) {
  if (_ddMenu) { _ddMenu.remove(); _ddMenu = null; return; }
  const rect = anchor.getBoundingClientRect();
  const items = [
    { label: '★ Master', value: null, active: S.profileId === null },
    ...S.profiles.map(p => ({ label: p.name, value: p.id, count: p.scriptCount, active: S.profileId === p.id })),
  ];
  const menu = document.createElement('div');
  menu.className = 'sc-dropdown';
  menu.style.cssText = `position:fixed;top:${rect.bottom+4}px;right:${window.innerWidth - rect.right}px;width:${rect.width}px;z-index:9999;`;
  menu.innerHTML = items.map(it => `
    <div class="sc-dd-item ${it.active?'active':''}" data-val="${it.value}">
      <span class="sc-dd-name">${esc(it.label)}</span>
      ${it.count!=null ? `<span class="sc-dd-count">${it.count}</span>` : ''}
    </div>`).join('');
  document.body.appendChild(menu);
  _ddMenu = menu;
  menu.querySelectorAll('.sc-dd-item').forEach(el => el.addEventListener('click', ev => {
    ev.stopPropagation();
    const v = el.dataset.val;
    S.profileId = (v === 'null' || v === '') ? null : parseInt(v);
    _ddMenu?.remove(); _ddMenu = null;
    _reload();
  }));
  const close = e => { if (!menu.contains(e.target)) { menu.remove(); _ddMenu = null; document.removeEventListener('click', close); } };
  setTimeout(() => document.addEventListener('click', close), 0);
}

async function _addProfile() {
  const name = await _prompt('New Profile', 'Profile name:', '');
  if (!name) return;
  const p = await inv('ss_add_profile', { name }).catch(() => null);
  if (!p) return toast('Failed to create profile', 'error');
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
  if (!await confirmDialog(`Delete profile "${cur?.name}"? Scripts only in this profile will also be deleted.`, true)) return;
  const ok = await inv('ss_remove_profile', { id: S.profileId }).catch(() => false);
  if (!ok) return toast('Cannot delete the last profile', 'err');
  S.profileId = null;
  _reload();
}

// ── Toolbar ───────────────────────────────────────────────────────────────────
function _renderToolbar() {
  const tb = document.getElementById('sc-toolbar');
  if (!tb) return;
  const hasSel = S.sel.size > 0;
  const r = S.running;
  tb.innerHTML = `
<button class="sc-btn" id="tb-add" title="Add [Insert]"><i class="ti ti-plus"></i> Add</button>
<button class="sc-btn" id="tb-edit" title="Edit [F2]" ${!hasSel?'disabled':''}><i class="ti ti-pencil"></i> Edit</button>
<button class="sc-btn sc-btn-danger" id="tb-remove" title="Remove [Del]" ${!hasSel?'disabled':''}><i class="ti ti-trash"></i> Remove</button>
<button class="sc-btn" id="tb-toggle" title="Toggle [Space]" ${!hasSel?'disabled':''}><i class="ti ti-player-pause"></i> Toggle</button>
<div class="sc-sep"></div>
<button class="sc-btn sc-btn-run" id="tb-run-sel" title="Run selected [Ctrl+Enter]" ${!hasSel||r?'disabled':''}><i class="ti ti-player-play"></i> Run Selected</button>
<button class="sc-btn sc-btn-run" id="tb-run-all" title="Run all [F5]" ${r?'disabled':''}><i class="ti ti-player-play"></i> Run All</button>
<div class="sc-sep"></div>
<button class="sc-btn sc-btn-admin" id="tb-rsa" title="Run selected (Admin)" ${!hasSel||r?'disabled':''}><i class="ti ti-shield"></i> Run Sel. Admin</button>
<button class="sc-btn sc-btn-admin" id="tb-raa" title="Run all (Admin)" ${r?'disabled':''}><i class="ti ti-shield"></i> Run All Admin</button>
<button class="sc-btn sc-btn-stop" id="tb-stop" title="Stop [Esc]" ${!r?'disabled':''}><i class="ti ti-square"></i> Stop</button>
<div class="sc-sep"></div>
<button class="sc-btn" id="tb-open-editor" title="Open in default editor" ${!S.sel.size?'disabled':''}><i class="ti ti-external-link"></i> Open in Editor</button>
<button class="sc-btn" id="tb-import" title="Import"><i class="ti ti-file-import"></i> Import</button>
<button class="sc-btn" id="tb-export" title="Export"><i class="ti ti-file-export"></i> Export</button>
<button class="sc-btn" id="tb-shortcuts" title="Shortcuts [?]"><i class="ti ti-keyboard"></i></button>`;

  document.getElementById('tb-add').onclick       = _addScript;
  document.getElementById('tb-edit').onclick      = _editSelected;
  document.getElementById('tb-remove').onclick    = _removeSelected;
  document.getElementById('tb-toggle').onclick    = _toggleSelected;
  document.getElementById('tb-run-sel').onclick   = () => _runSelected(false);
  document.getElementById('tb-run-all').onclick   = () => _runAll(false);
  document.getElementById('tb-stop').onclick      = () => { _stopQueue = true; stopCurrentRun(); };
  document.getElementById('tb-rsa').onclick       = () => _runSelected(true);
  document.getElementById('tb-raa').onclick       = () => _runAll(true);
  document.getElementById('tb-open-editor').onclick = () => {
    [...S.sel].forEach(id => inv('ss_open_in_editor', { scriptId: id }).catch(err => toast(String(err), 'err')));
  };
  document.getElementById('tb-import').onclick    = _importProfile;
  document.getElementById('tb-export').onclick    = _exportProfile;
  document.getElementById('tb-shortcuts').onclick = _showShortcuts;
}

// ── Filter bar ────────────────────────────────────────────────────────────────
function _renderFilterBar() {
  const fb = document.getElementById('sc-filter-bar');
  if (!fb) return;
  fb.innerHTML = `
<input class="form-input sc-search" id="sc-search" placeholder="Search scripts…" value="${esc(S.filter)}">
<select class="form-select sc-type-sel" id="sc-type">
  <option value="">All Types</option>
  ${['ps1','bat','cmd','py','sh','vbs','js','reg','ahk'].map(t => `<option value="${t}" ${S.typeFilter===t?'selected':''}>${t}</option>`).join('')}
</select>
<label class="sc-chk-label"><input type="checkbox" id="sc-show-dis" ${S.showDisabled?'checked':''}> Show disabled</label>
<span class="sc-count" id="sc-count"></span>`;

  document.getElementById('sc-search').oninput   = e => { S.filter = e.target.value; _renderTable(); };
  document.getElementById('sc-type').onchange    = e => { S.typeFilter = e.target.value; _renderTable(); };
  document.getElementById('sc-show-dis').onchange = e => { S.showDisabled = e.target.checked; localStorage.setItem('ss-showDisabled', e.target.checked ? '1' : '0'); _renderTable(); };
}

// ── Table ─────────────────────────────────────────────────────────────────────
const COLS = [
  { key: 'drag',        label: '',            sort: false, cls: 'col-grip'   },
  { key: 'order',       label: '#',           sort: true,  cls: 'col-ord'    },
  { key: 'check',       label: '',            sort: false, cls: 'col-cb'     },
  { key: 'name',        label: 'Name',        sort: true,  cls: 'col-name'   },
  { key: 'type',        label: 'Type',        sort: true,  cls: 'col-type'   },
  { key: 'description', label: 'Description', sort: true,  cls: 'col-desc'   },
  { key: 'lastStatus',  label: 'Status',      sort: true,  cls: 'col-status' },
  { key: 'lastRun',     label: 'Last Run',    sort: true,  cls: 'col-lr'     },
  { key: 'run',         label: '',            sort: false, cls: 'col-run'    },
];

function _renderTable() {
  const thead = document.getElementById('sc-thead');
  const tbody = document.getElementById('sc-tbody');
  if (!thead || !tbody) return;
  const rows = _filtered();

  thead.innerHTML = `<tr>${COLS.map(c => `
    <th class="sc-th ${c.cls} ${c.sort?'sc-sortable':''} ${S.sortCol===c.key?(S.sortDir>0?'sc-asc':'sc-desc'):''}"
        data-col="${c.key}">${c.label}${c.sort&&S.sortCol===c.key?(S.sortDir>0?' ↑':' ↓'):''}</th>`).join('')}</tr>`;

  thead.querySelectorAll('.sc-sortable').forEach(th => th.addEventListener('click', () => {
    S.sortCol === th.dataset.col ? S.sortDir *= -1 : (S.sortCol = th.dataset.col, S.sortDir = 1);
    _renderTable();
  }));

  tbody.innerHTML = rows.map(s => _buildRow(s)).join('');
  _bindRowEvents(tbody, rows);

  const c = document.getElementById('sc-count');
  if (c) c.textContent = `${rows.length} / ${S.scripts.length}`;
}

// Returns visible scripts in current sort order — mirrors SS sortList(visible())
function _filtered() {
  let rows = S.scripts.slice();
  if (!S.showDisabled) rows = rows.filter(s => s.enabled);
  if (S.filter) {
    const q = S.filter.toLowerCase();
    rows = rows.filter(s => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
  }
  if (S.typeFilter) rows = rows.filter(s => s.type === S.typeFilter);
  rows.sort((a, b) => {
    let av = a[S.sortCol] ?? a.lastStatus ?? '';
    let bv = b[S.sortCol] ?? b.lastStatus ?? '';
    if (S.sortCol === 'order') { av = +av; bv = +bv; }
    return av < bv ? -S.sortDir : av > bv ? S.sortDir : 0;
  });
  return rows;
}

function _buildRow(s) {
  const sel = S.sel.has(s.id);
  const status = s.lastStatus || 'never';
  const sCls = { ok:'sc-pill-ok', success:'sc-pill-ok', failed:'sc-pill-fail', running:'sc-pill-run', never:'sc-pill-never' }[status] || 'sc-pill-never';
  const lr = s.lastRun ? _fmtTs(s.lastRun) : '—';
  // # shows the script's stored position in custom order (s.order+1), not the row index
  return `<tr class="sc-row${sel?' selected':''}${!s.enabled?' sc-disabled':''}" data-id="${s.id}" draggable="true">
    <td class="col-grip" title="Drag to reorder"><i class="ti ti-grip-vertical"></i></td>
    <td class="col-ord">${s.order + 1}</td>
    <td class="col-cb"><input type="checkbox" class="sc-cb" data-id="${s.id}" ${sel?'checked':''}></td>
    <td class="col-name" title="${esc(s.name)}"><span class="col-name-wrap"><span class="col-name-text">${esc(s.name)}</span>${s.runAsAdmin ? '<i class="ti ti-shield-half-filled sc-admin-badge" title="Runs as Administrator"></i>' : ''}</span></td>
    <td class="col-type"><span class="sc-badge sc-badge-${s.type}">${s.type}</span></td>
    <td class="col-desc" title="${esc(s.description)}">${esc(s.description)}</td>
    <td class="col-status"><span class="sc-pill ${sCls}">${status}</span></td>
    <td class="col-lr">${lr}</td>
    <td class="col-run"><button class="sc-run-btn" data-id="${s.id}" title="Run"><i class="ti ti-player-play"></i></button></td>
  </tr>`;
}

function _patchRow(id) {
  const s = S.scripts.find(x => x.id === id);
  const tr = document.querySelector(`#sc-tbody tr[data-id="${id}"]`);
  if (!s || !tr) return;
  const status = s.lastStatus || 'never';
  const cls = { success:'sc-pill-ok', failed:'sc-pill-fail', running:'sc-pill-run', never:'sc-pill-never' }[status] || 'sc-pill-never';
  const pill = tr.querySelector('.sc-pill');
  if (pill) { pill.className = `sc-pill ${cls}`; pill.textContent = status; }
}

function _bindRowEvents(tbody, rows) {
  tbody.querySelectorAll('.sc-row').forEach(tr => {
    tr.addEventListener('click', e => {
      if (e.target.closest('.sc-run-btn') || e.target.closest('.sc-cb')) return;
      const id = parseInt(tr.dataset.id);
      const idx = rows.findIndex(s => s.id === id);
      if (e.shiftKey && S.lastClickIdx >= 0) {
        const lo = Math.min(S.lastClickIdx, idx), hi = Math.max(S.lastClickIdx, idx);
        rows.slice(lo, hi+1).forEach(s => S.sel.add(s.id));
      } else if (e.ctrlKey || e.metaKey) {
        S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id);
      } else { S.sel.clear(); S.sel.add(id); }
      S.lastClickIdx = idx;
      _refreshSel();
    });

    tr.addEventListener('dblclick', e => {
      if (e.target.closest('.sc-run-btn') || e.target.closest('.sc-cb')) return;
      const id = parseInt(tr.dataset.id);
      const s = S.scripts.find(x => x.id === id);
      if (s) _openScriptModal(s);
    });

    tr.addEventListener('contextmenu', e => {
      e.preventDefault();
      const id = parseInt(tr.dataset.id);
      if (!S.sel.has(id)) { S.sel.clear(); S.sel.add(id); _refreshSel(); }
      _ctxMenu(e, id);
    });

    tr.addEventListener('dragstart', e => {
      S.dragSrcId = parseInt(tr.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', tr.dataset.id);
      tr.classList.add('dragging');
    });
    tr.addEventListener('dragend', () => {
      S.dragSrcId = null;
      document.querySelectorAll('.dragging,.drag-over').forEach(el => el.classList.remove('dragging','drag-over'));
    });
  });

  // Delegate dragover/drop to document — the cursor may leave the table entirely
  // (above the header, past the last row, over the sidebar) and should still resolve
  // to the nearest row instead of the drag just going dead. Bound once globally —
  // looks up #sc-tbody fresh each time since load() rebuilds it on every pane visit.
  if (!document.body.dataset.scDragBound) {
    document.body.dataset.scDragBound = '1';
    const dropZone = document;

    const nearestRow = clientY => {
      const tb = document.getElementById('sc-tbody');
      const rows = tb ? [...tb.querySelectorAll('.sc-row')] : [];
      if (!rows.length) return null;
      let best = null, bestDist = Infinity, before = true;
      for (const row of rows) {
        const rect = row.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        const dist = Math.abs(clientY - mid);
        if (dist < bestDist) { bestDist = dist; best = row; before = clientY < mid; }
      }
      return { row: best, before };
    };

    dropZone.addEventListener('dragover', e => {
      if (!S.dragSrcId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      document.getElementById('sc-tbody')?.querySelectorAll('.drag-over-top,.drag-over-bottom').forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'));
      const hit = nearestRow(e.clientY);
      if (!hit) return;
      hit.row.classList.add(hit.before ? 'drag-over-top' : 'drag-over-bottom');
    });
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      document.getElementById('sc-tbody')?.querySelectorAll('.drag-over-top,.drag-over-bottom').forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'));
      const hit = nearestRow(e.clientY);
      if (!hit || !S.dragSrcId) return;
      const dropId = parseInt(hit.row.dataset.id);
      if (S.dragSrcId === dropId) return;
      const visible = _filtered();
      const si = visible.findIndex(x => x.id === S.dragSrcId);
      let di = visible.findIndex(x => x.id === dropId);
      if (si < 0 || di < 0) return;
      const [mv] = visible.splice(si, 1);
      if (si < di) di--; // account for removal shifting index
      visible.splice(hit.before ? di : di + 1, 0, mv);
      visible.forEach((s, i) => { s.order = i; });
      let off = visible.length;
      S.scripts.forEach(s => { if (!visible.find(x => x.id === s.id)) s.order = off++; });
      _renderTable();
      inv('ss_reorder_scripts', { profileId: S.profileId, orderedIds: [...S.scripts].sort((a, b) => a.order - b.order).map(s => s.id) });
    });
  }

  tbody.querySelectorAll('.sc-cb').forEach(cb => cb.addEventListener('change', () => {
    const id = parseInt(cb.dataset.id);
    cb.checked ? S.sel.add(id) : S.sel.delete(id);
    _refreshSel();
  }));

  tbody.querySelectorAll('.sc-run-btn').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    _runOne(parseInt(btn.dataset.id), false);
  }));
}

function _refreshSel() {
  document.querySelectorAll('#sc-tbody .sc-row').forEach(tr => {
    const id = parseInt(tr.dataset.id);
    tr.classList.toggle('selected', S.sel.has(id));
    const cb = tr.querySelector('.sc-cb');
    if (cb) cb.checked = S.sel.has(id);
  });
  _renderToolbar();
}

// ── Context menu ──────────────────────────────────────────────────────────────
function _ctxMenu(e, id) {
  const s = S.scripts.find(x => x.id === id);
  if (!s) return;
  showContextMenu(e, [
    { label: 'Edit',            icon: 'ti-pencil',       fn: () => _openScriptModal(s) },
    { label: 'Open in Editor',  icon: 'ti-external-link', fn: () => inv('ss_open_in_editor', { scriptId: id }).catch(err => toast(String(err), 'err')) },
    { label: 'Duplicate',       icon: 'ti-copy',          fn: () => _duplicateScript(id) },
    { label: 'Manage Profiles', icon: 'ti-folders',       fn: () => _profilePicker(id) },
    '---',
    { label: s.enabled ? 'Disable' : 'Enable', icon: s.enabled ? 'ti-player-pause' : 'ti-player-play', fn: () => _toggleScripts([id]) },
    { label: 'Copy Content', icon: 'ti-clipboard', fn: () => { navigator.clipboard.writeText(s.content || ''); toast('Copied', 'ok'); } },
    '---',
    { label: 'Run',         icon: 'ti-player-play', fn: () => _runOne(id, false) },
    { label: 'Run as Admin', icon: 'ti-shield',     fn: () => _runOne(id, true) },
    '---',
    { label: 'Delete', icon: 'ti-trash', danger: true, fn: () => _removeScripts([id]) },
  ]);
}

// ── Profile picker overlay ────────────────────────────────────────────────────
async function _profilePicker(scriptId) {
  const s = S.scripts.find(x => x.id === scriptId);
  if (!s) return;
  const cur = new Set(s.inProfiles || []);
  openModal('Manage Profiles', `
<p class="modal-confirm-msg">Select which profiles contain "<strong>${esc(s.name)}</strong>":</p>
<div class="form-row">
  <label style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border2);cursor:pointer;">
    <input type="checkbox" class="sc-pp-cb" data-master="1" ${s.inMaster?'checked':''}>
    <span style="flex:1;font-size:13px;">Master</span>
    <span style="font-size:11px;color:var(--text3);">default</span>
  </label>
  ${S.profiles.map(p => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border2);cursor:pointer;">
      <input type="checkbox" class="sc-pp-cb" data-pid="${p.id}" ${cur.has(p.id)?'checked':''}>
      <span style="flex:1;font-size:13px;">${esc(p.name)}</span>
      <span style="font-size:11px;color:var(--text3);">${p.scriptCount} scripts</span>
    </label>`).join('')}
</div>
<p id="pp-warn" style="display:none;color:var(--red);font-size:11px;margin:0 0 8px">Must stay in at least one profile.</p>
<div class="form-actions">
  <button class="action-btn btn-ghost" id="pp-cancel">Cancel</button>
  <button class="action-btn btn-primary" id="pp-save">Save</button>
</div>`);

  document.getElementById('pp-cancel').onclick = () => closeModal();
  document.getElementById('pp-save').onclick = async () => {
    const checked = [...document.querySelectorAll('.sc-pp-cb:checked')];
    if (!checked.length) { document.getElementById('pp-warn').style.display = 'block'; return; }
    const inMaster = checked.some(cb => cb.dataset.master);
    const ids = checked.filter(cb => cb.dataset.pid).map(cb => parseInt(cb.dataset.pid));
    await inv('ss_set_script_profiles', { scriptId, profileIds: ids, inMaster });
    closeModal(); _reload();
  };
}

// ── Script add/edit modal ─────────────────────────────────────────────────────
function _addScript() { _openScriptModal(null); }
function _editSelected() {
  if (S.sel.size !== 1) return;
  const s = S.scripts.find(x => x.id === [...S.sel][0]);
  if (s) _openScriptModal(s);
}

function _openScriptModal(s) {
  const isNew = !s;
  openModal(isNew ? 'Add Script' : 'Edit Script', `
<div class="form-row">
  <label class="form-label">Name *</label>
  <input class="form-input" id="sm-name" value="${esc(s?.name||'')}" placeholder="Script name">
</div>
<div class="form-row-2">
  <div>
    <label class="form-label">Type</label>
    <select class="form-select" id="sm-type">
      ${['ps1','bat','cmd','py','sh','vbs','js','reg','ahk'].map(t => `<option value="${t}" ${(s?.type||'ps1')===t?'selected':''}>${t}</option>`).join('')}
    </select>
  </div>
  <div>
    <label class="form-label">Category</label>
    <input class="form-input" id="sm-cat" value="${esc(s?.category||'General')}" placeholder="General">
  </div>
</div>
<div class="form-row" style="margin-top:10px">
  <label class="form-label">Description</label>
  <textarea class="form-textarea" id="sm-desc" rows="2" style="min-height:54px;resize:vertical;">${esc(s?.description||'')}</textarea>
</div>
<div class="form-row">
  <label class="form-label">Tags</label>
  <input class="form-input" id="sm-tags" value="${esc(s?.tags||'')}" placeholder="comma, separated">
</div>
<div class="form-row">
  <label class="form-label">Options</label>
  <div style="display:flex;gap:16px;align-items:center;">
    <label style="display:flex;gap:6px;align-items:center;font-size:12px;cursor:pointer;">
      <input type="checkbox" id="sm-admin" ${s?.runAsAdmin?'checked':''}> Run as Administrator
    </label>
    <label style="display:flex;gap:6px;align-items:center;font-size:12px;cursor:pointer;">
      <input type="checkbox" id="sm-interactive" ${s?.interactive?'checked':''}> Pause Script (wait for keypress when done)
    </label>
  </div>
</div>
<div class="form-row">
  <label class="form-label">Script Content</label>
  <textarea class="form-textarea" id="sm-content" rows="10" style="min-height:180px;font-size:12px;" placeholder="Paste or type script content here…">${esc(s?.content||'')}</textarea>
</div>
<div class="form-actions">
  <button class="action-btn btn-ghost" id="sm-cancel">Cancel</button>
  <button class="action-btn btn-primary" id="sm-save">${isNew ? 'Add Script' : 'Save Changes'}</button>
</div>`);

  const save = async () => {
    const name = document.getElementById('sm-name').value.trim();
    if (!name) { document.getElementById('sm-name').focus(); return toast('Name is required', 'error'); }
    const data = {
      name,
      type:        document.getElementById('sm-type').value,
      description: document.getElementById('sm-desc').value,
      content:     document.getElementById('sm-content').value,
      runAsAdmin:  document.getElementById('sm-admin').checked,
      interactive: document.getElementById('sm-interactive').checked,
    };
    if (isNew) await inv('ss_add_script', { profileId: S.profileId, data });
    else       await inv('ss_edit_script', { scriptId: s.id, data });
    closeModal(); _reload();
  };

  document.getElementById('sm-save').onclick   = save;
  document.getElementById('sm-cancel').onclick = () => closeModal();
  // Ctrl+S handled by app.js modal keydown (btn-primary click)
}

// ── Bulk actions ──────────────────────────────────────────────────────────────
async function _removeSelected() { _removeScripts([...S.sel]); }
async function _toggleSelected()  { _toggleScripts([...S.sel]); }

async function _removeScripts(ids) {
  if (!ids.length) return;
  const masterNote = S.profileId === null ? `Remove ${ids.length} script(s)? This permanently deletes them.` : `Remove ${ids.length} script(s) from this profile? Scripts not in any other profile are also deleted.`;
  if (!await confirmDialog(masterNote, true)) return;
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

// ── Run ───────────────────────────────────────────────────────────────────────
// All runs go through run_script — CTRL's existing runner.
// forceAdmin=true overrides the script's own run_as_admin setting.
// "Pause Script" scripts run in the same embedded terminal but hold at the end for a keypress.

let _stopQueue = false;

async function _runOne(id, forceAdmin) {
  await acquireRun();
  toast('Running…', 'info');
  try {
    const r = await inv('run_script', { id, forceAdmin: forceAdmin || false });
    showOutput(r.output, r.success);
    toast(r.success ? 'Done' : 'Script failed', r.success ? 'ok' : 'err');
    _reload();
  } catch (err) { toast(String(err), 'err'); } finally { releaseRun(); }
}

async function _runQueue(scriptIds, forceAdmin) {
  const scripts = scriptIds.map(id => S.scripts.find(s => s.id === id)).filter(s => s && s.enabled);
  if (!scripts.length) return;
  _stopQueue = false;
  S.running = true; S.progressTotal = scripts.length; S.progress = 0;
  _renderToolbar(); _patchStatusBar();
  await acquireRun();
  for (const s of scripts) {
    if (_stopQueue) break;
    S.progress++; _patchStatusBar();
    toast(`Running: ${s.name}`, 'info');
    try {
      const r = await inv('run_script', { id: s.id, forceAdmin: forceAdmin || false });
      showOutput(r.output, r.success);
      toast(r.success ? `Done: ${s.name}` : `Failed: ${s.name}`, r.success ? 'ok' : 'err');
    } catch (e) { toast(`${s.name}: ${String(e)}`, 'err'); }
  }
  releaseRun();
  S.running = false; S.progress = 0; S.progressTotal = 0;
  _renderToolbar(); _patchStatusBar(); _reload();
}

async function _runSelected(admin) {
  if (!S.sel.size) return;
  await _runQueue([...S.sel], admin);
}
async function _runAll(admin) {
  await _runQueue(_filtered().filter(s => s.enabled).map(s => s.id), admin);
}

// ── Import / Export ───────────────────────────────────────────────────────────
async function _importProfile() {
  const json = await inv('ss_import_pick_file').catch(() => null);
  if (json === null) return;
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
  const suggested = `${(cur?.name || 'master').toLowerCase().replace(/\s+/g,'_')}_export.json`;
  const ok = await inv('ss_export_pick_file', { json, suggested }).catch(() => false);
  if (ok) toast('Exported', 'ok');
}

// ── Shortcuts modal ───────────────────────────────────────────────────────────
function _showShortcuts() {
  openModal('Keyboard Shortcuts', `
<table style="width:100%;border-collapse:collapse;font-size:12px;">
  <tbody>
    ${[
      ['Insert',  'Add script'],
      ['F2',      'Edit selected'],
      ['Del',     'Remove selected'],
      ['Space',   'Toggle enable/disable'],
      ['Ctrl+Enter', 'Run selected'],
      ['F5',      'Run all'],
      ['Esc',     'Stop run / close modal'],
      ['Ctrl+A',  'Select all'],
      ['Ctrl+S',  'Save (in modal)'],
      ['?',       'Show shortcuts'],
    ].map(([k, d]) => `<tr style="border-bottom:1px solid var(--border2);">
      <td style="padding:7px 4px;width:110px;"><kbd style="background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:2px 7px;font-family:var(--mono);font-size:11px;">${k}</kbd></td>
      <td style="padding:7px 4px;color:var(--text2);">${d}</td>
    </tr>`).join('')}
  </tbody>
</table>
<div class="form-actions">
  <button class="action-btn btn-primary" id="sh-close">Close</button>
</div>`);
  document.getElementById('sh-close').onclick = () => closeModal();
}

// ── Status bar ────────────────────────────────────────────────────────────────
function _patchStatusBar() {
  const bar = document.getElementById('sc-status-bar');
  if (!bar) return;
  if (S.running && S.progressTotal > 0) {
    const pct = Math.round((S.progress / S.progressTotal) * 100);
    bar.innerHTML = `<div class="sc-progress"><div class="sc-progress-fill" style="width:${pct}%"></div></div><span>${S.progress} / ${S.progressTotal}</span>`;
  } else if (S.running) {
    bar.innerHTML = `<span style="color:var(--amber)"><i class="ti ti-loader"></i> Running…</span>`;
  } else {
    bar.innerHTML = `${S.scripts.length} scripts · ${S.profiles.length} profiles${S.sel.size ? ` · ${S.sel.size} selected` : ''}`;
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
    if (document.querySelector('.modal-overlay.open')) return;
    switch (e.key) {
      case 'Insert': e.preventDefault(); _addScript(); break;
      case 'F2':     e.preventDefault(); _editSelected(); break;
      case 'Delete': e.preventDefault(); _removeSelected(); break;
      case ' ':      if (!inInput) { e.preventDefault(); _toggleSelected(); } break;
      case 'Enter':  if (e.ctrlKey||e.metaKey) { e.preventDefault(); _runSelected(false); } break;
      case 'F5':     e.preventDefault(); _runAll(false); break;
      case 'Escape': if (S.running) { _stopQueue = true; stopCurrentRun(); } break;
      case '?':      if (!inInput) _showShortcuts(); break;
      case 'a': case 'A': if (e.ctrlKey||e.metaKey) { e.preventDefault(); _filtered().forEach(s => S.sel.add(s.id)); _refreshSel(); } break;
    }
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _fmtTs(ts) {
  const n = parseInt(ts);
  if (!n || isNaN(n)) return '—';
  const d = new Date(n * 1000);
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1)  return 'just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h} h ago`;
  if (h < 24 * 7) return `${Math.floor(h / 24)} d ago`;
  const day = String(d.getDate()).padStart(2, '0');
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${mon} ${hh}:${mm}`;
}

async function _prompt(title, label, defaultVal) {
  return new Promise(resolve => {
    openModal(title, `
<div class="form-row">
  <label class="form-label">${esc(label)}</label>
  <input class="form-input" id="sc-prompt-inp" value="${esc(defaultVal)}">
</div>
<div class="form-actions">
  <button class="action-btn btn-ghost" id="sc-prompt-cancel">Cancel</button>
  <button class="action-btn btn-primary" id="sc-prompt-ok">OK</button>
</div>`);
    const inp = document.getElementById('sc-prompt-inp');
    inp.select();
    const done = v => { closeModal(); resolve(v); };
    document.getElementById('sc-prompt-ok').onclick     = () => done(inp.value.trim() || null);
    document.getElementById('sc-prompt-cancel').onclick = () => done(null);
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter')  done(inp.value.trim() || null);
      if (e.key === 'Escape') done(null);
    });
  });
}
