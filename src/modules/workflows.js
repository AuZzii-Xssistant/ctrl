import { esc, emptyState, skeletonCards, paneHeader, toast, openModal, closeModal, confirmDialog, showContextMenu, showOutput, timeAgo } from '../app.js';

const inv = window.__TAURI__.core.invoke;

export async function load() {
  const el = document.getElementById('workflows-scroll');
  el.innerHTML = paneHeader('ti-player-play', 'Workflows', 'New Workflow', 'window._showWorkflowModal(null)', 'wf-filter')
    + `<div id="wf-body">${skeletonCards(3)}</div>`;

  const wfs = await inv('get_workflows');
  _render(wfs);

  setTimeout(() => {
    const f = document.getElementById('wf-filter');
    if (!f) return;
    let timer;
    f.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const q = f.value.toLowerCase().trim();
        _render(q ? wfs.filter(w => w.name.toLowerCase().includes(q) || (w.description||'').toLowerCase().includes(q)) : wfs);
      }, 180);
    });
  }, 0);
}

function _render(wfs) {
  const body = document.getElementById('wf-body');
  if (!body) return;
  if (!wfs.length) {
    body.innerHTML = emptyState('ti-player-play', 'No workflows yet.', '+ New Workflow', 'window._showWorkflowModal(null)');
    return;
  }
  body.innerHTML = `<div class="card-grid">${wfs.map(w => {
    const steps = _safeSteps(w.steps);
    return `<div class="card" data-id="${w.id}">
      <div class="card-icon"><i class="ti ti-player-play"></i></div>
      <div class="card-name" title="${esc(w.name)}">${esc(w.name)}</div>
      <div class="card-sub">${esc(w.description || '')}</div>
      <div class="card-sub" style="color:var(--amber);font-size:10px;margin-top:4px">
        <i class="ti ti-stack-2" style="font-size:11px"></i> ${steps.length} step${steps.length !== 1 ? 's' : ''}
      </div>
      <div class="card-footer">
        <span class="tag tag-workflow">workflow</span>
        <div class="card-actions">
          <button class="icon-btn run" title="Run" data-run="${w.id}"><i class="ti ti-player-play"></i></button>
          <button class="icon-btn" title="Edit" data-edit="${w.id}"><i class="ti ti-edit"></i></button>
          <button class="icon-btn del" title="Delete" data-del="${w.id}"><i class="ti ti-trash"></i></button>
        </div>
      </div>
    </div>`;
  }).join('')}</div>`;

  body.querySelectorAll('.card[data-id]').forEach(card => {
    const id = +card.dataset.id;
    const w = wfs.find(x => x.id === id);
    card.addEventListener('contextmenu', e => showContextMenu(e, [
      { label: 'Run',    icon: 'ti-player-play', fn: () => _run(id, w?.name) },
      { label: 'Edit',   icon: 'ti-edit',        fn: () => w && window._showWorkflowModal(w) },
      '---',
      { label: 'Delete', icon: 'ti-trash', danger: true, fn: () => _delete(id) },
    ]));
  });
  body.querySelectorAll('[data-run]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const id = +btn.dataset.run;
    _run(id, wfs.find(x => x.id === id)?.name);
  }));
  body.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const w = wfs.find(x => x.id === +btn.dataset.edit);
    if (w) window._showWorkflowModal(w);
  }));
  body.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation(); _delete(+btn.dataset.del);
  }));
}

async function _run(id, name) {
  toast('Running workflow…', 'info');
  try {
    const results = await inv('run_workflow', { id });
    const sep = '─'.repeat(36);
    const lines = results.map((r, i) =>
      `[${i + 1}/${results.length}] ${r.success ? '✓' : '✗'} ${r.label}\n${r.output.trim() || '(no output)'}`
    ).join(`\n${sep}\n`);
    const allOk = results.every(r => r.success);
    showOutput(lines, allOk);
    toast(allOk ? `${name || 'Workflow'} complete` : 'Workflow had failures', allOk ? 'ok' : 'err');
  } catch (e) { toast(String(e), 'err'); }
}

async function _delete(id) {
  const ok = await confirmDialog('Delete this workflow?', true);
  if (!ok) return;
  await inv('delete_workflow', { id });
  toast('Workflow deleted', 'info');
  window._refreshStats?.();
  load();
}

function _safeSteps(json) {
  try { return JSON.parse(json || '[]'); } catch { return []; }
}

function _stepListHtml(steps) {
  if (!steps.length) return `<div class="wf-step-empty">No steps yet — add below</div>`;
  return steps.map((s, i) => `
    <div class="wf-step">
      <span class="wf-step-num">${i + 1}</span>
      <i class="ti ${s.step_type === 'script' ? 'ti-code' : 'ti-bolt'}" style="font-size:12px;color:var(--text3)"></i>
      <span class="wf-step-label">${esc(s.label)}</span>
      <button type="button" class="icon-btn del" style="padding:2px 5px" onclick="window._wfRemoveStep(${i})">
        <i class="ti ti-x"></i>
      </button>
    </div>`).join('');
}

window._showWorkflowModal = async (wf) => {
  const [scripts, fixes] = await Promise.all([
    inv('get_scripts', { search: '' }),
    inv('get_fixes',   { search: '' }),
  ]);

  const scriptOpts = scripts.map(s =>
    `<option value="script:${s.id}:${esc(s.name)}">[Script] ${esc(s.name)}</option>`).join('');
  const fixOpts = fixes.map(f =>
    `<option value="fix:${f.id}:${esc(f.name)}">[Fix] ${esc(f.name)}</option>`).join('');
  const noItems = !scripts.length && !fixes.length;

  window._wfSteps = _safeSteps(wf?.steps);

  openModal(wf ? 'Edit Workflow' : 'New Workflow', `
    <div class="form-row"><label class="form-label">Name</label>
      <input class="form-input" id="wf-name" value="${esc(wf?.name || '')}" placeholder="Morning Routine" /></div>
    <div class="form-row"><label class="form-label">Description</label>
      <input class="form-input" id="wf-desc" value="${esc(wf?.description || '')}" placeholder="Optional description" /></div>
    <div class="form-row">
      <label class="form-label">Steps <span style="color:var(--text3);font-weight:400;font-size:10px">(run in order)</span></label>
      <div id="wf-steps-list" class="wf-steps-list">${_stepListHtml(window._wfSteps)}</div>
    </div>
    ${noItems
      ? `<p style="color:var(--text3);font-size:11px">Add scripts or fixes first.</p>`
      : `<div class="form-row-2" style="align-items:flex-end">
          <div class="form-row" style="margin:0;flex:1">
            <select class="form-select" id="wf-step-picker">${scriptOpts}${fixOpts}</select>
          </div>
          <button type="button" class="action-btn btn-secondary" onclick="window._wfAddStep()">
            <i class="ti ti-plus"></i> Add step
          </button>
        </div>`
    }
    <div class="form-actions">
      <button class="action-btn btn-ghost" onclick="window._closeWfModal()">Cancel</button>
      <button class="action-btn btn-primary" onclick="window._saveWorkflow(${wf?.id || 'null'})">${wf ? 'Save' : 'Create'}</button>
    </div>`);

  window._closeWfModal = closeModal;

  window._wfAddStep = () => {
    const picker = document.getElementById('wf-step-picker');
    if (!picker) return;
    const [type, itemId, ...rest] = picker.value.split(':');
    const label = rest.join(':'); // name might contain colons
    window._wfSteps.push({ step_type: type, item_id: +itemId, label });
    const list = document.getElementById('wf-steps-list');
    if (list) list.innerHTML = _stepListHtml(window._wfSteps);
  };

  window._wfRemoveStep = (i) => {
    window._wfSteps.splice(i, 1);
    const list = document.getElementById('wf-steps-list');
    if (list) list.innerHTML = _stepListHtml(window._wfSteps);
  };
};

window._saveWorkflow = async (id) => {
  const name = document.getElementById('wf-name')?.value.trim();
  if (!name) { toast('Name required', 'err'); return; }
  if (!window._wfSteps?.length) { toast('Add at least one step', 'err'); return; }
  const data = {
    name,
    description: document.getElementById('wf-desc')?.value.trim() || '',
    steps: JSON.stringify(window._wfSteps),
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
