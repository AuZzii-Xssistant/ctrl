use crate::AppState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};
use tauri_plugin_shell::ShellExt;

// ── Data types ────────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct Workflow {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub steps: String,
    pub enabled: bool,
    pub trigger_type: String,
    pub trigger_config: String,
    pub last_run_at: Option<String>,
    pub last_run_ok: Option<bool>,
    pub created_at: String,
}

#[derive(Deserialize)]
pub struct WorkflowData {
    pub name: String,
    pub description: Option<String>,
    pub steps: String,
    pub enabled: Option<bool>,
    pub trigger_type: Option<String>,
    pub trigger_config: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct StepResult {
    pub label: String,
    pub success: bool,
    pub output: String,
}

#[derive(Deserialize, Debug)]
struct Step {
    step_type: String, // "script" | "fix" | "notify" | "wait"
    item_id: Option<i64>,
    label: String,
    // notify fields
    title: Option<String>,
    body: Option<String>,
    // wait field
    seconds: Option<u64>,
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_workflows(state: State<AppState>) -> Result<Vec<Workflow>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare(
        "SELECT id,name,description,steps,enabled,trigger_type,trigger_config,last_run_at,last_run_ok,created_at \
         FROM workflows ORDER BY name"
    ).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Workflow {
                id: r.get(0)?,
                name: r.get(1)?,
                description: r.get(2)?,
                steps: r.get(3)?,
                enabled: r.get::<_, i64>(4)? != 0,
                trigger_type: r.get(5)?,
                trigger_config: r.get(6)?,
                last_run_at: r.get(7)?,
                last_run_ok: r.get::<_, Option<i64>>(8)?.map(|v| v != 0),
                created_at: r.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn add_workflow(state: State<AppState>, data: WorkflowData) -> Result<i64, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO workflows (name,description,steps,enabled,trigger_type,trigger_config) VALUES (?1,?2,?3,?4,?5,?6)",
        params![
            data.name, data.description.unwrap_or_default(), data.steps,
            data.enabled.unwrap_or(true) as i64,
            data.trigger_type.as_deref().unwrap_or("manual"),
            data.trigger_config.as_deref().unwrap_or("{}"),
        ]
    ).map_err(|e| e.to_string())?;
    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub fn update_workflow(state: State<AppState>, id: i64, data: WorkflowData) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE workflows SET name=?1,description=?2,steps=?3,enabled=?4,trigger_type=?5,trigger_config=?6 WHERE id=?7",
        params![
            data.name, data.description.unwrap_or_default(), data.steps,
            data.enabled.unwrap_or(true) as i64,
            data.trigger_type.as_deref().unwrap_or("manual"),
            data.trigger_config.as_deref().unwrap_or("{}"),
            id
        ]
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_workflow(state: State<AppState>, id: i64) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM workflows WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn toggle_workflow(state: State<AppState>, id: i64, enabled: bool) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE workflows SET enabled=?1 WHERE id=?2",
        params![enabled as i64, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Execution ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn run_workflow(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: i64,
) -> Result<Vec<StepResult>, String> {
    let (steps_json, wf_name): (String, String) = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        db.query_row(
            "SELECT steps,name FROM workflows WHERE id=?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?
    };
    let steps: Vec<Step> = serde_json::from_str(&steps_json).map_err(|e| e.to_string())?;
    let mut results = Vec::new();

    let _ = app.emit(
        "wf-step",
        serde_json::json!({ "wf_id": id, "step": 0, "total": steps.len() }),
    );

    for (i, step) in steps.iter().enumerate() {
        let _ = app.emit("wf-step", serde_json::json!({ "wf_id": id, "step": i + 1, "total": steps.len(), "label": &step.label }));

        let result = match step.step_type.as_str() {
            "notify" => run_step_notify(&app, step).await,
            "wait" => run_step_wait(step).await,
            "script" => run_step_script(&app, &state, step).await,
            _ => run_step_fix(&app, &state, step).await, // "fix"
        };
        let (success, output) = result.unwrap_or_else(|e| (false, e));
        results.push(StepResult {
            label: step.label.clone(),
            success,
            output,
        });
    }

    // Persist run result
    let all_ok = results.iter().all(|r| r.success);
    {
        let combined = results
            .iter()
            .enumerate()
            .map(|(i, r)| {
                format!(
                    "[{}/{}] {} {}\n{}",
                    i + 1,
                    results.len(),
                    if r.success { "✓" } else { "✗" },
                    r.label,
                    r.output.trim()
                )
            })
            .collect::<Vec<_>>()
            .join("\n---\n");
        let db = state.0.lock().map_err(|e| e.to_string())?;
        let _ = db.execute(
            "UPDATE workflows SET last_run_at=datetime('now'),last_run_ok=?1 WHERE id=?2",
            params![all_ok as i64, id],
        );
        let _ = db.execute(
            "INSERT INTO run_log (item_type,item_id,item_name,exit_code,output) VALUES ('workflow',?1,?2,?3,?4)",
            params![id, &wf_name, if all_ok { 0i64 } else { 1 }, combined],
        );
    }
    let _ = app.emit("wf-done", serde_json::json!({ "wf_id": id, "ok": all_ok }));
    Ok(results)
}

async fn run_step_script(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
    step: &Step,
) -> Result<(bool, String), String> {
    let id = step.item_id.ok_or("missing item_id")?;
    let (fp, content, st): (String, Option<String>, String) = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        db.query_row(
            "SELECT file_path,content,script_type FROM scripts WHERE id=?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| e.to_string())?
    };
    let path = if let Some(c) = content {
        let p = std::env::temp_dir().join(format!("ctrl_wf_{}.{}", id, st));
        std::fs::write(&p, c).map_err(|e| e.to_string())?;
        p.to_string_lossy().to_string()
    } else {
        fp
    };

    let (prog, args): (&str, Vec<String>) = match st.as_str() {
        "ps1" => (
            "powershell",
            vec![
                "-ExecutionPolicy".into(),
                "Bypass".into(),
                "-File".into(),
                path,
            ],
        ),
        "py" => ("python", vec![path]),
        _ => ("cmd", vec!["/c".into(), path]),
    };
    let out = app
        .shell()
        .command(prog)
        .args(&args)
        .output()
        .await
        .map_err(|e| e.to_string())?;
    let text =
        String::from_utf8_lossy(&out.stdout).to_string() + &String::from_utf8_lossy(&out.stderr);
    Ok((out.status.success(), text))
}

async fn run_step_fix(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
    step: &Step,
) -> Result<(bool, String), String> {
    let id = step.item_id.ok_or("missing item_id")?;
    let (cmd, st): (String, String) = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        db.query_row(
            "SELECT command,shell_type FROM fixes WHERE id=?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?
    };
    let (prog, args): (&str, Vec<String>) = match st.as_str() {
        "powershell" => (
            "powershell",
            vec![
                "-ExecutionPolicy".into(),
                "Bypass".into(),
                "-Command".into(),
                cmd,
            ],
        ),
        "python" => ("python", vec!["-c".into(), cmd]),
        _ => ("cmd", vec!["/c".into(), cmd]),
    };
    let out = app
        .shell()
        .command(prog)
        .args(&args)
        .output()
        .await
        .map_err(|e| e.to_string())?;
    let text =
        String::from_utf8_lossy(&out.stdout).to_string() + &String::from_utf8_lossy(&out.stderr);
    Ok((out.status.success(), text))
}

async fn run_step_notify(app: &tauri::AppHandle, step: &Step) -> Result<(bool, String), String> {
    let title = step.title.as_deref().unwrap_or("CTRL");
    let body = step.body.as_deref().unwrap_or(step.label.as_str());
    send_toast(app, title, body).await?;
    Ok((true, format!("Notification sent: {}", title)))
}

/// Fire a Windows toast via the shell — the one notification mechanism in CTRL,
/// shared by workflow "notify" steps and watchers (Roadmap item 4). No new
/// notification plugin needed, this already works.
pub async fn send_toast(app: &tauri::AppHandle, title: &str, body: &str) -> Result<(), String> {
    let ps = format!(
        r#"$null=[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime];
$xml=$null;$xml=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);
$xml.GetElementsByTagName('text').Item(0).InnerText='{title}';
$xml.GetElementsByTagName('text').Item(1).InnerText='{body}';
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('CTRL').Show([Windows.UI.Notifications.ToastNotification]::new($xml))"#,
        title = title.replace('\'', "''"),
        body = body.replace('\'', "''"),
    );
    let _out = app
        .shell()
        .command("powershell")
        .args(["-WindowStyle", "Hidden", "-NonInteractive", "-Command", &ps])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

async fn run_step_wait(step: &Step) -> Result<(bool, String), String> {
    let secs = step.seconds.unwrap_or(1).min(300);
    // Off the async worker thread onto tokio's blocking pool — std::thread::sleep
    // directly in an async fn would otherwise block that worker for the whole
    // wait, starving other concurrent Tauri commands sharing the same runtime.
    let _ = tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(std::time::Duration::from_secs(secs));
    })
    .await;
    Ok((true, format!("Waited {}s", secs)))
}

// ── Startup trigger runner ────────────────────────────────────────────────────

/// Called on app startup — fires any workflows with trigger_type = "startup",
/// then starts a background thread for "schedule" triggers.
pub fn start_workflow_scheduler(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        // Brief delay so the app finishes initialising before workflows fire
        std::thread::sleep(std::time::Duration::from_secs(3));

        // Fire startup triggers once
        fire_matching(&app, "startup", None);

        // Poll every 60s for schedule triggers
        loop {
            std::thread::sleep(std::time::Duration::from_secs(60));
            let now = chrono_local_hhmm();
            fire_matching(&app, "schedule", Some(&now));
        }
    });
}

fn fire_matching(app: &tauri::AppHandle, trigger_type: &str, hhmm: Option<&str>) {
    let state = app.state::<AppState>();
    let ids: Vec<(i64, String)> = {
        let Ok(db) = state.0.lock() else { return };
        let Ok(mut stmt) = db
            .prepare("SELECT id,trigger_config FROM workflows WHERE enabled=1 AND trigger_type=?1")
        else {
            return;
        };
        stmt.query_map(params![trigger_type], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        })
        .ok()
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default()
    };

    for (id, config) in ids {
        let should_run = match hhmm {
            None => true, // startup — always run
            Some(now) => {
                // config JSON: {"time":"09:00"} or {"days":[1,3,5],"time":"07:30"}
                let v: serde_json::Value = serde_json::from_str(&config).unwrap_or_default();
                let sched_time = v["time"].as_str().unwrap_or("00:00");
                sched_time == now && check_days(&v)
            }
        };
        if should_run {
            let app2 = app.clone();
            tauri::async_runtime::spawn(async move {
                let state = app2.state::<AppState>();
                let _ = run_workflow(app2.clone(), state, id).await;
            });
        }
    }
}

fn check_days(config: &serde_json::Value) -> bool {
    let Some(days) = config["days"].as_array() else {
        return true;
    };
    if days.is_empty() {
        return true;
    }
    // weekday: 0=Sun … 6=Sat — use systemtime
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let weekday = ((secs / 86400) + 4) % 7; // 0=Sun
    days.iter().any(|d| d.as_u64() == Some(weekday))
}

fn chrono_local_hhmm() -> String {
    #[repr(C)]
    #[allow(clippy::upper_case_acronyms)] // mirrors the real Win32 SYSTEMTIME struct name
    struct SYSTEMTIME {
        year: u16,
        month: u16,
        dow: u16,
        day: u16,
        hour: u16,
        min: u16,
        sec: u16,
        ms: u16,
    }
    extern "system" {
        fn GetLocalTime(t: *mut SYSTEMTIME);
    }
    unsafe {
        let mut t = SYSTEMTIME {
            year: 0,
            month: 0,
            dow: 0,
            day: 0,
            hour: 0,
            min: 0,
            sec: 0,
            ms: 0,
        };
        GetLocalTime(&mut t);
        format!("{:02}:{:02}", t.hour, t.min)
    }
}
