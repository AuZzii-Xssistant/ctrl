'use strict';

let _lines   = [];   // [{cls, lHtml, rHtml}] built once after diff
let _syncH   = false;

export function load() {
  document.getElementById('compare-run')?.addEventListener('click', _runDiff);
  document.getElementById('compare-clear')?.addEventListener('click', _clear);
  document.getElementById('compare-edit-btn')?.addEventListener('click', _backToEdit);

  const lv = document.getElementById('cmp-left-view');
  const rv = document.getElementById('cmp-right-view');
  if (lv && rv) {
    lv.addEventListener('scroll', () => { if (!_syncH) { _syncH = true; rv.scrollLeft = lv.scrollLeft; _syncH = false; } _drawViewport(); });
    rv.addEventListener('scroll', () => { if (!_syncH) { _syncH = true; lv.scrollLeft = rv.scrollLeft; _syncH = false; } _drawViewport(); });
  }
  document.getElementById('cmp-location')?.addEventListener('click', _locationClick);
}

function _clear() {
  document.getElementById('compare-left').value  = '';
  document.getElementById('compare-right').value = '';
  _backToEdit();
  document.getElementById('compare-summary').innerHTML = '';
}

function _backToEdit() {
  document.getElementById('compare-editors').style.display   = '';
  document.getElementById('compare-diff-view').style.display = 'none';
  document.getElementById('compare-edit-btn').style.display  = 'none';
}

function _runDiff() {
  const leftText  = document.getElementById('compare-left')?.value  ?? '';
  const rightText = document.getElementById('compare-right')?.value ?? '';
  const L = leftText.split('\n');
  const R = rightText.split('\n');
  const hunks = _lineDiff(L, R);

  // Group adjacent - and + into change blocks for paired intra-line diff
  _lines = [];
  let i = 0;
  while (i < hunks.length) {
    const h = hunks[i];
    if (h.t === '=') {
      _lines.push({ cls: 'cmp-eq', lHtml: _esc(h.lText), rHtml: _esc(h.rText) });
      i++;
    } else {
      const removals = [], additions = [];
      while (i < hunks.length && hunks[i].t !== '=') {
        if (hunks[i].t === '-') removals.push(hunks[i].lText);
        else                    additions.push(hunks[i].rText);
        i++;
      }
      const pairs = Math.min(removals.length, additions.length);
      for (let p = 0; p < pairs; p++) {
        const { lHtml, rHtml } = _charDiff(removals[p], additions[p]);
        _lines.push({ cls: 'cmp-chg', lHtml, rHtml });
      }
      for (let p = pairs; p < removals.length; p++)
        _lines.push({ cls: 'cmp-rem-only', lHtml: _esc(removals[p]), rHtml: '' });
      for (let p = pairs; p < additions.length; p++)
        _lines.push({ cls: 'cmp-add-only', lHtml: '', rHtml: _esc(additions[p]) });
    }
  }

  const added   = _lines.filter(l => l.cls === 'cmp-chg' || l.cls === 'cmp-add-only').length;
  const removed = _lines.filter(l => l.cls === 'cmp-chg' || l.cls === 'cmp-rem-only').length;
  const eq      = _lines.filter(l => l.cls === 'cmp-eq').length;
  document.getElementById('compare-summary').innerHTML =
    added === 0 && removed === 0
      ? '<span class="cmp-identical">Files are identical</span>'
      : `<span class="cmp-stat rem">&#8722;${removed} changed/removed</span><span class="cmp-stat add">+${added} changed/added</span><span class="cmp-stat eq">${eq} unchanged</span>`;

  const lInner = document.getElementById('cmp-left-inner');
  const rInner = document.getElementById('cmp-right-inner');
  let lHtml = '', rHtml = '';
  let ln = 0;
  _lines.forEach((line, idx) => {
    const num = line.cls === 'cmp-add-only' ? '' : ++ln && ln;
    lHtml += `<div class="cmp-line cmp-l-${line.cls}" data-idx="${idx}"><span class="cmp-ln">${line.cls === 'cmp-add-only' ? '' : ln}</span><span class="cmp-text">${line.lHtml}</span></div>`;
  });
  ln = 0;
  _lines.forEach((line, idx) => {
    rHtml += `<div class="cmp-line cmp-r-${line.cls}" data-idx="${idx}"><span class="cmp-ln">${line.cls === 'cmp-rem-only' ? '' : ++ln}</span><span class="cmp-text">${line.rHtml}</span></div>`;
  });
  lInner.innerHTML = lHtml;
  rInner.innerHTML = rHtml;

  document.getElementById('compare-editors').style.display   = 'none';
  document.getElementById('compare-diff-view').style.display = '';
  document.getElementById('compare-edit-btn').style.display  = '';

  // Draw location pane after layout settles
  requestAnimationFrame(_drawLocation);
}

// ── Location pane ────────────────────────────────────────────────────────────

function _drawLocation() {
  const canvas = document.getElementById('cmp-location');
  if (!canvas || !_lines.length) return;
  const h = canvas.clientHeight;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 18, h);
  const rowH = Math.max(1, h / _lines.length);
  _lines.forEach((line, i) => {
    const y = i * rowH;
    if      (line.cls === 'cmp-chg')      ctx.fillStyle = 'rgba(251,191,36,.7)';
    else if (line.cls === 'cmp-rem-only') ctx.fillStyle = 'rgba(239,68,68,.7)';
    else if (line.cls === 'cmp-add-only') ctx.fillStyle = 'rgba(16,185,129,.7)';
    else return;
    ctx.fillRect(2, y, 14, Math.max(rowH, 1));
  });
  _drawViewport();
}

function _drawViewport() {
  const canvas = document.getElementById('cmp-location');
  const view   = document.getElementById('cmp-left-view');
  if (!canvas || !view || !_lines.length) return;
  const h      = canvas.height;
  const rowH   = h / _lines.length;
  const lineH  = view.scrollHeight / _lines.length;
  const top    = (view.scrollTop  / lineH) * rowH;
  const visH   = (view.clientHeight / lineH) * rowH;

  // Redraw — clear viewport rect area only by re-reading pixel data isn't worth it; just redraw
  requestAnimationFrame(() => {
    _drawLocation();
    const cv2 = document.getElementById('cmp-location');
    if (!cv2) return;
    const ctx2 = cv2.getContext('2d');
    ctx2.fillStyle = 'rgba(255,255,255,.08)';
    ctx2.fillRect(0, top, 18, Math.max(visH, 4));
    ctx2.strokeStyle = 'rgba(255,255,255,.25)';
    ctx2.strokeRect(0.5, top + 0.5, 17, Math.max(visH, 4) - 1);
  });
}

function _locationClick(e) {
  const canvas = document.getElementById('cmp-location');
  const view   = document.getElementById('cmp-left-view');
  const view2  = document.getElementById('cmp-right-view');
  if (!canvas || !view) return;
  const rect   = canvas.getBoundingClientRect();
  const frac   = (e.clientY - rect.top) / rect.height;
  const target = frac * view.scrollHeight;
  view.scrollTop  = target;
  view2.scrollTop = target;
}

// ── Line diff (LCS) ──────────────────────────────────────────────────────────

function _lineDiff(L, R) {
  const m = L.length, n = R.length;
  const dp = Array.from({length: m+1}, () => new Uint32Array(n+1));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = L[i-1] === R[j-1] ? dp[i-1][j-1]+1 : Math.max(dp[i-1][j], dp[i][j-1]);
  const out = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && L[i-1] === R[j-1]) {
      out.unshift({ t: '=', lText: L[i-1], rText: R[j-1] }); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      out.unshift({ t: '+', rText: R[j-1] }); j--;
    } else {
      out.unshift({ t: '-', lText: L[i-1] }); i--;
    }
  }
  return out;
}

// ── Char diff — prefix/suffix first, LCS only on changed middle ──────────────

function _charDiff(lStr, rStr) {
  const L = [...lStr], R = [...rStr];
  // Common prefix
  let pre = 0;
  while (pre < L.length && pre < R.length && L[pre] === R[pre]) pre++;
  // Common suffix (don't overlap prefix)
  let suf = 0;
  const lRem = L.length - pre, rRem = R.length - pre;
  while (suf < lRem && suf < rRem && L[L.length-1-suf] === R[R.length-1-suf]) suf++;

  const lMid = L.slice(pre, L.length - (suf || 0));
  const rMid = R.slice(pre, R.length - (suf || 0));
  const preHtml   = _esc(L.slice(0, pre).join(''));
  const lSufHtml  = _esc(L.slice(L.length - (suf || 0)).join(''));
  const rSufHtml  = _esc(R.slice(R.length - (suf || 0)).join(''));

  // Highlight the entire differing middle (no inner LCS for chars — avoids scattered highlights)
  const lMidHtml = lMid.length ? `<mark class="cmp-mark">${_esc(lMid.join(''))}</mark>` : '';
  const rMidHtml = rMid.length ? `<mark class="cmp-mark">${_esc(rMid.join(''))}</mark>` : '';

  return { lHtml: preHtml + lMidHtml + lSufHtml, rHtml: preHtml + rMidHtml + rSufHtml };
}

const _esc = s => (s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
