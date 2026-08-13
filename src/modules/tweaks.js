import { esc, sectionHdr, paneHeader, toast, showOutput } from '../app.js';

const inv = window.__TAURI__.core.invoke;

// Built-in Windows tweaks. Each tweak has apply/revert PowerShell commands.
// For one-shot ops (flush DNS, reset network), apply and revert are the same.
const TWEAKS = [
  {
    category: 'Privacy', items: [
      { id: 'tel1', label: 'Disable Telemetry',
        desc: 'Stops Windows from sending usage data to Microsoft',
        apply:  'Set-ItemProperty -Path "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection" -Name AllowTelemetry -Value 0 -Type DWord -Force',
        revert: 'Remove-ItemProperty -Path "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection" -Name AllowTelemetry -ErrorAction SilentlyContinue' },
      { id: 'tel2', label: 'Disable Activity History',
        desc: 'Stops Windows tracking apps and files you open',
        apply:  'Set-ItemProperty -Path "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System" -Name EnableActivityFeed -Value 0 -Type DWord -Force',
        revert: 'Remove-ItemProperty -Path "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System" -Name EnableActivityFeed -ErrorAction SilentlyContinue' },
      { id: 'adid', label: 'Disable Advertising ID',
        desc: 'Stops apps from using your advertising ID for personalised ads',
        apply:  'Set-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo" -Name Enabled -Value 0 -Type DWord -Force',
        revert: 'Set-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo" -Name Enabled -Value 1 -Type DWord -Force' },
      { id: 'loc',  label: 'Disable Location Tracking',
        desc: 'Denies location access system-wide',
        apply:  'Set-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\location" -Name Value -Value Deny',
        revert: 'Set-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\location" -Name Value -Value Allow' },
    ]
  },
  {
    category: 'Explorer & UI', items: [
      { id: 'ext',  label: 'Show File Extensions',
        desc: 'Makes .exe, .txt, .ps1 etc. visible in Explorer',
        apply:  'Set-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" -Name HideFileExt -Value 0',
        revert: 'Set-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" -Name HideFileExt -Value 1' },
      { id: 'hid',  label: 'Show Hidden Files',
        desc: 'Makes hidden files and folders visible in Explorer',
        apply:  'Set-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" -Name Hidden -Value 1',
        revert: 'Set-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" -Name Hidden -Value 2' },
      { id: 'snap', label: 'Disable Snap Assist',
        desc: 'Turns off window layout suggestions when dragging',
        apply:  'Set-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" -Name SnapAssist -Value 0',
        revert: 'Set-ItemProperty -Path "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" -Name SnapAssist -Value 1' },
      { id: 'scrl', label: 'Always Show Scrollbars',
        desc: 'Keeps scrollbars visible instead of auto-hiding',
        apply:  'Set-ItemProperty -Path "HKCU:\\Control Panel\\Accessibility" -Name DynamicScrollbars -Value 0',
        revert: 'Set-ItemProperty -Path "HKCU:\\Control Panel\\Accessibility" -Name DynamicScrollbars -Value 1' },
      { id: 'nlock','label': 'Enable NumLock on Startup',
        desc: 'NumLock will be on when Windows starts',
        apply:  'Set-ItemProperty -Path "HKCU:\\Control Panel\\Keyboard" -Name InitialKeyboardIndicators -Value 2',
        revert: 'Set-ItemProperty -Path "HKCU:\\Control Panel\\Keyboard" -Name InitialKeyboardIndicators -Value 0' },
      { id: 'cort', label: 'Disable Cortana',
        desc: 'Completely disables Cortana search integration',
        apply:  'New-Item -Path "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search" -Force | Out-Null; Set-ItemProperty -Path "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search" -Name AllowCortana -Value 0 -Type DWord -Force',
        revert: 'Remove-ItemProperty -Path "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search" -Name AllowCortana -ErrorAction SilentlyContinue' },
    ]
  },
  {
    category: 'Performance', items: [
      { id: 'pwr',  label: 'Set High Performance Power Plan',
        desc: 'Max CPU speed — uses more power, great for desktops',
        apply:  'powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c',
        revert: 'powercfg /setactive 381b4222-f694-41f0-9685-ff5bb260df2e' },
      { id: 'hib',  label: 'Disable Hibernation',
        desc: 'Removes hiberfil.sys and frees several GB of disk space',
        apply:  'powercfg /h off',
        revert: 'powercfg /h on' },
      { id: 'pfx',  label: 'Disable Prefetch / Superfetch',
        desc: 'Can improve SSD longevity by reducing unnecessary writes',
        apply:  'Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\\PrefetchParameters" -Name EnablePrefetcher -Value 0; Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\\PrefetchParameters" -Name EnableSuperfetch -Value 0',
        revert: 'Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\\PrefetchParameters" -Name EnablePrefetcher -Value 3; Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\\PrefetchParameters" -Name EnableSuperfetch -Value 3' },
    ]
  },
  {
    category: 'Network', items: [
      { id: 'dns',  label: 'Flush DNS Cache',
        desc: 'Clears the DNS resolver cache — fixes stale domain lookups',
        apply:  'ipconfig /flushdns',
        revert: 'ipconfig /flushdns' },
      { id: 'net',  label: 'Reset Network Stack',
        desc: 'Resets TCP/IP and Winsock — fixes persistent connection issues (restart recommended)',
        apply:  'netsh int ip reset; netsh winsock reset',
        revert: 'netsh int ip reset; netsh winsock reset' },
      { id: 'ipv6', label: 'Disable IPv6',
        desc: 'Disables IPv6 on all adapters — can fix some VPN and tunnel issues',
        apply:  'Get-NetAdapter | Disable-NetAdapterBinding -ComponentID ms_tcpip6 -ErrorAction SilentlyContinue',
        revert: 'Get-NetAdapter | Enable-NetAdapterBinding -ComponentID ms_tcpip6 -ErrorAction SilentlyContinue' },
    ]
  },
  {
    category: 'Windows Update', items: [
      { id: 'wuno', label: 'Disable Auto-Restart After Update',
        desc: "Windows won't restart without your permission",
        apply:  'New-Item -Path "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU" -Force | Out-Null; Set-ItemProperty -Path "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU" -Name NoAutoRebootWithLoggedOnUsers -Value 1 -Type DWord -Force',
        revert: 'Remove-ItemProperty -Path "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU" -Name NoAutoRebootWithLoggedOnUsers -ErrorAction SilentlyContinue' },
      { id: 'wupause', label: 'Pause Updates (7 days)',
        desc: 'Pauses Windows Update for 7 days from today',
        apply:  `$now = Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ'; $end = (Get-Date).AddDays(7).ToString('yyyy-MM-ddTHH:mm:ssZ'); Set-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings" -Name PauseUpdatesStartTime -Value $now; Set-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings" -Name PauseUpdatesExpiryTime -Value $end`,
        revert: 'Remove-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings" -Name PauseUpdatesStartTime -ErrorAction SilentlyContinue; Remove-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings" -Name PauseUpdatesExpiryTime -ErrorAction SilentlyContinue' },
    ]
  },
];

export function load() {
  const el = document.getElementById('tweaks-scroll');
  el.innerHTML = paneHeader('ti-adjustments', 'System Tweaks', null, null, 'tweaks-filter')
    + `<div class="tweaks-note"><i class="ti ti-shield-lock"></i> Some tweaks require administrator privileges. Right-click CTRL → Run as administrator.</div>`
    + `<div id="tweaks-body"></div>`;

  setTimeout(() => {
    const f = document.getElementById('tweaks-filter');
    if (f) f.addEventListener('input', () => _render(f.value.toLowerCase().trim()));
  }, 0);

  _render('');
}

function _render(q) {
  const body = document.getElementById('tweaks-body');
  if (!body) return;
  let html = '';
  let total = 0;
  for (const group of TWEAKS) {
    const items = q
      ? group.items.filter(t => t.label.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q) || group.category.toLowerCase().includes(q))
      : group.items;
    if (!items.length) continue;
    total += items.length;
    html += sectionHdr(group.category, items.length) + '<div class="tweaks-list">';
    for (const t of items) {
      html += `<div class="tweak-row">
        <div class="tweak-info">
          <div class="tweak-label">${esc(t.label)}</div>
          <div class="tweak-desc">${esc(t.desc)}</div>
        </div>
        <div class="tweak-btns">
          <button class="tweak-btn apply" data-id="${t.id}" data-cmd="${esc(t.apply)}">Apply</button>
          <button class="tweak-btn revert" data-id="${t.id}" data-cmd="${esc(t.revert)}">Revert</button>
        </div>
      </div>`;
    }
    html += '</div>';
  }
  if (!total) html = `<div class="empty-state" style="padding-top:40px"><i class="ti ti-search"></i><p>No tweaks match "${esc(q)}"</p></div>`;
  body.innerHTML = html;

  body.querySelectorAll('.tweak-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cmd = btn.getAttribute('data-cmd');
      const orig = btn.textContent;
      btn.disabled = true; btn.textContent = '…';
      try {
        const r = await inv('run_tweak_cmd', { cmd });
        showOutput(r.output || '(no output)', r.success);
        toast(r.success ? 'Done' : 'Command returned an error', r.success ? 'ok' : 'err');
      } catch (e) { toast(String(e), 'err'); }
      btn.disabled = false; btn.textContent = orig;
    });
  });
}
