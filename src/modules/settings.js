import { toast } from '../app.js';

const inv = window.__TAURI__.core.invoke;

const SHORTCUTS = [
  { key: 'Ctrl+K',  action: 'Focus global search' },
  { key: 'Escape',  action: 'Close modal / clear search' },
  { key: '↑ ↓',    action: 'Navigate search results' },
  { key: 'Enter',   action: 'Open highlighted search result' },
  { key: 'Right-click', action: 'Context menu on any card or row' },
];

export async function load() {
  const el = document.getElementById('settings-scroll');
  const stats = await inv('get_stats').catch(() => null);
  const statHtml = stats ? `
    <div class="settings-stats">
      ${[['Tools',stats.tools],['Scripts',stats.scripts],['Fixes',stats.fixes],['Workflows',stats.workflows],['Projects',stats.projects],['Total runs',stats.runs]].map(([k,v]) =>
        `<div class="stat-cell"><span class="stat-val">${v}</span><span class="stat-key">${k}</span></div>`
      ).join('')}
    </div>` : '';

  el.innerHTML = `
    <div class="pane-header"><div class="pane-header-title"><i class="ti ti-settings"></i>Settings</div></div>
    <div class="pane-divider"></div>
    <div style="max-width:560px">

    <div class="settings-card">
      <div class="settings-app-name">&gt;_ CTRL</div>
      <div class="settings-version">Version 0.1.1 &mdash; Local-first personal control centre</div>
      <div class="settings-tagline">Tauri v2 &bull; Rust &bull; SQLite &bull; Portable</div>
      ${statHtml}
    </div>

    <div class="settings-section">Data</div>
    <div class="settings-card settings-actions">
      <button class="action-btn btn-secondary" id="s-open-data"><i class="ti ti-folder-open"></i> Open data folder</button>
      <button class="action-btn btn-ghost"     id="s-open-db"  ><i class="ti ti-database"></i> Open DB location</button>
    </div>

    <div class="settings-section">Keyboard shortcuts</div>
    <div class="settings-card">
      <table class="shortcuts-table">
        ${SHORTCUTS.map(s => `
        <tr>
          <td><kbd>${s.key}</kbd></td>
          <td>${s.action}</td>
        </tr>`).join('')}
      </table>
    </div>

    <div class="settings-section">Portable structure</div>
    <div class="settings-card">
      <pre class="settings-tree">CTRL/
  ctrl.exe       ← the app
  ctrl.db        ← all your data
  data/
    builder/     ← action JSON files
    scripts/     ← script storage
    backups/     ← future: backup sets</pre>
    </div>

  </div>
  <div style="height:24px"></div>`;

  document.getElementById('s-open-data').addEventListener('click', async () => {
    try { await inv('open_data_folder'); }
    catch (e) { toast(String(e), 'err'); }
  });
  document.getElementById('s-open-db').addEventListener('click', async () => {
    try { await inv('open_data_folder'); toast('Opened folder containing ctrl.db', 'info'); }
    catch (e) { toast(String(e), 'err'); }
  });
}
