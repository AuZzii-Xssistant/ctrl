use crate::AppState;
use serde::Serialize;
use tauri::State;
use tauri_plugin_shell::ShellExt;

#[derive(Serialize)]
pub struct Stats {
    pub tools: i64,
    pub scripts: i64,
    pub fixes: i64,
    pub projects: i64,
    pub workflows: i64,
    pub runs: i64,
}

#[tauri::command]
pub fn get_stats(state: State<AppState>) -> Result<Stats, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let count = |table: &str| -> i64 {
        db.query_row(&format!("SELECT COUNT(*) FROM {}", table), [], |r| r.get(0)).unwrap_or(0)
    };
    Ok(Stats { tools: count("tools"), scripts: count("scripts"), fixes: count("fixes"), projects: count("projects"), workflows: count("workflows"), runs: count("run_log") })
}

#[derive(Serialize)]
pub struct SearchResult {
    pub item_type: String,
    pub id: i64,
    pub name: String,
    pub meta: String,
}

#[derive(Serialize)]
pub struct SearchResults {
    pub tools: Vec<SearchResult>,
    pub scripts: Vec<SearchResult>,
    pub fixes: Vec<SearchResult>,
    pub projects: Vec<SearchResult>,
    pub workflows: Vec<SearchResult>,
}

#[tauri::command]
pub fn global_search(state: State<AppState>, query: String) -> Result<SearchResults, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let q = format!("%{}%", query.to_lowercase());
    let search = |sql: &str| -> Vec<SearchResult> {
        let mut stmt = db.prepare(sql).unwrap();
        stmt.query_map([&q], |row| {
            Ok(SearchResult { item_type: row.get(0)?, id: row.get(1)?, name: row.get(2)?, meta: row.get(3)? })
        }).unwrap().filter_map(|r| r.ok()).take(5).collect()
    };
    Ok(SearchResults {
        tools:     search("SELECT 'tool',id,name,category FROM tools WHERE lower(name) LIKE ?1 OR lower(tags) LIKE ?1"),
        scripts:   search("SELECT 'script',id,name,category FROM scripts WHERE lower(name) LIKE ?1 OR lower(tags) LIKE ?1"),
        fixes:     search("SELECT 'fix',id,name,category FROM fixes WHERE lower(name) LIKE ?1 OR lower(tags) LIKE ?1"),
        projects:  search("SELECT 'project',id,name,status FROM projects WHERE lower(name) LIKE ?1 OR lower(tags) LIKE ?1"),
        workflows: search("SELECT 'workflow',id,name,description FROM workflows WHERE lower(name) LIKE ?1 OR lower(description) LIKE ?1"),
    })
}

#[derive(Serialize)]
pub struct LastRun {
    pub item_id: i64,
    pub success: bool,
    pub ran_at: String,
}

#[tauri::command]
pub fn get_last_runs(state: State<AppState>, item_type: String) -> Result<Vec<LastRun>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare(
        "SELECT item_id, (exit_code = 0), ran_at FROM run_log r1
         WHERE item_type=?1
           AND ran_at = (SELECT MAX(ran_at) FROM run_log r2 WHERE r2.item_type=r1.item_type AND r2.item_id=r1.item_id)
         GROUP BY item_id"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([&item_type], |row| {
        Ok(LastRun { item_id: row.get(0)?, success: row.get::<_,i64>(1)? != 0, ran_at: row.get(2)? })
    }).map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[derive(Serialize)]
pub struct ActivityEntry {
    pub item_type: String,
    pub item_name: String,
    pub success: bool,
    pub ran_at: String,
}

#[tauri::command]
pub fn get_recent_activity(state: State<AppState>, limit: Option<i64>) -> Result<Vec<ActivityEntry>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let n = limit.unwrap_or(12);
    let mut stmt = db.prepare(
        "SELECT item_type, COALESCE(item_name,'?'), (exit_code=0), ran_at FROM run_log ORDER BY ran_at DESC LIMIT ?1"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([n], |row| {
        Ok(ActivityEntry { item_type: row.get(0)?, item_name: row.get(1)?, success: row.get::<_,i64>(2)? != 0, ran_at: row.get(3)? })
    }).map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub async fn open_data_folder(app: tauri::AppHandle) -> Result<(), String> {
    let dir = std::env::current_exe().ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    app.shell().command("explorer").args([dir.to_string_lossy().as_ref()]).spawn().map_err(|e| e.to_string())?;
    Ok(())
}
