/**
 * winscript-converter.js
 * Converts WinScript (flick9000/winscript) data into CTRL Builder JSON format.
 *
 * Usage:
 *   node tools/winscript-converter.js <winscript-path> <output-dir>
 *
 * Example:
 *   node tools/winscript-converter.js ../winscript-ref data/builder
 *
 * Input:  winscript-ref/app/src/assets/js/scripts.js   (commands)
 *         winscript-ref/app/src/i18n/locales/en.json   (labels/descriptions)
 *
 * Output: data/builder/<n>-<category>.json  (one file per CTRL builder tab)
 *
 * CTRL builder JSON schema:
 * {
 *   "id": "debloat",
 *   "label": "Debloat",
 *   "icon": "ti-trash",
 *   "sections": [
 *     {
 *       "label": "Windows Apps",
 *       "actions": [
 *         { "id": "onedrive", "label": "Remove OneDrive", "description": "...", "ps1": "..." }
 *       ]
 *     }
 *   ]
 * }
 *
 * WinScript scripts.js schema:
 *   const scripts = { <id>: ["line1", "line2", ...], ... }
 *
 * WinScript en.json schema:
 *   "<category>.<id>.title": "Label"
 *   "<category>.<id>.desc":  "Description"
 */

const fs   = require('fs');
const path = require('path');

// ── Category map: define CTRL tabs and which WinScript IDs go into each section
const CATEGORY_MAP = [
  {
    id: '01-debloat', label: 'Debloat', icon: 'ti-trash',
    sections: [
      { label: 'Windows Apps',     ids: ['microsoftstore','msstoreupdates','onedrive','thirdparty','msapps','extensions','xbox'] },
      { label: 'Browser',          ids: ['debloatedge','edge','debloatbrave'] },
      { label: 'Windows Features', ids: ['widgets','taskbarwidgets','consumerfeatures','hyperv','iexplorer','faxscan','mediaplayer'] },
      { label: 'Windows AI',       ids: ['copilot','recall','notepadrewrite','aiappxpackages','hideai','aifiles'] },
    ],
  },
  {
    id: '02-privacy', label: 'Privacy', icon: 'ti-shield-lock',
    sections: [
      { label: 'Privacy',    ids: ['updatepause','wpbt','bitlocker','cloudsync','activityfeed','notificationtray','automap','default0user','lockscreencamera','biometrics','screenrecording'] },
      { label: 'App Access', ids: ['locationaccess','cameraccess','microphoneaccess','contactsaccess','callhistoryaccess','messagingaccess','emailaccess','calendaraccess','motionaccess'] },
    ],
  },
  {
    id: '03-telemetry', label: 'Telemetry', icon: 'ti-eye-off',
    sections: [
      { label: 'Windows',    ids: ['wtelemetry','wupdate','wsearchtelemetry','appexperience','windowsdrm','cloudbasedspeech','wfeedback','handwriting','targetads','diagaccess','voiceactivationaccess'] },
      { label: '3rd Party',  ids: ['officetelemetry','adobetelemetry','nvidiatelemetry','vscodetelemetry','mediatelemetry','powershelltelemetry','ccleanertelemetry'] },
      { label: 'Updates',    ids: ['deliveryoptimization','meteredconnection','driverupdates','adobeupdates','googleupdates'] },
    ],
  },
  {
    id: '04-performance', label: 'Performance', icon: 'ti-rocket',
    sections: [
      { label: 'Power',       ids: ['balanced','highperformance','ultimateperformance','faststartup','disablehibernation'] },
      { label: 'System',      ids: ['transparency','manualservices','mousedelay','hags','storagesense','limitdefender','coreisolation','disableprefetch','ipv6'] },
      { label: 'Search',      ids: ['wsearch'] },
    ],
  },
  {
    id: '05-gaming', label: 'Gaming', icon: 'ti-device-gamepad-2',
    sections: [
      { label: 'Optimizations', ids: ['fullscreenoptimizations','windowedoptimizations','mouseacc','gamemode','gamebar'] },
    ],
  },
  {
    id: '06-misc', label: 'Misc', icon: 'ti-adjustments',
    sections: [
      { label: 'Explorer & UI', ids: ['darkmode','filextensions','hiddenfiles','classicmenu','homegallery','taskbarleft','endtask','mpo','snapflyout','stickykeys','numlockstartup'] },
      { label: 'Diagnostic',   ids: ['detailedbsod','verboselogon'] },
    ],
  },
  {
    id: '07-tools', label: 'Tools', icon: 'ti-tool',
    sections: [
      { label: 'Maintenance', ids: ['cleantemp','emptyrecycle','cleanmgr','browserhistory','resetnetwork'] },
      { label: 'Repair',      ids: ['sfc','dism'] },
      { label: 'DNS',         ids: ['googledns','cloudflaredns','quad9dns','opendns','adguardns'] },
    ],
  },
];

function run(winscriptPath, outDir) {
  // Load WinScript scripts
  const jsPath = path.join(winscriptPath, 'app/src/assets/js/scripts.js');
  const raw = fs.readFileSync(jsPath, 'utf8');

  // Extract scripts object by wrapping in a module and evaluating
  // ponytail: eval is simplest here; only runs on trusted local WinScript source
  const vm = require('vm');
  const scriptMap = {};
  const patched = raw
    .replace('document.addEventListener("DOMContentLoaded", function () {', '(function () {')
    .replace(/const parentDiv[\s\S]*?function removeScripts[^}]+\}\s*/m, '')
    .replace(/function addScript[\s\S]*?\}\s*function removeScripts[\s\S]*?\}\s*/m, '')
    // Replace addScript/removeScripts calls and checkbox event handlers with no-ops
    .replace(/parentDiv[\s\S]*$/, '})();');

  // Simpler: just extract the scripts object block and eval it
  const objStart = raw.indexOf('const scripts = {');
  const objBlock = raw.slice(objStart);
  // Find matching closing brace
  let d = 0, end = 0, inStr = false, strChar = '', i = 0;
  const chars = objBlock;
  while (i < chars.length) {
    const c = chars[i];
    if (inStr) {
      if (c === '\\') { i += 2; continue; }
      if (c === strChar) inStr = false;
    } else if (c === '"' || c === "'" || c === '`') { inStr = true; strChar = c; }
    else if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) { end = i + 1; break; } }
    i++;
  }
  const ctx = { scripts: {} };
  vm.runInNewContext('var scripts = ' + objBlock.slice('const scripts = '.length, end), ctx);
  Object.assign(scriptMap, ctx.scripts);

  // Load en.json for labels
  const enPath = path.join(winscriptPath, 'app/src/i18n/locales/en.json');
  const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));

  // Label/desc lookup: try multiple patterns
  function getLabel(id) {
    for (const [k, v] of Object.entries(en)) {
      if (k.endsWith(`.${id}.title`) || k === `${id}.title`) return v;
    }
    return id; // fallback to id
  }
  function getDesc(id) {
    for (const [k, v] of Object.entries(en)) {
      if (k.endsWith(`.${id}.desc`) || k === `${id}.desc`) return v;
    }
    return '';
  }

  fs.mkdirSync(outDir, { recursive: true });

  for (const cat of CATEGORY_MAP) {
    const out = {
      id: cat.id.replace(/^\d+-/, ''),
      label: cat.label,
      icon: cat.icon,
      sections: [],
    };

    for (const sec of cat.sections) {
      const actions = [];
      for (const id of sec.ids) {
        const cmds = scriptMap[id];
        if (!cmds || !cmds.length) continue;
        actions.push({
          id,
          label: getLabel(id),
          description: getDesc(id),
          ps1: cmds.join('\n'),
          bat: null,
        });
      }
      if (actions.length) out.sections.push({ label: sec.label, actions });
    }

    if (out.sections.length) {
      const outPath = path.join(outDir, `${cat.id}.json`);
      fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
      console.log(`wrote ${outPath} (${out.sections.flatMap(s=>s.actions).length} actions)`);
    }
  }
  console.log('done');
}

const [,, winscriptPath = '../winscript-ref', outDir = 'data/builder'] = process.argv;
run(winscriptPath, outDir);
