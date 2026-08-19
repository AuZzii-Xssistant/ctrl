use crate::AppState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::ShellExt;

#[derive(Serialize, Deserialize, Debug)]
pub struct Tool {
    pub id: i64,
    pub name: String,
    pub category: String,
    pub path: String,
    pub args: String,
    pub tags: String,
    pub notes: String,
    pub run_as_admin: bool,
}

#[derive(Deserialize)]
pub struct ToolData {
    pub name: String,
    pub category: Option<String>,
    pub path: String,
    pub args: Option<String>,
    pub tags: Option<String>,
    pub notes: Option<String>,
    pub run_as_admin: Option<bool>,
}

#[tauri::command]
pub fn get_tools(state: State<AppState>, search: Option<String>) -> Result<Vec<Tool>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let q = search.unwrap_or_default().to_lowercase();
    let mut stmt = db.prepare(
        "SELECT id,name,category,path,args,tags,notes,run_as_admin FROM tools ORDER BY category,name"
    ).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Tool {
                id: row.get(0)?,
                name: row.get(1)?,
                category: row.get(2)?,
                path: row.get(3)?,
                args: row.get(4)?,
                tags: row.get(5)?,
                notes: row.get(6)?,
                run_as_admin: row.get::<_, i64>(7)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    let tools: Vec<Tool> = rows
        .filter_map(|r| r.ok())
        .filter(|t| {
            q.is_empty()
                || t.name.to_lowercase().contains(&q)
                || t.category.to_lowercase().contains(&q)
                || t.tags.to_lowercase().contains(&q)
        })
        .collect();
    Ok(tools)
}

#[tauri::command]
pub fn add_tool(state: State<AppState>, data: ToolData) -> Result<i64, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO tools (name,category,path,args,tags,notes,run_as_admin) VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![
            data.name,
            data.category.unwrap_or_else(|| "General".into()),
            data.path,
            data.args.unwrap_or_default(),
            data.tags.unwrap_or_default(),
            data.notes.unwrap_or_default(),
            data.run_as_admin.unwrap_or(false) as i64,
        ],
    ).map_err(|e| e.to_string())?;
    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub fn update_tool(state: State<AppState>, id: i64, data: ToolData) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE tools SET name=?1,category=?2,path=?3,args=?4,tags=?5,notes=?6,run_as_admin=?7 WHERE id=?8",
        params![
            data.name,
            data.category.unwrap_or_else(|| "General".into()),
            data.path,
            data.args.unwrap_or_default(),
            data.tags.unwrap_or_default(),
            data.notes.unwrap_or_default(),
            data.run_as_admin.unwrap_or(false) as i64,
            id,
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_tool(state: State<AppState>, id: i64) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM tools WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn launch_tool(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: i64,
) -> Result<(), String> {
    let (path, args, run_as_admin) = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = db
            .prepare("SELECT path,args,run_as_admin FROM tools WHERE id=?1")
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)? != 0,
            ))
        })
        .map_err(|e| e.to_string())?
    };

    if run_as_admin {
        let esc_path = path.replace('\'', "''");
        app.shell()
            .command("powershell")
            .args(["-Command", &format!("Start-Process '{}' -Verb RunAs", esc_path)])
            .spawn()
            .map_err(|e| e.to_string())?;
    } else {
        let mut cmd = app.shell().command(&path);
        if !args.is_empty() {
            cmd = cmd.args(args.split_whitespace());
        }
        cmd.spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browse_for_exe(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = app
        .dialog()
        .file()
        .add_filter("Executables", &["exe", "cmd", "bat", "ps1", "lnk"])
        .blocking_pick_file();
    Ok(path.map(|p| p.to_string()))
}
