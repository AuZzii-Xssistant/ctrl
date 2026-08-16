use crate::AppState;
use rusqlite::params;
use serde::Serialize;
use tauri::State;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::ShellExt;

#[derive(Serialize, Clone)]
pub struct QlItem {
    pub id: i64,
    pub label: String,
    pub icon: String,
    pub cmd: String,
}

#[tauri::command]
pub fn get_ql_items(state: State<AppState>) -> Result<Vec<QlItem>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare("SELECT id,label,icon,cmd FROM ql_items ORDER BY label").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| Ok(QlItem { id: r.get(0)?, label: r.get(1)?, icon: r.get(2)?, cmd: r.get(3)? }))
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[derive(Serialize, Clone)]
pub struct ExternalApp {
    pub id: i64,
    pub name: String,
    pub path: String,
}

#[tauri::command]
pub fn list_external_apps(state: State<AppState>) -> Result<Vec<ExternalApp>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare("SELECT id,name,path FROM external_apps ORDER BY name").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| Ok(ExternalApp { id: r.get(0)?, name: r.get(1)?, path: r.get(2)? }))
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn add_external_app(state: State<AppState>, name: String, path: String) -> Result<i64, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute("INSERT INTO external_apps (name,path) VALUES (?1,?2)", params![name, path])
        .map_err(|e| e.to_string())?;
    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub fn remove_external_app(state: State<AppState>, id: i64) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM external_apps WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn launch_external(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.shell().command("cmd").args(["/c", "start", "", &path]).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn pick_exe_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = app.dialog()
        .file()
        .add_filter("Executables", &["exe", "lnk", "bat", "cmd", "msc"])
        .blocking_pick_file();
    Ok(path.map(|p| p.to_string()))
}
