import { esc, groupBy, sectionHdr, emptyState, skeletonCards, paneHeader, toast, openModal, closeModal, confirmDialog, showContextMenu } from '../app.js';
import { invalidatePins } from './dashboard.js';

const inv = window.__TAURI__.core.invoke;

const EXT_ICON = { exe:'ti-device-desktop', lnk:'ti-link', ps1:'ti-terminal-2', bat:'ti-terminal', cmd:'ti-terminal', py:'ti-brand-python', ahk:'ti-keyboard', jar:'ti-brand-java' };
function _toolIcon(path) {
  const ext = (path || '').split('.').pop().toLowerCase();
  return EXT_ICON[ext] || 'ti-app-window';
}

// Seeded Quick Launch labels are shortened to fit the pill (see db.rs's seed
// list) -- the tooltip should say what the shortcut actually is, not just
// repeat the same abbreviation back. Only covers labels that are genuinely
// truncated; anything not listed here already reads as a full name.
const QL_FULL_NAME = {
  'MSConfig':            'System Configuration (MSConfig)',
  'Security & Maint.':   'Security and Maintenance',
  'Programs & Features': 'Programs and Features',
  'Region':              'Region Settings',
  'Time and Date':       'Date and Time',
  'Firewall':            'Windows Defender Firewall',
  'Printers':            'Printers Folder',
  'Virtual Memory':      'Advanced System Properties — Virtual Memory',
  'Visual Effects':      'Performance Options — Visual Effects',
};


let _qls = [];

export async function load(search = '') {
  const el = document.getElementById('tools-scroll');
  el.innerHTML = paneHeader('ti-app-window', 'Tools', 'Add Tool', 'window._showToolModal(null)', 'tools-filter')
    + `<div id="tools-body">${skeletonCards(4)}</div>`;

  _wireSearch(el, search);
  _wireQlFilter();

  const [tools, qls] = await Promise.all([
    inv('get_tools', { search }),
    inv('get_ql_items').catch(() => []),
  ]);
  _qls = qls;
  _render(el, tools);
  _renderQlPanel();
}

function _render(el, tools) {
  const body = el.querySelector('#tools-body') || (() => {
    const d = document.createElement('div'); d.id = 'tools-body'; el.appendChild(d); return d;
  })();
  const groups = groupBy(tools, 'category');
  let html = '';

  if (!tools.length) {
    html += emptyState('ti-app-window', 'No tools registered yet.', '+ Add Tool', 'window._showToolModal(null)');
  } else {
    for (const [cat, items] of Object.entries(groups)) {
      html += sectionHdr(cat, items.length) + '<div class="card-grid">';
      for (const t of items) {
        const fname = (t.path || '').split(/[\\/]/).pop();
        const ext = fname.split('.').pop().toLowerCase() || 'exe';
        const adminBadge = t.run_as_admin ? '<span class="badge-admin">admin</span>' : '';
        const tags = t.tags ? t.tags.split(',').filter(Boolean).map(tag => `<span class="chip">${esc(tag.trim())}</span>`).join('') : '';
        html += `<div class="card" data-id="${t.id}" data-launch="${t.id}">
          <div class="card-icon"><i class="ti ${_toolIcon(t.path)}"></i></div>
          <div class="card-name" title="${esc(t.name)}">${esc(t.name)}</div>
          <div class="card-sub">${esc(fname)}</div>
          ${tags ? `<div class="card-tags">${tags}</div>` : ''}
          <div class="card-footer">
            <div style="display:flex;gap:4px;align-items:center"><span class="tag tag-${ext}">.${ext}</span>${adminBadge}</div>
            <div class="card-actions">
              <button class="icon-btn run" title="Launch" data-launch="${t.id}"><i class="ti ti-player-play"></i></button>
              <button class="icon-btn"    title="Edit"   data-edit="${t.id}"><i class="ti ti-edit"></i></button>
              <button class="icon-btn del" title="Remove" data-del="${t.id}"><i class="ti ti-trash"></i></button>
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
      showContextMenu(e, [
        { label: 'Launch', icon: 'ti-player-play', fn: () => _launch(id) },
        { label: 'Pin to Dashboard', icon: 'ti-pin', fn: () => inv('pin_item', { itemType: 'tool', itemId: id, groupName: 'Pinned' }).then(() => { invalidatePins(); toast('Pinned', 'ok'); }) },
        { label: 'Edit',   icon: 'ti-edit',        fn: () => _editById(id, tools) },
        '---',
        { label: 'Remove', icon: 'ti-trash', danger: true, fn: () => _delete(id) },
      ]);
    });
  });
  body.querySelectorAll('[data-launch]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); _launch(+btn.dataset.launch); }));
  body.querySelectorAll('[data-edit]').forEach(btn   => btn.addEventListener('click', e => { e.stopPropagation(); _editById(+btn.dataset.edit, tools); }));
  body.querySelectorAll('[data-del]').forEach(btn    => btn.addEventListener('click', e => { e.stopPropagation(); _delete(+btn.dataset.del); }));
}

// ── Quick Launch side panel — own filter, independent of the Tools search ─────
function _renderQlPanel() {
  const panel = document.getElementById('ql-panel-body');
  if (!panel) return;
  const q = document.getElementById('ql-filter')?.value.trim().toLowerCase() || '';
  const items = q ? _qls.filter(x => x.label.toLowerCase().includes(q)) : _qls;

  if (!items.length) {
    panel.innerHTML = `<div style="font-size:11px;color:var(--text3);text-align:center;padding:16px 4px">${q ? 'No matches' : 'Nothing yet'}</div>`;
    return;
  }
  panel.innerHTML = '<div class="ql-grid">' + items.map(item => `
    <div class="ql-pill-wrap" data-ql-id="${item.id}">
      <button class="ql-pill" data-cmd="${esc(item.cmd)}" title="${esc(QL_FULL_NAME[item.label] || item.label)}">
        <i class="ti ${item.icon}"></i>${esc(item.label)}
      </button>
      <button class="ql-pin-btn" data-ql-id="${item.id}" title="Pin to Dashboard"><i class="ti ti-pin"></i></button>
      <button class="ql-del-btn" data-ql-id="${item.id}" title="Remove"><i class="ti ti-x"></i></button>
    </div>`).join('') + '</div>';

  panel.querySelectorAll('.ql-pill[data-cmd]').forEach(btn =>
    btn.addEventListener('click', () => inv('launch_shortcut', { cmd: btn.dataset.cmd }).catch(e => toast(String(e), 'err')))
  );
  panel.querySelectorAll('.ql-pill-wrap[data-ql-id]').forEach(wrap => {
    const id = +wrap.dataset.qlId;
    wrap.addEventListener('contextmenu', e => {
      showContextMenu(e, [
        { label: 'Pin to Dashboard', icon: 'ti-pin', fn: () => inv('pin_item', { itemType: 'ql', itemId: id, groupName: 'Pinned' }).then(() => { invalidatePins(); toast('Pinned', 'ok'); }) },
        '---',
        { label: 'Remove', icon: 'ti-trash', danger: true, fn: async () => {
          if (!(await confirmDialog('Remove this Quick Launch shortcut? This is permanent — it won\'t come back on a future update.', true))) return;
          await inv('delete_ql_item', { id }).catch(e2 => { toast(String(e2), 'err'); throw e2; });
          _qls = await inv('get_ql_items').catch(() => []);
          _renderQlPanel();
        } },
      ]);
    });
  });
  panel.querySelectorAll('.ql-del-btn[data-ql-id]').forEach(btn =>
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!(await confirmDialog('Remove this Quick Launch shortcut? This is permanent — it won\'t come back on a future update.', true))) return;
      await inv('delete_ql_item', { id: +btn.dataset.qlId }).catch(e2 => toast(String(e2), 'err'));
      _qls = await inv('get_ql_items').catch(() => []);
      _renderQlPanel();
    })
  );
  panel.querySelectorAll('.ql-pin-btn[data-ql-id]').forEach(btn =>
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      await inv('pin_item', { itemType: 'ql', itemId: +btn.dataset.qlId, groupName: 'Pinned' });
      invalidatePins();
      toast('Pinned to Dashboard', 'ok');
    })
  );
}

function _wireQlFilter() {
  const f = document.getElementById('ql-filter');
  if (!f || f.dataset.bound) return;
  f.dataset.bound = '1';
  f.addEventListener('input', () => _renderQlPanel());
}

function _wireSearch(el, initial) {
  // Replace skeleton while keeping header
  const existing = el.querySelector('#tools-body');
  if (!existing) { const d = document.createElement('div'); d.id = 'tools-body'; el.appendChild(d); }

  setTimeout(() => {
    const f = document.getElementById('tools-filter');
    if (!f) return;
    let timer;
    f.value = initial;
    f.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const tools = await inv('get_tools', { search: f.value.trim() });
        _render(el, tools);
      }, 180);
    });
  }, 0);
}

async function _launch(id) {
  try { await inv('launch_tool', { id }); toast('Launched', 'ok'); }
  catch (e) { toast(String(e), 'err'); }
}

function _editById(id, tools) {
  const t = tools.find(x => x.id === id);
  if (t) window._showToolModal(t);
}

async function _delete(id) {
  const ok = await confirmDialog('Remove this tool?', true);
  if (!ok) return;
  await inv('delete_tool', { id });
  toast('Tool removed', 'info');
  window._refreshStats?.();
  load();
}

window._showToolModal = (tool) => {
  openModal(tool ? 'Edit Tool' : 'Add Tool', `
    <div class="form-row"><label class="form-label">Name</label><input class="form-input" id="f-name" value="${esc(tool?.name||'')}" placeholder="VS Code" /></div>
    <div class="form-row"><label class="form-label">Category</label><input class="form-input" id="f-cat" value="${esc(tool?.category||'')}" placeholder="Dev" /></div>
    <div class="form-row"><label class="form-label">Path</label>
      <div class="path-row">
        <input class="form-input" id="f-path" value="${esc(tool?.path||'')}" placeholder="C:\\tools\\app.exe" />
        <button class="btn-browse" onclick="window._browseExe()"><i class="ti ti-folder"></i> Browse</button>
      </div>
    </div>
    <div class="form-row"><label class="form-label">Args (optional)</label><input class="form-input" id="f-args" value="${esc(tool?.args||'')}" placeholder="--optional-flags" /></div>
    <div class="form-row"><label class="form-label">Tags</label><input class="form-input" id="f-tags" value="${esc(tool?.tags||'')}" placeholder="editor, dev" /></div>
    <div class="form-row"><label class="form-label">Notes</label><textarea class="form-textarea" id="f-notes" placeholder="What this tool does">${esc(tool?.notes||'')}</textarea></div>
    <div class="form-row" style="display:flex;align-items:center;gap:8px">
      <input type="checkbox" id="f-admin" ${tool?.run_as_admin ? 'checked' : ''} />
      <label for="f-admin" class="form-label" style="margin:0;cursor:pointer">Run as Administrator</label>
    </div>
    ${!tool ? `<div class="form-row" style="display:flex;align-items:center;gap:8px">
      <input type="checkbox" id="f-pin" checked />
      <label for="f-pin" class="form-label" style="margin:0;cursor:pointer">Pin to Dashboard</label>
    </div>` : ''}
    <div class="form-actions">
      <button class="action-btn btn-ghost" onclick="window._closeToolModal()">Cancel</button>
      <button class="action-btn btn-primary" onclick="window._saveTool(${tool?.id||'null'})">${tool?'Save':'Add'}</button>
    </div>`);
  window._closeToolModal = closeModal;
};

window._browseExe = async () => {
  const path = await inv('browse_for_exe');
  if (path) document.getElementById('f-path').value = path;
};

window._saveTool = async (id) => {
  const data = {
    name:          document.getElementById('f-name').value.trim(),
    category:      document.getElementById('f-cat').value.trim() || 'General',
    path:          document.getElementById('f-path').value.trim(),
    args:          document.getElementById('f-args').value.trim(),
    tags:          document.getElementById('f-tags').value.trim(),
    notes:         document.getElementById('f-notes').value.trim(),
    run_as_admin:  document.getElementById('f-admin')?.checked ?? false,
  };
  if (!data.name || !data.path) { toast('Name and path required', 'err'); return; }
  try {
    if (id) {
      await inv('update_tool', { id, data });
    } else {
      const newId = await inv('add_tool', { data });
      if (document.getElementById('f-pin')?.checked) {
        await inv('pin_item', { itemType: 'tool', itemId: newId, groupName: 'Pinned' }).catch(() => {});
        invalidatePins();
      }
    }
    closeModal(); toast(id ? 'Tool updated' : 'Tool added', 'ok');
    window._refreshStats?.(); load();
  } catch (e) { toast(String(e), 'err'); }
};
