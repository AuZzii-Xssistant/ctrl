import { esc, groupBy, sectionHdr, emptyState, skeletonCards, paneHeader, toast, openModal, closeModal, confirmDialog, scriptIcon, showContextMenu, showOutput, timeAgo } from '../app.js';

const inv = window.__TAURI__.core.invoke;

export async function load(search = '') {
  const el = document.getElementById('scripts-scroll');
  el.innerHTML = paneHeader('ti-code', 'Scripts', 'Add Script', 'window._showScriptModal(null)', 'scripts-filter')
    + `<div id="scripts-body">${skeletonCards(4)}</div>`;

  _wireSearch(el, search);

  const [scripts, lastRuns] = await Promise.all([
    inv('get_scripts', { search }),
    inv('get_last_runs', { item_type: 'script' }).catch(() => []),
  ]);
  _render(el, scripts, lastRuns);
}

function _render(el, scripts, lastRuns = []) {
  const body = _getBody(el);
  const runMap = Object.fromEntries(lastRuns.map(r => [r.item_id, r]));
  const groups = groupBy(scripts, 'category');
  let html = '';

  if (!scripts.length) {
    html = emptyState('ti-code', 'No scripts yet.', '+ Add Script', 'window._showScriptModal(null)');
  } else {
    for (const [cat, items] of Object.entries(groups)) {
      html += sectionHdr(cat, items.length) + '<div class="card-grid">';
      for (const s of items) {
        const ext = s.script_type?.toLowerCase() || 'ps1';
        const tags = s.tags ? s.tags.split(',').filter(Boolean).map(t => `<span class="chip">${esc(t.trim())}</span>`).join('') : '';
        const lr = runMap[s.id];
        const dot = lr ? `<span class="run-dot ${lr.success ? 'ok' : 'err'}" title="Last run: ${lr.success ? 'success' : 'failed'}"></span>` : `<span class="run-dot none" title="Never run"></span>`;
        const runTime = lr ? `<span class="run-time">${timeAgo(lr.ran_at)}</span>` : '';
        const adminBadge = s.run_as_admin ? '<span class="badge-admin" title="Runs as Administrator"><i class="ti ti-shield"></i> admin</span>' : '';
        html += `<div class="card" data-id="${s.id}">
          <div class="card-icon"><i class="ti ${scriptIcon(ext)}"></i></div>
          <div class="card-name" title="${esc(s.name)}" style="display:flex;align-items:center;gap:5px">${esc(s.name)}${adminBadge}</div>
          <div class="card-sub">${esc(s.description||'')}</div>
          ${tags ? `<div class="card-tags">${tags}</div>` : ''}
          <div class="run-meta-row">${dot}${runTime}</div>
          <div class="card-footer">
            <span class="tag tag-${ext}">.${ext}</span>
            <div class="card-actions">
              <button class="icon-btn run"  title="Run"     data-run="${s.id}"><i class="ti ti-player-play"></i></button>
              <button class="icon-btn"      title="History" data-hist="${s.id}" data-name="${esc(s.name)}"><i class="ti ti-history"></i></button>
              <button class="icon-btn"      title="Edit"    data-edit="${s.id}"><i class="ti ti-edit"></i></button>
              <button class="icon-btn"      title="Folder"  data-loc="${s.id}"><i class="ti ti-folder"></i></button>
              <button class="icon-btn del"  title="Remove"  data-del="${s.id}"><i class="ti ti-trash"></i></button>
            </div>
          </div>
        </div>`;
      }
      html += '</div>';
    }
  }
  body.innerHTML = html;

  body.querySelectorAll('.card[data-id]').forEach(card => {
    card.addEventListener('contextmenu', e => {
      const id = +card.dataset.id;
      const s = scripts.find(x => x.id === id);
      showContextMenu(e, [
        { label: 'Run',         icon: 'ti-player-play', fn: () => _run(id) },
        { label: 'History',     icon: 'ti-history',     fn: () => _showHistory(id, s?.name) },
        { label: 'Open editor', icon: 'ti-edit',        fn: () => inv('open_script_editor',   { id }) },
        { label: 'Show folder', icon: 'ti-folder',      fn: () => inv('open_script_location', { id }) },
        '---',
        { label: 'Edit entry',  icon: 'ti-pencil',      fn: () => s && window._showScriptModal(s) },
        { label: 'Remove',      icon: 'ti-trash', danger: true, fn: () => _delete(id) },
      ]);
    });
  });
  body.querySelectorAll('[data-run]').forEach(btn  => btn.addEventListener('click', e => { e.stopPropagation(); _run(+btn.dataset.run); }));
  body.querySelectorAll('[data-hist]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); _showHistory(+btn.dataset.hist, btn.dataset.name); }));
  body.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); inv('open_script_editor',   { id: +btn.dataset.edit }); }));
  body.querySelectorAll('[data-loc]').forEach(btn  => btn.addEventListener('click', e => { e.stopPropagation(); inv('open_script_location', { id: +btn.dataset.loc  }); }));
  body.querySelectorAll('[data-del]').forEach(btn  => btn.addEventListener('click', e => { e.stopPropagation(); _delete(+btn.dataset.del); }));
}

function _getBody(el) {
  let b = el.querySelector('#scripts-body');
  if (!b) { b = document.createElement('div'); b.id = 'scripts-body'; el.appendChild(b); }
  return b;
}

function _wireSearch(el, initial) {
  _getBody(el);
  setTimeout(() => {
    const f = document.getElementById('scripts-filter');
    if (!f) return;
    f.value = initial;
    let timer;
    f.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const [scripts, lastRuns] = await Promise.all([
          inv('get_scripts', { search: f.value.trim() }),
          inv('get_last_runs', { item_type: 'script' }).catch(() => []),
        ]);
        _render(el, scripts, lastRuns);
      }, 180);
    });
  }, 0);
}

async function _run(id) {
  toast('Running…', 'info');
  try {
    const r = await inv('run_script', { id });
    showOutput(r.output, r.success);
    toast(r.success ? 'Done' : 'Script failed', r.success ? 'ok' : 'err');
    const el = document.getElementById('scripts-scroll');
    const [scripts, lastRuns] = await Promise.all([
      inv('get_scripts', { search: document.getElementById('scripts-filter')?.value.trim() || '' }),
      inv('get_last_runs', { item_type: 'script' }).catch(() => []),
    ]);
    _render(el, scripts, lastRuns);
  } catch (e) { toast(String(e), 'err'); }
}

async function _showHistory(id, name) {
  const entries = await inv('get_run_history', { item_type: 'script', item_id: id, limit: 10 }).catch(() => []);
  if (!entries.length) { toast('No run history yet', 'info'); return; }
  const rows = entries.map(e => `
    <div class="hist-row">
      <span class="run-dot ${e.success ? 'ok' : 'err'}"></span>
      <span class="hist-time">${timeAgo(e.ran_at)}</span>
      <pre class="hist-output">${esc(e.output.trim() || '(no output)')}</pre>
    </div>`).join('');
  openModal(`History — ${esc(name || '')}`, `<div class="hist-list">${rows}</div>
    <div class="form-actions"><button class="action-btn btn-ghost" onclick="window._closeHistModal()">Close</button></div>`);
  window._closeHistModal = closeModal;
}

async function _delete(id) {
  const ok = await confirmDialog('Remove this script entry? (File is not deleted.)', true);
  if (!ok) return;
  await inv('delete_script', { id });
  toast('Script removed', 'info');
  load();
}

window._showScriptModal = async (script) => {
  const types    = ['ps1','py','bat','cmd'].map(t => `<option value="${t}"${script?.script_type===t?' selected':''}>.${t}</option>`).join('');
  const statuses = ['active','deprecated','replaced'].map(s => `<option value="${s}"${script?.status===s?' selected':''}>${s}</option>`).join('');
  openModal(script ? 'Edit Script' : 'Add Script', `
    <div class="form-row-2">
      <div class="form-row"><label class="form-label">Name</label><input class="form-input" id="f-name" value="${esc(script?.name||'')}" placeholder="BackupDocs" /></div>
      <div class="form-row"><label class="form-label">Type</label><select class="form-select" id="f-type">${types}</select></div>
    </div>
    <div class="form-row"><label class="form-label">Description</label><input class="form-input" id="f-desc" value="${esc(script?.description||'')}" placeholder="What it does" /></div>
    <div class="form-row"><label class="form-label">Category</label><input class="form-input" id="f-cat" value="${esc(script?.category||'')}" placeholder="Backup" /></div>
    <div class="form-row"><label class="form-label">File Path</label>
      <div class="path-row">
        <input class="form-input" id="f-path" value="${esc(script?.file_path||'')}" placeholder="C:\\scripts\\file.ps1" />
        <button class="btn-browse" onclick="window._browseScript()"><i class="ti ti-folder"></i> Browse</button>
      </div>
    </div>
    <div class="form-row-2">
      <div class="form-row"><label class="form-label">Tags</label><input class="form-input" id="f-tags" value="${esc(script?.tags||'')}" placeholder="backup, daily" /></div>
      <div class="form-row"><label class="form-label">Status</label><select class="form-select" id="f-status">${statuses}</select></div>
    </div>
    <div class="form-row" style="display:flex;align-items:center;gap:8px">
      <input type="checkbox" id="f-admin" ${script?.run_as_admin ? 'checked' : ''} style="accent-color:var(--accent)" />
      <label for="f-admin" class="form-label" style="margin:0;cursor:pointer"><i class="ti ti-shield" style="font-size:11px"></i> Run as Administrator (UAC elevation)</label>
    </div>
    <div class="form-actions">
      <button class="action-btn btn-ghost" onclick="window._closeScriptModal()">Cancel</button>
      <button class="action-btn btn-primary" onclick="window._saveScript(${script?.id||'null'})">${script?'Save':'Add'}</button>
    </div>`);
  window._closeScriptModal = closeModal;
};

window._browseScript = async () => {
  const path = await inv('browse_for_script');
  if (path) {
    document.getElementById('f-path').value = path;
    const ext = path.split('.').pop().toLowerCase();
    const sel = document.getElementById('f-type');
    if (sel && ['ps1','py','bat','cmd'].includes(ext)) sel.value = ext;
  }
};

window._saveScript = async (id) => {
  const data = {
    name:        document.getElementById('f-name').value.trim(),
    description: document.getElementById('f-desc').value.trim(),
    category:    document.getElementById('f-cat').value.trim() || 'General',
    file_path:   document.getElementById('f-path').value.trim(),
    script_type: document.getElementById('f-type').value,
    tags:        document.getElementById('f-tags').value.trim(),
    status:      document.getElementById('f-status').value,
    run_as_admin: document.getElementById('f-admin')?.checked ?? false,
  };
  if (!data.name || !data.file_path) { toast('Name and file path required', 'err'); return; }
  try {
    if (id) await inv('update_script', { id, data }); else await inv('add_script', { data });
    closeModal(); toast(id ? 'Script updated' : 'Script added', 'ok'); load();
  } catch (e) { toast(String(e), 'err'); }
};
