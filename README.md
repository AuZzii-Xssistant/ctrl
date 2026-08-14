# >_ CTRL

**Your personal Windows control centre. Portable. Local. No BS.**

CTRL replaces the scattered mess of scripts, shortcuts, batch files, and AutoHotkey hacks that every power user accumulates — and puts everything in one dark, fast, offline-capable desktop app.

Drop the folder on a USB drive. Copy it to a new PC. Run it anywhere. No installer. No admin rights needed. No internet. No telemetry. Everything local, everything yours.

**What it does:**
- Run PowerShell / Python / batch scripts with one click
- Launch tools and executables with optional elevation
- Apply Windows tweaks and quick fixes without looking them up
- Build custom PC-setup scripts with a toggle-based builder (WinScript integration)
- Track projects, manage environment variables, run backup jobs
- Chain scripts into automated workflows
- Store and copy reusable code snippets

Built with **Tauri v2** (Rust + WebView2) and vanilla JS/CSS. SQLite database travels with the app.

**[⬇ Download the latest release →](https://github.com/AuZzii-Xssistant/ctrl/releases)**

---

> **⚠️ Beta** — CTRL is functional and actively used. Expect rough edges and breaking changes between releases. Back up your `ctrl.db` before upgrading.

> **🤖 Vibe Coded** — CTRL is a vibe-coded project, built entirely through AI-assisted development (Claude). The code works, but it's been grown organically rather than architected from scratch. Contributions and issues welcome.

---

## Modules

| Module | Icon | Status | Description |
|---|---|---|---|
| Dashboard | `ti-home` | ✅ Built | Pinned launchpad — one-click access to tools, scripts, fixes |
| Quick Fixes | `ti-bolt` | ✅ Built | One-click commands (flush DNS, clear temp, restart service…) |
| Scripts | `ti-code` | ✅ Built | Register and run .ps1 / .py / .bat / .cmd scripts |
| Builder | `ti-wand` | ✅ Built | Toggle-based script generator; imports from WinScript via `tools/winscript-converter.js`; supports app install (winget/choco), presets |
| Tools | `ti-tool` | ✅ Built | Register and launch executables, with optional Run As Admin |
| Projects | `ti-archive` | ✅ Built | Track projects by status (idea → stable → deprecated) |
| Settings | `ti-settings` | ✅ Built | App info, keyboard shortcuts, data folder access |
| Workflows | `ti-player-play` | ✅ Built | Chain scripts and fixes into ordered automated sequences |
| Backup | `ti-device-floppy` | ✅ Built | Folder→folder backup jobs using robocopy (incremental) |
| Tweaks | `ti-adjustments` | ✅ Built | Built-in Windows tweaks + user-defined custom tweaks (full CRUD) |
| Environment | `ti-list-details` | ✅ Built | User environment variables (add/edit/delete) + system vars (UAC elevation to edit) |
| Snippets | `ti-blockquote` | ✅ Built | Reusable text/command snippets — one-click copy, categories, tags |
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
REM Add items
ctrl-cli add project  --name "MyApp" --path "C:\Projects\MyApp" --type "node" --status "working" --tags "web,node" --notes "My notes"
ctrl-cli add script   --name "Backup Docs" --content "robocopy C:\Docs D:\Backup /MIR" --type "bat" --category "Backup"
ctrl-cli add script   --name "Deploy" --file "C:\scripts\deploy.ps1" --type "ps1" --category "DevOps"
ctrl-cli add fix      --name "Flush DNS" --cmd "ipconfig /flushdns" --category "Network" --tags "dns,network"
ctrl-cli add tweak    --label "Dark taskbar" --apply "Set-ItemProperty ..." --revert "Set-ItemProperty ..." --category "UI"
ctrl-cli add tool     --name "Process Explorer" --path "C:\tools\procexp.exe" --category "System"
ctrl-cli add snippet  --title "Git status" --content "git status -sb" --category "Git" --tags "git"
ctrl-cli add backup   --name "Documents" --source "C:\Users\Me\Documents" --dest "D:\Backups\Documents"
ctrl-cli add workflow --name "Dev setup" --desc "Installs and configures dev environment"

REM Update items — only the flags you pass are changed, everything else stays
ctrl-cli update project  --id 1 --status stable --path "C:\Projects\MyApp"
ctrl-cli update script   --id 3 --category "DevOps"
ctrl-cli update fix      --id 7 --admin
ctrl-cli update tweak    --id 2 --desc "Updated description"
ctrl-cli update tool     --id 5 --category "Network"
ctrl-cli update snippet  --id 8 --tags "git,vcs"

REM List anything
ctrl-cli list projects
ctrl-cli list scripts
ctrl-cli list fixes
ctrl-cli list tweaks
ctrl-cli list tools
ctrl-cli list snippets
ctrl-cli list backups
ctrl-cli list workflows

REM Point at a specific DB (e.g. portable drive)
ctrl-cli --db "E:\CTRL\ctrl.db" list projects
```

**Valid project statuses:** `idea`, `prototype`, `working`, `stable`, `deprecated`, `replaced`  
**Valid project types:** `script`, `exe`, `experiment`, `tool`, `library`, `workflow`, `tauri`, `node`, `web`, `rust`, `python`, `other`

| Command | Required flags | Optional flags |
|---|---|---|
| `add project` | `--name` | `--path`, `--type`, `--status`, `--tags`, `--notes` |
| `add script` | `--name` + (`--content` or `--file`) | `--type`, `--category`, `--tags`, `--desc`, `--admin` |
| `add fix` | `--name`, `--cmd` | `--category`, `--tags`, `--desc`, `--admin`, `--confirm` |
| `add tweak` | `--label`, `--apply` | `--revert`, `--category`, `--desc`, `--admin` |
| `add tool` | `--name`, `--path` | `--category`, `--tags`, `--desc` |
| `add snippet` | `--title`, `--content` | `--category`, `--tags` |
| `add backup` | `--name`, `--source`, `--dest` | — |
| `add workflow` | `--name` | `--desc` |
| `update project` | `--id` | any `add` flag to patch |
| `update script` | `--id` | any column name to patch |
| `update fix` | `--id` | any column name to patch |
| `update tweak` | `--id` | any column name to patch |

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
