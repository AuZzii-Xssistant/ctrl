# Known Issues & Limitations

## Active

### ~~Builder — toggle state not persisted across sessions~~ ✅ Resolved
Builder selections now saved to `localStorage` under key `ctrl_builder_selected`. Restored on next load.

### ~~Tools — icon always shows generic app-window icon~~ ✅ Resolved
Extension-to-icon mapping added: `.exe` → device-desktop, `.lnk` → link, `.ps1` → terminal-2, `.bat/.cmd` → terminal, `.py` → brand-python, `.ahk` → keyboard.

### Global search — max 5 results per category
`global_search` hard-caps at 5 results per table (tools/scripts/fixes/projects). Enough for quick nav; not a full search engine. Expected behaviour.

### Pane-level filter — no cross-pane search
The inline filter in each pane searches only that pane's data. Use `Ctrl+K` global search for cross-pane queries.

~~### Output drawer — no scroll-to-bottom on new output~~ ✅ Resolved
Double RAF ensures scroll happens after layout paint.

### Drag-to-reorder pins — not implemented
Dashboard pins can't be reordered by dragging. Workaround: unpin and re-pin in the desired order.

### Run As Admin — output not captured for elevated processes
When a fix or script runs with `run_as_admin=true`, CTRL uses `Start-Process -Verb RunAs` which spawns a separate elevated shell. Output from that shell cannot be captured by the parent process. The output drawer will show "Launched with administrator privileges. Output is not captured for elevated processes." This is a Windows UAC architecture limitation.

### Run As Admin — no feedback if UAC is cancelled
If the user cancels the UAC prompt, CTRL shows no error (the elevated PowerShell exits silently). The run is logged as successful because the launch itself succeeded. Planned: detect exit code from the elevated process.

### Builder — stale localStorage if action IDs change
If `data/builder/` JSON files are modified and action IDs change, the saved selection in localStorage may reference non-existent IDs. Workaround: click Clear in the Builder to reset. Low priority — action files rarely change.

### Workflows — step item deleted after workflow created
If a script or fix that is a workflow step is deleted, `run_workflow` will error on that step. No validation at delete time. Planned: cascade-check before delete.

## Resolved

- **Builder state lost on close** — fixed 2026-08-13, localStorage persistence
- **Tool icons always app-window** — fixed 2026-08-13, extension-to-icon mapping
- **run_log `success` column missing** — fixed 2026-08-13, query uses `(exit_code=0)` instead
- **Pinned workflows show blank name/icon** — fixed 2026-08-13, `resolve_item` now handles `workflow` and `project` types
- **Output drawer doesn't auto-scroll** — fixed 2026-08-13, double RAF ensures scrollHeight is measured after layout
- **Tools badge always `tag-exe`** — fixed 2026-08-13, badge now reflects actual file extension
- **`open_script_editor` opened file manager** — fixed 2026-08-13, now uses `cmd /c start` to open with registered default editor
- **confirm_required never enforced** — fixed 2026-08-13, confirm dialog shown for dangerous fixes
- **App empty on first launch** — fixed 2026-08-13, 15 default quick fixes seeded on first run
