import { invoke, esc, emptyState, showContextMenu, confirmDialog, toast, openModal, closeModal, goPane, showOutput } from '../app.js';

export async function load() {
  const el = document.getElementById('dash-scroll');
  el.innerHTML = `
    <div class="stats-bar">
      <div class="stat-cell" data-pane="tools">   <div class="stat-num">—</div><div class="stat-lbl">Tools</div></div>
      <div class="stat-cell" data-pane="scripts">  <div class="stat-num">—</div><div class="stat-lbl">Scripts</div></div>
      <div class="stat-cell" data-pane="fixes">    <div class="stat-num">—</div><div class="stat-lbl">Fixes</div></div>
      <div class="stat-cell" data-pane="projects"> <div class="stat-num">—</div><div class="stat-lbl">Projects</div></div>
      <div class="stat-cell" data-pane="workflows"><div class="stat-num">—</div><div class="stat-lbl">Workflows</div></div>
    </div>
    <div id="pin-area"></div>`;

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

  render(pins, el.querySelector('#pin-area'));
}

function render(pins, el) {
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
    tile.addEventListener('click', () => runPin(tile));
    tile.addEventListener('contextmenu', e => {
      const pinId = +tile.dataset.pinId;
      showContextMenu(e, [
        { label: 'Launch', icon: 'ti-player-play', fn: () => runPin(tile) },
        '---',
        { label: 'Unpin', icon: 'ti-pin-off', danger: true, fn: () => unpin(pinId) },
      ]);
    });
  });
}

async function runPin(tile) {
  const type = tile.dataset.type, id = +tile.dataset.itemId, name = tile.dataset.name;
  try {
    if (type === 'tool')     { await invoke('launch_tool', { id }); toast('Launched', 'ok'); }
    if (type === 'script')   { toast('Running…', 'info'); const r = await invoke('run_script',  { id }); showOutput(r.output, r.success); toast(r.success ? 'Done' : 'Failed', r.success ? 'ok' : 'err'); }
    if (type === 'fix')      { toast('Running…', 'info'); const r = await invoke('run_fix',     { id }); showOutput(r.output, r.success); toast(r.success ? 'Done' : 'Failed', r.success ? 'ok' : 'err'); }
    if (type === 'workflow')  {
      toast('Running workflow…', 'info');
      const results = await invoke('run_workflow', { id });
      const allOk = results.every(r => r.success);
      showOutput(results.map((r, i) => `[${i+1}/${results.length}] ${r.success?'✓':'✗'} ${r.label}\n${r.output.trim()||'(no output)'}`).join('\n' + '─'.repeat(36) + '\n'), allOk);
      toast(allOk ? `${name || 'Workflow'} complete` : 'Workflow had failures', allOk ? 'ok' : 'err');
    }
  } catch (e) { toast(String(e), 'err'); }
}


async function unpin(id) {
  const ok = await confirmDialog('Remove this pin from your launchpad?');
  if (!ok) return;
  await invoke('unpin_item', { id });
  toast('Unpinned', 'info');
  load();
}

window._openPinPicker = async () => {
  const [tools, scripts, fixes, wfs, currentPins] = await Promise.all([
    invoke('get_tools',     { search: '' }),
    invoke('get_scripts',   { search: '' }),
    invoke('get_fixes',     { search: '' }),
    invoke('get_workflows').catch(() => []),
    invoke('get_pinned').catch(() => []),
  ]);
  const pinned = new Set(currentPins.map(p => `${p.item_type}:${p.item_id}`));
  const sections = [
    { label: 'Tools',     icon: 'ti-app-window',   type: 'tool',     items: tools },
    { label: 'Scripts',   icon: 'ti-code',          type: 'script',   items: scripts },
    { label: 'Fixes',     icon: 'ti-bolt',          type: 'fix',      items: fixes },
    { label: 'Workflows', icon: 'ti-player-play',   type: 'workflow', items: wfs },
  ];
  const totalItems = sections.reduce((s, x) => s + x.items.length, 0);
  let html = `<input class="form-input" id="pin-search" placeholder="Filter…" style="margin-bottom:12px" autocomplete="off" />
    <div id="pin-list" style="max-height:280px;overflow-y:auto;display:flex;flex-direction:column;gap:4px">`;
  if (!totalItems) {
    html += `<div style="text-align:center;color:var(--text3);font-size:12px;padding:24px">No items to pin yet — add tools, scripts or fixes first.</div>`;
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
      if (btn.classList.contains('pin-already')) {
        toast('Already on dashboard', 'info'); return;
      }
      try {
        await invoke('pin_item', { itemType: btn.dataset.type, itemId: +btn.dataset.id, groupName: 'Pinned' });
        closeModal(); toast(`Pinned "${btn.dataset.name}"`, 'ok'); load();
      } catch (err) { toast(String(err), 'err'); }
    });
  });
};
