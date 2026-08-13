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
  ctrl.db        ← all your data (SQLite)
  data/
    builder/     ← action JSON files (add your own)
    scripts/     ← script storage
    backups/     ← future: backup sets
```

Copy the entire `CTRL/` folder to a USB drive. Run `ctrl.exe` on any Windows 10/11 PC — no install, no dependencies.

---

## Dev

```bat
dev.bat
```

Starts the app with hot reload via `cargo tauri dev`.

---

## Build

```bat
build.bat
```

Produces a release binary via `cargo tauri build`. Output: `src-tauri\target\release\ctrl.exe`

---

## Docs

| Doc | Description |
|---|---|
| [`docs/api.md`](docs/api.md) | All Tauri commands and their payloads |
| [`docs/db-schema.md`](docs/db-schema.md) | SQLite table definitions |
| [`docs/changelog.md`](docs/changelog.md) | What changed and when |
| [`docs/known-issues.md`](docs/known-issues.md) | Known limitations and workarounds |
| [`docs/superpowers/specs/2026-08-13-ctrl-shell-design.md`](docs/superpowers/specs/2026-08-13-ctrl-shell-design.md) | Full design spec |
