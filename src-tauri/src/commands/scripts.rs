use crate::AppState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::ShellExt;

#[derive(Serialize, Deserialize)]
pub struct Script {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub category: String,
    pub file_path: String,
    pub script_type: String,
    pub tags: String,
    pub status: String,
    pub run_as_admin: bool,
}

#[derive(Deserialize)]
pub struct ScriptData {
    pub name: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub file_path: String,
    pub script_type: Option<String>,
    pub tags: Option<String>,
    pub status: Option<String>,
    pub run_as_admin: Option<bool>,
}

#[derive(Serialize)]
pub struct RunResult {
    pub success: bool,
    pub output: String,
}

fn query_scripts(db: &rusqlite::Connection, q: &str) -> Result<Vec<Script>, String> {
    let mut stmt = db.prepare(
        "SELECT id,name,description,category,file_path,script_type,tags,status,COALESCE(run_as_admin,0) FROM scripts ORDER BY category,name"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(Script {
            id: row.get(0)?, name: row.get(1)?, description: row.get(2)?,
            category: row.get(3)?, file_path: row.get(4)?, script_type: row.get(5)?,
            tags: row.get(6)?, status: row.get(7)?,
            run_as_admin: row.get::<_,i64>(8)? != 0,
        })
    }).map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok())
        .filter(|s| q.is_empty() || s.name.to_lowercase().contains(q) || s.category.to_lowercase().contains(q) || s.tags.to_lowercase().contains(q))
        .collect())
}

#[tauri::command]
pub fn get_scripts(state: State<AppState>, search: Option<String>) -> Result<Vec<Script>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    query_scripts(&db, &search.unwrap_or_default().to_lowercase())
}

#[tauri::command]
pub fn add_script(state: State<AppState>, data: ScriptData) -> Result<i64, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO scripts (name,description,category,file_path,script_type,tags,status,run_as_admin) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![data.name, data.description.unwrap_or_default(), data.category.unwrap_or_else(|| "General".into()),
                data.file_path, data.script_type.unwrap_or_else(|| "ps1".into()), data.tags.unwrap_or_default(),
                data.status.unwrap_or_else(|| "active".into()), data.run_as_admin.unwrap_or(false) as i64],
    ).map_err(|e| e.to_string())?;
    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub fn update_script(state: State<AppState>, id: i64, data: ScriptData) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE scripts SET name=?1,description=?2,category=?3,file_path=?4,script_type=?5,tags=?6,status=?7,run_as_admin=?8 WHERE id=?9",
        params![data.name, data.description.unwrap_or_default(), data.category.unwrap_or_else(|| "General".into()),
                data.file_path, data.script_type.unwrap_or_else(|| "ps1".into()), data.tags.unwrap_or_default(),
                data.status.unwrap_or_else(|| "active".into()), data.run_as_admin.unwrap_or(false) as i64, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_script(state: State<AppState>, id: i64) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM scripts WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn run_script(app: tauri::AppHandle, state: State<'_, AppState>, id: i64) -> Result<RunResult, String> {
    let (file_path, script_type, name, run_as_admin) = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        db.query_row(
            "SELECT file_path,script_type,name,COALESCE(run_as_admin,0) FROM scripts WHERE id=?1",
            params![id], |row| {
            Ok((row.get::<_,String>(0)?, row.get::<_,String>(1)?, row.get::<_,String>(2)?, row.get::<_,i64>(3)? != 0))
        }).map_err(|e| e.to_string())?
    };

    // For admin runs: spawn elevated (UAC), output not captured
    if run_as_admin {
        let ps_args = match script_type.as_str() {
            "ps1" => format!("Start-Process -Verb RunAs -FilePath 'powershell' -ArgumentList '-ExecutionPolicy','Bypass','-File','{}'", file_path.replace('\'', "''")),
            "py"  => format!("Start-Process -Verb RunAs -FilePath 'python' -ArgumentList '{}'", file_path.replace('\'', "''")),
            _     => format!("Start-Process -Verb RunAs -FilePath 'cmd' -ArgumentList '/c','{}'", file_path.replace('\'', "''")),
        };
        app.shell().command("powershell")
            .args(["-ExecutionPolicy", "Bypass", "-Command", &ps_args])
            .spawn().map_err(|e| e.to_string())?;
        let msg = "Running as administrator — output not captured (UAC elevation)".to_string();
        let db = state.0.lock().map_err(|e| e.to_string())?;
        let _ = db.execute("INSERT INTO run_log (item_type,item_id,item_name,exit_code,output) VALUES ('script',?1,?2,0,?3)",
            params![id, name, msg]);
        return Ok(RunResult { success: true, output: "Launched with administrator privileges.\nOutput is not captured for elevated processes.".to_string() });
    }

    let (program, args) = match script_type.as_str() {
        "ps1" => ("powershell", vec!["-ExecutionPolicy".into(), "Bypass".into(), "-File".into(), file_path.clone()]),
        "py"  => ("python", vec![file_path.clone()]),
        _     => ("cmd", vec!["/c".into(), file_path.clone()]),
    };
    let out = app.shell().command(program).args(&args).output().await.map_err(|e| e.to_string())?;
    let output = String::from_utf8_lossy(&out.stdout).to_string() + &String::from_utf8_lossy(&out.stderr);
    let success = out.status.success();
    {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        let code: i64 = if success { 0 } else { 1 };
        let _ = db.execute("INSERT INTO run_log (item_type,item_id,item_name,exit_code,output) VALUES ('script',?1,?2,?3,?4)",
            params![id, name, code, output]);
    }
    Ok(RunResult { success, output })
}

#[tauri::command]
pub async fn open_script_editor(app: tauri::AppHandle, state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let path: String = db.query_row("SELECT file_path FROM scripts WHERE id=?1", params![id], |r| r.get(0)).map_err(|e| e.to_string())?;
    drop(db);
    // Use 'start' via cmd to open with the registered default editor for the file type
    app.shell().command("cmd").args(["/c", "start", "", &path]).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn open_script_location(app: tauri::AppHandle, state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let path: String = db.query_row("SELECT file_path FROM scripts WHERE id=?1", params![id], |r| r.get(0)).map_err(|e| e.to_string())?;
    drop(db);
    let dir = std::path::Path::new(&path).parent().map(|p| p.to_string_lossy().to_string()).unwrap_or(path);
    app.shell().command("explorer").args([&dir]).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn browse_for_script(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = app.dialog().file()
        .add_filter("Scripts", &["ps1", "bat", "cmd", "py"])
        .blocking_pick_file();
    Ok(path.map(|p| p.to_string()))
}
