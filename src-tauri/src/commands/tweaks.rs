use crate::commands::exec::{run as exec_run, run_elevated as exec_elevated, Shell};
use crate::commands::scripts::RunResult;
use crate::AppState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Serialize)]
pub struct CustomTweak {
    pub id: i64,
    pub category: String,
    pub label: String,
    pub description: String,
    pub apply_cmd: String,
    pub revert_cmd: String,
    pub admin: bool,
}

#[derive(Deserialize)]
pub struct CustomTweakData {
    pub category: Option<String>,
    pub label: String,
    pub description: Option<String>,
    pub apply_cmd: String,
    pub revert_cmd: Option<String>,
    pub admin: Option<bool>,
}

#[tauri::command]
pub async fn run_tweak_cmd(
    app: tauri::AppHandle,
    cmd: String,
    admin: Option<bool>,
) -> Result<RunResult, String> {
    if std::env::var("CTRL_SANDBOX").as_deref() == Ok("1") {
        return Ok(RunResult {
            success: true,
            output: format!("SANDBOX: would run:\n{cmd}"),
        });
    }
    let shell = Shell::PowerShell;
    let is_admin = admin.unwrap_or(false);
    // When CTRL itself is elevated, skip UAC/polling — run directly (admin inherited)
    let result = if is_admin && !crate::commands::exec::running_as_admin() {
        exec_elevated(&app, &cmd, &shell, "tweak").await?
    } else {
        exec_run(&app, &cmd, &shell).await?
    };
    use crate::commands::scripts::RunResult;
    Ok(RunResult {
        success: result.success,
        output: String::new(),
    })
}

#[tauri::command]
pub fn get_custom_tweaks(state: State<AppState>) -> Result<Vec<CustomTweak>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare(
        "SELECT id,category,label,description,apply_cmd,revert_cmd,admin FROM custom_tweaks ORDER BY category,sort_order,id"
    ).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(CustomTweak {
                id: r.get(0)?,
                category: r.get(1)?,
                label: r.get(2)?,
                description: r.get(3)?,
                apply_cmd: r.get(4)?,
                revert_cmd: r.get(5)?,
                admin: r.get::<_, i64>(6)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn add_custom_tweak(state: State<AppState>, data: CustomTweakData) -> Result<i64, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO custom_tweaks (category,label,description,apply_cmd,revert_cmd,admin) VALUES (?1,?2,?3,?4,?5,?6)",
        params![data.category.unwrap_or_else(|| "Custom".into()), data.label,
                data.description.unwrap_or_default(), data.apply_cmd,
                data.revert_cmd.unwrap_or_default(), data.admin.unwrap_or(false) as i64],
    ).map_err(|e| e.to_string())?;
    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub fn update_custom_tweak(
    state: State<AppState>,
    id: i64,
    data: CustomTweakData,
) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE custom_tweaks SET category=?1,label=?2,description=?3,apply_cmd=?4,revert_cmd=?5,admin=?6 WHERE id=?7",
        params![data.category.unwrap_or_else(|| "Custom".into()), data.label,
                data.description.unwrap_or_default(), data.apply_cmd,
                data.revert_cmd.unwrap_or_default(), data.admin.unwrap_or(false) as i64, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_custom_tweak(state: State<AppState>, id: i64) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM custom_tweaks WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
