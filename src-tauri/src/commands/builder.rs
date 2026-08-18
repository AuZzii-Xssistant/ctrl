use crate::commands::exec::ps_bin;
use crate::commands::scripts::RunResult;
use crate::AppState;
use rusqlite::params;
use serde::Serialize;
use std::collections::HashSet;
use tauri::State;

#[derive(Serialize)]
pub struct BuilderDefs {
    pub categories: Vec<serde_json::Value>,
    pub presets: serde_json::Value,
}

/// Builder JSON files embedded at compile time — ensures they ship inside ctrl.exe.
/// On first launch next to a clean exe, these are seeded to data/builder/ on disk.
const EMBEDDED_BUILDER: &[(&str, &str)] = &[
    (
        "01-tools.json",
        include_str!("../../../data/builder/01-tools.json"),
    ),
    (
        "02-debloat.json",
        include_str!("../../../data/builder/02-debloat.json"),
    ),
    (
        "03-privacy.json",
        include_str!("../../../data/builder/03-privacy.json"),
    ),
    (
        "04-telemetry.json",
        include_str!("../../../data/builder/04-telemetry.json"),
    ),
    (
        "05-gaming.json",
        include_str!("../../../data/builder/05-gaming.json"),
    ),
    (
        "06-performance.json",
        include_str!("../../../data/builder/06-performance.json"),
    ),
    (
        "07-miscellanous.json",
        include_str!("../../../data/builder/07-miscellanous.json"),
    ),
    (
        "08-apps.json",
        include_str!("../../../data/builder/08-apps.json"),
    ),
    (
        "_meta.json",
        include_str!("../../../data/builder/_meta.json"),
    ),
];

/// Walk up from exe dir to find data/builder on disk (dev: target/debug/ctrl.exe → project root).
fn find_builder_dir() -> Option<std::path::PathBuf> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))?;
    let mut dir = exe_dir;
    for _ in 0..6 {
        let candidate = dir.join("data").join("builder");
        if candidate.exists() {
            return Some(candidate);
        }
        if !dir.pop() {
            break;
        }
    }
    None
}

/// Load categories: disk first (dev/user edits), fall back to embedded.
fn load_categories() -> Vec<serde_json::Value> {
    let mut cats = Vec::new();

    if let Some(data_dir) = find_builder_dir() {
        if let Ok(entries) = std::fs::read_dir(&data_dir) {
            let mut files: Vec<_> = entries
                .filter_map(|e| e.ok())
                .filter(|e| {
                    let name = e.file_name();
                    let s = name.to_string_lossy();
                    s.ends_with(".json") && !s.starts_with('_')
                })
                .collect();
            files.sort_by_key(|e| e.file_name());
            for entry in files {
                if let Ok(content) = std::fs::read_to_string(entry.path()) {
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                        cats.push(val);
                    }
                }
            }
        }
    }

    // Disk empty or missing — parse directly from embedded bytes
    if cats.is_empty() {
        for (name, content) in EMBEDDED_BUILDER {
            if name.starts_with('_') {
                continue;
            }
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(content) {
                cats.push(val);
            }
        }
    }

    cats
}

fn load_presets() -> serde_json::Value {
    // Try disk first
    if let Some(dir) = find_builder_dir() {
        if let Ok(content) = std::fs::read_to_string(dir.join("_meta.json")) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(p) = val.get("presets") {
                    return p.clone();
                }
            }
        }
    }
    // Fall back to embedded _meta.json
    for (name, content) in EMBEDDED_BUILDER {
        if *name == "_meta.json" {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(content) {
                if let Some(p) = val.get("presets") {
                    return p.clone();
                }
            }
        }
    }
    serde_json::Value::Object(Default::default())
}

/// Recursively collect PS1 strings for selected IDs, in JSON order.
fn collect_scripts(val: &serde_json::Value, ids: &HashSet<String>, out: &mut Vec<String>) {
    match val {
        serde_json::Value::Array(arr) => {
            for item in arr {
                collect_scripts(item, ids, out);
            }
        }
        serde_json::Value::Object(obj) => {
            if let Some(id) = obj.get("id").and_then(|v| v.as_str()) {
                if ids.contains(id) {
                    if let Some(serde_json::Value::String(s)) = obj.get("ps1") {
                        if !s.is_empty() {
                            out.push(s.clone());
                        }
                    }
                }
            }
            if let Some(items) = obj.get("items") {
                collect_scripts(items, ids, out);
            }
        }
        _ => {}
    }
}

const SCRIPT_HEADER: &str = r#"# Script generated by >_CTRL
# Check if the script is running as admin
$ProgressPreference = "SilentlyContinue"
$ErrorActionPreference = "SilentlyContinue"
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Start-Process powershell.exe "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

"#;

const SCRIPT_FOOTER: &str = r#"
# ── Finalise ──────────────────────────────────────────────────────────────────
Pause
Write-Host ""
Write-Host "Restarting Explorer..." -ForegroundColor Cyan
Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500
Start-Process explorer
Write-Host ""
"#;

#[tauri::command]
pub fn get_builder_actions(_app: tauri::AppHandle) -> Result<BuilderDefs, String> {
    Ok(BuilderDefs {
        categories: load_categories(),
        presets: load_presets(),
    })
}

#[tauri::command]
pub fn build_script(
    _app: tauri::AppHandle,
    action_ids: Vec<String>,
    output_type: String,
) -> Result<String, String> {
    let _ = output_type; // PS1 only
    let cats = load_categories();
    let ids: HashSet<String> = action_ids.into_iter().collect();
    let mut scripts = Vec::new();
    for cat in &cats {
        collect_scripts(cat, &ids, &mut scripts);
    }
    let body = if scripts.is_empty() {
        String::from("# No actions selected.\n")
    } else {
        scripts.join("\n")
    };
    Ok(format!("{}{}{}", SCRIPT_HEADER, body, SCRIPT_FOOTER))
}

#[tauri::command]
pub async fn run_built_script(
    app: tauri::AppHandle,
    code: String,
    script_type: String,
) -> Result<RunResult, String> {
    // Unique per call — a fixed filename let a second "Run" click before the first
    // finished overwrite the script file the first run was actively executing from.
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let tmp = std::env::temp_dir().join(format!(
        "ctrl_built_{}_{}.{}",
        std::process::id(),
        n,
        script_type
    ));
    std::fs::write(&tmp, &code).map_err(|e| e.to_string())?;
    let path = tmp.to_string_lossy().to_string();
    let (program, args): (&str, Vec<String>) = match script_type.as_str() {
        "ps1" => (
            ps_bin(),
            vec![
                "-ExecutionPolicy".into(),
                "Bypass".into(),
                "-File".into(),
                path,
            ],
        ),
        _ => ("cmd", vec!["/c".into(), path]),
    };
    let result = crate::commands::exec::spawn_streaming(&app, program, args).await?;
    // Output was streamed via events; return empty so JS doesn't double-write
    Ok(RunResult {
        success: result.success,
        output: String::new(),
    })
}

#[tauri::command]
pub fn save_built_script(
    state: State<AppState>,
    code: String,
    name: String,
    script_type: String,
    profile_ids: Vec<i64>,
    in_master: bool,
) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let max_mo: i64 = db
        .query_row(
            "SELECT COALESCE(MAX(master_order)+1,0) FROM scripts",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    db.execute(
        "INSERT INTO scripts (name,description,category,file_path,script_type,tags,status,run_as_admin,content,in_master,master_order) \
         VALUES (?1,'Built with Script Builder','Builder','',?2,'','active',0,?3,?4,?5)",
        params![name, script_type, code, in_master as i64, max_mo],
    ).map_err(|e| e.to_string())?;
    let script_id = db.last_insert_rowid();
    for pid in profile_ids {
        let max_ord: i64 = db
            .query_row(
                "SELECT COALESCE(MAX(sort_order)+1,0) FROM ss_script_profile WHERE profile_id=?1",
                params![pid],
                |r| r.get(0),
            )
            .unwrap_or(0);
        db.execute(
            "INSERT OR IGNORE INTO ss_script_profile (script_id,profile_id,sort_order) VALUES (?1,?2,?3)",
            params![script_id, pid, max_ord]
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}
