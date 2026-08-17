# CTRL — Database Schema

SQLite database at `ctrl.db` (next to the exe, portable).
WAL mode enabled. All tables use `INTEGER PRIMARY KEY` autoincrement IDs unless noted.

This file reflects `src-tauri/src/db.rs` as of 2026-08-17 (`create_tables()` + all `migrate_*`/`ALTER TABLE` calls run at startup, each independently idempotent).

---

## `tools`

Registered executables and shortcuts (Tools page).

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

The Scripts pane runs entirely on this table via the ScriptStash port (`ss_*` commands, `ss_profiles`/`ss_script_profile` below). A row with no `ss_script_profile` membership and `in_master=1` shows only in Master; membership rows put it in named profiles too.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `name` | TEXT | |
| `description` | TEXT | |
| `category` | TEXT | |
| `file_path` | TEXT | Absolute path — empty if content lives in `content` instead |
| `script_type` | TEXT | `ps1` / `py` / `bat` / `cmd` / `vbs` / `sh` / `js` / `reg` / `ahk` |
| `tags` | TEXT | Comma-separated |
| `status` | TEXT | `active` / `deprecated` / `replaced` |
| `run_as_admin` | INTEGER | 0/1 |
| `content` | TEXT | Script body stored in DB (added for WinScript import; most scripts live here, not on disk) |
| `icon` | TEXT | Data URI, optional |
| `interactive` | INTEGER | 0/1 — "Pause Script": run through the embedded PTY with a pause line appended instead of the old spawn-external-console behavior |
| `master_order` | INTEGER | Sort position in the Master view (default 9999) |
| `master_disabled` | INTEGER | 0/1 — enabled/disabled state within Master |
| `last_run` | TEXT | Unix timestamp of last run, as text |
| `last_status` | TEXT | `never` / `success` / `failed` / `running` |
| `last_error` | TEXT | |
| `in_master` | INTEGER | 0/1 — Master is a real toggleable profile (2026-08-17), not "every script unconditionally". Scripts created on a named profile default to 0 (not auto-added to Master). |
| `created_at` | TEXT | |

## `ss_profiles`

Named script profiles (Master itself is not a row here — it's `in_master=1` on `scripts`).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `name` | TEXT | |
| `sort_order` | INTEGER | |

## `ss_script_profile`

Script ↔ named-profile membership (many-to-many). Composite PK — a script can be in the same profile only once.

| Column | Type | Notes |
|---|---|---|
| `script_id` | INTEGER | |
| `profile_id` | INTEGER | |
| `sort_order` | INTEGER | Position within that profile's list |
| `disabled` | INTEGER | 0/1 — enabled/disabled within that profile (independent of `master_disabled`) |

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
| `confirm_required` | INTEGER | 0/1 — shows a confirm dialog before running |
| `run_as_admin` | INTEGER | 0/1 |

---

## `projects`

Project tracking entries.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `name` | TEXT | |
| `description` | TEXT | |
| `type` | TEXT | `script` / `exe` / `experiment` / `tool` / `library` / `workflow` / `tauri` / `node` / `web` / `rust` / `python` / `other` |
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
| `item_type` | TEXT | `tool` / `script` / `fix` / `project` / `workflow` / `ql` / `app` |
| `item_id` | INTEGER | FK into the respective table (`ql`→`ql_items`, `app`→`external_apps`) |
| `group_name` | TEXT | Display group (default: `Pinned`) |
| `sort_order` | INTEGER | Lower = first, scoped per `group_name` |

---

## `run_log`

Execution history (scripts, fixes, workflows).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `item_type` | TEXT | `script` / `fix` / `workflow` |
| `item_id` | INTEGER | |
| `item_name` | TEXT | Denormalized so history survives the source item being renamed/deleted |
| `exit_code` | INTEGER | 0 = success |
| `output` | TEXT | Combined stdout/stderr, or a formatted multi-step summary for workflows |
| `ran_at` | TEXT | ISO 8601 timestamp |

---

## `workflows`

Multi-step automations (scripts/fixes chained together, plus notify/wait steps).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `name` | TEXT | |
| `description` | TEXT | |
| `steps` | TEXT | JSON array — `[{step_type, item_id?, label, ...}]` |
| `enabled` | INTEGER | 0/1 |
| `trigger_type` | TEXT | `manual` / `startup` / `schedule` |
| `trigger_config` | TEXT | JSON, shape depends on `trigger_type` |
| `last_run_at` | TEXT | |
| `last_run_ok` | INTEGER | 0/1, nullable |
| `created_at` | TEXT | |

---

## `backup_jobs`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `name` | TEXT | |
| `source` | TEXT | |
| `dest` | TEXT | |
| `last_run` | TEXT | |
| `created_at` | TEXT | |

---

## `snippets`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `title` | TEXT | |
| `content` | TEXT | |
| `category` | TEXT | Default `General` |
| `tags` | TEXT | |
| `created_at` | TEXT | |

---

## `external_apps`

Simple name+path launch targets, used by the Dashboard pin picker's "App" type. (The Tools page's own "Apps" section, which duplicated this, was removed 2026-08-17 — Add Tool covers the same need with more fields.)

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `name` | TEXT | |
| `path` | TEXT | |
| `created_at` | TEXT | |

## `ql_items`

Quick Launch — Windows shell shortcuts (`ms-settings:`, `.cpl` files, etc). Seeded with ~23 built-ins on first run.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `label` | TEXT | |
| `icon` | TEXT | Tabler icon class, default `ti-rocket` |
| `cmd` | TEXT | Shell command/protocol string |

## `custom_tweaks`

User-defined system tweaks (Tweaks page, alongside the built-in ones which aren't DB-backed).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `category` | TEXT | Default `Custom` |
| `label` | TEXT | |
| `description` | TEXT | |
| `apply_cmd` | TEXT | |
| `revert_cmd` | TEXT | |
| `admin` | INTEGER | 0/1 |
| `sort_order` | INTEGER | |
