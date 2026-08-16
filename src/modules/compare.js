'use strict';

export function load() {
  document.getElementById('compare-run')?.addEventListener('click', _runDiff);
  document.getElementById('compare-clear')?.addEventListener('click', _clear);
}

function _clear() {
  document.getElementById('compare-left').value  = '';
  document.getElementById('compare-right').value = '';
  document.getElementById('compare-output').style.display = 'none';
  document.getElementById('compare-diff').innerHTML = '';
}

function _runDiff() {
  const left  = document.getElementById('compare-left')?.value  ?? '';
  const right = document.getElementById('compare-right')?.value ?? '';
  const hunks = _diff(left.split('\n'), right.split('\n'));

  let added = 0, removed = 0, unchanged = 0;
  hunks.forEach(h => { if (h.t === '+') added++; else if (h.t === '-') removed++; else unchanged++; });

  const summary = document.getElementById('compare-summary');
  summary.innerHTML =
    `<span class="cmp-stat add">+${added} added</span>` +
    `<span class="cmp-stat rem">&#8722;${removed} removed</span>` +
    `<span class="cmp-stat eq">${unchanged} unchanged</span>` +
    (added === 0 && removed === 0 ? '<span class="cmp-identical">Files are identical</span>' : '');

  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  document.getElementById('compare-diff').innerHTML =
    '<table class="cmp-table"><tbody>' +
    hunks.map((h, i) => {
      const cls = h.t === '+' ? 'cmp-add' : h.t === '-' ? 'cmp-rem' : 'cmp-eq';
      const sym = h.t === '+' ? '+' : h.t === '-' ? '−' : ' ';
      return `<tr class="${cls}">
        <td class="cmp-ln">${h.ln}</td>
        <td class="cmp-sym">${sym}</td>
        <td class="cmp-text">${esc(h.text)}</td>
      </tr>`;
    }).join('') +
    '</tbody></table>';

  document.getElementById('compare-output').style.display = '';
}

// LCS-based line diff. Returns [{t: '+'|'-'|'=', text, ln}]
function _diff(L, R) {
  const m = L.length, n = R.length;
  // Build LCS table
  const dp = [];
  for (let i = 0; i <= m; i++) { dp[i] = []; for (let j = 0; j <= n; j++) dp[i][j] = 0; }
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = L[i-1] === R[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);

  // Backtrack
  const out = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && L[i-1] === R[j-1]) {
      out.unshift({ t: '=', text: L[i-1], ln: i });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      out.unshift({ t: '+', text: R[j-1], ln: j });
      j--;
    } else {
      out.unshift({ t: '-', text: L[i-1], ln: i });
      i--;
    }
  }
  return out;
}
