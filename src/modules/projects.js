import { esc, sectionHdr, emptyState, skeletonRows, paneHeader, toast, openModal, closeModal, confirmDialog, showContextMenu } from '../app.js';

const inv = window.__TAURI__.core.invoke;
const STATUS_ORDER = ['stable','working','prototype','idea','deprecated','replaced'];

const STATUS_CLASS = { stable:'s-stable', working:'s-working', prototype:'s-prototype', idea:'s-idea', deprecated:'s-deprecated', replaced:'s-replaced' };
const TYPE_ICON = { script:'ti-code', exe:'ti-app-window', experiment:'ti-flask', tool:'ti-tool', library:'ti-package', workflow:'ti-player-play', tauri:'ti-brand-tauri', node:'ti-brand-nodejs', web:'ti-world', rust:'ti-brand-rust', python:'ti-brand-python' };

export async function load(search = '') {
  const el = document.getElementById('projects-scroll');
  el.innerHTML = paneHeader('ti-archive', 'Projects', 'Add Project', 'window._showProjectModal(null)', 'projects-filter')
    + `<div id="projects-body">${skeletonRows(4)}</div>`;

  _wireSearch(el, search);

  const projects = await inv('get_projects', { search });
  _render(el, projects);
}

function _render(el, projects) {
  const body = _getBody(el);
  const groups = projects.reduce((acc, p) => { (acc[p.status]=acc[p.status]||[]).push(p); return acc; }, {});
  let html = '';

  if (!projects.length) {
    html = emptyState('ti-archive', 'No projects tracked yet.', '+ Add Project', 'window._showProjectModal(null)');
  } else {
    for (const status of STATUS_ORDER) {
      const items = groups[status];
      if (!items?.length) continue;
      html += sectionHdr(status, items.length) + '<div class="row-list">';
      for (const p of items) {
        const icon = TYPE_ICON[p.type] || 'ti-folder';
        html += `<div class="data-row" data-id="${p.id}">
          <i class="ti ${icon} row-icon"></i>
          <div style="flex:1;min-width:0">
            <div class="row-name" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</div>
            ${p.description ? `<div style="font-size:11px;color:var(--text3);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.description)}</div>` : ''}
            ${p.notes ? `<div style="font-size:10px;color:var(--text3);font-style:italic;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0.7">${esc(p.notes.slice(0,80))}</div>` : ''}
          </div>
          <span class="status-pill ${STATUS_CLASS[p.status]||'s-idea'}">${esc(p.status)}</span>
          <div class="card-actions">
            ${p.path ? `<button class="icon-btn" title="Open location" data-loc="${p.id}"><i class="ti ti-folder-open"></i></button>` : ''}
            <button class="icon-btn" title="Edit" data-edit="${p.id}"><i class="ti ti-edit"></i></button>
            <button class="icon-btn del" title="Remove" data-del="${p.id}"><i class="ti ti-trash"></i></button>
          </div>
        </div>`;
      }
      html += '</div>';
    }
  }
  body.innerHTML = html;

  body.querySelectorAll('.data-row[data-id]').forEach(row => {
    row.addEventListener('contextmenu', e => {
      const id = +row.dataset.id;
      const p = projects.find(x => x.id === id);
      const items = [
        { label: 'Edit', icon: 'ti-edit', fn: () => p && window._showProjectModal(p) },
      ];
      if (p?.path) items.unshift({ label: 'Open folder', icon: 'ti-folder-open', fn: () => inv('open_project_path', { id }) });
      items.push('---', { label: 'Remove', icon: 'ti-trash', danger: true, fn: () => _delete(id) });
      showContextMenu(e, items);
    });
  });
  body.querySelectorAll('[data-loc]').forEach(btn  => btn.addEventListener('click', e => {
    e.stopPropagation();
    inv('open_project_path', { id: +btn.dataset.loc }).catch(err => toast(String(err), 'err'));
  }));
  body.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', async e => {
    e.stopPropagation();
    const all = await inv('get_projects', { search: '' });
    const p = all.find(x => x.id === +btn.dataset.edit);
    if (p) window._showProjectModal(p);
  }));
  body.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); _delete(+btn.dataset.del); }));
}

function _getBody(el) {
  let b = el.querySelector('#projects-body');
  if (!b) { b = document.createElement('div'); b.id = 'projects-body'; el.appendChild(b); }
  return b;
}

function _wireSearch(el, initial) {
  _getBody(el);
  setTimeout(() => {
    const f = document.getElementById('projects-filter');
    if (!f) return;
    f.value = initial;
    let timer;
    f.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const projects = await inv('get_projects', { search: f.value.trim() });
        _render(el, projects);
      }, 180);
    });
  }, 0);
}

async function _delete(id) {
  const ok = await confirmDialog('Remove this project entry?', true);
  if (!ok) return;
  await inv('delete_project', { id });
  toast('Project removed', 'info');
  load();
}

window._showProjectModal = (proj) => {
  const types    = ['script','exe','experiment','tool','library','workflow','tauri','node','web','rust','python','other'].map(t => `<option value="${t}"${proj?.type===t?' selected':''}>${t}</option>`).join('');
  const statuses = ['idea','prototype','working','stable','deprecated','replaced'].map(s => `<option value="${s}"${proj?.status===s?' selected':''}>${s}</option>`).join('');
  openModal(proj ? 'Edit Project' : 'Add Project', `
    <div class="form-row"><label class="form-label">Name</label><input class="form-input" id="f-name" value="${esc(proj?.name||'')}" placeholder="MyBackupSystem" /></div>
    <div class="form-row"><label class="form-label">Description</label><input class="form-input" id="f-desc" value="${esc(proj?.description||'')}" placeholder="What it does" /></div>
    <div class="form-row-2">
      <div class="form-row"><label class="form-label">Type</label><select class="form-select" id="f-type">${types}</select></div>
      <div class="form-row"><label class="form-label">Status</label><select class="form-select" id="f-status">${statuses}</select></div>
    </div>
    <div class="form-row"><label class="form-label">Path</label>
      <div class="path-row">
        <input class="form-input" id="f-path" value="${esc(proj?.path||'')}" placeholder="C:\\projects\\myproject\\" />
        <button class="btn-browse" onclick="window._browseProjectFolder()"><i class="ti ti-folder"></i> Browse</button>
      </div>
    </div>
    <div class="form-row"><label class="form-label">Tags</label><input class="form-input" id="f-tags" value="${esc(proj?.tags||'')}" placeholder="backup, automation" /></div>
    <div class="form-row"><label class="form-label">Notes</label><textarea class="form-textarea" id="f-notes" placeholder="Context, decisions…">${esc(proj?.notes||'')}</textarea></div>
    <div class="form-actions">
      <button class="action-btn btn-ghost" onclick="window._closeProjectModal()">Cancel</button>
      <button class="action-btn btn-primary" onclick="window._saveProject(${proj?.id||'null'})">${proj?'Save':'Add'}</button>
    </div>`);
  window._closeProjectModal = closeModal;
};

window._browseProjectFolder = async () => {
  const path = await inv('browse_for_folder');
  if (path) document.getElementById('f-path').value = path;
};

window._saveProject = async (id) => {
  const data = {
    name:        document.getElementById('f-name').value.trim(),
    description: document.getElementById('f-desc').value.trim(),
    type:        document.getElementById('f-type').value,
    status:      document.getElementById('f-status').value,
    path:        document.getElementById('f-path').value.trim(),
    tags:        document.getElementById('f-tags').value.trim(),
    notes:       document.getElementById('f-notes').value.trim(),
  };
  if (!data.name) { toast('Name required', 'err'); return; }
  try {
    if (id) await inv('update_project', { id, data }); else await inv('add_project', { data });
    closeModal(); toast(id ? 'Project updated' : 'Project added', 'ok'); load();
  } catch (e) { toast(String(e), 'err'); }
};
