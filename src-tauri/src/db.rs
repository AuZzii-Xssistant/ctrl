use rusqlite::{Connection, Result};

pub fn init(conn: &Connection) -> Result<()> {
    conn.execute_batch("
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys=ON;

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
