'use strict';
import { paneHeader } from '../app.js';

// Changelog entries — newest first. Add a block per release.
// Full detail lives in docs/changelog.md; this is a condensed user-facing summary.
const ENTRIES = [
  {
    version: '0.1.1',
    date: '2026-08',
    label: 'ScriptStash port, Tweaks rebuilt on WinUtil, power-user roadmap',
    changes: [
      'Tweaks page rebuilt from scratch: 66 tweaks ported from WinUtil, real on/off/unknown state read from the registry (not a client-side guess), preview-before-running, right-click context menu',
      'Quick Launch moved to its own side panel on the Tools page, with its own filter',
      'Builder credits WinScript with a source pill + About panel (Builder is a ported sub-module, not designed for CTRL from scratch)',
      'Scripts pane rebuilt on ScriptStash: named profiles + Master, drag-reorder, per-script admin/pause flags, real Stop button, PTY-based execution',
      'Command palette: run a script/fix/tool straight from Ctrl+K results',
      'Global hotkey (Ctrl+Shift+Space) + system tray — summon the window and run pinned items from anywhere, closing now asks Minimize to Tray vs. Quit',
      'System Profiles backend (power plan / apps / DNS / audio / refresh rate / custom script) — dedicated page pulled for now, backend stays for a lighter-weight overlay later',
      'A real History page: filter run_log by module/success/date/text, click a row for full output, export to a text file',
      'Workflow macro recorder — record script/fix runs, save them as a workflow',
      'WinScript sync: multi-select debloat app removal (Microsoft/third-party/extensions), an Autounattend button that bakes the built script into a Windows answer file',
      'Workflow steps now respect a script/fix\'s admin-elevation setting instead of silently running unprivileged',
      'Compare view: fixed a mispaired diff highlight when an edited line shared a hunk with an unrelated insertion',
      'Renamed to ">_ CTRL" throughout the UI and docs',
      'Dozens of smaller bug fixes — dangling pins, temp-file races, backup success misreported as failed, and more (see docs/changelog.md for the full list)',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-08',
    label: 'Initial Release',
    changes: [
      'Multi-tab terminal with VSCode-style tab sidebar',
      'Builder: click-anywhere card toggle, group state preserved per tab',
      'WinScript import pipeline (converter + importer bat)',
      'Builder selections reset on restart — no stale state across sessions',
      'Temp file cleanup on every launch',
      'Bug report and support links in topbar',
      'Changelog pane',
    ],
  },
];

export function load() {
  const el = document.getElementById('changelog-scroll');
  if (!el) return;
  const body = ENTRIES.map(e => `
    <div class="cl-entry">
      <div class="cl-header">
        <span class="cl-version">v${e.version}</span>
        <span class="cl-label">${e.label}</span>
        <span class="cl-date">${e.date}</span>
      </div>
      <ul class="cl-list">
        ${e.changes.map(c => `<li>${c}</li>`).join('')}
      </ul>
    </div>`).join('');
  el.innerHTML = paneHeader('ti-notes', 'Changelog', null, null, null)
    + `<div class="cl-body">${body}</div>`;
}
