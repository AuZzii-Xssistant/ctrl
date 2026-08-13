import { esc, paneHeader, toast, openModal, closeModal, confirmDialog } from '../app.js';

const inv = window.__TAURI__.core.invoke;

let _data = { user: [], system: [] };

export async function load() {
  const el = document.getElementById('env-scroll');
  el.innerHTML = paneHeader('ti-list-details', 'Environment Variables', '+ Add Variable', 'window._showEnvModal(null)', 'env-filter')
    + `<div class="tweaks-note"><i class="ti ti-info-circle"></i> User variables are editable. System variables are read-only (require admin registry access).</div>`
    + `<div id="env-body"><div class="row-list">${'<div class="skel-row skeleton"></div>'.repeat(8)}</div></div>`;

  setTimeout(() => {
    const f = document.getElementById('env-filter');
    if (f) f.addEventListener('input', () => _render(f.value.toLowerCase().trim()));
  }, 0);

  _data = await inv('get_env_vars').catch(() => ({ user: [], system: [] }));
  _render('');
}

function _render(q) {
  const body = document.getElementById('env-body');
  if (!body) return;

  const match = v => !q || v.name.toLowerCase().includes(q) || v.value.toLowerCase().includes(q);
  const userVars   = _data.user.filter(match);
  const systemVars = _data.system.filter(match);

  let html = '';

  if (!userVars.length && !systemVars.length) {
    html = `<div class="empty-state" style="padding-top:40px"><i class="ti ti-list-details"></i><p>No variables match "${esc(q)}"</p></div>`;
    body.innerHTML = html;
    return;
  }

  // User vars — editable
  if (userVars.length) {
    html += _sectionHeader('User Variables', userVars.length, true);
    html += '<div class="env-table">';
    for (const v of userVars) {
      html += `<div class="env-row" data-name="${esc(v.name)}">
        <div class="env-name" title="${esc(v.name)}">${esc(v.name)}</div>
        <div class="env-value" title="${esc(v.value)}">${esc(v.value) || '<span style="opacity:.4;font-style:italic">empty</span>'}</div>
        <div class="env-actions">
          <button class="icon-btn" title="Edit" data-edit="${esc(v.name)}"><i class="ti ti-pencil"></i></button>
          <button class="icon-btn" title="Copy value" data-copy="${esc(v.value)}"><i class="ti ti-copy"></i></button>
          <button class="icon-btn del" title="Delete" data-del="${esc(v.name)}"><i class="ti ti-trash"></i></button>
        </div>
      </div>`;
    }
    html += '</div>';
  }

  // System vars — read-only
  if (systemVars.length) {
    html += _sectionHeader('System Variables', systemVars.length, false);
    html += '<div class="env-table env-table-readonly">';
    for (const v of systemVars) {
      html += `<div class="env-row">
        <div class="env-name" title="${esc(v.name)}">${esc(v.name)}</div>
        <div class="env-value" title="${esc(v.value)}">${esc(v.value) || '<span style="opacity:.4;font-style:italic">empty</span>'}</div>
        <div class="env-actions">
          <button class="icon-btn" title="Copy value" data-copy="${esc(v.value)}"><i class="ti ti-copy"></i></button>
        </div>
      </div>`;
    }
    html += '</div>';
  }

  body.innerHTML = html;

  // Wire buttons
  body.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const name = btn.dataset.edit;
    const v = _data.user.find(x => x.name === name);
    if (v) window._showEnvModal(v);
  }));
  body.querySelectorAll('[data-copy]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    navigator.clipboard.writeText(btn.dataset.copy).then(() => toast('Copied', 'ok')).catch(() => toast('Copy failed', 'err'));
  }));
  body.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', async e => {
    e.stopPropagation();
    const name = btn.dataset.del;
    const ok = await confirmDialog(`Delete user variable "${name}"?`, true);
    if (!ok) return;
    try {
      await inv('delete_env_var', { name });
      toast(`Deleted ${name}`, 'ok');
      _data = await inv('get_env_vars').catch(() => _data);
      const q = document.getElementById('env-filter')?.value.toLowerCase().trim() || '';
      _render(q);
    } catch (e) { toast(String(e), 'err'); }
  }));
}

function _sectionHeader(label, count, editable) {
  const badge = editable
    ? ''
    : '<span style="font-size:10px;color:var(--text3);font-weight:400;margin-left:8px">read-only</span>';
  return `<div class="section-hdr"><span class="section-title">${label}${badge}</span><span class="section-count">${count}</span></div>`;
}

window._showEnvModal = (v) => {
  const isEdit = !!v;
  window._closeEnvModal = closeModal;
  openModal(isEdit ? 'Edit Variable' : 'Add Variable', `
    <div class="form-row">
      <label class="form-label">Name</label>
      <input class="form-input" id="ev-name" value="${esc(v?.name || '')}" placeholder="MY_VAR" ${isEdit ? 'readonly style="opacity:.6"' : ''} />
    </div>
    <div class="form-row">
      <label class="form-label">Value</label>
      <textarea class="form-textarea" id="ev-value" rows="3" style="font-family:var(--mono);font-size:11px" placeholder="value">${esc(v?.value || '')}</textarea>
    </div>
    <div class="form-actions">
      <button class="action-btn btn-ghost" onclick="window._closeEnvModal()">Cancel</button>
      <button class="action-btn btn-primary" onclick="window._saveEnvVar(${isEdit ? `'${esc(v.name)}'` : 'null'})">${isEdit ? 'Save' : 'Add'}</button>
    </div>`);
};

window._saveEnvVar = async (originalName) => {
  const name  = document.getElementById('ev-name').value.trim();
  const value = document.getElementById('ev-value').value;
  if (!name) { toast('Name is required', 'err'); return; }
  try {
    await inv('set_env_var', { name: originalName || name, value });
    closeModal();
    toast(originalName ? `${name} updated` : `${name} added`, 'ok');
    _data = await inv('get_env_vars').catch(() => _data);
    const q = document.getElementById('env-filter')?.value.toLowerCase().trim() || '';
    _render(q);
  } catch (e) { toast(String(e), 'err'); }
};
