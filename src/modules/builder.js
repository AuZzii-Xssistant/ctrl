import { esc, toast, closeModal, showOutput } from '../app.js';

const inv = window.__TAURI__.core.invoke;
let _defs = { categories: [] };
let _activeTab = null;

// Persist selections across sessions via localStorage
const LS_KEY = 'ctrl_builder_selected';
let _selected = new Set(JSON.parse(localStorage.getItem(LS_KEY) || '[]'));
function _saveSelected() { localStorage.setItem(LS_KEY, JSON.stringify([..._selected])); }

export async function load() {
  const r = await inv('get_builder_actions');
  _defs = r;
  renderNav();
  if (!_activeTab && _defs.categories.length) setTab(_defs.categories[0].id);
  else if (_activeTab) setTab(_activeTab);
  else updateBadge();
}

function renderNav() {
  const el = document.getElementById('builder-nav-items');
  if (!_defs.categories.length) {
    el.innerHTML = `<div style="padding:14px;font-size:11px;color:var(--text3);line-height:1.6">
      No actions found.<br>Drop JSON files into<br><span style="font-family:var(--mono);color:var(--amber)">data/builder/</span></div>`;
    return;
  }
  el.innerHTML = _defs.categories.map(cat => {
    const n = cat.sections.flatMap(s => s.actions).filter(a => _selected.has(a.id)).length;
    return `<button class="bnav-item${_activeTab===cat.id?' active':''}" data-tab="${cat.id}">
      <i class="ti ${cat.icon||'ti-adjustments'}"></i>
      <span class="bnav-label">${esc(cat.label)}</span>
      ${n>0?`<span class="bnav-count">${n}</span>`:''}
    </button>`;
  }).join('');
  el.querySelectorAll('[data-tab]').forEach(btn => btn.addEventListener('click', () => setTab(btn.dataset.tab)));
}

function updateBadge() {
  const n = _selected.size;
  const badge = document.getElementById('builder-sel-badge');
  const chip  = document.getElementById('builder-sel-chip');
  const count = document.getElementById('sel-count');
  if (badge) badge.textContent = n;
  if (chip)  { chip.textContent = n + ' selected'; chip.classList.toggle('has-sel', n>0); }
  if (count) count.textContent = n + ' selected';
  const runTab = document.getElementById('builder-run-tab');
  if (runTab) runTab.classList.toggle('active', _activeTab === '__run__');
}

function setTab(tabId) {
  _activeTab = tabId;
  renderNav();
  const toggles  = document.getElementById('builder-toggles');
  const script   = document.getElementById('builder-script-view');
  const catHdr   = document.getElementById('builder-cat-header');
  if (tabId === '__run__') {
    toggles.style.display = 'none'; catHdr.style.display = 'none';
    script.classList.add('active'); rebuildScript();
  } else {
    toggles.style.display = ''; catHdr.style.display = '';
    script.classList.remove('active');
    const cat = _defs.categories.find(c => c.id === tabId);
    document.getElementById('builder-cat-title').textContent = cat?.label || '';
    renderToggles(cat);
  }
  updateBadge();
}

function renderToggles(cat) {
  const el = document.getElementById('builder-toggles');
  if (!cat) { el.innerHTML = ''; return; }
  let html = '';
  for (const section of cat.sections||[]) {
    const ids = (section.actions||[]).map(a => a.id);
    const allSel = ids.length && ids.every(id => _selected.has(id));
    html += `<div class="builder-section-label">
      ${esc(section.label)}
      <button class="sec-all-btn" data-sec-ids="${esc(JSON.stringify(ids))}" data-sec-all="${allSel}">${allSel ? 'Clear' : 'Select all'}</button>
    </div>`;
    for (const action of section.actions||[]) {
      const sel = _selected.has(action.id);
      html += `<button class="action-toggle${sel?' selected':''}" data-action="${esc(action.id)}">
        <div class="toggle-box">${sel?'<i class="ti ti-check" style="font-size:9px"></i>':''}</div>
        <div class="action-info">
          <div class="action-label">${esc(action.label)}</div>
          ${action.description?`<div class="action-desc">${esc(action.description)}</div>`:''}
        </div>
      </button>`;
    }
  }
  if (!html) html = `<p style="color:var(--text3);font-size:11px;padding:14px 0">No actions in this category.</p>`;
  el.innerHTML = html;
  el.querySelectorAll('[data-action]').forEach(btn => btn.addEventListener('click', () => toggleAction(btn.dataset.action)));
  el.querySelectorAll('.sec-all-btn').forEach(btn => btn.addEventListener('click', () => {
    const ids = JSON.parse(btn.dataset.secIds);
    const allSel = btn.dataset.secAll === 'true';
    ids.forEach(id => allSel ? _selected.delete(id) : _selected.add(id));
    _saveSelected(); renderToggles(cat); updateBadge(); renderNav();
  }));
}

function toggleAction(id) {
  if (_selected.has(id)) _selected.delete(id); else _selected.add(id);
  _saveSelected();
  document.querySelectorAll(`[data-action="${id}"]`).forEach(btn => {
    const sel = _selected.has(id);
    btn.classList.toggle('selected', sel);
    btn.querySelector('.toggle-box').innerHTML = sel ? '<i class="ti ti-check" style="font-size:9px"></i>' : '';
  });
  updateBadge(); renderNav();
}

async function rebuildScript() {
  updateBadge();
  const codeEl = document.getElementById('builder-code');
  if (!_selected.size) {
    codeEl.innerHTML = '<span class="ps-comment"># Select actions from the categories on the left.</span>';
    return;
  }
  try {
    const type   = document.getElementById('builder-type').value;
    const code   = await inv('build_script', { action_ids: [..._selected], output_type: type });
    codeEl.innerHTML = highlight(code, type);
  } catch (e) { toast(String(e), 'err'); }
}

function highlight(code, type) {
  let html = esc(code);
  if (type === 'ps1') {
    html = html
      .replace(/(#[^\n]*)/g,    '<span class="ps-comment">$1</span>')
      .replace(/(\$\w+)/g,      '<span class="ps-var">$1</span>')
      .replace(/'([^']*)'/g,    "<span class=\"ps-str\">'$1'</span>");
  } else {
    html = html.replace(/(REM[^\n]*|@echo[^\n]*)/gi, '<span class="ps-comment">$1</span>');
  }
  return html;
}

// Wire up run-tab and toolbar buttons
document.getElementById('builder-run-tab').addEventListener('click', () => setTab('__run__'));
document.getElementById('builder-type').addEventListener('change', rebuildScript);
document.getElementById('builder-clear').addEventListener('click', () => {
  _selected.clear(); _saveSelected(); renderNav();
  const cat = _defs.categories.find(c => c.id === _activeTab);
  if (cat) renderToggles(cat);
  document.getElementById('builder-code').innerHTML = '<span class="ps-comment"># Select actions from the categories on the left.</span>';
  updateBadge();
});
document.getElementById('builder-copy').addEventListener('click', async () => {
  const raw = document.getElementById('builder-code').textContent;
  if (!raw.trim() || raw.includes('Select actions')) { toast('Nothing to copy', 'err'); return; }
  try { await navigator.clipboard.writeText(raw); toast('Copied', 'ok'); } catch { toast('Copy failed', 'err'); }
});
document.getElementById('builder-save').addEventListener('click', async () => {
  const raw  = document.getElementById('builder-code').textContent;
  const name = document.getElementById('save-name').value.trim();
  if (!raw.trim() || raw.includes('Select actions')) { toast('Nothing to save', 'err'); return; }
  if (!name) { toast('Enter a script name', 'err'); document.getElementById('save-name').focus(); return; }
  const type = document.getElementById('builder-type').value;
  try { await inv('save_built_script', { code: raw, name, script_type: type }); toast('Saved to Scripts', 'ok'); document.getElementById('save-name').value = ''; }
  catch (e) { toast(String(e), 'err'); }
});
document.getElementById('builder-run').addEventListener('click', async () => {
  const raw  = document.getElementById('builder-code').textContent;
  const type = document.getElementById('builder-type').value;
  if (!raw.trim() || raw.includes('Select actions')) { toast('Nothing to run', 'err'); return; }
  toast('Running…', 'info');
  try {
    const r = await inv('run_built_script', { code: raw, script_type: type });
    showOutput(r.output, r.success);
    toast(r.success ? 'Done' : 'Script failed', r.success ? 'ok' : 'err');
  } catch (e) { toast(String(e), 'err'); }
});
