import { invoke, esc, paneHeader, timeAgo } from '../app.js';

const TYPE_ICON = { tool: 'ti-tool', script: 'ti-code', fix: 'ti-bolt', backup: 'ti-device-floppy', workflow: 'ti-player-play' };

export async function load() {
  const el = document.getElementById('activity-scroll');
  el.innerHTML = paneHeader('ti-history', 'Recent Activity', null, null, null)
    + `<div id="activity-body"><div class="row-list">${'<div class="skel-row skeleton"></div>'.repeat(6)}</div></div>`;

  const entries = await invoke('get_recent_activity', { limit: 50 }).catch(() => []);
  _render(entries);
}

function _render(entries) {
  const body = document.getElementById('activity-body');
  if (!body) return;
  if (!entries.length) {
    body.innerHTML = `<div class="empty-state"><i class="ti ti-history"></i><p>No activity yet — run a fix, script, or workflow to see it here.</p></div>`;
    return;
  }
  let html = '<div class="activity-list">';
  for (const a of entries) {
    const icon = TYPE_ICON[a.item_type] || 'ti-terminal';
    html += `<div class="activity-row">
      <span class="run-dot ${a.success ? 'ok' : 'err'}" title="${a.success ? 'success' : 'failed'}"></span>
      <i class="ti ${icon}" style="font-size:13px;color:var(--text3);flex-shrink:0"></i>
      <span class="activity-name">${esc(a.item_name)}</span>
      <span class="activity-type tag tag-${esc(a.item_type)}">${esc(a.item_type)}</span>
      <span class="run-time">${timeAgo(a.ran_at)}</span>
    </div>`;
  }
  html += '</div>';
  body.innerHTML = html;
}
