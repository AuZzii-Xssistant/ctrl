use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct PtyState {
    writer: Mutex<Box<dyn Write + Send>>,
    // child kept alive so PTY doesn't close
    _child: Mutex<Box<dyn portable_pty::Child + Send + Sync>>,
}

pub struct TermState(pub Mutex<Option<PtyState>>);

#[tauri::command]
pub fn pty_open(app: AppHandle, shell: String, cols: u16, rows: u16) -> Result<(), String> {
    let state: State<TermState> = app.state();
    // Close existing PTY if any
    {
        let mut lock = state.0.lock().unwrap();
        *lock = None;
    }

    let pty_sys = native_pty_system();
    let pair = pty_sys.openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(&shell);
    if shell.to_lowercase().contains("powershell") || shell.to_lowercase().contains("pwsh") {
        cmd.arg("-NoLogo");
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    // Stream PTY output to frontend via events
    let app2 = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app2.emit("pty-data", data);
                }
            }
        }
        let _ = app2.emit("pty-exit", ());
    });

    let mut lock = state.0.lock().unwrap();
    *lock = Some(PtyState {
        writer: Mutex::new(writer),
        _child: Mutex::new(child),
    });

    Ok(())
}

#[tauri::command]
pub fn pty_write(app: AppHandle, data: String) -> Result<(), String> {
    let state: State<TermState> = app.state();
    let lock = state.0.lock().unwrap();
    if let Some(ref pty) = *lock {
        let mut w = pty.writer.lock().unwrap();
        w.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn pty_resize(app: AppHandle, cols: u16, rows: u16) -> Result<(), String> {
    // portable-pty resize goes through the master, but we don't hold it after take_writer.
    // This is a known limitation; resize support requires keeping the master handle.
    // ponytail: skip resize for now, add when needed via PtyMaster wrapper
    let _ = (app, cols, rows);
    Ok(())
}

#[tauri::command]
pub fn pty_close(app: AppHandle) -> Result<(), String> {
    let state: State<TermState> = app.state();
    let mut lock = state.0.lock().unwrap();
    *lock = None; // drops child + writer → PTY closes
    let _ = app.emit("pty-exit", ());
    Ok(())
}
