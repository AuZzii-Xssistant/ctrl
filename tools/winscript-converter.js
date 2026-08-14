/**
 * winscript-converter.js
 * Parses WinScript (flick9000/winscript) source → CTRL Builder JSON.
 *
 * Usage:
 *   node tools/winscript-converter.js [winscript-path] [output-dir]
 *   node tools/winscript-converter.js ../winscript-ref data/builder
 *
 * Inputs:
 *   app/src/components/MainPage.astro  — tab / group / toggle structure + icons
 *   app/src/assets/js/scripts.js       — PS1 commands per id + presets
 *   app/src/assets/js/appinstall.js    — app installer data (Choco + winget)
 *   app/src/i18n/locales/en.json       — labels + descriptions
 *
 * Outputs: data/builder/
 *   {n}-{tab}.json   — one per script tab (Tools, Debloat, Privacy …)
 *   08-apps.json     — app installer tab (generated from appinstall.js)
 *   _meta.json       — presets (basic/strict/extreme) pulled from scripts.js
 *
 * Re-import after WinScript update:
 *   cd M:/Projects/winscript-ref && git pull
 *   cd M:/Projects/CTRL && node tools/winscript-converter.js ../winscript-ref data/builder
 */

'use strict';
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

// ── Tab order + Tabler icon ──────────────────────────────────────────────────
const TAB_META = {
  tools:        { label: 'Tools',         icon: 'ti-tool',             order: 1 },
  debloat:      { label: 'Debloat',       icon: 'ti-trash',            order: 2 },
  privacy:      { label: 'Privacy',       icon: 'ti-shield-lock',      order: 3 },
  telemetry:    { label: 'Telemetry',     icon: 'ti-eye-off',          order: 4 },
  gaming:       { label: 'Gaming',        icon: 'ti-device-gamepad-2', order: 5 },
  performance:  { label: 'Performance',   icon: 'ti-rocket',           order: 6 },
  miscellanous: { label: 'Miscellaneous', icon: 'ti-adjustments',      order: 7 },
};

// ── Bracket matcher ──────────────────────────────────────────────────────────
function findClose(str, start, open, close) {
  let depth = 0, inStr = false, strChar = '';
  for (let i = start; i < str.length; i++) {
    const c = str[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === strChar) inStr = false;
    } else if (c === '"' || c === "'" || c === '`') { inStr = true; strChar = c; }
    else if (c === open)  depth++;
    else if (c === close) { if (--depth === 0) return i; }
  }
  return -1;
}

// ── Extract a single JSX prop value ─────────────────────────────────────────
function extractProp(propsStr, name) {
  // name={t["key"]}
  let m = new RegExp(name + '=\\{t\\["([^"]+)"\\]\\}').exec(propsStr);
  if (m) return { tKey: m[1] };
  // name="value"
  m = new RegExp(name + '="([^"]*)"').exec(propsStr);
  if (m) return { value: m[1] };
  return null;
}

function propValue(prop, en) {
  if (!prop) return '';
  if (prop.tKey) return en[prop.tKey] || prop.tKey;
  return prop.value || '';
}

// Strips leading /icons/ from WinScript icon paths → relative path
function iconRel(raw) {
  if (!raw) return null;
  return raw.replace(/^\/icons\//, '') || null;
}

// ── Extract tools=[...] from ScriptGroup props ───────────────────────────────
function extractTools(propsStr) {
  const idx = propsStr.indexOf('tools={[');
  if (idx === -1) return [];
  const arrStart = idx + 'tools={'.length;
  const arrEnd   = findClose(propsStr, arrStart, '[', ']');
  if (arrEnd === -1) return [];
  const arrStr = propsStr.slice(arrStart + 1, arrEnd);

  const tools = [];
  let i = 0;
  while (i < arrStr.length) {
    const ob = arrStr.indexOf('{', i);
    if (ob === -1) break;
    const oe = findClose(arrStr, ob, '{', '}');
    if (oe === -1) break;
    const obj = arrStr.slice(ob + 1, oe);
    const tool = {};

    const idM     = /inputId:\s*"([^"]+)"/.exec(obj);
    const titleTM = /title:\s*t\["([^"]+)"\]/.exec(obj);
    const titleSM = /title:\s*"([^"]+)"/.exec(obj);
    const descTM  = /description:\s*t\["([^"]+)"\]/.exec(obj);
    const descSM  = /description:\s*"([^"]+)"/.exec(obj);
    const radioM  = /radio:\s*true/.exec(obj);
    const groupM  = /group:\s*"([^"]+)"/.exec(obj);

    if (idM)    tool.id       = idM[1];
    if (titleTM) tool.titleKey = titleTM[1];
    else if (titleSM) tool.label = titleSM[1];
    if (descTM) tool.descKey = descTM[1];
    else if (descSM) tool.desc = descSM[1];
    if (radioM) tool.radio = true;
    if (groupM) tool.group = groupM[1];

    if (tool.id) tools.push(tool);
    i = oe + 1;
  }
  return tools;
}

// ── Special items handled by WinScript's main.js (not in scripts.js) ─────────
// restorepoint and installmas have no PS1 in scripts.js — inject them here.
// ButtonEntry items open Windows dialogs — stored as type 'shortcut'.
const SPECIAL_PS1 = {
  restorepoint: [
    '$desc = "CTRL Restore Point $(Get-Date -Format \'yyyy-MM-dd HH:mm\')"',
    'Enable-ComputerRestore -Drive "C:\\" -ErrorAction SilentlyContinue',
    'Checkpoint-Computer -Description $desc -RestorePointType "MODIFY_SETTINGS"',
    'Write-Host "Restore point created: $desc"',
  ].join('\n'),
  installmas: [
    '# Microsoft Activation Scripts — activates Windows/Office (requires internet)',
    '# Source: https://massgrave.dev',
    'irm https://get.activated.win | iex',
  ].join('\n'),
};

const BUTTON_CMDS = {
  openSettings:       'ms-settings:',
  openDeviceManager:  'devmgmt.msc',
  openControlPanel:   'control',
  openVisualEffects:  'SystemPropertiesPerformance',
  openPageFile:       'SystemPropertiesAdvanced',
  openMSConfig:       'msconfig',
};

// ── Parse MainPage.astro ─────────────────────────────────────────────────────
function parseAstro(astroPath, en) {
  const src  = fs.readFileSync(astroPath, 'utf8');
  const tabs = {};

  const tabRe = /<Tab tab="([^"]+)">/g;
  let m;
  while ((m = tabRe.exec(src)) !== null) {
    const tabId = m[1];
    const start = m.index + m[0].length;
    const end   = src.indexOf('</Tab>', start);
    if (end === -1) continue;
    tabs[tabId] = parseTabBody(src.slice(start, end), en);
  }
  return tabs;
}

function parseTabBody(body, en) {
  const items = [];
  let i = 0;

  while (i < body.length) {
    const nextSG = body.indexOf('<ScriptGroup', i);
    const nextST = body.indexOf('<ScriptToggle', i);
    const nextBE = body.indexOf('<ButtonEntry', i);

    if (nextSG === -1 && nextST === -1 && nextBE === -1) break;

    // ButtonEntry — skip; these live in the Tools tab Quick Launch section, not the builder
    if (nextBE !== -1 && (nextSG === -1 || nextBE < nextSG) && (nextST === -1 || nextBE < nextST)) {
      const tagEnd = body.indexOf('/>', nextBE);
      i = tagEnd >= 0 ? tagEnd + 2 : nextBE + 1;
      continue;
    }

    const useSG = nextSG !== -1 && (nextST === -1 || nextSG < nextST);

    if (useSG) {
      const tagEnd = body.indexOf('/>', nextSG);
      if (tagEnd === -1) { i = nextSG + 1; continue; }
      const propsStr = body.slice(nextSG + '<ScriptGroup'.length, tagEnd);

      const titleProp = extractProp(propsStr, 'title');
      const descProp  = extractProp(propsStr, 'description');
      const iconProp  = extractProp(propsStr, 'icon');
      const tools     = extractTools(propsStr);
      i = tagEnd + 2;

      if (!tools.length) continue;

      const icon    = iconRel(propValue(iconProp, en));
      const isRadio = tools.every(t => t.radio);

      if (isRadio) {
        items.push({
          type:  'radio',
          label: propValue(titleProp, en),
          desc:  propValue(descProp, en),
          group: tools[0].group || ('radio_' + items.length),
          icon,
          items: tools.map(t => ({
            id:    t.id,
            label: t.titleKey ? (en[t.titleKey] || t.titleKey) : (t.label || t.id),
            desc:  t.descKey  ? (en[t.descKey]  || '')         : (t.desc  || ''),
          })),
        });
      } else {
        items.push({
          type:  'group',
          label: propValue(titleProp, en),
          desc:  propValue(descProp, en),
          icon,
          items: tools.map(t => ({
            id:    t.id,
            label: t.titleKey ? (en[t.titleKey] || t.titleKey) : (t.label || t.id),
            desc:  t.descKey  ? (en[t.descKey]  || '')         : (t.desc  || ''),
          })),
        });
      }
    } else {
      const tagEnd = body.indexOf('/>', nextST);
      if (tagEnd === -1) { i = nextST + 1; continue; }
      const propsStr = body.slice(nextST + '<ScriptToggle'.length, tagEnd);

      const idM    = /inputId="([^"]+)"/.exec(propsStr);
      const titleP = extractProp(propsStr, 'title');
      const descP  = extractProp(propsStr, 'description');
      const iconP  = extractProp(propsStr, 'icon');
      i = tagEnd + 2;

      if (!idM) continue;
      items.push({
        type:  'toggle',
        id:    idM[1],
        label: propValue(titleP, en),
        desc:  propValue(descP, en),
        icon:  iconRel(propValue(iconP, en)),
      });
    }
  }
  return items;
}

// ── Load scripts.js (vm eval) ─────────────────────────────────────────────────
function loadScriptsAndPresets(jsPath) {
  const raw = fs.readFileSync(jsPath, 'utf8');

  // Extract scripts object
  const sStart = raw.indexOf('const scripts = {');
  if (sStart === -1) throw new Error('scripts object not found');
  const sObjStart = sStart + 'const scripts = '.length;
  const sObjEnd   = findClose(raw, sObjStart, '{', '}');
  if (sObjEnd === -1) throw new Error('Could not close scripts object');

  // Extract presets object
  const pStart = raw.indexOf('const presets = {');
  if (pStart === -1) throw new Error('presets object not found');
  const pObjStart = pStart + 'const presets = '.length;
  const pObjEnd   = findClose(raw, pObjStart, '{', '}');
  if (pObjEnd === -1) throw new Error('Could not close presets object');

  const ctx = {};
  vm.runInNewContext(
    'var scripts = ' + raw.slice(sObjStart, sObjEnd + 1) +
    '; var presets = ' + raw.slice(pObjStart, pObjEnd + 1),
    ctx
  );

  const scriptMap = {};
  for (const [k, v] of Object.entries(ctx.scripts)) {
    scriptMap[k] = Array.isArray(v) ? v.join('\n') : String(v);
  }

  return { scriptMap, presets: ctx.presets };
}

// ── Attach ps1 scripts recursively ───────────────────────────────────────────
function attachScripts(items, scriptMap) {
  for (const item of items) {
    if (item.type === 'toggle') {
      // Check special overrides first
      item.ps1 = SPECIAL_PS1[item.id] || scriptMap[item.id] || null;
      if (!item.ps1) console.warn('  warn: no script for toggle', item.id);
    } else if (item.type === 'group' || item.type === 'radio') {
      for (const sub of item.items || []) {
        sub.ps1 = scriptMap[sub.id] || null;
        if (!sub.ps1) console.warn('  warn: no script for', sub.id);
      }
      item.items = (item.items || []).filter(s => s.ps1);
    }
  }
  return items.filter(item => {
    if (item.type === 'toggle')   return !!item.ps1;
    return (item.items || []).length > 0;
  });
}

// ── Parse appinstall.js → apps JSON ──────────────────────────────────────────
function parseApps(appJsPath) {
  const raw = fs.readFileSync(appJsPath, 'utf8');

  function extractAppList(varName) {
    const re = new RegExp('const ' + varName + '\\s*=\\s*\\[');
    const m  = re.exec(raw);
    if (!m) return null;
    const arrStart = m.index + m[0].length - 1; // '[' position
    const arrEnd   = findClose(raw, arrStart, '[', ']');
    if (arrEnd === -1) return null;

    const arrStr = raw.slice(arrStart + 1, arrEnd);
    const apps   = [];
    let i = 0;
    while (i < arrStr.length) {
      const ob = arrStr.indexOf('{', i);
      if (ob === -1) break;
      const oe = findClose(arrStr, ob, '{', '}');
      if (oe === -1) break;
      const obj    = arrStr.slice(ob + 1, oe);
      const idM    = /id:\s*"([^"]+)"/.exec(obj);
      const urlM   = /url:\s*"([^"]+)"/.exec(obj);
      if (idM && urlM) apps.push({ id: idM[1], pkg: urlM[1] });
      i = oe + 1;
    }
    return apps;
  }

  // Extract category groupings from the function body
  // WinScript uses comment lines like: // Browsers  // Gaming  etc.
  // And the apps are in order — we'll keep them flat with a 'category' comment hint
  // Strategy: extract the full appListChocolatey and appListWinget arrays
  const choco  = extractAppList('appListChocolatey') || [];
  const winget = extractAppList('appListWinget')     || [];

  // Build category structure from comment lines above each app group
  // Since parsing arbitrary comments is fragile, use the id as the key
  // and group by extracting category comment blocks from the raw source
  function extractCategorised(varName, apps) {
    const re   = new RegExp('const ' + varName + '\\s*=\\s*\\[');
    const m    = re.exec(raw);
    if (!m) return apps.map(a => ({ ...a, category: 'Utilities' }));

    const arrStart = m.index + m[0].length - 1;
    const arrEnd   = findClose(raw, arrStart, '[', ']');
    const section  = raw.slice(arrStart, arrEnd + 1);

    // Find comment lines (// Category) to label groups
    const lines    = section.split('\n');
    let curCat     = 'Utilities';
    const catMap   = {};
    const commentRe = /^\s*\/\/\s*(.+)$/;

    for (const line of lines) {
      const cm = commentRe.exec(line);
      if (cm && !line.includes('{') && !line.includes('}')) {
        // It's a category comment, not inline
        curCat = cm[1].trim();
      }
      const idM = /id:\s*"([^"]+)"/.exec(line);
      if (idM) catMap[idM[1]] = curCat;
    }

    return apps.map(a => ({ ...a, category: catMap[a.id] || 'Utilities' }));
  }

  const chocoApps  = extractCategorised('appListChocolatey', choco);
  const wingetApps = extractCategorised('appListWinget', winget);

  // Merge: build a unified list where each entry has both pkg names (or null)
  const byId = {};
  for (const a of chocoApps)  { byId[a.id] = { id: a.id, label: a.id, category: a.category, choco: a.pkg, winget: null }; }
  for (const a of wingetApps) {
    if (byId[a.id]) byId[a.id].winget = a.pkg;
    else byId[a.id] = { id: a.id, label: a.id, category: a.category, choco: null, winget: a.pkg };
  }

  // Group by category
  const catMap = {};
  for (const app of Object.values(byId)) {
    if (!catMap[app.category]) catMap[app.category] = [];
    catMap[app.category].push({ id: app.id, label: app.label, choco: app.choco, winget: app.winget });
  }

  const categories = Object.entries(catMap).map(([label, apps]) => ({ label, apps }));
  return {
    id:    'apps',
    label: 'App Install',
    icon:  'ti-package',
    categories,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
function run(winscriptPath, outDir) {
  const enPath     = path.join(winscriptPath, 'app/src/i18n/locales/en.json');
  const jsPath     = path.join(winscriptPath, 'app/src/assets/js/scripts.js');
  const appJsPath  = path.join(winscriptPath, 'app/src/assets/js/appinstall.js');
  const astroPath  = path.join(winscriptPath, 'app/src/components/MainPage.astro');

  const en                    = JSON.parse(fs.readFileSync(enPath, 'utf8'));
  const { scriptMap, presets } = loadScriptsAndPresets(jsPath);
  const tabs                  = parseAstro(astroPath, en);

  fs.mkdirSync(outDir, { recursive: true });

  // Remove old generated files
  for (const f of fs.readdirSync(outDir)) {
    if (/^\d+-.+\.json$/.test(f) || f === '_meta.json') {
      fs.unlinkSync(path.join(outDir, f));
    }
  }

  // Write script tabs
  const ordered = Object.entries(TAB_META).sort((a, b) => a[1].order - b[1].order);
  for (const [tabId, meta] of ordered) {
    const rawItems = tabs[tabId];
    if (!rawItems) { console.log('skip', tabId, '(not in MainPage.astro)'); continue; }
    const items = attachScripts(rawItems, scriptMap);
    if (!items.length) { console.log('skip', tabId, '(no scripts)'); continue; }

    const n    = String(meta.order).padStart(2, '0');
    const cat  = { id: tabId, label: meta.label, icon: meta.icon, items };
    const file = path.join(outDir, `${n}-${tabId}.json`);
    fs.writeFileSync(file, JSON.stringify(cat, null, 2));
    const total = items.reduce((s, i) => s + (i.items ? i.items.length : 1), 0);
    console.log(`wrote ${file} (${total} actions)`);
  }

  // Write apps tab
  if (fs.existsSync(appJsPath)) {
    const apps = parseApps(appJsPath);
    const file = path.join(outDir, '08-apps.json');
    fs.writeFileSync(file, JSON.stringify(apps, null, 2));
    const total = apps.categories.reduce((s, c) => s + c.apps.length, 0);
    console.log(`wrote ${file} (${total} apps)`);
  } else {
    console.log('skip apps (appinstall.js not found)');
  }

  // Write meta (presets)
  const metaFile = path.join(outDir, '_meta.json');
  fs.writeFileSync(metaFile, JSON.stringify({ presets }, null, 2));
  console.log(`wrote ${metaFile}`);

  console.log('done.');
}

const [,, winscriptPath = '../winscript-ref', outDir = 'data/builder'] = process.argv;
run(winscriptPath, outDir);
