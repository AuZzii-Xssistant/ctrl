import { invoke, esc, paneHeader, timeAgo, showOutput, toast } from '../app.js';

const TYPE_ICON = { tool: 'ti-tool', script: 'ti-code', fix: 'ti-bolt', backup: 'ti-device-floppy', workflow: 'ti-player-play' };

const S = { itemType: '', success: '', dateFrom: '', dateTo: '', text: '', rows: [] };

export async function load() {
  const el = document.getElementById('history-scroll');
  el.innerHTML = paneHeader('ti-list-search', 'History', null, null, null)
    + `<div class="sc-filter-bar" id="hist-filter-bar"></div>
       <div id="hist-body"><div class="row-list">${'<div class="skel-row skeleton"></div>'.repeat(6)}</div></div>`;
  _renderFilterBar();
  await _reload();
}

function _renderFilterBar() {
  const fb = document.getElementById('hist-filter-bar');
  if (!fb) return;
  fb.innerHTML = `
<input class="form-input" id="hist-search" placeholder="Search item name…" value="${esc(S.text)}" style="width:160px">
<select class="form-select" id="hist-type">
  <option value="">All Modules</option>
  ${['script','fix','workflow','tool','backup'].map(t => `<option value="${t}" ${S.itemType===t?'selected':''}>${t}</option>`).join('')}
</select>
<select class="form-select" id="hist-success">
  <option value="">Any Result</option>
  <option value="1" ${S.success==='1'?'selected':''}>Success</option>
  <option value="0" ${S.success==='0'?'selected':''}>Failed</option>
</select>
<input class="form-input" type="date" id="hist-from" value="${esc(S.dateFrom)}" title="From date">
<input class="form-input" type="date" id="hist-to" value="${esc(S.dateTo)}" title="To date">
<button class="action-btn btn-ghost" id="hist-export" style="font-size:10px;padding:3px 10px"><i class="ti ti-download"></i> Export</button>
<span class="sc-count" id="hist-count"></span>`;

  document.getElementById('hist-search').oninput  = e => { S.text = e.target.value; _reload(); };
  document.getElementById('hist-type').onchange    = e => { S.itemType = e.target.value; _reload(); };
  document.getElementById('hist-success').onchange = e => { S.success = e.target.value; _reload(); };
  document.getElementById('hist-from').onchange    = e => { S.dateFrom = e.target.value; _reload(); };
  document.getElementById('hist-to').onchange      = e => { S.dateTo = e.target.value; _reload(); };
  document.getElementById('hist-export').onclick   = _exportFiltered;
}

let _reloadTimer = null;
function _reload() {
  clearTimeout(_reloadTimer);
  _reloadTimer = setTimeout(_doReload, 150); // debounce text input
}

async function _doReload() {
  const args = {
    itemType: S.itemType || null,
    success: S.success === '' ? null : S.success === '1',
    dateFrom: S.dateFrom ? `${S.dateFrom} 00:00:00` : null,
    dateTo: S.dateTo ? `${S.dateTo} 23:59:59` : null,
    text: S.text || null,
    limit: 500,
  };
  S.rows = await invoke('get_run_history_filtered', args).catch(() => []);
  _render();
}

function _render() {
  const body = document.getElementById('hist-body');
  const count = document.getElementById('hist-count');
  if (!body) return;
  if (count) count.textContent = `${S.rows.length} run${S.rows.length === 1 ? '' : 's'}`;
  if (!S.rows.length) {
    body.innerHTML = `<div class="empty-state"><i class="ti ti-list-search"></i><p>No runs match these filters.</p></div>`;
    return;
  }
  let html = '<div class="activity-list">';
  for (const r of S.rows) {
    const icon = TYPE_ICON[r.item_type] || 'ti-terminal';
    html += `<div class="activity-row" style="cursor:pointer" data-id="${r.id}">
      <span class="run-dot ${r.success ? 'ok' : 'err'}" title="${r.success ? 'success' : 'failed'}"></span>
      <i class="ti ${icon}" style="font-size:13px;color:var(--text3);flex-shrink:0"></i>
      <span class="activity-name">${esc(r.item_name)}</span>
      <span class="activity-type tag tag-${esc(r.item_type)}">${esc(r.item_type)}</span>
      <span class="run-time">${timeAgo(r.ran_at)}</span>
    </div>`;
  }
  html += '</div>';
  body.innerHTML = html;
  body.querySelectorAll('.activity-row').forEach(row => {
    row.onclick = () => {
      const r = S.rows.find(x => x.id === Number(row.dataset.id));
      if (r) showOutput(r.output || '(no output)', r.success);
    };
  });
}

async function _exportFiltered() {
  if (!S.rows.length) return toast('Nothing to export', 'err');
  const text = S.rows.map(r =>
    `[${r.ran_at}] ${r.success ? 'OK' : 'FAIL'} ${r.item_type}/${r.item_name}\n${(r.output || '').trim()}\n${'─'.repeat(40)}`
  ).join('\n');
  const ok = await invoke('export_text_file', { text, suggested: `ctrl_history_${Date.now()}.txt` }).catch(() => false);
  if (ok) toast('Exported', 'ok');
}
