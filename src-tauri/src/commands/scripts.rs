use crate::AppState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};
use tauri_plugin_shell::ShellExt;

// Track active editor watchers so we don't double-spawn them
static WATCH_IDS: std::sync::OnceLock<Mutex<std::collections::HashSet<i64>>> =
    std::sync::OnceLock::new();
fn watch_ids() -> &'static Mutex<std::collections::HashSet<i64>> {
    WATCH_IDS.get_or_init(|| Mutex::new(std::collections::HashSet::new()))
}

/// Resolve the best available text editor: VS Code → Notepad++ → Notepad.
/// Never uses shell file-association (which can execute .ps1 files).
pub fn find_editor() -> String {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    // VS Code: check PATH first, then common install locations
    if let Ok(out) = std::process::Command::new("where")
        .arg("code")
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    {
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout);
            if let Some(p) = s.trim().lines().next() {
                if !p.is_empty() {
                    return p.to_string();
                }
            }
        }
    }
    for p in [
        r"C:\Program Files\Microsoft VS Code\bin\code.cmd",
        r"C:\Program Files (x86)\Microsoft VS Code\bin\code.cmd",
        r"C:\Users\Public\Desktop\Microsoft VS Code\bin\code.cmd",
    ] {
        if std::path::Path::new(p).exists() {
            return p.to_string();
        }
    }
    // Notepad++
    for p in [
        r"C:\Program Files\Notepad++\notepad++.exe",
        r"C:\Program Files (x86)\Notepad++\notepad++.exe",
    ] {
        if std::path::Path::new(p).exists() {
            return p.to_string();
        }
    }
    // Notepad — always available
    "notepad".to_string()
}

#[derive(Serialize, Deserialize)]
pub struct Script {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub category: String,
    pub file_path: String,
    pub script_type: String,
    pub tags: String,
    pub status: String,
    pub run_as_admin: bool,
    pub interactive: bool,
    pub content: Option<String>,
    pub icon: String,
    pub sort_order: i64,
    pub disabled: bool,
}

#[derive(Serialize)]
pub struct RunResult {
    pub success: bool,
    pub output: String,
}

fn query_scripts(db: &rusqlite::Connection, q: &str) -> Result<Vec<Script>, String> {
    let mut stmt = db.prepare(
        "SELECT id,name,description,category,file_path,script_type,tags,status,COALESCE(run_as_admin,0),COALESCE(interactive,0),content,COALESCE(icon,'') FROM scripts ORDER BY category,name"
    ).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Script {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                category: row.get(3)?,
                file_path: row.get(4)?,
                script_type: row.get(5)?,
                tags: row.get(6)?,
                status: row.get(7)?,
                run_as_admin: row.get::<_, i64>(8)? != 0,
                interactive: row.get::<_, i64>(9)? != 0,
                content: row.get(10)?,
                icon: row.get(11)?,
                sort_order: 0,
                disabled: false,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows
        .filter_map(|r| r.ok())
        .filter(|s| {
            q.is_empty()
                || s.name.to_lowercase().contains(q)
                || s.category.to_lowercase().contains(q)
                || s.tags.to_lowercase().contains(q)
        })
        .collect())
}

#[tauri::command]
pub fn get_scripts(state: State<AppState>, search: Option<String>) -> Result<Vec<Script>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    query_scripts(&db, &search.unwrap_or_default().to_lowercase())
}

// NOTE: add_script/update_script/delete_script/get_profiles/add_profile/rename_profile/
// remove_profile/get_profile_scripts/add_to_profile/remove_from_profile/set_script_disabled/
// reorder_profile_scripts/export_profile/import_profile/read_text_file were removed 2026-08-17
// — dead code with zero frontend callers, fully superseded by the ScriptStash port's ss_*
// equivalents in scriptstash.rs (which operate on the same ss_profiles/ss_script_profile
// tables). Confirmed via grep across src/ before removal.

#[tauri::command]
pub async fn run_script(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: i64,
    force_admin: Option<bool>,
    skip_pause: Option<bool>,
) -> Result<RunResult, String> {
    let (file_path, content, script_type, name, db_admin, interactive) = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        db.query_row(
            "SELECT file_path,content,script_type,name,COALESCE(run_as_admin,0),COALESCE(interactive,0) FROM scripts WHERE id=?1",
            params![id], |row| {
            Ok((row.get::<_,String>(0)?, row.get::<_,Option<String>>(1)?, row.get::<_,String>(2)?, row.get::<_,String>(3)?, row.get::<_,i64>(4)? != 0, row.get::<_,i64>(5)? != 0))
        }).map_err(|e| e.to_string())?
    };
    let run_as_admin = force_admin.unwrap_or(false) || db_admin;
    // A workflow step has no one to press a key — force-disable "Pause Script" for it
    // rather than hang the workflow forever waiting on Read-Host/pause.
    let interactive = interactive && !skip_pause.unwrap_or(false);

    // Sandbox dry-run
    if std::env::var("CTRL_SANDBOX").as_deref() == Ok("1") {
        let preview = content.as_deref().unwrap_or(&file_path);
        return Ok(RunResult {
            success: true,
            output: format!("SANDBOX: would run script \"{name}\" ({script_type}):\n{preview}"),
        });
    }

    use crate::commands::exec::{run as exec_run, run_elevated as exec_run_elevated, Shell};

    // Resolve the script body — content from DB, or read from file_path
    let mut body: String = if let Some(c) = content {
        c
    } else if !file_path.is_empty() {
        fs::read_to_string(&file_path).map_err(|e| e.to_string())?
    } else {
        return Err(format!(
            "Script \"{name}\" has no content and no file path."
        ));
    };

    // "Pause Script" — hold the embedded terminal open at the end instead of
    // spawning a separate console window. No-op for vbs/ahk (rare, own path).
    if interactive {
        body.push_str(match script_type.as_str() {
            "ps1" => "\nWrite-Host \"\"; Write-Host 'Press Enter to continue...' -NoNewline; Read-Host | Out-Null",
            "py"  => "\ninput('\\nPress Enter to continue...')",
            _     => "\necho.\r\npause",
        });
    }

    // Build the (shell, command) pair that exec functions understand.
    // For AHK: spawn detached — it's a GUI process, not a terminal script.
    let shell_cmd: Option<(Shell, String)> = match script_type.as_str() {
        "ps1" => Some((Shell::PowerShell, body.clone())),
        "py" => Some((Shell::Python, body.clone())),
        "vbs" => {
            // Write vbs to temp, then run via cscript one-liner through Cmd shell
            let p = std::env::temp_dir().join(format!("ctrl_script_{id}.vbs"));
            let _ = fs::write(&p, &body);
            let esc = p.to_string_lossy().replace('\'', "''");
            Some((Shell::Cmd, format!("cscript //NoLogo \"{}\"", esc)))
        }
        _ => Some((Shell::Cmd, body.clone())), // "bat" and anything else
    };

    // AHK: detach and return — it's GUI, not a terminal process
    if script_type == "ahk" {
        let p = std::env::temp_dir().join(format!("ctrl_script_{id}.ahk"));
        let _ = fs::write(&p, &body);
        let candidates = [
            "C:\\Program Files\\AutoHotkey\\AutoHotkey.exe",
            "C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey64.exe",
            "C:\\Program Files (x86)\\AutoHotkey\\AutoHotkey.exe",
        ];
        let ahk = candidates
            .iter()
            .find(|c| std::path::Path::new(c).exists())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "AutoHotkey".to_string());
        let _ = std::process::Command::new(&ahk)
            .arg(p.to_str().unwrap_or(""))
            .spawn();
        return Ok(RunResult {
            success: true,
            output: format!("Script \"{name}\" launched (AutoHotkey)."),
        });
    }

    let (shell, cmd) = shell_cmd.unwrap();

    // Route through PTY — same path as Quick Fixes (exec::run / exec::run_elevated).
    // This avoids PSReadLine cursor issues that spawn_streaming caused.
    let result = if run_as_admin && !crate::commands::exec::running_as_admin() {
        exec_run_elevated(&app, &cmd, &shell, &format!("script_{id}")).await?
    } else {
        exec_run(&app, &cmd, &shell).await?
    };

    {
        use std::time::{SystemTime, UNIX_EPOCH};
        let now_secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let now_str = format!("{}", now_secs);
        let status = if result.success { "ok" } else { "failed" };
        let db = state.0.lock().map_err(|e| e.to_string())?;
        let _ = db.execute("INSERT INTO run_log (item_type,item_id,item_name,exit_code,output) VALUES ('script',?1,?2,?3,?4)",
            params![id, name, if result.success { 0i64 } else { 1i64 }, ""]);
        let _ = db.execute(
            "UPDATE scripts SET last_run=?1,last_status=?2 WHERE id=?3",
            params![now_str, status, id],
        );
    }
    Ok(RunResult {
        success: result.success,
        output: String::new(),
    })
}

#[tauri::command]
pub async fn open_script_editor(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: i64,
) -> Result<(), String> {
    let (path, content, script_type): (String, Option<String>, String) = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        db.query_row(
            "SELECT file_path,content,script_type FROM scripts WHERE id=?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| e.to_string())?
    };
    // If content is in DB, write a temp file to open in editor
    let open_path = if let Some(c) = content {
        let p = std::env::temp_dir().join(format!("ctrl_edit_{}.{}", id, script_type));
        fs::write(&p, c).map_err(|e| e.to_string())?;
        p.to_string_lossy().to_string()
    } else if path.is_empty() {
        return Err("No file path set for this script".to_string());
    } else {
        path
    };
    // Always use cmd /c — handles .cmd/.bat executables and paths with spaces
    let editor = find_editor();
    app.shell()
        .command("cmd")
        .args(["/c", &editor, &open_path])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Open a Windows shortcut (ms-settings:, devmgmt.msc, etc.)
#[tauri::command]
pub async fn launch_shortcut(app: tauri::AppHandle, cmd: String) -> Result<(), String> {
    app.shell()
        .command("cmd")
        .args(["/c", "start", "", &cmd])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Start watching the temp edit file for a DB-backed script.
/// Polls every 1.5s; when the file changes, updates DB content and emits `script-synced` { id }.
#[tauri::command]
pub async fn watch_script_edit(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    id: i64,
) -> Result<(), String> {
    {
        let mut ids = watch_ids().lock().unwrap_or_else(|e| e.into_inner());
        if ids.contains(&id) {
            return Ok(());
        }
        ids.insert(id);
    }
    // Re-query to get actual extension
    let script_type: String = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        db.query_row(
            "SELECT script_type FROM scripts WHERE id=?1",
            params![id],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "ps1".to_string())
    };
    let file = std::env::temp_dir().join(format!("ctrl_edit_{}.{}", id, script_type));
    let app2 = app.clone();
    std::thread::spawn(move || {
        let mut last_mtime = fs::metadata(&file).ok().and_then(|m| m.modified().ok());
        loop {
            std::thread::sleep(std::time::Duration::from_millis(1500));
            if !file.exists() {
                break;
            }
            let mtime = fs::metadata(&file).ok().and_then(|m| m.modified().ok());
            if mtime != last_mtime {
                last_mtime = mtime;
                if let Ok(content) = fs::read_to_string(&file) {
                    let db_res = app2.state::<AppState>();
                    if let Ok(db) = db_res.0.lock() {
                        let _ = db.execute(
                            "UPDATE scripts SET content=?1 WHERE id=?2",
                            params![content, id],
                        );
                    }
                    #[derive(serde::Serialize, Clone)]
                    struct SyncPayload {
                        id: i64,
                        content: String,
                    }
                    let _ = app2.emit("script-synced", SyncPayload { id, content });
                }
            }
        }
        watch_ids()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&id);
    });
    Ok(())
}
