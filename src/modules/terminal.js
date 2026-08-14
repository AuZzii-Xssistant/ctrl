'use strict';
import { toast } from '../app.js';

const inv = window.__TAURI__.core.invoke;
const { listen } = window.__TAURI__.event;

let _term    = null;
let _fit     = null;
let _unlisten = [];
let _shell   = 'powershell.exe';
let _open    = false;

export async function load() {
  _ensureXterm();
  const wrap = document.getElementById('term-wrap');
  if (!wrap) return;

  // Only init Terminal once per session
  if (!_term) {
    _term = new window.Terminal({
      theme: {
        background:  '#0d0d0d',
        foreground:  '#e0e0e0',
        cursor:      '#f0a500',
        black:       '#1a1a1a',
        brightBlack: '#444',
      },
      fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      fontSize: 13,
      cursorBlink: true,
      scrollback: 2000,
    });
    _fit = new window.FitAddon.FitAddon();
    _term.loadAddon(_fit);
    _term.open(wrap);
    _term.onData(data => inv('pty_write', { data }));

    // Route PTY output → xterm
    const u1 = await listen('pty-data', e => _term.write(e.payload));
    const u2 = await listen('pty-exit', () => {
      _open = false;
      _term.write('\r\n\x1b[33m[Process exited]\x1b[0m\r\n');
      _updateButtons();
    });
    _unlisten = [u1, u2];
  }

  _fit.fit();
  _updateShellLabel();
  _updateButtons();

  // Auto-open if not already running
  if (!_open) _startShell();
}

function _ensureXterm() {
  if (window.Terminal) return;
  // Should be loaded via <script> tags in index.html
  console.error('xterm not loaded');
}

async function _startShell(admin = false) {
  if (admin) {
    // Admin: launch elevated external powershell (can't embed due to UAC)
    await inv('pty_close');
    _open = false;
    toast('Launching admin terminal…', 'info');
    await inv('open_path', { path: 'powershell.exe -NoLogo -Command "Start-Process powershell -Verb RunAs"' });
    return;
  }
  try {
    const wrap = document.getElementById('term-wrap');
    const cols = Math.floor((wrap?.offsetWidth  || 800) / 8);
    const rows = Math.floor((wrap?.offsetHeight || 400) / 18);
    await inv('pty_open', { shell: _shell, cols, rows });
    _open = true;
    _term.clear();
    _updateButtons();
  } catch(e) {
    toast('Terminal error: ' + e, 'err');
  }
}

async function _killShell() {
  await inv('pty_close');
  _open = false;
  _updateButtons();
}

function _updateShellLabel() {
  const lbl = document.getElementById('term-shell-label');
  if (lbl) lbl.textContent = _shell === 'powershell.exe' ? 'PowerShell' : 'CMD';
}

function _updateButtons() {
  const btnKill  = document.getElementById('term-btn-kill');
  const btnStart = document.getElementById('term-btn-start');
  if (btnKill)  btnKill.disabled  = !_open;
  if (btnStart) btnStart.disabled = _open;
}

// Called by app.js nav wiring when pane becomes visible
window._termResize = () => { if (_fit) _fit.fit(); };

export function initEvents() {
  document.getElementById('term-btn-start')?.addEventListener('click', () => _startShell(false));
  document.getElementById('term-btn-kill')?.addEventListener('click', _killShell);
  document.getElementById('term-btn-admin')?.addEventListener('click', () => _startShell(true));
  document.getElementById('term-btn-clear')?.addEventListener('click', () => _term?.clear());

  document.getElementById('term-shell-ps')?.addEventListener('click', () => {
    _shell = 'powershell.exe'; _updateShellLabel();
  });
  document.getElementById('term-shell-cmd')?.addEventListener('click', () => {
    _shell = 'cmd.exe'; _updateShellLabel();
  });

  // Resize when pane resizes
  const ro = new ResizeObserver(() => { if (_fit && _open) _fit.fit(); });
  const wrap = document.getElementById('term-wrap');
  if (wrap) ro.observe(wrap);
}
