import { esc, paneHeader, toast, openModal, closeModal, confirmDialog } from '../app.js';

const inv = window.__TAURI__.core.invoke;

let _data = { user: [], system: [] };

export async function load() {
  const el = document.getElementById('env-scroll');
  el.innerHTML = paneHeader('ti-list-details', 'Environment Variables', '+ Add Variable', 'window._showEnvModal(null,"User")', 'env-filter')
    + `<div class="tweaks-note" style="display:flex;align-items:center;gap:8px">
        <span><i class="ti ti-info-circle"></i> User variables are editable. System variables require UAC elevation to modify.</span>
        <button class="action-btn btn-ghost" style="margin-left:auto;font-size:11px;padding:3px 8px" onclick="window._showAddToPathModal()"><i class="ti ti-plus"></i> Add to PATH</button>
        <button class="action-btn btn-ghost" style="font-size:11px;padding:3px 8px" onclick="window._openPathEditor()" title="Open Windows PATH editor"><i class="ti ti-external-link"></i> PATH Editor</button>
       </div>`
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
    html += _sectionHeader('User Variables', userVars.length);
    html += '<div class="env-table">';
    for (const v of userVars) {
      html += `<div class="env-row" data-name="${esc(v.name)}">
        <div class="env-name" title="${esc(v.name)}">${esc(v.name)}</div>
        <div class="env-value" title="${esc(v.value)}">${esc(v.value) || '<span style="opacity:.4;font-style:italic">empty</span>'}</div>
        <div class="env-actions">
          <button class="icon-btn" title="Edit" data-edit="${esc(v.name)}" data-scope="User"><i class="ti ti-pencil"></i></button>
          <button class="icon-btn" title="Copy value" data-copy="${esc(v.value)}"><i class="ti ti-copy"></i></button>
          <button class="icon-btn del" title="Delete" data-del="${esc(v.name)}" data-scope="User"><i class="ti ti-trash"></i></button>
        </div>
      </div>`;
    }
    html += '</div>';
  }

  // System vars — editable with elevation
  if (systemVars.length) {
    html += _sectionHeader('System Variables', systemVars.length, true);
    html += '<div class="env-table">';
    for (const v of systemVars) {
      html += `<div class="env-row">
        <div class="env-name" title="${esc(v.name)}">${esc(v.name)}</div>
        <div class="env-value" title="${esc(v.value)}">${esc(v.value) || '<span style="opacity:.4;font-style:italic">empty</span>'}</div>
        <div class="env-actions">
          <i class="ti ti-shield" style="font-size:11px;color:var(--amber);margin-right:2px" title="Requires admin"></i>
          <button class="icon-btn" title="Edit (requires admin)" data-edit="${esc(v.name)}" data-scope="Machine"><i class="ti ti-pencil"></i></button>
          <button class="icon-btn" title="Copy value" data-copy="${esc(v.value)}"><i class="ti ti-copy"></i></button>
          <button class="icon-btn del" title="Delete (requires admin)" data-del="${esc(v.name)}" data-scope="Machine"><i class="ti ti-trash"></i></button>
        </div>
      </div>`;
    }
    html += '</div>';
  }

  body.innerHTML = html;

  // Wire buttons
  body.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const name  = btn.dataset.edit;
    const scope = btn.dataset.scope;
    const arr   = scope === 'Machine' ? _data.system : _data.user;
    const v = arr.find(x => x.name === name);
    if (v) window._showEnvModal(v, scope);
  }));
  body.querySelectorAll('[data-copy]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    navigator.clipboard.writeText(btn.dataset.copy).then(() => toast('Copied', 'ok')).catch(() => toast('Copy failed', 'err'));
  }));
  body.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', async e => {
    e.stopPropagation();
    const name  = btn.dataset.del;
    const scope = btn.dataset.scope;
    const scopeLabel = scope === 'Machine' ? ' (system — UAC prompt will appear)' : '';
    const ok = await confirmDialog(`Delete ${scope === 'Machine' ? 'system' : 'user'} variable "${name}"?${scopeLabel}`, true);
    if (!ok) return;
    try {
      await inv('delete_env_var', { name, target: scope });
      toast(`Deleted ${name}`, 'ok');
      _data = await inv('get_env_vars').catch(() => _data);
      const q = document.getElementById('env-filter')?.value.toLowerCase().trim() || '';
      _render(q);
    } catch (err) { toast(String(err), 'err'); }
  }));
}

function _sectionHeader(label, count, systemScope = false) {
  const badge = systemScope
    ? '<span style="font-size:10px;color:var(--amber);font-weight:400;margin-left:8px"><i class="ti ti-shield" style="font-size:10px"></i> UAC required to edit</span>'
    : '';
  return `<div class="section-hdr"><span class="section-title">${label}${badge}</span><span class="section-count">${count}</span></div>`;
}

window._showEnvModal = (v, scope = 'User') => {
  const isEdit  = !!v;
  const isSys   = scope === 'Machine';
  window._closeEnvModal = closeModal;
  const uacNote = isSys
    ? `<div class="tweaks-note" style="margin:0 0 12px;font-size:11px"><i class="ti ti-shield"></i> Editing system variables triggers a UAC elevation prompt.</div>`
    : '';
  openModal(isEdit ? `Edit Variable (${scope})` : 'Add Variable', `
    ${uacNote}
    <div class="form-row">
      <label class="form-label">Name</label>
      <input class="form-input" id="ev-name" value="${esc(v?.name || '')}" placeholder="MY_VAR" />
    </div>
    <div class="form-row">
      <label class="form-label">Value</label>
      <textarea class="form-textarea" id="ev-value" rows="3" style="font-family:var(--mono);font-size:11px" placeholder="value">${esc(v?.value || '')}</textarea>
    </div>
    <div class="form-actions">
      <button class="action-btn btn-ghost" onclick="window._closeEnvModal()">Cancel</button>
      <button class="action-btn btn-primary" onclick="window._saveEnvVar(${isEdit ? `'${esc(v.name)}','${scope}'` : `null,'${scope}'`})">${isEdit ? 'Save' : 'Add'}</button>
    </div>`);
};

window._openPathEditor = () => inv('open_env_editor').catch(err => toast(String(err), 'err'));

window._showAddToPathModal = () => {
  window._closeEnvModal = closeModal;
  openModal('Add to PATH', `
    <div class="form-row">
      <label class="form-label">Directory to add</label>
      <input class="form-input" id="atp-dir" placeholder="C:\\Tools\\bin" />
    </div>
    <div class="form-row">
      <label class="form-label">Scope</label>
      <select class="form-input" id="atp-scope">
        <option value="User">User PATH</option>
        <option value="Machine">System PATH (UAC required)</option>
      </select>
    </div>
    <div class="form-actions">
      <button class="action-btn btn-ghost" onclick="window._closeEnvModal()">Cancel</button>
      <button class="action-btn btn-primary" onclick="window._saveAddToPath()">Add</button>
    </div>`);
};

window._saveAddToPath = async () => {
  const dir   = document.getElementById('atp-dir').value.trim();
  const scope = document.getElementById('atp-scope').value;
  if (!dir) { toast('Directory is required', 'err'); return; }
  try {
    await inv('add_to_path', { dir, target: scope });
    closeModal();
    toast(`Added to ${scope === 'Machine' ? 'System' : 'User'} PATH`, 'ok');
    _data = await inv('get_env_vars').catch(() => _data);
    _render(document.getElementById('env-filter')?.value.toLowerCase().trim() || '');
  } catch (err) { toast(String(err), 'err'); }
};

window._saveEnvVar = async (originalName, scope = 'User') => {
  const name  = document.getElementById('ev-name').value.trim();
  const value = document.getElementById('ev-value').value;
  if (!name) { toast('Name is required', 'err'); return; }
  try {
    // If name changed, delete the old var first then create with new name
    if (originalName && name !== originalName) {
      await inv('delete_env_var', { name: originalName, target: scope });
    }
    await inv('set_env_var', { name, value, target: scope });
    closeModal();
    toast(originalName ? `${name} updated` : `${name} added`, 'ok');
    _data = await inv('get_env_vars').catch(() => _data);
    const q = document.getElementById('env-filter')?.value.toLowerCase().trim() || '';
    _render(q);
  } catch (err) { toast(String(err), 'err'); }
};
