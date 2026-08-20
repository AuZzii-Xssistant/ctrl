use crate::commands::scripts::RunResult;
use crate::AppState;
use rusqlite::params;
use serde::Serialize;
use std::collections::HashSet;
use tauri::State;

#[derive(Serialize)]
pub struct BuilderDefs {
    pub categories: Vec<serde_json::Value>,
    pub presets: serde_json::Value,
}

/// Builder JSON files embedded at compile time — ensures they ship inside ctrl.exe.
/// On first launch next to a clean exe, these are seeded to data/builder/ on disk.
const EMBEDDED_BUILDER: &[(&str, &str)] = &[
    (
        "01-tools.json",
        include_str!("../../../data/builder/01-tools.json"),
    ),
    (
        "02-debloat.json",
        include_str!("../../../data/builder/02-debloat.json"),
    ),
    (
        "03-privacy.json",
        include_str!("../../../data/builder/03-privacy.json"),
    ),
    (
        "04-telemetry.json",
        include_str!("../../../data/builder/04-telemetry.json"),
    ),
    (
        "05-gaming.json",
        include_str!("../../../data/builder/05-gaming.json"),
    ),
    (
        "06-performance.json",
        include_str!("../../../data/builder/06-performance.json"),
    ),
    (
        "07-miscellanous.json",
        include_str!("../../../data/builder/07-miscellanous.json"),
    ),
    (
        "08-apps.json",
        include_str!("../../../data/builder/08-apps.json"),
    ),
    (
        "_meta.json",
        include_str!("../../../data/builder/_meta.json"),
    ),
];

/// Walk up from exe dir to find data/builder on disk (dev: target/debug/ctrl.exe → project root).
fn find_builder_dir() -> Option<std::path::PathBuf> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))?;
    let mut dir = exe_dir;
    for _ in 0..6 {
        let candidate = dir.join("data").join("builder");
        if candidate.exists() {
            return Some(candidate);
        }
        if !dir.pop() {
            break;
        }
    }
    None
}

/// Load categories: disk first (dev/user edits), fall back to embedded.
fn load_categories() -> Vec<serde_json::Value> {
    let mut cats = Vec::new();

    if let Some(data_dir) = find_builder_dir() {
        if let Ok(entries) = std::fs::read_dir(&data_dir) {
            let mut files: Vec<_> = entries
                .filter_map(|e| e.ok())
                .filter(|e| {
                    let name = e.file_name();
                    let s = name.to_string_lossy();
                    s.ends_with(".json") && !s.starts_with('_')
                })
                .collect();
            files.sort_by_key(|e| e.file_name());
            for entry in files {
                if let Ok(content) = std::fs::read_to_string(entry.path()) {
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                        cats.push(val);
                    }
                }
            }
        }
    }

    // Disk empty or missing — parse directly from embedded bytes
    if cats.is_empty() {
        for (name, content) in EMBEDDED_BUILDER {
            if name.starts_with('_') {
                continue;
            }
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(content) {
                cats.push(val);
            }
        }
    }

    cats
}

fn load_presets() -> serde_json::Value {
    // Try disk first
    if let Some(dir) = find_builder_dir() {
        if let Ok(content) = std::fs::read_to_string(dir.join("_meta.json")) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(p) = val.get("presets") {
                    return p.clone();
                }
            }
        }
    }
    // Fall back to embedded _meta.json
    for (name, content) in EMBEDDED_BUILDER {
        if *name == "_meta.json" {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(content) {
                if let Some(p) = val.get("presets") {
                    return p.clone();
                }
            }
        }
    }
    serde_json::Value::Object(Default::default())
}

/// Recursively collect PS1 strings for selected IDs, in JSON order.
fn collect_scripts(val: &serde_json::Value, ids: &HashSet<String>, out: &mut Vec<String>) {
    match val {
        serde_json::Value::Array(arr) => {
            for item in arr {
                collect_scripts(item, ids, out);
            }
        }
        serde_json::Value::Object(obj) => {
            if let Some(id) = obj.get("id").and_then(|v| v.as_str()) {
                if ids.contains(id) {
                    if let Some(serde_json::Value::String(s)) = obj.get("ps1") {
                        if !s.is_empty() {
                            out.push(s.clone());
                        }
                    }
                }
            }
            if let Some(items) = obj.get("items") {
                collect_scripts(items, ids, out);
            }
        }
        _ => {}
    }
}

// No self-elevation check here anymore — the script always needs admin (every
// Builder action writes to HKLM or similar), so CTRL itself launches it elevated
// (run_built_script uses exec::run_elevated; saved-to-Scripts copies get
// run_as_admin=1). This used to Start-Process a hardcoded "powershell.exe" (always
// legacy PS5, ignoring pwsh even if installed) into a separate external console and
// exit the process CTRL had just spawned in its own embedded terminal — the user
// saw the run start, immediately bail, and pop a second unrelated window.
const SCRIPT_HEADER: &str = r#"# Script generated by >_CTRL
$ProgressPreference = "SilentlyContinue"
$ErrorActionPreference = "SilentlyContinue"

"#;

const SCRIPT_FOOTER: &str = r#"
# ── Finalise ──────────────────────────────────────────────────────────────────
Pause
Write-Host ""
Write-Host "Restarting Explorer..." -ForegroundColor Cyan
Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500
Start-Process explorer
Write-Host ""
"#;

#[tauri::command]
pub fn get_builder_actions(_app: tauri::AppHandle) -> Result<BuilderDefs, String> {
    Ok(BuilderDefs {
        categories: load_categories(),
        presets: load_presets(),
    })
}

#[tauri::command]
pub fn build_script(
    _app: tauri::AppHandle,
    action_ids: Vec<String>,
    output_type: String,
) -> Result<String, String> {
    let _ = output_type; // PS1 only
    let cats = load_categories();
    let ids: HashSet<String> = action_ids.into_iter().collect();
    let mut scripts = Vec::new();
    for cat in &cats {
        collect_scripts(cat, &ids, &mut scripts);
    }
    let body = if scripts.is_empty() {
        String::from("# No actions selected.\n")
    } else {
        scripts.join("\n")
    };
    Ok(format!("{}{}{}", SCRIPT_HEADER, body, SCRIPT_FOOTER))
}

#[tauri::command]
pub async fn run_built_script(
    app: tauri::AppHandle,
    code: String,
    script_type: String,
) -> Result<RunResult, String> {
    // Every Builder action needs admin, so run elevated through the same PTY-wrapped
    // path Scripts/Fixes/Tweaks already use (exec::run_elevated) instead of the old
    // self-elevation dance: this auto-picks pwsh over legacy powershell (ps_bin(),
    // same detection everywhere else) and shows up in CTRL's own embedded terminal
    // with the standard "Running as administrator" divider, not a second window.
    let shell = crate::commands::exec::Shell::from_str(&script_type);
    let result =
        crate::commands::exec::run_elevated(&app, &code, &shell, "builder").await?;
    Ok(RunResult {
        success: result.success,
        output: String::new(),
    })
}

#[tauri::command]
pub fn save_built_script(
    state: State<AppState>,
    code: String,
    name: String,
    script_type: String,
    profile_ids: Vec<i64>,
    in_master: bool,
) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let max_mo: i64 = db
        .query_row(
            "SELECT COALESCE(MAX(master_order)+1,0) FROM scripts",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    // run_as_admin=1: every Builder action needs admin, and the generated script no
    // longer self-elevates (see SCRIPT_HEADER) -- without this, a script saved here
    // would run unprivileged from the Scripts pane and every action in it would fail.
    db.execute(
        "INSERT INTO scripts (name,description,category,file_path,script_type,tags,status,run_as_admin,content,in_master,master_order) \
         VALUES (?1,'Built with Script Builder','Builder','',?2,'','active',1,?3,?4,?5)",
        params![name, script_type, code, in_master as i64, max_mo],
    ).map_err(|e| e.to_string())?;
    let script_id = db.last_insert_rowid();
    for pid in profile_ids {
        let max_ord: i64 = db
            .query_row(
                "SELECT COALESCE(MAX(sort_order)+1,0) FROM ss_script_profile WHERE profile_id=?1",
                params![pid],
                |r| r.get(0),
            )
            .unwrap_or(0);
        db.execute(
            "INSERT OR IGNORE INTO ss_script_profile (script_id,profile_id,sort_order) VALUES (?1,?2,?3)",
            params![script_id, pid, max_ord]
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Windows unattend.xml answer file that bakes the Builder's currently-combined
// PS1 script into a fresh Windows install: bypasses Win11 hardware checks,
// disables network during specialize (skips the forced MS-account OOBE step),
// runs the script on first logon, then re-enables network + Windows Update.
// Template ported from WinScript (github.com/flick9000/winscript)'s
// unattend.js — same boilerplate, same three-script (Specialize/FirstLogon)
// structure, just generated server-side instead of via a Tauri JS plugin.
const AUTOUNATTEND_TEMPLATE: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
	<!-- Generated by >_ CTRL, ported from WinScript https://github.com/flick9000/winscript -->
	<settings pass="offlineServicing"></settings>
	<settings pass="windowsPE">
		<component name="Microsoft-Windows-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
			<UserData>
				<ProductKey>
					<Key>00000-00000-00000-00000-00000</Key>
					<WillShowUI>Always</WillShowUI>
				</ProductKey>
				<AcceptEula>true</AcceptEula>
			</UserData>
			<UseConfigurationSet>false</UseConfigurationSet>
			<RunSynchronous>
				<RunSynchronousCommand wcm:action="add">
					<Order>1</Order>
					<Path>reg.exe add "HKLM\SYSTEM\Setup\LabConfig" /v BypassTPMCheck /t REG_DWORD /d 1 /f</Path>
				</RunSynchronousCommand>
				<RunSynchronousCommand wcm:action="add">
					<Order>2</Order>
					<Path>reg.exe add "HKLM\SYSTEM\Setup\LabConfig" /v BypassSecureBootCheck /t REG_DWORD /d 1 /f</Path>
				</RunSynchronousCommand>
				<RunSynchronousCommand wcm:action="add">
					<Order>3</Order>
					<Path>reg.exe add "HKLM\SYSTEM\Setup\LabConfig" /v BypassRAMCheck /t REG_DWORD /d 1 /f</Path>
				</RunSynchronousCommand>
				<RunSynchronousCommand wcm:action="add">
					<Order>4</Order>
					<Path>reg.exe add "HKLM\SYSTEM\Setup\LabConfig" /v BypassCPUCheck /t REG_DWORD /d 1 /f</Path>
				</RunSynchronousCommand>
				<RunSynchronousCommand wcm:action="add">
					<Order>5</Order>
					<Path>reg.exe add "HKLM\SYSTEM\Setup\LabConfig" /v BypassStorageCheck /t REG_DWORD /d 1 /f</Path>
				</RunSynchronousCommand>
			</RunSynchronous>
		</component>
	</settings>
	<settings pass="generalize"></settings>
	<settings pass="specialize">
		<component name="Microsoft-Windows-Deployment" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
			<RunSynchronous>
				<RunSynchronousCommand wcm:action="add">
					<Order>1</Order>
					<Path>powershell.exe -WindowStyle "Normal" -NoProfile -Command "$xml = [xml]::new(); $xml.Load('C:\Windows\Panther\unattend.xml'); $sb = [scriptblock]::Create( $xml.unattend.Extensions.ExtractScript ); Invoke-Command -ScriptBlock $sb -ArgumentList $xml;"</Path>
				</RunSynchronousCommand>
				<RunSynchronousCommand wcm:action="add">
					<Order>2</Order>
					<Path>powershell.exe -WindowStyle "Normal" -ExecutionPolicy "Unrestricted" -NoProfile -File "C:\Windows\Setup\Scripts\Specialize.ps1"</Path>
				</RunSynchronousCommand>
				<RunSynchronousCommand wcm:action="add">
          			<Order>3</Order>
          			<Path>powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "Get-NetAdapter | Disable-NetAdapter -Confirm:$false"</Path>
        		</RunSynchronousCommand>
			</RunSynchronous>
		</component>
	</settings>
	<settings pass="auditSystem"></settings>
	<settings pass="auditUser"></settings>
	<settings pass="oobeSystem">
		<component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
			<OOBE>
				<HideEULAPage>true</HideEULAPage>
				<HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE>
				<HideOnlineAccountScreens>true</HideOnlineAccountScreens>
				<ProtectYourPC>3</ProtectYourPC>
			</OOBE>
			<FirstLogonCommands>
				<SynchronousCommand wcm:action="add">
					<Order>1</Order>
					<CommandLine>powershell.exe -WindowStyle "Normal" -ExecutionPolicy "Unrestricted" -NoProfile -File "C:\Windows\Setup\Scripts\FirstLogon.ps1"</CommandLine>
				</SynchronousCommand>
			</FirstLogonCommands>
		</component>
	</settings>
	<Extensions xmlns="urn:winscript:unattend">
		<ExtractScript>
param(
    [xml] $Document
);
foreach( $file in $Document.unattend.Extensions.File ) {
    $path = [System.Environment]::ExpandEnvironmentVariables( $file.GetAttribute( 'path' ) );
    mkdir -Path( $path | Split-Path -Parent ) -ErrorAction 'SilentlyContinue';
    $encoding = switch( [System.IO.Path]::GetExtension( $path ) ) {
        { $_ -in '.ps1', '.xml' } { [System.Text.Encoding]::UTF8; }
        { $_ -in '.reg', '.vbs', '.js' } { [System.Text.UnicodeEncoding]::new( $false, $true ); }
        default { [System.Text.Encoding]::Default; }
    };
    $bytes = $encoding.GetPreamble() + $encoding.GetBytes( $file.InnerText.Trim() );
    [System.IO.File]::WriteAllBytes( $path, $bytes );
}
		</ExtractScript>
		<File path="C:\Windows\Setup\Scripts\winscript.ps1">
__CTRL_SCRIPT__
		</File>
		<File path="C:\Windows\Setup\Scripts\Specialize.ps1">
$scripts = @(
	{
		reg.exe add "HKLM\Software\Policies\Microsoft\Windows\CloudContent" /v "DisableCloudOptimizedContent" /t REG_DWORD /d 1 /f;
	};
	{
		reg.exe add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\OOBE" /v BypassNRO /t REG_DWORD /d 1 /f;
	};
	{
        reg.exe add "HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU" /v NoAutoUpdate /t REG_DWORD /d 1 /f;
        reg.exe add "HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate" /v DisableWindowsUpdateAccess /t REG_DWORD /d 1 /f;
	};
);

& {
  [float] $complete = 0;
  [float] $increment = 100 / $scripts.Count;
  foreach( $script in $scripts ) {
    Write-Progress -Id 0 -Activity 'Running scripts to customize your Windows installation. Do not close this window.' -PercentComplete $complete;
    '*** Will now execute command «{0}».' -f $(
      $script.ToString().Trim() -replace '\s+', ' ' -replace '^(.{99})(.+)$', '$1…';
    );
    $start = [datetime]::Now;
    & $script;
    '*** Finished executing command after {0:0} ms.' -f [datetime]::Now.Subtract( $start ).TotalMilliseconds;
    "`r`n" * 3;
    $complete += $increment;
  }
} *>&1 | Out-String -Width 1KB -Stream >> "C:\Windows\Setup\Scripts\Specialize.log";
		</File>
		<File path="C:\Windows\Setup\Scripts\FirstLogon.ps1">
$scripts = @(
	{
		Get-NetAdapter | Enable-NetAdapter -Confirm:$false;
	};
	{
		Write-Host -ForegroundColor Green '-- Re-enabling Windows Update after OOBE';
		reg.exe delete "HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU" /v NoAutoUpdate /f;
		reg.exe delete "HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate" /v DisableWindowsUpdateAccess /f;
	};
	{
		& 'C:\Windows\Setup\Scripts\winscript.ps1';
	};
);

& {
  foreach( $script in $scripts ) {
    & $script;
  }
}
		</File>
	</Extensions>
</unattend>"#;

#[tauri::command]
pub async fn export_autounattend(app: tauri::AppHandle, script: String) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    // Normalize to bare \n first — .replace('\n', "\r\n") alone would double up
    // any line that's already CRLF (e.g. content copied from a Windows file)
    // into \r\r\n, corrupting the answer file.
    let escaped = script
        .replace("\r\n", "\n")
        .replace('\n', "\r\n")
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    let xml = AUTOUNATTEND_TEMPLATE.replace("__CTRL_SCRIPT__", &escaped);
    let path = app
        .dialog()
        .file()
        .add_filter("XML", &["xml"])
        .set_file_name("autounattend.xml")
        .blocking_save_file();
    match path {
        Some(p) => {
            std::fs::write(p.to_string(), xml).map_err(|e| e.to_string())?;
            Ok(true)
        }
        None => Ok(false),
    }
}
