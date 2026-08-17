# CTRL — Power-User Roadmap

Proposed on `feature/power-user-upgrades`, branched from `main` at commit `82fc6c4`. The goal: turn CTRL from "a utility you open occasionally" into "the thing you reach for by reflex." Ranked by leverage — do the top one first.

## ✅ 1. Command palette (done, this branch)

`Ctrl+K` search results now run directly instead of only navigating:
- A ▶ button on Tools/Scripts/Fixes/Workflows results runs them immediately, using the same `acquireRun`/`showOutput`/toast pipeline every pane already uses.
- `Ctrl+Enter` on the keyboard-highlighted result does the same thing without touching the mouse.
- Plain click/`Enter` still navigates (safe default — you see it before running blind).

Files touched: `src/app.js` (`_paletteRun`, `_runFromPalette`, `renderSearch`), `src/style.css` (`.sr-run-btn`), `README.md`.

## ✅ 2. Global hotkey + system tray (done, this branch)

- `Ctrl+Shift+Space` (registered at startup, best-effort — silently no-ops if another app owns it) shows+focuses the window and focuses global search from anywhere.
- Tray icon with a menu: Show CTRL, up to 10 pinned items (clicking one runs it directly via the same dispatch dashboard.js uses, in native Rust so it works even with the window hidden), Quit CTRL.
- Tray menu is rebuilt from the `pinned` table every time `pin_item`/`unpin_item` run — never goes stale.
- Closing the window (X button, Alt+F4) now hides to tray instead of quitting. `exit_app` is the real exit, wired to the tray's "Quit CTRL".

Files touched: `src-tauri/src/commands/tray.rs` (new), `src-tauri/src/commands/dashboard.rs` (`pin_item`/`unpin_item` now rebuild the tray, added `launch_pinned_from_tray`/`resolve_item_name`), `src-tauri/src/commands/window.rs` (`close_window` hides, added `exit_app`), `src-tauri/src/lib.rs` (plugin registration, hotkey, close-to-tray), `src/app.js` (`hotkey-summon` listener), `Cargo.toml`/`capabilities/default.json`.

**Not done**: the hotkey combo isn't user-configurable yet (hardcoded `Ctrl+Shift+Space`) — a Settings toggle for this is a small follow-up, not blocking anything else on this roadmap.

## 3. System Profiles (spec already exists, never built)

Already fully designed in `docs/known-issues.md` under "Planned Features" — a named machine-state system (Work/Gaming/Streaming/Presentation): power plan, background apps to kill/start, DNS, audio endpoint, refresh rate, optional custom PowerShell block. Snapshots current values before activating so "restore previous" is always safe.

**Scope**: new `profiles`/`profile_items`/`profile_snapshots` SQLite tables, a new `commands/profiles.rs`, a new nav module + page, a header chip or tray-menu entry showing the active profile. This is the single biggest genuinely new feature on this list — do it after the hotkey/tray plumbing exists, since "switch profile from the tray without opening the window" is the natural payoff.

## 4. Watchers → real alerting (not started)

Workflows already has a `notify` step, but nothing observes system state and triggers on its own — everything today is either manual or time-scheduled. A small watcher primitive closes that gap:
- New `watchers` table: `{id, name, condition_type, condition_config (JSON), action (notify | run_workflow_id), enabled, last_checked, last_state}`.
- Condition types to start with (cheap to poll, reuses existing `get_perf_stats`/`get_sys_info` data): disk space below X%, a named process not running, CPU sustained above X% for N minutes.
- A background poll loop (same pattern as `workflows.rs::start_workflow_scheduler`) checks watchers every ~30s and fires the tray notification (needs the tray/notification plugin from item 2) or triggers a workflow.
- New nav page: "Watchers" — list, add/edit/delete, enable toggle, last-triggered timestamp.

**Scope**: depends on item 2 (needs a way to show a notification). New table, new `commands/watchers.rs`, new page. Start with the 3 condition types above — resist the urge to build a generic rule engine on day one.

## 5. Real history page (not started)

`run_log` already captures every run with full output — currently only exposed as "last 50" on Recent Activity. A dedicated History page turns that into something you'd actually search:
- Filters: by module (script/fix/workflow/tool), success/fail, date range, text search over `item_name`.
- Click a row → same output view the run itself used (`showOutput`-style).
- Export filtered results to a text file (`open_path`/file-save pattern already exists elsewhere).

**Scope**: mostly frontend — one new Rust command (`get_run_history_filtered` or extend `get_recent_activity` with filter params), a new page reusing the existing `run_log` table (no schema change). This is the cheapest item on the list relative to its payoff — good candidate to do in parallel with anything else.

## 6. Macro recorder for Workflows (not started, lower priority)

Hand-writing workflow steps via the JSON-step UI has real friction. A "record" mode: while active, every script/fix run through the normal UI gets appended to a pending steps list; "Stop & Save as Workflow" turns that into a real workflow.

**Scope**: mostly frontend state (a recording flag + step accumulator in `app.js`'s `acquireRun`/`releaseRun` path, since that's the single choke point every run already passes through), one new "Save as Workflow" action reusing `add_workflow`. No schema change. Do this last — it's a UX nicety, not a capability gap like the others.

---

## What's deliberately excluded

Per `.claude/CLAUDE.md`'s existing "What NOT to build" list: light theme, multi-window, a generic plugin hot-load system (Workflows + Scripts already are the extension mechanism — a "cookbook" page of example scripts is the right answer, not new architecture), cloud sync (unless explicitly requested later, and then opt-in/offline-first-preserving only).
