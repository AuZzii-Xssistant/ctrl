/**
 * winscript-converter.js
 * Parses WinScript (flick9000/winscript) source and outputs CTRL Builder JSON.
 *
 * Usage:
 *   node tools/winscript-converter.js <winscript-path> [output-dir]
 *   node tools/winscript-converter.js ../winscript-ref data/builder
 *
 * Inputs:
 *   app/src/components/MainPage.astro  — tab/group/toggle structure
 *   app/src/assets/js/scripts.js       — PS1 commands per id
 *   app/src/i18n/locales/en.json       — labels + descriptions
 *
 * Output: data/builder/{n}-{tab}.json  (one per tab, in order)
 *
 * Future WinScript updates: re-run this script after `git pull` in winscript-ref.
 * New ScriptToggle / ScriptGroup entries in MainPage.astro are picked up automatically.
 *
 * CTRL Builder JSON schema:
 * {
 *   "id": "debloat", "label": "Debloat", "icon": "ti-trash",
 *   "items": [
 *     { "type": "group",  "label": "Windows Apps", "desc": "...",
 *       "items": [{ "id": "msapps", "label": "...", "desc": "...", "ps1": "..." }] },
 *     { "type": "radio",  "label": "Set as DNS", "group": "dns",
 *       "items": [{ "id": "googledns", "label": "Google DNS", "ps1": "..." }] },
 *     { "type": "toggle", "id": "microsoftstore", "label": "...", "desc": "...", "ps1": "..." }
 *   ]
 * }
 */

'use strict';
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

// ── Tab order + icons ────────────────────────────────────────────────────────
const TAB_META = {
  tools:        { label: 'Tools',          icon: 'ti-tool',              order: 1 },
  debloat:      { label: 'Debloat',        icon: 'ti-trash',             order: 2 },
  privacy:      { label: 'Privacy',        icon: 'ti-shield-lock',       order: 3 },
  telemetry:    { label: 'Telemetry',      icon: 'ti-eye-off',           order: 4 },
  gaming:       { label: 'Gaming',         icon: 'ti-device-gamepad-2',  order: 5 },
  performance:  { label: 'Performance',    icon: 'ti-rocket',            order: 6 },
  miscellanous: { label: 'Miscellaneous',  icon: 'ti-adjustments',       order: 7 },
};

// ── Helper: find matching close bracket ─────────────────────────────────────
function findClose(str, start, open, close) {
  let depth = 0, inStr = false, strChar = '';
  for (let i = start; i < str.length; i++) {
    const c = str[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === strChar) inStr = false;
    } else if (c === '"' || c === "'" || c === '`') { inStr = true; strChar = c; }
    else if (c === open)  { depth++; }
    else if (c === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// ── Helper: extract a prop value from a JSX-ish props string ────────────────
// Returns { tKey?: string, value?: string } for string/t-ref props
function extractProp(propsStr, name) {
  // Match: name={t["some.key"]}
  const tRe = new RegExp(name + '=\\{t\\["([^"]+)"\\]\\}');
  let m = tRe.exec(propsStr);
  if (m) return { tKey: m[1] };
  // Match: name="value"
  const sRe = new RegExp(name + '="([^"]*)"');
  m = sRe.exec(propsStr);
  if (m) return { value: m[1] };
  return null;
}

// ── Helper: extract tools=[...] from a ScriptGroup props block ──────────────
function extractTools(propsStr) {
  const idx = propsStr.indexOf('tools={[');
  if (idx === -1) return [];
  const arrStart = idx + 'tools={'.length; // points to '['
  const arrEnd   = findClose(propsStr, arrStart, '[', ']');
  if (arrEnd === -1) return [];
  const arrStr = propsStr.slice(arrStart + 1, arrEnd);

  const tools = [];
  // Extract each object { ... }
  let i = 0;
  while (i < arrStr.length) {
    const ob = arrStr.indexOf('{', i);
    if (ob === -1) break;
    const oe = findClose(arrStr, ob, '{', '}');
    if (oe === -1) break;
    const obj = arrStr.slice(ob + 1, oe);
    const tool = {};

    // inputId: "X"
    const idM = /inputId:\s*"([^"]+)"/.exec(obj);
    if (idM) tool.id = idM[1];

    // title: t["key"] or title: "X"
    const titleTM = /title:\s*t\["([^"]+)"\]/.exec(obj);
    const titleSM = /title:\s*"([^"]+)"/.exec(obj);
    if (titleTM) tool.titleKey = titleTM[1];
    else if (titleSM) tool.label = titleSM[1];

    // description: t["key"] or description: "X"
    const descTM = /description:\s*t\["([^"]+)"\]/.exec(obj);
    const descSM = /description:\s*"([^"]+)"/.exec(obj);
    if (descTM) tool.descKey = descTM[1];
    else if (descSM) tool.desc = descSM[1];

    // radio: true
    const radioM = /radio:\s*true/.exec(obj);
    if (radioM) tool.radio = true;

    // group: "G"
    const groupM = /group:\s*"([^"]+)"/.exec(obj);
    if (groupM) tool.group = groupM[1];

    if (tool.id) tools.push(tool);
    i = oe + 1;
  }
  return tools;
}

// ── Parse MainPage.astro ─────────────────────────────────────────────────────
function parseAstro(astroPath, en) {
  const src = fs.readFileSync(astroPath, 'utf8');
  const tabs = {};

  // Find each <Tab tab="X">...</Tab> section
  const tabRe = /<Tab tab="([^"]+)">/g;
  let m;
  while ((m = tabRe.exec(src)) !== null) {
    const tabId  = m[1];
    const start  = m.index + m[0].length;
    const end    = src.indexOf('</Tab>', start);
    if (end === -1) continue;
    const body = src.slice(start, end);
    tabs[tabId] = parseTabBody(body, en);
  }
  return tabs;
}

function label(obj, en) {
  if (obj.tKey) return en[obj.tKey] || obj.tKey;
  return obj.value || '';
}

function parseTabBody(body, en) {
  const items = [];
  let i = 0;

  while (i < body.length) {
    // Find next component tag
    const nextSG = body.indexOf('<ScriptGroup', i);
    const nextST = body.indexOf('<ScriptToggle', i);

    // Pick whichever comes first
    if (nextSG === -1 && nextST === -1) break;
    const useSG = nextSG !== -1 && (nextST === -1 || nextSG < nextST);

    if (useSG) {
      // ScriptGroup: find its self-closing end />
      const tagEnd = body.indexOf('/>', nextSG);
      if (tagEnd === -1) { i = nextSG + 1; continue; }
      const propsStr = body.slice(nextSG + '<ScriptGroup'.length, tagEnd);

      const titleProp = extractProp(propsStr, 'title');
      const descProp  = extractProp(propsStr, 'description');
      const tools     = extractTools(propsStr);
      i = tagEnd + 2;

      if (!tools.length) continue;

      // Check if ALL tools are radio
      const isRadio = tools.length > 0 && tools.every(t => t.radio);
      if (isRadio) {
        // Radio group — mutually exclusive choice
        items.push({
          type:  'radio',
          label: label(titleProp || {}, en),
          desc:  label(descProp  || {}, en),
          group: tools[0].group || ('radio_' + (items.length)),
          items: tools.map(t => ({
            id:    t.id,
            label: t.titleKey ? (en[t.titleKey] || t.titleKey) : (t.label || t.id),
            desc:  t.descKey  ? (en[t.descKey]  || '')         : (t.desc  || ''),
          })),
        });
      } else {
        // Regular group (collapsible)
        items.push({
          type:  'group',
          label: label(titleProp || {}, en),
          desc:  label(descProp  || {}, en),
          items: tools.map(t => ({
            id:    t.id,
            label: t.titleKey ? (en[t.titleKey] || t.titleKey) : (t.label || t.id),
            desc:  t.descKey  ? (en[t.descKey]  || '')         : (t.desc  || ''),
          })),
        });
      }
    } else {
      // ScriptToggle
      const tagEnd = body.indexOf('/>', nextST);
      if (tagEnd === -1) { i = nextST + 1; continue; }
      const propsStr = body.slice(nextST + '<ScriptToggle'.length, tagEnd);

      const idM    = /inputId="([^"]+)"/.exec(propsStr);
      const titleP = extractProp(propsStr, 'title');
      const descP  = extractProp(propsStr, 'description');
      i = tagEnd + 2;

      if (!idM) continue;
      items.push({
        type:  'toggle',
        id:    idM[1],
        label: label(titleP || {}, en),
        desc:  label(descP  || {}, en),
      });
    }
  }
  return items;
}

// ── Load scriptMap from scripts.js (eval via vm) ─────────────────────────────
function loadScripts(jsPath) {
  const raw = fs.readFileSync(jsPath, 'utf8');
  // Find "const scripts = {..." block
  const start = raw.indexOf('const scripts = {');
  if (start === -1) throw new Error('scripts object not found in ' + jsPath);
  const objStart = start + 'const scripts = '.length;
  const objEnd   = findClose(raw, objStart, '{', '}');
  if (objEnd === -1) throw new Error('Could not find end of scripts object');
  const ctx = {};
  vm.runInNewContext('var scripts = ' + raw.slice(objStart, objEnd + 1), ctx);
  // Flatten arrays to joined string
  const map = {};
  for (const [k, v] of Object.entries(ctx.scripts)) {
    map[k] = Array.isArray(v) ? v.join('\n') : String(v);
  }
  return map;
}

// ── Attach scripts to items recursively ──────────────────────────────────────
function attachScripts(items, scriptMap) {
  for (const item of items) {
    if (item.type === 'toggle') {
      item.ps1 = scriptMap[item.id] || null;
      if (!item.ps1) console.warn('  warn: no script for', item.id);
    } else if (item.type === 'group' || item.type === 'radio') {
      for (const sub of item.items || []) {
        sub.ps1 = scriptMap[sub.id] || null;
        if (!sub.ps1) console.warn('  warn: no script for', sub.id);
      }
      // Remove sub-items with no script
      item.items = (item.items || []).filter(s => s.ps1);
    }
  }
  // Remove top-level items with no script
  return items.filter(item => {
    if (item.type === 'toggle') return !!item.ps1;
    return (item.items || []).length > 0;
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
function run(winscriptPath, outDir) {
  const enPath     = path.join(winscriptPath, 'app/src/i18n/locales/en.json');
  const jsPath     = path.join(winscriptPath, 'app/src/assets/js/scripts.js');
  const astroPath  = path.join(winscriptPath, 'app/src/components/MainPage.astro');

  const en         = JSON.parse(fs.readFileSync(enPath, 'utf8'));
  const scriptMap  = loadScripts(jsPath);
  const tabs       = parseAstro(astroPath, en);

  fs.mkdirSync(outDir, { recursive: true });

  // Remove old generated files
  for (const f of fs.readdirSync(outDir)) {
    if (/^\d+-/.test(f) && f.endsWith('.json')) fs.unlinkSync(path.join(outDir, f));
  }

  const ordered = Object.entries(TAB_META).sort((a, b) => a[1].order - b[1].order);
  for (const [tabId, meta] of ordered) {
    const rawItems = tabs[tabId];
    if (!rawItems) { console.log('skip', tabId, '(not in MainPage.astro)'); continue; }
    const items = attachScripts(rawItems, scriptMap);
    if (!items.length) { console.log('skip', tabId, '(no scripts found)'); continue; }

    const n    = String(meta.order).padStart(2, '0');
    const cat  = { id: tabId, label: meta.label, icon: meta.icon, items };
    const file = path.join(outDir, `${n}-${tabId}.json`);
    fs.writeFileSync(file, JSON.stringify(cat, null, 2));

    const total = items.reduce((s, i) => s + (i.items ? i.items.length : 1), 0);
    console.log(`wrote ${file} (${total} actions, ${items.length} top-level items)`);
  }
  console.log('done');
}

const [,, winscriptPath = '../winscript-ref', outDir = 'data/builder'] = process.argv;
run(winscriptPath, outDir);
