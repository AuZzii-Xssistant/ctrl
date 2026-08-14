'use strict';
import { esc, toast, showOutput, goPane } from '../app.js';

const inv = window.__TAURI__.core.invoke;

// ── State ────────────────────────────────────────────────────────────────────
let _cats      = [];
let _presets   = {};   // loaded from _meta.json via get_builder_actions
let _activeTab = null;

const LS_KEY = 'ctrl_builder_sel';
let _sel   = new Set(JSON.parse(localStorage.getItem(LS_KEY)           || '[]'));
let _radio = JSON.parse(localStorage.getItem(LS_KEY + '_radio') || '{}');

function _save() {
  localStorage.setItem(LS_KEY,             JSON.stringify([..._sel]));
  localStorage.setItem(LS_KEY + '_radio',  JSON.stringify(_radio));
}

// ── Icon helper — reads icon from JSON item, only used for group headers ──────
function _wsIcon(iconPath) {
  if (!iconPath) return '';
  return `<img class="ws-icon" src="assets/ws-icons/${iconPath}" alt="" />`;
}

// ── Load ─────────────────────────────────────────────────────────────────────
export async function load() {
  try {
    const r = await inv('get_builder_actions');
    _cats    = r.categories || [];
    _presets = r.presets    || {};
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
    if (item.type === 'toggle') return _renderToggle(item);
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
  const subIds   = (item.items || []).map(s => s.id);
  const selCount = subIds.filter(id => _sel.has(id)).length;
  return `<details class="ws-group">
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
  return `<details class="ws-group">
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
  const ids = _presets[key];
  if (!ids || !ids.length) { toast('Preset not loaded', 'err'); return; }
  _sel.clear();
  _radio = {};
  for (const id of ids) _sel.add(id);
  _save();
  _renderNav();
  _updateBadge();
  toast(`${key.charAt(0).toUpperCase() + key.slice(1)} preset — ${_sel.size} actions selected`, 'ok');
  // Navigate to run tab to show the generated script immediately
  _setTab('__run__');
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
  if (!raw.trim()) { toast('Nothing to copy', 'err'); return; }
  try { await navigator.clipboard.writeText(raw); toast('Copied', 'ok'); }
  catch { toast('Copy failed', 'err'); }
});

document.getElementById('builder-save').addEventListener('click', async () => {
  const raw  = document.getElementById('builder-code').textContent;
  const name = document.getElementById('save-name').value.trim();
  if (!raw.trim()) { toast('Nothing to save', 'err'); return; }
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
  if (!raw.trim()) { toast('Nothing to run', 'err'); return; }
  toast('Running…', 'info');
  try {
    const r = await inv('run_built_script', { code: raw, scriptType: 'ps1' });
    showOutput(r.output, r.success);
    toast(r.success ? 'Done' : 'Script failed', r.success ? 'ok' : 'err');
  } catch(e) { toast(String(e), 'err'); }
});

document.querySelectorAll('[data-preset]').forEach(btn =>
  btn.addEventListener('click', () => _applyPreset(btn.dataset.preset)));
