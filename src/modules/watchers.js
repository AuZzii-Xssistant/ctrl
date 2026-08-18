'use strict';
import { esc, emptyState, paneHeader, toast, openModal, closeModal, confirmDialog, showContextMenu, timeAgo } from '../app.js';

const inv = window.__TAURI__.core.invoke;

const COND_LABELS = { disk_below: 'Disk space below', process_down: 'Process not running', cpu_sustained: 'CPU sustained above' };
const COND_ICONS  = { disk_below: 'ti-device-floppy', process_down: 'ti-player-stop', cpu_sustained: 'ti-cpu' };

export async function load() {
  const el = document.getElementById('watchers-scroll');
  el.innerHTML = paneHeader('ti-eye', 'Watchers', 'New Watcher', 'window._showWatcherModal(null)', 'wat-filter')
    + `<div id="wat-body"><div class="row-list">${'<div class="skel-row skeleton"></div>'.repeat(4)}</div></div>`;

  const items = await inv('get_watchers').catch(() => []);
  _render(items);

  setTimeout(() => {
    const f = document.getElementById('wat-filter');
    f?.addEventListener('input', () => {
      const q = f.value.toLowerCase().trim();
      _render(q ? items.filter(w => w.name.toLowerCase().includes(q)) : items);
    });
  }, 0);
}

function _render(items) {
  const body = document.getElementById('wat-body');
  if (!body) return;
  if (!items.length) {
    body.innerHTML = emptyState('ti-eye', 'No watchers yet.', '+ New Watcher', 'window._showWatcherModal(null)');
    return;
  }

  body.innerHTML = '<div class="row-list">' + items.map(w => {
    const cfg = _parseCfg(w.condition_config);
    const triggered = w.last_triggered_at ? timeAgo(w.last_triggered_at) : 'Never';
    const alertDot = `<span class="run-dot ${w.last_state === 'alert' ? 'err' : 'ok'}" title="Last check: ${w.last_checked ? timeAgo(w.last_checked) : 'never'}"></span>`;
    const actionLabel = w.action.startsWith('workflow:') ? 'Run workflow' : 'Notify';

    return `<div class="data-row wat-row" data-id="${w.id}">
      <label class="toggle-wrap" title="${w.enabled ? 'Enabled' : 'Disabled'}" onclick="event.stopPropagation()">
        <input type="checkbox" class="wat-toggle" data-id="${w.id}" ${w.enabled ? 'checked' : ''} />
        <span class="toggle-slider sm"></span>
      </label>
      <div style="flex:1;min-width:0">
        <div class="row-name">${esc(w.name)}</div>
        <div class="row-sub" style="display:flex;gap:8px;align-items:center;margin-top:2px">
          <span style="color:var(--text3);font-size:10px"><i class="ti ${COND_ICONS[w.condition_type] || 'ti-eye'}" style="font-size:10px"></i> ${esc(_condSummary(w.condition_type, cfg))}</span>
          <span style="color:var(--text3);font-size:10px"><i class="ti ti-bell" style="font-size:10px"></i> ${actionLabel}</span>
        </div>
      </div>
      <div class="run-meta-row">${alertDot}<span class="run-time">${triggered}</span></div>
      <div class="card-actions">
        <button class="icon-btn" data-edit="${w.id}" title="Edit"><i class="ti ti-edit"></i></button>
        <button class="icon-btn del" data-del="${w.id}" title="Delete"><i class="ti ti-trash"></i></button>
      </div>
    </div>`;
  }).join('') + '</div>';

  body.querySelectorAll('.wat-toggle').forEach(cb => {
    cb.addEventListener('change', () => inv('toggle_watcher', { id: +cb.dataset.id, enabled: cb.checked }).catch(e => toast(String(e), 'err')));
  });
  body.querySelectorAll('.wat-row').forEach(row => {
    const id = +row.dataset.id;
    const w = items.find(x => x.id === id);
    row.addEventListener('contextmenu', e => showContextMenu(e, [
      { label: 'Edit',   icon: 'ti-edit',       fn: () => w && window._showWatcherModal(w) },
      '---',
      { label: 'Delete', icon: 'ti-trash', danger: true, fn: () => _delete(id) },
    ]));
  });
  body.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); window._showWatcherModal(items.find(x => x.id === +btn.dataset.edit)); }));
  body.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); _delete(+btn.dataset.del); }));
}

function _condSummary(type, cfg) {
  if (type === 'disk_below')    return `${cfg.drive || 'C'}: < ${cfg.pct ?? 10}% free`;
  if (type === 'process_down')  return `${cfg.process || '?'} down`;
  if (type === 'cpu_sustained') return `> ${cfg.pct ?? 80}% for ${cfg.minutes ?? 5}m`;
  return type;
}

async function _delete(id) {
  const ok = await confirmDialog('Delete this watcher?', true);
  if (!ok) return;
  await inv('delete_watcher', { id }).catch(e => toast(String(e), 'err'));
  toast('Watcher deleted', 'info');
  load();
}

// ── Modal ─────────────────────────────────────────────────────────────────────

window._showWatcherModal = async (w) => {
  const isEdit = !!w;
  const type = w?.condition_type || 'disk_below';
  const cfg = _parseCfg(w?.condition_config);
  const isWorkflowAction = (w?.action || '').startsWith('workflow:');
  const workflows = await inv('get_workflows').catch(() => []);

  openModal(isEdit ? 'Edit Watcher' : 'New Watcher', `
    <div class="form-row"><label class="form-label">Name</label>
      <input class="form-input" id="wat-name" value="${esc(w?.name || '')}" placeholder="Low disk space" /></div>

    <div class="form-row"><label class="form-label">Condition</label>
      <select class="form-select" id="wat-type">
        ${Object.entries(COND_LABELS).map(([k, v]) => `<option value="${k}" ${k === type ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
    </div>
    <div class="form-row" id="wat-cfg">${_cfgHtml(type, cfg)}</div>

    <div class="form-row"><label class="form-label">Action</label>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:4px;font-size:11px"><input type="radio" name="wat-action" value="notify" ${!isWorkflowAction ? 'checked' : ''}/> Notify (tray toast)</label>
        <label style="display:flex;align-items:center;gap:4px;font-size:11px"><input type="radio" name="wat-action" value="workflow" ${isWorkflowAction ? 'checked' : ''}/> Run workflow</label>
      </div>
      <select class="form-select" id="wat-workflow-id" style="margin-top:6px" ${isWorkflowAction ? '' : 'disabled'}>
        ${workflows.map(wf => `<option value="${wf.id}" ${isWorkflowAction && w.action === `workflow:${wf.id}` ? 'selected' : ''}>${esc(wf.name)}</option>`).join('')}
      </select>
    </div>

    <div class="form-actions">
      <button class="action-btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="action-btn btn-primary" onclick="window._saveWatcher(${isEdit ? w.id : 'null'})">${isEdit ? 'Save' : 'Create'}</button>
    </div>`);

  document.getElementById('wat-type').addEventListener('change', e => {
    document.getElementById('wat-cfg').innerHTML = _cfgHtml(e.target.value, {});
  });
  document.querySelectorAll('input[name="wat-action"]').forEach(r => {
    r.addEventListener('change', () => {
      document.getElementById('wat-workflow-id').disabled = document.querySelector('input[name="wat-action"]:checked').value !== 'workflow';
    });
  });
};

function _cfgHtml(type, cfg) {
  if (type === 'disk_below') return `
    <div class="two-col">
      <div><label class="form-label">Drive</label><input class="form-input" id="wat-drive" value="${esc(cfg.drive || 'C')}" maxlength="1" /></div>
      <div><label class="form-label">Free % below</label><input class="form-input" id="wat-pct" type="number" min="1" max="99" value="${cfg.pct ?? 10}" /></div>
    </div>`;
  if (type === 'process_down') return `
    <label class="form-label">Process name</label>
    <input class="form-input" id="wat-process" value="${esc(cfg.process || '')}" placeholder="chrome.exe" />`;
  if (type === 'cpu_sustained') return `
    <div class="two-col">
      <div><label class="form-label">CPU % above</label><input class="form-input" id="wat-pct" type="number" min="1" max="100" value="${cfg.pct ?? 80}" /></div>
      <div><label class="form-label">For minutes</label><input class="form-input" id="wat-minutes" type="number" min="1" value="${cfg.minutes ?? 5}" /></div>
    </div>`;
  return '';
}

window._saveWatcher = async (id) => {
  const name = document.getElementById('wat-name')?.value.trim();
  if (!name) { toast('Name required', 'err'); return; }
  const type = document.getElementById('wat-type').value;

  let condition_config;
  if (type === 'disk_below') {
    condition_config = JSON.stringify({ drive: (document.getElementById('wat-drive').value.trim() || 'C').toUpperCase(), pct: +document.getElementById('wat-pct').value || 10 });
  } else if (type === 'process_down') {
    const process = document.getElementById('wat-process').value.trim();
    if (!process) { toast('Process name required', 'err'); return; }
    condition_config = JSON.stringify({ process });
  } else {
    condition_config = JSON.stringify({ pct: +document.getElementById('wat-pct').value || 80, minutes: +document.getElementById('wat-minutes').value || 5 });
  }

  const actionType = document.querySelector('input[name="wat-action"]:checked').value;
  const action = actionType === 'workflow' ? `workflow:${document.getElementById('wat-workflow-id').value}` : 'notify';
  if (actionType === 'workflow' && !document.getElementById('wat-workflow-id').value) { toast('Pick a workflow', 'err'); return; }

  const data = { name, condition_type: type, condition_config, action, enabled: true };
  try {
    if (id) await inv('update_watcher', { id, data });
    else    await inv('add_watcher', { data });
    closeModal();
    toast(id ? 'Watcher saved' : 'Watcher created', 'ok');
    load();
  } catch (e) { toast(String(e), 'err'); }
};

function _parseCfg(json) {
  try { return JSON.parse(json || '{}'); } catch { return {}; }
}
