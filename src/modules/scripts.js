import { esc, toast, openModal, closeModal, confirmDialog, scriptIcon, showContextMenu, showOutput, timeAgo, acquireRun, releaseRun } from '../app.js';

const inv = window.__TAURI__.core.invoke;
const { listen } = window.__TAURI__.event;

listen('script-synced', () => { toast('Script synced from editor', 'ok'); _reload(); });

// ── State ────────────────────────────────────────────────────────────────────
let _profileId = null; // null = All Scripts
let _profiles = [];
let _scripts = [];
let _lastRuns = {};
let _filter = '';
let _runningIds = new Set();
let _dragSrcId = null;

// ── Entry ─────────────────────────────────────────────────────────────────────
export async function load(search = '') {
  _filter = search;
  const el = document.getElementById('scripts-scroll');
  // Override pane-scroll so we control the layout
  el.style.cssText = 'overflow:hidden;padding:0;display:flex;flex-direction:row;height:100%;';
  el.innerHTML = '<div id="ss-sidebar"></div><div id="ss-main" style="flex:1;display:flex;flex-direction:column;overflow:hidden;"></div>';
  await _reload();
}

async function _reload() {
  [_profiles, _scripts] = await Promise.all([
    inv('get_profiles').catch(() => []),
    inv('get_profile_scripts', { profileId: _profileId }).catch(() => []),
  ]);
  const runs = await inv('get_last_runs', { itemType: 'script' }).catch(() => []);
  _lastRuns = Object.fromEntries(runs.map(r => [r.item_id, r]));
  _renderSidebar();
  _renderMain();
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function _renderSidebar() {
  const el = document.getElementById('ss-sidebar');
  if (!el) return;
  const totalAll = _profileId === null ? _scripts.length : '?';
  let html = `<div class="ss-sidebar-inner">
    <div class="ss-sidebar-hdr">Profiles</div>
    <div class="ss-profile-item ${_profileId === null ? 'active' : ''}" data-pid="null">
      <i class="ti ti-list"></i> All Scripts
      <span class="ss-pcnt" id="ss-all-cnt"></span>
    </div>`;
  for (const p of _profiles) {
    html += `<div class="ss-profile-item ${_profileId === p.id ? 'active' : ''}" data-pid="${p.id}">
      <i class="ti ti-folder"></i> ${esc(p.name)}
      <span class="ss-pcnt">${p.script_count}</span>
    </div>`;
  }
  html += `<button class="ss-new-profile-btn" id="ss-add-profile"><i class="ti ti-plus"></i> New Profile</button>
  </div>`;
  el.innerHTML = html;

  // Count for All
  inv('get_profile_scripts', { profileId: null }).then(s => {
    const cnt = document.getElementById('ss-all-cnt');
    if (cnt) cnt.textContent = s.length;
  }).catch(() => {});

  el.querySelectorAll('.ss-profile-item').forEach(item => {
    item.addEventListener('click', () => {
      const raw = item.dataset.pid;
      _profileId = raw === 'null' ? null : +raw;
      _reload();
    });
    if (item.dataset.pid !== 'null') {
      item.addEventListener('contextmenu', e => {
        const pid = +item.dataset.pid;
        const p = _profiles.find(x => x.id === pid);
        showContextMenu(e, [
          { label: 'Rename', icon: 'ti-pencil', fn: () => _renameProfile(pid, p?.name) },
          { label: 'Export', icon: 'ti-download', fn: () => _exportProfile(pid, p?.name) },
          '---',
          { label: 'Delete', icon: 'ti-trash', danger: true, fn: () => _deleteProfile(pid) },
        ]);
      });
    }
  });
  document.getElementById('ss-add-profile')?.addEventListener('click', _addProfile);
}

// ── Main area ─────────────────────────────────────────────────────────────────
function _renderMain() {
  const el = document.getElementById('ss-main');
  if (!el) return;
  const inProfile = _profileId !== null;
  const filtered = _filter ? _scripts.filter(s => s.name.toLowerCase().includes(_filter) || s.description.toLowerCase().includes(_filter) || s.tags.toLowerCase().includes(_filter)) : _scripts;

  el.innerHTML = `
    <div class="ss-toolbar">
      <button class="ss-btn ss-btn-primary" id="ss-run-sel"><i class="ti ti-player-play"></i> Run Enabled</button>
      <button class="ss-btn" id="ss-add-script"><i class="ti ti-plus"></i> Add Script</button>
      ${inProfile ? `<button class="ss-btn ss-btn-danger" id="ss-import-btn"><i class="ti ti-file-import"></i> Import</button>` : `<button class="ss-btn" id="ss-import-btn"><i class="ti ti-file-import"></i> Import Profile</button>`}
      <div style="flex:1"></div>
      <input class="ss-filter" id="ss-filter" placeholder="Filter scripts…" value="${esc(_filter)}" />
    </div>
    <div class="ss-table-wrap">
      <table class="ss-table">
        <colgroup>
          ${inProfile ? '<col style="width:20px"><col style="width:32px">' : ''}
          <col style="width:32px">
          <col>
          <col style="width:64px">
          <col>
          <col style="width:90px">
          ${inProfile ? '<col style="width:50px">' : ''}
          <col style="width:28px">
        </colgroup>
        <thead><tr>
          ${inProfile ? '<th class="no-sort"></th><th class="no-sort">#</th>' : ''}
          <th class="no-sort td-cb"><input type="checkbox" id="ss-chk-all"></th>
          <th>Name</th>
          <th>Type</th>
          <th>Description</th>
          <th>Last Run</th>
          ${inProfile ? '<th class="no-sort">On</th>' : ''}
          <th class="no-sort"></th>
        </tr></thead>
        <tbody id="ss-tbody">
          ${filtered.length === 0 ? `<tr><td colspan="20" style="text-align:center;color:var(--text3);padding:32px">No scripts${_filter ? ' matching filter' : '. Click Add Script to get started.'}</td></tr>` : filtered.map((s, i) => _rowHtml(s, i, inProfile)).join('')}
        </tbody>
      </table>
    </div>`;

  _wireMain(filtered, inProfile);
}

function _rowHtml(s, i, inProfile) {
  const lr = _lastRuns[s.id];
  const statusDot = lr
    ? `<span class="ss-dot ${lr.success ? 'ok' : 'err'}" title="${lr.success ? 'Success' : 'Failed'}"></span>`
    : `<span class="ss-dot none"></span>`;
  const runTime = lr ? `<span style="font-size:10px;color:var(--text3)">${timeAgo(lr.ran_at)}</span>` : `<span style="font-size:10px;color:var(--text3)">Never</span>`;
  const ext = s.script_type?.toLowerCase() || 'ps1';
  const adminMark = s.run_as_admin ? ' <i class="ti ti-shield" style="font-size:10px;color:var(--amber)" title="Admin"></i>' : '';
  const interactiveMark = s.interactive ? ' <i class="ti ti-terminal-2" style="font-size:10px;color:var(--text3)" title="Interactive"></i>' : '';
  const running = _runningIds.has(s.id);
  const disClass = (inProfile && s.disabled) ? ' dis' : '';
  const runClass = running ? ' running' : '';

  return `<tr data-id="${s.id}" data-ord="${s.sort_order}" class="${disClass}${runClass}">
    ${inProfile ? `<td class="td-grip" draggable="true" data-drag="${s.id}">⠿</td><td class="td-ord">${i + 1}</td>` : ''}
    <td class="td-cb"><input type="checkbox" class="ss-row-chk" data-id="${s.id}"></td>
    <td class="td-name">${esc(s.name)}${adminMark}${interactiveMark}</td>
    <td><span class="badge b-${ext}">${ext}</span></td>
    <td style="color:var(--text2);font-size:11px">${esc(s.description || s.file_path || '')}</td>
    <td style="display:flex;align-items:center;gap:5px;padding-top:7px">${statusDot}${runTime}</td>
    ${inProfile ? `<td><label class="ss-toggle"><input type="checkbox" class="ss-dis-chk" data-id="${s.id}" ${s.disabled ? '' : 'checked'}><span class="ss-toggle-slider"></span></label></td>` : ''}
    <td><button class="row-run-btn ${running ? 'running' : ''}" data-run="${s.id}" title="Run" ${running ? 'disabled' : ''}><i class="ti ti-player-play"></i></button></td>
  </tr>`;
}

function _wireMain(scripts, inProfile) {
  const el = document.getElementById('ss-main');
  if (!el) return;

  document.getElementById('ss-filter')?.addEventListener('input', e => {
    _filter = e.target.value.trim();
    clearTimeout(_filterTimer);
    _filterTimer = setTimeout(_renderMain, 180);
  });

  document.getElementById('ss-add-script')?.addEventListener('click', () => window._showScriptModal(null));

  document.getElementById('ss-run-sel')?.addEventListener('click', () => _runEnabled(scripts, inProfile));

  document.getElementById('ss-import-btn')?.addEventListener('click', _importProfile);

  document.getElementById('ss-chk-all')?.addEventListener('change', e => {
    el.querySelectorAll('.ss-row-chk').forEach(c => { c.checked = e.target.checked; });
  });

  el.querySelectorAll('[data-run]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    _run(+btn.dataset.run);
  }));

  el.querySelectorAll('.ss-dis-chk').forEach(chk => chk.addEventListener('change', async e => {
    const sid = +e.target.dataset.id;
    await inv('set_script_disabled', { profileId: _profileId, scriptId: sid, disabled: !e.target.checked }).catch(err => toast(String(err), 'err'));
    const row = el.querySelector(`tr[data-id="${sid}"]`);
    if (row) row.classList.toggle('dis', !e.target.checked);
    // update local state
    const s = _scripts.find(x => x.id === sid);
    if (s) s.disabled = !e.target.checked;
  }));

  el.querySelectorAll('tbody tr[data-id]').forEach(row => {
    const id = +row.dataset.id;
    const s = scripts.find(x => x.id === id);
    row.addEventListener('dblclick', () => s && window._showScriptModal(s));
    row.addEventListener('contextmenu', e => {
      showContextMenu(e, [
        { label: 'Run',        icon: 'ti-player-play', fn: () => _run(id) },
        { label: 'Edit',       icon: 'ti-edit',        fn: () => _openEditor(id) },
        { label: 'Edit entry', icon: 'ti-pencil',      fn: () => s && window._showScriptModal(s) },
        ...(inProfile ? [{ label: 'Remove from profile', icon: 'ti-minus', fn: () => _removeFromProfile(id) }] : []),
        ...(!inProfile && _profiles.length ? [{ label: 'Add to profile…', icon: 'ti-plus', fn: () => _pickProfileForScript(id) }] : []),
        '---',
        { label: 'History',    icon: 'ti-history',     fn: () => _showHistory(id, s?.name) },
        '---',
        { label: 'Delete',     icon: 'ti-trash', danger: true, fn: () => _delete(id) },
      ]);
    });
  });

  if (inProfile) _wireDrag(el);
}

let _filterTimer;

// ── Drag reorder ──────────────────────────────────────────────────────────────
function _wireDrag(el) {
  el.querySelectorAll('[data-drag]').forEach(grip => {
    const row = grip.closest('tr');
    row.draggable = true;
    row.addEventListener('dragstart', e => {
      _dragSrcId = +row.dataset.id;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
  });
  el.querySelectorAll('tbody tr[data-id]').forEach(row => {
    row.addEventListener('dragover', e => { e.preventDefault(); row.classList.add('drag-over'); });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', async e => {
      e.preventDefault();
      row.classList.remove('drag-over');
      if (_dragSrcId == null || _dragSrcId === +row.dataset.id) return;
      // Reorder in _scripts
      const from = _scripts.findIndex(s => s.id === _dragSrcId);
      const to   = _scripts.findIndex(s => s.id === +row.dataset.id);
      if (from < 0 || to < 0) return;
      const [moved] = _scripts.splice(from, 1);
      _scripts.splice(to, 0, moved);
      await inv('reorder_profile_scripts', { profileId: _profileId, scriptIds: _scripts.map(s => s.id) }).catch(err => toast(String(err), 'err'));
      _dragSrcId = null;
      _renderMain();
    });
  });
}

// ── Run ───────────────────────────────────────────────────────────────────────
async function _run(id) {
  if (_runningIds.has(id)) return;
  _runningIds.add(id);
  _updateRunBtn(id, true);
  await acquireRun();
  toast('Running…', 'info');
  try {
    const r = await inv('run_script', { id });
    showOutput(r.output, r.success);
    toast(r.success ? 'Done' : 'Script failed', r.success ? 'ok' : 'err');
    const lr = await inv('get_last_runs', { itemType: 'script' }).catch(() => []);
    _lastRuns = Object.fromEntries(lr.map(x => [x.item_id, x]));
    _renderMain();
  } catch (e) { toast(String(e), 'err'); } finally { _runningIds.delete(id); releaseRun(); }
}

async function _runEnabled(scripts, inProfile) {
  const toRun = inProfile
    ? scripts.filter(s => !s.disabled)
    : scripts.filter(s => {
        const chk = document.querySelector(`.ss-row-chk[data-id="${s.id}"]`);
        return chk?.checked;
      });
  if (!toRun.length) { toast('No scripts selected', 'info'); return; }
  for (const s of toRun) await _run(s.id);
}

function _updateRunBtn(id, running) {
  const btn = document.querySelector(`[data-run="${id}"]`);
  if (btn) { btn.disabled = running; btn.classList.toggle('running', running); }
  const row = document.querySelector(`tr[data-id="${id}"]`);
  if (row) row.classList.toggle('running', running);
}

// ── Profiles ─────────────────────────────────────────────────────────────────
async function _addProfile() {
  const name = await _promptModal('New Profile', 'Profile name:', 'My Profile');
  if (!name) return;
  const id = await inv('add_profile', { name }).catch(e => { toast(String(e), 'err'); return null; });
  if (id) { _profileId = id; await _reload(); }
}

async function _renameProfile(id, oldName) {
  const name = await _promptModal('Rename Profile', 'New name:', oldName || '');
  if (!name) return;
  await inv('rename_profile', { id, name }).catch(e => toast(String(e), 'err'));
  _reload();
}

async function _deleteProfile(id) {
  const ok = await confirmDialog('Delete this profile? (Scripts are not deleted.)', true);
  if (!ok) return;
  await inv('remove_profile', { id }).catch(e => toast(String(e), 'err'));
  if (_profileId === id) _profileId = null;
  _reload();
}

async function _exportProfile(id, name) {
  try {
    const json = await inv('export_profile', { profileId: id });
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${name || 'profile'}.json`; a.click();
    URL.revokeObjectURL(url);
  } catch (e) { toast(String(e), 'err'); }
}

async function _importProfile() {
  // Use file input to pick JSON
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.onchange = async () => {
    const file = input.files[0]; if (!file) return;
    const json = await file.text();
    try {
      const id = await inv('import_profile', { json });
      toast('Profile imported', 'ok');
      _profileId = id;
      _reload();
    } catch (e) { toast(String(e), 'err'); }
  };
  input.click();
}

async function _removeFromProfile(scriptId) {
  await inv('remove_from_profile', { profileId: _profileId, scriptId }).catch(e => toast(String(e), 'err'));
  _reload();
}

async function _pickProfileForScript(scriptId) {
  if (!_profiles.length) { toast('Create a profile first', 'info'); return; }
  openModal('Add to Profile', `
    <div style="display:flex;flex-direction:column;gap:6px;max-height:300px;overflow-y:auto">
      ${_profiles.map(p => `<button class="ss-btn" style="justify-content:flex-start;gap:8px" data-pick="${p.id}"><i class="ti ti-folder"></i>${esc(p.name)}</button>`).join('')}
    </div>
    <div class="form-actions"><button class="action-btn btn-ghost" onclick="closeModal()">Cancel</button></div>`);
  document.querySelectorAll('[data-pick]').forEach(btn => btn.addEventListener('click', async () => {
    closeModal();
    await inv('add_to_profile', { profileId: +btn.dataset.pick, scriptId }).catch(e => toast(String(e), 'err'));
    toast('Added to profile', 'ok');
  }));
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _promptModal(title, label, defaultVal) {
  return new Promise(resolve => {
    openModal(title, `
      <div class="form-row"><label class="form-label">${esc(label)}</label>
        <input class="form-input" id="ss-prompt-inp" value="${esc(defaultVal)}" />
      </div>
      <div class="form-actions">
        <button class="action-btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="action-btn btn-primary" id="ss-prompt-ok">OK</button>
      </div>`);
    const inp = document.getElementById('ss-prompt-inp');
    inp?.focus(); inp?.select();
    document.getElementById('ss-prompt-ok')?.addEventListener('click', () => {
      const val = inp?.value.trim(); closeModal(); resolve(val || null);
    });
    inp?.addEventListener('keydown', e => { if (e.key === 'Enter') { const val = inp.value.trim(); closeModal(); resolve(val || null); } });
  });
}

async function _openEditor(id) {
  try {
    await inv('open_script_editor', { id });
    await inv('watch_script_edit', { id });
  } catch (err) { toast(String(err), 'err'); }
}

async function _showHistory(id, name) {
  const entries = await inv('get_run_history', { itemType: 'script', itemId: id, limit: 10 }).catch(() => []);
  if (!entries.length) { toast('No run history yet', 'info'); return; }
  const rows = entries.map(e => `
    <div class="hist-row">
      <span class="run-dot ${e.success ? 'ok' : 'err'}"></span>
      <span class="hist-time">${timeAgo(e.ran_at)}</span>
      <pre class="hist-output">${esc(e.output?.trim() || '(no output)')}</pre>
    </div>`).join('');
  openModal(`History — ${esc(name || '')}`, `<div class="hist-list">${rows}</div>
    <div class="form-actions"><button class="action-btn btn-ghost" onclick="closeModal()">Close</button></div>`);
}

async function _delete(id) {
  const ok = await confirmDialog('Remove this script? (File not deleted.)', true);
  if (!ok) return;
  await inv('delete_script', { id });
  toast('Script removed', 'info');
  window._refreshStats?.();
  _reload();
}

// ── Script modal (shared add/edit) ────────────────────────────────────────────
window._showScriptModal = async (script) => {
  const types = ['ps1','py','bat','cmd','ahk','vbs','sh'].map(t => `<option value="${t}"${script?.script_type===t?' selected':''}>.${t}</option>`).join('');
  const statuses = ['active','deprecated','replaced'].map(s => `<option value="${s}"${script?.status===s?' selected':''}>${s}</option>`).join('');
  const profileOpts = _profiles.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');

  openModal(script ? 'Edit Script' : 'Add Script', `
    <div class="form-row-2">
      <div class="form-row"><label class="form-label">Name</label><input class="form-input" id="f-name" value="${esc(script?.name||'')}" placeholder="BackupDocs" /></div>
      <div class="form-row"><label class="form-label">Type</label><select class="form-select" id="f-type">${types}</select></div>
    </div>
    <div class="form-row"><label class="form-label">Description</label><input class="form-input" id="f-desc" value="${esc(script?.description||'')}" placeholder="What it does" /></div>
    <div class="form-row"><label class="form-label">Category</label><input class="form-input" id="f-cat" value="${esc(script?.category||'')}" placeholder="Maintenance" /></div>
    <div class="form-row"><label class="form-label" style="display:flex;align-items:center;justify-content:space-between">
      Script Content <span style="font-size:10px;color:var(--text3);font-weight:400">stored in DB — runs without a file</span>
    </label>
      <textarea class="form-textarea" id="f-content" rows="6" placeholder="Paste your script here…" style="font-family:var(--mono);font-size:11px">${esc(script?.content||'')}</textarea>
    </div>
    <div class="form-row"><label class="form-label" style="display:flex;align-items:center;justify-content:space-between">
      File Path <span style="font-size:10px;color:var(--text3);font-weight:400">optional if content above is filled</span>
    </label>
      <div class="path-row">
        <input class="form-input" id="f-path" value="${esc(script?.file_path||'')}" placeholder="C:\\scripts\\file.ps1" />
        <button class="btn-browse" onclick="window._browseScript()"><i class="ti ti-folder"></i> Import</button>
      </div>
    </div>
    <div class="form-row-2">
      <div class="form-row"><label class="form-label">Tags</label><input class="form-input" id="f-tags" value="${esc(script?.tags||'')}" placeholder="backup, daily" /></div>
      <div class="form-row"><label class="form-label">Status</label><select class="form-select" id="f-status">${statuses}</select></div>
    </div>
    <div style="display:flex;gap:16px;flex-wrap:wrap">
      <div class="form-row" style="display:flex;align-items:center;gap:8px;flex:none">
        <input type="checkbox" id="f-admin" ${script?.run_as_admin ? 'checked' : ''} />
        <label for="f-admin" class="form-label" style="margin:0;cursor:pointer"><i class="ti ti-shield" style="font-size:11px"></i> Run as Admin</label>
      </div>
      <div class="form-row" style="display:flex;align-items:center;gap:8px;flex:none">
        <input type="checkbox" id="f-interactive" ${script?.interactive ? 'checked' : ''} />
        <label for="f-interactive" class="form-label" style="margin:0;cursor:pointer"><i class="ti ti-terminal-2" style="font-size:11px"></i> Interactive (keeps window open)</label>
      </div>
    </div>
    ${!script && _profiles.length ? `<div class="form-row"><label class="form-label">Add to Profile (optional)</label><select class="form-select" id="f-profile"><option value="">— none —</option>${profileOpts}</select></div>` : ''}
    <div class="form-actions">
      <button class="action-btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="action-btn btn-primary" onclick="window._saveScript(${script?.id||'null'})">${script?'Save':'Add'}</button>
    </div>`);
};

window._browseScript = async () => {
  const path = await inv('browse_for_script');
  if (!path) return;
  document.getElementById('f-path').value = path;
  const ext = path.split('.').pop().toLowerCase();
  const sel = document.getElementById('f-type');
  if (sel && ['ps1','py','bat','cmd','ahk','vbs','sh'].includes(ext)) sel.value = ext;
  try {
    const content = await inv('read_text_file', { path });
    const ta = document.getElementById('f-content');
    if (ta && content) ta.value = content;
  } catch (_) {}
};

window._saveScript = async (id) => {
  const content   = document.getElementById('f-content')?.value.trim() || null;
  const file_path = document.getElementById('f-path')?.value.trim() || '';
  const data = {
    name:        document.getElementById('f-name')?.value.trim(),
    description: document.getElementById('f-desc')?.value.trim() || '',
    category:    document.getElementById('f-cat')?.value.trim() || 'General',
    file_path,
    content: content || null,
    script_type: document.getElementById('f-type')?.value || 'ps1',
    tags:        document.getElementById('f-tags')?.value.trim() || '',
    status:      document.getElementById('f-status')?.value || 'active',
    run_as_admin: document.getElementById('f-admin')?.checked ?? false,
    interactive:  document.getElementById('f-interactive')?.checked ?? false,
  };
  if (!data.name || (!data.file_path && !data.content)) { toast('Name and either content or file path required', 'err'); return; }
  try {
    if (id) {
      await inv('update_script', { id, data });
    } else {
      const newId = await inv('add_script', { data });
      const profileSel = document.getElementById('f-profile')?.value;
      if (profileSel) await inv('add_to_profile', { profileId: +profileSel, scriptId: newId }).catch(() => {});
    }
    closeModal(); toast(id ? 'Script updated' : 'Script added', 'ok');
    window._refreshStats?.(); _reload();
  } catch (e) { toast(String(e), 'err'); }
};
