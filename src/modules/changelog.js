'use strict';
import { paneHeader } from '../app.js';

// Changelog entries — newest first. Add a block per release.
const ENTRIES = [
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
