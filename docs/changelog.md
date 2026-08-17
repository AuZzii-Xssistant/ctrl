# CTRL Changelog

## 2026-08-18 — dangling-pin bug fix

- Fixed: deleting a pinned tool/fix/workflow/project/script left a dangling `pinned` row that rendered as a blank entry on the Dashboard (`resolve_item`'s fallback returned an empty name, nothing filtered it out). `get_pinned` now skips and lazily deletes pins that no longer resolve. Documented in `docs/known-issues.md` and `docs/api.md`.

## 2026-08-17 — ScriptStash hardening, Master profile, drag-drop, dead code removal

**Scripts pane — reliability**
- "Pause Script" toggle (renamed from "Interactive") was never actually persisted — added the missing `interactive` fields to `SsScriptData`/`SsScript`. Runs through the embedded PTY with a pause line appended (PowerShell `Read-Host`/cmd `pause`) instead of spawning a separate console
- `run_script` now routes through the same PTY path as Quick Fixes (`exec::run`/`run_elevated`) instead of `spawn_streaming` — fixes PSReadLine cursor corruption
- `last_run`/`last_status` now actually update after a run (was write-only to `run_log`, never back to the `scripts` row)
- Deleting a profile no longer deletes Master-only scripts — removed the `gc_orphaned_scripts` function, which misunderstood Master as "orphaned" when a script has no named-profile membership
- Real Stop button — `stop_current_run` cancel flag (checked every poll tick instead of waiting up to 10 minutes for a sentinel that would never come), PTY kill/respawn for the internal case, `taskkill` for an external elevated console
- "Open in Editor" now syncs edits back to the DB (`ss_open_in_editor` was writing to a temp file nothing ever watched) and no longer crashes with os error 193 (VS Code's `.cmd` launcher needs `cmd /c`, can't be spawned directly)
- Drag-to-reorder actually works — `dragDropEnabled:false` in `tauri.conf.json` (WebView2's native OS file-drop intercept was blocking all in-page HTML5 DnD), `setData()` in `dragstart`, and nearest-row/tile fallback so dropping above/below/left/right of the list still resolves correctly
- Sorting no longer destroys custom order (was string-sorting the numeric `#` column — "10" < "2")

**Master is now a real profile**
- Added `scripts.in_master` column — Master used to mean "every script unconditionally"; now it's a toggleable membership like any named profile
- Manage Profiles modal shows Master as a checkbox alongside named profiles; blocks save if nothing's checked
- Scripts created on a named profile no longer auto-join Master
- Script Builder's Save now asks which profile(s) to save into (Master checked by default) instead of always Master

**Dashboard**
- Pins are drag-reorderable (2D nearest-tile fallback, same robustness as Scripts)
- Compact mode — icon + name only, extra details on hover
- Add Tool/Add Project got a "Pin to Dashboard" checkbox (checked by default) as the low-friction alternative to OS drag-and-drop, which was evaluated and rejected — WebView2 can't do native file-drop and in-page reorder-DnD at the same time

**App-wide**
- Overlays no longer trap the title bar — window controls (min/max/close) now sit above every modal/toast/context-menu via z-index, and Ctrl+K is disabled while a modal is open
- Ctrl+S saves in modals (a comment claimed this worked; it never did)
- Replaced the last native `prompt()` (Workflows' Notify/Wait step forms) with inline panels — the app has only one modal instance, so nesting one inside the workflow editor would have destroyed the in-progress form
- Fixed duplicate event-listener stacking on every pane revisit in `compare.js` (DOM listeners) and `workflows.js` (Tauri `wf-step`/`wf-done` listeners — the worse of the two, since `wf-done`'s own handler called `load()` again, compounding on every workflow completion)

**Backend reliability**
- Fixed mutex-poisoning risk: `terminal.rs`'s PTY commands and `scripts.rs`'s editor-watcher used `.lock().unwrap()` — one panic while held would brick every terminal command for the rest of the app's session. Now recovers the lock instead
- Fixed temp-file collisions between concurrently running scripts (the app explicitly allows a second terminal tab to run while the first is busy) — filenames now include a per-call counter, not just the process id

**Dead code removed** (confirmed via grep across `src/`, zero frontend callers)
- 17 commands from before the ScriptStash port: `add_script`/`update_script`/`delete_script`, the entire non-SS Profiles system (`get_profiles`/`add_profile`/`add_to_profile`/etc. — turned out to be a near-duplicate of `ss_*` on the same tables), `open_script_location`, `browse_for_script`, `read_text_file`
- A second, earlier run-queue implementation (`do_run`/`ss_start_run`/`ss_run_now`/`ss_stop_run`/`ss_run_embedded`) — the original spawn-external-console approach, superseded by this session's PTY rewrite; its `ss-run-state`/`ss-log`/etc. events were never actually firing despite `scripts.js` still listening for them
- Tools page's redundant "Apps" section (Add Tool already covers it with more fields)

**Docs**
- `docs/api.md`, `docs/db-schema.md`, `README.md`, `docs/known-issues.md` all reconciled against current code — were badly stale (missing the entire ScriptStash command set, ~9 real columns on `scripts`, 5 whole tables, 2 whole nav modules)

## 2026-08-14 — Bug fixes + Environment PATH + Sandbox

**Bug fixes**
- Snippet modal Cancel button now works (`closeModal` was not on `window`; added `window._closeSnippetModal` assignment)
- Flush Icon Cache quick fix: replaced `ie4uinit.exe -ClearIconCache` (doesn't work on Win10/11) with correct delete-iconcache-DBs-then-restart-explorer command; migration updates existing databases
- Release & Renew IP: marked `run_as_admin=1` (requires elevation on some systems); migration updates existing databases
- System env var edit: UAC shield is now a separate `<i>` element to the LEFT of the Edit button, not embedded inside it

**Environment — Add to PATH + PATH Editor**
- "Add to PATH" button in env pane header — modal to add a directory to User or System PATH; checks for duplicates before appending
- "PATH Editor" button opens the Windows native Environment Variables dialog (`rundll32 sysdm.cpl,EditEnvironmentVariables`)
- New Rust commands: `open_env_editor`, `add_to_path`

**Sandbox mode**
- `CTRL_SANDBOX=1` env var: `run_fix`, `run_script`, `run_tweak_cmd` return dry-run output instead of executing
- `CTRL_DB` env var: override the database path (defaults to `ctrl.db` next to the exe)
- `sandbox.bat`: sets both vars and launches `ctrl.exe` for safe testing without touching the real Windows system

## 2026-08-14 — Major Upgrade 8

**Snippets pane** (new module)
- Store text, commands, boilerplate, and any reusable content as named snippets
- One-click copy to clipboard; searchable; grouped by category; tags
- Full CRUD with modal (title, content, category, tags)
- Right-click context menu per card
- `snippets` SQLite table; `get_snippets`, `add_snippet`, `update_snippet`, `delete_snippet` Rust commands

**Dashboard perf panel — redesigned**
- Cards per group: CPU card, RAM card, Network card (with adapter name + Wi-Fi/Ethernet icon), Drives card
- Drive entries are clickable — opens that drive in Explorer
- Collapse/expand fixed: collapsed state shows only the `≈` activity icon (30px strip); click anywhere on the strip to expand; chevron button collapses; state saved to localStorage
- Panel body built once via JS; no DOM rebuilds between polls
- Network adapter name + icon shown in header; values right-aligned

**Dashboard — live uptime**
- `get_sys_info` now returns `boot_epoch_ms` (Unix ms) instead of a pre-formatted uptime string
- Uptime chip computed client-side every minute from `Date.now() - boot_epoch_ms` — stays accurate without re-querying Rust
- Boot time also served from localStorage cache so uptime shows instantly on first load

**Dashboard — no re-render on tab switch**
- `_initialized` flag: HTML built once; revisiting dashboard only restarts the perf poll interval

**Pin picker**
- Projects can now be pinned (were missing from picker)
- Pinned projects open their folder in Explorer when clicked on the launchpad
- All item names left-aligned (was centered in button elements)

**`get_perf_stats`** — adds `net_name` field (active adapter name)
**`open_path`** — new Rust command, opens any path in Explorer

## 2026-08-13 — Major Upgrade 7

**Dashboard — live perf panel**
- Right sidebar (~176px) on dashboard with live CPU %, RAM used/total, GPU %, network upload/download rate
- Polls `get_perf_stats` every 4s (only when dashboard is active — no background polling)
- Network rate computed client-side from cumulative byte delta between polls
- GPU shows "N/A" on hardware without accessible DXGI counters

**Dashboard — sys-info improvements**
- Added username chip (logged-in user shown next to hostname)
- Added dedicated CPU chip (was tooltip-only before)
- Removed tooltip on sys-info-bar entirely
- sys-info now cached in `localStorage` — shows instantly on every tab switch; background-refreshes and only updates DOM if data changed (handles PC migration: first-run on new PC detects mismatch, updates immediately)

**Environment Variables — editable name + system var editing**
- Name field is now editable in the modal (was readonly); if name changes, old var deleted then new var created
- System variables now have Edit + Delete buttons — triggers UAC elevation (same RunAs pattern as fixes/scripts)
- Delete/Edit for system scope shows UAC note in UI
- `set_env_var` / `delete_env_var` both accept optional `target: "User" | "Machine"`

**Rust: `get_perf_stats` command**
- Returns: `cpu_pct`, `ram_used_gb`, `ram_total_gb`, `gpu_pct` (-1 if unavailable), `net_recv_bytes`, `net_sent_bytes`
- Single PowerShell CIM query + Get-Counter for GPU + Get-NetAdapterStatistics

## 2026-08-13

### Major Upgrade 6 — Environment Variables manager, Dashboard system info, CLI system, Tweaks CRUD

**Environment Variables pane** (new module)
- User env vars: add, edit, delete via modal — changes persist via `[Environment]::SetEnvironmentVariable` User scope
- System env vars: read-only list with copy button
- Search/filter across both sections simultaneously
- Rust commands: `get_env_vars`, `set_env_var`, `delete_env_var` (all via PowerShell, no new deps)

**Dashboard — system info strip**
- New `sys-info-bar` below the stats bar: hostname, OS, total RAM, uptime
- CPU name available on hover over the bar
- Single PowerShell CIM query on dashboard load (`get_sys_info`)

**System Tweaks CRUD** (Loop 11)
- `custom_tweaks` table; add/edit/delete custom tweaks alongside 18 built-ins
- Custom tweaks appear grouped by category below built-in sections

**CLI system** (`ctrl-cli.exe`)
- Standalone binary in same Cargo crate (no new deps)
- `add project|script|fix|tweak` with `--flag value` pairs
- `update project|script|fix|tweak --id N [--field value]` patch-in-place
- `list projects|scripts|fixes|tweaks` formatted table output
- DB auto-detected next to binary; `--db PATH` override

**Projects: browse folder button**
- Browse button next to path field in Add/Edit modal (reuses existing `browse_for_folder` command)
- Project types expanded: tauri, node, web, rust, python, other (with matching icons)

**Scripts in DB** (Loop 10)
- `content TEXT` column; scripts run from temp file without a file on disk
- Browse/Import reads file content into textarea automatically

**Bug fixes**
- Tauri v2 camelCase param mismatch fixed across all invoke calls
- Admin script/fix output now captured via temp PS1 + Out-File bridge
- Modal scroll: `max-height:85vh`, scrollable body prevents off-screen overflow
- Project status `active` not in STATUS_ORDER — CTRL project corrected to `working`
- `default-run = "ctrl"` in Cargo.toml fixes `dev.bat`/`build.bat` after ctrl-cli was added

### Major Upgrade 5 — Admin elevation, Recent Activity pane, output drawer redesign, UX fixes

**Admin elevation (run_as_admin)**
- `run_as_admin INTEGER` column added to `fixes` and `scripts` tables (idempotent migration)
- 8 seeded fixes marked as admin-required: Reset TCP/IP, Clear Windows Temp, SFC Scan, DISM, CHKDSK, Clear Event Log, Set High/Balanced Power
- Fix/Script rows show shield badge when admin is required; RUN button gets shield icon
- Add/Edit modal for fixes and scripts now has "Run as Administrator" checkbox
- Rust `run_fix` / `run_script`: admin path uses `Start-Process -Verb RunAs` for UAC elevation; non-admin path prefixes UTF-8 encoding header to fix garbled output
- Note: output is not captured for elevated processes (UAC limitation, see known-issues.md)

**Recent Activity pane**
- New dedicated pane (`activity.js`) showing last 50 run entries with type icon, name, type tag, time-ago, success/fail dot
- Nav button (history icon) positioned above settings icon
- Dashboard no longer shows recent activity — now shows stats + pinned launchpad only

**Output drawer redesign**
- Always visible as a thin collapsed bar (no more auto-expanding on run)
- Click header or chevron to toggle open/closed
- Amber pulse dot signals new output when drawer is closed
- Timestamp shown in drawer header

**Global UX fixes**
- Context menu: `document.addEventListener('contextmenu', e => e.preventDefault())` suppresses browser default everywhere
- Browser shortcuts: Ctrl/Meta + F/G/H/U/P/J/R blocked globally (keydown handler)
- Autocomplete: `openModal()` centrally applies `autocomplete="off"`, `autocorrect="off"`, `spellcheck="false"` to all modal inputs
- Sticky header gap: `.pane-divider + * { margin-top: 12px }` — content no longer touches divider bar
- Custom scrollbars: global `::-webkit-scrollbar` rules (5px, themed) — replaced pane-scroll-only rules
- Settings pane: wrapped in `pane-scroll` container, pane-header added, content has proper spacing

---

### Loop run 4 — Workflows filter, projects notes, tag CSS, API docs

**Workflows filter** — inline filter added to the Workflows pane (last list pane without one). Client-side filter on name + description, debounced 180ms. Consistent with all other panes.

**Projects notes visible in row** — `notes` field was editable but invisible in the list. Now shown as a small italic line below description (truncated at 80 chars). No DB or API change needed.

**Tag CSS for new extensions** — `.tag-lnk`, `.tag-ahk`, `.tag-jar` added. Tools with those extensions now render a styled badge instead of a bare class-less span.

**API docs** — `get_run_history` command and `RunHistoryEntry` type documented in `docs/api.md` (was missing from loop 3).

---

### Major upgrade 4 — Seed data, run history, confirm guard, command preview, bug fixes

**Seed data (first-run experience)**
- 15 useful Windows quick fixes pre-installed on first launch across: Network (Flush DNS, Reset TCP/IP, Release/Renew IP, Ping Gateway), Maintenance (Clear Temp, Clear Windows Temp, Clear Event Log), System (Restart Explorer, Flush Icon Cache, Kill Process), Repair (SFC, DISM, CHKDSK), Performance (High Performance power, Balanced power)
- Dangerous fixes (`confirm_required=true`): Reset TCP/IP, SFC, DISM, CHKDSK, Clear Event Log

**Run History**
- `get_run_history(item_type, item_id, limit)` Rust command added — returns last N runs with success/fail and captured output from `run_log`
- Scripts and Fixes now have a History button (clock icon) on each card/row
- History opens a modal showing last 10 runs: dot + timestamp + collapsible output block
- History also accessible via right-click context menu

**Confirm-before-run guard for fixes**
- Fixes with `confirm_required=true` now show a confirm dialog before executing
- `confirm_required` checkbox added to Add/Edit Fix modal
- Warning triangle icon (amber) shown on row for dangerous fixes

**Fix command preview**
- Fix rows now show the first line of the command in monospace below the name — visible without opening Edit
- Makes the fixes pane usable as a reference without editing each entry

**Bug fixes**
- Tools badge now shows actual file type (`.ps1`, `.py`, `.bat`, `.ahk`, `.jar` etc.) instead of always `tag-exe`
- `open_script_editor` now uses `cmd /c start ""` to open with the registered default editor instead of opening Explorer (the file manager)
- Duplicate `PRAGMA journal_mode=WAL` removed from `create_tables` (was run twice on startup)

---

### Loop run 2 — CSS tag fixes, pinned workflow names, settings stats, output scroll

**Bug fixes**
- `tag-workflow` CSS class was missing (was `tag-wf`); added `tag-workflow` as alias on same rule
- Added `tag-project` and `tag-backup` CSS classes (were referenced in dashboard but undefined)
- Removed duplicate `tag-fix` rule at bottom of style.css (identical to the one at the top)
- `workflows.js` card footer badge was using `tag-ps1` → fixed to `tag-workflow`
- `resolve_item` in `dashboard.rs` now handles `workflow` and `project` types with correct names and icons
- Output drawer auto-scroll fixed: single `requestAnimationFrame` didn't run after layout; upgraded to double RAF

**Settings improvements**
- Settings pane now fetches live stats from `get_stats` and renders a stat bar (Tools / Scripts / Fixes / Workflows / Projects / Total runs) inside the app info card

---

### Loop run 1 — Settings pane, README accuracy, missing docs
- `settings.js` — real Settings module replacing empty `() => {}` loader: app info card, data folder button, keyboard shortcuts table, portable structure reference
- Settings CSS: `kbd` styling, `settings-card`, `settings-section`, `shortcuts-table`
- `README.md` — all module statuses corrected (was all "Planned", now accurate ✅/🕐)
- `README.md` — added keyboard shortcuts table, updated docs table
- `docs/known-issues.md` — created; 7 known limitations documented
- `docs/db-schema.md` — created; all 6 tables fully documented

---

### Major upgrade 3 — Workflows, Tweaks, Backup, Activity feed

**Three new fully-functional panes (no more stubs):**

- **Workflows** (`workflows.js`, `commands/workflows.rs`) — chain scripts and fixes into an ordered sequence. Create a workflow, add steps from your existing scripts/fixes, run it, see per-step pass/fail in the output drawer. CRUD + run, right-click context menus.
- **System Tweaks** (`tweaks.js`, `commands/tweaks.rs`) — 20 pre-built Windows tweaks across Privacy, Explorer & UI, Performance, Network, and Windows Update. Each tweak has an Apply and Revert button. Filter by name or category. Admin note shown at top.
- **Backup & Restore** (`backup.js`, `commands/backup.rs`) — define named folder→folder backup jobs. Uses `robocopy /E` for incremental copy (only changed files). CRUD + run, last-run timestamp, folder browser.

**Dashboard improvements:**
- Stats bar now includes Workflows count
- Recent activity feed shows last 10 runs (any type) with pass/fail dot and time-ago

**Rust fixes:**
- `get_last_runs` SQL bug fixed: was querying non-existent `success` column → now uses `(exit_code = 0)`
- `get_stats` now returns `workflows` count
- New `get_recent_activity(limit?)` command added

**DB schema additions:** `workflows` table, `backup_jobs` table (both auto-created on startup)

---

### Major upgrade 2 — Bug fixes + run status + builder select-all

**Bug fixes**
- Scripts/Tools showed 3 "add" buttons (header + empty state + inline card-add) → removed redundant `card-add` div from `_render`
- Enter key didn't chain between modal form fields → `openModal` now attaches keydown chain; last field submits primary button
- Double amber focus border (`:focus-visible` outline + `form-input:focus` border both showing) → `outline: none` on all form inputs for `:focus-visible`
- Clicking modal backdrop closed the form and lost data → backdrop click handler removed; modal closes only via Escape or the X button

**Last-run status dots**
- `get_last_runs` Rust command added (`misc.rs`) — returns the most recent run per item for a given item_type
- Scripts and Fixes panes now show a colour-coded status dot (green = ok, red = err, dim = never run) + time-ago label on each card/row
- Dot refreshes immediately after each run without requiring a full page reload
- `docs/api.md` updated with `get_last_runs` and `LastRun` type

**Toast v2**
- Toast slides in from the right with a spring easing; auto-dismisses with a shrinking progress bar
- Type-coloured icons: ✓ (green), ✗ (red), ℹ (blue)

**Builder**
- "Select all / Clear" button per section in the Builder toggles list

**App-wide**
- Output drawer shows timestamp, clear button, copy button
- Modal has X close button in header; no backdrop-click-to-close
- Pane transitions: `pane-in` slide-fade animation when switching tabs
- Sidebar active item has amber left-border glow

---

### Major upgrade 1 — UX & Polish pass

**App-wide**
- `Ctrl+K` focuses the global search from anywhere
- Arrow keys (↑↓) and Enter navigate global search results
- Escape clears search input and collapses results
- Modal open/close now animates with fade + scale
- Output drawer gets a **Copy** button (copies full output to clipboard)
- `focus-visible` rings added for keyboard users (amber outline)
- Skeleton loading cards/rows replace plain "Loading…" text

**Dashboard**
- Live **stats bar** at top: total counts of Tools / Scripts / Fixes / Projects; clicking each navigates to that pane
- Fixed duplicate `invoke` import (was using both `app.js` re-export and `window.__TAURI__` directly)
- `showOutput` now uses the shared app-level function (no more duplicate)
- Pin picker shows category labels per item

**Tools / Scripts / Fixes / Projects**
- Consistent **pane header** (icon + title + inline filter + add button) — sticky, stays visible while scrolling
- Live inline **filter** in every pane (debounced 180ms) — no separate search needed
- **Right-click context menus** on every card and row
- Tools: **Run as Administrator** checkbox in add/edit modal; admin badge on card
- Tools: **tag chips** rendered on card face
- Scripts: shell-specific icon in context menu; "Show folder" in context menu
- Fixes: shell-type icon on each row (terminal-2 / terminal / brand-python)
- Projects: type-specific row icon (code / app-window / flask / tool / package / player-play)
- Topbar: search bar **centred** (absolute positioned, equidistant from logo and window controls)

2026-08-13 15:19 — Tool icons by extension, Builder localStorage, Workflows in global search, pin workflows to dashboard, scripts.js clean import, data-name on tiles
2026-08-13 — Loop 6: Tweaks admin badges, applied-state persistence (localStorage), UTF-8 output fix
2026-08-13 — Loop 7: Builder run now uses showOutput() correctly; Projects open-path error surfaced as toast; stopPropagation on project buttons
2026-08-13 — Loop 8: Workflows now log to run_log (appear in Recent Activity + history); COALESCE '?' literal fixed to '(unknown)'
2026-08-13 — Loop 9: Pin fix committed — pin_item idempotent, picker shows already-pinned state, Problems.md history entry corrected
2026-08-13 — Loop 10 (Problems pass): Tauri v2 camelCase param fix (itemType/itemId/itemId everywhere — was snake_case); admin output bridged via temp PS1 + Out-File; pane-divider height:12px replaces display:none to fix sticky bar gap on all panes
