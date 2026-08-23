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

/// pub so ctrl-cli can validate --steps shape at add-time instead of letting
/// a malformed value silently fail only when the workflow tries to run.
#[derive(Deserialize, Debug)]
pub struct Step {
    step_type: String, // "script" | "fix" | "notify" | "wait"
    item_id: Option<i64>,
    label: String,
    // notify fields
    title: Option<String>,
    body: Option<String>,
    // wait field
    seconds: Option<u64>,
}

/// Names of every workflow whose steps reference this script/fix -- lets the
/// Scripts/Fixes pane warn before delete instead of leaving a dangling step
/// nobody finds out about until the workflow next runs and that step fails.
#[tauri::command]
pub fn find_workflows_using_item(
    state: State<AppState>,
    item_type: String,
    item_id: i64,
) -> Result<Vec<String>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare("SELECT name, steps FROM workflows")
        .map_err(|e| e.to_string())?;
    let rows: Vec<(String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows
        .into_iter()
        .filter(|(_, steps_json)| {
            serde_json::from_str::<Vec<Step>>(steps_json)
                .map(|steps| {
                    steps
                        .iter()
                        .any(|s| s.step_type == item_type && s.item_id == Some(item_id))
                })
                .unwrap_or(false)
        })
        .map(|(name, _)| name)
        .collect())
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

// Routes through the real run_script/run_fix commands (not a shadow implementation) so
// workflow steps get the same admin-elevation, PTY output, and sandbox handling as running
// the same script/fix directly from its own pane. A prior version reimplemented spawn logic
// here from scratch and never checked run_as_admin at all — steps needing elevation silently
// ran unprivileged.
async fn run_step_script(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
    step: &Step,
) -> Result<(bool, String), String> {
    let id = step.item_id.ok_or("missing item_id")?;
    let r = crate::commands::scripts::run_script(app.clone(), state.clone(), id, None, Some(true))
        .await?;
    Ok((r.success, r.output))
}

async fn run_step_fix(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
    step: &Step,
) -> Result<(bool, String), String> {
    let id = step.item_id.ok_or("missing item_id")?;
    let r = crate::commands::fixes::run_fix(app.clone(), state.clone(), id).await?;
    Ok((r.success, r.output))
}

async fn run_step_notify(app: &tauri::AppHandle, step: &Step) -> Result<(bool, String), String> {
    let title = step.title.as_deref().unwrap_or(">_ CTRL");
    let body = step.body.as_deref().unwrap_or(step.label.as_str());
    send_toast(app, title, body).await?;
    Ok((true, format!("Notification sent: {}", title)))
}

/// Fire a Windows notification via the shell — the one notification mechanism
/// in CTRL, used by workflow "notify" steps.
///
/// Was `ToastNotificationManager::CreateToastNotifier("CTRL")` (native WinRT
/// toast) — that API requires a registered AppUserModelID (a Start Menu
/// shortcut with a toast activator CLSID), which an unpackaged NSIS-installed
/// app like this doesn't have. It almost certainly threw an "app not
/// registered" exception every single call, and the failure was silently
/// swallowed (the process output was never checked), so "notify doesn't work"
/// had no visible error anywhere. Switched to a `NotifyIcon` balloon tip —
/// the standard notification mechanism for unpackaged Win32 apps, no app
/// identity registration required — and the exit code/stderr are now
/// actually checked instead of discarded.
pub async fn send_toast(app: &tauri::AppHandle, title: &str, body: &str) -> Result<(), String> {
    let ps = format!(
        r#"Add-Type -AssemblyName System.Windows.Forms,System.Drawing;
$n=New-Object System.Windows.Forms.NotifyIcon;
$n.Icon=[System.Drawing.SystemIcons]::Information;
$n.Visible=$true;
$n.ShowBalloonTip(5000,'{title}','{body}',[System.Windows.Forms.ToolTipIcon]::Info);
Start-Sleep -Seconds 4;
$n.Dispose()"#,
        title = title.replace('\'', "''"),
        body = body.replace('\'', "''"),
    );
    let out = app
        .shell()
        .command("powershell")
        .args(["-WindowStyle", "Hidden", "-NonInteractive", "-Command", &ps])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("notification failed: {}", err.trim()));
    }
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
            let (now, dow, today) = chrono_local_hhmm_dow();
            fire_matching(&app, "schedule", Some((&now, dow, &today)));
        }
    });
}

fn fire_matching(app: &tauri::AppHandle, trigger_type: &str, hhmm: Option<(&str, u64, &str)>) {
    let state = app.state::<AppState>();
    let ids: Vec<(i64, String, Option<String>)> = {
        let Ok(db) = state.0.lock() else { return };
        let Ok(mut stmt) = db.prepare(
            "SELECT id,trigger_config,last_run_at FROM workflows WHERE enabled=1 AND trigger_type=?1",
        ) else {
            return;
        };
        stmt.query_map(params![trigger_type], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?))
        })
        .ok()
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default()
    };

    for (id, config, last_run_at) in ids {
        let should_run = match hhmm {
            None => true, // startup — always run
            Some((now, dow, today)) => {
                // config JSON: {"time":"09:00"} or {"days":[1,3,5],"time":"07:30"}
                let v: serde_json::Value = serde_json::from_str(&config).unwrap_or_default();
                let sched_time = v["time"].as_str().unwrap_or("00:00");
                // <= instead of == so a missed exact minute (sleep/wake, slow prior
                // run) still fires on the next poll instead of silently skipping the
                // whole day. The last-fired-today guard is what stops it firing on
                // every single poll after the threshold passes.
                let already_fired_today = last_run_at
                    .as_deref()
                    .and_then(|s| s.get(0..10))
                    .is_some_and(|d| d == today);
                sched_time <= now && check_days(&v, dow) && !already_fired_today
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

fn check_days(config: &serde_json::Value, weekday: u64) -> bool {
    let Some(days) = config["days"].as_array() else {
        return true;
    };
    if days.is_empty() {
        return true;
    }
    days.iter().any(|d| d.as_u64() == Some(weekday))
}

/// Local HH:MM, day-of-week (0=Sun..6=Sat, same convention `check_days`'
/// `days` array uses), and local YYYY-MM-DD (for the last-fired-today guard
/// in `fire_matching`). All three from one GetLocalTime call — `check_days`
/// used to recompute weekday separately from UTC epoch seconds, which drifted
/// a day off local near midnight for any timezone not UTC+0.
fn chrono_local_hhmm_dow() -> (String, u64, String) {
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
        (
            format!("{:02}:{:02}", t.hour, t.min),
            t.dow as u64,
            format!("{:04}-{:02}-{:02}", t.year, t.month, t.day),
        )
    }
}
