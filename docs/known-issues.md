# Known Issues & Limitations

## CLI / GUI parity (audited 2026-08-17)

`ctrl-cli.exe` was checked line-by-line against the current schema and the GUI's feature set. Table names and columns it touches are all correct — `custom_tweaks`, `backup_jobs`, `scripts`, `fixes`, `tools`, `snippets`, `projects`, `workflows` all match `db-schema.md`. One real bug found and fixed, one small gap closed, several capability gaps documented (not bugs — the CLI was never meant to be full parity, but they weren't written down anywhere before):

- **✅ Fixed: `add workflow --steps JSON` was documented but not implemented.** The top-of-file usage comment advertised it; the actual `add_workflow()` function ignored any `--steps` flag and always inserted `'[]'`. Now reads and JSON-validates it.
- **✅ Fixed: `add script` had no way to set the "Pause Script" flag.** Added `--pause`, mapping to the same `scripts.interactive` column the app's edit modal uses.
- **Scripts added via CLI always land in Master only.** `add_script` inserts directly into the `scripts` table; it has no concept of `ss_profiles`/`ss_script_profile` (the ScriptStash profile-membership join table), so there's no way to assign a CLI-added script to a named profile without opening the app afterward (Manage Profiles). Not fixed — would need a `--profile <name-or-id>` flag that looks up or creates a profile row and inserts the join row. Real, but scoped enough to be a fine follow-up rather than urgent.
- **No CLI access to**: Dashboard pins (`pinned` table), Environment Variables, Quick Launch items (`ql_items`), external Apps (`external_apps`), or run history (`run_log`). All GUI-only.
- **`update <table> --id N --field value` blindly patches any column name** via `format!("UPDATE {table} SET {key}=?1 ...")` — this is a deliberate escape hatch (lets you set `run_as_admin`, `interactive`, `master_disabled`, etc. even without a dedicated flag), not a bug. No injection risk in practice: it's a local single-user CLI, not a network-facing service, and the *values* are parameterized — only the column name is interpolated, and a bad column name just fails the query rather than executing arbitrary SQL.
- **`update_field()`'s `_name_col` parameter is unused (dead code)** — passed by every call site (`update_field(&conn, "scripts", "name", &flags)` etc.) but never read in the function body. Harmless, cosmetic. Not worth a signature change across 5 call sites for zero behavior change.

## Active

### ~~Builder — toggle state not persisted across sessions~~ ✅ Resolved
Builder selections now saved to `localStorage` under key `ctrl_builder_selected`. Restored on next load.

### ~~Tools — icon always shows generic app-window icon~~ ✅ Resolved
Extension-to-icon mapping added: `.exe` → device-desktop, `.lnk` → link, `.ps1` → terminal-2, `.bat/.cmd` → terminal, `.py` → brand-python, `.ahk` → keyboard.

### ~~Dashboard/tray — dangling pins after deleting the pinned item~~ ✅ Resolved (2026-08-17)
`pin_item` never validated the target still exists, and deleting a pinned tool/fix/workflow/project/script left the `pinned` row behind — `resolve_item`'s `unwrap_or_default()` returned an empty name, so it rendered as a blank row on the dashboard and a blank entry in the tray menu instead of disappearing. `get_pinned` (dashboard.rs) and `fetch_pinned` (tray.rs) now both skip and lazily delete any pin whose name resolves empty.

### Global search — max 5 results per category
`global_search` hard-caps at 5 results per table (tools/scripts/fixes/projects). Enough for quick nav; not a full search engine. Expected behaviour.

### Pane-level filter — no cross-pane search
The inline filter in each pane searches only that pane's data. Use `Ctrl+K` global search for cross-pane queries.

~~### Output drawer — no scroll-to-bottom on new output~~ ✅ Resolved
Double RAF ensures scroll happens after layout paint.

### Run As Admin — output not captured for elevated processes
When a fix or script runs with `run_as_admin=true`, CTRL uses `Start-Process -Verb RunAs` which spawns a separate elevated console (UAC requires this — a non-elevated process cannot read another process's console buffer). The embedded terminal shows a "Running as administrator — see external terminal" status line and captures only the exit code, not live output. This is a Windows UAC architecture limitation, not a CTRL bug.

### Builder — stale localStorage if action IDs change
If `data/builder/` JSON files are modified and action IDs change, the saved selection in localStorage may reference non-existent IDs. Workaround: click Clear in the Builder to reset. Low priority — action files rarely change.

### Workflows — step item deleted after workflow created
If a script or fix that is a workflow step is deleted, that step's DB lookup fails and it's recorded as a failed `StepResult` — the workflow doesn't crash, remaining steps still run, and the run is logged with `last_run_ok=false`. So it degrades gracefully, but there's still no proactive warning at delete time and no way to fix/remove the dangling step from the UI. No validation at delete time. Planned: cascade-check before delete.

### Workflows — schedule trigger can miss its minute under drift
`fire_matching` polls every 60s and fires when `trigger_config.time` string-matches the current `HH:MM` exactly. If a poll cycle ever lands even one second past the scheduled minute (system sleep/wake, a slow prior workflow run, general scheduling jitter), that day's trigger is silently skipped — no error, no retry, it just doesn't fire until the next matching minute (tomorrow, for a daily schedule). No double-fire risk in the normal case since each minute is checked once. Low severity, but no state tracks "did this fire today" — a more robust design would check `time <= now` with a last-fired-date guard per workflow instead of exact string equality. Not fixed this session — flagged during a code-read pass, not because it visibly broke; deliberately not attempting a fix without being able to verify it against the un-runnable-headlessly live app.

## Planned Features

### System Profiles (Context Switching)
A named machine-state system. Each Profile is a collection of settings that activates together: power plan, background apps to kill/start, DNS server, audio endpoint, display refresh rate, and an optional custom PowerShell block. Activating a profile snapshots the current values first so "restore previous" is always safe.

**Why:** One click switches the machine between Work / Gaming / Streaming / Presentation modes. No scripting needed — the profile editor is a checklist. Each setting is stored in SQLite and travels with the portable folder.

**Implementation notes:**
- Profiles stored in `profiles` and `profile_items` tables (SQLite)
- Activation runs Rust commands: `powercfg /setactive`, `sc stop/start`, `netsh`, registry writes
- Pre-activation snapshot saved to `profile_snapshots` for safe revert
- Tray icon or header chip shows active profile name
- Builds on top of existing Tweaks/Fixes infrastructure

## Resolved

- **Run As Admin — no feedback if UAC is cancelled** — checked 2026-08-17, already fixed (not by this session). `exec.rs::run_elevated`'s PTY wrapper catches the cancel, shows an amber "UAC cancelled or access denied" line plus a red "failed" divider in the terminal, and returns `success:false` — `run_script` surfaces this as a "Script failed" toast. The doc's claim ("shows no error, logged as successful") was stale; likely described the old `ss_run_script_sync` path removed in this session's second dead-code pass, which had cruder exit-code handling.
- **Drag-to-reorder pins/scripts** — fixed 2026-08-17, HTML5 DnD with nearest-row/tile fallback (works even when the cursor leaves the drop zone — above/below/left/right); required `dragDropEnabled:false` in tauri.conf.json since WebView2's native OS file-drop intercept blocks in-page HTML5 DnD entirely
- **"Open in Editor" didn't save back to DB** — fixed 2026-08-17, `ss_open_in_editor` now delegates to `open_script_editor` + `watch_script_edit`, polls the temp file every 1.5s and syncs edits back
- **Stop button didn't stop a running script** — fixed 2026-08-17, added `stop_current_run` cancel flag + PTY kill/respawn + `taskkill` for external elevated consoles
- **Terminal garbled on first run while collapsed** — fixed 2026-08-17, `run-pty-cmd` now waits for the drawer's open transition and re-fits before writing (was racing PSReadLine's redraw)
- **Builder state lost on close** — fixed 2026-08-13, localStorage persistence
- **Tool icons always app-window** — fixed 2026-08-13, extension-to-icon mapping
- **run_log `success` column missing** — fixed 2026-08-13, query uses `(exit_code=0)` instead
- **Pinned workflows show blank name/icon** — fixed 2026-08-13, `resolve_item` now handles `workflow` and `project` types
- **Output drawer doesn't auto-scroll** — fixed 2026-08-13, double RAF ensures scrollHeight is measured after layout
- **Tools badge always `tag-exe`** — fixed 2026-08-13, badge now reflects actual file extension
- **`open_script_editor` opened file manager** — fixed 2026-08-13, now uses `cmd /c start` to open with registered default editor
- **confirm_required never enforced** — fixed 2026-08-13, confirm dialog shown for dangerous fixes
- **App empty on first launch** — fixed 2026-08-13, 15 default quick fixes seeded on first run
