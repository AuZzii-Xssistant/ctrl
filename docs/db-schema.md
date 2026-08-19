# >_ CTRL — Database Schema

SQLite database at `ctrl.db` (next to the exe, portable).
WAL mode enabled. All tables use `INTEGER PRIMARY KEY` autoincrement IDs unless noted.

This file reflects `src-tauri/src/db.rs` as of 2026-08-19 (`create_tables()` + all `migrate_*`/`ALTER TABLE` calls run at startup, each independently idempotent).

**A note on timestamp columns:** every `created_at`, `ran_at`, `last_run(_at)`, `captured_at`, `active_since` — any `TEXT` column holding a "when did this happen" value — is populated via SQL's `datetime('now')` unless its row explicitly says otherwise (e.g. `scripts.last_run`, which is a Unix-epoch-seconds string, not this format). `datetime('now')` produces `"YYYY-MM-DD HH:MM:SS"` — UTC, but **not** true ISO 8601 (no `T` separator, no timezone marker). `new Date()` in JS parses that exact format as *local* time, not UTC, which was a real bug (see `docs/known-issues.md`'s "Every 'X ago' timestamp..." entry) — any frontend code reading one of these columns must convert via `isoStr.replace(' ', 'T') + 'Z'` before parsing, the way `timeAgo()` in `src/app.js` now does.

---

## `app_meta`

Generic key/value table. Currently used only to track which pre-shipped default batches have been seeded at least once — `ql_items_seeded`, `fixes_seeded` — independent of current row count, so a user who deletes every seeded row doesn't get them silently recreated on the next launch. See `db::was_seeded`/`db::mark_seeded`.

| Column | Type | Notes |
|---|---|---|
| `key` | TEXT PK | e.g. `ql_items_seeded` |
| `value` | TEXT | always `'1'` currently — presence of the row is what matters, not the value |

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
| `created_at` | TEXT | SQLite datetime string, UTC (see note above) |

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

Quick one-click commands. Seeded once ever (tracked via `app_meta`, not row count) — deleting them all doesn't bring them back.

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
| `ran_at` | TEXT | SQLite datetime string, UTC (see note above) |

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

Quick Launch — Windows shell shortcuts (`ms-settings:`, `.cpl` files, etc). Seeded with ~23 built-ins once ever (tracked via `app_meta`, not row count — deleting them all doesn't bring them back). Deletable via `delete_ql_item`, right-click a pill or its hover ✕.

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

---

## `profiles`

Named System Profiles (Roadmap item 3) — a machine-state preset activated as a whole.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `name` | TEXT | |
| `description` | TEXT | |
| `icon` | TEXT | Tabler icon class, default `ti-user-cog` |
| `created_at` | TEXT | SQLite datetime string, UTC (see note above) |

## `profile_items`

One row per setting type per profile. `ON DELETE CASCADE` from `profiles`.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `profile_id` | INTEGER | FK → `profiles.id`, cascades on delete |
| `item_type` | TEXT | `power_plan` / `kill_apps` / `start_apps` / `dns` / `audio` / `refresh_rate` / `script` |
| `value` | TEXT | Format depends on `item_type` — see below |
| `enabled` | INTEGER | 0/1, toggled per item without deleting it |

`value` format per `item_type`:
- `power_plan` — powercfg plan GUID or a name substring (resolved via `powercfg /list` at activation time)
- `kill_apps` — newline-separated process names, passed to `Stop-Process -Name`
- `start_apps` — newline-separated paths/commands, passed to `Start-Process`
- `dns` — `dhcp` (reset to DHCP) or comma-separated DNS server IPs
- `audio` — playback device name substring (best-effort — see `docs/known-issues.md`)
- `refresh_rate` — target Hz, must parse as a non-negative integer or the item is skipped with a warning at activation (best-effort even when valid — see `docs/known-issues.md`)
- `script` — raw custom PowerShell block, runs last, elevated

## `profile_snapshots`

Pre-activation state, captured fresh on every `activate_profile` call (not reused from an earlier activation), so `restore_previous` always reverts to what was actually running.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `profile_id` | INTEGER | FK → `profiles.id`, cascades on delete |
| `power_plan` | TEXT | Active plan GUID before activation |
| `dns_interface` | TEXT | Interface alias the DNS snapshot/restore targets |
| `dns_servers` | TEXT | Comma-separated IPs, empty = was DHCP |
| `audio_device` | TEXT | Playback device name before activation (empty if unreadable) |
| `started_apps` | TEXT | Comma-separated process names the profile itself started, for revert-by-stopping |
| `captured_at` | TEXT | SQLite datetime string, UTC (see note above) |

## `profile_state`

Single-row table (`id` fixed at 1) tracking which profile is currently active — drives the topbar chip, tray line, and `restore_previous`. Persists across restarts since it travels with the portable `ctrl.db`.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Always `1` (`CHECK (id = 1)`) |
| `active_profile_id` | INTEGER | NULL when no profile is active |
| `active_since` | TEXT | SQLite datetime string, UTC (see note above), NULL when inactive |

## `watchers` (unused — feature removed 2026-08-18)

Schema kept for the additive-migrations-only convention; `commands/watchers.rs` and its scheduler were deleted, nothing reads or writes this table anymore. See `docs/known-issues.md` and `docs/ROADMAP.md` item 4.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `name` | TEXT | |
| `condition_type` | TEXT | was `disk_below` \| `process_down` \| `cpu_sustained` |
| `condition_config` | TEXT | JSON, shape depended on `condition_type` |
| `action` | TEXT | was `notify` or `workflow:<id>` |
| `enabled` | INTEGER | 0/1 |
| `last_checked` | TEXT | |
| `last_state` | TEXT | `ok` \| `alert` |
| `last_triggered_at` | TEXT | |
| `created_at` | TEXT | |
