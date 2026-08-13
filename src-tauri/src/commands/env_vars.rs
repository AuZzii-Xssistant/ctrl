use serde::Serialize;
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

#[tauri::command]
pub async fn set_env_var(app: tauri::AppHandle, name: String, value: String) -> Result<(), String> {
    let cmd = format!(
        "[Environment]::SetEnvironmentVariable('{}','{}','User')",
        name.replace('\'', "''"),
        value.replace('\'', "''")
    );
    app.shell().command("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &cmd])
        .output().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn delete_env_var(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let cmd = format!(
        "[Environment]::SetEnvironmentVariable('{}', $null, 'User')",
        name.replace('\'', "''")
    );
    app.shell().command("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &cmd])
        .output().await.map_err(|e| e.to_string())?;
    Ok(())
}
