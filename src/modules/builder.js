'use strict';
import { esc, toast, showOutput, goPane, openModal, closeModal } from '../app.js';

const inv = window.__TAURI__.core.invoke;

// ── State ────────────────────────────────────────────────────────────────────
let _cats = [];
let _presets = {};   // loaded from _meta.json via get_builder_actions
let _activeTab = null;
let _appsCat = null; // 08-apps.json data
let _appsSel = new Set(JSON.parse(localStorage.getItem('ctrl_builder_apps') || '[]'));
let _pkgMgr = localStorage.getItem('ctrl_builder_pkgmgr') || 'winget';

let _sel = new Set();
let _radio = {};

// Per-tab scroll position and open group state
const _tabScroll = {};
const _tabOpenGroups = {};

// Clear any stale selections from previous sessions
localStorage.removeItem('ctrl_builder_sel');
localStorage.removeItem('ctrl_builder_sel_radio');

function _save() { /* selections are session-only */ }

function _saveTabState() {
  if (!_activeTab) return;
  const el = document.getElementById('builder-toggles');
  if (!el) return;
  _tabScroll[_activeTab] = el.scrollTop;
  _tabOpenGroups[_activeTab] = new Set(
    [...el.querySelectorAll('details[open][data-key]')].map(d => d.dataset.key)
  );
}

function _restoreTabState(tabId) {
  const el = document.getElementById('builder-toggles');
  if (!el) return;
  const open = _tabOpenGroups[tabId];
  if (open) {
    el.querySelectorAll('details[data-key]').forEach(d => {
      d.open = open.has(d.dataset.key);
    });
  }
  if (_tabScroll[tabId] != null) el.scrollTop = _tabScroll[tabId];
}

// ── Icon helper — reads icon from JSON item, only used for group headers ──────
function _wsIcon(iconPath) {
  if (!iconPath) return '';
  return `<img class="ws-icon" src="assets/ws-icons/${iconPath}" alt="" />`;
}

// ── Load ─────────────────────────────────────────────────────────────────────
document.getElementById('builder-source-pill')?.addEventListener('click', () =>
  inv('open_path', { path: 'https://github.com/flick9000/winscript' }));
document.getElementById('bab-github')?.addEventListener('click', () =>
  inv('open_path', { path: 'https://github.com/flick9000/winscript' }));
document.getElementById('bab-kofi')?.addEventListener('click', () =>
  inv('open_path', { path: 'https://ko-fi.com/flick9000' }));
document.getElementById('builder-about-tab')?.addEventListener('click', () => _setTab('__about__'));

export async function load() {
  try {
    const r = await inv('get_builder_actions');
    _presets = r.presets || {};
    // Split out apps tab (08-apps.json id='apps') from script categories
    const all = r.categories || [];
    _appsCat = all.find(c => c.id === 'apps') || null;
    _cats = all.filter(c => c.id !== 'apps');
  } catch (e) {
    _cats = [];
    console.error('builder load', e);
  }
  _renderNav();
  const first = _activeTab || _cats[0]?.id;
  if (first) _setTab(first);
  else _updateBadge();
}

// ── Nav ──────────────────────────────────────────────────────────────────────
function _renderNav() {
  const el = document.getElementById('builder-nav-items');
  if (!_cats.length) {
    el.innerHTML = `<div class="bnav-empty">No actions found.<br>Run:<br>
      <code>node tools/winscript-converter.js</code></div>`;
    return;
  }
  const catHtml = _cats.map(cat => {
    const n = _countSelected(cat.items || []);
    return `<button class="bnav-item${_activeTab === cat.id ? ' active' : ''}" data-tab="${cat.id}">
      <i class="ti ${cat.icon || 'ti-adjustments'}"></i>
      <span class="bnav-label">${esc(cat.label)}</span>
      ${n > 0 ? `<span class="bnav-count">${n}</span>` : ''}
    </button>`;
  }).join('');

  const appsHtml = _appsCat ? `<button class="bnav-item${_activeTab === 'apps' ? ' active' : ''}" data-tab="apps">
    <i class="ti ti-package"></i>
    <span class="bnav-label">App Install</span>
    ${_appsSel.size > 0 ? `<span class="bnav-count">${_appsSel.size}</span>` : ''}
  </button>` : '';

  el.innerHTML = catHtml + appsHtml;
  el.querySelectorAll('[data-tab]').forEach(btn =>
    btn.addEventListener('click', () => _setTab(btn.dataset.tab)));
}

function _countSelected(items) {
  let n = 0;
  for (const item of items) {
    if (item.type === 'toggle') { if (_sel.has(item.id)) n++; }
    else if (item.type === 'group') n += (item.items || []).filter(s => _sel.has(s.id)).length;
    else if (item.type === 'radio') { if (_radio[item.group]) n++; }
  }
  return n;
}

// ── Tab switch ───────────────────────────────────────────────────────────────
function _setTab(tabId) {
  _saveTabState();
  _activeTab = tabId;
  const togglesEl = document.getElementById('builder-toggles');
  const scriptEl = document.getElementById('builder-script-view');
  const aboutEl = document.getElementById('builder-about-view');
  const catHdr = document.getElementById('builder-cat-header');

  document.getElementById('builder-about-tab')?.classList.toggle('active', tabId === '__about__');

  if (tabId === '__run__') {
    togglesEl.style.display = 'none';
    catHdr.style.display = 'none';
    aboutEl.classList.remove('active');
    scriptEl.classList.add('active');
    _rebuildPreview();
  } else if (tabId === '__about__') {
    togglesEl.style.display = 'none';
    catHdr.style.display = 'none';
    scriptEl.classList.remove('active');
    aboutEl.classList.add('active');
  } else {
    togglesEl.style.display = '';
    catHdr.style.display = '';
    scriptEl.classList.remove('active');
    aboutEl.classList.remove('active');

    if (tabId === 'apps' && _appsCat) {
      document.getElementById('builder-cat-title').textContent = _appsCat.label;
      _renderAppsUI(togglesEl);
    } else {
      const cat = _cats.find(c => c.id === tabId);
      if (cat) {
        document.getElementById('builder-cat-title').textContent = cat.label;
        _renderItems(cat.items || []);
      }
    }
    _restoreTabState(tabId);
  }
  _renderNav();
  _updateBadge();
}

// ── Render items ──────────────────────────────────────────────────────────────
function _renderItems(items) {
  const el = document.getElementById('builder-toggles');

  // Apps tab — completely different UI
  const appsItems = items.filter(i => i._appsTab);
  if (appsItems.length || (items.length === 0 && _activeTab === 'apps')) {
    _renderAppsUI(el);
    return;
  }

  el.innerHTML = items.map(item => {
    if (item.type === 'group') return _renderGroup(item);
    if (item.type === 'radio') return _renderRadioGroup(item);
    if (item.type === 'toggle') return _renderToggle(item);
    if (item.type === 'shortcut') return _renderShortcut(item);
    return '';
  }).join('');

  el.querySelectorAll('.shortcut-open-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      inv('launch_shortcut', { cmd: btn.dataset.cmd }).catch(e => toast(String(e), 'err'));
    });
  });

  // Click anywhere on the row to toggle — skip if the actual input/button/label was clicked
  el.querySelectorAll('.ws-entry:not(.ws-group-hdr):not(.ws-radio-none)').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('input, button, label, a')) return;
      row.querySelector('input')?.click();
    });
  });

  el.querySelectorAll('input[type="checkbox"][data-id]').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) _sel.add(cb.dataset.id);
      else _sel.delete(cb.dataset.id);
      _save();
      _syncGroupBadge(cb);
      _updateNavBadge(_activeTab);
      _updateBadge();
    });
  });

  el.querySelectorAll('input[type="radio"][data-id]').forEach(rb => {
    rb.addEventListener('change', () => {
      if (rb.checked) _radio[rb.name] = rb.dataset.id;
      _save();
      _updateNavBadge(_activeTab);
      _updateBadge();
      const group = rb.closest('details.ws-group');
      if (group) _syncRadioBadge(group);
    });
  });

  el.querySelectorAll('.radio-none-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.dataset.group;
      delete _radio[group];
      _save();
      el.querySelectorAll(`input[type="radio"][name="${group}"]`).forEach(r => { r.checked = false; });
      const grpEl = btn.closest('details.ws-group');
      if (grpEl) _syncRadioBadge(grpEl);
      _updateNavBadge(_activeTab);
      _updateBadge();
    });
  });
}

// ── Apps UI (08-apps.json) — uses ws-group/ws-sub pattern like other builder tabs ─────
function _renderAppsUI(el) {
  if (!_appsCat) { el.innerHTML = ''; return; }

  const mgrs = [
    { id: 'winget', label: 'winget', icon: 'ti-brand-windows' },
    { id: 'choco', label: 'Chocolatey', icon: 'ti-brand-chocolatey' },
  ];
  let html = `<div class="apps-toolbar">
    <span class="apps-mgr-label">Package manager:</span>
    ${mgrs.map(m => `<button class="apps-mgr-btn${_pkgMgr === m.id ? ' active' : ''}" data-mgr="${m.id}">
      <i class="ti ${m.icon}"></i> ${m.label}
    </button>`).join('')}
    <span style="flex:1"></span>
    <button class="action-btn btn-ghost apps-clear" style="font-size:10px;padding:3px 8px"><i class="ti ti-x"></i> Clear</button>
  </div>`;
  html += `<div style="padding:0 12px 8px"><input class="pane-search apps-filter" style="width:100%" placeholder="Filter apps…" autocomplete="off" /></div>`;

  // Each category → ws-group (collapsible), each app → ws-sub row with checkbox + pkg id
  for (const cat of (_appsCat.categories || [])) {
    const apps = cat.apps.filter(a => _pkgMgr === 'winget' ? a.winget : a.choco);
    if (!apps.length) continue;
    const selCount = apps.filter(a => _appsSel.has(a.id)).length;
    html += `<details class="ws-group apps-group" data-cat="${esc(cat.label)}" data-key="${esc(cat.label)}">
      <summary class="ws-entry ws-group-hdr">
        <div class="ws-entry-info">
          <div class="ws-entry-text"><h1>${esc(cat.label)}</h1><p>${apps.length} apps</p></div>
        </div>
        <div class="ws-chevron-wrap">
          <span class="ws-sel-count">${selCount > 0 ? `${selCount}/${apps.length}` : ''}</span>
          <i class="ti ti-chevron-down ws-chevron"></i>
        </div>
      </summary>
      ${apps.map(a => {
      const pkg = _pkgMgr === 'winget' ? a.winget : a.choco;
      const checked = _appsSel.has(a.id);
      return `<div class="ws-entry ws-sub app-row${checked ? ' ws-sub-active' : ''}" data-cat="${esc(cat.label)}">
          <div class="ws-entry-info">
            <img class="app-icon" src="assets/app-icons/${esc(a.id)}.png" alt="" loading="lazy" onerror="this.style.display='none'">
            <div class="ws-entry-text">
              <h1>${esc(a.label)}</h1>
              ${pkg ? `<p class="apps-pkg-id">${esc(pkg)}</p>` : ''}
            </div>
          </div>
          <div class="ws-entry-ctrl">
            <span class="ws-indicator">${checked ? 'On' : 'Off'}</span>
            <label class="ws-switch">
              <input type="checkbox" class="app-cb" data-id="${esc(a.id)}" ${checked ? 'checked' : ''} />
              <span class="ws-slider"></span>
            </label>
          </div>
        </div>`;
    }).join('')}
    </details>`;
  }

  el.innerHTML = html;

  el.querySelectorAll('.app-row').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('input, button, label')) return;
      row.querySelector('input')?.click();
    });
  });

  el.querySelectorAll('.apps-mgr-btn').forEach(btn => btn.addEventListener('click', () => {
    _pkgMgr = btn.dataset.mgr;
    localStorage.setItem('ctrl_builder_pkgmgr', _pkgMgr);
    _renderAppsUI(el);
  }));

  let timer;
  el.querySelector('.apps-filter')?.addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => _applyAppsFilter(el, e.target.value.toLowerCase()), 100);
  });

  el.querySelector('.apps-clear')?.addEventListener('click', () => {
    _appsSel.clear();
    localStorage.setItem('ctrl_builder_apps', '[]');
    _renderAppsUI(el);
    _updateBadge();
  });

  el.querySelectorAll('.app-cb').forEach(cb => cb.addEventListener('change', () => {
    if (cb.checked) _appsSel.add(cb.dataset.id);
    else _appsSel.delete(cb.dataset.id);
    localStorage.setItem('ctrl_builder_apps', JSON.stringify([..._appsSel]));
    const row = cb.closest('.app-row');
    if (row) {
      row.classList.toggle('ws-sub-active', cb.checked);
      row.querySelector('.ws-indicator').textContent = cb.checked ? 'On' : 'Off';
      // Update category badge
      const grp = cb.closest('.apps-group');
      if (grp) {
        const cbs = [...grp.querySelectorAll('.app-cb')];
        const sel = cbs.filter(c => c.checked).length;
        const badge = grp.querySelector('summary .ws-sel-count');
        if (badge) badge.textContent = sel > 0 ? `${sel}/${cbs.length}` : '';
      }
    }
    _renderNav();
    _updateBadge();
  }));
}

function _applyAppsFilter(el, q) {
  el.querySelectorAll('.app-row').forEach(row => {
    const name = (row.querySelector('.ws-entry-text h1')?.textContent || '').toLowerCase();
    const pkg = (row.querySelector('.apps-pkg-id')?.textContent || '').toLowerCase();
    row.style.display = (!q || name.includes(q) || pkg.includes(q)) ? '' : 'none';
  });
  el.querySelectorAll('.apps-group').forEach(grp => {
    const any = [...grp.querySelectorAll('.app-row')].some(r => r.style.display !== 'none');
    grp.style.display = any ? '' : 'none';
    if (q) grp.open = any; // auto-open matching groups
  });
}

function _updateNavBadge(tabId) {
  const cat = _cats.find(c => c.id === tabId);
  if (!cat) return;
  const n = _countSelected(cat.items || []);
  const btn = document.querySelector(`#builder-nav-items [data-tab="${tabId}"]`);
  if (!btn) return;
  let badge = btn.querySelector('.bnav-count');
  if (n > 0) {
    if (!badge) { badge = document.createElement('span'); badge.className = 'bnav-count'; btn.appendChild(badge); }
    badge.textContent = n;
  } else {
    badge?.remove();
  }
}

function _syncGroupBadge(cb) {
  const group = cb.closest('details.ws-group');
  if (!group) return;
  const cbs = [...group.querySelectorAll('input[type="checkbox"][data-id]')];
  const checked = cbs.filter(c => c.checked).length;
  const badge = group.querySelector('summary .ws-sel-count');
  if (badge) badge.textContent = checked > 0 ? `${checked}/${cbs.length}` : '';
}

function _syncRadioBadge(group) {
  const badge = group.querySelector('summary .ws-sel-count');
  const anyChecked = [...group.querySelectorAll('input[type="radio"]')].some(r => r.checked);
  if (badge) badge.textContent = anyChecked ? '1 set' : '';
}

// ── Entry HTML ────────────────────────────────────────────────────────────────

// Shortcut — launch button (doesn't add to script, runs immediately)
function _renderShortcut(item) {
  return `<div class="ws-entry ws-standalone ws-shortcut">
    <div class="ws-entry-info">
      <div class="ws-entry-text"><h1>${esc(item.label)}</h1></div>
    </div>
    <div class="ws-entry-ctrl">
      <button class="shortcut-open-btn" data-cmd="${esc(item.cmd)}">
        <i class="ti ti-external-link"></i> Open
      </button>
    </div>
  </div>`;
}

// Standalone toggle — shows its own icon if present
function _renderToggle(item) {
  const checked = _sel.has(item.id);
  return `<div class="ws-entry ws-standalone">
    <div class="ws-entry-info">
      ${_wsIcon(item.icon)}
      <div class="ws-entry-text">
        <h1>${esc(item.label)}</h1>
        ${item.desc ? `<p>${esc(item.desc)}</p>` : ''}
      </div>
    </div>
    <div class="ws-entry-ctrl">
      <span class="ws-indicator">${checked ? 'On' : 'Off'}</span>
      <label class="ws-switch">
        <input type="checkbox" data-id="${esc(item.id)}" ${checked ? 'checked' : ''} />
        <span class="ws-slider"></span>
      </label>
    </div>
  </div>`;
}

// Sub-item inside group — NO icon (WinScript convention: only group headers have icons)
function _renderSubItem(item) {
  const checked = _sel.has(item.id);
  return `<div class="ws-entry ws-sub">
    <div class="ws-entry-info">
      <div class="ws-entry-text">
        <h1>${esc(item.label)}</h1>
        ${item.desc ? `<p>${esc(item.desc)}</p>` : ''}
      </div>
    </div>
    <div class="ws-entry-ctrl">
      <span class="ws-indicator">${checked ? 'On' : 'Off'}</span>
      <label class="ws-switch">
        <input type="checkbox" data-id="${esc(item.id)}" ${checked ? 'checked' : ''} />
        <span class="ws-slider"></span>
      </label>
    </div>
  </div>`;
}

function _renderGroup(item) {
  const subIds = (item.items || []).map(s => s.id);
  const selCount = subIds.filter(id => _sel.has(id)).length;
  return `<details class="ws-group" data-key="${esc(item.label)}">
    <summary class="ws-entry ws-group-hdr">
      <div class="ws-entry-info">
        ${_wsIcon(item.icon)}
        <div class="ws-entry-text">
          <h1>${esc(item.label)}</h1>
          ${item.desc ? `<p>${esc(item.desc)}</p>` : ''}
        </div>
      </div>
      <div class="ws-chevron-wrap">
        <span class="ws-sel-count">${selCount > 0 ? `${selCount}/${subIds.length}` : ''}</span>
        <i class="ti ti-chevron-down ws-chevron"></i>
      </div>
    </summary>
    ${(item.items || []).map(s => _renderSubItem(s)).join('')}
  </details>`;
}

// Radio sub-item — circle dot, no icon
function _renderRadioSub(sub, groupName, chosen) {
  const checked = chosen === sub.id;
  return `<div class="ws-entry ws-sub">
    <div class="ws-entry-info">
      <div class="ws-entry-text">
        <h1>${esc(sub.label)}</h1>
        ${sub.desc ? `<p>${esc(sub.desc)}</p>` : ''}
      </div>
    </div>
    <div class="ws-entry-ctrl">
      <label class="ws-radio-label">
        <input type="radio" name="${esc(groupName)}" data-id="${esc(sub.id)}" ${checked ? 'checked' : ''} />
        <span class="ws-dot"></span>
      </label>
    </div>
  </div>`;
}

function _renderRadioGroup(item) {
  const chosen = _radio[item.group] || null;
  return `<details class="ws-group" data-key="${esc(item.label)}">
    <summary class="ws-entry ws-group-hdr">
      <div class="ws-entry-info">
        ${_wsIcon(item.icon)}
        <div class="ws-entry-text">
          <h1>${esc(item.label)}</h1>
          ${item.desc ? `<p>${esc(item.desc)}</p>` : ''}
        </div>
      </div>
      <div class="ws-chevron-wrap">
        <span class="ws-sel-count">${chosen ? '1 set' : ''}</span>
        <i class="ti ti-chevron-down ws-chevron"></i>
      </div>
    </summary>
    <div class="ws-entry ws-sub ws-radio-none">
      <div class="ws-entry-info"><div class="ws-entry-text"><h1>None</h1><p>Clear this selection</p></div></div>
      <div class="ws-entry-ctrl">
        <button class="radio-none-btn" data-group="${esc(item.group)}">✕ Clear</button>
      </div>
    </div>
    ${(item.items || []).map(sub => _renderRadioSub(sub, item.group, chosen)).join('')}
  </details>`;
}

// ── Badge / count ─────────────────────────────────────────────────────────────
function _updateBadge() {
  const n = _sel.size + Object.keys(_radio).length + _appsSel.size;
  const badge = document.getElementById('builder-sel-badge');
  const chip = document.getElementById('builder-sel-chip');
  const count = document.getElementById('sel-count');
  if (badge) { badge.textContent = n || ''; badge.style.display = n > 0 ? '' : 'none'; }
  if (chip) { chip.textContent = n + ' selected'; chip.classList.toggle('has-sel', n > 0); }
  if (count) count.textContent = n + ' selected';
}

// ── Script preview ────────────────────────────────────────────────────────────
async function _rebuildPreview() {
  _updateBadge();
  const codeEl = document.getElementById('builder-code');
  try {
    const allIds = [..._sel, ...Object.values(_radio)];
    const code = await inv('build_script', { actionIds: allIds, outputType: 'ps1' });

    // Build app install block if any apps selected
    let appsBlock = '';
    if (_appsSel.size > 0 && _appsCat) {
      const pkgs = [];
      for (const cat of (_appsCat.categories || [])) {
        for (const a of cat.apps) {
          if (!_appsSel.has(a.id)) continue;
          const pkg = _pkgMgr === 'winget' ? a.winget : a.choco;
          if (pkg) pkgs.push(pkg);
        }
      }

      if (pkgs.length) {
        // Build a PowerShell-safe list of single-quoted strings.
        // Example:
        // @('wingetui', 'google.chrome', '7zip.7zip')
        //
        // Any single quote inside a package name is doubled because that is
        // PowerShell's escape mechanism inside a single-quoted string.
        const pkgList = pkgs
          .map(p => `'${String(p).replace(/'/g, "''")}'`)
          .join(', ');

        const pkgNames = pkgs.join(', ');
        let setupBlock, installCmd;

        if (_pkgMgr === 'winget') {
          setupBlock = `Write-Host "-- Updating Winget" -ForegroundColor Green
$v = winget -v
if ([version]($v.TrimStart('v')) -lt [version]'1.7.0') {
    Write-Output '-- Old Winget version detected, upgrading.'
    Set-Location $env:USERPROFILE
    Invoke-WebRequest -Uri 'https://aka.ms/getwinget' -OutFile 'winget.msixbundle'
    Add-AppPackage -ForceApplicationShutdown .\\winget.msixbundle
    Remove-Item .\\winget.msixbundle
} else {
    Write-Output 'Winget is already up to date, skipping upgrade.'
}
winget settings --enable BypassCertificatePinningForMicrosoftStore`;

          // Run Winget directly in the generated script.
          // The generated script is already running elevated, so there is
          // no need to spawn a second PowerShell process.
          installCmd = `$apps = @(${pkgList})
foreach ($app in $apps) {
    Write-Host "Installing $app..." -ForegroundColor Cyan
    & winget install $app --accept-source-agreements --accept-package-agreements --force
}`;

        } else {
          setupBlock = `Write-Host "-- Installing Chocolatey" -ForegroundColor Green
if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1')) *> $null
}

# Refresh PATH after Chocolatey installation
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")`;

          // Run Chocolatey directly in the generated script.
          // This avoids the nested PowerShell quoting problem completely.
          installCmd = `$apps = @(${pkgList})
foreach ($app in $apps) {
    Write-Host "Installing $app..." -ForegroundColor Cyan
    & choco install $app -y --force --ignorepackageexitcodes
}`;
        }

        appsBlock = `\n# ── Package Manager Setup ─────────────────────────────────────────────────────
${setupBlock}

# ── App Installs ──────────────────────────────────────────────────────────────
Write-Host "-- Installing these apps: " -ForegroundColor Green
Write-Host "-- ${pkgNames}"

${installCmd};
`;

      }
    }

    // Insert apps block before the footer
    const footerMarker = '# ── Finalise';
    const footerIdx = code.indexOf(footerMarker);
    const finalCode = footerIdx >= 0
      ? code.slice(0, footerIdx) + appsBlock + '\n' + code.slice(footerIdx)
      : code + appsBlock;

    codeEl.innerHTML = _highlight(finalCode);
  } catch (e) {
    toast(String(e), 'err');
  }
}

function _highlight(code) {
  return esc(code)
    .replace(/(#[^\n]*)/g, '<span class="ps-comment">$1</span>')
    .replace(/(\$\w+)/g, '<span class="ps-var">$1</span>')
    .replace(/'([^']*)'/g, "<span class=\"ps-str\">'$1'</span>");
}

// ── Presets ───────────────────────────────────────────────────────────────────
function _applyPreset(key) {
  const ids = _presets[key];
  if (!ids || !ids.length) { toast('Preset not loaded', 'err'); return; }
  _sel.clear();
  _radio = {};
  for (const id of ids) _sel.add(id);
  _save();
  _renderNav();
  _updateBadge();
  toast(`${ key.charAt(0).toUpperCase() + key.slice(1) } preset — ${ _sel.size } actions selected`, 'ok');
  // Navigate to run tab to show the generated script immediately
  _setTab('__run__');
}

// ── Wire toolbar ──────────────────────────────────────────────────────────────
document.getElementById('builder-run-tab').addEventListener('click', () => _setTab('__run__'));

function _clearAll() {
  _sel.clear(); _radio = {}; _save();
  _appsSel.clear(); localStorage.setItem('ctrl_builder_apps', '[]');
  if (_activeTab === 'apps') {
    const el = document.getElementById('builder-toggles');
    if (el) _renderAppsUI(el);
  } else if (_activeTab && _activeTab !== '__run__') {
    const cat = _cats.find(c => c.id === _activeTab);
    if (cat) _renderItems(cat.items || []);
  }
  _renderNav(); _updateBadge();
  if (_activeTab === '__run__') _rebuildPreview();
}

document.getElementById('builder-clear').addEventListener('click', _clearAll);
document.getElementById('builder-clear-tab').addEventListener('click', _clearAll);

document.getElementById('builder-copy').addEventListener('click', async () => {
  const raw = document.getElementById('builder-code').textContent;
  if (!raw.trim()) { toast('Nothing to copy', 'err'); return; }
  try { await navigator.clipboard.writeText(raw); toast('Copied', 'ok'); }
  catch { toast('Copy failed', 'err'); }
});

document.getElementById('builder-save').addEventListener('click', async () => {
  const raw = document.getElementById('builder-code').textContent;
  const name = document.getElementById('save-name').value.trim();
  if (!raw.trim()) { toast('Nothing to save', 'err'); return; }
  if (!name) { toast('Enter a script name', 'err'); document.getElementById('save-name').focus(); return; }

  const { profiles } = await inv('ss_get_state', { profileId: null }).catch(() => ({ profiles: [] }));
  openModal('Save to Profiles', `
<p class="modal-confirm-msg">Save "<strong>${esc(name)}</strong>" into:</p>
<div class="form-row">
  <label style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border2);cursor:pointer;">
    <input type="checkbox" class="bs-pp-cb" data-master="1" checked>
    <span style="flex:1;font-size:13px;">Master</span>
    <span style="font-size:11px;color:var(--text3);">default</span>
  </label>
  ${profiles.map(p => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border2);cursor:pointer;">
      <input type="checkbox" class="bs-pp-cb" data-pid="${p.id}">
      <span style="flex:1;font-size:13px;">${esc(p.name)}</span>
      <span style="font-size:11px;color:var(--text3);">${p.scriptCount} scripts</span>
    </label>`).join('')}
</div>
<p id="bs-warn" style="display:none;color:var(--red);font-size:11px;margin:0 0 8px">Must select at least one profile.</p>
<div class="form-actions">
  <button class="action-btn btn-ghost" id="bs-cancel">Cancel</button>
  <button class="action-btn btn-primary" id="bs-confirm">Save</button>
</div>`);

  document.getElementById('bs-cancel').onclick = () => closeModal();
  document.getElementById('bs-confirm').onclick = async () => {
    const checked = [...document.querySelectorAll('.bs-pp-cb:checked')];
    if (!checked.length) { document.getElementById('bs-warn').style.display = 'block'; return; }
    const inMaster = checked.some(cb => cb.dataset.master);
    const profileIds = checked.filter(cb => cb.dataset.pid).map(cb => parseInt(cb.dataset.pid));
    try {
      await inv('save_built_script', { code: raw, name, scriptType: 'ps1', profileIds, inMaster });
      closeModal();
      toast('Saved to Scripts', 'ok');
      document.getElementById('save-name').value = '';
      goPane('scripts');
    } catch (e) { toast(String(e), 'err'); }
  };
});

document.getElementById('builder-run').addEventListener('click', async () => {
  const raw = document.getElementById('builder-code').textContent;
  if (!raw.trim()) { toast('Nothing to run', 'err'); return; }
  toast('Running…', 'info');
  try {
    const r = await inv('run_built_script', { code: raw, scriptType: 'ps1' });
    showOutput(r.output, r.success);
    toast(r.success ? 'Done' : 'Script failed', r.success ? 'ok' : 'err');
  } catch (e) { toast(String(e), 'err'); }
});

document.querySelectorAll('[data-preset]').forEach(btn =>
  btn.addEventListener('click', () => _applyPreset(btn.dataset.preset)));

// Bakes the currently-built combined script into a Windows unattend.xml answer
// file (bypasses Win11 hardware checks, runs the script on first logon) —
// ported from WinScript's Autounattend button, same source text Copy/Save/Run use.
document.getElementById('builder-autounattend').addEventListener('click', async () => {
  const raw = document.getElementById('builder-code').textContent;
  if (!raw.trim()) { toast('Nothing to bake — select some actions first', 'err'); return; }
  const ok = await inv('export_autounattend', { script: raw }).catch(e => { toast(String(e), 'err'); return false; });
  if (ok) toast('autounattend.xml saved', 'ok');
});
