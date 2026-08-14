use crate::AppState;
use rusqlite::params;
use serde::Serialize;
use std::collections::HashSet;
use tauri::State;
use tauri_plugin_shell::ShellExt;
use crate::commands::scripts::RunResult;

#[derive(Serialize)]
pub struct BuilderDefs {
    pub categories: Vec<serde_json::Value>,
}

/// Walk up from exe dir to find data/builder (handles dev: target/debug/ctrl.exe → project root)
fn find_builder_dir() -> std::path::PathBuf {
    let exe_dir = std::env::current_exe().ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let mut dir = exe_dir.clone();
    for _ in 0..6 {
        let candidate = dir.join("data").join("builder");
        if candidate.exists() { return candidate; }
        if !dir.pop() { break; }
    }
    exe_dir.join("data").join("builder")
}

fn load_categories() -> Vec<serde_json::Value> {
    let data_dir = find_builder_dir();
    let mut cats = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&data_dir) {
        let mut files: Vec<_> = entries.filter_map(|e| e.ok())
            .filter(|e| e.path().extension().map(|x| x == "json").unwrap_or(false))
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
    cats
}

/// Recursively collect PS1/bat/cmd strings for selected IDs, in JSON order.
fn collect_scripts(val: &serde_json::Value, ids: &HashSet<String>, out_type: &str, out: &mut Vec<String>) {
    match val {
        serde_json::Value::Array(arr) => {
            for item in arr { collect_scripts(item, ids, out_type, out); }
        }
        serde_json::Value::Object(obj) => {
            // Leaf with an id and a script
            if let Some(id) = obj.get("id").and_then(|v| v.as_str()) {
                if ids.contains(id) {
                    let script = match out_type {
                        "bat" => obj.get("bat"),
                        "cmd" => obj.get("cmd"),
                        _     => obj.get("ps1"),
                    };
                    if let Some(serde_json::Value::String(s)) = script {
                        if !s.is_empty() { out.push(s.clone()); }
                    }
                }
            }
            // Recurse into items
            if let Some(items) = obj.get("items") {
                collect_scripts(items, ids, out_type, out);
            }
        }
        _ => {}
    }
}

#[tauri::command]
pub fn get_builder_actions(_app: tauri::AppHandle) -> Result<BuilderDefs, String> {
    Ok(BuilderDefs { categories: load_categories() })
}

#[tauri::command]
pub fn build_script(_app: tauri::AppHandle, action_ids: Vec<String>, output_type: String) -> Result<String, String> {
    let cats = load_categories();
    let ids: HashSet<String> = action_ids.into_iter().collect();
    let mut scripts = Vec::new();
    for cat in &cats {
        collect_scripts(cat, &ids, &output_type, &mut scripts);
    }
    Ok(scripts.join("\n"))
}

#[tauri::command]
pub async fn run_built_script(app: tauri::AppHandle, code: String, script_type: String) -> Result<RunResult, String> {
    let tmp = std::env::temp_dir().join(format!("ctrl_built.{}", script_type));
    std::fs::write(&tmp, &code).map_err(|e| e.to_string())?;
    let path = tmp.to_string_lossy().to_string();
    let (program, args): (&str, Vec<String>) = match script_type.as_str() {
        "ps1" => ("powershell", vec!["-ExecutionPolicy".into(), "Bypass".into(), "-File".into(), path]),
        _     => ("cmd", vec!["/c".into(), path]),
    };
    let out = app.shell().command(program).args(&args).output().await.map_err(|e| e.to_string())?;
    let output = String::from_utf8_lossy(&out.stdout).to_string()
              + &String::from_utf8_lossy(&out.stderr);
    Ok(RunResult { success: out.status.success(), output })
}

#[tauri::command]
pub fn save_built_script(state: State<AppState>, code: String, name: String, script_type: String) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO scripts (name,description,category,file_path,script_type,tags,status,run_as_admin,content) \
         VALUES (?1,'Built with Script Builder','Builder','',?2,'','active',0,?3)",
        params![name, script_type, code],
    ).map_err(|e| e.to_string())?;
    Ok(())
}
