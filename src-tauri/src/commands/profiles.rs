//! System Profiles — named machine-state snapshots (Roadmap item 3).
//! A profile bundles power plan / apps-to-kill / apps-to-start / DNS / audio
//! endpoint / display refresh rate / a custom PowerShell block. Activating
//! uses two PowerShell steps: (1) a non-elevated read-only call captures the
//! current state as CTRL_SNAP markers (stdout reliably returned to Rust),
//! (2) an elevated fire-and-forget call applies every enabled item. Restore
//! replays the snapshot in reverse.
//!
//! Audio-device and refresh-rate changes have no built-in PowerShell cmdlet
//! on stock Windows — best-effort only (see docs/known-issues.md).

use crate::commands::exec::{run_elevated as exec_elevated, Shell};
use crate::commands::scripts::RunResult;
use crate::AppState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_shell::ShellExt;

#[derive(Serialize)]
pub struct ProfileItem {
    pub id: i64,
    pub item_type: String,
    pub value: String,
    pub enabled: bool,
}

#[derive(Serialize)]
pub struct Profile {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub items: Vec<ProfileItem>,
}

#[derive(Deserialize)]
pub struct ProfileItemData {
    pub item_type: String,
    pub value: String,
    pub enabled: Option<bool>,
}

#[derive(Deserialize)]
pub struct ProfileData {
    pub name: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub items: Vec<ProfileItemData>,
}

#[derive(Serialize)]
pub struct ActiveProfile {
    pub id: i64,
    pub name: String,
}

const ITEM_TYPES: &[&str] = &[
    "power_plan",
    "kill_apps",
    "start_apps",
    "dns",
    "audio",
    "refresh_rate",
    "script",
];

fn load_items(db: &rusqlite::Connection, profile_id: i64) -> Result<Vec<ProfileItem>, String> {
    let mut stmt = db
        .prepare(
            "SELECT id,item_type,value,enabled FROM profile_items WHERE profile_id=?1 ORDER BY id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![profile_id], |r| {
            Ok(ProfileItem {
                id: r.get(0)?,
                item_type: r.get(1)?,
                value: r.get(2)?,
                enabled: r.get::<_, i64>(3)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn get_profiles(state: State<AppState>) -> Result<Vec<Profile>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare("SELECT id,name,description,icon FROM profiles ORDER BY name")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows.filter_map(|r| r.ok()) {
        let (id, name, description, icon) = row;
        let items = load_items(&db, id)?;
        out.push(Profile {
            id,
            name,
            description,
            icon,
            items,
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn add_profile(state: State<AppState>, data: ProfileData) -> Result<i64, String> {
    let mut db = state.0.lock().map_err(|e| e.to_string())?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO profiles (name,description,icon) VALUES (?1,?2,?3)",
        params![
            data.name,
            data.description.unwrap_or_default(),
            data.icon.unwrap_or_else(|| "ti-user-cog".into())
        ],
    )
    .map_err(|e| e.to_string())?;
    let id = tx.last_insert_rowid();
    insert_items(&tx, id, &data.items)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub fn update_profile(state: State<AppState>, id: i64, data: ProfileData) -> Result<(), String> {
    let mut db = state.0.lock().map_err(|e| e.to_string())?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE profiles SET name=?1,description=?2,icon=?3 WHERE id=?4",
        params![
            data.name,
            data.description.unwrap_or_default(),
            data.icon.unwrap_or_else(|| "ti-user-cog".into()),
            id
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM profile_items WHERE profile_id=?1", params![id])
        .map_err(|e| e.to_string())?;
    insert_items(&tx, id, &data.items)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

fn insert_items(
    tx: &rusqlite::Transaction,
    profile_id: i64,
    items: &[ProfileItemData],
) -> Result<(), String> {
    for it in items {
        if !ITEM_TYPES.contains(&it.item_type.as_str()) {
            continue;
        }
        if it.value.trim().is_empty() {
            continue;
        }
        tx.execute(
            "INSERT INTO profile_items (profile_id,item_type,value,enabled) VALUES (?1,?2,?3,?4)",
            params![
                profile_id,
                it.item_type,
                it.value,
                it.enabled.unwrap_or(true) as i64
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Bug 2 fix: wrap both statements in a transaction so delete + state-clear are atomic.
#[tauri::command]
pub fn delete_profile(state: State<AppState>, id: i64) -> Result<(), String> {
    let mut db = state.0.lock().map_err(|e| e.to_string())?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM profiles WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    tx.execute("UPDATE profile_state SET active_profile_id=NULL, active_since=NULL WHERE active_profile_id=?1", params![id]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_active_profile(state: State<AppState>) -> Result<Option<ActiveProfile>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    match db.query_row(
        "SELECT p.id,p.name FROM profile_state s JOIN profiles p ON p.id=s.active_profile_id WHERE s.id=1",
        [],
        |r| Ok(ActiveProfile { id: r.get(0)?, name: r.get(1)? }),
    ) {
        Ok(ap) => Ok(Some(ap)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn esc_ps(s: &str) -> String {
    s.replace('\'', "''")
}

/// Read-only PowerShell script that prints CTRL_SNAP: markers to stdout.
/// None of these reads require elevation -- this runs non-elevated so stdout
/// is captured directly back into the Rust process.
fn build_snapshot_script() -> String {
    String::from(
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8\n$ErrorActionPreference='Continue'\ntry { $__plan=([regex]::Match((powercfg /getactivescheme),'[0-9a-fA-F-]{36}')).Value; Write-Output \"CTRL_SNAP:power_plan=$__plan\" } catch { Write-Output 'CTRL_SNAP:power_plan=' }\ntry {\n  $__ifc=(Get-NetAdapter | Where-Object Status -eq 'Up' | Select-Object -First 1 -ExpandProperty InterfaceAlias)\n  $__dns=(Get-DnsClientServerAddress -InterfaceAlias $__ifc -AddressFamily IPv4 -ErrorAction Stop).ServerAddresses -join ','\n  Write-Output \"CTRL_SNAP:dns_interface=$__ifc\"\n  Write-Output \"CTRL_SNAP:dns=$__dns\"\n} catch { Write-Output 'CTRL_SNAP:dns_interface='; Write-Output 'CTRL_SNAP:dns=' }\ntry { $__aud=(Get-AudioDevice -Playback -ErrorAction Stop).Name; Write-Output \"CTRL_SNAP:audio=$__aud\" } catch { Write-Output 'CTRL_SNAP:audio=' }\n"
    )
}

/// Derive the process names that will be started by the profile, so the
/// snapshot can record them for kill-on-restore without needing elevated stdout.
fn snapshot_started_apps(items: &[ProfileItem]) -> String {
    items
        .iter()
        .filter(|i| i.enabled && i.item_type == "start_apps")
        .flat_map(|i| {
            i.value
                .lines()
                .map(str::trim)
                .filter(|l| !l.is_empty())
                .map(|p| {
                    std::path::Path::new(p)
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or(p)
                        .to_string()
                })
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>()
        .join(",")
}

/// Build the elevated PowerShell apply script (fire-and-forget -- stdout not captured).
/// Snapshot reads have been moved to build_snapshot_script / run non-elevated.
fn build_activate_script(items: &[ProfileItem]) -> String {
    let mut s = String::from("[Console]::OutputEncoding=[Text.Encoding]::UTF8\n$ErrorActionPreference='Continue'\n$__ifc=(Get-NetAdapter | Where-Object Status -eq 'Up' | Select-Object -First 1 -ExpandProperty InterfaceAlias)\n");

    // apply, in a sensible order (power plan first, custom script last)
    for it in items.iter().filter(|i| i.enabled) {
        match it.item_type.as_str() {
            "power_plan" => {
                s.push_str(&format!(
                    "try {{\n  $__target='{v}'\n  $__guid=([regex]::Match($__target,'^[0-9a-fA-F-]{{36}}$')).Value\n  if (-not $__guid) {{ $__guid=([regex]::Match((powercfg /list | Select-String -SimpleMatch '{v}'),'[0-9a-fA-F-]{{36}}')).Value }}\n  if ($__guid) {{ powercfg /setactive $__guid }} else {{ Write-Warning 'power plan not found: {v}' }}\n}} catch {{ Write-Warning \"power plan failed: $_\" }}\n",
                    v = esc_ps(&it.value)
                ));
            }
            "kill_apps" => {
                for name in it.value.lines().map(str::trim).filter(|l| !l.is_empty()) {
                    s.push_str(&format!(
                        "try {{ Get-Process -Name '{n}' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue }} catch {{ Write-Warning \"kill failed: {n}\" }}\n",
                        n = esc_ps(name)
                    ));
                }
            }
            "start_apps" => {
                for path in it.value.lines().map(str::trim).filter(|l| !l.is_empty()) {
                    s.push_str(&format!(
                        "try {{ Start-Process -FilePath '{p}' -ErrorAction Stop }} catch {{ Write-Warning \"start failed: {p}\" }}\n",
                        p = esc_ps(path)
                    ));
                }
            }
            "dns" => {
                let v = esc_ps(it.value.trim());
                if v.eq_ignore_ascii_case("dhcp") {
                    s.push_str("try { Set-DnsClientServerAddress -InterfaceAlias $__ifc -ResetServerAddresses -ErrorAction Stop } catch { Write-Warning \"dns reset failed: $_\" }\n");
                } else {
                    let ips: Vec<String> =
                        v.split(',').map(|x| format!("'{}'", x.trim())).collect();
                    s.push_str(&format!(
                        "try {{ Set-DnsClientServerAddress -InterfaceAlias $__ifc -ServerAddresses @({}) -ErrorAction Stop }} catch {{ Write-Warning \"dns set failed: $_\" }}\n",
                        ips.join(",")
                    ));
                }
            }
            "audio" => {
                // Best-effort: no built-in cmdlet. Works only if the AudioDeviceCmdlets
                // module is installed. Documented limitation, not a bug.
                s.push_str(&format!(
                    "try {{ Import-Module AudioDeviceCmdlets -ErrorAction Stop; Get-AudioDevice -List | Where-Object {{ $_.Type -eq 'Playback' -and $_.Name -like '*{v}*' }} | Select-Object -First 1 | ForEach-Object {{ Set-AudioDevice -ID $_.ID }} }} catch {{ Write-Warning \"audio device change failed (needs AudioDeviceCmdlets module): $_\" }}\n",
                    v = esc_ps(&it.value)
                ));
            }
            "refresh_rate" => {
                // Best-effort P/Invoke ChangeDisplaySettingsEx — no built-in cmdlet either.
                // Untested on real hardware; wrapped so a failure here can't break the rest.
                s.push_str(&format!(
                    "try {{\n\
  Add-Type -Namespace CTRL -Name Disp -MemberDefinition @'\n\
[StructLayout(LayoutKind.Sequential)] public struct DEVMODE {{\n\
  [MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)] public string dmDeviceName; public short dmSpecVersion,dmDriverVersion,dmSize,dmDriverExtra;\n\
  public int dmFields; public int dmPositionX,dmPositionY; public int dmDisplayOrientation,dmDisplayFixedOutput;\n\
  public short dmColor,dmDuplex,dmYResolution,dmTTOption,dmCollate; [MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)] public string dmFormName;\n\
  public short dmLogPixels; public int dmBitsPerPel,dmPelsWidth,dmPelsHeight,dmDisplayFlags,dmDisplayFrequency,dmICMMethod,dmICMIntent,dmMediaType,dmDitherType,dmReserved1,dmReserved2,dmPanningWidth,dmPanningHeight;\n\
}}\n\
[DllImport(\"user32.dll\")] public static extern bool EnumDisplaySettings(string d,int m,ref DEVMODE dm);\n\
[DllImport(\"user32.dll\")] public static extern int ChangeDisplaySettings(ref DEVMODE dm,int f);\n\
'@\n\
  $__dm=New-Object CTRL.Disp+DEVMODE; $__dm.dmSize=[System.Runtime.InteropServices.Marshal]::SizeOf($__dm)\n\
  [void][CTRL.Disp]::EnumDisplaySettings($null,-1,[ref]$__dm)\n\
  $__dm.dmDisplayFrequency={hz}; $__dm.dmFields=0x400000\n\
  [CTRL.Disp]::ChangeDisplaySettings([ref]$__dm,0) | Out-Null\n\
}} catch {{ Write-Warning \"refresh rate change failed: $_\" }}\n",
                    hz = esc_ps(it.value.trim())
                ));
            }
            "script" => {
                s.push_str(&format!(
                    "try {{\n{}\n}} catch {{ Write-Warning \"custom script failed: $_\" }}\n",
                    it.value
                ));
            }
            _ => {}
        }
    }
    s
}

/// Build the elevated PowerShell script for reverting a snapshot.
fn build_restore_script(snap: &Snapshot) -> String {
    let mut s = String::from(
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8\n$ErrorActionPreference='Continue'\n",
    );
    if !snap.power_plan.is_empty() {
        s.push_str(&format!("try {{ powercfg /setactive {v} }} catch {{ Write-Warning \"power plan restore failed: $_\" }}\n", v = esc_ps(&snap.power_plan)));
    }
    if !snap.dns_interface.is_empty() {
        if snap.dns_servers.is_empty() {
            s.push_str(&format!("try {{ Set-DnsClientServerAddress -InterfaceAlias '{i}' -ResetServerAddresses -ErrorAction Stop }} catch {{ Write-Warning \"dns restore failed: $_\" }}\n", i = esc_ps(&snap.dns_interface)));
        } else {
            let ips: Vec<String> = snap
                .dns_servers
                .split(',')
                .map(|x| format!("'{}'", esc_ps(x.trim())))
                .collect();
            s.push_str(&format!("try {{ Set-DnsClientServerAddress -InterfaceAlias '{i}' -ServerAddresses @({ips}) -ErrorAction Stop }} catch {{ Write-Warning \"dns restore failed: $_\" }}\n", i = esc_ps(&snap.dns_interface), ips = ips.join(",")));
        }
    }
    if !snap.audio_device.is_empty() {
        s.push_str(&format!(
            "try {{ Import-Module AudioDeviceCmdlets -ErrorAction Stop; Get-AudioDevice -List | Where-Object {{ $_.Type -eq 'Playback' -and $_.Name -eq '{v}' }} | Select-Object -First 1 | ForEach-Object {{ Set-AudioDevice -ID $_.ID }} }} catch {{ Write-Warning \"audio restore failed: $_\" }}\n",
            v = esc_ps(&snap.audio_device)
        ));
    }
    for name in snap
        .started_apps
        .split(',')
        .map(str::trim)
        .filter(|l| !l.is_empty())
    {
        s.push_str(&format!("try {{ Get-Process -Name '{n}' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue }} catch {{}}\n", n = esc_ps(name)));
    }
    s
}

struct Snapshot {
    power_plan: String,
    dns_interface: String,
    dns_servers: String,
    audio_device: String,
    started_apps: String,
}

fn parse_snapshot(output: &str) -> Snapshot {
    let mut snap = Snapshot {
        power_plan: String::new(),
        dns_interface: String::new(),
        dns_servers: String::new(),
        audio_device: String::new(),
        started_apps: String::new(),
    };
    for line in output.lines() {
        let Some(rest) = line.trim().strip_prefix("CTRL_SNAP:") else {
            continue;
        };
        let Some((k, v)) = rest.split_once('=') else {
            continue;
        };
        let v = v.trim().to_string();
        match k {
            "power_plan" => snap.power_plan = v,
            "dns_interface" => snap.dns_interface = v,
            "dns" => snap.dns_servers = v,
            "audio" => snap.audio_device = v,
            _ => {}
        }
    }
    snap
}

#[tauri::command]
pub async fn activate_profile(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: i64,
) -> Result<RunResult, String> {
    let (name, items) = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        let name: String = db
            .query_row("SELECT name FROM profiles WHERE id=?1", params![id], |r| {
                r.get(0)
            })
            .map_err(|_| "Profile not found".to_string())?;
        (name, load_items(&db, id)?)
    };

    // Phase 1: capture snapshot non-elevated (stdout reliably returned to Rust).
    let snap_script = build_snapshot_script();
    let snap_out = app
        .shell()
        .command("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &snap_script])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    let snap_stdout = String::from_utf8_lossy(&snap_out.stdout).to_string();
    let mut snap = parse_snapshot(&snap_stdout);
    snap.started_apps = snapshot_started_apps(&items);

    // Phase 2: apply elevated (fire-and-forget -- stdout not captured).
    let apply_script = build_activate_script(&items);
    let result = exec_elevated(&app, &apply_script, &Shell::PowerShell, "profile").await?;

    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO profile_snapshots (profile_id,power_plan,dns_interface,dns_servers,audio_device,started_apps) VALUES (?1,?2,?3,?4,?5,?6)",
        params![id, snap.power_plan, snap.dns_interface, snap.dns_servers, snap.audio_device, snap.started_apps],
    ).map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE profile_state SET active_profile_id=?1, active_since=datetime('now') WHERE id=1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    drop(db);

    if let Err(e) = crate::commands::tray::build_tray(&app) {
        eprintln!("[CTRL] tray rebuild after profile activate failed: {e}");
    }

    let _ = name;
    Ok(result)
}

#[tauri::command]
pub async fn restore_previous(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<RunResult, String> {
    let (profile_id, snap) = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        let profile_id: Option<i64> = db
            .query_row(
                "SELECT active_profile_id FROM profile_state WHERE id=1",
                [],
                |r| r.get(0),
            )
            .ok()
            .flatten();
        let Some(profile_id) = profile_id else {
            return Ok(RunResult {
                success: false,
                output: "No active profile to restore from.".into(),
            });
        };
        let snap = db.query_row(
            "SELECT power_plan,dns_interface,dns_servers,audio_device,started_apps FROM profile_snapshots WHERE profile_id=?1 ORDER BY id DESC LIMIT 1",
            params![profile_id],
            |r| Ok(Snapshot {
                power_plan: r.get(0)?, dns_interface: r.get(1)?, dns_servers: r.get(2)?,
                audio_device: r.get(3)?, started_apps: r.get(4)?,
            }),
        ).map_err(|_| "No snapshot found for the active profile.".to_string())?;
        (profile_id, snap)
    };

    let script = build_restore_script(&snap);
    let result = exec_elevated(&app, &script, &Shell::PowerShell, "profile_restore").await?;

    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE profile_state SET active_profile_id=NULL, active_since=NULL WHERE id=1",
        [],
    )
    .map_err(|e| e.to_string())?;
    drop(db);
    let _ = profile_id;

    if let Err(e) = crate::commands::tray::build_tray(&app) {
        eprintln!("[CTRL] tray rebuild after profile restore failed: {e}");
    }

    Ok(result)
}
