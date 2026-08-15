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

/// Run an inline command string non-elevated.
/// Routes execution through the PTY shell so output flows via pty-data — ConPTY
/// cursor stays in sync and Starship redraws land in the right place.
/// The wrapper .ps1 writes the run/done dividers and a sentinel file on completion;
/// we poll for the sentinel instead of spawn_streaming so callers get a real RunResult.
pub async fn run(app: &AppHandle, command: &str, shell: &Shell) -> Result<RunResult, String> {
    use tauri::Emitter;

    let script   = tmp("exec", "cmd",      shell.ext());
    let wrapper  = tmp("exec", "wrap",     "ps1");
    let sentinel = tmp("exec", "sentinel", "txt");

    let content = match shell {
        Shell::PowerShell => format!("[Console]::OutputEncoding=[Text.Encoding]::UTF8\n{command}"),
        Shell::Python     => command.to_string(),
        Shell::Cmd        => format!("@echo off\n{command}"),
    };
    fs::write(&script, &content).map_err(|e| e.to_string())?;

    let run_line = match shell {
        Shell::PowerShell => format!("& '{}'", esc_ps_path(&script)),
        Shell::Python     => format!("python '{}'", esc_ps_path(&script)),
        Shell::Cmd        => format!("cmd /c '{}'", esc_ps_path(&script)),
    };
    let s_esc  = esc_ps_path(&sentinel);
    let sc_esc = esc_ps_path(&script);
    let w_esc  = esc_ps_path(&wrapper);

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
         Set-PSReadLineOption -AddToHistoryHandler $null\n\
         $ec | Out-File -FilePath '{s_esc}' -Encoding UTF8 -Force\n\
         Remove-Item '{sc_esc}' -Force -ErrorAction SilentlyContinue\n\
         Remove-Item '{w_esc}' -Force -ErrorAction SilentlyContinue\n"
    );
    fs::write(&wrapper, &wrapper_content).map_err(|e| e.to_string())?;

    let pty_cmd = format!(
        "Set-PSReadLineOption -AddToHistoryHandler {{param($l) $l -notmatch 'ctrl_'}}; & '{}'",
        esc_ps_path(&wrapper)
    );
    app.emit("run-start",   ()).ok();
    app.emit("run-pty-cmd", pty_cmd).ok();

    // Poll for sentinel written by wrapper on completion (max 10 min, blocking thread).
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
            if std::time::Instant::now() > deadline { return false; }
        }
    }).await.unwrap_or(false);

    app.emit("run-done", success).ok();
    Ok(RunResult { success, output: String::new() })
}

/// Run an inline command string elevated (UAC).
/// Same PTY-wrapper pattern as run(): UAC prompt fires, elevated script runs hidden,
/// output captured and displayed in CTRL's embedded terminal — no external window.
pub async fn run_elevated(app: &AppHandle, command: &str, shell: &Shell, label: &str) -> Result<RunResult, String> {
    use tauri::Emitter;

    let cmd_file  = tmp(label, "cmd",      shell.ext());
    let elev_wrap = tmp(label, "elevwrap", "ps1");
    let pty_wrap  = tmp(label, "ptywrap",  "ps1");
    let exit_file = tmp(label, "exit",     "txt");
    let sentinel  = tmp(label, "sentinel", "txt");

    // The actual script content (run elevated)
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
    let exit_esc  = esc_ps_path(&exit_file);

    // Elevated wrapper: runs script directly (no pipeline) so CONOUT$ tools like
    // sfc.exe, chkdsk etc. appear live in the external window, not just stdout.
    let elev_content = format!(
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8\n\
         $ec=0\n\
         try {{ {run_line}; $ec=if($LASTEXITCODE -ne $null){{$LASTEXITCODE}}else{{0}} }}\n\
         catch {{ Write-Host \"ERROR: $_\" -ForegroundColor Red; $ec=1 }}\n\
         Read-Host \"`nPress Enter to close\"\n\
         $ec | Out-File -FilePath '{exit_esc}' -Encoding UTF8 -Force\n"
    );
    fs::write(&elev_wrap, &elev_content).map_err(|e| e.to_string())?;

    let elev_esc  = esc_ps_path(&elev_wrap);
    let cmd_esc   = esc_ps_path(&cmd_file);
    let exit_esc2 = esc_ps_path(&exit_file);
    let s_esc     = esc_ps_path(&sentinel);
    let pw_esc    = esc_ps_path(&pty_wrap);
    let ps        = ps_bin();

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
           Start-Process -Verb RunAs -Wait -WindowStyle Normal \
             -FilePath '{ps}' \
             -ArgumentList @('-ExecutionPolicy','Bypass','-NoProfile','-File','{elev_esc}')\n\
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
         Set-PSReadLineOption -AddToHistoryHandler $null\n\
         $ec | Out-File -FilePath '{s_esc}' -Encoding UTF8 -Force\n\
         Remove-Item '{cmd_esc}'   -Force -ErrorAction SilentlyContinue\n\
         Remove-Item '{elev_esc}' -Force -ErrorAction SilentlyContinue\n\
         Remove-Item '{exit_esc2}' -Force -ErrorAction SilentlyContinue\n\
         Remove-Item '{pw_esc}'   -Force -ErrorAction SilentlyContinue\n"
    );
    fs::write(&pty_wrap, &pty_content).map_err(|e| e.to_string())?;

    let pty_cmd = format!(
        "Set-PSReadLineOption -AddToHistoryHandler {{param($l) $l -notmatch 'ctrl_'}}; & '{}'",
        esc_ps_path(&pty_wrap)
    );
    app.emit("run-start",   ()).ok();
    app.emit("run-pty-cmd", pty_cmd).ok();

    // Poll for sentinel written by pty_wrap on completion (max 10 min, blocking thread).
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
            if std::time::Instant::now() > deadline { return false; }
        }
    }).await.unwrap_or(false);

    app.emit("run-done", success).ok();
    Ok(RunResult { success, output: String::new() })
}
