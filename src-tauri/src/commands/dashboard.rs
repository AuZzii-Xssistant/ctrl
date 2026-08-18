use crate::AppState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::{Manager, State};

#[derive(Serialize)]
pub struct PinnedItem {
    pub id: i64,
    pub item_type: String,
    pub item_id: i64,
    pub item_name: String,
    pub item_icon: String,
    pub item_meta: String, // cmd for ql, path for app, empty otherwise
    pub group_name: String,
    pub sort_order: i64,
}

#[tauri::command]
pub fn get_pinned(state: State<AppState>) -> Result<Vec<PinnedItem>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare(
        "SELECT p.id, p.item_type, p.item_id, p.group_name, p.sort_order FROM pinned p ORDER BY p.group_name, p.sort_order"
    ).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut items = Vec::new();
    let mut dangling = Vec::new();
    for row in rows.filter_map(|r| r.ok()) {
        let (id, item_type, item_id, group_name, sort_order) = row;
        let (name, icon, meta) = resolve_item(&db, &item_type, item_id);
        if name.is_empty() {
            // Underlying tool/fix/workflow/project/script was deleted — drop the stale pin.
            dangling.push(id);
            continue;
        }
        items.push(PinnedItem {
            id,
            item_type,
            item_id,
            item_name: name,
            item_icon: icon,
            item_meta: meta,
            group_name,
            sort_order,
        });
    }
    if !dangling.is_empty() {
        for id in dangling {
            let _ = db.execute("DELETE FROM pinned WHERE id=?1", params![id]);
        }
    }
    Ok(items)
}

// Returns (name, icon, meta) where meta = cmd for ql, path for app
fn resolve_item(
    db: &rusqlite::Connection,
    item_type: &str,
    item_id: i64,
) -> (String, String, String) {
    let name_icon = |table: &str, icon: &str| -> (String, String, String) {
        db.query_row(
            &format!("SELECT name FROM {} WHERE id=?1", table),
            params![item_id],
            |r| r.get(0),
        )
        .map(|n: String| (n, icon.into(), String::new()))
        .unwrap_or_default()
    };
    match item_type {
        "tool" => name_icon("tools", "ti-tool"),
        "fix" => name_icon("fixes", "ti-bolt"),
        "workflow" => name_icon("workflows", "ti-player-play"),
        "project" => name_icon("projects", "ti-archive"),
        "script" => db
            .query_row(
                "SELECT name,script_type FROM scripts WHERE id=?1",
                params![item_id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
            )
            .map(|(n, t)| (n, script_icon(&t), String::new()))
            .unwrap_or_default(),
        "ql" => db
            .query_row(
                "SELECT label,icon,cmd FROM ql_items WHERE id=?1",
                params![item_id],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                },
            )
            .unwrap_or_default(),
        "app" => db
            .query_row(
                "SELECT name,path FROM external_apps WHERE id=?1",
                params![item_id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
            )
            .map(|(n, p)| (n, "ti-device-desktop".into(), p))
            .unwrap_or_default(),
        _ => (String::new(), "ti-circle".into(), String::new()),
    }
}

fn script_icon(t: &str) -> String {
    match t {
        "ps1" => "ti-terminal-2",
        "py" => "ti-brand-python",
        _ => "ti-terminal",
    }
    .into()
}

/// Just the display name — used by the tray menu, which doesn't need icon/meta.
pub fn resolve_item_name(db: &rusqlite::Connection, item_type: &str, item_id: i64) -> String {
    resolve_item(db, item_type, item_id).0
}

/// Launch a pinned item from the tray menu (native Rust call, not a JS invoke —
/// the frontend may not even be visible when this fires). Mirrors dashboard.js's
/// _runPin() dispatch table.
pub fn launch_pinned_from_tray(app: &tauri::AppHandle, item_type: &str, item_id: i64) {
    use tauri_plugin_shell::ShellExt;
    let app2 = app.clone();
    let item_type = item_type.to_string();
    tauri::async_runtime::spawn(async move {
        let Some(state) = app2.try_state::<AppState>() else {
            return;
        };
        match item_type.as_str() {
            "tool" => {
                let _ = crate::commands::tools::launch_tool(app2.clone(), state, item_id).await;
            }
            "script" => {
                let _ =
                    crate::commands::scripts::run_script(app2.clone(), state, item_id, None, None)
                        .await;
            }
            "fix" => {
                let _ = crate::commands::fixes::run_fix(app2.clone(), state, item_id).await;
            }
            "workflow" => {
                let _ =
                    crate::commands::workflows::run_workflow(app2.clone(), state, item_id).await;
            }
            "project" => {
                let _ = crate::commands::projects::open_project_path(app2.clone(), state, item_id)
                    .await;
            }
            "ql" => {
                let db = state.0.lock().ok();
                let cmd: Option<String> = db.and_then(|d| {
                    d.query_row(
                        "SELECT cmd FROM ql_items WHERE id=?1",
                        params![item_id],
                        |r| r.get(0),
                    )
                    .ok()
                });
                if let Some(cmd) = cmd {
                    let _ = app2
                        .shell()
                        .command("cmd")
                        .args(["/c", "start", "", &cmd])
                        .spawn();
                }
            }
            "app" => {
                let db = state.0.lock().ok();
                let path: Option<String> = db.and_then(|d| {
                    d.query_row(
                        "SELECT path FROM external_apps WHERE id=?1",
                        params![item_id],
                        |r| r.get(0),
                    )
                    .ok()
                });
                if let Some(path) = path {
                    let _ = app2
                        .shell()
                        .command("cmd")
                        .args(["/c", "start", "", &path])
                        .spawn();
                }
            }
            _ => {}
        }
    });
}

#[tauri::command]
pub fn pin_item(
    app: tauri::AppHandle,
    state: State<AppState>,
    item_type: String,
    item_id: i64,
    group_name: Option<String>,
) -> Result<i64, String> {
    let id = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        // idempotent — return existing id if already pinned
        let existing: Option<i64> = db
            .query_row(
                "SELECT id FROM pinned WHERE item_type=?1 AND item_id=?2",
                params![item_type, item_id],
                |r| r.get(0),
            )
            .ok();
        if let Some(id) = existing {
            id
        } else {
            let group = group_name.unwrap_or_else(|| "Pinned".into());
            let max_order: i64 = db
                .query_row(
                    "SELECT COALESCE(MAX(sort_order),0) FROM pinned WHERE group_name=?1",
                    params![group],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            db.execute(
                "INSERT INTO pinned (item_type,item_id,group_name,sort_order) VALUES (?1,?2,?3,?4)",
                params![item_type, item_id, group, max_order + 1],
            )
            .map_err(|e| e.to_string())?;
            db.last_insert_rowid()
        }
    };
    let _ = crate::commands::tray::build_tray(&app);
    Ok(id)
}

#[tauri::command]
pub fn unpin_item(app: tauri::AppHandle, state: State<AppState>, id: i64) -> Result<(), String> {
    {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        db.execute("DELETE FROM pinned WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
    }
    let _ = crate::commands::tray::build_tray(&app);
    Ok(())
}

#[derive(Deserialize)]
pub struct PinOrder {
    pub id: i64,
    pub sort_order: i64,
}

#[tauri::command]
pub fn reorder_pins(state: State<AppState>, orders: Vec<PinOrder>) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    for o in orders {
        let _ = db.execute(
            "UPDATE pinned SET sort_order=?1 WHERE id=?2",
            params![o.sort_order, o.id],
        );
    }
    Ok(())
}
