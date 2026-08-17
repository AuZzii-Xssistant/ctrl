# CTRL — Shell & Foundation Design Spec
**Date:** 2026-08-13  
**Sub-project:** 1 of N — Shell, Navigation, Dashboard, Core Modules  
**Status:** Approved for planning

> **This is the original v1 planning spec — a historical record of intent, not a live status doc.**
> Several things below are now out of date: Workflows/Backup/Tweaks shipped as full modules (not stubs), the Scripts module was rebuilt on the ScriptStash port (profiles, Master, drag-reorder), and Environment/Snippets/Compare/Recent Activity/Changelog were added after this spec was written. For current, accurate state, see [`docs/api.md`](../../api.md), [`docs/db-schema.md`](../../db-schema.md), and the module table in the repo [`README.md`](../../../README.md) — kept in sync with the code, unlike this spec.

---

## What is CTRL?

A local-first, portable desktop control centre for personal automation, scripting, tooling, and system management. One app that replaces scattered scripts, desktop shortcuts, taskbar pins, and half-finished utilities. Built in Tauri (Rust + WebView2). Ships as a single portable `.exe` + data folder. No installer required. No browser required. No internet required.

The user double-clicks `ctrl.exe` and sees a desktop application — not a browser, not localhost, not a server.

---

## Architecture

| Property | Value |
|---|---|
| Desktop framework | Tauri v2 |
| UI technology | HTML / CSS / JavaScript (embedded WebView2) |
| Embedded webview | YES — WebView2 (ships with Windows 10/11) |
| Backend language | Rust |
| Database | SQLite via `tauri-plugin-sql` |
| Icons | Tabler Icons (bundled, no CDN) |
| Fonts | JetBrains Mono + Inter (bundled, no CDN) |
| Launches default browser | NO |
| User needs localhost | NO |
| Requires internet | NO |
| Browser-native dialogs | NO — all custom application-owned UI |

---

## Portable Folder Structure

```
CTRL/
  ctrl.exe
  ctrl.db                  ← single SQLite database, all modules
  data/
    scripts/               ← script files managed by Scripts module
    builder/               ← action definition JSONs (WinScript-style)
    backups/               ← reserved for Backup module
  resources/
    icons/                 ← bundled Tabler icon font
    fonts/                 ← JetBrains Mono, Inter
```

The entire `CTRL/` folder is portable. Copy to USB, run on another PC, all data and settings travel with it.

---

## Visual Design

Inherited from MonkeyHub (approved). Dark charcoal theme, amber accent, monospace logo.

### Colour tokens

```css
--bg:        #0B0E14   /* window background */
--bg2:       #0D1117   /* sidebar, panels */
--bg3:       #111827   /* cards, inputs */
--bg4:       #131E2E   /* active/hover states */
--border:    #1E2B3C
--border2:   #2A3A50
--text:      #E5E7EB
--text2:     #9CA3AF
--text3:     #6B7280
--amber:     #F5A623   /* primary accent, active nav, logo */
--amber-dim: #C47D0E
--green:     #10B981   /* success */
--red:       #EF4444   /* error, destructive */
--blue:      #60A5FA
--purple:    #A78BFA
```

### Typography
- **UI text:** Inter (system fallback: `system-ui, sans-serif`)
- **Code / monospace / logo:** JetBrains Mono

### Icons
Tabler Icons icon font. Nav icons are `color: var(--text3)` at rest, `color: var(--amber)` when active. Smooth `transition: color 0.1s`. No emoji anywhere in the application.

---

## Layout

```
┌─────────────────────────────────────────────────────────┐
│ >_ CTRL          [> search everything...      ]  [⚙]   │  40px topbar
├────┬────────────────────────────────────────────────────┤
│    │                                                     │
│ ti │                                                     │
│ ti │              content pane                           │
│ ti │         (one module at a time)                      │
│ ti │                                                     │
│    │                                                     │
│ ── │                                                     │
│ ⚙  │                                                     │
└────┴────────────────────────────────────────────────────┘
 48px
```

### Topbar (40px, custom drag region)
- Left: `>_ CTRL` in JetBrains Mono, amber, 13px
- Centre: global search input with `>` amber prompt prefix, searches across all modules
- Right: Settings icon button
- Tauri frameless window — topbar is the drag handle (`data-tauri-drag-region`)
- Custom min/max/close window controls (top-right, application-owned, not OS chrome)

### Sidebar (48px wide)
- Icon-only nav buttons, 36×36px each, 7px border-radius
- Tooltip label appears to the right on hover (application-owned, not browser tooltip)
- Active state: `background: var(--bg4)`, `color: var(--amber)`
- Hover state: `background: var(--border)`, `color: var(--text)`
- Spacer pushes Settings to the bottom
- No text labels (icon + tooltip only)

### Content pane
- Takes all remaining space
- Each module owns it entirely when active
- Smooth instant swap (no transitions needed — snappy feels right for a tool app)
- Scrollable internally per pane

---

## Navigation Modules

All present in sidebar from day one. Stubs show a placeholder, not a crash.

| # | Module | Tabler Icon | v1 State |
|---|---|---|---|
| 1 | Dashboard | `ti-home` | Full |
| 2 | Quick Fixes | `ti-bolt` | Full |
| 3 | Scripts | `ti-code` | Full |
| 4 | Builder | `ti-wand` | Full |
| 5 | Tools | `ti-tool` | Full |
| 6 | Projects | `ti-archive` | Full |
| 7 | Workflows | `ti-player-play` | Stub |
| 8 | Backup | `ti-device-floppy` | Stub |
| 9 | Tweaks | `ti-adjustments` | Stub |
| — | Settings | `ti-settings` (bottom) | Basic |

---

## Dashboard — Pinned Launchpad

The dashboard is not an activity feed. It is a personal launchpad — the user's replacement for desktop shortcuts, taskbar pins, and Start Menu clutter.

### Behaviour
- A grid of pinnable tiles, organised into named groups
- Each tile represents one item from any module: a Tool (`.exe`), a Script, a Quick Fix, a Workflow
- Clicking a tile runs or launches the item immediately
- Right-clicking opens a custom context menu: **Run as admin / Edit / Unpin**
- Groups are named by the user, collapsible, and reorderable
- `[+ Pin]` button opens a search-picker: type to search all CTRL items, click to pin

### Tile anatomy
```
┌────────────┐
│  ti-icon   │  ← Tabler icon, amber
│            │
│  Name      │  ← item name, truncated
│  .ps1      │  ← type badge (exe / ps1 / fix / wf / py)
└────────────┘
```

### Pinned items table (SQLite)
```sql
CREATE TABLE pinned (
  id         INTEGER PRIMARY KEY,
  item_type  TEXT NOT NULL,   -- 'tool' | 'script' | 'fix' | 'workflow'
  item_id    INTEGER NOT NULL,
  group_name TEXT DEFAULT 'Pinned',
  sort_order INTEGER DEFAULT 0
);
```

### Empty state
First launch shows: prompt to pin something, with a button that opens the picker. No fake demo data.

---

## Module Designs (v1 Full Modules)

### Quick Fixes
One-click commands. A command (PowerShell / CMD / batch) with a name, description, category, and shell type. Run button executes inline, output appears in a bottom drawer. No confirmation for non-destructive fixes. Destructive fixes (those flagged `confirm_required = true`) show a custom application dialog before running.

### Scripts
Register script files by path (`.ps1`, `.py`, `.bat`, `.cmd`). Displayed in a card grid grouped by category. Each card: run, edit (opens in default editor via shell `open`), show in folder, delete. Running shows output in bottom output drawer. Add/edit via custom modal form — no browser dialogs.

### Builder
Toggle-based script generator. Left panel: category list from JSON definition files in `data/builder/`. Right panel: toggles within the selected category. "Run Script" tab at bottom of left panel shows the assembled script with syntax highlighting. Output type selector (PS1 / BAT / CMD). Save to Scripts library or run immediately. Builder action definitions are JSON files — same format as MonkeyHub's `data/builder_actions/` — so WinScript-style action packs can be dropped in.

### Tools
Register any executable (`.exe`, `.msi`, shortcut). Name, category, path, optional args, tags, notes. Card grid layout, same as Scripts. Launch button runs the exe via Tauri shell. Supports "Run as admin" flag per tool.

### Projects
Track personal projects with status lifecycle: `idea → prototype → working → stable → deprecated → replaced`. Fields: name, description, type, status, path, tags, notes. List view grouped by status. Open path in Explorer via shell command. No code execution — tracking only.

---

## Shared UI Components

These are implemented once and reused everywhere. No browser-native UI for any of these.

### Custom Modal
Application-owned dialog for add/edit forms and confirmations. Rendered in-page overlay. Fields: title, body (form or message), action buttons. Confirmation variant: message + Cancel + Confirm (destructive red).

### Output Drawer
Slides up from bottom of content pane when a script/fix/tool completes. Shows stdout/stderr in monospace. Colour-coded: green for success (exit 0), red for failure. Close button dismisses.

### Toast Notifications
Bottom-right, auto-dismiss after 2.8s. Three variants: `ok` (green left border), `err` (red left border), `info` (amber left border). Application-owned — not browser notifications.

### Context Menu
Right-click on tiles/cards shows a custom positioned menu. Never the browser's native context menu for application actions.

### Global Search
Dropdown results panel below the topbar search input. Searches across all modules simultaneously. Results grouped by module type. Keyboard: `Escape` clears, `Enter` navigates to top result. Click outside dismisses.

---

## Stub Modules

Workflows, Backup, and Tweaks display a placeholder pane:
```
ti-clock icon (large, muted)
"Coming soon"
[brief description of what this module will do]
```
The nav item is clickable, non-crashing, present. The stub is removed when the module is built.

---

## Settings (Basic v1)

- App theme (dark only for now — light theme is future)
- Data folder path (default: next to `.exe`, configurable for edge cases)
- About panel: version, build date

---

## What is NOT in v1

| Feature | When |
|---|---|
| Workflows (execution engine) | Sub-project 2 |
| Backup / Restore module | Sub-project 3 |
| System Tweaks / toggles | Sub-project 4 |
| Sync / export profile | Sub-project 5 |
| Git submodule management | Sub-project 6 |
| Bookmark manager | Separate standalone app |
| Download / app manager (AppStash) | Evaluate: standalone or sub-project |
| Light theme | Future |
| Multi-window | Future |
| Plugin/module hot-load system | Future |

---

## Rust Command Surface (Tauri `invoke`)

Each module registers its commands in `main.rs`. Frontend calls `invoke('cmd_name', payload)`.

```
// Dashboard
pin_item(item_type, item_id, group_name) → Ok
unpin_item(pin_id) → Ok
get_pinned() → Vec<PinnedItem>
reorder_pins(ids) → Ok

// Scripts
get_scripts(search?) → Vec<Script>
add_script(data) → Script
update_script(id, data) → Script
delete_script(id) → Ok
run_script(id) → RunResult
open_script_editor(id) → Ok
open_script_location(id) → Ok
browse_for_script() → FilePath

// Tools
get_tools(search?) → Vec<Tool>
add_tool(data) → Tool
update_tool(id, data) → Tool
delete_tool(id) → Ok
launch_tool(id) → Ok
browse_for_exe() → FilePath

// Quick Fixes
get_fixes(search?) → Vec<Fix>
add_fix(data) → Fix
update_fix(id, data) → Fix
delete_fix(id) → Ok
run_fix(id) → RunResult

// Projects
get_projects(search?) → Vec<Project>
add_project(data) → Project
update_project(id, data) → Project
delete_project(id) → Ok
open_project_path(id) → Ok

// Builder
get_builder_actions() → BuilderDefs
build_script(action_ids, output_type) → Script
run_built_script(code, script_type) → RunResult
save_built_script(code, name, script_type) → Ok

// Global
global_search(query) → SearchResults
get_stats() → Stats
open_data_folder() → Ok
```

---

## SQLite Schema (Core Tables)

```sql
-- Tools
CREATE TABLE tools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'General',
  path TEXT NOT NULL,
  args TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  run_as_admin INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Scripts
CREATE TABLE scripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT DEFAULT 'General',
  file_path TEXT NOT NULL,
  script_type TEXT DEFAULT 'ps1',
  tags TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Quick Fixes
CREATE TABLE fixes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT DEFAULT 'General',
  shell_type TEXT DEFAULT 'powershell',
  command TEXT NOT NULL,
  tags TEXT DEFAULT '',
  confirm_required INTEGER DEFAULT 0
);

-- Projects
CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  type TEXT DEFAULT 'script',
  status TEXT DEFAULT 'idea',
  path TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Pinned (Dashboard)
CREATE TABLE pinned (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_type TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  group_name TEXT DEFAULT 'Pinned',
  sort_order INTEGER DEFAULT 0
);

-- Run log
CREATE TABLE run_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_type TEXT NOT NULL,
  item_id INTEGER,
  item_name TEXT,
  exit_code INTEGER,
  output TEXT,
  ran_at TEXT DEFAULT (datetime('now'))
);
```

---

## Out of Scope for This Spec

- Implementation detail of each Rust command (covered in implementation plan)
- Tauri config / `tauri.conf.json` settings
- Build pipeline / portable packaging steps
- CI or testing setup
