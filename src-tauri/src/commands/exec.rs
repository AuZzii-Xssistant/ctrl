/// Shared command executor — used by fixes, tweaks, and built scripts.
/// Writes commands to temp files and runs them with the correct shell.
/// Using -File avoids all quoting/escaping issues with -Command.
/// No $ErrorActionPreference='Stop' — scripts own their error handling.

use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

use crate::commands::scripts::RunResult;

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

/// Run an inline command string elevated (UAC). Returns actual exit code.
/// UAC cancellation is detected: output file missing → success=false.
pub async fn run_elevated(app: &AppHandle, command: &str, shell: &Shell, label: &str) -> Result<RunResult, String> {
    let cmd_file  = tmp(label, "cmd",  shell.ext());
    let wrap_ps1  = tmp(label, "wrap", "ps1");
    let out_file  = tmp(label, "out",  "txt");
    let exit_file = tmp(label, "exit", "txt");

    // Write the command to its own file
    let cmd_content = match shell {
        Shell::PowerShell => format!("[Console]::OutputEncoding=[Text.Encoding]::UTF8\n{command}"),
        Shell::Python     => command.to_string(),
        Shell::Cmd        => format!("@echo off\n{command}"),
    };
    fs::write(&cmd_file, &cmd_content).map_err(|e| e.to_string())?;

    // Line that runs the command and redirects stderr→stdout
    let run_line = match shell {
        Shell::PowerShell => format!("& '{}' 2>&1", esc_ps_path(&cmd_file)),
        Shell::Python     => format!("python '{}' 2>&1", esc_ps_path(&cmd_file)),
        Shell::Cmd        => format!("cmd /c '{}' 2>&1", esc_ps_path(&cmd_file)),
    };

    // Wrapper captures output + exit code separately
    let wrapper = format!(
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8\n\
         $ec=0\n\
         try {{\n\
           $o=({run_line})\n\
           $ec=if ($LASTEXITCODE -ne $null) {{ $LASTEXITCODE }} else {{ 0 }}\n\
           $o | Out-File -FilePath '{out}' -Encoding UTF8 -Force\n\
         }} catch {{\n\
           \"ERROR: $_\" | Out-File -FilePath '{out}' -Encoding UTF8 -Force\n\
           $ec=1\n\
         }}\n\
         $ec | Out-File -FilePath '{exit}' -Encoding UTF8 -Force\n",
        out  = esc_ps_path(&out_file),
        exit = esc_ps_path(&exit_file),
    );
    fs::write(&wrap_ps1, &wrapper).map_err(|e| e.to_string())?;

    // Launch wrapper elevated and wait
    let invoke = format!(
        "Start-Process -Verb RunAs -Wait -WindowStyle Hidden -FilePath '{}' \
         -ArgumentList @('-ExecutionPolicy','Bypass','-NoProfile','-NonInteractive','-File','{}')",
        ps_bin(), esc_ps_path(&wrap_ps1)
    );
    app.shell().command(ps_bin())
        .args(["-ExecutionPolicy", "Bypass", "-NoProfile", "-Command", &invoke])
        .output().await.map_err(|e| e.to_string())?;

    // Read results — exit file missing = UAC was cancelled
    let output = fs::read_to_string(&out_file)
        .unwrap_or_else(|_| String::from("(No output — UAC may have been cancelled)"));
    let success = fs::read_to_string(&exit_file)
        .ok()
        .and_then(|s| s.trim().parse::<i64>().ok())
        .map(|ec| ec == 0)
        .unwrap_or(false); // missing exit file = UAC cancelled

    let _ = fs::remove_file(&cmd_file);
    let _ = fs::remove_file(&wrap_ps1);
    let _ = fs::remove_file(&out_file);
    let _ = fs::remove_file(&exit_file);

    Ok(RunResult { success, output })
}
