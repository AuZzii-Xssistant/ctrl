import { esc, groupBy, sectionHdr, emptyState, skeletonRows, paneHeader, toast, openModal, closeModal, confirmDialog, showContextMenu, showOutput, timeAgo } from '../app.js';

const inv = window.__TAURI__.core.invoke;

const SHELL_ICON = { powershell: 'ti-terminal-2', cmd: 'ti-terminal', python: 'ti-brand-python' };

export async function load(search = '') {
  const el = document.getElementById('fixes-scroll');
  el.innerHTML = paneHeader('ti-bolt', 'Quick Fixes', 'Add Fix', 'window._showFixModal(null)', 'fixes-filter')
    + `<div id="fixes-body">${skeletonRows(4)}</div>`;

  _wireSearch(el, search);

  const [fixes, lastRuns] = await Promise.all([
    inv('get_fixes', { search }),
    inv('get_last_runs', { item_type: 'fix' }).catch(() => []),
  ]);
  _render(el, fixes, lastRuns);
}

function _render(el, fixes, lastRuns = []) {
  const body = _getBody(el);
  const runMap = Object.fromEntries(lastRuns.map(r => [r.item_id, r]));
  const groups = groupBy(fixes, 'category');
  let html = '';

  if (!fixes.length) {
    html = emptyState('ti-bolt', 'No quick fixes yet.', '+ Add Fix', 'window._showFixModal(null)');
  } else {
    for (const [cat, items] of Object.entries(groups)) {
      html += sectionHdr(cat, items.length) + '<div class="row-list">';
      for (const f of items) {
        const icon = SHELL_ICON[f.shell_type] || 'ti-terminal';
        const lr = runMap[f.id];
        const dot = lr ? `<span class="run-dot ${lr.success ? 'ok' : 'err'}" title="Last run: ${lr.success ? 'success' : 'failed'}"></span>` : `<span class="run-dot none" title="Never run"></span>`;
        const runTime = lr ? `<span class="run-time">${timeAgo(lr.ran_at)}</span>` : '';
        html += `<div class="data-row" data-id="${f.id}">
          <i class="ti ${icon} row-icon"></i>
          <div style="flex:1;min-width:0">
            <div class="row-name">${esc(f.name)}</div>
            ${f.description ? `<div style="font-size:11px;color:var(--text3);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(f.description)}</div>` : ''}
          </div>
          <div class="run-meta-row">${dot}${runTime}</div>
          <span class="tag tag-${f.shell_type === 'powershell' ? 'ps1' : f.shell_type === 'python' ? 'py' : 'bat'}" style="flex-shrink:0">${esc(f.shell_type)}</span>
          <div class="card-actions">
            <button class="run-chip" data-run="${f.id}">RUN</button>
            <button class="icon-btn" title="Edit" data-edit="${f.id}"><i class="ti ti-edit"></i></button>
            <button class="icon-btn del" title="Remove" data-del="${f.id}"><i class="ti ti-trash"></i></button>
          </div>
        </div>`;
      }
      html += '</div>';
    }
  }
  body.innerHTML = html;

  body.querySelectorAll('.data-row[data-id]').forEach(row => {
    row.addEventListener('contextmenu', e => {
      const id = +row.dataset.id;
      const f = fixes.find(x => x.id === id);
      showContextMenu(e, [
        { label: 'Run',  icon: 'ti-player-play', fn: () => _run(id, el) },
        { label: 'Edit', icon: 'ti-edit',        fn: () => f && window._showFixModal(f) },
        '---',
        { label: 'Remove', icon: 'ti-trash', danger: true, fn: () => _delete(id) },
      ]);
    });
  });
  body.querySelectorAll('[data-run]').forEach(btn  => btn.addEventListener('click', e => { e.stopPropagation(); _run(+btn.dataset.run, el); }));
  body.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const f = fixes.find(x => x.id === +btn.dataset.edit);
    if (f) window._showFixModal(f);
  }));
  body.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); _delete(+btn.dataset.del); }));
}

function _getBody(el) {
  let b = el.querySelector('#fixes-body');
  if (!b) { b = document.createElement('div'); b.id = 'fixes-body'; el.appendChild(b); }
  return b;
}

function _wireSearch(el, initial) {
  _getBody(el);
  setTimeout(() => {
    const f = document.getElementById('fixes-filter');
    if (!f) return;
    f.value = initial;
    let timer;
    f.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const [fixes, lastRuns] = await Promise.all([
          inv('get_fixes', { search: f.value.trim() }),
          inv('get_last_runs', { item_type: 'fix' }).catch(() => []),
        ]);
        _render(el, fixes, lastRuns);
      }, 180);
    });
  }, 0);
}

async function _run(id, el) {
  toast('Running…', 'info');
  try {
    const r = await inv('run_fix', { id });
    showOutput(r.output, r.success);
    toast(r.success ? 'Done' : 'Fix failed', r.success ? 'ok' : 'err');
    // refresh dots
    const [fixes, lastRuns] = await Promise.all([
      inv('get_fixes', { search: document.getElementById('fixes-filter')?.value.trim() || '' }),
      inv('get_last_runs', { item_type: 'fix' }).catch(() => []),
    ]);
    _render(el || document.getElementById('fixes-scroll'), fixes, lastRuns);
  } catch (e) { toast(String(e), 'err'); }
}

async function _delete(id) {
  const ok = await confirmDialog('Remove this quick fix?', true);
  if (!ok) return;
  await inv('delete_fix', { id });
  toast('Fix removed', 'info');
  load();
}

window._showFixModal = (fix) => {
  const shells = ['powershell','cmd','python'].map(s =>
    `<option value="${s}"${fix?.shell_type===s?' selected':''}>${s}</option>`).join('');
  openModal(fix ? 'Edit Fix' : 'Add Quick Fix', `
    <div class="form-row"><label class="form-label">Name</label><input class="form-input" id="f-name" value="${esc(fix?.name||'')}" placeholder="Flush DNS" /></div>
    <div class="form-row"><label class="form-label">Description</label><input class="form-input" id="f-desc" value="${esc(fix?.description||'')}" placeholder="Optional" /></div>
    <div class="form-row-2">
      <div class="form-row"><label class="form-label">Category</label><input class="form-input" id="f-cat" value="${esc(fix?.category||'')}" placeholder="Network" /></div>
      <div class="form-row"><label class="form-label">Shell</label><select class="form-select" id="f-shell">${shells}</select></div>
    </div>
    <div class="form-row"><label class="form-label">Command</label><textarea class="form-textarea" id="f-cmd" placeholder="ipconfig /flushdns">${esc(fix?.command||'')}</textarea></div>
    <div class="form-row"><label class="form-label">Tags</label><input class="form-input" id="f-tags" value="${esc(fix?.tags||'')}" placeholder="dns, network" /></div>
    <div class="form-actions">
      <button class="action-btn btn-ghost" onclick="window._closeFixModal()">Cancel</button>
      <button class="action-btn btn-primary" onclick="window._saveFix(${fix?.id||'null'})">${fix?'Save':'Add'}</button>
    </div>`);
  window._closeFixModal = closeModal;
};

window._saveFix = async (id) => {
  const data = {
    name:        document.getElementById('f-name').value.trim(),
    description: document.getElementById('f-desc').value.trim(),
    category:    document.getElementById('f-cat').value.trim() || 'General',
    shell_type:  document.getElementById('f-shell').value,
    command:     document.getElementById('f-cmd').value.trim(),
    tags:        document.getElementById('f-tags').value.trim(),
  };
  if (!data.name || !data.command) { toast('Name and command required', 'err'); return; }
  try {
    if (id) await inv('update_fix', { id, data }); else await inv('add_fix', { data });
    closeModal(); toast(id ? 'Fix updated' : 'Fix added', 'ok'); load();
  } catch (e) { toast(String(e), 'err'); }
};
