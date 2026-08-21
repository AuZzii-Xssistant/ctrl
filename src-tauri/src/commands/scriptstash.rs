//! ScriptStash port — full replica of the ScriptStash app inside CTRL.
//! Profiles, global master view, run queue with events, drag-reorder,
//! toggle enable/disable, duplicate, import/export, keyboard shortcuts.

use crate::AppState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use tauri::State;

// ── Global run state ──────────────────────────────────────────────────────────

// Always false — the only writer (do_run/ss_start_run, the old spawn-external-console
// run queue) was removed 2026-08-17 as dead code. Kept because ss_get_state's `running`
// field still reads it; the JS side tracks its own S.running instead now.
fn ss_running() -> &'static Arc<AtomicBool> {
    static R: OnceLock<Arc<AtomicBool>> = OnceLock::new();
    R.get_or_init(|| Arc::new(AtomicBool::new(false)))
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
    pub interactive: bool,
    #[serde(rename = "inMaster")]
    pub in_master: bool,
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
    pub interactive: Option<bool>,
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
    // "Pause Script" — was missing here entirely, so export/import silently
    // dropped it on every round-trip (always came back off). See known-issues.md.
    #[serde(default)]
    interactive: bool,
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

fn query_ss_scripts(
    db: &rusqlite::Connection,
    profile_id: Option<i64>,
) -> Result<Vec<SsScript>, String> {
    // Subquery for in_profiles
    let ip_sub =
        "(SELECT GROUP_CONCAT(sp2.profile_id) FROM ss_script_profile sp2 WHERE sp2.script_id=s.id)";

    if let Some(pid) = profile_id {
        let sql = format!(
            "SELECT s.id,s.name,COALESCE(s.description,''),COALESCE(s.script_type,'ps1'),s.content,
             COALESCE(s.run_as_admin,0),s.last_run,COALESCE(s.last_status,'never'),s.last_error,
             sp.sort_order, CASE WHEN sp.disabled=0 THEN 1 ELSE 0 END, {ip_sub}, COALESCE(s.interactive,0), COALESCE(s.in_master,1)
             FROM scripts s
             JOIN ss_script_profile sp ON sp.script_id=s.id AND sp.profile_id=?1
             ORDER BY sp.sort_order, s.name"
        );
        let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![pid], |r| {
                let in_p: Option<String> = r.get(11)?;
                Ok(SsScript {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    description: r.get(2)?,
                    script_type: r.get(3)?,
                    content: r.get(4)?,
                    run_as_admin: r.get::<_, i64>(5)? != 0,
                    last_run: r.get(6)?,
                    last_status: r.get(7)?,
                    last_error: r.get(8)?,
                    order: r.get(9)?,
                    enabled: r.get::<_, i64>(10)? != 0,
                    in_profiles: parse_in_profiles(in_p),
                    interactive: r.get::<_, i64>(12)? != 0,
                    in_master: r.get::<_, i64>(13)? != 0,
                })
            })
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    } else {
        // Master: scripts with in_master=1 — Master is a real toggleable profile now
        let sql = format!(
            "SELECT s.id,s.name,COALESCE(s.description,''),COALESCE(s.script_type,'ps1'),s.content,
             COALESCE(s.run_as_admin,0),s.last_run,COALESCE(s.last_status,'never'),s.last_error,
             COALESCE(s.master_order,9999), CASE WHEN COALESCE(s.master_disabled,0)=0 THEN 1 ELSE 0 END, {ip_sub}, COALESCE(s.interactive,0), COALESCE(s.in_master,1)
             FROM scripts s
             WHERE COALESCE(s.in_master,1)=1
             ORDER BY COALESCE(s.master_order,9999), s.name"
        );
        let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                let in_p: Option<String> = r.get(11)?;
                Ok(SsScript {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    description: r.get(2)?,
                    script_type: r.get(3)?,
                    content: r.get(4)?,
                    run_as_admin: r.get::<_, i64>(5)? != 0,
                    last_run: r.get(6)?,
                    last_status: r.get(7)?,
                    last_error: r.get(8)?,
                    order: r.get(9)?,
                    enabled: r.get::<_, i64>(10)? != 0,
                    in_profiles: parse_in_profiles(in_p),
                    interactive: r.get::<_, i64>(12)? != 0,
                    in_master: r.get::<_, i64>(13)? != 0,
                })
            })
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }
}

fn parse_in_profiles(s: Option<String>) -> Vec<i64> {
    s.unwrap_or_default()
        .split(',')
        .filter_map(|x| x.trim().parse::<i64>().ok())
        .collect()
}

fn query_profiles(db: &rusqlite::Connection) -> Result<Vec<SsProfile>, String> {
    let mut stmt = db
        .prepare(
            "SELECT p.id,p.name,COUNT(sp.script_id) FROM ss_profiles p
         LEFT JOIN ss_script_profile sp ON sp.profile_id=p.id
         GROUP BY p.id ORDER BY p.sort_order, p.name",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(SsProfile {
                id: r.get(0)?,
                name: r.get(1)?,
                script_count: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn ss_get_state(state: State<AppState>, profile_id: Option<i64>) -> Result<SsState, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let scripts = query_ss_scripts(&db, profile_id)?;
    let profiles = query_profiles(&db)?;
    Ok(SsState {
        scripts,
        profiles,
        running: ss_running().load(Ordering::SeqCst),
    })
}

#[tauri::command]
pub fn ss_add_profile(state: State<AppState>, name: String) -> Result<SsProfile, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute("INSERT INTO ss_profiles (name) VALUES (?1)", params![name])
        .map_err(|e| e.to_string())?;
    let id = db.last_insert_rowid();
    Ok(SsProfile {
        id,
        name,
        script_count: 0,
    })
}

#[tauri::command]
pub fn ss_rename_profile(state: State<AppState>, id: i64, name: String) -> Result<bool, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE ss_profiles SET name=?1 WHERE id=?2",
        params![name, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn ss_remove_profile(state: State<AppState>, id: i64) -> Result<bool, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    // The confirm dialog (scripts.js) promises "scripts only in this profile will
    // also be deleted" -- but there's no FK cascade on ss_script_profile, so without
    // this, a script whose sole membership was this profile just lost its only join
    // row and became permanently invisible (not in Master, not in any profile) while
    // its row stayed in `scripts` forever. Delete those for real, matching the promise.
    let orphan_ids: Vec<i64> = {
        let mut stmt = db.prepare(
            "SELECT sp.script_id FROM ss_script_profile sp
             JOIN scripts s ON s.id = sp.script_id
             WHERE sp.profile_id = ?1
               AND COALESCE(s.in_master,1) = 0
               AND NOT EXISTS (SELECT 1 FROM ss_script_profile sp2 WHERE sp2.script_id = sp.script_id AND sp2.profile_id <> ?1)"
        ).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![id], |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };
    db.execute(
        "DELETE FROM ss_script_profile WHERE profile_id=?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    for sid in orphan_ids {
        let _ = db.execute("DELETE FROM scripts WHERE id=?1", params![sid]);
    }
    db.execute("DELETE FROM ss_profiles WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn ss_duplicate_profile(
    state: State<AppState>,
    id: i64,
    new_name: String,
) -> Result<Option<SsProfile>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    // Create new profile
    db.execute(
        "INSERT INTO ss_profiles (name) VALUES (?1)",
        params![new_name],
    )
    .map_err(|e| e.to_string())?;
    let new_id = db.last_insert_rowid();
    // Copy all script memberships (same scripts, same order, same disabled state)
    db.execute(
        "INSERT INTO ss_script_profile (script_id, profile_id, sort_order, disabled)
         SELECT script_id, ?1, sort_order, disabled FROM ss_script_profile WHERE profile_id=?2",
        params![new_id, id],
    )
    .map_err(|e| e.to_string())?;
    let count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM ss_script_profile WHERE profile_id=?1",
            params![new_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    Ok(Some(SsProfile {
        id: new_id,
        name: new_name,
        script_count: count,
    }))
}

#[tauri::command]
pub fn ss_add_script(
    state: State<AppState>,
    profile_id: Option<i64>,
    data: SsScriptData,
) -> Result<SsScript, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let desc = data.description.unwrap_or_default();
    let stype = data.script_type.unwrap_or_else(|| "ps1".into());
    let content = data.content.unwrap_or_default();
    let admin = data.run_as_admin.unwrap_or(false);
    let pause = data.interactive.unwrap_or(false);
    // Created directly on Master → in Master. Created on a named profile → that
    // profile only, not auto-added to Master (Master is a toggleable membership).
    let in_master = profile_id.is_none();
    let max_mo: i64 = db
        .query_row(
            "SELECT COALESCE(MAX(master_order)+1, 0) FROM scripts",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    db.execute(
        "INSERT INTO scripts (name,description,script_type,content,run_as_admin,interactive,in_master,master_order,file_path,category) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'','')",
        params![data.name, desc, stype, content, admin as i64, pause as i64, in_master as i64, max_mo]
    ).map_err(|e| e.to_string())?;
    let script_id = db.last_insert_rowid();

    if let Some(pid) = profile_id {
        let max_ord: i64 = db
            .query_row(
                "SELECT COALESCE(MAX(sort_order)+1,0) FROM ss_script_profile WHERE profile_id=?1",
                params![pid],
                |r| r.get(0),
            )
            .unwrap_or(0);
        db.execute(
            "INSERT OR IGNORE INTO ss_script_profile (script_id,profile_id,sort_order) VALUES (?1,?2,?3)",
            params![script_id, pid, max_ord]
        ).map_err(|e| e.to_string())?;
    }

    Ok(SsScript {
        id: script_id,
        name: data.name,
        description: desc,
        script_type: stype,
        content: Some(content),
        run_as_admin: admin,
        last_run: None,
        last_status: "never".into(),
        last_error: None,
        order: max_mo,
        enabled: true,
        in_profiles: profile_id.map(|p| vec![p]).unwrap_or_default(),
        interactive: pause,
        in_master,
    })
}

#[tauri::command]
pub fn ss_edit_script(
    state: State<AppState>,
    script_id: i64,
    data: SsScriptData,
) -> Result<bool, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE scripts SET name=?1,description=?2,script_type=?3,content=?4,run_as_admin=?5,interactive=?6 WHERE id=?7",
        params![
            data.name, data.description.unwrap_or_default(),
            data.script_type.unwrap_or_else(|| "ps1".into()),
            data.content.unwrap_or_default(),
            data.run_as_admin.unwrap_or(false) as i64,
            data.interactive.unwrap_or(false) as i64,
            script_id
        ]
    ).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn ss_remove_scripts(
    state: State<AppState>,
    profile_id: Option<i64>,
    ids: Vec<i64>,
) -> Result<bool, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    for sid in &ids {
        if let Some(pid) = profile_id {
            // The confirm dialog (scripts.js) promises "scripts not in any other
            // profile are also deleted" — true only when the script is also NOT
            // in Master. A script created directly under a profile (in_master=0,
            // no other membership) would otherwise lose its only join row here
            // and become a permanently invisible dead row, same bug class as
            // ss_remove_profile below.
            let in_master: i64 = db
                .query_row(
                    "SELECT COALESCE(in_master,1) FROM scripts WHERE id=?1",
                    params![sid],
                    |r| r.get(0),
                )
                .unwrap_or(1);
            let other_profiles: i64 = db
                .query_row(
                    "SELECT COUNT(*) FROM ss_script_profile WHERE script_id=?1 AND profile_id<>?2",
                    params![sid, pid],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            db.execute(
                "DELETE FROM ss_script_profile WHERE script_id=?1 AND profile_id=?2",
                params![sid, pid],
            )
            .map_err(|e| e.to_string())?;
            if in_master == 0 && other_profiles == 0 {
                let _ = db.execute("DELETE FROM scripts WHERE id=?1", params![sid]);
            }
        } else {
            // Master = global delete
            db.execute(
                "DELETE FROM ss_script_profile WHERE script_id=?1",
                params![sid],
            )
            .map_err(|e| e.to_string())?;
            db.execute("DELETE FROM scripts WHERE id=?1", params![sid])
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(true)
}

#[tauri::command]
pub fn ss_toggle_scripts(
    state: State<AppState>,
    profile_id: Option<i64>,
    ids: Vec<i64>,
) -> Result<std::collections::HashMap<i64, bool>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let mut result = std::collections::HashMap::new();
    for sid in &ids {
        if let Some(pid) = profile_id {
            // Toggle ss_script_profile.disabled
            let cur: i64 = db
                .query_row(
                    "SELECT disabled FROM ss_script_profile WHERE script_id=?1 AND profile_id=?2",
                    params![sid, pid],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            let new_disabled = if cur == 0 { 1i64 } else { 0i64 };
            db.execute(
                "UPDATE ss_script_profile SET disabled=?1 WHERE script_id=?2 AND profile_id=?3",
                params![new_disabled, sid, pid],
            )
            .map_err(|e| e.to_string())?;
            result.insert(*sid, new_disabled == 0); // enabled = !disabled
        } else {
            // Toggle master_disabled on scripts table
            let cur: i64 = db
                .query_row(
                    "SELECT COALESCE(master_disabled,0) FROM scripts WHERE id=?1",
                    params![sid],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            let new_dis = if cur == 0 { 1i64 } else { 0i64 };
            db.execute(
                "UPDATE scripts SET master_disabled=?1 WHERE id=?2",
                params![new_dis, sid],
            )
            .map_err(|e| e.to_string())?;
            result.insert(*sid, new_dis == 0);
        }
    }
    Ok(result)
}

#[tauri::command]
pub fn ss_reorder_scripts(
    state: State<AppState>,
    profile_id: Option<i64>,
    ordered_ids: Vec<i64>,
) -> Result<bool, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    for (i, sid) in ordered_ids.iter().enumerate() {
        if let Some(pid) = profile_id {
            let _ = db.execute(
                "UPDATE ss_script_profile SET sort_order=?1 WHERE script_id=?2 AND profile_id=?3",
                params![i as i64, sid, pid],
            );
        } else {
            let _ = db.execute(
                "UPDATE scripts SET master_order=?1 WHERE id=?2",
                params![i as i64, sid],
            );
        }
    }
    Ok(true)
}

#[tauri::command]
pub fn ss_duplicate_script(
    state: State<AppState>,
    profile_id: Option<i64>,
    script_id: i64,
) -> Result<Option<SsScript>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    // Fetch original
    let src = db.query_row(
        "SELECT name,description,script_type,content,run_as_admin,master_order,COALESCE(interactive,0),COALESCE(in_master,1) FROM scripts WHERE id=?1",
        params![script_id],
        |r| Ok((r.get::<_,String>(0)?, r.get::<_,String>(1)?, r.get::<_,String>(2)?, r.get::<_,Option<String>>(3)?, r.get::<_,i64>(4)? != 0, r.get::<_,i64>(5)?, r.get::<_,i64>(6)? != 0, r.get::<_,i64>(7)? != 0))
    ).map_err(|e| e.to_string())?;

    let new_name = format!("{} (copy)", src.0);
    let new_mo = src.5 + 1;
    // Shift other scripts down
    let _ = db.execute(
        "UPDATE scripts SET master_order=master_order+1 WHERE master_order>?1",
        params![src.5],
    );

    db.execute(
        "INSERT INTO scripts (name,description,script_type,content,run_as_admin,interactive,in_master,master_order,file_path,category) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'','')",
        params![new_name, src.1, src.2, src.3.clone().unwrap_or_default(), src.4 as i64, src.6 as i64, src.7 as i64, new_mo]
    ).map_err(|e| e.to_string())?;
    let new_id = db.last_insert_rowid();

    // Add to same profile, after source
    if let Some(pid) = profile_id {
        let src_ord: i64 = db
            .query_row(
                "SELECT sort_order FROM ss_script_profile WHERE script_id=?1 AND profile_id=?2",
                params![script_id, pid],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let _ = db.execute("UPDATE ss_script_profile SET sort_order=sort_order+1 WHERE profile_id=?1 AND sort_order>?2", params![pid, src_ord]);
        db.execute(
            "INSERT INTO ss_script_profile (script_id,profile_id,sort_order) VALUES (?1,?2,?3)",
            params![new_id, pid, src_ord + 1],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(Some(SsScript {
        id: new_id,
        name: new_name,
        description: src.1,
        script_type: src.2,
        content: src.3,
        run_as_admin: src.4,
        last_run: None,
        last_status: "never".into(),
        last_error: None,
        order: new_mo,
        enabled: true,
        in_profiles: profile_id.map(|p| vec![p]).unwrap_or_default(),
        interactive: src.6,
        in_master: src.7,
    }))
}

#[tauri::command]
pub fn ss_set_script_profiles(
    state: State<AppState>,
    script_id: i64,
    profile_ids: Vec<i64>,
    in_master: bool,
) -> Result<bool, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE scripts SET in_master=?1 WHERE id=?2",
        params![in_master as i64, script_id],
    )
    .map_err(|e| e.to_string())?;
    let target: std::collections::HashSet<i64> = profile_ids.iter().copied().collect();

    // Get current profiles for this script
    let mut stmt = db
        .prepare("SELECT profile_id FROM ss_script_profile WHERE script_id=?1")
        .map_err(|e| e.to_string())?;
    let current: std::collections::HashSet<i64> = stmt
        .query_map(params![script_id], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Remove from profiles no longer wanted
    for pid in current.difference(&target) {
        db.execute(
            "DELETE FROM ss_script_profile WHERE script_id=?1 AND profile_id=?2",
            params![script_id, pid],
        )
        .map_err(|e| e.to_string())?;
    }
    // Add to new profiles
    for pid in target.difference(&current) {
        let max_ord: i64 = db
            .query_row(
                "SELECT COALESCE(MAX(sort_order)+1,0) FROM ss_script_profile WHERE profile_id=?1",
                params![pid],
                |r| r.get(0),
            )
            .unwrap_or(0);
        db.execute(
            "INSERT OR IGNORE INTO ss_script_profile (script_id,profile_id,sort_order) VALUES (?1,?2,?3)",
            params![script_id, pid, max_ord]
        ).map_err(|e| e.to_string())?;
    }
    Ok(true)
}

#[tauri::command]
pub fn ss_copy_scripts_to_profile(
    state: State<AppState>,
    script_ids: Vec<i64>,
    target_profile_ids: Vec<i64>,
) -> Result<i64, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let mut copied = 0i64;
    for tpid in &target_profile_ids {
        for sid in &script_ids {
            let exists: i64 = db
                .query_row(
                    "SELECT COUNT(*) FROM ss_script_profile WHERE script_id=?1 AND profile_id=?2",
                    params![sid, tpid],
                    |r| r.get(0),
                )
                .unwrap_or(0);
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
pub fn ss_export_profile(
    state: State<AppState>,
    profile_id: Option<i64>,
) -> Result<String, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let scripts = query_ss_scripts(&db, profile_id)?;
    let prof_name = if let Some(pid) = profile_id {
        db.query_row(
            "SELECT name FROM ss_profiles WHERE id=?1",
            params![pid],
            |r| r.get::<_, String>(0),
        )
        .unwrap_or_else(|_| "Profile".into())
    } else {
        "Master".into()
    };
    let profile = SsExportProfile {
        id: profile_id
            .map(|p| p.to_string())
            .unwrap_or_else(|| "master".into()),
        name: prof_name,
        script_order: scripts.iter().map(|s| s.id.to_string()).collect(),
        disabled_scripts: scripts
            .iter()
            .filter(|s| !s.enabled)
            .map(|s| s.id.to_string())
            .collect(),
    };
    let export_scripts: Vec<SsExportScript> = scripts
        .iter()
        .map(|s| SsExportScript {
            id: s.id.to_string(),
            name: s.name.clone(),
            description: s.description.clone(),
            script_type: s.script_type.clone(),
            content: s.content.clone().unwrap_or_default(),
            run_as_admin: s.run_as_admin,
            interactive: s.interactive,
            enabled: s.enabled,
            order: s.order,
            state: SsExportState {
                last_run: s.last_run.clone(),
                last_status: s.last_status.clone(),
                last_error: s.last_error.clone(),
            },
        })
        .collect();
    let file = SsExportFile {
        version: 3,
        profile,
        scripts: export_scripts,
    };
    serde_json::to_string_pretty(&file).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ss_import_profile(
    state: State<AppState>,
    profile_id: Option<i64>,
    json: String,
) -> Result<i64, String> {
    // Parse — accept ScriptStash v3 format or simple {scripts:[...]} format
    let val: serde_json::Value = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    let raw_scripts: Vec<&serde_json::Value> =
        if let Some(arr) = val.get("scripts").and_then(|v| v.as_array()) {
            arr.iter().collect()
        } else {
            return Ok(0);
        };

    let db = state.0.lock().map_err(|e| e.to_string())?;

    // Importing on Master (profile_id=None) needs no profile membership at all --
    // in_master defaults to 1 on insert below, which is already sufficient for the
    // script to show up there (query_ss_scripts's Master branch doesn't join
    // ss_script_profile). This used to fall back to "first existing profile, or
    // fabricate a new 'Imported' one" and silently enroll the imported scripts
    // there too -- polluting an unrelated profile the user never chose, with no
    // indication anywhere that it happened.
    let target_pid: Option<i64> = profile_id;

    let mut added = 0i64;
    for s in raw_scripts {
        let name = s
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("Script")
            .to_string();
        let stype = s
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("ps1")
            .to_string();
        let content = s
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let desc = s
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let admin = s
            .get("runAsAdmin")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let interactive = s
            .get("interactive")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let last_status = s
            .get("state")
            .and_then(|v| v.get("lastStatus"))
            .and_then(|v| v.as_str())
            .unwrap_or("never")
            .to_string();
        let last_run = s
            .get("state")
            .and_then(|v| v.get("lastRun"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let max_mo: i64 = db
            .query_row(
                "SELECT COALESCE(MAX(master_order)+1,0) FROM scripts",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        db.execute(
            "INSERT INTO scripts (name,description,script_type,content,run_as_admin,interactive,master_order,last_status,last_run,file_path,category) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'','')",
            params![name, desc, stype, content, admin as i64, interactive as i64, max_mo, last_status, last_run]
        ).map_err(|e| e.to_string())?;
        let sid = db.last_insert_rowid();

        if let Some(pid) = target_pid {
            let max_ord: i64 = db
                .query_row(
                    "SELECT COALESCE(MAX(sort_order)+1,0) FROM ss_script_profile WHERE profile_id=?1",
                    params![pid],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            db.execute(
                "INSERT OR IGNORE INTO ss_script_profile (script_id,profile_id,sort_order) VALUES (?1,?2,?3)",
                params![sid, pid, max_ord]
            ).map_err(|e| e.to_string())?;
        }
        added += 1;
    }
    Ok(added)
}

// NOTE: ss_run_script_sync/do_run/ss_start_run/ss_run_now/ss_stop_run/ss_run_embedded
// were removed 2026-08-17 — dead code with zero frontend callers, confirmed via grep
// across src/. This was the original spawn-external-console run queue plus an early
// PTY-embedded prototype; both fully superseded by scripts.rs::run_script, which
// scripts.js's _runQueue calls directly per-script (see scripts.js:_runQueue/_runOne).

/// Open SS script content in the user's text editor (writes temp file) and
/// watch that file for changes, syncing edits back into the DB — same temp
/// path + watcher as the regular Scripts page's open_script_editor/watch_script_edit.
#[tauri::command]
pub async fn ss_open_in_editor(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    script_id: i64,
) -> Result<bool, String> {
    crate::commands::scripts::open_script_editor(app.clone(), state.clone(), script_id).await?;
    crate::commands::scripts::watch_script_edit(app, state, script_id).await?;
    Ok(true)
}

// ── File-pick helpers for import/export ──────────────────────────────────────

#[tauri::command]
pub async fn ss_import_pick_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = app
        .dialog()
        .file()
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

#[derive(Serialize)]
pub struct ImportedScriptFile {
    pub name: String,
    pub script_type: String,
    pub content: String,
}

/// Pick an existing script file off disk and read it back for the Add Script
/// modal — lets a user quickly bring in a script that isn't in the DB yet
/// without retyping it. Type is detected from the extension, name from the
/// filename (both editable in the modal before saving, same as any other add).
#[tauri::command]
pub async fn ss_import_script_file(app: tauri::AppHandle) -> Result<Option<ImportedScriptFile>, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = app
        .dialog()
        .file()
        .add_filter(
            "Scripts",
            &["ps1", "py", "bat", "cmd", "vbs", "sh", "js", "reg", "ahk"],
        )
        .blocking_pick_file();
    let Some(p) = path else { return Ok(None) };
    let path_str = p.to_string();
    let content = fs::read_to_string(&path_str).map_err(|e| e.to_string())?;
    let file = std::path::Path::new(&path_str);
    let name = file
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("script")
        .to_string();
    let script_type = file
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("ps1")
        .to_lowercase();
    Ok(Some(ImportedScriptFile {
        name,
        script_type,
        content,
    }))
}

#[tauri::command]
pub async fn ss_export_pick_file(
    app: tauri::AppHandle,
    json: String,
    suggested: String,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = app
        .dialog()
        .file()
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
