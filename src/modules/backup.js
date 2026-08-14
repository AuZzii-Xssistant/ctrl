import { esc, emptyState, paneHeader, skeletonRows, toast, openModal, closeModal, confirmDialog, showContextMenu, showOutput, timeAgo } from '../app.js';

const inv = window.__TAURI__.core.invoke;

export async function load() {
  const el = document.getElementById('backup-scroll');
  const note = `<div class="tweaks-note-inner"><i class="ti ti-info-circle"></i> Copies folders using robocopy. Supports incremental backup — only changed files are copied.</div>`;
  el.innerHTML = paneHeader('ti-device-floppy', 'Backup & Restore', 'New Job', 'window._showBackupModal(null)', null, note)
    + `<div id="bk-body">${skeletonRows(3)}</div>`;

  const jobs = await inv('get_backup_jobs');
  _render(jobs);
}

function _render(jobs) {
  const body = document.getElementById('bk-body');
  if (!body) return;
  if (!jobs.length) {
    body.innerHTML = emptyState('ti-device-floppy', 'No backup jobs yet.', '+ New Job', 'window._showBackupModal(null)');
    return;
  }
  body.innerHTML = '<div class="row-list">' + jobs.map(j => `
    <div class="data-row" data-id="${j.id}">
      <i class="ti ti-device-floppy row-icon" style="color:var(--amber)"></i>
      <div style="flex:1;min-width:0">
        <div class="row-name">${esc(j.name)}</div>
        <div class="row-path">${esc(j.source)} <i class="ti ti-arrow-right" style="font-size:10px;color:var(--text3)"></i> ${esc(j.dest)}</div>
        ${j.last_run ? `<div class="run-time">Last run ${timeAgo(j.last_run)}</div>` : '<div class="run-time" style="color:var(--text3)">Never run</div>'}
      </div>
      <div class="card-actions">
        <button class="run-chip" data-run="${j.id}">RUN</button>
        <button class="icon-btn" title="Edit" data-edit="${j.id}"><i class="ti ti-edit"></i></button>
        <button class="icon-btn del" title="Delete" data-del="${j.id}"><i class="ti ti-trash"></i></button>
      </div>
    </div>`).join('') + '</div>';

  body.querySelectorAll('.data-row[data-id]').forEach(row => {
    const id = +row.dataset.id;
    const j = jobs.find(x => x.id === id);
    row.addEventListener('contextmenu', e => showContextMenu(e, [
      { label: 'Run backup', icon: 'ti-device-floppy', fn: () => _run(id) },
      { label: 'Edit',       icon: 'ti-edit',          fn: () => j && window._showBackupModal(j) },
      '---',
      { label: 'Delete', icon: 'ti-trash', danger: true, fn: () => _delete(id) },
    ]));
  });
  body.querySelectorAll('[data-run]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); _run(+btn.dataset.run); }));
  body.querySelectorAll('#bk-body [data-edit]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const j = jobs.find(x => x.id === +btn.dataset.edit);
    if (j) window._showBackupModal(j);
  }));
  body.querySelectorAll('#bk-body [data-del]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); _delete(+btn.dataset.del); }));
}

async function _run(id) {
  toast('Backup running…', 'info');
  try {
    const r = await inv('run_backup', { id });
    showOutput(r.output, r.success);
    toast(r.success ? 'Backup complete' : 'Backup had issues (check output)', r.success ? 'ok' : 'err');
    const jobs = await inv('get_backup_jobs');
    _render(jobs);
  } catch (e) { toast(String(e), 'err'); }
}

async function _delete(id) {
  const ok = await confirmDialog('Delete this backup job?', true);
  if (!ok) return;
  await inv('delete_backup_job', { id });
  toast('Job deleted', 'info');
  load();
}

window._showBackupModal = (job) => {
  openModal(job ? 'Edit Backup Job' : 'New Backup Job', `
    <div class="form-row"><label class="form-label">Job Name</label>
      <input class="form-input" id="bk-name" value="${esc(job?.name || '')}" placeholder="My Documents Backup" /></div>
    <div class="form-row"><label class="form-label">Source Folder</label>
      <div class="path-row">
        <input class="form-input" id="bk-src" value="${esc(job?.source || '')}" placeholder="C:\\Users\\You\\Documents" />
        <button class="btn-browse" onclick="window._browseBkFolder('bk-src')"><i class="ti ti-folder"></i> Browse</button>
      </div>
    </div>
    <div class="form-row"><label class="form-label">Destination Folder</label>
      <div class="path-row">
        <input class="form-input" id="bk-dst" value="${esc(job?.dest || '')}" placeholder="D:\\Backups\\Documents" />
        <button class="btn-browse" onclick="window._browseBkFolder('bk-dst')"><i class="ti ti-folder"></i> Browse</button>
      </div>
    </div>
    <div class="form-actions">
      <button class="action-btn btn-ghost" onclick="window._closeBkModal()">Cancel</button>
      <button class="action-btn btn-primary" onclick="window._saveBackup(${job?.id || 'null'})">${job ? 'Save' : 'Create'}</button>
    </div>`);
  window._closeBkModal = closeModal;
};

window._browseBkFolder = async (inputId) => {
  const path = await inv('browse_for_folder');
  if (path) document.getElementById(inputId).value = path;
};

window._saveBackup = async (id) => {
  const data = {
    name:   document.getElementById('bk-name')?.value.trim(),
    source: document.getElementById('bk-src')?.value.trim(),
    dest:   document.getElementById('bk-dst')?.value.trim(),
  };
  if (!data.name || !data.source || !data.dest) { toast('All fields required', 'err'); return; }
  try {
    if (id) await inv('update_backup_job', { id, data });
    else     await inv('add_backup_job', { data });
    closeModal(); toast(id ? 'Job updated' : 'Job created', 'ok'); load();
  } catch (e) { toast(String(e), 'err'); }
};
