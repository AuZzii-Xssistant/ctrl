use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use serde::Serialize;

// ── Console allocation ────────────────────────────────────────────────────────
// conpty's spawn() calls GetConsoleMode("CONOUT$") which fails in a GUI app.
// Allocate a hidden console once so conpty can do its internal VT setup.
// kernel32/user32 are always auto-linked on Windows; no extra crate needed.

extern "system" {
    fn GetConsoleWindow() -> *mut std::ffi::c_void;
    fn AllocConsole() -> i32;
    fn ShowWindow(hwnd: *mut std::ffi::c_void, n_cmd_show: i32) -> i32;
}

static CONSOLE_ALLOC: std::sync::Once = std::sync::Once::new();

fn ensure_console() {
    CONSOLE_ALLOC.call_once(|| {
        unsafe {
            if GetConsoleWindow().is_null() {
                if AllocConsole() != 0 {
                    let hwnd = GetConsoleWindow();
                    if !hwnd.is_null() {
                        ShowWindow(hwnd, 0); // SW_HIDE
                    }
                }
            }
        }
    });
}

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

    // PowerShell 7 (pwsh) — preferred
    if which("pwsh").is_some() {
        shells.push(ShellInfo {
            name: "PowerShell 7".into(),
            path: "pwsh".into(),
            args: vec!["-NoLogo".into()],
        });
    }

    // Windows PowerShell 5.1 — always present
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
    pub writer: Box<dyn Write + Send>,
    pub proc:   conpty::Process,
}

// ponytail: unsafe Send/Sync — Win32 HANDLEs are thread-safe at OS level
unsafe impl Send for PtySession {}
unsafe impl Sync for PtySession {}

pub struct TermState(pub Mutex<Option<PtySession>>);

#[tauri::command]
pub fn pty_open(app: AppHandle, shell: String, args: Vec<String>, cols: u16, rows: u16) -> Result<(), String> {
    // Ensure parent process has a console so conpty can do its internal VT setup
    ensure_console();

    // Kill existing session first
    {
        let state: State<TermState> = app.state();
        *state.0.lock().unwrap() = None;
    }

    // Build command line — interactive shell, don't wrap in cmd /C
    let cmd = if args.is_empty() {
        shell.clone()
    } else {
        format!("\"{}\" {}", shell, args.join(" "))
    };

    let proc = conpty::ProcAttr::default()
        .commandline(cmd)
        .spawn()
        .map_err(|e| format!("Failed to start '{}': {}", shell, e))?;

    let _ = proc.resize(cols as i16, rows as i16);

    let output = proc.output().map_err(|e| e.to_string())?;
    let input  = proc.input().map_err(|e| e.to_string())?;

    // Stream PTY output to frontend
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
        proc,
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
        let _ = s.proc.resize(cols as i16, rows as i16);
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

/// Open an elevated terminal in a separate window (UAC required once).
#[tauri::command]
pub fn open_elevated_terminal() -> Result<(), String> {
    // Use pwsh if available, else powershell
    let shell = if which("pwsh").is_some() { "pwsh" } else { "powershell" };
    let cmd = format!(
        "Start-Process {} -Verb RunAs -ArgumentList '-NoLogo','-NoExit'",
        shell
    );
    std::process::Command::new("powershell")
        .args(["-WindowStyle", "Hidden", "-NonInteractive", "-Command", &cmd])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
