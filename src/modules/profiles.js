import { invoke, esc, paneHeader, emptyState, skeletonRows, toast, openModal, closeModal, confirmDialog, showOutput, showContextMenu } from '../app.js';

const inv = invoke;

const ITEM_TYPES = [
  { key: 'power_plan',   label: 'Power Plan',        placeholder: 'High performance', hint: 'powercfg plan name or GUID', multiline: false },
  { key: 'kill_apps',    label: 'Kill Apps',         placeholder: 'chrome\nteams', hint: 'process names, one per line', multiline: true },
  { key: 'start_apps',   label: 'Start Apps',        placeholder: 'C:\\Program Files\\OBS Studio\\obs64.exe', hint: 'paths/commands, one per line', multiline: true },
  { key: 'dns',          label: 'DNS Server',        placeholder: '1.1.1.1,1.0.0.1 or dhcp', hint: 'comma-separated IPs, or "dhcp"', multiline: false },
  { key: 'audio',        label: 'Audio Endpoint',    placeholder: 'Headphones', hint: 'device name (best-effort, needs AudioDeviceCmdlets)', multiline: false },
  { key: 'refresh_rate', label: 'Refresh Rate (Hz)', placeholder: '144', hint: 'best-effort, may not work on all displays', multiline: false },
  { key: 'script',       label: 'Custom Script',      placeholder: '# raw PowerShell, runs elevated', hint: 'runs last, elevated', multiline: true },
];

export async function load() {
  const el = document.getElementById('profiles-scroll');
  const note = `<div class="tweaks-note-inner"><i class="ti ti-info-circle"></i> Activating a profile snapshots current power plan / DNS / audio / apps first, so Restore Previous always reverts safely.</div>`;
  el.innerHTML = paneHeader('ti-user-cog', 'System Profiles', 'New Profile', 'window._showProfileModal(null)', null, note)
    + `<div id="prof-body">${skeletonRows(3)}</div>`;
  await _reload();
}

async function _reload() {
  const [profiles, active] = await Promise.all([
    inv('get_profiles').catch(() => []),
    inv('get_active_profile').catch(() => null),
  ]);
  _render(profiles, active);
}

function _render(profiles, active) {
  const body = document.getElementById('prof-body');
  if (!body) return;

  const restoreBar = active
    ? `<div class="tweaks-note-inner" style="margin-bottom:8px">
         <i class="ti ti-circle-check" style="color:var(--amber)"></i> Active profile: <strong>${esc(active.name)}</strong>
         <button class="action-btn btn-ghost" id="prof-restore-btn" style="margin-left:auto;font-size:10px;padding:3px 10px"><i class="ti ti-arrow-back-up"></i> Restore Previous</button>
       </div>`
    : '';

  if (!profiles.length) {
    body.innerHTML = restoreBar + emptyState('ti-user-cog', 'No profiles yet.', '+ New Profile', 'window._showProfileModal(null)');
  } else {
    body.innerHTML = restoreBar + '<div class="row-list">' + profiles.map(p => `
      <div class="data-row" data-id="${p.id}">
        <i class="ti ${esc(p.icon || 'ti-user-cog')} row-icon" style="color:var(--amber)"></i>
        <div style="flex:1;min-width:0">
          <div class="row-name">${esc(p.name)} ${active && active.id === p.id ? '<span class="tag" style="margin-left:6px">active</span>' : ''}</div>
          <div class="row-path">${esc(p.description || `${p.items.length} setting${p.items.length === 1 ? '' : 's'}`)}</div>
        </div>
        <div class="card-actions">
          <button class="run-chip" data-activate="${p.id}">ACTIVATE</button>
          <button class="icon-btn" title="Edit" data-edit="${p.id}"><i class="ti ti-edit"></i></button>
          <button class="icon-btn del" title="Delete" data-del="${p.id}"><i class="ti ti-trash"></i></button>
        </div>
      </div>`).join('') + '</div>';
  }

  body.querySelectorAll('.data-row[data-id]').forEach(row => {
    const id = +row.dataset.id;
    const p = profiles.find(x => x.id === id);
    row.addEventListener('contextmenu', e => showContextMenu(e, [
      { label: 'Activate', icon: 'ti-player-play', fn: () => _activate(id) },
      { label: 'Edit',     icon: 'ti-edit',        fn: () => p && window._showProfileModal(p) },
      '---',
      { label: 'Delete', icon: 'ti-trash', danger: true, fn: () => _delete(id) },
    ]));
  });
  body.querySelectorAll('[data-activate]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); _activate(+btn.dataset.activate); }));
  body.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const p = profiles.find(x => x.id === +btn.dataset.edit);
    if (p) window._showProfileModal(p);
  }));
  body.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); _delete(+btn.dataset.del); }));
  const restoreBtn = document.getElementById('prof-restore-btn');
  if (restoreBtn) restoreBtn.onclick = _restore;
}

async function _activate(id) {
  toast('Activating profile…', 'info');
  try {
    const r = await inv('activate_profile', { id });
    showOutput(r.output, r.success);
    toast(r.success ? 'Profile activated' : 'Activation had issues (check output)', r.success ? 'ok' : 'err');
    await window._refreshActiveProfileChip?.();
    await _reload();
  } catch (e) { toast(String(e), 'err'); }
}

async function _restore() {
  toast('Restoring previous state…', 'info');
  try {
    const r = await inv('restore_previous');
    showOutput(r.output, r.success);
    toast(r.success ? 'Restored' : 'Restore had issues (check output)', r.success ? 'ok' : 'err');
    await window._refreshActiveProfileChip?.();
    await _reload();
  } catch (e) { toast(String(e), 'err'); }
}

async function _delete(id) {
  const ok = await confirmDialog('Delete this profile? Its snapshots are removed too.', true);
  if (!ok) return;
  await inv('delete_profile', { id });
  toast('Profile deleted', 'info');
  await window._refreshActiveProfileChip?.();
  await _reload();
}

window._showProfileModal = (profile) => {
  const items = ITEM_TYPES.map(t => {
    const existing = profile?.items.find(i => i.item_type === t.key);
    return { ...t, value: existing?.value || '', enabled: existing ? existing.enabled : true };
  });

  const fieldsHtml = items.map(it => `
    <div class="form-row">
      <label class="form-label"><input type="checkbox" id="prof-en-${it.key}" ${it.enabled ? 'checked' : ''}> ${esc(it.label)}</label>
      ${it.multiline
        ? `<textarea class="form-input" id="prof-val-${it.key}" rows="2" placeholder="${esc(it.placeholder)}">${esc(it.value)}</textarea>`
        : `<input class="form-input" id="prof-val-${it.key}" value="${esc(it.value)}" placeholder="${esc(it.placeholder)}" />`}
      <div class="run-time" style="color:var(--text3)">${esc(it.hint)}</div>
    </div>`).join('');

  openModal(profile ? 'Edit Profile' : 'New Profile', `
    <div class="form-row"><label class="form-label">Profile Name</label>
      <input class="form-input" id="prof-name" value="${esc(profile?.name || '')}" placeholder="Gaming" /></div>
    <div class="form-row"><label class="form-label">Description</label>
      <input class="form-input" id="prof-desc" value="${esc(profile?.description || '')}" placeholder="Optional" /></div>
    ${fieldsHtml}
    <div class="form-actions">
      <button class="action-btn btn-ghost" onclick="window._closeProfModal()">Cancel</button>
      <button class="action-btn btn-primary" onclick="window._saveProfile(${profile?.id || 'null'})">${profile ? 'Save' : 'Create'}</button>
    </div>`);
  window._closeProfModal = closeModal;
};

window._saveProfile = async (id) => {
  const name = document.getElementById('prof-name')?.value.trim();
  if (!name) { toast('Name required', 'err'); return; }
  const description = document.getElementById('prof-desc')?.value.trim();
  const items = ITEM_TYPES.map(t => ({
    item_type: t.key,
    value: (document.getElementById(`prof-val-${t.key}`)?.value || '').trim(),
    enabled: !!document.getElementById(`prof-en-${t.key}`)?.checked,
  })).filter(it => it.value);
  const data = { name, description, items };
  try {
    if (id) await inv('update_profile', { id, data });
    else     await inv('add_profile', { data });
    closeModal(); toast(id ? 'Profile updated' : 'Profile created', 'ok'); _reload();
  } catch (e) { toast(String(e), 'err'); }
};
