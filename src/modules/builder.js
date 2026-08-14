'use strict';
import { esc, toast, showOutput, goPane } from '../app.js';

const inv = window.__TAURI__.core.invoke;

// ── State ────────────────────────────────────────────────────────────────────
let _cats      = [];
let _activeTab = null;

const LS_KEY = 'ctrl_builder_sel';
let _sel   = new Set(JSON.parse(localStorage.getItem(LS_KEY)           || '[]'));
let _radio = JSON.parse(localStorage.getItem(LS_KEY + '_radio') || '{}');

function _save() {
  localStorage.setItem(LS_KEY,             JSON.stringify([..._sel]));
  localStorage.setItem(LS_KEY + '_radio',  JSON.stringify(_radio));
}

// ── WinScript presets (exact IDs from winscript/scripts.js) ──────────────────
const PRESETS = {
  basic: {
    label: 'Basic', ids: [
      'cleanmgr','cleantemp','sfc','consumerfeatures','recall','debloatedge',
      'taskbarwidgets','wpbt','diagaccess','aigenerationaccess','updatepause',
      'activityfeed','wtelemetry','wupdate','wsearchtelemetry','appexperience',
      'targetads','nvidiatelemetry','deliveryoptimization','ultimateperformance',
      'manualservices','mousedelay','endtask',
    ],
  },
  strict: {
    label: 'Strict', ids: [
      'cleanmgr','cleantemp','sfc','thirdparty','consumerfeatures','recall',
      'msstoreupdates','debloatedge','copilot','notepadrewrite','aiappxpackages',
      'hideai','aifiles','taskbarwidgets','accinfoaccess','contactsaccess',
      'callhistoryaccess','messagingaccess','emailaccess','tasksaccess','diagaccess',
      'phoneaccess','trustedaccess','calendaraccess','motionaccess','radioaccess',
      'recordingsaccess','screenshotborderaccess','aigenerationaccess','updatepause',
      'wpbt','bitlocker','cloudsync','activityfeed','screenrecording','automap',
      'wtelemetry','wupdate','wsearchtelemetry','officetelemetry','appexperience',
      'wfeedback','handwriting','windowsdrm','cloudbasedspeech','targetads',
      'nvidiatelemetry','powershelltelemetry','deliveryoptimization','ultimateperformance',
      'manualservices','hags','ipv6','mousedelay','limitdefender','disableprefetch',
      'faststartup','endtask','filextensions','hiddenfiles',
    ],
  },
  extreme: {
    label: 'Extreme', ids: [
      'cleanmgr','cleantemp','dism','sfc','resetnetwork','thirdparty','msapps',
      'xbox','consumerfeatures','recall','microsoftstore','msstoreupdates','onedrive',
      'debloatedge','copilot','notepadrewrite','aiappxpackages','hideai','aifiles',
      'taskbarwidgets','locationaccess','accinfoaccess','contactsaccess','callhistoryaccess',
      'messagingaccess','emailaccess','tasksaccess','diagaccess','voiceactivationaccess',
      'phoneaccess','trustedaccess','calendaraccess','motionaccess','radioaccess',
      'recordingsaccess','screenshotborderaccess','aigenerationaccess','updatepause',
      'wpbt','bitlocker','cloudsync','activityfeed','notificationtray','screenrecording',
      'automap','default0user','wtelemetry','wupdate','wsearchtelemetry','officetelemetry',
      'appexperience','wfeedback','handwriting','windowsdrm','cloudbasedspeech','targetads',
      'adobetelemetry','nvidiatelemetry','vscodetelemetry','mediatelemetry',
      'powershelltelemetry','ccleanertelemetry','googleupdates','adobeupdates',
      'deliveryoptimization','gamebar','ultimateperformance','manualservices','hags',
      'ipv6','mousedelay','limitdefender','coreisolation','disableprefetch','storagesense',
      'wsearch','faststartup','endtask','homegallery','filextensions','hiddenfiles','stickykeys',
    ],
  },
};

// ── WinScript icon lookup (ID → relative path under assets/ws-icons/) ────────
const WS_ICONS = {
  // tools
  cleanmgr: 'tools/clean.png', cleantemp: 'tools/clean.png', emptyrecycle: 'tools/clean.png',
  dism: 'tools/sfc.png', sfc: 'tools/sfc.png',
  browserhistory: 'tools/browser.png',
  resetnetwork: 'tools/network.png',
  restorepoint: 'tools/restore.png',
  shortcuts: 'tools/shortcuts.png',
  // debloat
  thirdparty: 'debloat/app.png', msapps: 'debloat/app.png',
  extensions: 'debloat/app.png', xbox: 'debloat/app.png',
  consumerfeatures: 'debloat/features.png', hyperv: 'debloat/features.png',
  iexplorer: 'debloat/features.png', faxscan: 'debloat/features.png',
  mediaplayer: 'debloat/features.png',
  hideai: 'debloat/copilot.png', aiappxpackages: 'debloat/copilot.png',
  copilot: 'debloat/copilot.png', recall: 'debloat/copilot.png',
  notepadrewrite: 'debloat/copilot.png', aifiles: 'debloat/copilot.png',
  microsoftstore: 'debloat/store.png',
  msstoreupdates: 'debloat/appupdates.png',
  onedrive: 'debloat/onedrive.png',
  debloatedge: 'debloat/debloat-edge.png', edge: 'debloat/edge.png',
  debloatbrave: 'debloat/debloat-edge.png',
  widgets: 'debloat/widgets.png', taskbarwidgets: 'debloat/taskbarwidgets.png',
  // privacy / app access
  locationaccess: 'privacy/appaccess.png', accinfoaccess: 'privacy/appaccess.png',
  contactsaccess: 'privacy/appaccess.png', callhistoryaccess: 'privacy/appaccess.png',
  messagingaccess: 'privacy/appaccess.png', emailaccess: 'privacy/appaccess.png',
  tasksaccess: 'privacy/appaccess.png', diagaccess: 'privacy/appaccess.png',
  voiceactivationaccess: 'privacy/appaccess.png', phoneaccess: 'privacy/appaccess.png',
  trustedaccess: 'privacy/appaccess.png', calendaraccess: 'privacy/appaccess.png',
  motionaccess: 'privacy/appaccess.png', radioaccess: 'privacy/appaccess.png',
  recordingsaccess: 'privacy/appaccess.png', screenshotborderaccess: 'privacy/appaccess.png',
  aigenerationaccess: 'privacy/appaccess.png',
  updatepause: 'privacy/updatepause.png',
  wpbt: 'privacy/wbpt.svg', bitlocker: 'privacy/bitlocker.svg',
  cloudsync: 'privacy/cloud.png', activityfeed: 'privacy/activity.png',
  notificationtray: 'privacy/notifications.png', automap: 'privacy/map.png',
  default0user: 'privacy/default0.png',
  lockscreencamera: 'privacy/camera.png', biometrics: 'privacy/biometrics.png',
  screenrecording: 'privacy/record.png',
  // telemetry
  wtelemetry: 'telemetry/telemetry.png', officetelemetry: 'telemetry/telemetry.png',
  adobetelemetry: 'telemetry/3rdparty.png', nvidiatelemetry: 'telemetry/3rdparty.png',
  vscodetelemetry: 'telemetry/3rdparty.png', mediatelemetry: 'telemetry/3rdparty.png',
  powershelltelemetry: 'telemetry/3rdparty.png', ccleanertelemetry: 'telemetry/3rdparty.png',
  googleupdates: 'telemetry/3rdparty.png', adobeupdates: 'telemetry/3rdparty.png',
  wupdate: 'telemetry/update.svg', wsearchtelemetry: 'telemetry/settings.svg',
  appexperience: 'telemetry/settings.svg', wfeedback: 'telemetry/settings.svg',
  handwriting: 'telemetry/settings.svg', windowsdrm: 'telemetry/settings.svg',
  cloudbasedspeech: 'telemetry/settings.svg', targetads: 'telemetry/settings.svg',
  deliveryoptimization: 'telemetry/settings.svg',
  // gaming
  windowed: 'gaming/windowed.svg', fullscreen: 'gaming/fullscreen.png',
  mousedelay: 'gaming/mouse.png', gamemode: 'gaming/gamemode.png',
  gamebar: 'gaming/gamebar.png',
  // performance
  dns: 'performance/dns.png', googledns: 'performance/dns.png',
  cloudflarednds: 'performance/dns.png', quad9dns: 'performance/dns.png',
  ultimateperformance: 'performance/powerplan.svg', balancedpower: 'performance/powerplan.svg',
  highperformance: 'performance/powerplan.svg',
  manualservices: 'performance/manual.png',
  transparency: 'performance/transparency.png',
  hags: 'performance/hags.png', ipv6: 'performance/ipv6.svg',
  limitdefender: 'performance/limit.png',
  vbs: 'performance/vbs.png', coreisolation: 'performance/vbs.png',
  superfetch: 'performance/superfetch.png', disableprefetch: 'performance/superfetch.png',
  storagesense: 'performance/storage.png',
  wsearch: 'performance/search.png',
  faststartup: 'performance/faststartup.png', hibernation: 'performance/hibernation.png',
  // misc
  endtask: 'misc/end.png', stickykeys: 'misc/sticky.png',
  homegallery: 'misc/home.svg', filextensions: 'misc/show.png',
  hiddenfiles: 'misc/hidden.svg', taskbarleft: 'misc/taskbarleft.png',
  numlock: 'misc/numlock.png',
};

function _wsIcon(id) {
  const p = WS_ICONS[id];
  return p ? `<img class="ws-icon" src="assets/ws-icons/${p}" alt="" />` : '';
}

// ── Load ─────────────────────────────────────────────────────────────────────
export async function load() {
  try {
    const r = await inv('get_builder_actions');
    _cats = r.categories || [];
  } catch(e) {
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
  el.innerHTML = _cats.map(cat => {
    const n = _countSelected(cat.items || []);
    return `<button class="bnav-item${_activeTab === cat.id ? ' active' : ''}" data-tab="${cat.id}">
      <i class="ti ${cat.icon || 'ti-adjustments'}"></i>
      <span class="bnav-label">${esc(cat.label)}</span>
      ${n > 0 ? `<span class="bnav-count">${n}</span>` : ''}
    </button>`;
  }).join('');
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
  _activeTab = tabId;
  const togglesEl = document.getElementById('builder-toggles');
  const scriptEl  = document.getElementById('builder-script-view');
  const catHdr    = document.getElementById('builder-cat-header');

  if (tabId === '__run__') {
    togglesEl.style.display = 'none';
    catHdr.style.display    = 'none';
    scriptEl.classList.add('active');
    _rebuildPreview();
  } else {
    togglesEl.style.display = '';
    catHdr.style.display    = '';
    scriptEl.classList.remove('active');
    const cat = _cats.find(c => c.id === tabId);
    if (cat) {
      document.getElementById('builder-cat-title').textContent = cat.label;
      _renderItems(cat.items || []);
    }
  }
  _renderNav();
  _updateBadge();
}

// ── Render items ──────────────────────────────────────────────────────────────
function _renderItems(items) {
  const el = document.getElementById('builder-toggles');
  el.innerHTML = items.map(item => {
    if (item.type === 'group')  return _renderGroup(item);
    if (item.type === 'radio')  return _renderRadioGroup(item);
    if (item.type === 'toggle') return _renderEntry(item, false);
    return '';
  }).join('');

  el.querySelectorAll('input[type="checkbox"][data-id]').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) _sel.add(cb.dataset.id);
      else            _sel.delete(cb.dataset.id);
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
      // sync indicators in same radio group
      const group = rb.closest('details.ws-group');
      if (group) {
        group.querySelectorAll('.ws-indicator').forEach(ind => {
          const inp = ind.closest('.ws-entry-ctrl')?.querySelector('input');
          if (inp) ind.textContent = inp.checked ? 'On' : 'Off';
        });
        _syncRadioBadge(group);
      }
    });
  });

  // "None" radio clear buttons
  el.querySelectorAll('.radio-none-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.dataset.group;
      delete _radio[group];
      _save();
      // uncheck all radios in that group
      el.querySelectorAll(`input[type="radio"][name="${group}"]`).forEach(r => {
        r.checked = false;
      });
      el.querySelectorAll(`input[type="radio"][name="${group}"]`).forEach(r => {
        const ind = r.closest('.ws-entry-ctrl')?.querySelector('.ws-indicator');
        if (ind) ind.textContent = 'Off';
      });
      const grpEl = btn.closest('details.ws-group');
      if (grpEl) _syncRadioBadge(grpEl);
      _updateNavBadge(_activeTab);
      _updateBadge();
    });
  });

  el.querySelectorAll('.ws-indicator').forEach(ind => {
    const inp = ind.closest('.ws-entry-ctrl')?.querySelector('input');
    if (!inp) return;
    inp.addEventListener('change', () => {
      ind.textContent = inp.checked ? 'On' : 'Off';
    });
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

// ── Entry / Group HTML ────────────────────────────────────────────────────────
function _renderEntry(item, inGroup) {
  const checked = _sel.has(item.id);
  const cls = inGroup ? 'ws-entry ws-sub' : 'ws-entry ws-standalone';
  const icon = _wsIcon(item.id);
  return `<div class="${cls}">
    <div class="ws-entry-info">
      ${icon}
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
  const subIds   = (item.items || []).map(s => s.id);
  const selCount = subIds.filter(id => _sel.has(id)).length;
  // pick icon from first item in group
  const groupIcon = item.items?.length ? _wsIcon(item.items[0].id) : '';
  return `<details class="ws-group">
    <summary class="ws-entry ws-group-hdr">
      <div class="ws-entry-info">
        ${groupIcon}
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
    ${(item.items || []).map(s => _renderEntry(s, true)).join('')}
  </details>`;
}

function _renderRadioGroup(item) {
  const chosen = _radio[item.group] || null;
  const groupIcon = item.items?.length ? _wsIcon(item.items[0].id) : '';
  return `<details class="ws-group">
    <summary class="ws-entry ws-group-hdr">
      <div class="ws-entry-info">
        ${groupIcon}
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
    ${(item.items || []).map(sub => {
      const checked = chosen === sub.id;
      const icon = _wsIcon(sub.id);
      return `<div class="ws-entry ws-sub">
        <div class="ws-entry-info">
          ${icon}
          <div class="ws-entry-text">
            <h1>${esc(sub.label)}</h1>
            ${sub.desc ? `<p>${esc(sub.desc)}</p>` : ''}
          </div>
        </div>
        <div class="ws-entry-ctrl">
          <span class="ws-indicator">${checked ? 'On' : 'Off'}</span>
          <label class="ws-switch ws-radio-switch">
            <input type="radio" name="${esc(item.group)}" data-id="${esc(sub.id)}" ${checked ? 'checked' : ''} />
            <span class="ws-slider"></span>
          </label>
        </div>
      </div>`;
    }).join('')}
  </details>`;
}

// ── Badge / count ─────────────────────────────────────────────────────────────
function _updateBadge() {
  const n     = _sel.size + Object.keys(_radio).length;
  const badge = document.getElementById('builder-sel-badge');
  const chip  = document.getElementById('builder-sel-chip');
  const count = document.getElementById('sel-count');
  if (badge) { badge.textContent = n || ''; badge.style.display = n > 0 ? '' : 'none'; }
  if (chip)  { chip.textContent = n + ' selected'; chip.classList.toggle('has-sel', n > 0); }
  if (count) count.textContent = n + ' selected';
}

// ── Script preview ────────────────────────────────────────────────────────────
async function _rebuildPreview() {
  _updateBadge();
  const codeEl = document.getElementById('builder-code');
  const total  = _sel.size + Object.keys(_radio).length;
  if (!total) {
    codeEl.innerHTML = '<span class="ps-comment"># Toggle actions on the left to build your script.</span>';
    return;
  }
  try {
    const allIds = [..._sel, ...Object.values(_radio)];
    const code   = await inv('build_script', { actionIds: allIds, outputType: 'ps1' });
    codeEl.innerHTML = _highlight(code);
  } catch(e) { toast(String(e), 'err'); }
}

function _highlight(code) {
  return esc(code)
    .replace(/(#[^\n]*)/g,  '<span class="ps-comment">$1</span>')
    .replace(/(\$\w+)/g,    '<span class="ps-var">$1</span>')
    .replace(/'([^']*)'/g,  "<span class=\"ps-str\">'$1'</span>");
}

// ── Presets ───────────────────────────────────────────────────────────────────
function _applyPreset(key) {
  const preset = PRESETS[key];
  if (!preset) return;
  _sel.clear();
  _radio = {};
  for (const id of preset.ids) _sel.add(id);
  _save();
  if (_activeTab && _activeTab !== '__run__') {
    const cat = _cats.find(c => c.id === _activeTab);
    if (cat) _renderItems(cat.items || []);
  }
  _renderNav();
  _updateBadge();
  toast(`${preset.label} preset — ${_sel.size} actions selected`, 'ok');
}

// ── Wire toolbar ──────────────────────────────────────────────────────────────
document.getElementById('builder-run-tab').addEventListener('click', () => _setTab('__run__'));

function _clearAll() {
  _sel.clear(); _radio = {}; _save();
  if (_activeTab && _activeTab !== '__run__') {
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
  if (!raw.trim() || raw.includes('Toggle actions')) { toast('Nothing to copy', 'err'); return; }
  try { await navigator.clipboard.writeText(raw); toast('Copied', 'ok'); }
  catch { toast('Copy failed', 'err'); }
});

document.getElementById('builder-save').addEventListener('click', async () => {
  const raw  = document.getElementById('builder-code').textContent;
  const name = document.getElementById('save-name').value.trim();
  if (!raw.trim() || raw.includes('Toggle actions')) { toast('Nothing to save', 'err'); return; }
  if (!name) { toast('Enter a script name', 'err'); document.getElementById('save-name').focus(); return; }
  try {
    await inv('save_built_script', { code: raw, name, scriptType: 'ps1' });
    toast('Saved to Scripts', 'ok');
    document.getElementById('save-name').value = '';
    goPane('scripts');
  } catch(e) { toast(String(e), 'err'); }
});

document.getElementById('builder-run').addEventListener('click', async () => {
  const raw = document.getElementById('builder-code').textContent;
  if (!raw.trim() || raw.includes('Toggle actions')) { toast('Nothing to run', 'err'); return; }
  toast('Running…', 'info');
  try {
    const r = await inv('run_built_script', { code: raw, scriptType: 'ps1' });
    showOutput(r.output, r.success);
    toast(r.success ? 'Done' : 'Script failed', r.success ? 'ok' : 'err');
  } catch(e) { toast(String(e), 'err'); }
});

document.querySelectorAll('[data-preset]').forEach(btn =>
  btn.addEventListener('click', () => _applyPreset(btn.dataset.preset)));
