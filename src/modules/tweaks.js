import { esc, sectionHdr, paneHeader, toast, showOutput, openModal, closeModal, confirmDialog, acquireRun, releaseRun } from '../app.js';

const inv = window.__TAURI__.core.invoke;

// Category display order + cleaned-up labels (source data prefixes "z__" on
// Advanced purely to sort last in WinUtil's own UI; we control order ourselves).
const CATEGORY_ORDER = [
  ['Essential Tweaks', 'Essential Tweaks'],
  ['Customize Preferences', 'Customize Preferences'],
  ['Performance Plans - NOT FOR LAPTOPS', 'Performance Plans (desktop only)'],
  ['z__Advanced Tweaks - CAUTION', 'Advanced Tweaks — Caution'],
];

const STATE_DOT = { on: 'ok', off: 'none', unknown: 'unknown' };
const STATE_LABEL = { on: 'On', off: 'Off', unknown: 'Unknown' };

let _wtweaks = [];   // ported WinUtil tweaks (data/tweaks/winutil-tweaks.json)
let _wstate = {};    // id -> 'on'|'off'|'unknown'
let _customTweaks = [];

export async function load() {
  const el = document.getElementById('tweaks-scroll');
  const note = `<div class="tweaks-note-inner"><i class="ti ti-shield-lock"></i> Tweaks marked <span class="badge-admin" style="vertical-align:middle"><i class="ti ti-shield"></i> admin</span> require &gt;_ CTRL to be run as Administrator. State is read from the registry on load — not a guess.</div>`;
  el.innerHTML = paneHeader('ti-adjustments', 'System Tweaks', 'Custom Tweak', 'window._showCustomTweakModal(null)', 'tweaks-filter', note)
    + `<div id="tweaks-body"><div class="empty-state" style="padding-top:40px"><i class="ti ti-loader"></i><p>Checking current tweak state…</p></div></div>`;

  setTimeout(() => {
    const f = document.getElementById('tweaks-filter');
    if (f) f.addEventListener('input', () => _render(f.value.toLowerCase().trim()));
  }, 0);

  const [wtweaks, customTweaks] = await Promise.all([
    inv('get_winutil_tweaks').catch(() => []),
    inv('get_custom_tweaks').catch(() => []),
  ]);
  _wtweaks = wtweaks;
  _customTweaks = customTweaks;
  _wstate = await inv('check_winutil_tweaks').catch(() => ({}));
  _render('');
}

function _wtweakRow(t) {
  const state = _wstate[t.id] || 'unknown';
  const dotCls = STATE_DOT[state];
  const adminBadge = t.admin ? '<span class="badge-admin" title="Requires administrator"><i class="ti ti-shield"></i> admin</span>' : '';
  return `<div class="tweak-row">
    <div class="tweak-info">
      <div class="tweak-label" style="display:flex;align-items:center;gap:6px">
        <span class="run-dot ${dotCls}" title="${STATE_LABEL[state]}"></span>
        ${esc(t.label)}${adminBadge}
      </div>
      <div class="tweak-desc">${esc(t.description)}</div>
    </div>
    <div class="tweak-btns">
      <button class="tweak-btn apply${state === 'on' ? ' tweak-btn-active' : ''}" data-id="${esc(t.id)}" data-action="apply">${state === 'on' ? '✓ Applied' : 'Apply'}</button>
      <button class="tweak-btn revert" data-id="${esc(t.id)}" data-action="revert">Revert</button>
    </div>
  </div>`;
}

function _customTweakRow(t) {
  const adminBadge = t.admin ? '<span class="badge-admin" title="Requires administrator"><i class="ti ti-shield"></i> admin</span>' : '';
  return `<div class="tweak-row">
    <div class="tweak-info">
      <div class="tweak-label" style="display:flex;align-items:center;gap:6px">
        <span class="run-dot unknown" title="Unknown — custom tweaks aren't state-checked"></span>
        ${esc(t.label)}${adminBadge}
        <button class="icon-btn" title="Edit" data-cedit="${t.id}" style="padding:2px 4px;font-size:11px"><i class="ti ti-pencil"></i></button>
        <button class="icon-btn del" title="Delete" data-cdel="${t.id}" style="padding:2px 4px;font-size:11px"><i class="ti ti-trash"></i></button>
      </div>
      <div class="tweak-desc">${esc(t.description)}</div>
    </div>
    <div class="tweak-btns">
      <button class="tweak-btn apply" data-cid="${t.id}" data-caction="apply" data-cmd="${esc(t.apply_cmd)}" data-admin="${t.admin ? '1' : '0'}">Apply</button>
      ${t.revert_cmd ? `<button class="tweak-btn revert" data-cid="${t.id}" data-caction="revert" data-cmd="${esc(t.revert_cmd)}" data-admin="${t.admin ? '1' : '0'}">Revert</button>` : ''}
    </div>
  </div>`;
}

function _render(q) {
  const body = document.getElementById('tweaks-body');
  if (!body) return;
  let html = '';
  let total = 0;

  for (const [catKey, catLabel] of CATEGORY_ORDER) {
    const items = _wtweaks
      .filter(t => t.category === catKey)
      .filter(t => !q || t.label.toLowerCase().includes(q) || t.description.toLowerCase().includes(q));
    if (!items.length) continue;
    total += items.length;
    html += sectionHdr(catLabel, items.length) + '<div class="tweaks-list">';
    for (const t of items) html += _wtweakRow(t);
    html += '</div>';
  }

  const customFiltered = _customTweaks.filter(t =>
    !q || t.label.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)
  );
  if (customFiltered.length) {
    total += customFiltered.length;
    const groups = {};
    for (const t of customFiltered) (groups[t.category] ??= []).push(t);
    for (const [cat, items] of Object.entries(groups)) {
      html += sectionHdr(cat, items.length) + '<div class="tweaks-list">';
      for (const t of items) html += _customTweakRow(t);
      html += '</div>';
    }
  }

  if (!total) html = `<div class="empty-state" style="padding-top:40px"><i class="ti ti-search"></i><p>No tweaks match "${esc(q)}"</p></div>`;
  body.innerHTML = html;

  body.querySelectorAll('.tweak-btn[data-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const action = btn.getAttribute('data-action');
      const orig = btn.textContent;
      await acquireRun();
      btn.disabled = true; btn.textContent = '…';
      try {
        const r = await inv(action === 'apply' ? 'apply_winutil_tweak' : 'revert_winutil_tweak', { id });
        showOutput(r.output, r.success);
        toast(r.success ? 'Done' : 'Command returned an error', r.success ? 'ok' : 'err');
        if (r.success) {
          _wstate = await inv('check_winutil_tweaks').catch(() => _wstate);
          const q2 = document.getElementById('tweaks-filter')?.value.toLowerCase().trim() || '';
          _render(q2);
          releaseRun();
          return;
        }
      } catch (e) { toast(String(e), 'err'); } finally { releaseRun(); }
      btn.disabled = false; btn.textContent = orig;
    });
  });

  body.querySelectorAll('.tweak-btn[data-cid]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cmd = btn.getAttribute('data-cmd');
      const admin = btn.getAttribute('data-admin') === '1';
      const orig = btn.textContent;
      await acquireRun();
      btn.disabled = true; btn.textContent = '…';
      try {
        const r = await inv('run_tweak_cmd', { cmd, admin });
        showOutput(r.output, r.success);
        toast(r.success ? 'Done' : 'Command returned an error', r.success ? 'ok' : 'err');
      } catch (e) { toast(String(e), 'err'); } finally { releaseRun(); }
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
      const q2 = document.getElementById('tweaks-filter')?.value.toLowerCase().trim() || '';
      _render(q2);
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
