'use strict';

let _mode = 'edit';

export function load() {
  document.getElementById('compare-run')?.addEventListener('click', _runDiff);
  document.getElementById('compare-clear')?.addEventListener('click', _clear);
  document.getElementById('compare-edit-btn')?.addEventListener('click', _backToEdit);
}

function _clear() {
  document.getElementById('compare-left').value  = '';
  document.getElementById('compare-right').value = '';
  _backToEdit();
  document.getElementById('compare-summary').innerHTML = '';
}

function _backToEdit() {
  _mode = 'edit';
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

  // Group consecutive - and + into change blocks for intra-line highlighting
  const leftLines  = [];
  const rightLines = [];
  let i = 0;
  while (i < hunks.length) {
    const h = hunks[i];
    if (h.t === '=') {
      leftLines.push({ cls: 'cmp-eq',     html: _esc(h.lText) });
      rightLines.push({ cls: 'cmp-eq',    html: _esc(h.rText) });
      i++;
    } else {
      // Collect a change block: gather all adjacent - and + hunks
      const removals = [], additions = [];
      while (i < hunks.length && hunks[i].t !== '=') {
        if (hunks[i].t === '-') removals.push(hunks[i].lText);
        else                    additions.push(hunks[i].rText);
        i++;
      }
      // Pair removals with additions for intra-line char diff
      const pairs = Math.min(removals.length, additions.length);
      for (let p = 0; p < pairs; p++) {
        const { lHtml, rHtml } = _charDiff(removals[p], additions[p]);
        leftLines.push({ cls: 'cmp-rem', html: lHtml });
        rightLines.push({ cls: 'cmp-add', html: rHtml });
      }
      // Unpaired removals
      for (let p = pairs; p < removals.length; p++) {
        leftLines.push({ cls: 'cmp-rem', html: _esc(removals[p]) });
        rightLines.push({ cls: 'cmp-spacer', html: '' });
      }
      // Unpaired additions
      for (let p = pairs; p < additions.length; p++) {
        leftLines.push({ cls: 'cmp-spacer', html: '' });
        rightLines.push({ cls: 'cmp-add', html: _esc(additions[p]) });
      }
    }
  }

  const added     = hunks.filter(h => h.t === '+').length;
  const removed   = hunks.filter(h => h.t === '-').length;
  const unchanged = hunks.filter(h => h.t === '=').length;
  document.getElementById('compare-summary').innerHTML =
    added === 0 && removed === 0
      ? '<span class="cmp-identical">Files are identical</span>'
      : `<span class="cmp-stat rem">&#8722;${removed} removed</span><span class="cmp-stat add">+${added} added</span><span class="cmp-stat eq">${unchanged} unchanged</span>`;

  const renderLines = lines => lines.map((l, i) =>
    `<div class="cmp-line ${l.cls}"><span class="cmp-ln">${l.cls === 'cmp-spacer' ? '' : i + 1}</span><span class="cmp-text">${l.html}</span></div>`
  ).join('');

  document.getElementById('cmp-left-view').innerHTML  = renderLines(leftLines);
  document.getElementById('cmp-right-view').innerHTML = renderLines(rightLines);

  _mode = 'diff';
  document.getElementById('compare-editors').style.display   = 'none';
  document.getElementById('compare-diff-view').style.display = '';
  document.getElementById('compare-edit-btn').style.display  = '';
}

// LCS line diff → [{t, lText, rText}]
function _lineDiff(L, R) {
  const m = L.length, n = R.length;
  const dp = Array.from({length: m+1}, () => new Uint32Array(n+1));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = L[i-1] === R[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
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

// Character-level diff for a changed pair, returns highlighted HTML for both sides
function _charDiff(lStr, rStr) {
  const L = [...lStr], R = [...rStr]; // spread for Unicode char safety
  const m = L.length, n = R.length;
  // ponytail: O(m*n) LCS on chars — fine for single diff lines
  const dp = Array.from({length: m+1}, () => new Uint32Array(n+1));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = L[i-1] === R[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);

  // Backtrack into change runs
  const lOps = [], rOps = []; // 'eq' | 'del' | 'ins'
  let ci = m, cj = n;
  while (ci > 0 || cj > 0) {
    if (ci > 0 && cj > 0 && L[ci-1] === R[cj-1]) {
      lOps.unshift({ t: 'eq', ch: L[ci-1] }); rOps.unshift({ t: 'eq', ch: R[cj-1] }); ci--; cj--;
    } else if (cj > 0 && (ci === 0 || dp[ci][cj-1] >= dp[ci-1][cj])) {
      rOps.unshift({ t: 'ins', ch: R[cj-1] }); cj--;
    } else {
      lOps.unshift({ t: 'del', ch: L[ci-1] }); ci--;
    }
  }

  return { lHtml: _renderCharOps(lOps, 'del'), rHtml: _renderCharOps(rOps, 'ins') };
}

function _renderCharOps(ops, markType) {
  let html = '', inMark = false;
  for (const op of ops) {
    const isMark = op.t === markType;
    if (isMark && !inMark)  { html += '<mark class="cmp-mark">'; inMark = true; }
    if (!isMark && inMark)  { html += '</mark>'; inMark = false; }
    html += _esc(op.ch);
  }
  if (inMark) html += '</mark>';
  return html;
}

const _esc = s => (s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
