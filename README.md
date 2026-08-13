# >_ CTRL

A local-first, portable desktop control centre for personal automation, scripting, tooling, and system management. One app to replace scattered scripts, desktop shortcuts, taskbar pins, and half-finished utilities.

Built with Tauri v2 (Rust + WebView2). Ships as a single portable folder — no installer, no browser, no internet required.

---

## Modules

| Module | Icon | Status | Description |
|---|---|---|---|
| Dashboard | `ti-home` | ✅ Built | Pinned launchpad — one-click access to tools, scripts, fixes |
| Quick Fixes | `ti-bolt` | ✅ Built | One-click commands (flush DNS, clear temp, restart service…) |
| Scripts | `ti-code` | ✅ Built | Register and run .ps1 / .py / .bat / .cmd scripts |
| Builder | `ti-wand` | ✅ Built | Toggle-based script generator from action JSON files |
| Tools | `ti-tool` | ✅ Built | Register and launch executables, with optional Run As Admin |
| Projects | `ti-archive` | ✅ Built | Track projects by status (idea → stable → deprecated) |
| Settings | `ti-settings` | ✅ Built | App info, keyboard shortcuts, data folder access |
| Workflows | `ti-player-play` | ✅ Built | Chain scripts and fixes into ordered automated sequences |
| Backup | `ti-device-floppy` | ✅ Built | Folder→folder backup jobs using robocopy (incremental) |
| Tweaks | `ti-adjustments` | ✅ Built | 20 built-in Windows tweaks across Privacy / Perf / UI / Network |
| Recent Activity | `ti-history` | ✅ Built | Last 50 run events (fixes, scripts, workflows) with success/fail status |

> Status: ✅ Built · ⚙️ In Progress · 🕐 Stub (nav present, UI planned)

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Ctrl+K` | Focus global search |
| `Escape` | Close modal / clear search |
| `↑ ↓` | Navigate search results |
| `Enter` | Open highlighted search result |
| Right-click | Context menu on any card or row |

---

## Portable Structure

```
CTRL/
  ctrl.exe       ← the app (single binary)
  ctrl-cli.exe   ← command-line interface (add data from terminal)
  ctrl.db        ← all your data (SQLite)
  data/
    builder/     ← action JSON files (add your own)
    scripts/     ← script storage
    backups/     ← future: backup sets
```

Copy the entire `CTRL/` folder to a USB drive. Run `ctrl.exe` on any Windows 10/11 PC — no install, no dependencies.

---

## CLI

`ctrl-cli.exe` lets you add data to your CTRL instance from a terminal without opening the GUI.

The DB is auto-detected next to the binary (`ctrl.db`). Override with `--db PATH`.

```bat
REM Add a project
ctrl-cli add project --name "MyApp" --path "C:\Projects\MyApp" --type "node" --status "active" --tags "web,node" --notes "My notes"

REM Add a script (inline content — no file needed)
ctrl-cli add script --name "Backup Docs" --content "robocopy C:\Docs D:\Backup /MIR" --type "bat" --category "Backup"

REM Add a script from a file path
ctrl-cli add script --name "Deploy" --file "C:\scripts\deploy.ps1" --type "ps1" --category "DevOps"

REM Add a quick fix
ctrl-cli add fix --name "Flush DNS" --cmd "ipconfig /flushdns" --category "Network" --tags "dns,network"

REM Add a custom tweak
ctrl-cli add tweak --label "Dark taskbar" --apply "Set-ItemProperty ..." --revert "Set-ItemProperty ..." --category "UI"

REM List anything
ctrl-cli list projects
ctrl-cli list scripts
ctrl-cli list fixes
ctrl-cli list tweaks

REM Point at a specific DB (e.g. portable drive)
ctrl-cli --db "E:\CTRL\ctrl.db" list projects
```

**Flags for `add project`:** `--name` (required), `--path`, `--type`, `--status`, `--tags`, `--notes`  
**Flags for `add script`:** `--name` (required), `--content` or `--file`, `--type`, `--category`, `--tags`, `--desc`, `--admin`  
**Flags for `add fix`:** `--name` (required), `--cmd` (required), `--category`, `--tags`, `--desc`, `--admin`, `--confirm`  
**Flags for `add tweak`:** `--label` (required), `--apply` (required), `--revert`, `--category`, `--desc`, `--admin`

---

## Dev

```bat
dev.bat
```

Builds `ctrl-cli` (debug) then starts the app with hot reload via `cargo tauri dev`.

---

## Build

```bat
build.bat
```

Produces release binaries for both the app and the CLI:
- `src-tauri\target\release\ctrl.exe` — the GUI app
- `src-tauri\target\release\ctrl-cli.exe` — the CLI tool

Copy both to your portable CTRL folder alongside `ctrl.db`.

---

## Docs

| Doc | Description |
|---|---|
| [`docs/api.md`](docs/api.md) | All Tauri commands and their payloads |
| [`docs/db-schema.md`](docs/db-schema.md) | SQLite table definitions |
| [`docs/changelog.md`](docs/changelog.md) | What changed and when |
| [`docs/known-issues.md`](docs/known-issues.md) | Known limitations and workarounds |
| [`docs/superpowers/specs/2026-08-13-ctrl-shell-design.md`](docs/superpowers/specs/2026-08-13-ctrl-shell-design.md) | Full design spec |
