use tauri_plugin_shell::ShellExt;
use tauri::State;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::fs;
use crate::AppState;
use crate::commands::scripts::RunResult;

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
pub async fn run_tweak_cmd(app: tauri::AppHandle, cmd: String, admin: Option<bool>) -> Result<RunResult, String> {
    if std::env::var("CTRL_SANDBOX").as_deref() == Ok("1") {
        return Ok(RunResult { success: true, output: format!("SANDBOX: would run:\n{cmd}") });
    }
    if admin.unwrap_or(false) {
        return run_elevated_tweak(&app, &cmd).await;
    }
    // $ErrorActionPreference=Stop makes non-terminating errors terminating so exit code is honest
    let utf8_cmd = format!("$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; {}", cmd);
    let out = app.shell().command("powershell")
        .args(["-ExecutionPolicy", "Bypass", "-Command", &utf8_cmd])
        .output().await.map_err(|e| e.to_string())?;
    let output = String::from_utf8_lossy(&out.stdout).to_string()
        + &String::from_utf8_lossy(&out.stderr);
    Ok(RunResult { success: out.status.success(), output })
}

async fn run_elevated_tweak(app: &tauri::AppHandle, cmd: &str) -> Result<RunResult, String> {
    let tmp_script = std::env::temp_dir().join(format!("ctrl_tweak_{}.ps1", std::process::id()));
    let tmp_output = std::env::temp_dir().join(format!("ctrl_tweak_{}_out.txt", std::process::id()));
    let script = format!(
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8\n& {{\n{}\n}} 2>&1 | Out-File -FilePath '{}' -Encoding UTF8\n",
        cmd,
        tmp_output.to_string_lossy().replace('\'', "''")
    );
    fs::write(&tmp_script, &script).map_err(|e| e.to_string())?;
    let ps_invoke = format!(
        "Start-Process -Verb RunAs -FilePath powershell -Wait -WindowStyle Hidden \
         -ArgumentList @('-ExecutionPolicy','Bypass','-NoProfile','-File','{}')",
        tmp_script.to_string_lossy().replace('\'', "''")
    );
    app.shell().command("powershell")
        .args(["-ExecutionPolicy", "Bypass", "-Command", &ps_invoke])
        .output().await.map_err(|e| e.to_string())?;
    let output = fs::read_to_string(&tmp_output)
        .unwrap_or_else(|_| "(No output — UAC may have been cancelled or command produced no output)".to_string());
    let _ = fs::remove_file(&tmp_script);
    let _ = fs::remove_file(&tmp_output);
    Ok(RunResult { success: true, output })
}

#[tauri::command]
pub fn get_custom_tweaks(state: State<AppState>) -> Result<Vec<CustomTweak>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare(
        "SELECT id,category,label,description,apply_cmd,revert_cmd,admin FROM custom_tweaks ORDER BY category,sort_order,id"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| Ok(CustomTweak {
        id: r.get(0)?, category: r.get(1)?, label: r.get(2)?,
        description: r.get(3)?, apply_cmd: r.get(4)?, revert_cmd: r.get(5)?,
        admin: r.get::<_,i64>(6)? != 0,
    })).map_err(|e| e.to_string())?;
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
pub fn update_custom_tweak(state: State<AppState>, id: i64, data: CustomTweakData) -> Result<(), String> {
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
    db.execute("DELETE FROM custom_tweaks WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}
