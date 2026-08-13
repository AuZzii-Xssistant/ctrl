# CTRL — Database Schema

SQLite database at `ctrl.db` (next to the exe, portable).  
WAL mode enabled. All tables use `INTEGER PRIMARY KEY` autoincrement IDs.

---

## `tools`

Registered executables and shortcuts.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `name` | TEXT | Display name |
| `category` | TEXT | Grouping label (default: `General`) |
| `path` | TEXT | Full path to exe/lnk/script |
| `args` | TEXT | Optional arguments |
| `tags` | TEXT | Comma-separated |
| `notes` | TEXT | Free-form description |
| `run_as_admin` | INTEGER | 0/1 boolean |
| `created_at` | TEXT | ISO 8601 timestamp |

---

## `scripts`

Registered script files (.ps1, .py, .bat, .cmd).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `name` | TEXT | |
| `description` | TEXT | |
| `category` | TEXT | |
| `file_path` | TEXT | Absolute path to script file |
| `script_type` | TEXT | `ps1` / `py` / `bat` / `cmd` |
| `tags` | TEXT | Comma-separated |
| `status` | TEXT | `active` / `deprecated` / `replaced` |
| `created_at` | TEXT | |

---

## `fixes`

Quick one-click commands.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `name` | TEXT | |
| `description` | TEXT | |
| `category` | TEXT | |
| `shell_type` | TEXT | `powershell` / `cmd` / `python` |
| `command` | TEXT | Inline command string |
| `tags` | TEXT | |
| `created_at` | TEXT | |

---

## `projects`

Project tracking entries.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `name` | TEXT | |
| `description` | TEXT | |
| `type` | TEXT | `script` / `exe` / `experiment` / `tool` / `library` / `workflow` |
| `status` | TEXT | `idea` / `prototype` / `working` / `stable` / `deprecated` / `replaced` |
| `path` | TEXT | Optional folder path |
| `tags` | TEXT | |
| `notes` | TEXT | |
| `created_at` | TEXT | |

---

## `pinned`

Dashboard launchpad pins.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `item_type` | TEXT | `tool` / `script` / `fix` |
| `item_id` | INTEGER | FK into the respective table |
| `group_name` | TEXT | Display group (default: `Pinned`) |
| `sort_order` | INTEGER | Lower = first |

---

## `run_log`

Execution history (scripts and fixes).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `item_type` | TEXT | `script` / `fix` |
| `item_id` | INTEGER | |
| `success` | INTEGER | 0/1 |
| `output` | TEXT | Stdout + stderr |
| `ran_at` | TEXT | ISO 8601 timestamp |
