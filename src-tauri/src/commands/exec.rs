/// Shared command executor — used by fixes, tweaks, and built scripts.
/// Writes commands to temp files and runs them with the correct shell.
/// Using -File avoids all quoting/escaping issues with -Command.
/// No $ErrorActionPreference='Stop' — scripts own their error handling.

use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

use crate::commands::scripts::RunResult;

/// Whether admin scripts open a visible external terminal (true) or run hidden (false).
static ADMIN_VISIBLE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

pub fn is_admin_visible() -> bool { ADMIN_VISIBLE.load(std::sync::atomic::Ordering::Relaxed) }

#[tauri::command]
pub fn set_admin_visible(visible: bool) { ADMIN_VISIBLE.store(visible, std::sync::atomic::Ordering::Relaxed); }

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
         Write-Host \"$($e)[90m\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500} run \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}$($e)[0m\"\n\
         $ec=0\n\
         try {{ {run_line}; $ec=if($LASTEXITCODE -ne $null){{$LASTEXITCODE}}else{{0}} }}\n\
         catch {{ Write-Host \"ERROR: $_\" -ForegroundColor Red; $ec=1 }}\n\
         if ($ec -eq 0) {{\n\
           Write-Host \"\"\n\
           Write-Host \"$($e)[90m\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500} $($e)[32mdone$($e)[90m \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}$($e)[0m\"\n\
         }} else {{\n\
           Write-Host \"\"\n\
           Write-Host \"$($e)[90m\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500} $($e)[31mfailed$($e)[90m \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}$($e)[0m\"\n\
         }}\n\
         $ec | Out-File -FilePath '{s_esc}' -Encoding UTF8 -Force\n\
         Remove-Item '{sc_esc}' -Force -ErrorAction SilentlyContinue\n\
         Remove-Item '{w_esc}' -Force -ErrorAction SilentlyContinue\n"
    );
    fs::write(&wrapper, &wrapper_content).map_err(|e| e.to_string())?;

    app.emit("run-start",   ()).ok();
    app.emit("run-pty-cmd", format!("& '{}'", esc_ps_path(&wrapper))).ok();

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
/// Visible mode (default): opens a real terminal window the user can watch; CTRL shows status.
/// Background mode: hidden window, output captured and shown in CTRL after completion.
/// Toggle with set_admin_visible() / ADMIN_VISIBLE flag.
pub async fn run_elevated(app: &AppHandle, command: &str, shell: &Shell, label: &str) -> Result<RunResult, String> {
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
    let visible  = is_admin_visible();

    let (wrapper, win_style) = if visible {
        // Visible: Write-Host shows output live in the external terminal window.
        // Add-Content captures stdout lines for display in CTRL after completion.
        // Programs that write to CONOUT$ directly (e.g. sfc.exe) appear live in the
        // window but aren't captured — CTRL will show whatever stdout produced.
        // No Read-Host — window closes automatically when done.
        let w = format!(
            "[Console]::OutputEncoding=[Text.Encoding]::UTF8\n\
             $ec=0\n\
             try {{\n\
               $prev=''\n\
               ({run_line}) | ForEach-Object {{\n\
                 $line=\"$_\"\n\
                 if ($line -ne $prev) {{\n\
                   Write-Host $line\n\
                   Add-Content -Path '{out_esc}' -Value $line -Encoding UTF8\n\
                   $prev=$line\n\
                 }}\n\
               }}\n\
               $ec=if ($LASTEXITCODE -ne $null) {{ $LASTEXITCODE }} else {{ 0 }}\n\
             }} catch {{\n\
               $msg=\"ERROR: $_\"\n\
               Write-Host $msg -ForegroundColor Red\n\
               Add-Content -Path '{out_esc}' -Value $msg -Encoding UTF8\n\
               $ec=1\n\
             }}\n\
             $ec | Out-File -FilePath '{exit_esc}' -Encoding UTF8 -Force\n"
        );
        (w, "Normal")
    } else {
        // Background: capture output line-by-line; shown in CTRL after completion.
        let w = format!(
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
        (w, "Hidden")
    };
    fs::write(&wrap_ps1, &wrapper).map_err(|e| e.to_string())?;

    let invoke = format!(
        "Start-Process -Verb RunAs -Wait -WindowStyle {win_style} -FilePath '{}' \
         -ArgumentList @('-ExecutionPolicy','Bypass','-NoProfile','-File','{}')",
        ps_bin(), esc_ps_path(&wrap_ps1)
    );

    app.emit("run-start", ()).ok();
    app.emit("run-output", if visible {
        "\x1b[33mRunning in admin terminal \u{2014} see external window\x1b[0m\r\n"
    } else {
        "\x1b[33mRunning as administrator...\x1b[0m\r\n"
    }).ok();

    // Blocks this async task until elevated process exits (UI thread stays responsive)
    app.shell().command(ps_bin())
        .args(["-ExecutionPolicy", "Bypass", "-NoProfile", "-Command", &invoke])
        .output().await
        .map_err(|e| e.to_string())?;

    let success = fs::read_to_string(&exit_file)
        .ok()
        .and_then(|s| s.trim().parse::<i64>().ok())
        .map(|ec| ec == 0)
        .unwrap_or_else(|| {
            app.emit("run-output", "(No output \u{2014} UAC may have been cancelled)\r\n").ok();
            false
        });

    // Show captured stdout in CTRL terminal (both modes).
    // Visible: programs writing to CONOUT$ (e.g. sfc) won't appear here — that's expected,
    // the user watched them live in the external window.
    let captured = fs::read_to_string(&out_file).unwrap_or_default();
    if !captured.is_empty() {
        app.emit("run-output", captured.replace('\r', "")).ok();
    } else if visible {
        app.emit("run-output", "\x1b[90m(output visible in external terminal)\x1b[0m\r\n").ok();
    }
    app.emit("run-done", success).ok();

    for p in &[&cmd_file, &wrap_ps1, &out_file, &exit_file] { let _ = fs::remove_file(p); }

    Ok(RunResult { success, output: String::new() })
}
