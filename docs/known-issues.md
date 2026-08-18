# Known Issues & Limitations

## CLI / GUI parity (audited 2026-08-17)

`ctrl-cli.exe` was checked line-by-line against the current schema and the GUI's feature set. Table names and columns it touches are all correct — `custom_tweaks`, `backup_jobs`, `scripts`, `fixes`, `tools`, `snippets`, `projects`, `workflows` all match `db-schema.md`. Real bugs found and fixed, a capability gap closed, and several deliberate limitations documented (not bugs — the CLI was never meant to be full parity, but they weren't written down anywhere before) — plus one narrow parsing edge case found later and documented rather than risked without live testing:

- **✅ Fixed: `add workflow --steps JSON` was documented but not implemented.** The top-of-file usage comment advertised it; the actual `add_workflow()` function ignored any `--steps` flag and always inserted `'[]'`. Now reads and JSON-validates it.
- **✅ Fixed: `add script` had no way to set the "Pause Script" flag.** Added `--pause`, mapping to the same `scripts.interactive` column the app's edit modal uses.
- **Scripts added via CLI always land in Master only.** `add_script` inserts directly into the `scripts` table; it has no concept of `ss_profiles`/`ss_script_profile` (the ScriptStash profile-membership join table), so there's no way to assign a CLI-added script to a named profile without opening the app afterward (Manage Profiles). Not fixed — would need a `--profile <name-or-id>` flag that looks up or creates a profile row and inserts the join row. Real, but scoped enough to be a fine follow-up rather than urgent.
- **No CLI access to**: Dashboard pins (`pinned` table), Environment Variables, Quick Launch items (`ql_items`), external Apps (`external_apps`), or run history (`run_log`). All GUI-only.
- **`update <table> --id N --field value` blindly patches any column name** via `format!("UPDATE {table} SET {key}=?1 ...")` — this is a deliberate escape hatch (lets you set `run_as_admin`, `interactive`, `master_disabled`, etc. even without a dedicated flag), not a bug. No injection risk in practice: it's a local single-user CLI, not a network-facing service, and the *values* are parameterized — only the column name is interpolated, and a bad column name just fails the query rather than executing arbitrary SQL.
- **`update_field()`'s `_name_col` parameter is unused (dead code)** — passed by every call site (`update_field(&conn, "scripts", "name", &flags)` etc.) but never read in the function body. Harmless, cosmetic. Not worth a signature change across 5 call sites for zero behavior change.
- **`parse_flags()` misparses a value that itself starts with `--`.** It distinguishes `--flag value` from a boolean-only `--flag` by peeking at whether the next token starts with `--` — deliberate, since boolean flags (`--admin`, `--pause`, `--confirm`) need that to work without a value. But `ctrl-cli add fix --name X --cmd "docker run --rm ..."` would misparse: `--cmd` gets treated as boolean (`"true"`), and `"docker run --rm ..."` never gets attached to it, then the loop tries to parse `--rm` as its own (nonexistent, harmlessly ignored) flag. Found via code review, not fixed — narrow edge case (double-dash content in a flag *value*), and a correct fix needs a real per-flag boolean/valued distinction rather than a content heuristic; not confident enough to rewrite the parser without being able to run the CLI live in this environment.

## Active

### Stop button's cancel flag is global, not per-tab — can cancel the wrong run
`RUN_CANCELLED` (`exec.rs`) is a single `static AtomicBool`, shared across every concurrent run in the app. The frontend's Stop button calls `stop_current_run` with no tab or run ID at all (`src/app.js`: `invoke('stop_current_run')`). The app explicitly supports running something in a second terminal tab while the first is still busy (a documented, intentional feature) — with two runs polling `RUN_CANCELLED.swap(false, ...)` concurrently every 150ms, whichever poll loop happens to check the flag first consumes it, resetting it back to `false` for the other. Clicking Stop on tab B's run could non-deterministically cancel tab A's unrelated run instead, leaving the one the user actually meant to stop still running. Narrow (needs 2+ concurrent elevated/PTY runs to trigger) but real. Not fixed: needs per-run cancel tokens (e.g. a `HashMap<tab_id, AtomicBool>`) touching `exec.rs`'s `run`/`run_elevated`, every caller (scripts/fixes/tweaks/workflows), and the frontend's Stop wiring to pass a target — a moderate architectural change I can't verify against real concurrent runs in this environment.

### Tweaks (built-in and custom) never log to run_log
`run_tweak_cmd` runs through the same `exec_run`/`exec_elevated` pattern Fixes use and returns a real `RunResult{success, output}`, but never inserts into `run_log` — the same command Fixes/Scripts/Workflows/Backup all log through. Custom tweaks (`custom_tweaks` table, real DB rows with IDs, just like Fixes) run through this same path, so a user running a custom tweak sees no trace of it in History or in the Settings run-count stat. Not fixing blind: this changes observable app-wide surface area (History's filter dropdown doesn't even list `tweak` as a type, run counts would shift) — a real gap, but a scope decision, not obviously "broken." Flagging for a decision rather than silently changing behavior.

### ~~Exporting/importing a ScriptStash profile silently dropped "Pause Script"~~ ✅ Resolved (2026-08-18)
`SsExportScript` (the JSON shape `ss_export_profile`/`ss_import_profile` round-trip) never had an `interactive` field at all — export never wrote it, and `ss_import_profile`'s `INSERT INTO scripts` didn't include the column either, so it always fell back to the schema default (`0`/off). Every script with "Pause Script" enabled silently lost that setting on export → import, even round-tripping on the same machine. Real data loss, not just a display bug — this is exactly the setting the project already fixed once for persistence (see the ScriptStash hardening entry below), just missed in the export/import path specifically. Added the field to the export struct (with `#[serde(default)]` so old exports without it still import cleanly, just without the setting they never captured) and the import INSERT.

### ~~Add to PATH's duplicate check missed a trailing backslash~~ ✅ Resolved (2026-08-18)
`add_to_path`'s duplicate check does an exact (case-insensitive) string match — `"C:\Tools\bin\"` wouldn't match an existing `"C:\Tools\bin"` entry, silently adding a redundant PATH entry. Reachable in practice: the Add to PATH field is free-text with no folder picker, so a trailing backslash (habit, or copy-pasted from Explorer's address bar) is plausible. Fixed by trimming trailing backslashes before both the comparison and the value actually written.

### ~~Builder's Run button leaked a temp file on every single run~~ ✅ Resolved (2026-08-18)
`run_built_script` (builder.rs) writes the combined script to a temp file, runs it via `spawn_streaming` (which fully awaits process completion), then returns — but never deleted the file. Unlike the elevated-cancel leak below, this happened on *every* Run click, not just cancellations. Fixed: removed right after `spawn_streaming` returns. One narrow residual gap left deliberately unaddressed: if `spawn_streaming`'s own process-spawn fails (not the script failing — the OS failing to launch `powershell`/`cmd` at all, extremely rare), the `?` returns before cleanup runs and the file leaks — same as before, just for a much narrower case; the startup sweep still catches it eventually.

### ~~Cancelling an elevated run leaked 4 temp files every time~~ ✅ Resolved (2026-08-18)
`exec.rs::run_elevated` writes 6 temp files per run; the PTY wrapper script self-deletes 5 of them (`cmd`/`elevwrap`/`exit`/`pid`/`ptywrap`) on a normal finish, but hitting Stop kills the elevated console via `taskkill` before it ever reaches those `Remove-Item` lines — only `sentinel` and `pid` were cleaned up Rust-side on the cancel path, leaving `cmd`/`elevwrap`/`exit`/`ptywrap` behind. They do get swept eventually (the startup cleanup in `lib.rs` deletes anything named `ctrl_*` from the temp dir), but only on the *next app restart* — during a single long-running session (this app now lives in the tray for extended periods), every cancelled elevated run added 4 permanent leftover files until then. Fixed: the cancel path now removes all 4.

### ~~Workflow "Wait" step could show a step label that lied about its actual duration~~ ✅ Resolved (2026-08-18)
`run_step_wait` (workflows.rs) hard-caps at 300s, but the Wait step form's number input had no `max` and the JS building the step label didn't clamp — entering e.g. 10000 created a step labeled "Wait 10000s" that would actually only wait 5 minutes, with no indication anywhere of the mismatch. Added `max="300"` to the input and clamped the label-building logic to match.

### ~~Settings' "Open DB location" button was byte-identical to "Open data folder"~~ ✅ Resolved (2026-08-18)
Both buttons called `open_data_folder`, which only ever opens the exe's own folder — it never accounted for `CTRL_DB`, the env var `sandbox.bat` sets to redirect the database elsewhere. "Open DB location" was silently wrong whenever `CTRL_DB` pointed away from the exe's directory. Added `db::resolve_path()` (the same `CTRL_DB`-aware logic already used at startup, now shared instead of duplicated) and a new `open_db_folder` command that opens the DB's actual parent folder.

### ~~showOutput() wrote completed-run output into the live terminal~~ ✅ Resolved (2026-08-18)
Found by the user: clicking a History row (or the result of any script/fix/workflow/backup run) called `showOutput()`, which wrote the text directly into the active tab's live xterm.js buffer via `term.write()` — the same buffer a real PowerShell/PSReadLine session is using. Since this bypassed the actual PTY, the real shell process's cursor position never moved to match, so the next keystroke could land in the middle of the injected text instead of after it. Rewrote `showOutput()` (`src/app.js`) to open a dedicated read-only modal (`.output-view`) instead — completely decoupled from any PTY, used by all 16 existing call sites unchanged (same function signature). Nothing writes synthetic text into a live terminal anymore.

### ~~Workflow "notify" steps didn't work, failure was invisible~~ ✅ Resolved (2026-08-18)
`send_toast()` used `ToastNotificationManager::CreateToastNotifier("CTRL")` — native WinRT toast notifications require a registered AppUserModelID (a Start Menu shortcut with a toast-activator CLSID), which this unpackaged NSIS-installed app doesn't have. That call almost certainly threw an "app not registered" exception on every invocation, and the PowerShell process's exit code/stderr were never checked (`let _out = ...` — result discarded), so the failure was completely silent; `run_step_notify` always reported success regardless. Switched to a `NotifyIcon` balloon tip (the standard notification mechanism for unpackaged Win32 apps, no identity registration needed) and now actually checks the exit code, returning a real error through to the workflow step's result if it still fails. **Unverified** — no live Windows session in this dev environment to confirm the balloon tip itself renders; the fix addresses the specific, identifiable root cause (AUMID registration) and the silent-failure bug, but hasn't been visually confirmed.
Both seed blocks checked `COUNT(*) == 0` to decide whether to (re)insert their pre-shipped rows — so a user who deleted every seeded item got them silently recreated on the next app start, no matter their intent. Fixed with a new `app_meta` key/value table tracking "has this batch ever been seeded" independent of current row count; upgrading from a pre-`app_meta` install with existing rows just records the flag without re-inserting (no duplication). Also added the missing `delete_ql_item` command — Quick Launch items had no delete path in the UI at all before this.

### Tweaks — built-in tweaks aren't removable (not fixed yet)
The above `app_meta` fix only covers DB-seeded content (`ql_items`, `fixes`). Tweaks' built-in list is hardcoded in `src/modules/tweaks.js`, not DB-backed at all — there's no delete path because there's no row to delete. A real fix needs the bigger Tweaks rethink the user asked for (WinUtil-style actual-state tracking before applying, and moving built-ins into the DB so they're deletable like everything else) — out of scope for this pass, flagged for its own session.

### Watchers removed (2026-08-18)
The Watchers feature (roadmap item 4 — disk/process/CPU polling, tray toast or workflow trigger on alert) was pulled entirely: nav page, `watchers.js`, `commands/watchers.rs`, and its scheduler. Product decision — a dedicated page for so little functionality didn't earn its keep; the plan is to fold equivalent conditions into Workflows later instead of maintaining a separate feature. The `watchers` DB table stays in the schema (unused, harmless) since migrations here are additive-only, never destructive.

### Profiles — full nav page removed, backend/modal kept dormant (2026-08-18)
The Profiles nav page (list, create/edit CRUD) was pulled — too much page for what it did. `src/modules/profiles.js` and the full Rust backend (`commands/profiles.rs`: CRUD, `activate_profile`, `restore_previous`) are untouched and still work, just not reachable from the UI right now. The topbar active-profile chip is now display-only (its click handler, which used to navigate to the removed page, was removed too — it would have thrown trying to activate a pane that no longer exists). Plan: replace with a lightweight quick-switcher overlay off the chip, or pre-shipped profile *scripts* (Gaming/Work/Personal) that don't need a dedicated page at all — not decided yet, deliberately not built this pass. The three Profile limitation entries above (audio endpoint, refresh rate, Restore Previous app-relaunch) still apply whenever this is wired back up.

### Builder — Autounattend output is unverified against real install media
`export_autounattend` generates a Windows `unattend.xml` answer file, ported line-for-line from WinScript's own template. The XML structure, escaping, and PowerShell blocks were traced by hand against WinScript's `unattend.js` and are believed correct, but this dev environment has no way to actually boot a VM or USB from generated install media — the output has never been tested on a real Windows setup. Treat it as experimental until confirmed working on real install media.

**Fixed 2026-08-18** (found in a bug-hunt pass, not by testing): line-ending normalization was `.replace('\n', "\r\n")` alone, which would double up any line already CRLF (e.g. script content copied from a Windows file) into `\r\r\n`. Currently unreachable in practice — the Builder's combined script is JS-built with bare `\n` — but a real corruption risk if that ever changes. Now normalizes to `\n` first, then converts uniformly.

### Profiles — audio endpoint switching needs a third-party PowerShell module
Windows has no built-in cmdlet to change the default playback device. The `audio` profile item shells out to `Set-AudioDevice` from the community `AudioDeviceCmdlets` module — if it isn't installed, the item fails with a PowerShell warning in the activation output and the rest of the profile still applies. Not a bug, not fixable without bundling a third-party module (or shipping a signed native helper), which is out of scope for this pass. Workaround: `Install-Module AudioDeviceCmdlets` once, manually, if you want this item to work.

### Profiles — refresh rate switching is unverified and best-effort
No built-in PowerShell cmdlet changes display refresh rate either. The `refresh_rate` item uses an inline `Add-Type` P/Invoke call to `ChangeDisplaySettings`, wrapped in try/catch so a failure can't break the rest of activation — but this was written and reviewed, never run against real display hardware (this dev environment can't run the Tauri app or touch a real Windows session). Treat it as experimental until confirmed working on a real machine.

### Profiles — killed apps aren't relaunched on Restore Previous
The snapshot only remembers process names for apps the profile *itself started* (so it can stop them on revert) — apps the profile killed have no stored launch path, so restore can't bring them back automatically. Deliberate scope cut, documented rather than silently missing. Process names are derived from `start_apps` item file paths (executable stem) rather than from `Start-Process -PassThru` output, since the apply step runs elevated and its stdout is not captured back into Rust.

### ~~Closing the window silently minimized to tray with no explanation~~ ✅ Resolved (2026-08-18)
Found by the user hitting it directly — clicking X (or Alt+F4) hid the app to the tray with zero indication that's what happened, which read as "the app didn't close" rather than "it's still running in the background." Rust now prevents the close and emits a `close-requested` event instead of silently hiding; the frontend shows a modal asking Minimize to Tray vs. Quit, with an optional "remember my choice" to skip the prompt on future closes.

### ~~Builder — toggle state not persisted across sessions~~ ✅ Resolved
Builder selections now saved to `localStorage` under key `ctrl_builder_apps` (plus `ctrl_builder_pkgmgr` for the chosen package manager). Restored on next load.

### ~~Workflow steps never elevated, even when the script/fix has run_as_admin set~~ ✅ Resolved (2026-08-18)
Found by real-world testing: a workflow with an SFC step failed with "You must be an administrator" even though the underlying fix was configured `run_as_admin`. Root cause: `run_step_script`/`run_step_fix` in `workflows.rs` were a completely separate, duplicated exec implementation (`app.shell().command(...).output()` directly) that never looked at the `run_as_admin` column at all — every workflow step ran unprivileged regardless of its own settings, with no error or indication anything was skipped. Fixed by routing both through the real `run_script`/`run_fix` commands instead, so workflow steps now get identical admin-elevation, PTY execution, and sandbox handling to running the same item from its own pane. One side effect: each step now also writes its own `run_log` row (in addition to the workflow's combined row), so History will show individual step runs during a workflow, not just the workflow-level entry — this is arguably more correct (the step genuinely ran), not a regression.

### ~~Workflows — a "Pause Script" (interactive) script as a step would hang forever~~ ✅ Resolved (2026-08-18)
Found in the same pass as the admin-elevation fix above: routing workflow steps through the real `run_script` meant they'd also inherit "Pause Script" — a `Read-Host`/`pause` appended for the embedded terminal, where a workflow step has no one to press a key. Added a `skip_pause` param to `run_script` (only `run_workflow`'s script-step path sets it); existing callers (Scripts pane, palette, tray) are unaffected since the param defaults to off.

### ~~Tools — icon always shows generic app-window icon~~ ✅ Resolved
Extension-to-icon mapping added: `.exe` → device-desktop, `.lnk` → link, `.ps1` → terminal-2, `.bat/.cmd` → terminal, `.py` → brand-python, `.ahk` → keyboard.

### ~~Dashboard/tray — dangling pins after deleting the pinned item~~ ✅ Resolved (2026-08-17, gap closed 2026-08-18)
`pin_item` never validated the target still exists, and deleting a pinned tool/fix/workflow/project/script left the `pinned` row behind — `resolve_item`'s `unwrap_or_default()` returned an empty name, so it rendered as a blank row on the dashboard and a blank entry in the tray menu instead of disappearing. `get_pinned` (dashboard.rs) and `fetch_pinned` (tray.rs) now both skip and lazily delete any pin whose name resolves empty. **Gap found and closed 2026-08-18**: the `"ql"` branch of `resolve_item` was the one exception — it fell back to a placeholder name (`"Quick Launch #{id}"`) instead of empty on lookup failure, so a pin to a deleted Quick Launch item (unreachable before `delete_ql_item` existed, live once it shipped) would never be caught by the cleanup. Now falls back to empty like every other type.

### ~~Backup runs with a partial-success robocopy code showed as failed~~ ✅ Resolved (2026-08-18)
`run_backup` stored robocopy's raw exit code (0-7 are all "success", e.g. 1 = files copied) directly in `run_log.exit_code`. Every reader of that column — `get_recent_activity`, run-history, and the per-item last-run check — treats it as a plain `exit_code = 0` success flag, so any backup that copied files (code 1+) showed up as a failed run on the Dashboard even though it succeeded. Now normalized to `0` on success, raw code preserved only on real failure (8+).

### Global search — max 5 results per category
`global_search` hard-caps at 5 results per table (tools/scripts/fixes/projects). Enough for quick nav; not a full search engine. Expected behaviour.

### Pane-level filter — no cross-pane search
The inline filter in each pane searches only that pane's data. Use `Ctrl+K` global search for cross-pane queries.

~~### Output drawer — no scroll-to-bottom on new output~~ ✅ Resolved
Double RAF ensures scroll happens after layout paint.

### Run As Admin — output not captured for elevated processes
When a fix or script runs with `run_as_admin=true`, CTRL uses `Start-Process -Verb RunAs` which spawns a separate elevated console (UAC requires this — a non-elevated process cannot read another process's console buffer). The embedded terminal shows a "Running as administrator — see external terminal" status line and captures only the exit code, not live output. This is a Windows UAC architecture limitation, not a >_ CTRL bug.

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
