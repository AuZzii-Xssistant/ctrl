use crate::AppState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::{Manager, State};
use tauri_plugin_shell::ShellExt;

#[derive(Serialize)]
pub struct Watcher {
    pub id: i64,
    pub name: String,
    pub condition_type: String,
    pub condition_config: String,
    pub action: String,
    pub enabled: bool,
    pub last_checked: Option<String>,
    pub last_state: String,
    pub last_triggered_at: Option<String>,
}

#[derive(Deserialize)]
pub struct WatcherData {
    pub name: String,
    pub condition_type: String,
    pub condition_config: String,
    pub action: String,
    pub enabled: Option<bool>,
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_watchers(state: State<AppState>) -> Result<Vec<Watcher>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare(
        "SELECT id,name,condition_type,condition_config,action,enabled,last_checked,last_state,last_triggered_at \
         FROM watchers ORDER BY name COLLATE NOCASE"
    ).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Watcher {
                id: r.get(0)?,
                name: r.get(1)?,
                condition_type: r.get(2)?,
                condition_config: r.get(3)?,
                action: r.get(4)?,
                enabled: r.get::<_, i64>(5)? != 0,
                last_checked: r.get(6)?,
                last_state: r.get(7)?,
                last_triggered_at: r.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn add_watcher(state: State<AppState>, data: WatcherData) -> Result<i64, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO watchers (name,condition_type,condition_config,action,enabled) VALUES (?1,?2,?3,?4,?5)",
        params![data.name, data.condition_type, data.condition_config, data.action, data.enabled.unwrap_or(true) as i64],
    ).map_err(|e| e.to_string())?;
    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub fn update_watcher(state: State<AppState>, id: i64, data: WatcherData) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE watchers SET name=?1,condition_type=?2,condition_config=?3,action=?4,enabled=?5 WHERE id=?6",
        params![data.name, data.condition_type, data.condition_config, data.action, data.enabled.unwrap_or(true) as i64, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_watcher(state: State<AppState>, id: i64) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM watchers WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn toggle_watcher(state: State<AppState>, id: i64, enabled: bool) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE watchers SET enabled=?1 WHERE id=?2",
        params![enabled as i64, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Poll loop ────────────────────────────────────────────────────────────────
// Mirrors workflows.rs::start_workflow_scheduler — background thread, spawns
// async work on Tauri's runtime each tick.

/// consecutive-over-threshold poll count per watcher id, for cpu_sustained.
/// ponytail: in-memory ring-buffer-of-one (a counter) instead of a rolling
/// window table — resets on app restart, which is fine, a sustained-CPU alert
/// re-measuring after restart is not a real loss.
fn cpu_streaks() -> &'static Mutex<HashMap<i64, u32>> {
    static STREAKS: OnceLock<Mutex<HashMap<i64, u32>>> = OnceLock::new();
    STREAKS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn start_watcher_scheduler(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(5));
        loop {
            let app2 = app.clone();
            tauri::async_runtime::spawn(async move {
                check_watchers(&app2).await;
            });
            std::thread::sleep(std::time::Duration::from_secs(30));
        }
    });
}

async fn check_watchers(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let rows: Vec<(i64, String, String, String)> = {
        let Ok(db) = state.0.lock() else { return };
        let Ok(mut stmt) = db.prepare(
            "SELECT id,condition_type,condition_config,action FROM watchers WHERE enabled=1",
        ) else {
            return;
        };
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .ok()
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default()
    };
    if rows.is_empty() {
        return;
    }

    // disk_below / cpu_sustained both read perf stats — fetch once per tick, not per watcher.
    let needs_perf = rows
        .iter()
        .any(|(_, ct, ..)| ct == "disk_below" || ct == "cpu_sustained");
    let perf = if needs_perf {
        crate::commands::misc::get_perf_stats(app.clone())
            .await
            .ok()
    } else {
        None
    };

    for (id, condition_type, config, action) in rows {
        let cfg: serde_json::Value = serde_json::from_str(&config).unwrap_or_default();
        let alert = match condition_type.as_str() {
            "disk_below" => eval_disk_below(perf.as_ref(), &cfg),
            "process_down" => eval_process_down(app, &cfg).await,
            "cpu_sustained" => eval_cpu_sustained(id, perf.as_ref(), &cfg),
            _ => false,
        };
        record_and_fire(app, id, alert, &action, &condition_type, &cfg).await;
    }
}

fn eval_disk_below(
    perf: Option<&crate::commands::misc::PerfStats>,
    cfg: &serde_json::Value,
) -> bool {
    let Some(perf) = perf else { return false };
    let drive = cfg["drive"].as_str().unwrap_or("C");
    let pct = cfg["pct"].as_f64().unwrap_or(10.0);
    perf.drives
        .iter()
        .find(|d| d.name.eq_ignore_ascii_case(drive))
        .is_some_and(|d| {
            if d.total_gb <= 0.0 {
                return false;
            }
            let free_pct = (d.total_gb - d.used_gb) / d.total_gb * 100.0;
            free_pct < pct
        })
}

fn eval_cpu_sustained(
    id: i64,
    perf: Option<&crate::commands::misc::PerfStats>,
    cfg: &serde_json::Value,
) -> bool {
    let Some(perf) = perf else { return false };
    let pct = cfg["pct"].as_i64().unwrap_or(80);
    let minutes = cfg["minutes"].as_i64().unwrap_or(5).max(1);
    let required = (minutes * 60 / 30) as u32; // 30s poll interval

    let mut streaks = cpu_streaks().lock().unwrap_or_else(|e| e.into_inner());
    let count = streaks.entry(id).or_insert(0);
    if perf.cpu_pct >= pct {
        *count += 1;
    } else {
        *count = 0;
    }
    *count == required // edge-trigger: fire once when the streak first hits the target
}

async fn eval_process_down(app: &tauri::AppHandle, cfg: &serde_json::Value) -> bool {
    let name = cfg["process"]
        .as_str()
        .unwrap_or("")
        .trim_end_matches(".exe")
        .to_string();
    if name.is_empty() {
        return false;
    }
    let ps = format!(
        "if (Get-Process -Name '{}' -ErrorAction SilentlyContinue) {{'1'}} else {{'0'}}",
        name.replace('\'', "''")
    );
    let out = app
        .shell()
        .command("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &ps])
        .output()
        .await;
    match out {
        Ok(o) => String::from_utf8_lossy(&o.stdout).trim() == "0",
        Err(_) => false, // can't tell — don't false-alarm
    }
}

async fn record_and_fire(
    app: &tauri::AppHandle,
    id: i64,
    alert: bool,
    action: &str,
    condition_type: &str,
    cfg: &serde_json::Value,
) {
    let new_state = if alert { "alert" } else { "ok" };
    let state = app.state::<AppState>();
    // Single lock across both read and write to avoid ok->alert edge-trigger firing
    // every 30s when the read path errors and silently defaults to "ok".
    let was_alert: String = {
        let Ok(db) = state.0.lock() else { return };
        let prev = db
            .query_row(
                "SELECT last_state FROM watchers WHERE id=?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap_or_else(|_| "ok".into());
        let _ = db.execute(
            "UPDATE watchers SET last_checked=datetime('now'),last_state=?1 WHERE id=?2",
            params![new_state, id],
        );
        prev
    };

    // Only fire on the ok->alert transition — a persisting condition doesn't spam every 30s.
    if alert && was_alert != "alert" {
        if let Ok(db) = state.0.lock() {
            let _ = db.execute(
                "UPDATE watchers SET last_triggered_at=datetime('now') WHERE id=?1",
                params![id],
            );
        }
        let msg = describe(condition_type, cfg);
        if let Some(wf_id) = action
            .strip_prefix("workflow:")
            .and_then(|s| s.parse::<i64>().ok())
        {
            let app2 = app.clone();
            tauri::async_runtime::spawn(async move {
                let state = app2.state::<AppState>();
                let _ = crate::commands::workflows::run_workflow(app2.clone(), state, wf_id).await;
            });
        } else {
            let _ = crate::commands::workflows::send_toast(app, "CTRL Watcher", &msg).await;
        }
    }
}

fn describe(condition_type: &str, cfg: &serde_json::Value) -> String {
    match condition_type {
        "disk_below" => format!(
            "Drive {} is low on space",
            cfg["drive"].as_str().unwrap_or("?")
        ),
        "process_down" => format!("{} is not running", cfg["process"].as_str().unwrap_or("?")),
        "cpu_sustained" => format!(
            "CPU sustained above {}% for {} min",
            cfg["pct"].as_i64().unwrap_or(0),
            cfg["minutes"].as_i64().unwrap_or(0)
        ),
        _ => "Watcher triggered".into(),
    }
}
