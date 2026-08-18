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

## ✅ 3. System Profiles (done, this branch)

Named machine-state presets (Work/Gaming/Streaming/Presentation): power plan, background apps to kill/start, DNS server, audio endpoint, display refresh rate, optional custom PowerShell block. Activating snapshots current values first (fresh every time, never reused stale) so Restore Previous is always safe.

- One combined elevated PowerShell run per activation: snapshot markers first, then each enabled item applied in order, then a report of which apps it started (so restore can stop just those).
- Topbar chip (`active-profile-chip`) and a disabled tray line ("Profile: X") both show the active profile, rebuilt after every activate/restore — same pattern `pin_item`/`unpin_item` already use for the tray.
- Audio-endpoint and refresh-rate changes are best-effort: no built-in PowerShell cmdlet exists for either on stock Windows. Audio needs the third-party `AudioDeviceCmdlets` module (not bundled); refresh rate uses an inline P/Invoke `ChangeDisplaySettings` call. Both wrapped in try/catch so a failure can't break the rest of activation — see `docs/known-issues.md`.
- Killed apps are not relaunched on restore (no stored launch path) — only apps the profile itself *started* get stopped on revert. Documented trade-off, not a bug.

Files touched: `src-tauri/src/db.rs` (`profiles`/`profile_items`/`profile_snapshots`/`profile_state` tables), `src-tauri/src/commands/profiles.rs` (new), `src-tauri/src/commands/mod.rs`, `src-tauri/src/commands/tray.rs` (active-profile tray line), `src-tauri/src/lib.rs` (command registration), `src/modules/profiles.js` (new), `src/index.html` (nav button + pane + topbar chip), `src/app.js` (pane loader wiring, `window._refreshActiveProfileChip`), `src/style.css` (chip styling), `docs/api.md`, `docs/db-schema.md`, `README.md`.

**Not verified**: this session cannot run the Tauri dev server or a real Windows session, so the `powercfg`/`netsh`/`Get-DnsClientServerAddress`/P-Invoke refresh-rate/`AudioDeviceCmdlets` PowerShell was written against documented behavior and reviewed carefully, but never executed against a live machine. Compiles clean, `cargo clippy` clean — the untested part is the PowerShell content itself, not the Rust wiring around it.

## ✅ 4. Watchers → real alerting (done, this branch)

New `watchers` table + background poll loop (mirrors `workflows.rs::start_workflow_scheduler`) checking every 30s, plus a Watchers nav page (list, add/edit/delete, enable toggle, last-triggered timestamp).

- 3 condition types only, as scoped: `disk_below` (drive + free % threshold, reuses `get_perf_stats`), `process_down` (named process via `Get-Process`), `cpu_sustained` (% threshold sustained for N minutes, reuses `get_perf_stats`).
- No new notification dependency — reused the existing toast mechanism from `workflows.rs::run_step_notify`, pulled out into a shared `send_toast()`.
- Only fires on the ok→alert transition (`last_state` persisted per watcher) so a persisting condition doesn't renotify every 30s.
- `cpu_sustained`'s rolling window is an in-memory per-watcher counter (`watchers.rs::cpu_streaks`, a `HashMap<i64,u32>` behind `OnceLock`), not a new DB table — resets on app restart, documented trade-off.

Files touched: `src-tauri/src/db.rs` (`watchers` table), `src-tauri/src/commands/watchers.rs` (new), `src-tauri/src/commands/workflows.rs` (`send_toast` extracted for reuse), `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs` (command registration, scheduler start), `src/modules/watchers.js` (new), `src/index.html` (nav button + pane), `src/app.js` (pane loader wiring), `docs/api.md`, `docs/db-schema.md`, `README.md`.

**Not verified**: this session cannot run the Tauri dev server or a live Windows session — the PowerShell (`Get-Process`, the toast notifier) and the poll loop compile clean and follow the exact patterns of the already-shipped workflow scheduler and workflow notify step, but were never executed end-to-end. See `docs/known-issues.md`.

## ✅ 5. Real history page (done, this branch)

`run_log` already captured every run with full output but was only exposed as "last 50" on Recent Activity. New History nav page:
- Filters: module (script/fix/workflow/tool/backup), success/fail, date range (native `<input type="date">`), text search over `item_name` — all AND-combined, debounced.
- Click a row → same `showOutput` terminal-drawer view a live run uses.
- Export button writes the filtered rows to a `.txt` file via a native save dialog.

Files touched: `src-tauri/src/commands/misc.rs` (new `get_run_history_filtered`, new generic `export_text_file`), `src-tauri/src/lib.rs` (command registration), `src/modules/history.js` (new), `src/index.html` (nav button + pane), `src/app.js` (pane loader wiring), `docs/api.md`, `README.md`.

## ✅ 6. Macro recorder for Workflows (done, this branch)

Hand-writing workflow steps via the JSON-step UI had real friction. A Record toggle on the Workflows page header: while active, every script/fix run through the normal UI (scripts pane, fixes pane, command palette ▶) gets appended to a pending steps list via `acquireRun`'s new optional `meta` arg. "Stop & Save as Workflow" hands the accumulated steps straight to the existing New Workflow modal, prefilled — reuses `add_workflow`, no new backend command, no schema change.

- Pulsing red-dot badge + live step count while recording (`.wf-rec-row`/`.rec-dot`, reuses the existing `out-pulse` keyframe from the output drawer's new-activity dot).
- Only `script`/`fix` type runs are recorded, matching what `run_workflow`'s `Step` struct actually executes — no `notify`/`wait` steps get synthesized.
- Workflow runs, tweak runs, and script/fix **queue** runs (`_runQueue` in `scripts.js`, one `acquireRun` call wrapping N items) are not individually captured — documented limitation, not a bug.

Files touched: `src/app.js` (`acquireRun` optional `meta` arg, `isRecording`/`startRecording`/`stopRecording`/`recordedStepCount`), `src/modules/workflows.js` (`_recRowHtml`, `window._toggleRecording`), `src/modules/scripts.js` (`_runOne` passes `meta`), `src/modules/fixes.js` (`_run` passes `meta`), `src/style.css` (`.wf-rec-row`, `.rec-dot`), `README.md`.

This completes the power-user roadmap — all 6 items done.

---

## What's deliberately excluded

Per `.claude/CLAUDE.md`'s existing "What NOT to build" list: light theme, multi-window, a generic plugin hot-load system (Workflows + Scripts already are the extension mechanism — a "cookbook" page of example scripts is the right answer, not new architecture), cloud sync (unless explicitly requested later, and then opt-in/offline-first-preserving only).
