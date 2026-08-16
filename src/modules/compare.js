'use strict';

let _mode = 'edit'; // 'edit' | 'diff'

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
  document.getElementById('compare-editors').style.display  = '';
  document.getElementById('compare-diff-view').style.display = 'none';
  document.getElementById('compare-edit-btn').style.display  = 'none';
}

function _runDiff() {
  const leftText  = document.getElementById('compare-left')?.value  ?? '';
  const rightText = document.getElementById('compare-right')?.value ?? '';
  const L = leftText.split('\n');
  const R = rightText.split('\n');
  const hunks = _diff(L, R);

  let added = 0, removed = 0, unchanged = 0;
  hunks.forEach(h => { if (h.t === '+') added++; else if (h.t === '-') removed++; else unchanged++; });

  document.getElementById('compare-summary').innerHTML =
    (added === 0 && removed === 0
      ? '<span class="cmp-identical">Files are identical</span>'
      : `<span class="cmp-stat rem">&#8722;${removed} removed</span><span class="cmp-stat add">+${added} added</span><span class="cmp-stat eq">${unchanged} unchanged</span>`);

  // Build side-by-side line arrays
  // Left: shows '=' and '-' lines; right: shows '=' and '+' lines
  // Pad with empty spacers so both sides stay aligned
  const leftLines  = [];
  const rightLines = [];
  hunks.forEach(h => {
    if (h.t === '=') {
      leftLines.push({ cls: 'cmp-eq', text: h.text });
      rightLines.push({ cls: 'cmp-eq', text: h.text });
    } else if (h.t === '-') {
      leftLines.push({ cls: 'cmp-rem', text: h.text });
      rightLines.push({ cls: 'cmp-spacer', text: '' });
    } else {
      leftLines.push({ cls: 'cmp-spacer', text: '' });
      rightLines.push({ cls: 'cmp-add', text: h.text });
    }
  });

  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const renderLines = lines => lines.map((l, i) =>
    `<div class="cmp-line ${l.cls}"><span class="cmp-ln">${l.cls === 'cmp-spacer' ? '' : i + 1}</span><span class="cmp-text">${esc(l.text)}</span></div>`
  ).join('');

  document.getElementById('cmp-left-view').innerHTML  = renderLines(leftLines);
  document.getElementById('cmp-right-view').innerHTML = renderLines(rightLines);

  _mode = 'diff';
  document.getElementById('compare-editors').style.display   = 'none';
  document.getElementById('compare-diff-view').style.display = '';
  document.getElementById('compare-edit-btn').style.display  = '';
}

// LCS-based line diff → [{t: '+'|'-'|'=', text}]
function _diff(L, R) {
  const m = L.length, n = R.length;
  const dp = [];
  for (let i = 0; i <= m; i++) { dp[i] = new Uint32Array(n + 1); }
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = L[i-1] === R[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);

  const out = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && L[i-1] === R[j-1]) {
      out.unshift({ t: '=', text: L[i-1] }); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      out.unshift({ t: '+', text: R[j-1] }); j--;
    } else {
      out.unshift({ t: '-', text: L[i-1] }); i--;
    }
  }
  return out;
}
