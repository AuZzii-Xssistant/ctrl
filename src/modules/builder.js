'use strict';
import { esc, toast, showOutput } from '../app.js';

const inv = window.__TAURI__.core.invoke;

// ── State ────────────────────────────────────────────────────────────────────
let _cats      = [];   // [{id, label, icon, items:[...]}]
let _activeTab = null;

const LS_KEY   = 'ctrl_builder_sel';
let   _sel     = new Set(JSON.parse(localStorage.getItem(LS_KEY) || '[]'));
// Radio: group → selected id (only one per group)
let   _radio   = JSON.parse(localStorage.getItem(LS_KEY + '_radio') || '{}');

function _save() {
  localStorage.setItem(LS_KEY,              JSON.stringify([..._sel]));
  localStorage.setItem(LS_KEY + '_radio',   JSON.stringify(_radio));
}

// ── Load ─────────────────────────────────────────────────────────────────────
export async function load() {
  try {
    const r = await inv('get_builder_actions');
    _cats = r.categories || [];
  } catch (e) {
    _cats = [];
    console.error('builder load error', e);
  }
  _renderNav();
  const first = _activeTab || (_cats[0] && _cats[0].id);
  if (first) _setTab(first); else _updateBadge();
}

// ── Nav ──────────────────────────────────────────────────────────────────────
function _renderNav() {
  const el = document.getElementById('builder-nav-items');
  if (!_cats.length) {
    el.innerHTML = `<div class="bnav-empty">No actions found.<br>Run the converter:<br>
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
    if (item.type === 'toggle' && _sel.has(item.id)) n++;
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

// ── Render items ─────────────────────────────────────────────────────────────
function _renderItems(items) {
  const el = document.getElementById('builder-toggles');
  el.innerHTML = items.map(_renderItem).join('');

  // Wire up group select-all checkboxes
  el.querySelectorAll('.b-sel-all').forEach(cb => {
    cb.addEventListener('click', e => {
      e.stopPropagation();
      const ids = JSON.parse(cb.dataset.ids);
      const allOn = ids.every(id => _sel.has(id));
      ids.forEach(id => allOn ? _sel.delete(id) : _sel.add(id));
      _save();
      _setTab(_activeTab); // re-render
    });
  });

  // Wire up toggle items
  el.querySelectorAll('.b-item[data-id]').forEach(btn => {
    btn.addEventListener('click', () => _toggleItem(btn.dataset.id, btn.dataset.group));
  });

  // Stop details from toggling when clicking select-all
  el.querySelectorAll('details summary').forEach(s => {
    s.addEventListener('click', e => {
      if (e.target.closest('.b-sel-all-wrap')) e.preventDefault();
    });
  });
}

function _renderItem(item) {
  if (item.type === 'group')  return _renderGroup(item);
  if (item.type === 'radio')  return _renderRadioGroup(item);
  if (item.type === 'toggle') return _renderToggle(item, false);
  return '';
}

function _renderGroup(item) {
  const subIds  = (item.items || []).map(s => s.id);
  const selAll  = subIds.length && subIds.every(id => _sel.has(id));
  const selSome = !selAll && subIds.some(id => _sel.has(id));
  const selCount = subIds.filter(id => _sel.has(id)).length;

  return `<details class="b-group">
    <summary class="b-group-hdr">
      <i class="ti ti-chevron-right b-chevron"></i>
      <div class="b-group-info">
        <span class="b-group-title">${esc(item.label)}</span>
        ${item.desc ? `<span class="b-group-desc">${esc(item.desc)}</span>` : ''}
      </div>
      <div class="b-sel-all-wrap">
        ${selCount > 0 ? `<span class="b-sel-count">${selCount}/${subIds.length}</span>` : ''}
        <div class="b-sel-all${selAll ? ' all' : selSome ? ' some' : ''}"
             data-ids="${esc(JSON.stringify(subIds))}"
             title="${selAll ? 'Deselect all' : 'Select all'}">
          ${selAll ? '<i class="ti ti-check" style="font-size:8px"></i>' : selSome ? '<i class="ti ti-minus" style="font-size:8px"></i>' : ''}
        </div>
      </div>
    </summary>
    <div class="b-group-items">
      ${(item.items || []).map(s => _renderToggle(s, true)).join('')}
    </div>
  </details>`;
}

function _renderRadioGroup(item) {
  const chosen = _radio[item.group] || null;
  return `<div class="b-group b-radio-group">
    <div class="b-group-hdr b-radio-hdr">
      <i class="ti ti-radio b-group-icon"></i>
      <div class="b-group-info">
        <span class="b-group-title">${esc(item.label)}</span>
        ${item.desc ? `<span class="b-group-desc">${esc(item.desc)}</span>` : ''}
      </div>
    </div>
    <div class="b-group-items b-radio-items">
      ${(item.items || []).map(sub => `
        <button class="b-item b-radio-item${chosen === sub.id ? ' selected' : ''}"
                data-id="${esc(sub.id)}" data-group="${esc(item.group)}">
          <div class="b-radio-dot"></div>
          <div class="b-item-text">
            <span class="b-item-label">${esc(sub.label)}</span>
            ${sub.desc ? `<span class="b-item-desc">${esc(sub.desc)}</span>` : ''}
          </div>
        </button>`).join('')}
    </div>
  </div>`;
}

function _renderToggle(item, inGroup) {
  const sel = _sel.has(item.id);
  return `<button class="b-item${sel ? ' selected' : ''}${inGroup ? ' b-in-group' : ' b-standalone'}"
                  data-id="${esc(item.id)}">
    <div class="b-box">${sel ? '<i class="ti ti-check"></i>' : ''}</div>
    <div class="b-item-text">
      <span class="b-item-label">${esc(item.label)}</span>
      ${item.desc ? `<span class="b-item-desc">${esc(item.desc)}</span>` : ''}
    </div>
  </button>`;
}

// ── Toggle / Radio select ─────────────────────────────────────────────────────
function _toggleItem(id, group) {
  if (group) {
    // Radio — deselect current in group, select new (or deselect if clicking same)
    const cur = _radio[group];
    if (cur === id) { delete _radio[group]; }
    else { _radio[group] = id; }
  } else {
    if (_sel.has(id)) _sel.delete(id); else _sel.add(id);
  }
  _save();
  _setTab(_activeTab);
}

// ── Badge + count ─────────────────────────────────────────────────────────────
function _updateBadge() {
  // Total selections: toggles + one per radio group
  const n = _sel.size + Object.keys(_radio).length;
  const badge = document.getElementById('builder-sel-badge');
  const chip  = document.getElementById('builder-sel-chip');
  const count = document.getElementById('sel-count');
  if (badge) badge.textContent = n || '';
  if (badge) badge.style.display = n > 0 ? '' : 'none';
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
    const type = document.getElementById('builder-type').value;
    // Collect all selected IDs (toggles + current radio selections)
    const allIds = [..._sel, ...Object.values(_radio)];
    // Tauri v2: JS sends camelCase, Rust receives snake_case
    const code = await inv('build_script', { actionIds: allIds, outputType: type });
    codeEl.innerHTML = _highlight(code, type);
  } catch (e) {
    toast(String(e), 'err');
  }
}

function _highlight(code, type) {
  let html = esc(code);
  if (type === 'ps1') {
    html = html
      .replace(/(#[^\n]*)/g,   '<span class="ps-comment">$1</span>')
      .replace(/(\$\w+)/g,     '<span class="ps-var">$1</span>')
      .replace(/'([^']*)'/g,   "<span class=\"ps-str\">'$1'</span>");
  } else {
    html = html.replace(/(REM[^\n]*|@echo[^\n]*)/gi, '<span class="ps-comment">$1</span>');
  }
  return html;
}

// ── Wire up toolbar buttons ──────────────────────────────────────────────────
document.getElementById('builder-run-tab').addEventListener('click', () => _setTab('__run__'));
document.getElementById('builder-type').addEventListener('change', _rebuildPreview);

document.getElementById('builder-clear').addEventListener('click', () => {
  _sel.clear(); _radio = {}; _save();
  _setTab(_activeTab === '__run__' ? '__run__' : _activeTab);
});

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
  const type = document.getElementById('builder-type').value;
  try {
    await inv('save_built_script', { code: raw, name, scriptType: type });
    toast('Saved to Scripts', 'ok');
    document.getElementById('save-name').value = '';
  } catch (e) { toast(String(e), 'err'); }
});

document.getElementById('builder-run').addEventListener('click', async () => {
  const raw  = document.getElementById('builder-code').textContent;
  const type = document.getElementById('builder-type').value;
  if (!raw.trim() || raw.includes('Toggle actions')) { toast('Nothing to run', 'err'); return; }
  toast('Running…', 'info');
  try {
    const r = await inv('run_built_script', { code: raw, scriptType: type });
    showOutput(r.output, r.success);
    toast(r.success ? 'Done' : 'Script failed', r.success ? 'ok' : 'err');
  } catch (e) { toast(String(e), 'err'); }
});
