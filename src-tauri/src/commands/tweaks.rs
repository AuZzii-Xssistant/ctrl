use tauri_plugin_shell::ShellExt;
use crate::commands::scripts::RunResult;

#[tauri::command]
pub async fn run_tweak_cmd(app: tauri::AppHandle, cmd: String) -> Result<RunResult, String> {
    let utf8_cmd = format!("[Console]::OutputEncoding=[Text.Encoding]::UTF8; {}", cmd);
    let out = app.shell().command("powershell")
        .args(["-ExecutionPolicy", "Bypass", "-Command", &utf8_cmd])
        .output().await.map_err(|e| e.to_string())?;
    let output = String::from_utf8_lossy(&out.stdout).to_string()
        + &String::from_utf8_lossy(&out.stderr);
    Ok(RunResult { success: out.status.success(), output })
}
