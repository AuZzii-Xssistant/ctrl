use crate::AppState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_shell::ShellExt;

#[derive(Serialize)]
pub struct Workflow {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub steps: String,
    pub created_at: String,
}

#[derive(Deserialize)]
pub struct WorkflowData {
    pub name: String,
    pub description: Option<String>,
    pub steps: String,
}

#[derive(Serialize)]
pub struct StepResult {
    pub label: String,
    pub success: bool,
    pub output: String,
}

#[derive(Deserialize)]
struct Step {
    step_type: String,
    item_id: i64,
    label: String,
}

#[tauri::command]
pub fn get_workflows(state: State<AppState>) -> Result<Vec<Workflow>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare(
        "SELECT id,name,description,steps,created_at FROM workflows ORDER BY name"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(Workflow { id: row.get(0)?, name: row.get(1)?, description: row.get(2)?, steps: row.get(3)?, created_at: row.get(4)? })
    }).map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn add_workflow(state: State<AppState>, data: WorkflowData) -> Result<i64, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute("INSERT INTO workflows (name,description,steps) VALUES (?1,?2,?3)",
        params![data.name, data.description.unwrap_or_default(), data.steps]).map_err(|e| e.to_string())?;
    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub fn update_workflow(state: State<AppState>, id: i64, data: WorkflowData) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute("UPDATE workflows SET name=?1,description=?2,steps=?3 WHERE id=?4",
        params![data.name, data.description.unwrap_or_default(), data.steps, id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_workflow(state: State<AppState>, id: i64) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM workflows WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn run_workflow(app: tauri::AppHandle, state: State<'_, AppState>, id: i64) -> Result<Vec<StepResult>, String> {
    let steps_json: String = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        db.query_row("SELECT steps FROM workflows WHERE id=?1", params![id], |r| r.get(0))
            .map_err(|e| e.to_string())?
    };
    let steps: Vec<Step> = serde_json::from_str(&steps_json).map_err(|e| e.to_string())?;
    let mut results = Vec::new();

    for step in &steps {
        let (prog_name, args): (String, Vec<String>) = {
            let db = state.0.lock().map_err(|e| e.to_string())?;
            match step.step_type.as_str() {
                "script" => {
                    let (fp, st): (String, String) = db.query_row(
                        "SELECT file_path,script_type FROM scripts WHERE id=?1", params![step.item_id],
                        |r| Ok((r.get(0)?, r.get(1)?))
                    ).map_err(|e| e.to_string())?;
                    match st.as_str() {
                        "ps1" => ("powershell".into(), vec!["-ExecutionPolicy".into(), "Bypass".into(), "-File".into(), fp]),
                        "py"  => ("python".into(), vec![fp]),
                        _     => ("cmd".into(), vec!["/c".into(), fp]),
                    }
                },
                _ => { // fix
                    let (cmd, st): (String, String) = db.query_row(
                        "SELECT command,shell_type FROM fixes WHERE id=?1", params![step.item_id],
                        |r| Ok((r.get(0)?, r.get(1)?))
                    ).map_err(|e| e.to_string())?;
                    match st.as_str() {
                        "powershell" => ("powershell".into(), vec!["-ExecutionPolicy".into(), "Bypass".into(), "-Command".into(), cmd]),
                        "python"     => ("python".into(), vec!["-c".into(), cmd]),
                        _            => ("cmd".into(), vec!["/c".into(), cmd]),
                    }
                }
            }
        };
        let out = app.shell().command(&prog_name).args(&args).output().await.map_err(|e| e.to_string())?;
        let output = String::from_utf8_lossy(&out.stdout).to_string()
            + &String::from_utf8_lossy(&out.stderr);
        results.push(StepResult { label: step.label.clone(), success: out.status.success(), output });
    }

    // Log the workflow run to run_log
    {
        let wf_name: String = {
            let db = state.0.lock().map_err(|e| e.to_string())?;
            db.query_row("SELECT name FROM workflows WHERE id=?1", params![id], |r| r.get(0))
              .unwrap_or_else(|_| format!("Workflow {}", id))
        };
        let all_ok = results.iter().all(|r| r.success);
        let combined = results.iter().enumerate()
            .map(|(i, r)| format!("[{}/{}] {} {}\n{}", i + 1, results.len(),
                if r.success { "✓" } else { "✗" }, r.label, r.output.trim()))
            .collect::<Vec<_>>().join("\n---\n");
        let db = state.0.lock().map_err(|e| e.to_string())?;
        let code: i64 = if all_ok { 0 } else { 1 };
        let _ = db.execute(
            "INSERT INTO run_log (item_type,item_id,item_name,exit_code,output) VALUES ('workflow',?1,?2,?3,?4)",
            params![id, wf_name, code, combined],
        );
    }
    Ok(results)
}