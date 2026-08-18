use crate::commands::scripts::RunResult;
use crate::AppState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::ShellExt;

#[derive(Serialize)]
pub struct BackupJob {
    pub id: i64,
    pub name: String,
    pub source: String,
    pub dest: String,
    pub last_run: Option<String>,
    pub created_at: String,
}

#[derive(Deserialize)]
pub struct BackupData {
    pub name: String,
    pub source: String,
    pub dest: String,
}

#[tauri::command]
pub fn get_backup_jobs(state: State<AppState>) -> Result<Vec<BackupJob>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare("SELECT id,name,source,dest,last_run,created_at FROM backup_jobs ORDER BY name")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(BackupJob {
                id: row.get(0)?,
                name: row.get(1)?,
                source: row.get(2)?,
                dest: row.get(3)?,
                last_run: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn add_backup_job(state: State<AppState>, data: BackupData) -> Result<i64, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO backup_jobs (name,source,dest) VALUES (?1,?2,?3)",
        params![data.name, data.source, data.dest],
    )
    .map_err(|e| e.to_string())?;
    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub fn update_backup_job(state: State<AppState>, id: i64, data: BackupData) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE backup_jobs SET name=?1,source=?2,dest=?3 WHERE id=?4",
        params![data.name, data.source, data.dest, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_backup_job(state: State<AppState>, id: i64) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM backup_jobs WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn run_backup(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: i64,
) -> Result<RunResult, String> {
    let (source, dest, name): (String, String, String) = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        db.query_row(
            "SELECT source,dest,name FROM backup_jobs WHERE id=?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| e.to_string())?
    };
    // robocopy exit codes 0-7 are success (8+ are errors)
    let out = app
        .shell()
        .command("robocopy")
        .args([&source, &dest, "/E", "/NFL", "/NDL", "/NJH", "/NJS"])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    let raw = String::from_utf8_lossy(&out.stdout).to_string();
    let code = out.status.code().unwrap_or(16) as i64;
    let success = code < 8;
    let output = format!("Backup: {} → {}\n{}", source, dest, raw.trim());
    {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        let _ = db.execute(
            "UPDATE backup_jobs SET last_run=datetime('now') WHERE id=?1",
            params![id],
        );
        // run_log.exit_code is read elsewhere as a plain 0=success flag (get_recent_activity),
        // so robocopy's raw 0-7 "success" codes must be normalized, not stored as-is.
        let _ = db.execute(
            "INSERT INTO run_log (item_type,item_id,item_name,exit_code,output) VALUES ('backup',?1,?2,?3,?4)",
            params![id, name, if success { 0i64 } else { code }, output]);
    }
    Ok(RunResult { success, output })
}

#[tauri::command]
pub async fn browse_for_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = app.dialog().file().blocking_pick_folder();
    Ok(path.map(|p| p.to_string()))
}
