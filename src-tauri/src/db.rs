use rusqlite::{Connection, Result};

pub fn init(conn: &Connection) -> Result<()> {
    conn.execute_batch("
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys=ON;
    ")?;
    create_tables(conn)?;
    seed_defaults(conn)
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
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            category    TEXT NOT NULL DEFAULT 'General',
            file_path   TEXT NOT NULL,
            script_type TEXT NOT NULL DEFAULT 'ps1',
            tags        TEXT NOT NULL DEFAULT '',
            status      TEXT NOT NULL DEFAULT 'active',
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS fixes (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            name             TEXT NOT NULL,
            description      TEXT NOT NULL DEFAULT '',
            category         TEXT NOT NULL DEFAULT 'General',
            shell_type       TEXT NOT NULL DEFAULT 'powershell',
            command          TEXT NOT NULL,
            tags             TEXT NOT NULL DEFAULT '',
            confirm_required INTEGER NOT NULL DEFAULT 0
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

    conn.execute_batch("
        INSERT INTO fixes (name,description,category,shell_type,command,tags,confirm_required) VALUES
        ('Flush DNS','Clear the DNS resolver cache','Network','powershell','ipconfig /flushdns','dns,network',0),
        ('Release & Renew IP','Release and renew DHCP lease','Network','powershell','ipconfig /release; ipconfig /renew','ip,dhcp,network',0),
        ('Reset TCP/IP Stack','Reset Winsock and TCP/IP','Network','powershell','netsh winsock reset; netsh int ip reset','network,reset',1),
        ('Ping Gateway','Ping default gateway to test connectivity','Network','powershell','$gw=(Get-NetRoute -DestinationPrefix 0.0.0.0/0).NextHop | Select-Object -First 1; ping $gw','ping,network',0),
        ('Clear Temp Files','Delete files in %TEMP%','Maintenance','powershell','Remove-Item -Path $env:TEMP\\* -Recurse -Force -ErrorAction SilentlyContinue','temp,cleanup',0),
        ('Clear Windows Temp','Delete files in C:\\Windows\\Temp','Maintenance','powershell','Remove-Item -Path C:\\Windows\\Temp\\* -Recurse -Force -ErrorAction SilentlyContinue','temp,cleanup',0),
        ('Restart Explorer','Kill and restart Windows Explorer shell','System','powershell','Stop-Process -Name explorer -Force; Start-Process explorer','explorer,shell,ui',0),
        ('Flush Icon Cache','Delete icon cache and restart Explorer','System','powershell','ie4uinit.exe -ClearIconCache; Stop-Process -Name explorer -Force; Start-Process explorer','icons,cache',0),
        ('Kill Process by Name','Kill a process — edit command with target name','System','powershell','Stop-Process -Name notepad -Force -ErrorAction SilentlyContinue','process,kill',0),
        ('SFC Scan','Run System File Checker (takes a few minutes)','Repair','powershell','sfc /scannow','sfc,system,repair',1),
        ('DISM Health Restore','Run DISM to repair the Windows image','Repair','powershell','DISM /Online /Cleanup-Image /RestoreHealth','dism,repair',1),
        ('Check Disk C:','Schedule CHKDSK on C: at next reboot','Repair','cmd','chkdsk C: /f /r','chkdsk,disk',1),
        ('Clear Event Log (System)','Clear the Windows System event log','Maintenance','powershell','Clear-EventLog -LogName System','eventlog,logs',1),
        ('Set High Performance Power','Switch to High Performance power plan','Performance','powershell','powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c','power,performance',0),
        ('Set Balanced Power','Switch back to Balanced power plan','Performance','powershell','powercfg /setactive 381b4222-f694-41f0-9685-ff5bb260df2e','power,balanced',0);
    ")
}
