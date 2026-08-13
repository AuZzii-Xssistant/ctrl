use crate::AppState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::State;
use tauri_plugin_shell::ShellExt;
use crate::commands::scripts::RunResult;

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

    // For admin runs: write command to temp PS1, run elevated with -Wait, read output file back
    if run_as_admin {
        let tmp_script = std::env::temp_dir().join(format!("ctrl_fix_{}.ps1", id));
        let tmp_output = std::env::temp_dir().join(format!("ctrl_fix_{}_out.txt", id));
        let script = format!(
            "[Console]::OutputEncoding=[Text.Encoding]::UTF8\n& {{\n{}\n}} 2>&1 | Out-File -FilePath '{}' -Encoding UTF8\n",
            command,
            tmp_output.to_string_lossy().replace('\'', "''")
        );
        fs::write(&tmp_script, &script).map_err(|e| e.to_string())?;
        let ps_invoke = format!(
            "Start-Process -Verb RunAs -FilePath powershell -Wait -WindowStyle Hidden -ArgumentList @('-ExecutionPolicy','Bypass','-NoProfile','-File','{}')",
            tmp_script.to_string_lossy().replace('\'', "''")
        );
        app.shell().command("powershell")
            .args(["-ExecutionPolicy", "Bypass", "-Command", &ps_invoke])
            .output().await.map_err(|e| e.to_string())?;
        let output = fs::read_to_string(&tmp_output)
            .unwrap_or_else(|_| "(No output — UAC may have been cancelled or command produced no output)".to_string());
        let _ = fs::remove_file(&tmp_script);
        let _ = fs::remove_file(&tmp_output);
        let db = state.0.lock().map_err(|e| e.to_string())?;
        let _ = db.execute("INSERT INTO run_log (item_type,item_id,item_name,exit_code,output) VALUES ('fix',?1,?2,0,?3)",
            params![id, name, output]);
        return Ok(RunResult { success: true, output });
    }

    // Prefix PowerShell commands with UTF-8 output encoding to avoid garbled characters
    let (program, args): (&str, Vec<String>) = match shell_type.as_str() {
        "powershell" => ("powershell", vec![
            "-ExecutionPolicy".into(), "Bypass".into(), "-Command".into(),
            format!("[Console]::OutputEncoding=[Text.Encoding]::UTF8; {}", command),
        ]),
        "python" => ("python", vec!["-c".into(), command.clone()]),
        _        => ("cmd", vec!["/c".into(), command.clone()]),
    };
    let out = app.shell().command(program).args(&args).output().await.map_err(|e| e.to_string())?;
    let output = String::from_utf8_lossy(&out.stdout).to_string() + &String::from_utf8_lossy(&out.stderr);
    let success = out.status.success();
    {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        let code: i64 = if success { 0 } else { 1 };
        let _ = db.execute("INSERT INTO run_log (item_type,item_id,item_name,exit_code,output) VALUES ('fix',?1,?2,?3,?4)",
            params![id, name, code, output]);
    }
    Ok(RunResult { success, output })
}
