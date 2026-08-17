use rusqlite::{Connection, Result};

pub fn init(conn: &Connection) -> Result<()> {
    conn.execute_batch("
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys=ON;
    ")?;
    create_tables(conn)?;
    migrate(conn)?;
    migrate_scriptstash(conn)?;
    seed_defaults(conn)
}

/// Idempotent schema migrations for databases created before columns were added.
fn migrate(conn: &Connection) -> Result<()> {
    // Fixes: run_as_admin column (added Major Upgrade 5)
    let _ = conn.execute("ALTER TABLE fixes ADD COLUMN run_as_admin INTEGER NOT NULL DEFAULT 0", []);
    // Scripts: run_as_admin column (added Major Upgrade 5)
    let _ = conn.execute("ALTER TABLE scripts ADD COLUMN run_as_admin INTEGER NOT NULL DEFAULT 0", []);
    // Scripts: inline content stored in DB (file_path becomes optional)
    let _ = conn.execute("ALTER TABLE scripts ADD COLUMN content TEXT", []);
    // Snippets table (added Major Upgrade 8)
    let _ = conn.execute("CREATE TABLE IF NOT EXISTS snippets (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        title      TEXT NOT NULL,
        content    TEXT NOT NULL DEFAULT '',
        category   TEXT NOT NULL DEFAULT 'General',
        tags       TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )", []);
    // Release & Renew IP needs admin (requires elevated network access on some systems)
    let _ = conn.execute("UPDATE fixes SET run_as_admin=1 WHERE name='Release & Renew IP' AND run_as_admin=0", []);
    // Fix Restart Explorer — needs -ErrorAction SilentlyContinue on Stop-Process
    let _ = conn.execute(
        "UPDATE fixes SET command='Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue; Start-Process explorer' WHERE name='Restart Explorer' AND command NOT LIKE '%-ErrorAction%'",
        [],
    );
    // Fix outdated Flush Icon Cache command (ie4uinit doesn't work on Win10/11)
    let _ = conn.execute(
        "UPDATE fixes SET command=?1, description=?2 WHERE name='Flush Icon Cache'",
        rusqlite::params![
            "Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue; Remove-Item -Path \"$env:LOCALAPPDATA\\Microsoft\\Windows\\Explorer\\iconcache*.db\" -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2; Start-Process explorer",
            "Delete icon cache DBs and restart Explorer (Win10/11)"
        ],
    );
    // Scripts: icon stored as data URI (added for WinScript import)
    let _ = conn.execute("ALTER TABLE scripts ADD COLUMN icon TEXT NOT NULL DEFAULT ''", []);
    // Workflows: triggers, enable/disable, run tracking
    let _ = conn.execute("ALTER TABLE workflows ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1", []);
    let _ = conn.execute("ALTER TABLE workflows ADD COLUMN trigger_type TEXT NOT NULL DEFAULT 'manual'", []);
    let _ = conn.execute("ALTER TABLE workflows ADD COLUMN trigger_config TEXT NOT NULL DEFAULT '{}'", []);
    let _ = conn.execute("ALTER TABLE workflows ADD COLUMN last_run_at TEXT", []);
    let _ = conn.execute("ALTER TABLE workflows ADD COLUMN last_run_ok INTEGER", []);
    // External apps table (added Loop 12)
    let _ = conn.execute("CREATE TABLE IF NOT EXISTS external_apps (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        path       TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )", []);
    // Quick Launch items table — seeded once, used for search + pinning
    let _ = conn.execute("CREATE TABLE IF NOT EXISTS ql_items (
        id    INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL,
        icon  TEXT NOT NULL DEFAULT 'ti-rocket',
        cmd   TEXT NOT NULL
    )", []);
    // Seed QL items if empty
    let ql_count: i64 = conn.query_row("SELECT COUNT(*) FROM ql_items", [], |r| r.get(0)).unwrap_or(0);
    if ql_count == 0 {
        let _ = conn.execute_batch("
            INSERT INTO ql_items (label,icon,cmd) VALUES
            ('Windows Settings','ti-settings','ms-settings:'),
            ('Control Panel','ti-layout-grid','control'),
            ('System Properties','ti-server','sysdm.cpl'),
            ('MSConfig','ti-adjustments','msconfig'),
            ('Task Manager','ti-activity','taskmgr'),
            ('Registry Editor','ti-database','regedit'),
            ('Device Manager','ti-cpu','devmgmt.msc'),
            ('Disk Management','ti-device-floppy','diskmgmt.msc'),
            ('Computer Management','ti-building','compmgmt.msc'),
            ('Mouse Properties','ti-mouse','main.cpl'),
            ('Sound Settings','ti-volume','mmsys.cpl'),
            ('Region','ti-world','intl.cpl'),
            ('Time and Date','ti-clock','timedate.cpl'),
            ('Network Connections','ti-network','ncpa.cpl'),
            ('Firewall','ti-shield','firewall.cpl'),
            ('Security & Maint.','ti-shield-check','wscui.cpl'),
            ('Programs & Features','ti-package','appwiz.cpl'),
            ('Printers','ti-printer','shell:PrintersFolder'),
            ('Power Options','ti-bolt','powercfg.cpl'),
            ('Virtual Memory','ti-layers-subtract','SystemPropertiesAdvanced'),
            ('Visual Effects','ti-eye','SystemPropertiesPerformance'),
            ('System Restore','ti-history','rstrui.exe'),
            ('Windows Update','ti-refresh','ms-settings:windowsupdate');
        ");
    }
    // Scripts: interactive flag (opens visible terminal window, ScriptStash port)
    let _ = conn.execute("ALTER TABLE scripts ADD COLUMN interactive INTEGER NOT NULL DEFAULT 0", []);
    // ScriptStash profiles
    let _ = conn.execute("CREATE TABLE IF NOT EXISTS ss_profiles (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
    )", []);
    let _ = conn.execute("CREATE TABLE IF NOT EXISTS ss_script_profile (
        script_id  INTEGER NOT NULL,
        profile_id INTEGER NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        disabled   INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (script_id, profile_id)
    )", []);
    // Custom tweaks table (added Loop 11)
    let _ = conn.execute("CREATE TABLE IF NOT EXISTS custom_tweaks (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        category    TEXT NOT NULL DEFAULT 'Custom',
        label       TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        apply_cmd   TEXT NOT NULL DEFAULT '',
        revert_cmd  TEXT NOT NULL DEFAULT '',
        admin       INTEGER NOT NULL DEFAULT 0,
        sort_order  INTEGER NOT NULL DEFAULT 0
    )", []);
    Ok(())
}

fn create_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS tools (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            category    TEXT NOT NULL DEFAULT 'General',
            path        TEXT NOT NULL,
            args        TEXT NOT NULL DEFAULT '',
            tags        TEXT NOT NULL DEFAULT '',
            notes       TEXT NOT NULL DEFAULT '',
            run_as_admin INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS scripts (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            name         TEXT NOT NULL,
            description  TEXT NOT NULL DEFAULT '',
            category     TEXT NOT NULL DEFAULT 'General',
            file_path    TEXT NOT NULL,
            script_type  TEXT NOT NULL DEFAULT 'ps1',
            tags         TEXT NOT NULL DEFAULT '',
            status       TEXT NOT NULL DEFAULT 'active',
            run_as_admin INTEGER NOT NULL DEFAULT 0,
            created_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS fixes (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            name             TEXT NOT NULL,
            description      TEXT NOT NULL DEFAULT '',
            category         TEXT NOT NULL DEFAULT 'General',
            shell_type       TEXT NOT NULL DEFAULT 'powershell',
            command          TEXT NOT NULL,
            tags             TEXT NOT NULL DEFAULT '',
            confirm_required INTEGER NOT NULL DEFAULT 0,
            run_as_admin     INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS projects (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            type        TEXT NOT NULL DEFAULT 'script',
            status      TEXT NOT NULL DEFAULT 'idea',
            path        TEXT NOT NULL DEFAULT '',
            tags        TEXT NOT NULL DEFAULT '',
            notes       TEXT NOT NULL DEFAULT '',
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS pinned (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            item_type   TEXT NOT NULL,
            item_id     INTEGER NOT NULL,
            group_name  TEXT NOT NULL DEFAULT 'Pinned',
            sort_order  INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS run_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            item_type   TEXT NOT NULL,
            item_id     INTEGER,
            item_name   TEXT,
            exit_code   INTEGER,
            output      TEXT,
            ran_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS workflows (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            steps       TEXT NOT NULL DEFAULT '[]',
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS backup_jobs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            source      TEXT NOT NULL,
            dest        TEXT NOT NULL,
            last_run    TEXT,
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
    ")
}

fn seed_defaults(conn: &Connection) -> Result<()> {
    // Only seed if fixes table is empty (fresh install)
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM fixes", [], |r| r.get(0))?;
    if count > 0 { return Ok(()); }

    // columns: name, description, category, shell_type, command, tags, confirm_required, run_as_admin
    conn.execute_batch("
        INSERT INTO fixes (name,description,category,shell_type,command,tags,confirm_required,run_as_admin) VALUES
        ('Flush DNS','Clear the DNS resolver cache','Network','powershell','ipconfig /flushdns','dns,network',0,0),
        ('Release & Renew IP','Release and renew DHCP lease','Network','powershell','ipconfig /release; ipconfig /renew','ip,dhcp,network',0,1),
        ('Reset TCP/IP Stack','Reset Winsock and TCP/IP','Network','powershell','netsh winsock reset; netsh int ip reset','network,reset',1,1),
        ('Ping Gateway','Ping default gateway to test connectivity','Network','powershell','$gw=(Get-NetRoute -DestinationPrefix 0.0.0.0/0).NextHop | Select-Object -First 1; ping $gw','ping,network',0,0),
        ('Clear Temp Files','Delete files in %TEMP%','Maintenance','powershell','Remove-Item -Path $env:TEMP\\* -Recurse -Force -ErrorAction SilentlyContinue','temp,cleanup',0,0),
        ('Clear Windows Temp','Delete files in C:\\Windows\\Temp','Maintenance','powershell','Remove-Item -Path C:\\Windows\\Temp\\* -Recurse -Force -ErrorAction SilentlyContinue','temp,cleanup',0,1),
        ('Restart Explorer','Kill and restart Windows Explorer shell','System','powershell','Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue; Start-Process explorer','explorer,shell,ui',0,0),
        ('Flush Icon Cache','Delete icon cache DBs and restart Explorer (Win10/11)','System','powershell','Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue; Remove-Item -Path \"$env:LOCALAPPDATA\\Microsoft\\Windows\\Explorer\\iconcache*.db\" -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2; Start-Process explorer','icons,cache',0,0),
        ('Kill Process by Name','Kill a process — edit command with target name','System','powershell','Stop-Process -Name notepad -Force -ErrorAction SilentlyContinue','process,kill',0,0),
        ('SFC Scan','Run System File Checker (takes a few minutes)','Repair','powershell','sfc /scannow','sfc,system,repair',1,1),
        ('DISM Health Restore','Run DISM to repair the Windows image','Repair','powershell','DISM /Online /Cleanup-Image /RestoreHealth','dism,repair',1,1),
        ('Check Disk C:','Schedule CHKDSK on C: at next reboot','Repair','cmd','chkdsk C: /f /r','chkdsk,disk',1,1),
        ('Clear Event Log (System)','Clear the Windows System event log','Maintenance','powershell','Clear-EventLog -LogName System','eventlog,logs',1,1),
        ('Set High Performance Power','Switch to High Performance power plan','Performance','powershell','powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c','power,performance',0,1),
        ('Set Balanced Power','Switch back to Balanced power plan','Performance','powershell','powercfg /setactive 381b4222-f694-41f0-9685-ff5bb260df2e','power,balanced',0,1);
    ")
}

// ScriptStash state columns on scripts (added ScriptStash port v2)
fn migrate_scriptstash(conn: &Connection) -> Result<()> {
    let _ = conn.execute("ALTER TABLE scripts ADD COLUMN master_order INTEGER NOT NULL DEFAULT 9999", []);
    let _ = conn.execute("ALTER TABLE scripts ADD COLUMN master_disabled INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE scripts ADD COLUMN last_run TEXT", []);
    let _ = conn.execute("ALTER TABLE scripts ADD COLUMN last_status TEXT NOT NULL DEFAULT 'never'", []);
    let _ = conn.execute("ALTER TABLE scripts ADD COLUMN last_error TEXT", []);
    // Master is a real, toggleable profile — not "every script unconditionally".
    let _ = conn.execute("ALTER TABLE scripts ADD COLUMN in_master INTEGER NOT NULL DEFAULT 1", []);
    Ok(())
}
