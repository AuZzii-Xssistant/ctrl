use crate::AppState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;
use crate::commands::scripts::RunResult;
use crate::commands::exec::{Shell, run as exec_run, run_elevated as exec_elevated};

#[derive(Serialize, Deserialize)]
pub struct Fix {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub category: String,
    pub shell_type: String,
    pub command: String,
    pub tags: String,
    pub confirm_required: bool,
    pub run_as_admin: bool,
}

#[derive(Deserialize)]
pub struct FixData {
    pub name: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub shell_type: Option<String>,
    pub command: String,
    pub tags: Option<String>,
    pub confirm_required: Option<bool>,
    pub run_as_admin: Option<bool>,
}

#[tauri::command]
pub fn get_fixes(state: State<AppState>, search: Option<String>) -> Result<Vec<Fix>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let q = search.unwrap_or_default().to_lowercase();
    let mut stmt = db.prepare(
        "SELECT id,name,description,category,shell_type,command,tags,confirm_required,COALESCE(run_as_admin,0) FROM fixes ORDER BY category,name"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(Fix {
            id: row.get(0)?, name: row.get(1)?, description: row.get(2)?,
            category: row.get(3)?, shell_type: row.get(4)?, command: row.get(5)?,
            tags: row.get(6)?, confirm_required: row.get::<_,i64>(7)? != 0,
            run_as_admin: row.get::<_,i64>(8)? != 0,
        })
    }).map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok())
        .filter(|f| q.is_empty() || f.name.to_lowercase().contains(&q) || f.category.to_lowercase().contains(&q))
        .collect())
}

#[tauri::command]
pub fn add_fix(state: State<AppState>, data: FixData) -> Result<i64, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO fixes (name,description,category,shell_type,command,tags,confirm_required,run_as_admin) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![data.name, data.description.unwrap_or_default(), data.category.unwrap_or_else(|| "General".into()),
                data.shell_type.unwrap_or_else(|| "powershell".into()), data.command, data.tags.unwrap_or_default(),
                data.confirm_required.unwrap_or(false) as i64, data.run_as_admin.unwrap_or(false) as i64],
    ).map_err(|e| e.to_string())?;
    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub fn update_fix(state: State<AppState>, id: i64, data: FixData) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE fixes SET name=?1,description=?2,category=?3,shell_type=?4,command=?5,tags=?6,confirm_required=?7,run_as_admin=?8 WHERE id=?9",
        params![data.name, data.description.unwrap_or_default(), data.category.unwrap_or_else(|| "General".into()),
                data.shell_type.unwrap_or_else(|| "powershell".into()), data.command, data.tags.unwrap_or_default(),
                data.confirm_required.unwrap_or(false) as i64, data.run_as_admin.unwrap_or(false) as i64, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_fix(state: State<AppState>, id: i64) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM fixes WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn run_fix(app: tauri::AppHandle, state: State<'_, AppState>, id: i64) -> Result<RunResult, String> {
    let (command, shell_type, name, run_as_admin) = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        db.query_row(
            "SELECT command,shell_type,name,COALESCE(run_as_admin,0) FROM fixes WHERE id=?1",
            params![id], |row| {
            Ok((row.get::<_,String>(0)?, row.get::<_,String>(1)?, row.get::<_,String>(2)?, row.get::<_,i64>(3)? != 0))
        }).map_err(|e| e.to_string())?
    };

    if std::env::var("CTRL_SANDBOX").as_deref() == Ok("1") {
        return Ok(RunResult { success: true, output: format!("SANDBOX: would run fix \"{name}\":\n{command}") });
    }

    let shell = Shell::from_str(&shell_type);
    let label = format!("fix_{id}");
    let result = if run_as_admin {
        exec_elevated(&app, &command, &shell, &label).await?
    } else {
        exec_run(&app, &command, &shell).await?
    };

    let code: i64 = if result.success { 0 } else { 1 };
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let _ = db.execute(
        "INSERT INTO run_log (item_type,item_id,item_name,exit_code,output) VALUES ('fix',?1,?2,?3,?4)",
        params![id, name, code, result.output],
    );
    // Non-admin output already streamed via events; admin output returned for display
    Ok(RunResult { success: result.success, output: if run_as_admin { result.output } else { String::new() } })
}
