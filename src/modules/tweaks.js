import { esc, sectionHdr, paneHeader, toast, showOutput, openModal, closeModal, confirmDialog } from '../app.js';

const inv = window.__TAURI__.core.invoke;
const LS_KEY = 'ctrl_tweaks_applied';

// Built-in Windows tweaks. Each tweak has apply/revert PowerShell commands.
// admin:true = requires elevated PowerShell (HKLM writes, powercfg, netsh etc.)
const TWEAKS = [
  {
    category: 'Privacy', items: [
      { id: 'tel1', admin: true,  label: 'Disable Telemetry',
        desc: 'Stops Windows from sending usage data to Microsoft',
        apply:  'Set-ItemProperty -Path "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection" -Name AllowTelemetry -Value 0 -Type DWord -Force',
        revert: 'Remove-ItemProperty -Path "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection" -Name AllowTelemetry -ErrorAction SilentlyContinue' },
      { id: 'tel2', admin: true,  label: 'Disable Activity History',
        desc: 'Stops Windows tracking apps and files you open',
        apply:  'Set-ItemProperty -Path "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System" -Name EnableActivityFeed -Value 0 -Type DWord -Force',
        revert: 'Remove-ItemProperty -Path "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System" -Name EnableActivityFeed -ErrorAction SilentlyContinue' },
      { id: 'adid', admin: false, label: 'Disable Advertising ID',
        desc: 'Stops apps from using your advertising ID for personalised ads',
        apply:  'Set-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo" -Name Enabled -Value 0 -Type DWord -Force',
        revert: 'Set-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo" -Name Enabled -Value 1 -Type DWord -Force' },
      { id: 'loc',  admin: true,  label: 'Disable Location Tracking',
        desc: 'Denies location access system-wide',
        apply:  'Set-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\location" -Name Value -Value Deny',
        revert: 'Set-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\location" -Name Value -Value Allow' },
    ]
  },
  {
    category: 'Explorer & UI', items: [
      { id: 'ext',  admin: false, label: 'Show File Extensions',
        desc: 'Makes .exe, .txt, .ps1 etc. visible in Explorer',
        apply:  'Set-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" -Name HideFileExt -Value 0',
        revert: 'Set-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" -Name HideFileExt -Value 1' },
      { id: 'hid',  admin: false, label: 'Show Hidden Files',
        desc: 'Makes hidden files and folders visible in Explorer',
        apply:  'Set-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" -Name Hidden -Value 1',
        revert: 'Set-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" -Name Hidden -Value 2' },
      { id: 'snap', admin: false, label: 'Disable Snap Assist',
        desc: 'Turns off window layout suggestions when dragging',
        apply:  'Set-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" -Name SnapAssist -Value 0',
        revert: 'Set-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" -Name SnapAssist -Value 1' },
      { id: 'scrl', admin: false, label: 'Always Show Scrollbars',
        desc: 'Keeps scrollbars visible instead of auto-hiding',
        apply:  'Set-ItemProperty -Path "HKCU:\\Control Panel\\Accessibility" -Name DynamicScrollbars -Value 0',
        revert: 'Set-ItemProperty -Path "HKCU:\\Control Panel\\Accessibility" -Name DynamicScrollbars -Value 1' },
      { id: 'nlock', admin: false, label: 'Enable NumLock on Startup',
        desc: 'NumLock will be on when Windows starts',
        apply:  'Set-ItemProperty -Path "HKCU:\\Control Panel\\Keyboard" -Name InitialKeyboardIndicators -Value 2',
        revert: 'Set-ItemProperty -Path "HKCU:\\Control Panel\\Keyboard" -Name InitialKeyboardIndicators -Value 0' },
      { id: 'cort', admin: true,  label: 'Disable Cortana',
        desc: 'Completely disables Cortana search integration',
        apply:  'New-Item -Path "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search" -Force | Out-Null; Set-ItemProperty -Path "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search" -Name AllowCortana -Value 0 -Type DWord -Force',
        revert: 'Remove-ItemProperty -Path "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search" -Name AllowCortana -ErrorAction SilentlyContinue' },
    ]
  },
  {
    category: 'Performance', items: [
      { id: 'pwr',  admin: true,  label: 'Set High Performance Power Plan',
        desc: 'Max CPU speed — uses more power, great for desktops',
        apply:  'powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c',
        revert: 'powercfg /setactive 381b4222-f694-41f0-9685-ff5bb260df2e' },
      { id: 'hib',  admin: true,  label: 'Disable Hibernation',
        desc: 'Removes hiberfil.sys and frees several GB of disk space',
        apply:  'powercfg /h off',
        revert: 'powercfg /h on' },
      { id: 'pfx',  admin: true,  label: 'Disable Prefetch / Superfetch',
        desc: 'Can improve SSD longevity by reducing unnecessary writes',
        apply:  'Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\\PrefetchParameters" -Name EnablePrefetcher -Value 0; Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\\PrefetchParameters" -Name EnableSuperfetch -Value 0',
        revert: 'Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\\PrefetchParameters" -Name EnablePrefetcher -Value 3; Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\\PrefetchParameters" -Name EnableSuperfetch -Value 3' },
    ]
  },
  {
    category: 'Network', items: [
      { id: 'dns',  admin: true,  label: 'Flush DNS Cache',
        desc: 'Clears the DNS resolver cache — fixes stale domain lookups',
        apply:  'ipconfig /flushdns',
        revert: 'ipconfig /flushdns' },
      { id: 'net',  admin: true,  label: 'Reset Network Stack',
        desc: 'Resets TCP/IP and Winsock — fixes persistent connection issues (restart recommended)',
        apply:  'netsh int ip reset; netsh winsock reset',
        revert: 'netsh int ip reset; netsh winsock reset' },
      { id: 'ipv6', admin: true,  label: 'Disable IPv6',
        desc: 'Disables IPv6 on all adapters — can fix some VPN and tunnel issues',
        apply:  'Get-NetAdapter | Disable-NetAdapterBinding -ComponentID ms_tcpip6 -ErrorAction SilentlyContinue',
        revert: 'Get-NetAdapter | Enable-NetAdapterBinding -ComponentID ms_tcpip6 -ErrorAction SilentlyContinue' },
    ]
  },
  {
    category: 'Windows Update', items: [
      { id: 'wuno', admin: true,  label: 'Disable Auto-Restart After Update',
        desc: "Windows won't restart without your permission",
        apply:  'New-Item -Path "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU" -Force | Out-Null; Set-ItemProperty -Path "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU" -Name NoAutoRebootWithLoggedOnUsers -Value 1 -Type DWord -Force',
        revert: 'Remove-ItemProperty -Path "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU" -Name NoAutoRebootWithLoggedOnUsers -ErrorAction SilentlyContinue' },
      { id: 'wupause', admin: true, label: 'Pause Updates (7 days)',
        desc: 'Pauses Windows Update for 7 days from today',
        apply:  `$now = Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ'; $end = (Get-Date).AddDays(7).ToString('yyyy-MM-ddTHH:mm:ssZ'); Set-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings" -Name PauseUpdatesStartTime -Value $now; Set-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings" -Name PauseUpdatesExpiryTime -Value $end`,
        revert: 'Remove-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings" -Name PauseUpdatesStartTime -ErrorAction SilentlyContinue; Remove-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings" -Name PauseUpdatesExpiryTime -ErrorAction SilentlyContinue' },
    ]
  },
];

// Applied-state helpers (localStorage)
function _getApplied() {
  try { return new Set(JSON.parse(localStorage.getItem(LS_KEY) || '[]')); } catch { return new Set(); }
}
function _setApplied(set) {
  localStorage.setItem(LS_KEY, JSON.stringify([...set]));
}

let _customTweaks = [];

export async function load() {
  const noteArea = document.getElementById('tweaks-note-area');
  if (noteArea) noteArea.innerHTML = `<div class="tweaks-note"><i class="ti ti-shield-lock"></i> Tweaks marked <span class="badge-admin" style="vertical-align:middle"><i class="ti ti-shield"></i> admin</span> require CTRL to be run as Administrator.</div>`;
  const el = document.getElementById('tweaks-scroll');
  el.innerHTML = paneHeader('ti-adjustments', 'System Tweaks', 'Custom Tweak', 'window._showCustomTweakModal(null)', 'tweaks-filter')
    + `<div id="tweaks-body"></div>`;

  setTimeout(() => {
    const f = document.getElementById('tweaks-filter');
    if (f) f.addEventListener('input', () => _render(f.value.toLowerCase().trim()));
  }, 0);

  _customTweaks = await inv('get_custom_tweaks').catch(() => []);
  _render('');
}

function _tweakRow(t, isApplied, isCustom = false) {
  const adminBadge = t.admin ? '<span class="badge-admin" title="Requires administrator"><i class="ti ti-shield"></i> admin</span>' : '';
  const editBtns = isCustom ? `
    <button class="icon-btn" title="Edit" data-cedit="${t.id}" style="padding:2px 4px;font-size:11px"><i class="ti ti-pencil"></i></button>
    <button class="icon-btn del" title="Delete" data-cdel="${t.id}" style="padding:2px 4px;font-size:11px"><i class="ti ti-trash"></i></button>` : '';
  const applyCmd = isCustom ? t.apply_cmd : t.apply;
  const revertCmd = isCustom ? t.revert_cmd : t.revert;
  const desc = isCustom ? t.description : t.desc;
  return `<div class="tweak-row${isApplied ? ' tweak-applied' : ''}">
    <div class="tweak-info">
      <div class="tweak-label" style="display:flex;align-items:center;gap:6px">${esc(t.label)}${adminBadge}${isApplied ? '<span class="tweak-applied-dot" title="Applied"></span>' : ''}${editBtns}</div>
      <div class="tweak-desc">${esc(desc)}</div>
    </div>
    <div class="tweak-btns">
      <button class="tweak-btn apply${isApplied ? ' tweak-btn-active' : ''}" data-id="${t.id}" data-action="apply" data-cmd="${esc(applyCmd)}" data-admin="${t.admin ? '1' : '0'}">${isApplied ? '✓ Applied' : 'Apply'}</button>
      ${revertCmd ? `<button class="tweak-btn revert" data-id="${t.id}" data-action="revert" data-cmd="${esc(revertCmd)}" data-admin="${t.admin ? '1' : '0'}">Revert</button>` : ''}
    </div>
  </div>`;
}

function _render(q) {
  const body = document.getElementById('tweaks-body');
  if (!body) return;
  const applied = _getApplied();
  let html = '';
  let total = 0;

  // Built-in tweaks
  for (const group of TWEAKS) {
    const items = q
      ? group.items.filter(t => t.label.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q) || group.category.toLowerCase().includes(q))
      : group.items;
    if (!items.length) continue;
    total += items.length;
    html += sectionHdr(group.category, items.length) + '<div class="tweaks-list">';
    for (const t of items) html += _tweakRow(t, applied.has(t.id), false);
    html += '</div>';
  }

  // Custom tweaks from DB
  const customFiltered = q
    ? _customTweaks.filter(t => t.label.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.category.toLowerCase().includes(q))
    : _customTweaks;
  if (customFiltered.length) {
    total += customFiltered.length;
    // Group by category
    const groups = {};
    for (const t of customFiltered) (groups[t.category] ??= []).push(t);
    for (const [cat, items] of Object.entries(groups)) {
      html += sectionHdr(cat, items.length) + '<div class="tweaks-list">';
      for (const t of items) html += _tweakRow(t, applied.has('c' + t.id), true);
      html += '</div>';
    }
  }

  if (!total) html = `<div class="empty-state" style="padding-top:40px"><i class="ti ti-search"></i><p>No tweaks match "${esc(q)}"</p></div>`;
  body.innerHTML = html;

  body.querySelectorAll('.tweak-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cmd   = btn.getAttribute('data-cmd');
      const id    = btn.getAttribute('data-id');
      const action = btn.getAttribute('data-action');
      const admin = btn.getAttribute('data-admin') === '1';
      const orig = btn.textContent;
      btn.disabled = true; btn.textContent = '…';
      try {
        const r = await inv('run_tweak_cmd', { cmd, admin });
        showOutput(r.output || '(no output)', r.success);
        toast(r.success ? 'Done' : 'Command returned an error', r.success ? 'ok' : 'err');
        if (r.success) {
          const set = _getApplied();
          if (action === 'apply') set.add(id); else set.delete(id);
          _setApplied(set);
          const q = document.getElementById('tweaks-filter')?.value.toLowerCase().trim() || '';
          _render(q);
          return;
        }
      } catch (e) { toast(String(e), 'err'); }
      btn.disabled = false; btn.textContent = orig;
    });
  });

  body.querySelectorAll('[data-cedit]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); const t = _customTweaks.find(x => x.id === +btn.dataset.cedit); if (t) window._showCustomTweakModal(t); });
  });
  body.querySelectorAll('[data-cdel]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const ok = await confirmDialog('Delete this custom tweak?', true);
      if (!ok) return;
      await inv('delete_custom_tweak', { id: +btn.dataset.cdel });
      toast('Custom tweak deleted', 'info');
      _customTweaks = await inv('get_custom_tweaks').catch(() => []);
      const q = document.getElementById('tweaks-filter')?.value.toLowerCase().trim() || '';
      _render(q);
    });
  });
}

window._showCustomTweakModal = (t) => {
  window._closeCustomTweakModal = closeModal;
  openModal(t ? 'Edit Custom Tweak' : 'Add Custom Tweak', `
    <div class="form-row"><label class="form-label">Label</label><input class="form-input" id="ct-label" value="${esc(t?.label||'')}" placeholder="My Custom Tweak" /></div>
    <div class="form-row"><label class="form-label">Category</label><input class="form-input" id="ct-cat" value="${esc(t?.category||'Custom')}" placeholder="Custom" /></div>
    <div class="form-row"><label class="form-label">Description</label><input class="form-input" id="ct-desc" value="${esc(t?.description||'')}" placeholder="What this tweak does" /></div>
    <div class="form-row"><label class="form-label">Apply Command (PowerShell)</label><textarea class="form-textarea" id="ct-apply" rows="3" style="font-family:var(--mono);font-size:11px" placeholder="Set-ItemProperty ...">${esc(t?.apply_cmd||'')}</textarea></div>
    <div class="form-row"><label class="form-label">Revert Command <span style="font-size:10px;color:var(--text3);font-weight:400">optional</span></label><textarea class="form-textarea" id="ct-revert" rows="3" style="font-family:var(--mono);font-size:11px" placeholder="(leave blank if not reversible)">${esc(t?.revert_cmd||'')}</textarea></div>
    <div class="form-row" style="display:flex;align-items:center;gap:8px">
      <input type="checkbox" id="ct-admin" ${t?.admin ? 'checked' : ''} />
      <label for="ct-admin" class="form-label" style="margin:0;cursor:pointer"><i class="ti ti-shield" style="font-size:11px"></i> Requires Administrator</label>
    </div>
    <div class="form-actions">
      <button class="action-btn btn-ghost" onclick="window._closeCustomTweakModal()">Cancel</button>
      <button class="action-btn btn-primary" onclick="window._saveCustomTweak(${t?.id||'null'})">${t ? 'Save' : 'Add'}</button>
    </div>`);
};

window._saveCustomTweak = async (id) => {
  const data = {
    label:       document.getElementById('ct-label').value.trim(),
    category:    document.getElementById('ct-cat').value.trim() || 'Custom',
    description: document.getElementById('ct-desc').value.trim(),
    apply_cmd:   document.getElementById('ct-apply').value.trim(),
    revert_cmd:  document.getElementById('ct-revert').value.trim(),
    admin:       document.getElementById('ct-admin').checked,
  };
  if (!data.label || !data.apply_cmd) { toast('Label and Apply Command are required', 'err'); return; }
  try {
    if (id) await inv('update_custom_tweak', { id, data }); else await inv('add_custom_tweak', { data });
    closeModal(); toast(id ? 'Tweak updated' : 'Custom tweak added', 'ok');
    _customTweaks = await inv('get_custom_tweaks').catch(() => []);
    const q = document.getElementById('tweaks-filter')?.value.toLowerCase().trim() || '';
    _render(q);
  } catch (e) { toast(String(e), 'err'); }
};
