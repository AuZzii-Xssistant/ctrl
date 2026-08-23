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
        db.query_row(&format!("SELECT COUNT(*) FROM {}", table), [], |r| r.get(0))
            .unwrap_or(0)
    };
    Ok(Stats {
        tools: count("tools"),
        scripts: count("scripts"),
        fixes: count("fixes"),
        projects: count("projects"),
        workflows: count("workflows"),
        runs: count("run_log"),
    })
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
    pub snippets: Vec<SearchResult>,
    pub quick_launch: Vec<SearchResult>,
    pub apps: Vec<SearchResult>,
}

#[tauri::command]
pub fn global_search(state: State<AppState>, query: String) -> Result<SearchResults, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let q = format!("%{}%", query.to_lowercase());
    let search = |sql: &str| -> Vec<SearchResult> {
        let mut stmt = match db.prepare(sql) {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        let rows = match stmt.query_map([&q], |row| {
            Ok(SearchResult {
                item_type: row.get(0)?,
                id: row.get(1)?,
                name: row.get(2)?,
                meta: row.get(3)?,
            })
        }) {
            Ok(r) => r,
            Err(_) => return vec![],
        };
        rows.filter_map(|r| r.ok()).take(10).collect()
    };
    Ok(SearchResults {
        tools:        search("SELECT 'tool',id,name,category FROM tools WHERE lower(name) LIKE ?1 OR lower(tags) LIKE ?1"),
        scripts:      search("SELECT 'script',id,name,category FROM scripts WHERE lower(name) LIKE ?1 OR lower(tags) LIKE ?1"),
        fixes:        search("SELECT 'fix',id,name,category FROM fixes WHERE lower(name) LIKE ?1 OR lower(tags) LIKE ?1"),
        projects:     search("SELECT 'project',id,name,status FROM projects WHERE lower(name) LIKE ?1 OR lower(tags) LIKE ?1"),
        workflows:    search("SELECT 'workflow',id,name,description FROM workflows WHERE lower(name) LIKE ?1 OR lower(description) LIKE ?1"),
        snippets:     search("SELECT 'snippet',id,title,category FROM snippets WHERE lower(title) LIKE ?1 OR lower(tags) LIKE ?1 OR lower(content) LIKE ?1"),
        quick_launch: search("SELECT 'ql',id,label,cmd FROM ql_items WHERE lower(label) LIKE ?1 OR lower(cmd) LIKE ?1"),
        apps:         search("SELECT 'app',id,name,path FROM external_apps WHERE lower(name) LIKE ?1 OR lower(path) LIKE ?1"),
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
    let rows = stmt
        .query_map([&item_type], |row| {
            Ok(LastRun {
                item_id: row.get(0)?,
                success: row.get::<_, i64>(1)? != 0,
                ran_at: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[derive(Serialize)]
pub struct RunHistoryEntry {
    pub id: i64,
    pub success: bool,
    pub ran_at: String,
    pub output: String,
}

#[tauri::command]
pub fn get_run_history(
    state: State<AppState>,
    item_type: String,
    item_id: i64,
    limit: Option<i64>,
) -> Result<Vec<RunHistoryEntry>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let n = limit.unwrap_or(10);
    let mut stmt = db.prepare(
        "SELECT id,(exit_code=0),ran_at,COALESCE(output,'') FROM run_log WHERE item_type=?1 AND item_id=?2 ORDER BY ran_at DESC LIMIT ?3"
    ).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![item_type, item_id, n], |row| {
            Ok(RunHistoryEntry {
                id: row.get(0)?,
                success: row.get::<_, i64>(1)? != 0,
                ran_at: row.get(2)?,
                output: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[derive(Serialize)]
pub struct RunHistoryFullEntry {
    pub id: i64,
    pub item_type: String,
    pub item_id: i64,
    pub item_name: String,
    pub success: bool,
    pub ran_at: String,
    pub output: String,
}

/// History page: run_log filtered by module/success/date range/text search over item_name.
#[tauri::command]
pub fn get_run_history_filtered(
    state: State<AppState>,
    item_type: Option<String>,
    success: Option<bool>,
    date_from: Option<String>,
    date_to: Option<String>,
    text: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<RunHistoryFullEntry>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let mut sql = "SELECT id,item_type,item_id,COALESCE(item_name,'(unknown)'),(exit_code=0),ran_at,COALESCE(output,'') FROM run_log WHERE 1=1".to_string();
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![];
    if let Some(t) = &item_type {
        sql.push_str(" AND item_type=?");
        params.push(Box::new(t.clone()));
    }
    if let Some(s) = success {
        sql.push_str(" AND (exit_code=0)=?");
        params.push(Box::new(s));
    }
    if let Some(d) = &date_from {
        sql.push_str(" AND ran_at>=?");
        params.push(Box::new(d.clone()));
    }
    if let Some(d) = &date_to {
        sql.push_str(" AND ran_at<=?");
        params.push(Box::new(d.clone()));
    }
    if let Some(q) = &text {
        if !q.is_empty() {
            sql.push_str(" AND lower(item_name) LIKE ?");
            params.push(Box::new(format!("%{}%", q.to_lowercase())));
        }
    }
    sql.push_str(" ORDER BY ran_at DESC LIMIT ?");
    params.push(Box::new(limit.unwrap_or(500)));

    let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
            Ok(RunHistoryFullEntry {
                id: row.get(0)?,
                item_type: row.get(1)?,
                item_id: row.get(2)?,
                item_name: row.get(3)?,
                success: row.get::<_, i64>(4)? != 0,
                ran_at: row.get(5)?,
                output: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

/// Generic save-as-text-file dialog. Reused by History export (and any future plain-text export).
#[tauri::command]
pub async fn export_text_file(
    app: tauri::AppHandle,
    text: String,
    suggested: String,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = app
        .dialog()
        .file()
        .add_filter("Text", &["txt"])
        .set_file_name(&suggested)
        .blocking_save_file();
    match path {
        Some(p) => {
            std::fs::write(p.to_string(), text).map_err(|e| e.to_string())?;
            Ok(true)
        }
        None => Ok(false),
    }
}

#[derive(Serialize)]
pub struct SysInfo {
    pub hostname: String,
    pub username: String,
    pub os: String,
    pub ram_gb: String,
    pub cpu: String,
    pub boot_epoch_ms: i64, // Unix ms — JS computes live uptime from this
}

#[tauri::command]
pub async fn get_sys_info(app: tauri::AppHandle) -> Result<SysInfo, String> {
    let ps = r#"
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name
$bootMs = [DateTimeOffset]::new($os.LastBootUpTime).ToUnixTimeMilliseconds()
[PSCustomObject]@{
    hostname  = $env:COMPUTERNAME
    username  = $env:USERNAME
    os        = $os.Caption -replace 'Microsoft ',''
    ram_gb    = [string][Math]::Round($cs.TotalPhysicalMemory/1GB,1)
    cpu       = $cpu -replace '\(R\)|\(TM\)','' -replace '\s+',' '
    bootMs    = $bootMs
} | ConvertTo-Json -Compress
"#;
    let out = app
        .shell()
        .command("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", ps])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    let raw = String::from_utf8_lossy(&out.stdout);
    let v: serde_json::Value = serde_json::from_str(raw.trim()).map_err(|e| e.to_string())?;
    Ok(SysInfo {
        hostname: v["hostname"].as_str().unwrap_or("").to_string(),
        username: v["username"].as_str().unwrap_or("").to_string(),
        os: v["os"].as_str().unwrap_or("").to_string(),
        ram_gb: v["ram_gb"].as_str().unwrap_or("").to_string(),
        cpu: v["cpu"].as_str().unwrap_or("").to_string(),
        boot_epoch_ms: v["bootMs"].as_i64().unwrap_or(0),
    })
}

#[derive(Serialize)]
pub struct DriveInfo {
    pub name: String,
    pub used_gb: f64,
    pub total_gb: f64,
}

#[derive(Serialize)]
pub struct PerfStats {
    pub cpu_pct: i64,
    pub ram_used_gb: f64,
    pub ram_total_gb: f64,
    pub net_name: String,
    pub net_recv_bytes: i64,
    pub net_sent_bytes: i64,
    pub drives: Vec<DriveInfo>,
}

#[tauri::command]
pub async fn get_perf_stats(app: tauri::AppHandle) -> Result<PerfStats, String> {
    // No GPU counter — Get-Counter blocks for 1s minimum, unacceptable for live polling.
    // Net adapter status check skipped (slow); filter by non-zero received bytes instead.
    let ps = r#"
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$cpu = [int](Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average | Select-Object -ExpandProperty Average)
$os  = Get-CimInstance Win32_OperatingSystem
$ru  = [Math]::Round(($os.TotalVisibleMemorySize-$os.FreePhysicalMemory)/1MB,2)
$rt  = [Math]::Round($os.TotalVisibleMemorySize/1MB,2)
$net = Get-NetAdapterStatistics | Where-Object { $_.ReceivedBytes -gt 0 } | Sort-Object ReceivedBytes -Descending | Select-Object -First 1
$netName = if ($net) { $net.Name } else { '' }
$drives = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -ne $null -and ($_.Used+$_.Free) -gt 1MB } | ForEach-Object {
    $t = $_.Used+$_.Free
    [PSCustomObject]@{ name=$_.Name; usedGb=[Math]::Round($_.Used/1GB,1); totalGb=[Math]::Round($t/1GB,1) }
}
[PSCustomObject]@{
    cpu=    $cpu
    ramUsed=$ru; ramTotal=$rt
    netName=$netName
    netRecv=if($net){[long]$net.ReceivedBytes}else{0}
    netSent=if($net){[long]$net.SentBytes}else{0}
    drives= @($drives)
} | ConvertTo-Json -Compress -Depth 3
"#;
    let out = app
        .shell()
        .command("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", ps])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    let raw = String::from_utf8_lossy(&out.stdout);
    let v: serde_json::Value = serde_json::from_str(raw.trim()).map_err(|e| e.to_string())?;
    let drives = v["drives"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|d| DriveInfo {
                    name: d["name"].as_str().unwrap_or("").to_string(),
                    used_gb: d["usedGb"].as_f64().unwrap_or(0.0),
                    total_gb: d["totalGb"].as_f64().unwrap_or(0.0),
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(PerfStats {
        cpu_pct: v["cpu"].as_i64().unwrap_or(0),
        ram_used_gb: v["ramUsed"].as_f64().unwrap_or(0.0),
        ram_total_gb: v["ramTotal"].as_f64().unwrap_or(0.0),
        net_name: v["netName"].as_str().unwrap_or("").to_string(),
        net_recv_bytes: v["netRecv"].as_i64().unwrap_or(0),
        net_sent_bytes: v["netSent"].as_i64().unwrap_or(0),
        drives,
    })
}

#[tauri::command]
pub async fn open_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.shell()
        .command("explorer")
        .args([path])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn open_data_folder(app: tauri::AppHandle) -> Result<(), String> {
    let dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    app.shell()
        .command("explorer")
        .args([dir.to_string_lossy().as_ref()])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// Was byte-identical to open_data_folder (both just opened the exe's own
// folder), which is wrong whenever CTRL_DB points elsewhere — the button
// claiming to open the DB's location silently opened the wrong folder in
// sandbox mode. Now resolves the DB's actual parent folder via db::resolve_path().
#[tauri::command]
pub async fn open_db_folder(app: tauri::AppHandle) -> Result<(), String> {
    let db_path = crate::db::resolve_path();
    let dir = db_path
        .parent()
        .map(|d| d.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    app.shell()
        .command("explorer")
        .args([dir.to_string_lossy().as_ref()])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
