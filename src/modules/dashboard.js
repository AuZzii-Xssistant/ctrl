import { invoke, esc, emptyState, showContextMenu, confirmDialog, toast, openModal, closeModal, goPane, showOutput } from '../app.js';

const SYS_CACHE_KEY  = 'ctrl_sys_info';
const PERF_OPEN_KEY  = 'ctrl_perf_open';

let _initialized   = false;
let _perfInterval  = null;
let _prevNetRecv   = 0, _prevNetSent = 0, _prevNetTs = 0;

export async function load() {
  if (_initialized) {
    // Already built — just make sure perf is polling, nothing else to do
    _startPerfPolling();
    return;
  }
  _initialized = true;

  const el = document.getElementById('dash-scroll');
  el.innerHTML = `
    <div class="stats-bar">
      <div class="stat-cell" data-pane="tools">    <div class="stat-num">—</div><div class="stat-lbl">Tools</div></div>
      <div class="stat-cell" data-pane="scripts">  <div class="stat-num">—</div><div class="stat-lbl">Scripts</div></div>
      <div class="stat-cell" data-pane="fixes">    <div class="stat-num">—</div><div class="stat-lbl">Fixes</div></div>
      <div class="stat-cell" data-pane="projects"> <div class="stat-num">—</div><div class="stat-lbl">Projects</div></div>
      <div class="stat-cell" data-pane="workflows"><div class="stat-num">—</div><div class="stat-lbl">Workflows</div></div>
    </div>
    <div id="sys-info-bar" class="sys-info-bar">
      <span class="sys-chip" id="si-user"><i class="ti ti-user"></i> —</span>
      <span class="sys-chip" id="si-host"><i class="ti ti-device-desktop"></i> —</span>
      <span class="sys-chip" id="si-cpu"><i class="ti ti-cpu"></i> —</span>
      <span class="sys-chip" id="si-os"><i class="ti ti-brand-windows"></i> —</span>
      <span class="sys-chip" id="si-ram"><i class="ti ti-server"></i> — GB RAM</span>
      <span class="sys-chip" id="si-up"><i class="ti ti-clock"></i> up —</span>
    </div>
    <div id="pin-area"></div>`;

  // Restore perf panel collapse state
  _applyPerfCollapse(localStorage.getItem(PERF_OPEN_KEY) !== 'false');
  document.getElementById('perf-toggle')?.addEventListener('click', _togglePerf);

  // Show cached sys info immediately
  const cached = _loadSysCache();
  if (cached) _applySysInfo(cached);

  // Load stats + pins in parallel (independent of sys-info)
  const [stats, pins] = await Promise.all([
    invoke('get_stats').catch(() => null),
    invoke('get_pinned').catch(() => []),
  ]);

  if (stats) {
    const vals = [stats.tools, stats.scripts, stats.fixes, stats.projects, stats.workflows ?? 0];
    el.querySelectorAll('.stat-cell').forEach((c, i) => {
      c.querySelector('.stat-num').textContent = vals[i];
      c.addEventListener('click', () => goPane(c.dataset.pane));
    });
  }

  _renderPins(pins, el.querySelector('#pin-area'));

  // Background-refresh sys info — doesn't block or re-render anything else
  invoke('get_sys_info').then(info => {
    const prev = _loadSysCache();
    const structChanged = !prev
      || prev.hostname !== info.hostname || prev.username !== info.username
      || prev.os !== info.os || prev.ram_gb !== info.ram_gb || prev.cpu !== info.cpu;
    if (structChanged) {
      _applySysInfo(info);
    } else {
      // Only update uptime chip
      _setChip('si-up', 'ti-clock', `up ${esc(info.uptime)}`);
    }
    localStorage.setItem(SYS_CACHE_KEY, JSON.stringify(info));
  }).catch(() => {});

  // Start live perf polling
  _startPerfPolling();
}

// ── Sys info ─────────────────────────────────────────────────────────────────

function _loadSysCache() {
  try { return JSON.parse(localStorage.getItem(SYS_CACHE_KEY)); } catch { return null; }
}

function _setChip(id, icon, html) {
  const e = document.getElementById(id);
  if (e) e.innerHTML = `<i class="ti ${icon}"></i> ${html}`;
}

function _applySysInfo(info) {
  _setChip('si-user', 'ti-user',           esc(info.username));
  _setChip('si-host', 'ti-device-desktop', esc(info.hostname));
  _setChip('si-cpu',  'ti-cpu',            esc(info.cpu));
  _setChip('si-os',   'ti-brand-windows',  esc(info.os));
  _setChip('si-ram',  'ti-server',         `${esc(info.ram_gb)} GB RAM`);
  _setChip('si-up',   'ti-clock',          `up ${esc(info.uptime)}`);
}

// ── Perf panel ───────────────────────────────────────────────────────────────

function _startPerfPolling() {
  if (_perfInterval) clearInterval(_perfInterval);
  _prevNetRecv = 0; _prevNetSent = 0; _prevNetTs = 0;
  _pollPerf();
  _perfInterval = setInterval(_pollPerf, 1500);
}

async function _pollPerf() {
  if (!document.getElementById('dash-pane')?.classList.contains('active')) return;
  try { _updatePerfUI(await invoke('get_perf_stats')); } catch {}
}

function _updatePerfUI(p) {
  _setBar('pm-cpu-bar', p.cpu_pct);
  _setText('pm-cpu-val', `${p.cpu_pct}%`);

  const ramPct = p.ram_total_gb > 0 ? Math.round((p.ram_used_gb / p.ram_total_gb) * 100) : 0;
  _setBar('pm-ram-bar', ramPct);
  _setText('pm-ram-val', `${p.ram_used_gb.toFixed(1)} / ${p.ram_total_gb.toFixed(0)} GB`);

  const now = Date.now();
  if (_prevNetTs > 0 && now > _prevNetTs) {
    const secs  = (now - _prevNetTs) / 1000;
    const down  = (p.net_recv_bytes - _prevNetRecv) / secs;
    const up    = (p.net_sent_bytes - _prevNetSent) / secs;
    _setText('pn-down', _fmtRate(Math.max(0, down)));
    _setText('pn-up',   _fmtRate(Math.max(0, up)));
  }
  _prevNetRecv = p.net_recv_bytes;
  _prevNetSent = p.net_sent_bytes;
  _prevNetTs   = now;

  // Drives — only update if count matches (avoid full rebuild every tick)
  const drivesEl = document.getElementById('pm-drives');
  if (!drivesEl) return;
  const drives = p.drives || [];
  if (drivesEl.children.length !== drives.length) {
    // Build/rebuild drive rows
    drivesEl.innerHTML = drives.map(d => {
      const pct = d.total_gb > 0 ? Math.round((d.used_gb / d.total_gb) * 100) : 0;
      const warn = pct > 85 ? ' pm-bar-warn' : '';
      return `<div class="perf-metric pm-drive" data-drive="${esc(d.name)}">
        <span class="pm-label"><i class="ti ti-device-hdd"></i> ${esc(d.name)}:</span>
        <div class="pm-bar-wrap"><div class="pm-bar${warn}" id="pd-bar-${esc(d.name)}" style="width:${pct}%"></div></div>
        <span class="pm-val" id="pd-val-${esc(d.name)}">${d.used_gb.toFixed(0)} / ${d.total_gb.toFixed(0)} GB</span>
      </div>`;
    }).join('');
  } else {
    // Update bar widths + values in-place
    for (const d of drives) {
      const pct  = d.total_gb > 0 ? Math.round((d.used_gb / d.total_gb) * 100) : 0;
      const bar  = document.getElementById(`pd-bar-${d.name}`);
      const val  = document.getElementById(`pd-val-${d.name}`);
      if (bar) { bar.style.width = pct + '%'; bar.className = `pm-bar${pct > 85 ? ' pm-bar-warn' : ''}`; }
      if (val) val.textContent = `${d.used_gb.toFixed(0)} / ${d.total_gb.toFixed(0)} GB`;
    }
  }
}

function _setBar(id, pct) {
  const el = document.getElementById(id);
  if (el) el.style.width = Math.max(0, Math.min(100, pct)) + '%';
}

function _setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function _fmtRate(bps) {
  if (bps < 1024)           return `${bps.toFixed(0)} B/s`;
  if (bps < 1024 * 1024)    return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / 1024 / 1024).toFixed(2)} MB/s`;
}

// ── Collapse ──────────────────────────────────────────────────────────────────

function _togglePerf() {
  const open = document.getElementById('dash-perf')?.classList.contains('perf-expanded');
  _applyPerfCollapse(!open);
  localStorage.setItem(PERF_OPEN_KEY, String(!open));
}

function _applyPerfCollapse(open) {
  const panel = document.getElementById('dash-perf');
  const body  = document.getElementById('perf-body');
  const icon  = document.querySelector('#perf-toggle i');
  const label = document.getElementById('perf-title-text');
  if (!panel) return;
  if (open) {
    panel.classList.add('perf-expanded');
    if (body)  body.style.display = '';
    if (icon)  icon.className = 'ti ti-chevron-right';
    if (label) label.style.display = '';
  } else {
    panel.classList.remove('perf-expanded');
    if (body)  body.style.display = 'none';
    if (icon)  icon.className = 'ti ti-chevron-left';
    if (label) label.style.display = 'none';
  }
}

// ── Pins ──────────────────────────────────────────────────────────────────────

function _renderPins(pins, el) {
  if (!pins.length) {
    el.innerHTML = emptyState('ti-pin', 'Nothing pinned yet.', '+ Pin something', 'window._openPinPicker()') +
      `<p style="font-size:11px;color:var(--text3);text-align:center;max-width:280px;margin:-8px auto 0;line-height:1.6">
        Pin scripts, tools, and quick fixes here for one-click access.</p>`;
    return;
  }

  const groups = pins.reduce((acc, p) => { (acc[p.group_name] = acc[p.group_name] || []).push(p); return acc; }, {});

  let html = `<div style="display:flex;align-items:center;justify-content:space-between;margin:14px 0 10px">
    <span style="font-family:var(--mono);font-size:10px;color:var(--text3);letter-spacing:.1em;text-transform:uppercase">Launchpad</span>
    <button class="action-btn btn-secondary" onclick="window._openPinPicker()" style="font-size:10px;padding:3px 10px">
      <i class="ti ti-pin"></i> Pin
    </button>
  </div>`;

  for (const [group, items] of Object.entries(groups)) {
    html += `<div class="dash-group">
      <div class="dash-group-header"><span class="dash-group-name">${esc(group)}</span></div>
      <div class="dash-tile-grid">`;
    for (const p of items) {
      html += `<div class="dash-tile" data-pin-id="${p.id}" data-type="${p.item_type}" data-item-id="${p.item_id}" data-name="${esc(p.item_name)}" title="${esc(p.item_name)}">
        <i class="ti ${esc(p.item_icon)}"></i>
        <div class="dash-tile-name">${esc(p.item_name)}</div>
        <span class="tag tag-${esc(p.item_type)}">${esc(p.item_type)}</span>
      </div>`;
    }
    html += '</div></div>';
  }
  el.innerHTML = html;

  el.querySelectorAll('.dash-tile').forEach(tile => {
    tile.addEventListener('click', () => _runPin(tile));
    tile.addEventListener('contextmenu', e => {
      const pinId = +tile.dataset.pinId;
      showContextMenu(e, [
        { label: 'Launch', icon: 'ti-player-play', fn: () => _runPin(tile) },
        '---',
        { label: 'Unpin', icon: 'ti-pin-off', danger: true, fn: () => _unpin(pinId) },
      ]);
    });
  });
}

async function _runPin(tile) {
  const type = tile.dataset.type, id = +tile.dataset.itemId, name = tile.dataset.name;
  try {
    if (type === 'tool')    { await invoke('launch_tool', { id }); toast('Launched', 'ok'); }
    if (type === 'script')  { toast('Running…', 'info'); const r = await invoke('run_script', { id }); showOutput(r.output, r.success); toast(r.success ? 'Done' : 'Failed', r.success ? 'ok' : 'err'); }
    if (type === 'fix')     { toast('Running…', 'info'); const r = await invoke('run_fix',    { id }); showOutput(r.output, r.success); toast(r.success ? 'Done' : 'Failed', r.success ? 'ok' : 'err'); }
    if (type === 'workflow') {
      toast('Running workflow…', 'info');
      const results = await invoke('run_workflow', { id });
      const allOk = results.every(r => r.success);
      showOutput(results.map((r, i) => `[${i+1}/${results.length}] ${r.success?'✓':'✗'} ${r.label}\n${r.output.trim()||'(no output)'}`).join('\n' + '─'.repeat(36) + '\n'), allOk);
      toast(allOk ? `${name || 'Workflow'} complete` : 'Workflow had failures', allOk ? 'ok' : 'err');
    }
  } catch (e) { toast(String(e), 'err'); }
}

async function _unpin(id) {
  const ok = await confirmDialog('Remove this pin from your launchpad?');
  if (!ok) return;
  await invoke('unpin_item', { id });
  toast('Unpinned', 'info');
  // Reset init so pins reload on next visit
  _initialized = false;
  load();
}

window._openPinPicker = async () => {
  const [tools, scripts, fixes, wfs, currentPins] = await Promise.all([
    invoke('get_tools',    { search: '' }),
    invoke('get_scripts',  { search: '' }),
    invoke('get_fixes',    { search: '' }),
    invoke('get_workflows').catch(() => []),
    invoke('get_pinned').catch(() => []),
  ]);
  const pinned = new Set(currentPins.map(p => `${p.item_type}:${p.item_id}`));
  const sections = [
    { label: 'Tools',     icon: 'ti-app-window',  type: 'tool',     items: tools },
    { label: 'Scripts',   icon: 'ti-code',         type: 'script',   items: scripts },
    { label: 'Fixes',     icon: 'ti-bolt',         type: 'fix',      items: fixes },
    { label: 'Workflows', icon: 'ti-player-play',  type: 'workflow', items: wfs },
  ];
  const totalItems = sections.reduce((s, x) => s + x.items.length, 0);
  let html = `<input class="form-input" id="pin-search" placeholder="Filter…" style="margin-bottom:12px" autocomplete="off" />
    <div id="pin-list" style="max-height:280px;overflow-y:auto;display:flex;flex-direction:column;gap:4px">`;
  if (!totalItems) {
    html += `<div style="text-align:center;color:var(--text3);font-size:12px;padding:24px">No items to pin yet.</div>`;
  } else {
    for (const s of sections) {
      if (!s.items.length) continue;
      html += `<div style="font-family:var(--mono);font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;padding:6px 0 4px">${s.label}</div>`;
      for (const item of s.items) {
        const isPinned = pinned.has(`${s.type}:${item.id}`);
        html += `<button class="data-row pin-pick-item${isPinned ? ' pin-already' : ''}" data-type="${s.type}" data-id="${item.id}" data-name="${esc(item.name)}" ${isPinned ? 'title="Already on dashboard"' : ''}>
          <i class="ti ${s.icon} row-icon"></i>
          <span class="row-name">${esc(item.name)}</span>
          <span class="row-meta">${esc(item.category || '')}</span>
          ${isPinned ? '<i class="ti ti-pin-filled" style="font-size:11px;color:var(--amber);flex-shrink:0"></i>' : ''}
        </button>`;
      }
    }
  }
  html += `</div><div class="form-actions" style="margin-top:12px"><button class="action-btn btn-ghost" onclick="window._closePinModal()">Cancel</button></div>`;
  openModal('Pin to Dashboard', html);
  window._closePinModal = closeModal;

  document.getElementById('pin-search')?.addEventListener('input', function() {
    const q = this.value.toLowerCase();
    document.querySelectorAll('.pin-pick-item').forEach(btn => {
      btn.style.display = btn.dataset.name.toLowerCase().includes(q) ? '' : 'none';
    });
  });

  document.querySelectorAll('.pin-pick-item').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (btn.classList.contains('pin-already')) { toast('Already on dashboard', 'info'); return; }
      try {
        await invoke('pin_item', { itemType: btn.dataset.type, itemId: +btn.dataset.id, groupName: 'Pinned' });
        closeModal(); toast(`Pinned "${btn.dataset.name}"`, 'ok');
        _initialized = false; load();
      } catch (err) { toast(String(err), 'err'); }
    });
  });
};
