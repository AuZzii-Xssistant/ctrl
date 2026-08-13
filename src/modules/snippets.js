import { invoke, esc, paneHeader, toast, openModal, closeModal, confirmDialog, showContextMenu, groupBy, sectionHdr } from '../app.js';

let _data = [];

export async function load() {
  const el = document.getElementById('snippets-scroll');
  el.innerHTML = paneHeader('ti-blockquote', 'Snippets', 'Add Snippet', 'window._showSnippetModal(null)', 'snip-filter')
    + `<div id="snip-body"><div class="row-list">${'<div class="skel-row skeleton"></div>'.repeat(6)}</div></div>`;

  setTimeout(() => {
    document.getElementById('snip-filter')?.addEventListener('input', function() {
      _render(this.value.toLowerCase().trim());
    });
  }, 0);

  _data = await invoke('get_snippets', { search: '' }).catch(() => []);
  _render('');
}

function _render(q) {
  const body = document.getElementById('snip-body');
  if (!body) return;
  const items = q ? _data.filter(s => s.title.toLowerCase().includes(q) || s.content.toLowerCase().includes(q) || s.category.toLowerCase().includes(q) || s.tags.toLowerCase().includes(q)) : _data;

  if (!items.length) {
    body.innerHTML = `<div class="empty-state"><i class="ti ti-blockquote"></i><p>${q ? `No snippets match "${esc(q)}"` : 'No snippets yet.'}</p>${!q ? '<button class="action-btn btn-secondary" onclick="window._showSnippetModal(null)">+ Add Snippet</button>' : ''}</div>`;
    return;
  }

  const groups = groupBy(items, 'category');
  let html = '';
  for (const [cat, snippets] of Object.entries(groups)) {
    html += sectionHdr(cat, snippets.length);
    html += '<div class="snip-grid">';
    for (const s of snippets) {
      html += `<div class="snip-card" data-id="${s.id}">
        <div class="snip-header">
          <span class="snip-title">${esc(s.title)}</span>
          <div class="snip-actions">
            <button class="icon-btn" title="Copy" data-copy-id="${s.id}"><i class="ti ti-copy"></i></button>
            <button class="icon-btn" title="Edit" data-edit-id="${s.id}"><i class="ti ti-pencil"></i></button>
            <button class="icon-btn del" title="Delete" data-del-id="${s.id}"><i class="ti ti-trash"></i></button>
          </div>
        </div>
        <pre class="snip-content">${esc(s.content)}</pre>
        ${s.tags ? `<div class="snip-tags">${s.tags.split(',').map(t => `<span class="snip-tag">${esc(t.trim())}</span>`).join('')}</div>` : ''}
      </div>`;
    }
    html += '</div>';
  }
  body.innerHTML = html;

  body.querySelectorAll('[data-copy-id]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const s = _data.find(x => x.id === +btn.dataset.copyId);
    if (!s) return;
    navigator.clipboard.writeText(s.content).then(() => toast(`Copied "${s.title}"`, 'ok')).catch(() => toast('Copy failed', 'err'));
  }));
  body.querySelectorAll('[data-edit-id]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const s = _data.find(x => x.id === +btn.dataset.editId);
    if (s) window._showSnippetModal(s);
  }));
  body.querySelectorAll('[data-del-id]').forEach(btn => btn.addEventListener('click', async e => {
    e.stopPropagation();
    const s = _data.find(x => x.id === +btn.dataset.delId);
    if (!s) return;
    const ok = await confirmDialog(`Delete snippet "${s.title}"?`, true);
    if (!ok) return;
    await invoke('delete_snippet', { id: s.id }).catch(err => { toast(String(err), 'err'); return; });
    toast('Deleted', 'ok');
    _data = await invoke('get_snippets', { search: '' }).catch(() => _data);
    _render(document.getElementById('snip-filter')?.value.toLowerCase().trim() || '');
  }));

  // Right-click context menu
  body.querySelectorAll('.snip-card').forEach(card => {
    card.addEventListener('contextmenu', e => {
      const s = _data.find(x => x.id === +card.dataset.id);
      if (!s) return;
      showContextMenu(e, [
        { label: 'Copy', icon: 'ti-copy', fn: () => navigator.clipboard.writeText(s.content).then(() => toast('Copied', 'ok')) },
        { label: 'Edit', icon: 'ti-pencil', fn: () => window._showSnippetModal(s) },
        '---',
        { label: 'Delete', icon: 'ti-trash', danger: true, fn: () => btn_del(s) },
      ]);
    });
  });
}

async function btn_del(s) {
  const ok = await confirmDialog(`Delete snippet "${s.title}"?`, true);
  if (!ok) return;
  await invoke('delete_snippet', { id: s.id }).catch(err => toast(String(err), 'err'));
  toast('Deleted', 'ok');
  _data = await invoke('get_snippets', { search: '' }).catch(() => _data);
  _render(document.getElementById('snip-filter')?.value.toLowerCase().trim() || '');
}

window._showSnippetModal = (s) => {
  const isEdit = !!s;
  window._closeSnippetModal = closeModal;
  openModal(isEdit ? 'Edit Snippet' : 'Add Snippet', `
    <div class="form-row">
      <label class="form-label">Title <span style="color:var(--red)">*</span></label>
      <input class="form-input" id="sn-title" value="${esc(s?.title || '')}" placeholder="My snippet" />
    </div>
    <div class="form-row">
      <label class="form-label">Content <span style="color:var(--red)">*</span></label>
      <textarea class="form-textarea" id="sn-content" rows="6" style="font-family:var(--mono);font-size:12px" placeholder="Paste your text, command, or snippet here…">${esc(s?.content || '')}</textarea>
    </div>
    <div class="form-row two-col">
      <div>
        <label class="form-label">Category</label>
        <input class="form-input" id="sn-category" value="${esc(s?.category || 'General')}" placeholder="General" />
      </div>
      <div>
        <label class="form-label">Tags</label>
        <input class="form-input" id="sn-tags" value="${esc(s?.tags || '')}" placeholder="tag1, tag2" />
      </div>
    </div>
    <div class="form-actions">
      <button class="action-btn btn-ghost" onclick="window._closeSnippetModal()">Cancel</button>
      <button class="action-btn btn-primary" onclick="window._saveSnippet(${isEdit ? s.id : 'null'})">${isEdit ? 'Save' : 'Add'}</button>
    </div>`);
};

window._saveSnippet = async (id) => {
  const title    = document.getElementById('sn-title').value.trim();
  const content  = document.getElementById('sn-content').value;
  const category = document.getElementById('sn-category').value.trim() || 'General';
  const tags     = document.getElementById('sn-tags').value.trim();
  if (!title)   { toast('Title is required', 'err'); return; }
  if (!content) { toast('Content is required', 'err'); return; }
  try {
    if (id) await invoke('update_snippet', { id, data: { title, content, category, tags } });
    else    await invoke('add_snippet',    { data: { title, content, category, tags } });
    closeModal();
    toast(id ? 'Snippet updated' : 'Snippet added', 'ok');
    _data = await invoke('get_snippets', { search: '' }).catch(() => _data);
    _render(document.getElementById('snip-filter')?.value.toLowerCase().trim() || '');
  } catch (err) { toast(String(err), 'err'); }
};
