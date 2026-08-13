use crate::AppState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_shell::ShellExt;
use crate::commands::scripts::RunResult;

#[derive(Serialize, Deserialize, Clone)]
pub struct BuilderAction {
    pub id: String,
    pub label: String,
    pub description: String,
    pub ps1: Option<String>,
    pub bat: Option<String>,
    pub cmd: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct BuilderSection {
    pub label: String,
    pub actions: Vec<BuilderAction>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct BuilderCategory {
    pub id: String,
    pub label: String,
    pub icon: String,
    pub sections: Vec<BuilderSection>,
}

#[derive(Serialize)]
pub struct BuilderDefs {
    pub categories: Vec<BuilderCategory>,
}

#[tauri::command]
pub fn get_builder_actions(_app: tauri::AppHandle) -> Result<BuilderDefs, String> {
    // Walk up from exe dir to find data/builder (handles dev: target/debug/ctrl.exe → project root)
    let exe_dir = std::env::current_exe().ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let data_dir = {
        let mut found = None;
        let mut dir = exe_dir.clone();
        for _ in 0..6 {
            let candidate = dir.join("data").join("builder");
            if candidate.exists() { found = Some(candidate); break; }
            if !dir.pop() { break; }
        }
        found.unwrap_or_else(|| exe_dir.join("data").join("builder"))
    };

    let mut categories = Vec::new();
    if data_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&data_dir) {
            let mut files: Vec<_> = entries.filter_map(|e| e.ok())
                .filter(|e| e.path().extension().map(|x| x == "json").unwrap_or(false))
                .collect();
            files.sort_by_key(|e| e.file_name());
            for entry in files {
                if let Ok(content) = std::fs::read_to_string(entry.path()) {
                    if let Ok(cat) = serde_json::from_str::<BuilderCategory>(&content) {
                        categories.push(cat);
                    }
                }
            }
        }
    }
    Ok(BuilderDefs { categories })
}

#[tauri::command]
pub fn build_script(app: tauri::AppHandle, action_ids: Vec<String>, output_type: String) -> Result<String, String> {
    let defs = get_builder_actions(app)?;
    let all_actions: Vec<BuilderAction> = defs.categories.iter()
        .flat_map(|c| c.sections.iter())
        .flat_map(|s| s.actions.iter())
        .filter(|a| action_ids.contains(&a.id))
        .cloned()
        .collect();

    let lines: Vec<String> = all_actions.iter().filter_map(|a| {
        match output_type.as_str() {
            "ps1" => a.ps1.clone(),
            "bat" => a.bat.clone(),
            _     => a.cmd.clone(),
        }
    }).collect();

    Ok(lines.join("\n"))
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
    let output = String::from_utf8_lossy(&out.stdout).to_string() + &String::from_utf8_lossy(&out.stderr);
    Ok(RunResult { success: out.status.success(), output })
}

#[tauri::command]
pub fn save_built_script(state: State<AppState>, code: String, name: String, script_type: String) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO scripts (name,description,category,file_path,script_type,content) VALUES (?1,'Built with Script Builder','Builder','',?2,?3)",
        params![name, script_type, code],
    ).map_err(|e| e.to_string())?;
    Ok(())
}
