use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use serde::Serialize;
use portable_pty::{native_pty_system, CommandBuilder, PtySize, MasterPty, Child};

extern "system" {
    fn GetCurrentProcess() -> *mut std::ffi::c_void;
    fn CloseHandle(h: *mut std::ffi::c_void) -> i32;
}

#[link(name = "advapi32")]
extern "system" {
    fn OpenProcessToken(proc: *mut std::ffi::c_void, access: u32, token: *mut *mut std::ffi::c_void) -> i32;
    fn GetTokenInformation(token: *mut std::ffi::c_void, class: u32, info: *mut std::ffi::c_void, len: u32, returned: *mut u32) -> i32;
}

/// Returns true when CTRL is running with administrator privileges.
/// Cached on first call via OnceLock in exec.rs.
pub fn is_process_elevated() -> bool {
    unsafe {
        let mut token: *mut std::ffi::c_void = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), 0x0008 /* TOKEN_QUERY */, &mut token) == 0 {
            return false;
        }
        let mut elevated = 0u32;
        let mut returned  = 0u32;
        // TokenElevation = 20 — non-zero means process is elevated
        GetTokenInformation(token, 20, &mut elevated as *mut u32 as *mut _, 4, &mut returned);
        CloseHandle(token);
        elevated != 0
    }
}

#[tauri::command]
pub fn is_elevated() -> bool { is_process_elevated() }


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
    use std::os::windows::process::CommandExt;
    std::process::Command::new("where")
        .arg(name)
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
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
    pub master: Box<dyn MasterPty + Send>,
    pub child:  Box<dyn Child + Send + Sync>,
}

pub struct TermState(pub Mutex<Option<PtySession>>);

#[tauri::command]
pub fn pty_open(app: AppHandle, shell: String, args: Vec<String>, cols: u16, rows: u16) -> Result<(), String> {
    // Kill existing session first
    {
        let state: State<TermState> = app.state();
        *state.0.lock().unwrap() = None;
    }

    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("openpty failed: {}", e))?;

    let mut cmd = CommandBuilder::new(&shell);
    cmd.args(&args);
    let child = pair.slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to start '{}': {}", shell, e))?;
    drop(pair.slave);

    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // Stream PTY output to frontend
    let app2 = app.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
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
        writer: Box::new(writer),
        master: pair.master,
        child,
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
        let _ = s.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
    }
    Ok(())
}

#[tauri::command]
pub fn pty_close(app: AppHandle) -> Result<(), String> {
    let state: State<TermState> = app.state();
    if let Some(mut s) = state.0.lock().unwrap().take() {
        let _ = s.child.kill();
    }
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
    use std::os::windows::process::CommandExt;
    std::process::Command::new("powershell")
        .args(["-WindowStyle", "Hidden", "-NonInteractive", "-Command", &cmd])
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
