use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use serde::Serialize;

// ── Shell detection ───────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct ShellInfo {
    pub name: String,
    pub path: String,
    pub args: Vec<String>,
}

#[tauri::command]
pub fn list_shells() -> Vec<ShellInfo> {
    let mut shells = Vec::new();

    // PowerShell 7 (pwsh) — check PATH
    if which("pwsh").is_some() {
        shells.push(ShellInfo {
            name: "PowerShell".into(),
            path: "pwsh".into(),
            args: vec!["-NoLogo".into()],
        });
    }

    // Windows PowerShell 5.1 — always present on Windows
    shells.push(ShellInfo {
        name: "Windows PowerShell".into(),
        path: "powershell".into(),
        args: vec!["-NoLogo".into()],
    });

    // Command Prompt
    shells.push(ShellInfo {
        name: "Command Prompt".into(),
        path: "cmd".into(),
        args: vec![],
    });

    // WSL
    if std::path::Path::new(r"C:\Windows\System32\wsl.exe").exists() {
        shells.push(ShellInfo {
            name: "WSL".into(),
            path: "wsl".into(),
            args: vec![],
        });
    }

    // Git Bash
    for p in &[
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files (x86)\Git\bin\bash.exe",
    ] {
        if std::path::Path::new(p).exists() {
            shells.push(ShellInfo {
                name: "Git Bash".into(),
                path: p.to_string(),
                args: vec!["--login".into(), "-i".into()],
            });
            break;
        }
    }

    shells
}

fn which(name: &str) -> Option<String> {
    std::process::Command::new("where")
        .arg(name)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.lines().next().unwrap_or("").trim().to_string())
        .filter(|s| !s.is_empty())
}

// ── PTY state ─────────────────────────────────────────────────────────────────

pub(crate) struct PtySession {
    writer: Box<dyn Write + Send>,
    _proc:  conpty::Process, // kept alive
}

// ponytail: unsafe Send/Sync — Win32 HANDLEs are thread-safe at OS level; conpty just doesn't derive it
unsafe impl Send for PtySession {}
unsafe impl Sync for PtySession {}

pub struct TermState(pub Mutex<Option<PtySession>>);

#[tauri::command]
pub fn pty_open(app: AppHandle, shell: String, args: Vec<String>, cols: u16, rows: u16) -> Result<(), String> {
    // Kill existing session
    { let state: State<TermState> = app.state(); *state.0.lock().unwrap() = None; }

    // Build command line — for interactive shells don't wrap in cmd /C
    let cmd = if args.is_empty() {
        shell.clone()
    } else {
        format!("\"{}\" {}", shell, args.join(" "))
    };

    let proc = conpty::ProcAttr::default()
        .commandline(cmd)
        .spawn()
        .map_err(|e| format!("Failed to start '{}': {}", shell, e))?;

    // Resize to requested dimensions
    let _ = proc.resize(cols as i16, rows as i16);

    let output = proc.output().map_err(|e| e.to_string())?;
    let input  = proc.input().map_err(|e| e.to_string())?;

    // Stream output to frontend
    let app2 = app.clone();
    std::thread::spawn(move || {
        let mut reader = output;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let s = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app2.emit("pty-data", s);
                }
            }
        }
        let _ = app2.emit("pty-exit", ());
    });

    let state: State<TermState> = app.state();
    *state.0.lock().unwrap() = Some(PtySession {
        writer: Box::new(input),
        _proc:  proc,
    });

    Ok(())
}

#[tauri::command]
pub fn pty_write(app: AppHandle, data: String) -> Result<(), String> {
    let state: State<TermState> = app.state();
    let mut lock = state.0.lock().unwrap();
    if let Some(ref mut s) = *lock {
        s.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn pty_resize(app: AppHandle, cols: u16, rows: u16) -> Result<(), String> {
    let state: State<TermState> = app.state();
    let lock = state.0.lock().unwrap();
    if let Some(ref s) = *lock {
        let _ = s._proc.resize(cols as i16, rows as i16);
    }
    Ok(())
}

#[tauri::command]
pub fn pty_close(app: AppHandle) -> Result<(), String> {
    let state: State<TermState> = app.state();
    *state.0.lock().unwrap() = None;
    let _ = app.emit("pty-exit", ());
    Ok(())
}
