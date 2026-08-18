# >_ CTRL

**Your personal Windows control centre. Portable. Local. No BS.**

>_ CTRL replaces the scattered mess of scripts, shortcuts, batch files, and AutoHotkey hacks that every power user accumulates — and puts everything in one dark, fast, offline-capable desktop app.

Drop the folder on a USB drive. Copy it to a new PC. Run it anywhere. No installer. No admin rights needed. No internet. No telemetry. Everything local, everything yours.

**What it does:**
- Run PowerShell / Python / batch scripts with one click
- Launch tools and executables with optional elevation
- Apply Windows tweaks and quick fixes without looking them up
- Build custom PC-setup scripts with a toggle-based builder (WinScript integration)
- Track projects, manage environment variables, run backup jobs
- Chain scripts into automated workflows
- Store and copy reusable code snippets
- Lives in the system tray — summon it from anywhere with `Ctrl+Shift+Space`, launch pinned items straight from the tray menu without opening the window

Built with **Tauri v2** (Rust + WebView2) and vanilla JS/CSS. SQLite database travels with the app.

**[⬇ Download the latest release →](https://github.com/AuZzii-Xssistant/ctrl/releases)**

---

> **⚠️ Beta** — >_ CTRL is functional and actively used, but maturity varies a lot module to module (see the table below — this isn't boilerplate, read it before relying on something). Expect rough edges and breaking changes between releases. Back up your `ctrl.db` before upgrading.

> **🤖 Vibe Coded** — >_ CTRL is a vibe-coded project, built entirely through AI-assisted development (Claude). The code works, but it's been grown organically rather than architected from scratch. Contributions and issues welcome.

---

## Modules

Every module is present and runs — none of them crash or are placeholder stubs. "Status" here means something narrower and more honest: **how much real, hands-on use has actually exercised it.** A module can be fully wired up in code and still be one I haven't leaned on hard enough to trust yet. That's what this column tracks.

| Module | Icon | Status | Description |
|---|---|---|---|
| Quick Fixes | `ti-bolt` | 🟢 Solid | One-click commands (flush DNS, clear temp, restart service…) — the most-used, most battle-tested part of the app |
| Scripts | `ti-code` | 🟢 Solid | ScriptStash port — named profiles + a Master view, drag-reorder, per-script admin/pause flags. Heavily reworked and hardened; the module I trust most after Quick Fixes |
| Builder | `ti-wand` | 🟡 Functional (ported) | Toggle-based script generator, imported from the separate [WinScript](https://github.com/flick9000/winscript) project rather than designed for >_ CTRL from scratch. Works, but carries someone else's design decisions and hasn't had the same scrutiny as Scripts/Fixes. Basic/Strict/Extreme presets plus an Autounattend card that bakes the current combined script into a Windows answer file (`unattend.xml`) for a fully unattended install |
| Dashboard | `ti-home` | 🟡 Functional | Pinned launchpad — one-click access to tools/scripts/fixes, drag-reorder, compact mode |
| Tools | `ti-tool` | 🟡 Functional | Register and launch executables, with optional Run As Admin |
| Projects | `ti-archive` | 🟡 Functional | Track projects by status (idea → stable → deprecated) |
| Workflows | `ti-player-play` | 🟡 Functional | Chain scripts and fixes into ordered sequences, with manual/startup/scheduled triggers. Macro recorder: hit Record, run scripts/fixes as normal, Stop & Save turns the run history into a workflow |
| Backup | `ti-device-floppy` | 🟡 Functional | Folder→folder backup jobs using robocopy (incremental) |
| Tweaks | `ti-adjustments` | 🟡 Functional | Built-in Windows tweaks + user-defined custom tweaks |
| Environment | `ti-list-details` | 🟡 Functional | User environment variables (add/edit/delete) + system vars (UAC elevation to edit) |
| Snippets | `ti-blockquote` | 🟡 Functional | Reusable text/command snippets — one-click copy, categories, tags |
| Compare | `ti-arrows-diff` | 🟡 Functional | Side-by-side text diff with synced scroll |
| Profiles | `ti-user-cog` | 🟡 Functional | Named machine-state presets (power plan / apps to kill-start / DNS / audio / refresh rate / custom script). Activate snapshots current state first; Restore Previous reverts. Audio-endpoint and refresh-rate changes are best-effort (see Known Issues) |
| Watchers | `ti-eye` | 🟡 Functional | Polls disk space / a named process / sustained CPU every ~30s, notifies (tray toast) or runs a workflow on alert |
| History | `ti-history` | 🟡 Functional | Full searchable `run_log`: filter by module/success/date range/text, click a row for full output, export filtered results to a text file, Clear Filters button |
| Settings | `ti-settings` | 🟡 Functional | App info, keyboard shortcuts, data folder access |
| Changelog | `ti-notes` | 🟡 Functional | In-app changelog viewer |

> 🟢 Solid — I actually rely on this day to day. 🟡 Functional — works, wired up correctly, just hasn't accumulated the same real-world mileage yet, and the design may still shift. This table will keep moving items up (or down) as usage tells me more — it's a snapshot, not a promise.

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Ctrl+Shift+Space` (global, works anywhere) | Show >_ CTRL and focus search — even if it's minimized/hidden to tray |
| `Ctrl+K` | Focus global search |
| `Escape` | Close modal / clear search |
| `↑ ↓` | Navigate search results |
| `Enter` | Open highlighted search result |
| `Ctrl+Enter` (in search) | Run the highlighted result directly — tools, scripts, fixes, and workflows run immediately without leaving search |
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
```

Scripts live in `ctrl.db` (the `content` column), not as loose files on disk — no `data/scripts/` folder.

Copy the entire `CTRL/` folder to a USB drive. Run `ctrl.exe` on any Windows 10/11 PC — no install, no dependencies.

---

## CLI

`ctrl-cli.exe` lets you add data to your >_ CTRL instance from a terminal without opening the GUI.

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
| `add workflow` | `--name` | `--desc`, `--steps` (JSON array, `[]` default) |
| `update project` | `--id` | any `add` flag to patch |
| `update script` | `--id` | any column name to patch (see `docs/db-schema.md`'s `scripts` table for what's settable) |
| `update fix` | `--id` | any column name to patch |
| `update tweak` | `--id` | any column name to patch |

`add script` also takes `--pause` (sets the "Pause Script" flag — the terminal holds open at the end instead of closing immediately).

**What the CLI can't do that the app can** — it's a data-entry shortcut, not full feature parity:
- A script added via `ctrl-cli add script` always lands in **Master only**. Assigning it to a named Scripts profile has to be done in the app (Scripts pane → right-click → Manage Profiles) — there's no `--profile` flag, since profile membership lives in a separate join table the CLI doesn't touch.
- No CLI access to Dashboard pins, Environment Variables, Quick Launch items, or external Apps.
- `add workflow --steps` takes raw step JSON — there's no CLI helper to build steps from script/fix names, you'd need their IDs from `ctrl-cli list scripts`/`list fixes` first.

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

Copy both to your portable >_ CTRL folder alongside `ctrl.db`.

---

## Docs

| Doc | Description |
|---|---|
| [`docs/api.md`](docs/api.md) | All Tauri commands and their payloads |
| [`docs/db-schema.md`](docs/db-schema.md) | SQLite table definitions |
| [`docs/changelog.md`](docs/changelog.md) | What changed and when |
| [`docs/known-issues.md`](docs/known-issues.md) | Known limitations and workarounds |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Proposed power-user features, ranked by leverage |
| [`docs/superpowers/specs/2026-08-13-ctrl-shell-design.md`](docs/superpowers/specs/2026-08-13-ctrl-shell-design.md) | Original v1 design spec (historical) |
