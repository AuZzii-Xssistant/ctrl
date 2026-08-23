#!/usr/bin/env node
// Converts WinScript scripts.js + en.json into CTRL-importable scripts JSON.
// Output: winscript-import.json (array of CTRL script objects)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '../../winscript-ref');
const SCRIPTS_JS = path.join(ROOT, 'app/src/assets/js/scripts.js');
const EN_JSON    = path.join(ROOT, 'app/src/i18n/locales/en.json');
const OUT        = path.join(__dirname, '../data/winscript-import.json');

// --- Extract the `scripts` object from scripts.js via bracket counting ---
const src = fs.readFileSync(SCRIPTS_JS, 'utf8');
const marker = 'const scripts = {';
const start = src.indexOf(marker);
if (start === -1) { console.error('scripts object not found'); process.exit(1); }

let depth = 0, i = start + marker.length - 1, end = -1;
for (; i < src.length; i++) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}') { if (--depth === 0) { end = i; break; } }
}
if (end === -1) { console.error('could not find end of scripts object'); process.exit(1); }

// Eval just the object in a sandboxed context
const ctx = { module: { exports: {} }, exports: {} };
vm.runInNewContext('var scripts = ' + src.slice(start + 'const scripts = '.length, end + 1) + '; module.exports = scripts;', ctx);
const scripts = ctx.module.exports;

// --- Load en.json for title/description lookup ---
const en = JSON.parse(fs.readFileSync(EN_JSON, 'utf8'));

// Build reverse index: last segment of key → [{key, value}]
const byId = {};
for (const [k, v] of Object.entries(en)) {
  const parts = k.split('.');
  const id = parts[parts.length - 1];
  if (!byId[id]) byId[id] = [];
  byId[id].push({ key: k, value: v });
}

function lookup(id) {
  // Try exact suffix match for title
  const titleMatch = Object.entries(en).find(([k]) => k.endsWith('.' + id + '.title') || k === id + '.title');
  if (titleMatch) {
    const descMatch = Object.entries(en).find(([k]) => k === titleMatch[0].replace('.title', '.desc'));
    const category = titleMatch[0].split('.')[0];
    return { name: titleMatch[1], description: descMatch ? descMatch[1] : '', category };
  }
  // Try last-segment match (no .title)
  const entries = byId[id] || [];
  // Prefer entry that doesn't end in .title or .desc
  const best = entries.find(e => !e.key.endsWith('.title') && !e.key.endsWith('.desc'));
  if (best) {
    const category = best.key.split('.')[0];
    const descKey = best.key + '.desc';
    return { name: best.value, description: en[descKey] || '', category };
  }
  return null;
}

// Category display map
const catMap = {
  tools: 'Tools', debloat: 'Debloat', privacy: 'Privacy',
  telemetry: 'Telemetry', gaming: 'Gaming', performance: 'Performance',
  miscellaneous: 'Miscellaneous',
};

const out = [];
for (const [id, lines] of Object.entries(scripts)) {
  const content = lines.join('\n');
  const meta = lookup(id);
  const category = meta ? (catMap[meta.category] || meta.category) : 'WinScript';
  out.push({
    name: meta ? meta.name : id,
    description: meta ? meta.description : '',
    category,
    script_type: 'ps1',
    tags: 'winscript',
    run_as_admin: true,
    content,
  });
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log('Wrote ' + out.length + ' scripts to ' + OUT);
