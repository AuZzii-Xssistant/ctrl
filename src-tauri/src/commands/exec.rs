//! Shared command executor — used by fixes, tweaks, and built scripts.
//! Writes commands to temp files and runs them with the correct shell.
//! Using -File avoids all quoting/escaping issues with -Command.
//! No $ErrorActionPreference='Stop' — scripts own their error handling.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

use crate::commands::scripts::RunResult;

// Stop button — single-flight cancel flag. Only one script/fix run is ever
// active at a time (acquireRun() serializes on the JS side), so one flag suffices.
static RUN_CANCELLED: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn stop_current_run() {
    RUN_CANCELLED.store(true, Ordering::SeqCst);
}

/// Kill an external elevated console spawned for the current run (Stop button).
#[tauri::command]
pub fn kill_process(pid: u32) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| e.to_string())?;
    Ok(())
}

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
    BIN.get_or_init(|| {
        use std::os::windows::process::CommandExt;
        let pwsh_ok = std::process::Command::new("pwsh")
            .args(["-NonInteractive", "-Command", "exit 0"])
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if pwsh_ok {
            "pwsh"
        } else {
            "powershell"
        }
    })
}

#[allow(clippy::enum_variant_names)] // PowerShell is the correct/clear name, not a naming accident
pub enum Shell {
    PowerShell,
    Cmd,
    Python,
}

impl Shell {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "powershell" | "ps1" => Shell::PowerShell,
            "python" | "py" => Shell::Python,
            _ => Shell::Cmd,
        }
    }
    fn ext(&self) -> &'static str {
        match self {
            Shell::PowerShell => "ps1",
            Shell::Python => "py",
            Shell::Cmd => "bat",
        }
    }
}

/// Per-call counter folded into every temp filename. Without it, two runs sharing
/// the same label (e.g. two "exec" runs in different terminal tabs, which
/// acquireRun() on the JS side explicitly allows concurrently) would collide on
/// the same script/wrapper/sentinel files and corrupt each other mid-run.
fn tmp_call_id() -> u64 {
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
}

fn tmp(label: &str, suffix: &str, ext: &str) -> PathBuf {
    let pid = std::process::id();
    let n = tmp_call_id();
    std::env::temp_dir().join(format!("ctrl_{label}_{pid}_{n}_{suffix}.{ext}"))
}

fn esc_ps_path(p: &Path) -> String {
    p.to_string_lossy().replace('\'', "''")
}

/// Stream a process to the frontend via events. Returns (success, full_output).
/// Emits `run-start` at the start and `run-output` per chunk.
pub async fn spawn_streaming(
    app: &AppHandle,
    program: &str,
    args: Vec<String>,
) -> Result<RunResult, String> {
    use tauri::Emitter;
    use tauri_plugin_shell::process::CommandEvent;

    let (mut rx, _child) = app
        .shell()
        .command(program)
        .args(&args)
        .spawn()
        .map_err(|e| e.to_string())?;

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

/// Run an inline command string non-elevated.
/// Routes execution through the PTY shell so output flows via pty-data — ConPTY
/// cursor stays in sync and Starship redraws land in the right place.
/// The wrapper .ps1 writes the run/done dividers and a sentinel file on completion;
/// we poll for the sentinel instead of spawn_streaming so callers get a real RunResult.
pub async fn run(app: &AppHandle, command: &str, shell: &Shell) -> Result<RunResult, String> {
    use tauri::Emitter;

    let script = tmp("exec", "cmd", shell.ext());
    let wrapper = tmp("exec", "wrap", "ps1");
    let sentinel = tmp("exec", "sentinel", "txt");

    let content = match shell {
        Shell::PowerShell => format!("[Console]::OutputEncoding=[Text.Encoding]::UTF8\n{command}"),
        Shell::Python => command.to_string(),
        Shell::Cmd => format!("@echo off\n{command}"),
    };
    fs::write(&script, &content).map_err(|e| e.to_string())?;

    let run_line = match shell {
        Shell::PowerShell => format!("& '{}'", esc_ps_path(&script)),
        Shell::Python => format!("python '{}'", esc_ps_path(&script)),
        Shell::Cmd => format!("cmd /c '{}'", esc_ps_path(&script)),
    };
    let s_esc = esc_ps_path(&sentinel);
    let sc_esc = esc_ps_path(&script);
    let w_esc = esc_ps_path(&wrapper);

    // Wrapper embeds run/done dividers and writes sentinel file when done.
    // All output flows through pty-data — no _termWrite injection needed.
    let wrapper_content = format!(
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8\n\
         $e=[char]27\n\
         [Console]::Write(\"$($e)[1A$($e)[2K\")\n\
         Write-Host \"$($e)[90m\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500} run \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}$($e)[0m\"\n\
         $ec=0\n\
         try {{ {run_line}; $ec=if($LASTEXITCODE -ne $null){{$LASTEXITCODE}}else{{0}} }}\n\
         catch {{ Write-Host \"ERROR: $_\" -ForegroundColor Red; $ec=1 }}\n\
         if ($ec -eq 0) {{\n\
           Write-Host \"$($e)[90m\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500} $($e)[32mdone$($e)[90m \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}$($e)[0m\"\n\
         }} else {{\n\
           Write-Host \"$($e)[90m\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500} $($e)[31mfailed$($e)[90m \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}$($e)[0m\"\n\
         }}\n\
         $ec | Out-File -FilePath '{s_esc}' -Encoding UTF8 -Force\n\
         Remove-Item '{sc_esc}' -Force -ErrorAction SilentlyContinue\n\
         Remove-Item '{w_esc}' -Force -ErrorAction SilentlyContinue\n"
    );
    fs::write(&wrapper, &wrapper_content).map_err(|e| e.to_string())?;

    RUN_CANCELLED.store(false, Ordering::SeqCst);
    app.emit("run-start", ()).ok();
    app.emit("run-pty-cmd", format!("& '{}'", esc_ps_path(&wrapper)))
        .ok();

    // Poll for sentinel written by wrapper on completion (max 10 min, blocking thread).
    // Stop button sets RUN_CANCELLED — bail immediately instead of waiting on a
    // sentinel that will never come once the PTY shell running it has been killed.
    let success = tauri::async_runtime::spawn_blocking(move || {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(600);
        loop {
            std::thread::sleep(std::time::Duration::from_millis(150));
            if sentinel.exists() {
                let ec = fs::read_to_string(&sentinel)
                    .ok()
                    .and_then(|s| s.trim().parse::<i64>().ok())
                    .unwrap_or(1);
                let _ = fs::remove_file(&sentinel);
                return ec == 0;
            }
            if RUN_CANCELLED.swap(false, Ordering::SeqCst) {
                let _ = fs::remove_file(&script);
                let _ = fs::remove_file(&wrapper);
                return false;
            }
            if std::time::Instant::now() > deadline {
                return false;
            }
        }
    })
    .await
    .unwrap_or(false);

    app.emit("run-done", success).ok();
    Ok(RunResult {
        success,
        output: String::new(),
    })
}

/// Run an inline command string elevated (UAC).
/// Same PTY-wrapper pattern as run(): UAC prompt fires, elevated script runs hidden,
/// output captured and displayed in CTRL's embedded terminal — no external window.
pub async fn run_elevated(
    app: &AppHandle,
    command: &str,
    shell: &Shell,
    label: &str,
) -> Result<RunResult, String> {
    use tauri::Emitter;

    let cmd_file = tmp(label, "cmd", shell.ext());
    let elev_wrap = tmp(label, "elevwrap", "ps1");
    let pty_wrap = tmp(label, "ptywrap", "ps1");
    let exit_file = tmp(label, "exit", "txt");
    let sentinel = tmp(label, "sentinel", "txt");
    let pid_file = tmp(label, "pid", "txt");

    // The actual script content (run elevated)
    let cmd_content = match shell {
        Shell::PowerShell => format!("[Console]::OutputEncoding=[Text.Encoding]::UTF8\n{command}"),
        Shell::Python => command.to_string(),
        Shell::Cmd => format!("@echo off\n{command}"),
    };
    fs::write(&cmd_file, &cmd_content).map_err(|e| e.to_string())?;

    let run_line = match shell {
        Shell::PowerShell => format!("& '{}'", esc_ps_path(&cmd_file)),
        Shell::Python => format!("python '{}'", esc_ps_path(&cmd_file)),
        Shell::Cmd => format!("cmd /c '{}'", esc_ps_path(&cmd_file)),
    };
    let exit_esc = esc_ps_path(&exit_file);

    // Elevated wrapper: runs script directly (no pipeline) so CONOUT$ tools like
    // sfc.exe, chkdsk etc. appear live in the external window, not just stdout.
    let elev_content = format!(
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8\n\
         $ec=0\n\
         try {{ {run_line}; $ec=if($LASTEXITCODE -ne $null){{$LASTEXITCODE}}else{{0}} }}\n\
         catch {{ Write-Host \"ERROR: $_\" -ForegroundColor Red; $ec=1 }}\n\
         $ec | Out-File -FilePath '{exit_esc}' -Encoding UTF8 -Force\n"
    );
    fs::write(&elev_wrap, &elev_content).map_err(|e| e.to_string())?;

    let elev_esc = esc_ps_path(&elev_wrap);
    let cmd_esc = esc_ps_path(&cmd_file);
    let exit_esc2 = esc_ps_path(&exit_file);
    let s_esc = esc_ps_path(&sentinel);
    let pw_esc = esc_ps_path(&pty_wrap);
    let pid_esc = esc_ps_path(&pid_file);
    let ps = ps_bin();

    // PTY wrapper: runs non-elevated in the embedded terminal.
    // Shows run divider, opens visible elevated window, waits, shows done/failed divider.
    // Captured output not shown (user watched it live in the external terminal).
    let pty_content = format!(
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8\n\
         $e=[char]27\n\
         [Console]::Write(\"$($e)[1A$($e)[2K\")\n\
         Write-Host \"$($e)[90m\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500} run \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}$($e)[0m\"\n\
         Write-Host \"$($e)[33mRunning as administrator \u{2014} see external terminal$($e)[0m\"\n\
         $ec=1\n\
         try {{\n\
           $__p = Start-Process -Verb RunAs -WindowStyle Normal -PassThru \
             -FilePath '{ps}' \
             -ArgumentList @('-ExecutionPolicy','Bypass','-NoProfile','-File','{elev_esc}')\n\
           $__p.Id | Out-File -FilePath '{pid_esc}' -Encoding UTF8 -Force\n\
           $__p.WaitForExit()\n\
           $ec_str=(Get-Content '{exit_esc2}' -ErrorAction SilentlyContinue)\n\
           if ($null -ne $ec_str) {{ $ec=[int]$ec_str.Trim() }}\n\
         }} catch {{\n\
           Write-Host \"$($e)[33mUAC cancelled or access denied$($e)[0m\"\n\
         }}\n\
         if ($ec -eq 0) {{\n\
           Write-Host \"$($e)[90m\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500} $($e)[32mdone$($e)[90m \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}$($e)[0m\"\n\
         }} else {{\n\
           Write-Host \"$($e)[90m\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500} $($e)[31mfailed$($e)[90m \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}$($e)[0m\"\n\
         }}\n\
         $ec | Out-File -FilePath '{s_esc}' -Encoding UTF8 -Force\n\
         Remove-Item '{cmd_esc}'   -Force -ErrorAction SilentlyContinue\n\
         Remove-Item '{elev_esc}' -Force -ErrorAction SilentlyContinue\n\
         Remove-Item '{exit_esc2}' -Force -ErrorAction SilentlyContinue\n\
         Remove-Item '{pid_esc}'  -Force -ErrorAction SilentlyContinue\n\
         Remove-Item '{pw_esc}'   -Force -ErrorAction SilentlyContinue\n"
    );
    fs::write(&pty_wrap, &pty_content).map_err(|e| e.to_string())?;

    RUN_CANCELLED.store(false, Ordering::SeqCst);
    app.emit("run-start", ()).ok();
    app.emit("run-pty-cmd", format!("& '{}'", esc_ps_path(&pty_wrap)))
        .ok();

    // Poll for sentinel written by pty_wrap on completion (max 10 min, blocking thread).
    // Also opportunistically pick up the elevated process's PID once Start-Process
    // writes it, so the Stop button can taskkill the external console directly.
    let app_pid = app.clone();
    let pid_file2 = pid_file.clone();
    let success = tauri::async_runtime::spawn_blocking(move || {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(600);
        let mut pid_emitted = false;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(150));
            if !pid_emitted {
                if let Ok(s) = fs::read_to_string(&pid_file2) {
                    if let Ok(pid) = s.trim().parse::<u32>() {
                        let _ = app_pid.emit("elevated-pid", pid);
                        pid_emitted = true;
                    }
                }
            }
            if sentinel.exists() {
                let ec = fs::read_to_string(&sentinel)
                    .ok()
                    .and_then(|s| s.trim().parse::<i64>().ok())
                    .unwrap_or(1);
                let _ = fs::remove_file(&sentinel);
                return ec == 0;
            }
            if RUN_CANCELLED.swap(false, Ordering::SeqCst) {
                let _ = fs::remove_file(&pid_file2);
                return false;
            }
            if std::time::Instant::now() > deadline {
                return false;
            }
        }
    })
    .await
    .unwrap_or(false);

    app.emit("run-done", success).ok();
    Ok(RunResult {
        success,
        output: String::new(),
    })
}
