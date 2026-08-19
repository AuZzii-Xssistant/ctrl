// ctrl-cli: CTRL command-line interface
//
// Usage: ctrl-cli [--db PATH] <command> <subcommand> [--flag value ...]
//
// Commands:
//   add project  --name NAME --path PATH [--type TYPE] [--status STATUS] [--tags TAGS] [--notes NOTES]
//   add script   --name NAME --content CONTENT [--file PATH] [--type ps1|py|bat] [--category CAT] [--tags TAGS] [--desc DESC] [--admin] [--pause]
//                (always lands in Master — no CLI support yet for assigning to a named Scripts profile)
//   add fix      --name NAME --cmd CMD [--category CAT] [--tags TAGS] [--desc DESC] [--admin] [--confirm]
//   add tweak    --label LABEL --apply CMD [--revert CMD] [--category CAT] [--desc DESC] [--admin]
//   add tool     --name NAME --path PATH [--category CAT] [--tags TAGS] [--desc DESC]
//   add snippet  --title TITLE --content CONTENT [--category CAT] [--tags TAGS]
//   add backup   --name NAME --source PATH --dest PATH
//   add workflow --name NAME --desc DESC [--steps JSON]
//   update project|script|fix|tweak|tool|snippet --id N [--field value ...]
//   list projects|scripts|fixes|tweaks|tools|snippets|backups|workflows
//
// The DB is located next to ctrl.exe by default, or override with --db.

use rusqlite::{params, Connection};
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
        if rest.len() < 2 {
            eprintln!("--db requires a path");
            std::process::exit(1);
        }
        let p = rest.remove(0); // remove "--db"
        let p2 = rest.remove(0); // remove the path
        drop(p);
        PathBuf::from(p2)
    } else {
        std::env::current_exe()
            .ok()
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
        ("add", "project") => add_project(&conn, flags),
        ("add", "script") => add_script(&conn, flags),
        ("add", "fix") => add_fix(&conn, flags),
        ("add", "tweak") => add_tweak(&conn, flags),
        ("add", "tool") => add_tool(&conn, flags),
        ("add", "snippet") => add_snippet(&conn, flags),
        ("add", "backup") => add_backup(&conn, flags),
        ("add", "workflow") => add_workflow(&conn, flags),
        ("update", "project") => update_project(&conn, flags),
        ("update", "script") => update_field(&conn, "scripts", "name", &flags),
        ("update", "fix") => update_field(&conn, "fixes", "name", &flags),
        ("update", "tweak") => update_field(&conn, "custom_tweaks", "label", &flags),
        ("update", "tool") => update_field(&conn, "tools", "name", &flags),
        ("update", "snippet") => update_field(&conn, "snippets", "title", &flags),
        ("list", "projects") => list_table(
            &conn,
            "SELECT id,name,type,status,path FROM projects ORDER BY name",
            &["id", "name", "type", "status", "path"],
        ),
        ("list", "scripts") => list_table(
            &conn,
            "SELECT id,name,category,script_type,status FROM scripts ORDER BY category,name",
            &["id", "name", "category", "type", "status"],
        ),
        ("list", "fixes") => list_table(
            &conn,
            "SELECT id,name,category,command FROM fixes ORDER BY category,name",
            &["id", "name", "category", "command"],
        ),
        ("list", "tweaks") => list_table(
            &conn,
            "SELECT id,label,category,apply_cmd FROM custom_tweaks ORDER BY category,label",
            &["id", "label", "category", "apply_cmd"],
        ),
        ("list", "tools") => list_table(
            &conn,
            "SELECT id,name,category,path FROM tools ORDER BY category,name",
            &["id", "name", "category", "path"],
        ),
        ("list", "snippets") => list_table(
            &conn,
            "SELECT id,title,category,tags FROM snippets ORDER BY category,title",
            &["id", "title", "category", "tags"],
        ),
        ("list", "backups") => list_table(
            &conn,
            "SELECT id,name,source,dest FROM backup_jobs ORDER BY name",
            &["id", "name", "source", "dest"],
        ),
        ("list", "workflows") => list_table(
            &conn,
            "SELECT id,name,description FROM workflows ORDER BY name",
            &["id", "name", "description"],
        ),
        _ => {
            eprintln!("Unknown command: {} {}", cmd, sub);
            print_usage();
            std::process::exit(1);
        }
    }
}

fn print_usage() {
    println!("ctrl-cli — CTRL command-line interface");
    println!();
    println!("Usage: ctrl-cli [--db PATH] <command> <subcommand> [flags]");
    println!();
    println!("Commands:");
    println!("  add project  --name NAME --path PATH [--type TYPE] [--status STATUS] [--tags TAGS] [--notes NOTES]");
    println!("  add script   --name NAME [--content CONTENT] [--file PATH] [--type ps1] [--category CAT] [--tags TAGS] [--desc DESC] [--admin] [--pause]");
    println!("  add fix      --name NAME --cmd CMD [--category CAT] [--tags TAGS] [--desc DESC] [--admin] [--confirm]");
    println!("  add tweak    --label LABEL --apply CMD [--revert CMD] [--category CAT] [--desc DESC] [--admin]");
    println!("  add tool     --name NAME --path PATH [--category CAT] [--tags TAGS] [--desc DESC]");
    println!("  add snippet  --title TITLE --content CONTENT [--category CAT] [--tags TAGS]");
    println!("  add backup   --name NAME --source PATH --dest PATH");
    println!("  add workflow --name NAME [--desc DESC] [--steps JSON]");
    println!("  update project|script|fix|tweak|tool|snippet --id N [--field value ...]");
    println!("  list projects|scripts|fixes|tweaks|tools|snippets|backups|workflows");
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

fn update_project(conn: &Connection, flags: HashMap<String, String>) {
    let id: i64 = require(&flags, "id").parse().unwrap_or_else(|_| {
        eprintln!("--id must be a number");
        std::process::exit(1);
    });
    // Fetch current values, patch only what was provided
    let (name, desc, kind, status, path, tags, notes): (
        String,
        String,
        String,
        String,
        String,
        String,
        String,
    ) = conn
        .query_row(
            "SELECT name,description,type,status,path,tags,notes FROM projects WHERE id=?1",
            [id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                ))
            },
        )
        .unwrap_or_else(|_| {
            eprintln!("No project with id={}", id);
            std::process::exit(1);
        });
    let name = flags.get("name").cloned().unwrap_or(name);
    let desc = flags.get("desc").cloned().unwrap_or(desc);
    let kind = flags.get("type").cloned().unwrap_or(kind);
    let status = flags.get("status").cloned().unwrap_or(status);
    let path = flags.get("path").cloned().unwrap_or(path);
    let tags = flags.get("tags").cloned().unwrap_or(tags);
    let notes = flags.get("notes").cloned().unwrap_or(notes);
    conn.execute(
        "UPDATE projects SET name=?1,description=?2,type=?3,status=?4,path=?5,tags=?6,notes=?7 WHERE id=?8",
        params![name, desc, kind, status, path, tags, notes, id],
    ).unwrap_or_else(|e| { eprintln!("Error: {}", e); std::process::exit(1); });
    println!("✓ Project {} updated", id);
}

/// Generic single-column patch for scripts/fixes/tweaks (update --id N --field value)
fn update_field(conn: &Connection, table: &str, _name_col: &str, flags: &HashMap<String, String>) {
    let id: i64 = require(flags, "id").parse().unwrap_or_else(|_| {
        eprintln!("--id must be a number");
        std::process::exit(1);
    });
    let mut updated = 0usize;
    for (key, val) in flags {
        if key == "id" {
            continue;
        }
        let sql = format!("UPDATE {} SET {}=?1 WHERE id=?2", table, key);
        match conn.execute(&sql, params![val, id]) {
            Ok(n) if n > 0 => updated += 1,
            Ok(_) => eprintln!("No row with id={} in {}", id, table),
            Err(e) => eprintln!("Error updating {}: {}", key, e),
        }
    }
    if updated > 0 {
        println!("✓ {} row {} updated ({} field(s))", table, id, updated);
    }
}

fn add_project(conn: &Connection, flags: HashMap<String, String>) {
    let name = require(&flags, "name");
    let path = get(&flags, "path", "");
    let kind = get(&flags, "type", "other");
    // "active" was never a valid status (see README's enumerated list / projects.js's
    // STATUS_ORDER) -- a project added without --status silently became invisible in
    // the GUI, since the render loop only walks the known status groups.
    let status = get(&flags, "status", "idea");
    let tags = get(&flags, "tags", "");
    let notes = get(&flags, "notes", "");
    conn.execute(
        "INSERT INTO projects (name,path,type,status,tags,notes) VALUES (?1,?2,?3,?4,?5,?6)",
        params![name, path, kind, status, tags, notes],
    )
    .unwrap_or_else(|e| {
        eprintln!("Error: {}", e);
        std::process::exit(1);
    });
    println!(
        "✓ Project '{}' added (id={})",
        name,
        conn.last_insert_rowid()
    );
}

fn add_script(conn: &Connection, flags: HashMap<String, String>) {
    let name = require(&flags, "name");
    let content = flags.get("content").cloned();
    let file_path = get(&flags, "file", "");
    let kind = get(&flags, "type", "ps1");
    let category = get(&flags, "category", "General");
    let tags = get(&flags, "tags", "");
    let desc = get(&flags, "desc", "");
    let admin = flags.contains_key("admin") as i64;
    let pause = flags.contains_key("pause") as i64;
    conn.execute(
        "INSERT INTO scripts (name,description,category,file_path,script_type,tags,status,run_as_admin,interactive,content) \
         VALUES (?1,?2,?3,?4,?5,?6,'active',?7,?8,?9)",
        params![name, desc, category, file_path, kind, tags, admin, pause, content],
    ).unwrap_or_else(|e| { eprintln!("Error: {}", e); std::process::exit(1); });
    println!(
        "✓ Script '{}' added (id={})",
        name,
        conn.last_insert_rowid()
    );
    println!("  Note: lands in Master only — assigning to a named Scripts profile isn't supported via the CLI yet, use the app's Manage Profiles.");
}

fn add_fix(conn: &Connection, flags: HashMap<String, String>) {
    let name = require(&flags, "name");
    let cmd = require(&flags, "cmd");
    let category = get(&flags, "category", "General");
    let tags = get(&flags, "tags", "");
    let desc = get(&flags, "desc", "");
    let admin = flags.contains_key("admin") as i64;
    let confirm = flags.contains_key("confirm") as i64;
    conn.execute(
        "INSERT INTO fixes (name,description,category,shell_type,command,tags,confirm_required,run_as_admin) \
         VALUES (?1,?2,?3,'powershell',?4,?5,?6,?7)",
        params![name, desc, category, cmd, tags, confirm, admin],
    ).unwrap_or_else(|e| { eprintln!("Error: {}", e); std::process::exit(1); });
    println!("✓ Fix '{}' added (id={})", name, conn.last_insert_rowid());
}

fn add_tweak(conn: &Connection, flags: HashMap<String, String>) {
    let label = require(&flags, "label");
    let apply = require(&flags, "apply");
    let revert = get(&flags, "revert", "");
    let category = get(&flags, "category", "Custom");
    let desc = get(&flags, "desc", "");
    let admin = flags.contains_key("admin") as i64;
    conn.execute(
        "INSERT INTO custom_tweaks (label,apply_cmd,revert_cmd,category,description,admin) \
         VALUES (?1,?2,?3,?4,?5,?6)",
        params![label, apply, revert, category, desc, admin],
    )
    .unwrap_or_else(|e| {
        eprintln!("Error: {}", e);
        std::process::exit(1);
    });
    println!(
        "✓ Tweak '{}' added (id={})",
        label,
        conn.last_insert_rowid()
    );
}

fn add_tool(conn: &Connection, flags: HashMap<String, String>) {
    let name = require(&flags, "name");
    let path = require(&flags, "path");
    let category = get(&flags, "category", "General");
    let tags = get(&flags, "tags", "");
    let notes = get(&flags, "desc", "");
    conn.execute(
        "INSERT INTO tools (name,category,path,tags,notes) VALUES (?1,?2,?3,?4,?5)",
        params![name, category, path, tags, notes],
    )
    .unwrap_or_else(|e| {
        eprintln!("Error: {}", e);
        std::process::exit(1);
    });
    println!("✓ Tool '{}' added (id={})", name, conn.last_insert_rowid());
}

fn add_snippet(conn: &Connection, flags: HashMap<String, String>) {
    let title = require(&flags, "title");
    let content = require(&flags, "content");
    let category = get(&flags, "category", "General");
    let tags = get(&flags, "tags", "");
    conn.execute(
        "INSERT INTO snippets (title,content,category,tags) VALUES (?1,?2,?3,?4)",
        params![title, content, category, tags],
    )
    .unwrap_or_else(|e| {
        eprintln!("Error: {}", e);
        std::process::exit(1);
    });
    println!(
        "✓ Snippet '{}' added (id={})",
        title,
        conn.last_insert_rowid()
    );
}

fn add_backup(conn: &Connection, flags: HashMap<String, String>) {
    let name = require(&flags, "name");
    let source = require(&flags, "source");
    let dest = require(&flags, "dest");
    conn.execute(
        "INSERT INTO backup_jobs (name,source,dest) VALUES (?1,?2,?3)",
        params![name, source, dest],
    )
    .unwrap_or_else(|e| {
        eprintln!("Error: {}", e);
        std::process::exit(1);
    });
    println!(
        "✓ Backup job '{}' added (id={})",
        name,
        conn.last_insert_rowid()
    );
}

fn add_workflow(conn: &Connection, flags: HashMap<String, String>) {
    let name = require(&flags, "name");
    let desc = get(&flags, "desc", "");
    let steps = get(&flags, "steps", "[]");
    if let Err(e) = serde_json::from_str::<serde_json::Value>(&steps) {
        eprintln!("--steps must be valid JSON: {}", e);
        std::process::exit(1);
    }
    conn.execute(
        "INSERT INTO workflows (name,description,steps) VALUES (?1,?2,?3)",
        params![name, desc, steps],
    )
    .unwrap_or_else(|e| {
        eprintln!("Error: {}", e);
        std::process::exit(1);
    });
    println!(
        "✓ Workflow '{}' added (id={})",
        name,
        conn.last_insert_rowid()
    );
}

fn list_table(conn: &Connection, sql: &str, headers: &[&str]) {
    let mut stmt = conn.prepare(sql).unwrap_or_else(|e| {
        eprintln!("Query error: {}", e);
        std::process::exit(1);
    });
    let col_count = headers.len();
    let widths: Vec<usize> = headers.iter().map(|h| h.len().max(6)).collect();
    let header_row: Vec<String> = headers
        .iter()
        .zip(widths.iter())
        .map(|(h, w)| format!("{:<width$}", h, width = w))
        .collect();
    println!("{}", header_row.join("  |  "));
    println!("{}", "─".repeat(header_row.join("  |  ").len()));
    let _ = stmt
        .query_map([], |row| {
            let cols: Vec<String> = (0..col_count)
                .map(|i| {
                    row.get::<_, String>(i)
                        .or_else(|_| row.get::<_, i64>(i).map(|n| n.to_string()))
                        .unwrap_or_default()
                })
                .collect();
            let formatted: Vec<String> = cols
                .iter()
                .zip(widths.iter())
                .map(|(c, w)| {
                    let truncated = if c.len() > 60 {
                        format!("{}…", &c[..59])
                    } else {
                        c.clone()
                    };
                    format!("{:<width$}", truncated, width = *w)
                })
                .collect();
            println!("{}", formatted.join("  |  "));
            Ok(())
        })
        .map(|rows| for _ in rows {});
}
