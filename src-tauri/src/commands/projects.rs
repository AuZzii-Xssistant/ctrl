use crate::AppState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_shell::ShellExt;

#[derive(Serialize, Deserialize)]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub r#type: String,
    pub status: String,
    pub path: String,
    pub tags: String,
    pub notes: String,
}

#[derive(Deserialize)]
pub struct ProjectData {
    pub name: String,
    pub description: Option<String>,
    pub r#type: Option<String>,
    pub status: Option<String>,
    pub path: Option<String>,
    pub tags: Option<String>,
    pub notes: Option<String>,
}

#[tauri::command]
pub fn get_projects(
    state: State<AppState>,
    search: Option<String>,
) -> Result<Vec<Project>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let q = search.unwrap_or_default().to_lowercase();
    let mut stmt = db.prepare(
        "SELECT id,name,description,type,status,path,tags,notes FROM projects ORDER BY status,name"
    ).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                r#type: row.get(3)?,
                status: row.get(4)?,
                path: row.get(5)?,
                tags: row.get(6)?,
                notes: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows
        .filter_map(|r| r.ok())
        .filter(|p| {
            q.is_empty() || p.name.to_lowercase().contains(&q) || p.tags.to_lowercase().contains(&q)
        })
        .collect())
}

#[tauri::command]
pub fn add_project(state: State<AppState>, data: ProjectData) -> Result<i64, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO projects (name,description,type,status,path,tags,notes) VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![data.name, data.description.unwrap_or_default(), data.r#type.unwrap_or_else(|| "script".into()),
                data.status.unwrap_or_else(|| "idea".into()), data.path.unwrap_or_default(),
                data.tags.unwrap_or_default(), data.notes.unwrap_or_default()],
    ).map_err(|e| e.to_string())?;
    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub fn update_project(state: State<AppState>, id: i64, data: ProjectData) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE projects SET name=?1,description=?2,type=?3,status=?4,path=?5,tags=?6,notes=?7 WHERE id=?8",
        params![data.name, data.description.unwrap_or_default(), data.r#type.unwrap_or_else(|| "script".into()),
                data.status.unwrap_or_else(|| "idea".into()), data.path.unwrap_or_default(),
                data.tags.unwrap_or_default(), data.notes.unwrap_or_default(), id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_project(state: State<AppState>, id: i64) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM projects WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn open_project_path(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: i64,
) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let path: String = db
        .query_row("SELECT path FROM projects WHERE id=?1", params![id], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    drop(db);
    if !path.is_empty() {
        app.shell()
            .command("explorer")
            .args([&path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
