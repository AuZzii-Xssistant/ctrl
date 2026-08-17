use serde::Serialize;
use std::fs;
use tauri_plugin_shell::ShellExt;

#[derive(Serialize)]
pub struct EnvVar {
    pub name: String,
    pub value: String,
}

#[derive(Serialize)]
pub struct EnvVars {
    pub user: Vec<EnvVar>,
    pub system: Vec<EnvVar>,
}

fn parse_tsv(raw: &[u8]) -> Vec<EnvVar> {
    String::from_utf8_lossy(raw)
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(2, '\t');
            let name = parts.next()?.trim().to_string();
            if name.is_empty() { return None; }
            let value = parts.next().unwrap_or("").trim().to_string();
            Some(EnvVar { name, value })
        })
        .collect()
}

const GET_PS: &str =
    "[Environment]::GetEnvironmentVariables('%SCOPE%').GetEnumerator() \
     | Sort-Object Name \
     | ForEach-Object { \"$($_.Name)`t$($_.Value)\" }";

#[tauri::command]
pub async fn get_env_vars(app: tauri::AppHandle) -> Result<EnvVars, String> {
    let run = |scope: &str| {
        let cmd = GET_PS.replace("%SCOPE%", scope);
        let app2 = app.clone();
        async move {
            app2.shell().command("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", &cmd])
                .output().await.map_err(|e: tauri_plugin_shell::Error| e.to_string())
        }
    };
    let u = run("User").await?;
    let s = run("Machine").await?;
    Ok(EnvVars {
        user:   parse_tsv(&u.stdout),
        system: parse_tsv(&s.stdout),
    })
}

/// target: "User" (no elevation) or "Machine" (UAC elevation via temp PS1 + RunAs)
#[tauri::command]
pub async fn set_env_var(app: tauri::AppHandle, name: String, value: String, target: Option<String>) -> Result<(), String> {
    let scope = target.as_deref().unwrap_or("User");
    let inner = format!(
        "[Environment]::SetEnvironmentVariable('{}','{}','{}')",
        name.replace('\'', "''"), value.replace('\'', "''"), scope
    );
    if scope == "Machine" {
        run_elevated(&app, &inner).await
    } else {
        app.shell().command("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &inner])
            .output().await.map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// target: "User" or "Machine"
#[tauri::command]
pub async fn delete_env_var(app: tauri::AppHandle, name: String, target: Option<String>) -> Result<(), String> {
    let scope = target.as_deref().unwrap_or("User");
    let inner = format!(
        "[Environment]::SetEnvironmentVariable('{}', $null, '{}')",
        name.replace('\'', "''"), scope
    );
    if scope == "Machine" {
        run_elevated(&app, &inner).await
    } else {
        app.shell().command("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &inner])
            .output().await.map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// Open the Windows native environment variables editor.
#[tauri::command]
pub async fn open_env_editor(app: tauri::AppHandle) -> Result<(), String> {
    app.shell().command("rundll32")
        .args(["sysdm.cpl,EditEnvironmentVariables"])
        .spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// Append a directory to the User or System PATH (UAC for System).
#[tauri::command]
pub async fn add_to_path(app: tauri::AppHandle, dir: String, target: Option<String>) -> Result<(), String> {
    let scope = target.as_deref().unwrap_or("User");
    let dir_esc = dir.replace('\'', "''");
    let inner = format!(
        "$cur=[Environment]::GetEnvironmentVariable('Path','{scope}'); \
         if ($cur -split ';' | Where-Object {{ $_ -ieq '{dir_esc}' }}) {{ throw 'Already in PATH' }}; \
         [Environment]::SetEnvironmentVariable('Path',($cur.TrimEnd(';')+';{dir_esc}'),'{scope}')"
    );
    if scope == "Machine" {
        run_elevated(&app, &inner).await
    } else {
        app.shell().command("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &inner])
            .output().await.map_err(|e| e.to_string())?;
        Ok(())
    }
}

fn next_call_id() -> u64 {
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
}

/// Write cmd to a temp .ps1 and run it elevated via Start-Process -Verb RunAs -Wait.
async fn run_elevated(app: &tauri::AppHandle, cmd: &str) -> Result<(), String> {
    let tmp = std::env::temp_dir().join(format!("ctrl_env_{}_{}.ps1", std::process::id(), next_call_id()));
    fs::write(&tmp, format!("[Console]::OutputEncoding=[Text.Encoding]::UTF8\n{}\n", cmd))
        .map_err(|e| e.to_string())?;
    let invoke = format!(
        "Start-Process -Verb RunAs -FilePath powershell -Wait -WindowStyle Hidden \
         -ArgumentList @('-ExecutionPolicy','Bypass','-NoProfile','-File','{}')",
        tmp.to_string_lossy().replace('\'', "''")
    );
    app.shell().command("powershell")
        .args(["-ExecutionPolicy", "Bypass", "-Command", &invoke])
        .output().await.map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&tmp);
    Ok(())
}
