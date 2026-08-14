/// Shared command executor — used by fixes, tweaks, and built scripts.
/// Writes commands to temp files and runs them with the correct shell.
/// Using -File avoids all quoting/escaping issues with -Command.
/// No $ErrorActionPreference='Stop' — scripts own their error handling.

use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

use crate::commands::scripts::RunResult;

/// Cached elevation check — computed once at first use.
pub fn running_as_admin() -> bool {
    use std::sync::OnceLock;
    static ELEVATED: OnceLock<bool> = OnceLock::new();
    *ELEVATED.get_or_init(crate::commands::terminal::is_process_elevated)
}

/// Detect best available PowerShell binary (pwsh = PS7+, else powershell).
/// Result cached after first call.
pub fn ps_bin() -> &'static str {
    use std::sync::OnceLock;
    static BIN: OnceLock<&'static str> = OnceLock::new();
    *BIN.get_or_init(|| {
        std::process::Command::new("pwsh")
            .args(["-NonInteractive", "-Command", "exit 0"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
            .then_some("pwsh")
            .unwrap_or("powershell")
    })
}

pub enum Shell { PowerShell, Cmd, Python }

impl Shell {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "powershell" | "ps1" => Shell::PowerShell,
            "python" | "py"      => Shell::Python,
            _                    => Shell::Cmd,
        }
    }
    fn ext(&self) -> &'static str {
        match self { Shell::PowerShell => "ps1", Shell::Python => "py", Shell::Cmd => "bat" }
    }
}

fn tmp(label: &str, suffix: &str, ext: &str) -> PathBuf {
    let pid = std::process::id();
    std::env::temp_dir().join(format!("ctrl_{label}_{pid}_{suffix}.{ext}"))
}

fn esc_ps_path(p: &PathBuf) -> String {
    p.to_string_lossy().replace('\'', "''")
}

/// Stream a process to the frontend via events. Returns (success, full_output).
/// Emits `run-start` at the start and `run-output` per chunk.
pub async fn spawn_streaming(app: &AppHandle, program: &str, args: Vec<String>) -> Result<RunResult, String> {
    use tauri::Emitter;
    use tauri_plugin_shell::process::CommandEvent;

    let (mut rx, _child) = app.shell().command(program).args(&args)
        .spawn().map_err(|e| e.to_string())?;

    app.emit("run-start", ()).ok();

    let mut output = String::new();
    let mut success = false;
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(chunk) | CommandEvent::Stderr(chunk) => {
                let s = String::from_utf8_lossy(&chunk).to_string();
                output.push_str(&s);
                app.emit("run-output", s).ok();
            }
            CommandEvent::Terminated(p) => {
                success = p.code.map(|c| c == 0).unwrap_or(false);
                break;
            }
            _ => {}
        }
    }
    app.emit("run-done", success).ok();
    Ok(RunResult { success, output })
}

/// Run an inline command string non-elevated (streams output to frontend).
pub async fn run(app: &AppHandle, command: &str, shell: &Shell) -> Result<RunResult, String> {
    let script = tmp("exec", "cmd", shell.ext());
    let content = match shell {
        Shell::PowerShell => format!("[Console]::OutputEncoding=[Text.Encoding]::UTF8\n{command}"),
        Shell::Python     => command.to_string(),
        Shell::Cmd        => format!("@echo off\n{command}"),
    };
    fs::write(&script, &content).map_err(|e| e.to_string())?;
    let path_str = script.to_string_lossy().to_string();
    let (program, args) = match shell {
        Shell::PowerShell => (ps_bin(), vec!["-ExecutionPolicy".into(), "Bypass".into(), "-NoProfile".into(), "-File".into(), path_str.clone()]),
        Shell::Python     => ("python", vec![path_str.clone()]),
        Shell::Cmd        => ("cmd",    vec!["/c".into(), path_str.clone()]),
    };
    let result = spawn_streaming(app, program, args).await;
    let _ = fs::remove_file(&script);
    result
}

/// Run an inline command string elevated (UAC).
/// Streams output live via `run-output` events by polling the output file while
/// the elevated process runs. UAC cancellation → missing exit file → success=false.
pub async fn run_elevated(app: &AppHandle, command: &str, shell: &Shell, label: &str) -> Result<RunResult, String> {
    use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
    use tauri::Emitter;

    let cmd_file  = tmp(label, "cmd",  shell.ext());
    let wrap_ps1  = tmp(label, "wrap", "ps1");
    let out_file  = tmp(label, "out",  "txt");
    let exit_file = tmp(label, "exit", "txt");

    let cmd_content = match shell {
        Shell::PowerShell => format!("[Console]::OutputEncoding=[Text.Encoding]::UTF8\n{command}"),
        Shell::Python     => command.to_string(),
        Shell::Cmd        => format!("@echo off\n{command}"),
    };
    fs::write(&cmd_file, &cmd_content).map_err(|e| e.to_string())?;

    let run_line = match shell {
        Shell::PowerShell => format!("& '{}'", esc_ps_path(&cmd_file)),
        Shell::Python     => format!("python '{}'", esc_ps_path(&cmd_file)),
        Shell::Cmd        => format!("cmd /c '{}'", esc_ps_path(&cmd_file)),
    };
    let out_esc  = esc_ps_path(&out_file);
    let exit_esc = esc_ps_path(&exit_file);

    // Wrapper: pipe each output line through Add-Content (FileShare.ReadWrite) so
    // the polling thread can read the file while the elevated process is still writing.
    let wrapper = format!(
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8\n\
         $ec=0\n\
         try {{\n\
           $prev=''\n\
           ({run_line}) | ForEach-Object {{\n\
             $line=\"$_\"\n\
             if ($line -ne $prev) {{\n\
               Add-Content -Path '{out_esc}' -Value $line -Encoding UTF8\n\
               $prev=$line\n\
             }}\n\
           }}\n\
           $ec=if ($LASTEXITCODE -ne $null) {{ $LASTEXITCODE }} else {{ 0 }}\n\
         }} catch {{\n\
           Add-Content -Path '{out_esc}' -Value \"ERROR: $_\" -Encoding UTF8\n\
           $ec=1\n\
         }}\n\
         $ec | Out-File -FilePath '{exit_esc}' -Encoding UTF8 -Force\n"
    );
    fs::write(&wrap_ps1, &wrapper).map_err(|e| e.to_string())?;

    let invoke = format!(
        "Start-Process -Verb RunAs -Wait -WindowStyle Hidden -FilePath '{}' \
         -ArgumentList @('-ExecutionPolicy','Bypass','-NoProfile','-NonInteractive','-File','{}')",
        ps_bin(), esc_ps_path(&wrap_ps1)
    );

    // Start polling thread before kicking off elevated process
    app.emit("run-start", ()).ok();
    let stop        = Arc::new(AtomicBool::new(false));
    let stop2       = stop.clone();
    let out_path2   = out_file.clone();
    let app2        = app.clone();
    let last_emitted = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let last_emitted2 = last_emitted.clone();

    let poll = std::thread::spawn(move || {
        let mut last_len = 0usize;
        loop {
            if stop2.load(Ordering::Relaxed) { break; }
            // FILE_SHARE_READ|WRITE on Windows — safe to read while elevated PS writes
            if let Ok(content) = fs::read_to_string(&out_path2) {
                if content.len() > last_len {
                    // Strip \r: file has \r\n endings; xterm convertEol:true converts \n→\r\n,
                    // so \r\n would become \r\r\n (extra blank line per output line).
                    let chunk = content[last_len..].replace('\r', "");
                    if !chunk.is_empty() {
                        let _ = app2.emit("run-output", chunk);
                    }
                    last_len = content.len();
                    last_emitted2.store(last_len, Ordering::Relaxed);
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(120));
        }
    });

    // Wait for elevated process (blocks this async task, UI stays responsive)
    app.shell().command(ps_bin())
        .args(["-ExecutionPolicy", "Bypass", "-NoProfile", "-Command", &invoke])
        .output().await
        .map_err(|e| e.to_string())?;

    stop.store(true, Ordering::Relaxed);
    let _ = poll.join();

    // Emit any tail the poll thread missed in its last sleep window
    let emitted_up_to = last_emitted.load(Ordering::Relaxed);
    if let Ok(full) = fs::read_to_string(&out_file) {
        if full.len() > emitted_up_to {
            let tail = full[emitted_up_to..].replace('\r', "");
            if !tail.is_empty() { app.emit("run-output", tail).ok(); }
        }
    }

    let success = fs::read_to_string(&exit_file)
        .ok()
        .and_then(|s| s.trim().parse::<i64>().ok())
        .map(|ec| ec == 0)
        .unwrap_or_else(|| {
            // exit file missing = UAC cancelled or process never started
            app.emit("run-output", "(No output — UAC may have been cancelled)\r\n".to_string()).ok();
            false
        });

    app.emit("run-done", success).ok();

    for p in &[&cmd_file, &wrap_ps1, &out_file, &exit_file] {
        let _ = fs::remove_file(p);
    }

    // Output already streamed via events — return empty so JS doesn't double-display
    Ok(RunResult { success, output: String::new() })
}
