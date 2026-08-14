use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::{ShellExt, process::{CommandChild, CommandEvent}};

pub struct TermState(pub Mutex<Option<CommandChild>>);

#[tauri::command]
pub async fn pty_open(app: AppHandle, shell: String, cols: u16, rows: u16) -> Result<(), String> {
    let _ = (cols, rows); // no PTY resize without ConPTY; fine for pipe-based shell

    // Kill existing shell
    {
        let state: State<TermState> = app.state();
        let mut lock = state.0.lock().unwrap();
        if let Some(old) = lock.take() { let _ = old.kill(); }
    }

    // Build args — launch an interactive shell that stays open
    let (program, args): (&str, Vec<&str>) = if shell.to_lowercase().contains("cmd") {
        ("cmd", vec!["/Q"])
    } else {
        ("powershell", vec!["-NoLogo", "-NoExit", "-Command",
            // Force UTF-8 + ANSI colors where supported
            "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; \
             if ($PSVersionTable.PSVersion.Major -ge 7) { $PSStyle.OutputRendering='ANSI' }"])
    };

    let (mut rx, child) = app.shell().command(program).args(&args)
        .spawn().map_err(|e| e.to_string())?;

    // Store child so pty_write can send stdin
    {
        let state: State<TermState> = app.state();
        *state.0.lock().unwrap() = Some(child);
    }

    // Stream stdout/stderr to frontend
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(b) | CommandEvent::Stderr(b) => {
                    let _ = app2.emit("pty-data", String::from_utf8_lossy(&b).to_string());
                }
                CommandEvent::Terminated(_) => {
                    let _ = app2.emit("pty-exit", ());
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn pty_write(app: AppHandle, data: String) -> Result<(), String> {
    let state: State<TermState> = app.state();
    let mut lock = state.0.lock().unwrap();
    if let Some(ref mut child) = *lock {
        child.write(data.as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn pty_resize(_app: AppHandle, _cols: u16, _rows: u16) -> Result<(), String> {
    Ok(()) // pipe-based; no resize signal needed
}

#[tauri::command]
pub fn pty_close(app: AppHandle) -> Result<(), String> {
    let state: State<TermState> = app.state();
    let mut lock = state.0.lock().unwrap();
    if let Some(child) = lock.take() { let _ = child.kill(); }
    let _ = app.emit("pty-exit", ());
    Ok(())
}
