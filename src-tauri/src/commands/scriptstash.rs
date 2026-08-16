/// ScriptStash port — full replica of the ScriptStash app inside CTRL.
/// Profiles, global master view, run queue with events, drag-reorder,
/// toggle enable/disable, duplicate, import/export, keyboard shortcuts.

use crate::AppState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use tauri::{Emitter, State};

// ── Global run state ──────────────────────────────────────────────────────────

fn ss_running() -> &'static Arc<AtomicBool> {
    static R: OnceLock<Arc<AtomicBool>> = OnceLock::new();
    R.get_or_init(|| Arc::new(AtomicBool::new(false)))
}
fn ss_stop() -> &'static Arc<AtomicBool> {
    static S: OnceLock<Arc<AtomicBool>> = OnceLock::new();
    S.get_or_init(|| Arc::new(AtomicBool::new(false)))
}
fn tmp_counter() -> u64 {
    static C: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    C.fetch_add(1, Ordering::SeqCst)
}

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct SsScript {
    pub id: i64,
    pub name: String,
    pub description: String,
    #[serde(rename = "type")]
    pub script_type: String,
    pub content: Option<String>,
    #[serde(rename = "runAsAdmin")]
    pub run_as_admin: bool,
    #[serde(rename = "lastRun")]
    pub last_run: Option<String>,
    #[serde(rename = "lastStatus")]
    pub last_status: String,
    #[serde(rename = "lastError")]
    pub last_error: Option<String>,
    pub order: i64,
    pub enabled: bool,
    #[serde(rename = "inProfiles")]
    pub in_profiles: Vec<i64>,
}

#[derive(Serialize, Clone)]
pub struct SsProfile {
    pub id: i64,
    pub name: String,
    #[serde(rename = "scriptCount")]
    pub script_count: i64,
}

#[derive(Serialize)]
pub struct SsState {
    pub scripts: Vec<SsScript>,
    pub profiles: Vec<SsProfile>,
    pub running: bool,
}

#[derive(Deserialize)]
pub struct SsScriptData {
    pub name: String,
    pub description: Option<String>,
    #[serde(rename = "type")]
    pub script_type: Option<String>,
    pub content: Option<String>,
    #[serde(rename = "runAsAdmin")]
    pub run_as_admin: Option<bool>,
}

#[derive(Serialize, Deserialize)]
struct SsExportScript {
    id: String, // stored as string for compat with ScriptStash JSON
    name: String,
    description: String,
    #[serde(rename = "type")]
    script_type: String,
    content: String,
    #[serde(rename = "runAsAdmin")]
    run_as_admin: bool,
    enabled: bool,
    order: i64,
    state: SsExportState,
}
#[derive(Serialize, Deserialize)]
struct SsExportState {
    #[serde(rename = "lastRun")]
    last_run: Option<String>,
    #[serde(rename = "lastStatus")]
    last_status: String,
    #[serde(rename = "lastError")]
    last_error: Option<String>,
}
#[derive(Serialize, Deserialize)]
struct SsExportProfile {
    id: String,
    name: String,
    #[serde(rename = "scriptOrder")]
    script_order: Vec<String>,
    #[serde(rename = "disabledScripts")]
    disabled_scripts: Vec<String>,
}
#[derive(Serialize, Deserialize)]
struct SsExportFile {
    version: u32,
    profile: SsExportProfile,
    scripts: Vec<SsExportScript>,
}

// ── DB helpers ────────────────────────────────────────────────────────────────

fn query_ss_scripts(db: &rusqlite::Connection, profile_id: Option<i64>) -> Result<Vec<SsScript>, String> {
    // Subquery for in_profiles
    let ip_sub = "(SELECT GROUP_CONCAT(sp2.profile_id) FROM ss_script_profile sp2 WHERE sp2.script_id=s.id)";

    if let Some(pid) = profile_id {
        let sql = format!(
            "SELECT s.id,s.name,COALESCE(s.description,''),COALESCE(s.script_type,'ps1'),s.content,
             COALESCE(s.run_as_admin,0),s.last_run,COALESCE(s.last_status,'never'),s.last_error,
             sp.sort_order, CASE WHEN sp.disabled=0 THEN 1 ELSE 0 END, {ip_sub}
             FROM scripts s
             JOIN ss_script_profile sp ON sp.script_id=s.id AND sp.profile_id=?1
             ORDER BY sp.sort_order, s.name"
        );
        let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![pid], |r| {
            let in_p: Option<String> = r.get(11)?;
            Ok(SsScript {
                id: r.get(0)?, name: r.get(1)?, description: r.get(2)?,
                script_type: r.get(3)?, content: r.get(4)?,
                run_as_admin: r.get::<_,i64>(5)? != 0,
                last_run: r.get(6)?, last_status: r.get(7)?, last_error: r.get(8)?,
                order: r.get(9)?,
                enabled: r.get::<_,i64>(10)? != 0,
                in_profiles: parse_in_profiles(in_p),
            })
        }).map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    } else {
        // Master: all scripts
        let sql = format!(
            "SELECT s.id,s.name,COALESCE(s.description,''),COALESCE(s.script_type,'ps1'),s.content,
             COALESCE(s.run_as_admin,0),s.last_run,COALESCE(s.last_status,'never'),s.last_error,
             COALESCE(s.master_order,9999), CASE WHEN COALESCE(s.master_disabled,0)=0 THEN 1 ELSE 0 END, {ip_sub}
             FROM scripts s
             ORDER BY COALESCE(s.master_order,9999), s.name"
        );
        let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| {
            let in_p: Option<String> = r.get(11)?;
            Ok(SsScript {
                id: r.get(0)?, name: r.get(1)?, description: r.get(2)?,
                script_type: r.get(3)?, content: r.get(4)?,
                run_as_admin: r.get::<_,i64>(5)? != 0,
                last_run: r.get(6)?, last_status: r.get(7)?, last_error: r.get(8)?,
                order: r.get(9)?,
                enabled: r.get::<_,i64>(10)? != 0,
                in_profiles: parse_in_profiles(in_p),
            })
        }).map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }
}

fn parse_in_profiles(s: Option<String>) -> Vec<i64> {
    s.unwrap_or_default().split(',')
        .filter_map(|x| x.trim().parse::<i64>().ok())
        .collect()
}

fn query_profiles(db: &rusqlite::Connection) -> Result<Vec<SsProfile>, String> {
    let mut stmt = db.prepare(
        "SELECT p.id,p.name,COUNT(sp.script_id) FROM ss_profiles p
         LEFT JOIN ss_script_profile sp ON sp.profile_id=p.id
         GROUP BY p.id ORDER BY p.sort_order, p.name"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| Ok(SsProfile {
        id: r.get(0)?, name: r.get(1)?, script_count: r.get(2)?
    })).map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

fn gc_orphaned_scripts(db: &rusqlite::Connection) {
    let _ = db.execute(
        "DELETE FROM scripts WHERE id NOT IN (SELECT DISTINCT script_id FROM ss_script_profile)",
        []
    );
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn ss_get_state(state: State<AppState>, profile_id: Option<i64>) -> Result<SsState, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let scripts = query_ss_scripts(&db, profile_id)?;
    let profiles = query_profiles(&db)?;
    Ok(SsState { scripts, profiles, running: ss_running().load(Ordering::SeqCst) })
}

#[tauri::command]
pub fn ss_add_profile(state: State<AppState>, name: String) -> Result<SsProfile, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute("INSERT INTO ss_profiles (name) VALUES (?1)", params![name]).map_err(|e| e.to_string())?;
    let id = db.last_insert_rowid();
    Ok(SsProfile { id, name, script_count: 0 })
}

#[tauri::command]
pub fn ss_rename_profile(state: State<AppState>, id: i64, name: String) -> Result<bool, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute("UPDATE ss_profiles SET name=?1 WHERE id=?2", params![name, id]).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn ss_remove_profile(state: State<AppState>, id: i64) -> Result<bool, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let count: i64 = db.query_row("SELECT COUNT(*) FROM ss_profiles", [], |r| r.get(0)).unwrap_or(0);
    if count <= 1 { return Ok(false); }
    db.execute("DELETE FROM ss_script_profile WHERE profile_id=?1", params![id]).map_err(|e| e.to_string())?;
    db.execute("DELETE FROM ss_profiles WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    gc_orphaned_scripts(&db);
    Ok(true)
}

#[tauri::command]
pub fn ss_duplicate_profile(state: State<AppState>, id: i64, new_name: String) -> Result<Option<SsProfile>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    // Create new profile
    db.execute("INSERT INTO ss_profiles (name) VALUES (?1)", params![new_name]).map_err(|e| e.to_string())?;
    let new_id = db.last_insert_rowid();
    // Copy all script memberships (same scripts, same order, same disabled state)
    db.execute(
        "INSERT INTO ss_script_profile (script_id, profile_id, sort_order, disabled)
         SELECT script_id, ?1, sort_order, disabled FROM ss_script_profile WHERE profile_id=?2",
        params![new_id, id]
    ).map_err(|e| e.to_string())?;
    let count: i64 = db.query_row("SELECT COUNT(*) FROM ss_script_profile WHERE profile_id=?1", params![new_id], |r| r.get(0)).unwrap_or(0);
    Ok(Some(SsProfile { id: new_id, name: new_name, script_count: count }))
}

#[tauri::command]
pub fn ss_add_script(state: State<AppState>, profile_id: Option<i64>, data: SsScriptData) -> Result<SsScript, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let desc = data.description.unwrap_or_default();
    let stype = data.script_type.unwrap_or_else(|| "ps1".into());
    let content = data.content.unwrap_or_default();
    let admin = data.run_as_admin.unwrap_or(false);
    let max_mo: i64 = db.query_row("SELECT COALESCE(MAX(master_order)+1, 0) FROM scripts", [], |r| r.get(0)).unwrap_or(0);
    db.execute(
        "INSERT INTO scripts (name,description,script_type,content,run_as_admin,master_order,file_path,category) VALUES (?1,?2,?3,?4,?5,?6,'','')",
        params![data.name, desc, stype, content, admin as i64, max_mo]
    ).map_err(|e| e.to_string())?;
    let script_id = db.last_insert_rowid();

    if let Some(pid) = profile_id {
        let max_ord: i64 = db.query_row(
            "SELECT COALESCE(MAX(sort_order)+1,0) FROM ss_script_profile WHERE profile_id=?1",
            params![pid], |r| r.get(0)
        ).unwrap_or(0);
        db.execute(
            "INSERT OR IGNORE INTO ss_script_profile (script_id,profile_id,sort_order) VALUES (?1,?2,?3)",
            params![script_id, pid, max_ord]
        ).map_err(|e| e.to_string())?;
    }

    Ok(SsScript {
        id: script_id, name: data.name, description: desc, script_type: stype,
        content: Some(content), run_as_admin: admin,
        last_run: None, last_status: "never".into(), last_error: None,
        order: max_mo, enabled: true,
        in_profiles: profile_id.map(|p| vec![p]).unwrap_or_default(),
    })
}

#[tauri::command]
pub fn ss_edit_script(state: State<AppState>, script_id: i64, data: SsScriptData) -> Result<bool, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE scripts SET name=?1,description=?2,script_type=?3,content=?4,run_as_admin=?5 WHERE id=?6",
        params![
            data.name, data.description.unwrap_or_default(),
            data.script_type.unwrap_or_else(|| "ps1".into()),
            data.content.unwrap_or_default(),
            data.run_as_admin.unwrap_or(false) as i64,
            script_id
        ]
    ).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn ss_remove_scripts(state: State<AppState>, profile_id: Option<i64>, ids: Vec<i64>) -> Result<bool, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    for sid in &ids {
        if profile_id.is_none() {
            // Master = global delete
            db.execute("DELETE FROM ss_script_profile WHERE script_id=?1", params![sid]).map_err(|e| e.to_string())?;
            db.execute("DELETE FROM scripts WHERE id=?1", params![sid]).map_err(|e| e.to_string())?;
        } else {
            let pid = profile_id.unwrap();
            db.execute("DELETE FROM ss_script_profile WHERE script_id=?1 AND profile_id=?2", params![sid, pid]).map_err(|e| e.to_string())?;
        }
    }
    if profile_id.is_some() { gc_orphaned_scripts(&db); }
    Ok(true)
}

#[tauri::command]
pub fn ss_toggle_scripts(state: State<AppState>, profile_id: Option<i64>, ids: Vec<i64>) -> Result<std::collections::HashMap<i64, bool>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let mut result = std::collections::HashMap::new();
    for sid in &ids {
        if let Some(pid) = profile_id {
            // Toggle ss_script_profile.disabled
            let cur: i64 = db.query_row(
                "SELECT disabled FROM ss_script_profile WHERE script_id=?1 AND profile_id=?2",
                params![sid, pid], |r| r.get(0)
            ).unwrap_or(0);
            let new_disabled = if cur == 0 { 1i64 } else { 0i64 };
            db.execute(
                "UPDATE ss_script_profile SET disabled=?1 WHERE script_id=?2 AND profile_id=?3",
                params![new_disabled, sid, pid]
            ).map_err(|e| e.to_string())?;
            result.insert(*sid, new_disabled == 0); // enabled = !disabled
        } else {
            // Toggle master_disabled on scripts table
            let cur: i64 = db.query_row("SELECT COALESCE(master_disabled,0) FROM scripts WHERE id=?1", params![sid], |r| r.get(0)).unwrap_or(0);
            let new_dis = if cur == 0 { 1i64 } else { 0i64 };
            db.execute("UPDATE scripts SET master_disabled=?1 WHERE id=?2", params![new_dis, sid]).map_err(|e| e.to_string())?;
            result.insert(*sid, new_dis == 0);
        }
    }
    Ok(result)
}

#[tauri::command]
pub fn ss_reorder_scripts(state: State<AppState>, profile_id: Option<i64>, ordered_ids: Vec<i64>) -> Result<bool, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    for (i, sid) in ordered_ids.iter().enumerate() {
        if let Some(pid) = profile_id {
            let _ = db.execute(
                "UPDATE ss_script_profile SET sort_order=?1 WHERE script_id=?2 AND profile_id=?3",
                params![i as i64, sid, pid]
            );
        } else {
            let _ = db.execute("UPDATE scripts SET master_order=?1 WHERE id=?2", params![i as i64, sid]);
        }
    }
    Ok(true)
}

#[tauri::command]
pub fn ss_duplicate_script(state: State<AppState>, profile_id: Option<i64>, script_id: i64) -> Result<Option<SsScript>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    // Fetch original
    let src = db.query_row(
        "SELECT name,description,script_type,content,run_as_admin,master_order FROM scripts WHERE id=?1",
        params![script_id],
        |r| Ok((r.get::<_,String>(0)?, r.get::<_,String>(1)?, r.get::<_,String>(2)?, r.get::<_,Option<String>>(3)?, r.get::<_,i64>(4)? != 0, r.get::<_,i64>(5)?))
    ).map_err(|e| e.to_string())?;

    let new_name = format!("{} (copy)", src.0);
    let new_mo = src.5 + 1;
    // Shift other scripts down
    let _ = db.execute("UPDATE scripts SET master_order=master_order+1 WHERE master_order>?1", params![src.5]);

    db.execute(
        "INSERT INTO scripts (name,description,script_type,content,run_as_admin,master_order,file_path,category) VALUES (?1,?2,?3,?4,?5,?6,'','')",
        params![new_name, src.1, src.2, src.3.clone().unwrap_or_default(), src.4 as i64, new_mo]
    ).map_err(|e| e.to_string())?;
    let new_id = db.last_insert_rowid();

    // Add to same profile, after source
    if let Some(pid) = profile_id {
        let src_ord: i64 = db.query_row(
            "SELECT sort_order FROM ss_script_profile WHERE script_id=?1 AND profile_id=?2",
            params![script_id, pid], |r| r.get(0)
        ).unwrap_or(0);
        let _ = db.execute("UPDATE ss_script_profile SET sort_order=sort_order+1 WHERE profile_id=?1 AND sort_order>?2", params![pid, src_ord]);
        db.execute(
            "INSERT INTO ss_script_profile (script_id,profile_id,sort_order) VALUES (?1,?2,?3)",
            params![new_id, pid, src_ord + 1]
        ).map_err(|e| e.to_string())?;
    }

    Ok(Some(SsScript {
        id: new_id, name: new_name, description: src.1, script_type: src.2,
        content: src.3, run_as_admin: src.4,
        last_run: None, last_status: "never".into(), last_error: None,
        order: new_mo, enabled: true,
        in_profiles: profile_id.map(|p| vec![p]).unwrap_or_default(),
    }))
}

#[tauri::command]
pub fn ss_set_script_profiles(state: State<AppState>, script_id: i64, profile_ids: Vec<i64>) -> Result<bool, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let target: std::collections::HashSet<i64> = profile_ids.iter().copied().collect();

    // Get current profiles for this script
    let mut stmt = db.prepare("SELECT profile_id FROM ss_script_profile WHERE script_id=?1").map_err(|e| e.to_string())?;
    let current: std::collections::HashSet<i64> = stmt.query_map(params![script_id], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Remove from profiles no longer wanted
    for pid in current.difference(&target) {
        db.execute("DELETE FROM ss_script_profile WHERE script_id=?1 AND profile_id=?2", params![script_id, pid]).map_err(|e| e.to_string())?;
    }
    // Add to new profiles
    for pid in target.difference(&current) {
        let max_ord: i64 = db.query_row(
            "SELECT COALESCE(MAX(sort_order)+1,0) FROM ss_script_profile WHERE profile_id=?1",
            params![pid], |r| r.get(0)
        ).unwrap_or(0);
        db.execute(
            "INSERT OR IGNORE INTO ss_script_profile (script_id,profile_id,sort_order) VALUES (?1,?2,?3)",
            params![script_id, pid, max_ord]
        ).map_err(|e| e.to_string())?;
    }
    Ok(true)
}

#[tauri::command]
pub fn ss_copy_scripts_to_profile(state: State<AppState>, script_ids: Vec<i64>, target_profile_ids: Vec<i64>) -> Result<i64, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let mut copied = 0i64;
    for tpid in &target_profile_ids {
        for sid in &script_ids {
            let exists: i64 = db.query_row(
                "SELECT COUNT(*) FROM ss_script_profile WHERE script_id=?1 AND profile_id=?2",
                params![sid, tpid], |r| r.get(0)
            ).unwrap_or(0);
            if exists == 0 {
                let max_ord: i64 = db.query_row(
                    "SELECT COALESCE(MAX(sort_order)+1,0) FROM ss_script_profile WHERE profile_id=?1",
                    params![tpid], |r| r.get(0)
                ).unwrap_or(0);
                let _ = db.execute(
                    "INSERT INTO ss_script_profile (script_id,profile_id,sort_order) VALUES (?1,?2,?3)",
                    params![sid, tpid, max_ord]
                );
                copied += 1;
            }
        }
    }
    Ok(copied)
}

// ── Import / Export ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn ss_export_profile(state: State<AppState>, profile_id: Option<i64>) -> Result<String, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let scripts = query_ss_scripts(&db, profile_id)?;
    let prof_name = if let Some(pid) = profile_id {
        db.query_row("SELECT name FROM ss_profiles WHERE id=?1", params![pid], |r| r.get::<_,String>(0))
            .unwrap_or_else(|_| "Profile".into())
    } else {
        "Master".into()
    };
    let profile = SsExportProfile {
        id: profile_id.map(|p| p.to_string()).unwrap_or_else(|| "master".into()),
        name: prof_name,
        script_order: scripts.iter().map(|s| s.id.to_string()).collect(),
        disabled_scripts: scripts.iter().filter(|s| !s.enabled).map(|s| s.id.to_string()).collect(),
    };
    let export_scripts: Vec<SsExportScript> = scripts.iter().map(|s| SsExportScript {
        id: s.id.to_string(),
        name: s.name.clone(),
        description: s.description.clone(),
        script_type: s.script_type.clone(),
        content: s.content.clone().unwrap_or_default(),
        run_as_admin: s.run_as_admin,
        enabled: s.enabled,
        order: s.order,
        state: SsExportState { last_run: s.last_run.clone(), last_status: s.last_status.clone(), last_error: s.last_error.clone() },
    }).collect();
    let file = SsExportFile { version: 3, profile, scripts: export_scripts };
    serde_json::to_string_pretty(&file).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ss_import_profile(state: State<AppState>, profile_id: Option<i64>, json: String) -> Result<i64, String> {
    // Parse — accept ScriptStash v3 format or simple {scripts:[...]} format
    let val: serde_json::Value = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    let raw_scripts: Vec<&serde_json::Value> = if let Some(arr) = val.get("scripts").and_then(|v| v.as_array()) {
        arr.iter().collect()
    } else { return Ok(0); };

    let db = state.0.lock().map_err(|e| e.to_string())?;

    // Pick target profile: specified, or first available, or create one
    let target_pid = if let Some(pid) = profile_id {
        pid
    } else {
        let first: Option<i64> = db.query_row("SELECT id FROM ss_profiles LIMIT 1", [], |r| r.get(0)).ok();
        if let Some(p) = first { p } else {
            db.execute("INSERT INTO ss_profiles (name) VALUES ('Imported')", []).map_err(|e| e.to_string())?;
            db.last_insert_rowid()
        }
    };

    let mut added = 0i64;
    for s in raw_scripts {
        let name = s.get("name").and_then(|v| v.as_str()).unwrap_or("Script").to_string();
        let stype = s.get("type").and_then(|v| v.as_str()).unwrap_or("ps1").to_string();
        let content = s.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let desc = s.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let admin = s.get("runAsAdmin").and_then(|v| v.as_bool()).unwrap_or(false);
        let last_status = s.get("state").and_then(|v| v.get("lastStatus")).and_then(|v| v.as_str()).unwrap_or("never").to_string();
        let last_run = s.get("state").and_then(|v| v.get("lastRun")).and_then(|v| v.as_str()).map(|s| s.to_string());

        let max_mo: i64 = db.query_row("SELECT COALESCE(MAX(master_order)+1,0) FROM scripts", [], |r| r.get(0)).unwrap_or(0);
        db.execute(
            "INSERT INTO scripts (name,description,script_type,content,run_as_admin,master_order,last_status,last_run,file_path,category) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'','')",
            params![name, desc, stype, content, admin as i64, max_mo, last_status, last_run]
        ).map_err(|e| e.to_string())?;
        let sid = db.last_insert_rowid();

        let max_ord: i64 = db.query_row(
            "SELECT COALESCE(MAX(sort_order)+1,0) FROM ss_script_profile WHERE profile_id=?1",
            params![target_pid], |r| r.get(0)
        ).unwrap_or(0);
        db.execute(
            "INSERT OR IGNORE INTO ss_script_profile (script_id,profile_id,sort_order) VALUES (?1,?2,?3)",
            params![sid, target_pid, max_ord]
        ).map_err(|e| e.to_string())?;
        added += 1;
    }
    Ok(added)
}

// ── Run system ────────────────────────────────────────────────────────────────

fn ss_run_script_sync(name: &str, stype: &str, content: &str, run_admin: bool) -> (i32, Option<String>) {
    use std::os::windows::process::CommandExt;
    const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;

    let interactive = matches!(stype, "ps1" | "bat" | "cmd" | "py" | "sh");
    let n = tmp_counter();

    let tmp = std::env::temp_dir().join(format!("ctrl_ss_{n}.{stype}"));
    if let Err(e) = fs::write(&tmp, content) {
        return (-1, Some(e.to_string()));
    }

    let mut cleanup = vec![tmp.clone()];
    let rc;

    if interactive {
        let ps_exe = crate::commands::exec::ps_bin();
        let inner = match stype {
            "ps1" => format!("\"{ps_exe}\" -ExecutionPolicy Bypass -File \"{}\"", tmp.display()),
            "py"  => format!("python \"{}\"", tmp.display()),
            "sh"  => format!("bash \"{}\"", tmp.display()),
            _     => format!("call \"{}\"", tmp.display()),
        };
        let wrapper = std::env::temp_dir().join(format!("ctrl_ss_wrap_{n}.bat"));
        let bat = format!("@echo off\ntitle {name}\n{inner}\npause\n");
        if let Err(e) = fs::write(&wrapper, bat) { cleanup.push(wrapper); for p in &cleanup { let _ = fs::remove_file(p); } return (-1, Some(e.to_string())); }
        cleanup.push(wrapper.clone());

        if run_admin {
            let ps1 = std::env::temp_dir().join(format!("ctrl_ss_adm_{n}.ps1"));
            let ps1_body = format!(
                "$w = \"{}\"\ntry {{\n    $p = Start-Process -FilePath cmd.exe -ArgumentList \"/C `\"$w`\"\" -Verb RunAs -Wait -PassThru\n    if ($p) {{ exit $p.ExitCode }} else {{ exit 1 }}\n}} catch {{ exit 1 }}\n",
                wrapper.display().to_string().replace('"', "'")
            );
            if fs::write(&ps1, ps1_body).is_ok() {
                cleanup.push(ps1.clone());
                let status = std::process::Command::new(ps_exe)
                    .args(["-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", &ps1.to_string_lossy()])
                    .status();
                rc = status.map(|s| s.code().unwrap_or(-1)).unwrap_or(-1);
            } else { rc = -1; }
        } else {
            let status = std::process::Command::new("cmd.exe")
                .args(["/C", &wrapper.to_string_lossy()])
                .creation_flags(CREATE_NEW_CONSOLE)
                .status();
            rc = status.map(|s| s.code().unwrap_or(-1)).unwrap_or(-1);
        }
    } else {
        // Silent runners
        let (prog, args, flags): (&str, Vec<String>, u32) = match stype {
            "vbs" | "vbe" | "js" => ("wscript.exe", vec![tmp.to_string_lossy().into_owned()], CREATE_NEW_CONSOLE),
            "reg" => ("regedit.exe", vec!["/s".into(), tmp.to_string_lossy().into_owned()], 0),
            "ahk" => ("autohotkey.exe", vec![tmp.to_string_lossy().into_owned()], CREATE_NEW_CONSOLE),
            _ => ("cmd.exe", vec!["/C".into(), tmp.to_string_lossy().into_owned()], CREATE_NEW_CONSOLE),
        };
        if run_admin {
            let ps_exe = crate::commands::exec::ps_bin();
            let ps1 = std::env::temp_dir().join(format!("ctrl_ss_adm_{n}.ps1"));
            let cmd_line = format!("{} {}", prog, args.join(" "));
            let ps1_body = format!(
                "Start-Process -FilePath \"{}\" -ArgumentList \"{}\" -Verb RunAs -Wait\n",
                prog, args.join("\" \"")
            );
            if fs::write(&ps1, ps1_body).is_ok() {
                cleanup.push(ps1.clone());
                let status = std::process::Command::new(ps_exe)
                    .args(["-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", &ps1.to_string_lossy()])
                    .status();
                rc = status.map(|s| s.code().unwrap_or(-1)).unwrap_or(-1);
            } else { rc = -1; }
            let _ = cmd_line; // suppress warning
        } else {
            let status = std::process::Command::new(prog)
                .args(&args)
                .creation_flags(flags)
                .status();
            rc = status.map(|s| s.code().unwrap_or(-1)).unwrap_or(-1);
        }
    }

    for p in &cleanup { let _ = fs::remove_file(p); }
    (rc, None)
}

fn do_run(app: tauri::AppHandle, scripts: Vec<SsScript>, force_admin: bool) {
    ss_stop().store(false, Ordering::SeqCst);
    ss_running().store(true, Ordering::SeqCst);
    let _ = app.emit("ss-run-state", serde_json::json!({"running": true}));

    std::thread::spawn(move || {
        let enabled: Vec<&SsScript> = scripts.iter().filter(|s| s.enabled).collect();
        if enabled.is_empty() {
            let _ = app.emit("ss-log", serde_json::json!({"level":"info","msg":"No enabled scripts to run."}));
            let _ = app.emit("ss-run-done", serde_json::json!({"count":0,"failed":0}));
        } else {
            let total = enabled.len();
            let _ = app.emit("ss-log", serde_json::json!({"level":"info","msg": format!("Starting — {total} script(s) queued.")}));
            let _ = app.emit("ss-run-start", serde_json::json!({"total": total}));
            let mut failed = 0usize;

            for (i, s) in enabled.iter().enumerate() {
                if ss_stop().load(Ordering::SeqCst) {
                    let _ = app.emit("ss-log", serde_json::json!({"level":"warn","msg":"Stopped by user."}));
                    break;
                }
                let _ = app.emit("ss-script-start", serde_json::json!({"id": s.id, "index": i+1, "total": total}));
                let run_admin = force_admin || s.run_as_admin;
                let admin_tag = if run_admin { " (Admin)" } else { "" };
                let _ = app.emit("ss-log", serde_json::json!({"level":"info","msg": format!("▶ {}  ({}){}", s.name, s.script_type.to_uppercase(), admin_tag)}));

                let content = s.content.clone().unwrap_or_default();
                let (rc, err) = ss_run_script_sync(&s.name, &s.script_type, &content, run_admin);
                let status = if rc == 0 && err.is_none() { "success" } else { "failed" };
                if rc != 0 { failed += 1; }

                let log_level = if rc == 0 { "ok" } else { "warn" };
                let log_msg = if rc == 0 {
                    format!("✓ {}  completed", s.name)
                } else {
                    format!("⚠ {}  closed early (exit {})", s.name, rc)
                };
                let _ = app.emit("ss-log", serde_json::json!({"level": log_level, "msg": log_msg}));

                // Update last_run / last_status in DB
                let now = {
                    use std::time::{SystemTime, UNIX_EPOCH};
                    let secs = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
                    format!("{}", secs)
                };
                {
                    use tauri::Manager;
                    if let Some(app_state) = app.try_state::<AppState>() {
                        if let Ok(db) = app_state.0.lock() {
                            let _ = db.execute(
                                "UPDATE scripts SET last_run=?1,last_status=?2,last_error=?3 WHERE id=?4",
                                params![now, status, err.as_deref(), s.id]
                            );
                        }
                    }
                }
                let _ = app.emit("ss-script-done", serde_json::json!({"id": s.id, "status": status, "exitCode": rc}));

                if ss_stop().load(Ordering::SeqCst) {
                    let _ = app.emit("ss-log", serde_json::json!({"level":"warn","msg":"Stopped by user."}));
                    break;
                }
            }

            let done_msg = if failed > 0 {
                format!("Run complete — {} ran, {} failed.", total, failed)
            } else {
                format!("Run complete — {total} script(s) completed.")
            };
            let _ = app.emit("ss-log", serde_json::json!({"level": if failed>0 {"warn"} else {"ok"}, "msg": done_msg}));
            let _ = app.emit("ss-run-done", serde_json::json!({"count": total, "failed": failed}));
        }

        ss_running().store(false, Ordering::SeqCst);
        let _ = app.emit("ss-run-state", serde_json::json!({"running": false}));
    });
}

#[tauri::command]
pub fn ss_start_run(
    app: tauri::AppHandle,
    state: State<AppState>,
    profile_id: Option<i64>,
    ids: Option<Vec<i64>>,
    run_as_admin: bool,
) -> Result<bool, String> {
    if ss_running().load(Ordering::SeqCst) { return Ok(false); }
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let mut scripts = query_ss_scripts(&db, profile_id)?;
    if let Some(ref id_list) = ids {
        let id_set: std::collections::HashSet<i64> = id_list.iter().copied().collect();
        scripts = scripts.into_iter().filter(|s| id_set.contains(&s.id)).map(|mut s| { s.enabled = true; s }).collect();
    }
    drop(db);
    do_run(app, scripts, run_as_admin);
    Ok(true)
}

#[tauri::command]
pub fn ss_run_now(
    app: tauri::AppHandle,
    state: State<AppState>,
    profile_id: Option<i64>,
    script_id: i64,
    run_as_admin: bool,
) -> Result<bool, String> {
    if ss_running().load(Ordering::SeqCst) { return Ok(false); }
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let all = query_ss_scripts(&db, profile_id)?;
    let mut s = all.into_iter().find(|x| x.id == script_id).ok_or("Script not found")?;
    s.enabled = true;
    drop(db);
    do_run(app, vec![s], run_as_admin);
    Ok(true)
}

#[tauri::command]
pub fn ss_stop_run() -> Result<bool, String> {
    ss_stop().store(true, Ordering::SeqCst);
    Ok(true)
}

// ── File-pick helpers for import/export ──────────────────────────────────────

#[tauri::command]
pub async fn ss_import_pick_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = app.dialog().file()
        .add_filter("JSON", &["json"])
        .blocking_pick_file();
    match path {
        Some(p) => {
            let content = fs::read_to_string(p.to_string()).map_err(|e| e.to_string())?;
            Ok(Some(content))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn ss_export_pick_file(app: tauri::AppHandle, json: String, suggested: String) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = app.dialog().file()
        .add_filter("JSON", &["json"])
        .set_file_name(&suggested)
        .blocking_save_file();
    match path {
        Some(p) => {
            fs::write(p.to_string(), json).map_err(|e| e.to_string())?;
            Ok(true)
        }
        None => Ok(false),
    }
}
