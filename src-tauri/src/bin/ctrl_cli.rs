// ctrl-cli: CTRL command-line interface
//
// Usage: ctrl-cli [--db PATH] <command> <subcommand> [--flag value ...]
//
// Commands:
//   add project  --name NAME --path PATH [--type TYPE] [--status STATUS] [--tags TAGS] [--notes NOTES]
//   add script   --name NAME --content CONTENT [--file PATH] [--type ps1|py|bat] [--category CAT] [--tags TAGS] [--desc DESC] [--admin]
//   add fix      --name NAME --cmd CMD [--category CAT] [--tags TAGS] [--desc DESC] [--admin] [--confirm]
//   add tweak    --label LABEL --apply CMD [--revert CMD] [--category CAT] [--desc DESC] [--admin]
//   list projects|scripts|fixes|tweaks
//
// The DB is located next to ctrl.exe by default, or override with --db.

use rusqlite::{Connection, params};
use std::collections::HashMap;
use std::path::PathBuf;

fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.len() < 2 {
        print_usage();
        std::process::exit(0);
    }

    let mut rest = args[1..].to_vec();

    // Optional --db flag
    let db_path: PathBuf = if rest.first().map(|s| s.as_str()) == Some("--db") {
        if rest.len() < 2 { eprintln!("--db requires a path"); std::process::exit(1); }
        let p = rest.remove(0); // remove "--db"
        let p2 = rest.remove(0); // remove the path
        drop(p);
        PathBuf::from(p2)
    } else {
        std::env::current_exe().ok()
            .and_then(|e| e.parent().map(|d| d.join("ctrl.db")))
            .unwrap_or_else(|| PathBuf::from("ctrl.db"))
    };

    let conn = Connection::open(&db_path).unwrap_or_else(|e| {
        eprintln!("Cannot open {}: {}", db_path.display(), e);
        std::process::exit(1);
    });

    if rest.len() < 2 {
        print_usage();
        std::process::exit(1);
    }

    let cmd = rest[0].as_str();
    let sub = rest[1].as_str();
    let flags = parse_flags(&rest[2..]);

    match (cmd, sub) {
        ("add",  "project")  => add_project(&conn, flags),
        ("add",  "script")   => add_script(&conn, flags),
        ("add",  "fix")      => add_fix(&conn, flags),
        ("add",  "tweak")    => add_tweak(&conn, flags),
        ("list", "projects") => list_table(&conn,
            "SELECT id,name,type,status,path FROM projects ORDER BY name",
            &["id", "name", "type", "status", "path"]),
        ("list", "scripts")  => list_table(&conn,
            "SELECT id,name,category,script_type,status FROM scripts ORDER BY category,name",
            &["id", "name", "category", "type", "status"]),
        ("list", "fixes")    => list_table(&conn,
            "SELECT id,name,category,command FROM fixes ORDER BY category,name",
            &["id", "name", "category", "command"]),
        ("list", "tweaks")   => list_table(&conn,
            "SELECT id,label,category,apply_cmd FROM custom_tweaks ORDER BY category,label",
            &["id", "label", "category", "apply_cmd"]),
        _ => { eprintln!("Unknown command: {} {}", cmd, sub); print_usage(); std::process::exit(1); }
    }
}

fn print_usage() {
    println!("ctrl-cli — CTRL command-line interface");
    println!();
    println!("Usage: ctrl-cli [--db PATH] <command> <subcommand> [flags]");
    println!();
    println!("Commands:");
    println!("  add project  --name NAME --path PATH [--type TYPE] [--status STATUS] [--tags TAGS] [--notes NOTES]");
    println!("  add script   --name NAME [--content CONTENT] [--file PATH] [--type ps1] [--category CAT] [--tags TAGS] [--desc DESC] [--admin]");
    println!("  add fix      --name NAME --cmd CMD [--category CAT] [--tags TAGS] [--desc DESC] [--admin] [--confirm]");
    println!("  add tweak    --label LABEL --apply CMD [--revert CMD] [--category CAT] [--desc DESC] [--admin]");
    println!("  list projects|scripts|fixes|tweaks");
    println!();
    println!("The DB defaults to ctrl.db next to this binary. Override with --db PATH.");
}

/// Parse --key value pairs. A flag with no following value (or followed by another flag) is set to "true".
fn parse_flags(args: &[String]) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let mut i = 0;
    while i < args.len() {
        if let Some(key) = args[i].strip_prefix("--") {
            if i + 1 < args.len() && !args[i + 1].starts_with("--") {
                map.insert(key.to_string(), args[i + 1].clone());
                i += 2;
            } else {
                map.insert(key.to_string(), "true".to_string());
                i += 1;
            }
        } else {
            i += 1;
        }
    }
    map
}

fn get(map: &HashMap<String, String>, key: &str, default: &str) -> String {
    map.get(key).cloned().unwrap_or_else(|| default.to_string())
}

fn require(map: &HashMap<String, String>, key: &str) -> String {
    map.get(key).cloned().unwrap_or_else(|| {
        eprintln!("Missing required flag: --{}", key);
        std::process::exit(1);
    })
}

fn add_project(conn: &Connection, flags: HashMap<String, String>) {
    let name   = require(&flags, "name");
    let path   = get(&flags, "path", "");
    let kind   = get(&flags, "type", "other");
    let status = get(&flags, "status", "active");
    let tags   = get(&flags, "tags", "");
    let notes  = get(&flags, "notes", "");
    conn.execute(
        "INSERT INTO projects (name,path,type,status,tags,notes) VALUES (?1,?2,?3,?4,?5,?6)",
        params![name, path, kind, status, tags, notes],
    ).unwrap_or_else(|e| { eprintln!("Error: {}", e); std::process::exit(1); });
    println!("✓ Project '{}' added (id={})", name, conn.last_insert_rowid());
}

fn add_script(conn: &Connection, flags: HashMap<String, String>) {
    let name      = require(&flags, "name");
    let content   = flags.get("content").cloned();
    let file_path = get(&flags, "file", "");
    let kind      = get(&flags, "type", "ps1");
    let category  = get(&flags, "category", "General");
    let tags      = get(&flags, "tags", "");
    let desc      = get(&flags, "desc", "");
    let admin     = flags.contains_key("admin") as i64;
    conn.execute(
        "INSERT INTO scripts (name,description,category,file_path,script_type,tags,status,run_as_admin,content) \
         VALUES (?1,?2,?3,?4,?5,?6,'active',?7,?8)",
        params![name, desc, category, file_path, kind, tags, admin, content],
    ).unwrap_or_else(|e| { eprintln!("Error: {}", e); std::process::exit(1); });
    println!("✓ Script '{}' added (id={})", name, conn.last_insert_rowid());
}

fn add_fix(conn: &Connection, flags: HashMap<String, String>) {
    let name     = require(&flags, "name");
    let cmd      = require(&flags, "cmd");
    let category = get(&flags, "category", "General");
    let tags     = get(&flags, "tags", "");
    let desc     = get(&flags, "desc", "");
    let admin    = flags.contains_key("admin") as i64;
    let confirm  = flags.contains_key("confirm") as i64;
    conn.execute(
        "INSERT INTO fixes (name,description,category,shell_type,command,tags,confirm_required,run_as_admin) \
         VALUES (?1,?2,?3,'powershell',?4,?5,?6,?7)",
        params![name, desc, category, cmd, tags, confirm, admin],
    ).unwrap_or_else(|e| { eprintln!("Error: {}", e); std::process::exit(1); });
    println!("✓ Fix '{}' added (id={})", name, conn.last_insert_rowid());
}

fn add_tweak(conn: &Connection, flags: HashMap<String, String>) {
    let label    = require(&flags, "label");
    let apply    = require(&flags, "apply");
    let revert   = get(&flags, "revert", "");
    let category = get(&flags, "category", "Custom");
    let desc     = get(&flags, "desc", "");
    let admin    = flags.contains_key("admin") as i64;
    conn.execute(
        "INSERT INTO custom_tweaks (label,apply_cmd,revert_cmd,category,description,admin) \
         VALUES (?1,?2,?3,?4,?5,?6)",
        params![label, apply, revert, category, desc, admin],
    ).unwrap_or_else(|e| { eprintln!("Error: {}", e); std::process::exit(1); });
    println!("✓ Tweak '{}' added (id={})", label, conn.last_insert_rowid());
}

fn list_table(conn: &Connection, sql: &str, headers: &[&str]) {
    let mut stmt = conn.prepare(sql).unwrap_or_else(|e| {
        eprintln!("Query error: {}", e);
        std::process::exit(1);
    });
    let col_count = headers.len();
    let widths: Vec<usize> = headers.iter().map(|h| h.len().max(6)).collect();
    let header_row: Vec<String> = headers.iter().zip(widths.iter())
        .map(|(h, w)| format!("{:<width$}", h, width = w)).collect();
    println!("{}", header_row.join("  |  "));
    println!("{}", "─".repeat(header_row.join("  |  ").len()));
    let _ = stmt.query_map([], |row| {
        let cols: Vec<String> = (0..col_count).map(|i| {
            row.get::<_, String>(i)
                .or_else(|_| row.get::<_, i64>(i).map(|n| n.to_string()))
                .unwrap_or_default()
        }).collect();
        let formatted: Vec<String> = cols.iter().zip(widths.iter())
            .map(|(c, w)| {
                let truncated = if c.len() > 60 { format!("{}…", &c[..59]) } else { c.clone() };
                format!("{:<width$}", truncated, width = *w)
            }).collect();
        println!("{}", formatted.join("  |  "));
        Ok(())
    }).map(|rows| { for _ in rows {} });
}
