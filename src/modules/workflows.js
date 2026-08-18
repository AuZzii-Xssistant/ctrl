'use strict';
import { esc, emptyState, paneHeader, toast, openModal, closeModal, confirmDialog, showContextMenu, showOutput, timeAgo, acquireRun, releaseRun, isRecording, recordedStepCount, startRecording, stopRecording } from '../app.js';

const inv = window.__TAURI__.core.invoke;
const { listen } = window.__TAURI__.event;

const TRIGGER_LABELS = { manual: 'Manual', startup: 'On Startup', schedule: 'Scheduled' };
const TRIGGER_ICONS  = { manual: 'ti-hand-click', startup: 'ti-player-play', schedule: 'ti-clock' };

// ── Load ──────────────────────────────────────────────────────────────────────

let _eventsBound = false;

export async function load() {
  const el = document.getElementById('workflows-scroll');
  el.innerHTML = paneHeader('ti-player-play', 'Workflows', 'New Workflow', 'window._showWorkflowModal(null)', 'wf-filter')
    + `<div id="wf-body"><div class="row-list">${'<div class="skel-row skeleton"></div>'.repeat(4)}</div></div>`;
  document.querySelector('#workflows-scroll .pane-header-row')?.insertAdjacentHTML('beforeend', _recRowHtml());

  const wfs = await inv('get_workflows');
  _render(wfs);

  // Live step progress — bound once. load() re-runs on every pane visit AND
  // wf-done's own handler calls load() again, so binding this unguarded stacked
  // a new listener pair on every visit/run and compounded exponentially over time.
  if (!_eventsBound) {
    _eventsBound = true;
    listen('wf-step', e => {
      const { wf_id, step, total, label } = e.payload;
      const el = document.querySelector(`[data-wf-progress="${wf_id}"]`);
      if (el) el.textContent = label ? `${step}/${total} — ${label}` : '';
    });
    listen('wf-done', () => load());
  }

  setTimeout(() => {
    const f = document.getElementById('wf-filter');
    if (!f) return;
    let t;
    f.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const q = f.value.toLowerCase().trim();
        _render(q ? wfs.filter(w => w.name.toLowerCase().includes(q) || (w.description||'').toLowerCase().includes(q)) : wfs);
      }, 180);
    });
  }, 0);
}

// ── Macro recorder ───────────────────────────────────────────────────────────
// Records every script/fix run through the normal UI (via acquireRun's meta
// arg) while active. "Stop & Save" hands the accumulated steps straight to
// the existing New Workflow modal, prefilled — reuses add_workflow, no new
// backend command.
function _recRowHtml() {
  if (isRecording()) {
    return `<div class="wf-rec-row">
      <span class="rec-dot"></span> Recording… ${recordedStepCount()} step${recordedStepCount() === 1 ? '' : 's'}
      <button type="button" class="action-btn btn-secondary" style="font-size:10px;padding:3px 10px;margin-left:auto" onclick="window._toggleRecording()">Stop &amp; Save as Workflow</button>
    </div>`;
  }
  return `<div class="wf-rec-row wf-rec-row-idle">
    <button type="button" class="action-btn btn-ghost" style="font-size:10px;padding:3px 10px" onclick="window._toggleRecording()"><i class="ti ti-circle-filled" style="color:var(--red)"></i> Record</button>
  </div>`;
}

window._toggleRecording = () => {
  if (isRecording()) {
    const steps = stopRecording();
    if (!steps.length) { toast('No script/fix runs recorded', 'err'); load(); return; }
    window._showWorkflowModal({ steps: JSON.stringify(steps) });
  } else {
    startRecording();
    toast('Recording started — run scripts/fixes as normal', 'info');
  }
  const row = document.querySelector('.wf-rec-row');
  if (row) row.outerHTML = _recRowHtml();
};

// ── Render ────────────────────────────────────────────────────────────────────

function _render(wfs) {
  const body = document.getElementById('wf-body');
  if (!body) return;
  if (!wfs.length) {
    body.innerHTML = emptyState('ti-player-play', 'No workflows yet.', '+ New Workflow', 'window._showWorkflowModal(null)');
    return;
  }

  body.innerHTML = '<div class="row-list">' + wfs.map(w => {
    const steps = _parseSteps(w.steps);
    const tIcon = TRIGGER_ICONS[w.trigger_type] || 'ti-hand-click';
    const tLabel = TRIGGER_LABELS[w.trigger_type] || w.trigger_type;
    const lastRun = w.last_run_at ? timeAgo(w.last_run_at) : 'Never';
    const runDot = w.last_run_at
      ? `<span class="run-dot ${w.last_run_ok ? 'ok' : 'err'}" title="Last: ${lastRun}"></span>`
      : `<span class="run-dot none" title="Never run"></span>`;
    const schedHint = w.trigger_type === 'schedule' ? (() => {
      try { const c = JSON.parse(w.trigger_config); return c.time ? ` ${c.time}` : ''; } catch { return ''; }
    })() : '';

    return `<div class="data-row wf-row" data-id="${w.id}">
      <label class="toggle-wrap" title="${w.enabled ? 'Enabled' : 'Disabled'}" onclick="event.stopPropagation()">
        <input type="checkbox" class="wf-toggle" data-id="${w.id}" ${w.enabled ? 'checked' : ''} />
        <span class="toggle-slider sm"></span>
      </label>
      <div style="flex:1;min-width:0">
        <div class="row-name">${esc(w.name)}</div>
        <div class="row-sub" style="display:flex;gap:8px;align-items:center;margin-top:2px">
          <span style="color:var(--text3);font-size:10px"><i class="ti ${tIcon}" style="font-size:10px"></i> ${tLabel}${esc(schedHint)}</span>
          <span style="color:var(--text3);font-size:10px"><i class="ti ti-stack-2" style="font-size:10px"></i> ${steps.length} step${steps.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="wf-progress" data-wf-progress="${w.id}" style="font-size:10px;color:var(--amber);min-height:14px;margin-top:2px"></div>
      </div>
      <div class="run-meta-row">${runDot}<span class="run-time">${lastRun}</span></div>
      <div class="card-actions">
        <button class="run-chip" data-run="${w.id}" title="Run now"><i class="ti ti-player-play" style="font-size:10px"></i> RUN</button>
        <button class="icon-btn" data-edit="${w.id}" title="Edit"><i class="ti ti-edit"></i></button>
        <button class="icon-btn del" data-del="${w.id}" title="Delete"><i class="ti ti-trash"></i></button>
      </div>
    </div>`;
  }).join('') + '</div>';

  body.querySelectorAll('.wf-toggle').forEach(cb => {
    cb.addEventListener('change', () => inv('toggle_workflow', { id: +cb.dataset.id, enabled: cb.checked }).catch(e => toast(String(e), 'err')));
  });
  body.querySelectorAll('.wf-row').forEach(row => {
    const id = +row.dataset.id;
    const w = wfs.find(x => x.id === id);
    row.addEventListener('contextmenu', e => showContextMenu(e, [
      { label: 'Run',    icon: 'ti-player-play', fn: () => _run(id, w?.name) },
      { label: 'Edit',   icon: 'ti-edit',        fn: () => w && window._showWorkflowModal(w) },
      '---',
      { label: 'Delete', icon: 'ti-trash', danger: true, fn: () => _delete(id) },
    ]));
  });
  body.querySelectorAll('[data-run]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); _run(+btn.dataset.run, wfs.find(x => x.id === +btn.dataset.run)?.name); }));
  body.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); window._showWorkflowModal(wfs.find(x => x.id === +btn.dataset.edit)); }));
  body.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); _delete(+btn.dataset.del); }));
}

// ── Run ───────────────────────────────────────────────────────────────────────

async function _run(id, name) {
  await acquireRun();
  toast('Running workflow…', 'info');
  try {
    const results = await inv('run_workflow', { id });
    const sep = '─'.repeat(40);
    const lines = results.map((r, i) =>
      `[${i+1}/${results.length}] ${r.success ? '✓' : '✗'} ${r.label}${r.output.trim() ? '\n' + r.output.trim() : ''}`
    ).join(`\n${sep}\n`);
    const allOk = results.every(r => r.success);
    showOutput(lines, allOk);
    toast(allOk ? `${name || 'Workflow'} complete` : 'Workflow had failures', allOk ? 'ok' : 'err');
  } catch (e) { toast(String(e), 'err'); } finally { releaseRun(); }
}

async function _delete(id) {
  const ok = await confirmDialog('Delete this workflow?', true);
  if (!ok) return;
  await inv('delete_workflow', { id });
  toast('Workflow deleted', 'info');
  window._refreshStats?.();
  load();
}

// ── Modal ─────────────────────────────────────────────────────────────────────

window._showWorkflowModal = async (wf) => {
  const [scripts, fixes] = await Promise.all([
    inv('get_scripts', { search: '' }),
    inv('get_fixes',   { search: '' }),
  ]);
  window._wfSteps = _parseSteps(wf?.steps);
  const triggerType = wf?.trigger_type || 'manual';
  const triggerConfig = (() => { try { return JSON.parse(wf?.trigger_config || '{}'); } catch { return {}; } })();

  openModal(wf ? 'Edit Workflow' : 'New Workflow', `
    <div class="form-row"><label class="form-label">Name</label>
      <input class="form-input" id="wf-name" value="${esc(wf?.name||'')}" placeholder="Morning Routine" /></div>
    <div class="form-row"><label class="form-label">Description</label>
      <input class="form-input" id="wf-desc" value="${esc(wf?.description||'')}" placeholder="Optional" /></div>

    <div class="form-row">
      <label class="form-label">Trigger</label>
      <div style="display:flex;gap:6px;flex-wrap:wrap" id="wf-trigger-btns">
        ${Object.entries(TRIGGER_LABELS).map(([k,v]) =>
          `<button type="button" class="action-btn ${k === triggerType ? 'btn-secondary' : 'btn-ghost'} wf-trigger-btn" data-t="${k}">
            <i class="ti ${TRIGGER_ICONS[k]}"></i> ${v}
          </button>`).join('')}
      </div>
      <input type="hidden" id="wf-trigger-type" value="${triggerType}" />
    </div>
    <div id="wf-trigger-config" style="margin-bottom:10px">${_triggerConfigHtml(triggerType, triggerConfig)}</div>

    <div class="form-row">
      <label class="form-label">Steps <span style="color:var(--text3);font-size:10px;font-weight:400">(run in order)</span></label>
      <div id="wf-steps-list" class="wf-steps-list">${_stepsHtml(window._wfSteps)}</div>
    </div>

    <div class="form-row" style="margin-bottom:12px">
      <label class="form-label">Add step</label>
      <div style="display:flex;gap:6px;flex-wrap:wrap" id="wf-add-btns">
        <select class="form-select" id="wf-item-picker" style="flex:1;min-width:120px">
          ${scripts.map(s => `<option value="script:${s.id}:${esc(s.name)}">[Script] ${esc(s.name)}</option>`).join('')}
          ${fixes.map(f => `<option value="fix:${f.id}:${esc(f.name)}">[Fix] ${esc(f.name)}</option>`).join('')}
        </select>
        <button type="button" class="action-btn btn-secondary" onclick="window._wfAdd('item')"><i class="ti ti-plus"></i> Add</button>
        <button type="button" class="action-btn btn-ghost" onclick="window._wfTogglePanel('notify')"><i class="ti ti-bell"></i> Notify</button>
        <button type="button" class="action-btn btn-ghost" onclick="window._wfTogglePanel('wait')"><i class="ti ti-clock-pause"></i> Wait</button>
      </div>
      <div id="wf-notify-panel" style="display:none;gap:6px;margin-top:8px;flex-wrap:wrap">
        <input class="form-input" id="wf-notify-title" placeholder="Notification title" value="&gt;_ CTRL" style="flex:1;min-width:120px">
        <input class="form-input" id="wf-notify-body" placeholder="Notification message" style="flex:2;min-width:160px">
        <button type="button" class="action-btn btn-primary" onclick="window._wfAdd('notify')">Add</button>
      </div>
      <div id="wf-wait-panel" style="display:none;gap:6px;margin-top:8px;flex-wrap:wrap">
        <input class="form-input" id="wf-wait-secs" type="number" min="1" placeholder="Seconds" value="5" style="width:100px">
        <button type="button" class="action-btn btn-primary" onclick="window._wfAdd('wait')">Add</button>
      </div>
    </div>

    <div class="form-actions">
      <button class="action-btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="action-btn btn-primary" onclick="window._saveWorkflow(${wf?.id||'null'})">${wf ? 'Save' : 'Create'}</button>
    </div>`);

  // Trigger button switching
  document.getElementById('wf-trigger-btns')?.querySelectorAll('.wf-trigger-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.wf-trigger-btn').forEach(b => b.className = b.className.replace('btn-secondary', 'btn-ghost'));
      btn.className = btn.className.replace('btn-ghost', 'btn-secondary');
      document.getElementById('wf-trigger-type').value = btn.dataset.t;
      const cfg = document.getElementById('wf-trigger-config');
      if (cfg) cfg.innerHTML = _triggerConfigHtml(btn.dataset.t, {});
    });
  });

  window._wfTogglePanel = (which) => {
    const panel = document.getElementById(`wf-${which}-panel`);
    if (!panel) return;
    const show = panel.style.display === 'none';
    document.getElementById('wf-notify-panel').style.display = 'none';
    document.getElementById('wf-wait-panel').style.display   = 'none';
    if (show) panel.style.display = 'flex';
  };

  window._wfAdd = (type) => {
    if (type === 'item') {
      const picker = document.getElementById('wf-item-picker');
      if (!picker?.value) return;
      const [stype, itemId, ...rest] = picker.value.split(':');
      window._wfSteps.push({ step_type: stype, item_id: +itemId, label: rest.join(':') });
    } else if (type === 'notify') {
      const title = document.getElementById('wf-notify-title').value.trim() || '>_ CTRL';
      const body  = document.getElementById('wf-notify-body').value.trim();
      window._wfSteps.push({ step_type: 'notify', label: `Notify: ${title}`, title, body });
      document.getElementById('wf-notify-panel').style.display = 'none';
    } else if (type === 'wait') {
      const s = parseInt(document.getElementById('wf-wait-secs').value, 10) || 5;
      window._wfSteps.push({ step_type: 'wait', label: `Wait ${s}s`, seconds: s });
      document.getElementById('wf-wait-panel').style.display = 'none';
    }
    const list = document.getElementById('wf-steps-list');
    if (list) list.innerHTML = _stepsHtml(window._wfSteps);
  };

  window._wfRemoveStep = i => {
    window._wfSteps.splice(i, 1);
    const list = document.getElementById('wf-steps-list');
    if (list) list.innerHTML = _stepsHtml(window._wfSteps);
  };
  window._wfMoveStep = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= window._wfSteps.length) return;
    [window._wfSteps[i], window._wfSteps[j]] = [window._wfSteps[j], window._wfSteps[i]];
    const list = document.getElementById('wf-steps-list');
    if (list) list.innerHTML = _stepsHtml(window._wfSteps);
  };
};

function _triggerConfigHtml(type, config) {
  if (type === 'schedule') {
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const selDays = config.days || [];
    return `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 0">
      <label class="form-label" style="margin:0;min-width:40px">Time</label>
      <input type="time" class="form-input" id="wf-sched-time" value="${config.time||'09:00'}" style="width:110px" />
      <label class="form-label" style="margin:0">Days</label>
      ${days.map((d,i) => `<label style="display:flex;align-items:center;gap:3px;font-size:11px;cursor:pointer">
        <input type="checkbox" class="wf-day-cb" value="${i}" ${selDays.includes(i)?'checked':''}/>${d}</label>`).join('')}
      <span style="font-size:10px;color:var(--text3)">(no days = every day)</span>
    </div>`;
  }
  return '';
}

function _stepsHtml(steps) {
  if (!steps.length) return `<div class="wf-step-empty">No steps yet</div>`;
  const icons = { script:'ti-code', fix:'ti-bolt', notify:'ti-bell', wait:'ti-clock-pause' };
  return steps.map((s, i) => `
    <div class="wf-step">
      <span class="wf-step-num">${i+1}</span>
      <i class="ti ${icons[s.step_type]||'ti-circle'}" style="font-size:12px;color:var(--text3);flex-shrink:0"></i>
      <span class="wf-step-label">${esc(s.label)}</span>
      <div style="display:flex;gap:2px;flex-shrink:0">
        <button type="button" class="icon-btn" style="padding:2px 4px" onclick="window._wfMoveStep(${i},-1)" ${i===0?'disabled':''}><i class="ti ti-chevron-up" style="font-size:10px"></i></button>
        <button type="button" class="icon-btn" style="padding:2px 4px" onclick="window._wfMoveStep(${i},1)" ${i===steps.length-1?'disabled':''}><i class="ti ti-chevron-down" style="font-size:10px"></i></button>
        <button type="button" class="icon-btn del" style="padding:2px 5px" onclick="window._wfRemoveStep(${i})"><i class="ti ti-x"></i></button>
      </div>
    </div>`).join('');
}

window._saveWorkflow = async (id) => {
  const name = document.getElementById('wf-name')?.value.trim();
  if (!name) { toast('Name required', 'err'); return; }
  if (!window._wfSteps?.length) { toast('Add at least one step', 'err'); return; }

  const triggerType = document.getElementById('wf-trigger-type')?.value || 'manual';
  const triggerConfig = (() => {
    if (triggerType === 'schedule') {
      const time = document.getElementById('wf-sched-time')?.value || '09:00';
      const days = [...document.querySelectorAll('.wf-day-cb:checked')].map(c => +c.value);
      return JSON.stringify({ time, days });
    }
    return '{}';
  })();

  const data = {
    name,
    description: document.getElementById('wf-desc')?.value.trim() || '',
    steps: JSON.stringify(window._wfSteps),
    trigger_type: triggerType,
    trigger_config: triggerConfig,
    enabled: true,
  };
  try {
    if (id) await inv('update_workflow', { id, data });
    else     await inv('add_workflow', { data });
    closeModal();
    toast(id ? 'Workflow saved' : 'Workflow created', 'ok');
    window._refreshStats?.();
    load();
  } catch (e) { toast(String(e), 'err'); }
};

function _parseSteps(json) {
  try { return JSON.parse(json || '[]'); } catch { return []; }
}
