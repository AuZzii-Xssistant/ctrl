//! Ported from ChrisTitusTech/winutil (MIT) — config/tweaks.json, reshaped into
//! CTRL's own schema. Every tweak expressed as registry entries carries its own
//! detection for free: apply sets `value`, revert sets `originalValue` (or removes
//! the entry when originalValue is the sentinel "<RemoveEntry>"), and checking
//! current state is just reading the same key and comparing — no separate check
//! script to author, and no drift from a client-side "applied" flag that can't see
//! changes made outside CTRL. Tweaks with only an invokeScript/undoScript (no
//! registry) can't be generically detected — those honestly report "unknown"
//! rather than guessing.

use crate::commands::exec::{run_elevated as exec_elevated, Shell};
use crate::commands::scripts::RunResult;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

#[derive(Deserialize, Serialize, Clone)]
pub struct RegEntry {
    pub path: String,
    pub name: String,
    pub value: String,
    #[serde(rename = "type")]
    pub reg_type: String,
    #[serde(rename = "originalValue")]
    pub original_value: String,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct WinutilTweak {
    pub id: String,
    pub label: String,
    pub description: String,
    pub category: String,
    #[serde(default)]
    pub admin: bool,
    #[serde(default)]
    pub registry: Vec<RegEntry>,
    #[serde(rename = "invokeScript", default)]
    pub invoke_script: Option<String>,
    #[serde(rename = "undoScript", default)]
    pub undo_script: Option<String>,
    #[serde(default)]
    pub link: Option<String>,
}

const EMBEDDED_TWEAKS: &str = include_str!("../../../data/tweaks/winutil-tweaks.json");

fn esc_ps(s: &str) -> String {
    s.replace('\'', "''")
}

/// Disk copy first (dev/user edits), same walk-up-from-exe pattern as Builder's
/// find_builder_dir, else fall back to the copy baked into the binary.
fn load_tweaks() -> Vec<WinutilTweak> {
    let disk = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .and_then(|exe_dir| {
            let mut dir = exe_dir;
            for _ in 0..6 {
                let candidate = dir.join("data").join("tweaks").join("winutil-tweaks.json");
                if candidate.exists() {
                    return std::fs::read_to_string(candidate).ok();
                }
                if !dir.pop() {
                    break;
                }
            }
            None
        });
    let content = disk.as_deref().unwrap_or(EMBEDDED_TWEAKS);
    serde_json::from_str(content).unwrap_or_default()
}

#[tauri::command]
pub fn get_winutil_tweaks() -> Vec<WinutilTweak> {
    load_tweaks()
}

#[derive(serde::Deserialize)]
struct CheckRow {
    id: String,
    idx: usize,
    val: Option<serde_json::Value>,
}

/// "on" | "off" | "unknown" per tweak id. One batched PowerShell call reads every
/// registry-backed tweak's current values in one process instead of spawning one
/// per tweak (66 tweaks x separate process would be slow and pointlessly heavy).
#[tauri::command]
pub async fn check_winutil_tweaks(app: AppHandle) -> Result<HashMap<String, String>, String> {
    let tweaks = load_tweaks();
    let mut out: HashMap<String, String> = HashMap::new();

    let mut script = String::from(
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8\n$__out=New-Object System.Collections.Generic.List[object]\n",
    );
    let mut any_registry = false;
    for t in &tweaks {
        if t.registry.is_empty() {
            out.insert(t.id.clone(), "unknown".into());
            continue;
        }
        any_registry = true;
        for (i, r) in t.registry.iter().enumerate() {
            let path = esc_ps(&r.path);
            let name = esc_ps(&r.name);
            script.push_str(&format!(
                "try {{ $__v=(Get-ItemProperty -Path '{path}' -Name '{name}' -ErrorAction Stop).'{name}' }} catch {{ $__v=$null }}\n$__out.Add([PSCustomObject]@{{id='{id}';idx={i};val=$__v}})\n",
                path = path, name = name, id = esc_ps(&t.id), i = i
            ));
        }
    }
    if !any_registry {
        return Ok(out);
    }
    script.push_str("$__out | ConvertTo-Json -Compress -Depth 3\n");

    let result = app
        .shell()
        .command("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    let raw = String::from_utf8_lossy(&result.stdout);
    // ConvertTo-Json emits a bare object (not an array) when there's exactly one
    // row — normalize both shapes before parsing.
    let trimmed = raw.trim();
    let rows: Vec<CheckRow> = if trimmed.starts_with('[') {
        serde_json::from_str(trimmed).unwrap_or_default()
    } else if trimmed.starts_with('{') {
        serde_json::from_str::<CheckRow>(trimmed)
            .map(|r| vec![r])
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let mut by_id: HashMap<&str, Vec<&CheckRow>> = HashMap::new();
    for r in &rows {
        by_id.entry(r.id.as_str()).or_default().push(r);
    }

    for t in &tweaks {
        if t.registry.is_empty() {
            continue; // already marked "unknown" above
        }
        let Some(entries) = by_id.get(t.id.as_str()) else {
            out.insert(t.id.clone(), "unknown".into());
            continue;
        };
        let mut all_on = true;
        let mut all_off = true;
        for (i, reg) in t.registry.iter().enumerate() {
            let row = entries.iter().find(|r| r.idx == i);
            let cur: Option<String> = row.and_then(|r| r.val.as_ref()).map(|v| match v {
                serde_json::Value::String(s) => s.clone(),
                other => other.to_string(),
            });
            match cur {
                None => {
                    if reg.original_value != "<RemoveEntry>" {
                        all_off = false;
                    }
                    all_on = false;
                }
                Some(v) => {
                    if v != reg.value {
                        all_on = false;
                    }
                    if reg.original_value == "<RemoveEntry>" || v != reg.original_value {
                        all_off = false;
                    }
                }
            }
        }
        let state = if all_on && !all_off {
            "on"
        } else if all_off && !all_on {
            "off"
        } else {
            "unknown"
        };
        out.insert(t.id.clone(), state.into());
    }
    Ok(out)
}

/// Shared by execution and the Preview panel, so what you preview is exactly
/// what runs — no separate "explanation" text that could drift from reality.
fn build_tweak_script(t: &WinutilTweak, revert: bool) -> String {
    let mut s = String::from("[Console]::OutputEncoding=[Text.Encoding]::UTF8\n$ErrorActionPreference='Continue'\n");
    for r in &t.registry {
        let target = if revert { &r.original_value } else { &r.value };
        let path = esc_ps(&r.path);
        let name = esc_ps(&r.name);
        if target == "<RemoveEntry>" {
            s.push_str(&format!(
                "Remove-ItemProperty -Path '{path}' -Name '{name}' -ErrorAction SilentlyContinue\n"
            ));
        } else {
            s.push_str(&format!(
                "New-Item -Path '{path}' -Force -ErrorAction SilentlyContinue | Out-Null\nSet-ItemProperty -Path '{path}' -Name '{name}' -Value '{val}' -Type {ty} -Force -ErrorAction SilentlyContinue\n",
                val = esc_ps(target), ty = r.reg_type
            ));
        }
    }
    let script = if revert { &t.undo_script } else { &t.invoke_script };
    if let Some(sc) = script {
        s.push_str(sc);
        s.push('\n');
    }
    s
}

async fn run_tweak(app: AppHandle, id: String, revert: bool) -> Result<RunResult, String> {
    let tweaks = load_tweaks();
    let t = tweaks
        .into_iter()
        .find(|x| x.id == id)
        .ok_or_else(|| "Tweak not found".to_string())?;

    let mut s = build_tweak_script(&t, revert);
    // Every tweak runs elevated -- Windows UAC means that's a separate external
    // console (see docs/known-issues.md's "Run As Admin" entry), which -File
    // closes the instant the script finishes with no way to read what happened.
    // User-reported: ran a tweak, it failed, and the window was already gone
    // before they could see why. Pause so results are actually readable.
    s.push_str("\nWrite-Host ''; Write-Host 'Press Enter to close...' -NoNewline; Read-Host | Out-Null\n");

    let result = exec_elevated(&app, &s, &Shell::PowerShell, "wtweak").await?;
    Ok(RunResult {
        success: result.success,
        output: String::new(),
    })
}

#[tauri::command]
pub async fn apply_winutil_tweak(app: AppHandle, id: String) -> Result<RunResult, String> {
    run_tweak(app, id, false).await
}

#[tauri::command]
pub async fn revert_winutil_tweak(app: AppHandle, id: String) -> Result<RunResult, String> {
    run_tweak(app, id, true).await
}

#[derive(Serialize)]
pub struct TweakPreview {
    pub apply: String,
    pub revert: String,
}

/// Read-only — shows exactly what Apply/Revert will run, without running it.
/// Requested after a tweak's label didn't match what the user expected it to
/// do; this lets you check before clicking instead of finding out after.
#[tauri::command]
pub fn preview_winutil_tweak(id: String) -> Result<TweakPreview, String> {
    let tweaks = load_tweaks();
    let t = tweaks
        .into_iter()
        .find(|x| x.id == id)
        .ok_or_else(|| "Tweak not found".to_string())?;
    Ok(TweakPreview {
        apply: build_tweak_script(&t, false),
        revert: build_tweak_script(&t, true),
    })
}
