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

### Profiles — audio endpoint switching needs a third-party PowerShell module
Windows has no built-in cmdlet to change the default playback device. The `audio` profile item shells out to `Set-AudioDevice` from the community `AudioDeviceCmdlets` module — if it isn't installed, the item fails with a PowerShell warning in the activation output and the rest of the profile still applies. Not a bug, not fixable without bundling a third-party module (or shipping a signed native helper), which is out of scope for this pass. Workaround: `Install-Module AudioDeviceCmdlets` once, manually, if you want this item to work.

### Profiles — refresh rate switching is unverified and best-effort
No built-in PowerShell cmdlet changes display refresh rate either. The `refresh_rate` item uses an inline `Add-Type` P/Invoke call to `ChangeDisplaySettings`, wrapped in try/catch so a failure can't break the rest of activation — but this was written and reviewed, never run against real display hardware (this dev environment can't run the Tauri app or touch a real Windows session). Treat it as experimental until confirmed working on a real machine.

### Watchers — cpu_sustained streak resets on app restart
The consecutive-over-threshold counter behind `cpu_sustained` is in-memory only (`watchers.rs::cpu_streaks`), not a DB table — restarting CTRL mid-streak drops the count back to 0, so a sustained-CPU alert that was 4 of 5 minutes in has to start over. Deliberate scope cut per the roadmap ("keep it the simplest thing that works, not a new DB table") — an app restart losing a few minutes of streak progress isn't worth a schema addition.

### Watchers — unverified end-to-end
Same limitation as System Profiles: this dev environment can't run the Tauri app or a live Windows session. `cargo check`/`cargo clippy` are clean and the poll loop/PowerShell follow the exact patterns of the already-shipped, presumably-working workflow scheduler and notify step — but the watcher scheduler, the toast firing, and `Get-Process`-based `process_down` detection were never executed against a real machine.

### Profiles — killed apps aren't relaunched on Restore Previous
The snapshot only remembers process names for apps the profile *itself started* (so it can stop them on revert) — apps the profile killed have no stored launch path, so restore can't bring them back automatically. Deliberate scope cut, documented rather than silently missing. Process names are derived from `start_apps` item file paths (executable stem) rather than from `Start-Process -PassThru` output, since the apply step runs elevated and its stdout is not captured back into Rust.

### ~~Builder — toggle state not persisted across sessions~~ ✅ Resolved
Builder selections now saved to `localStorage` under key `ctrl_builder_apps` (plus `ctrl_builder_pkgmgr` for the chosen package manager). Restored on next load.

### ~~Workflow steps never elevated, even when the script/fix has run_as_admin set~~ ✅ Resolved (2026-08-18)
Found by real-world testing: a workflow with an SFC step failed with "You must be an administrator" even though the underlying fix was configured `run_as_admin`. Root cause: `run_step_script`/`run_step_fix` in `workflows.rs` were a completely separate, duplicated exec implementation (`app.shell().command(...).output()` directly) that never looked at the `run_as_admin` column at all — every workflow step ran unprivileged regardless of its own settings, with no error or indication anything was skipped. Fixed by routing both through the real `run_script`/`run_fix` commands instead, so workflow steps now get identical admin-elevation, PTY execution, and sandbox handling to running the same item from its own pane. One side effect: each step now also writes its own `run_log` row (in addition to the workflow's combined row), so Recent Activity will show individual step runs during a workflow, not just the workflow-level entry — this is arguably more correct (the step genuinely ran), not a regression.

### ~~Workflows — a "Pause Script" (interactive) script as a step would hang forever~~ ✅ Resolved (2026-08-18)
Found in the same pass as the admin-elevation fix above: routing workflow steps through the real `run_script` meant they'd also inherit "Pause Script" — a `Read-Host`/`pause` appended for the embedded terminal, where a workflow step has no one to press a key. Added a `skip_pause` param to `run_script` (only `run_workflow`'s script-step path sets it); existing callers (Scripts pane, palette, tray) are unaffected since the param defaults to off.

### ~~Tools — icon always shows generic app-window icon~~ ✅ Resolved
Extension-to-icon mapping added: `.exe` → device-desktop, `.lnk` → link, `.ps1` → terminal-2, `.bat/.cmd` → terminal, `.py` → brand-python, `.ahk` → keyboard.

### ~~Dashboard/tray — dangling pins after deleting the pinned item~~ ✅ Resolved (2026-08-17)
`pin_item` never validated the target still exists, and deleting a pinned tool/fix/workflow/project/script left the `pinned` row behind — `resolve_item`'s `unwrap_or_default()` returned an empty name, so it rendered as a blank row on the dashboard and a blank entry in the tray menu instead of disappearing. `get_pinned` (dashboard.rs) and `fetch_pinned` (tray.rs) now both skip and lazily delete any pin whose name resolves empty.

### ~~Backup runs with a partial-success robocopy code showed as failed~~ ✅ Resolved (2026-08-18)
`run_backup` stored robocopy's raw exit code (0-7 are all "success", e.g. 1 = files copied) directly in `run_log.exit_code`. Every reader of that column — `get_recent_activity`, run-history, and the per-item last-run check — treats it as a plain `exit_code = 0` success flag, so any backup that copied files (code 1+) showed up as a failed run on the Dashboard even though it succeeded. Now normalized to `0` on success, raw code preserved only on real failure (8+).

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

(none currently — see `docs/ROADMAP.md` items 4 and 6 for what's next)

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
