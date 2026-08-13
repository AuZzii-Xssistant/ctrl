# CTRL Changelog

## 2026-08-13

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
