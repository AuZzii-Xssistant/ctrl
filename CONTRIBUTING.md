# Contributing to >_ CTRL

Contributions and issues are welcome. This is a small, actively-changing personal project — read `docs/known-issues.md` first to see what's genuinely stable vs. still shifting before building on top of something.

## Before you start

- **Bug?** Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.yml) — include your version (Settings → App Info) and repro steps.
- **Feature idea?** Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.yml), or check [`docs/ROADMAP.md`](docs/ROADMAP.md) first — it might already be scoped (or deliberately excluded, see that file's bottom section).
- **Not sure yet?** Open a [Discussion](https://github.com/AuZzii-Xssistant/ctrl/discussions) instead of an issue.

## Dev setup

- **Framework:** Tauri v2 (Rust backend, WebView2 frontend), vanilla JS/CSS — no frameworks, no build step for the frontend.
- **Run:** `dev.bat` (hot reload)
- **Build:** `build.bat` (produces `ctrl.exe` + `ctrl-cli.exe`)
- **Database:** SQLite, schema in [`docs/db-schema.md`](docs/db-schema.md), migrations are additive-only in `src-tauri/src/db.rs` — never a destructive schema change.

Other scripts in the repo root:
- **`sandbox.bat`** — runs against a separate `sandbox.db` with `CTRL_SANDBOX=1` set, which makes fixes/scripts/tweaks/builder/backup/env-var-edits/profiles return a dry-run preview (or silent no-op) instead of actually executing. Use this to poke around without touching your real system.
- **`update-winscript.bat`** — regenerates `data/builder/*.json` from a WinScript reference checkout (`tools/winscript-import.py` + `tools/winscript-converter.js`); only relevant if you're re-syncing Builder's ported action set.
- **`republish.bat`** — deletes and recreates the current version's GitHub release/tag from a fresh local build, always as a pre-release. Maintainer-only.
- **`commit.bat`** — a thin `git add -A && git commit && git push` convenience wrapper.

## Code style

- **Rust:** `cargo fmt`, `cargo clippy` clean before you open a PR.
- **JS:** vanilla, no frameworks — match the patterns already in the file you're editing.
- **CSS:** use the existing CSS variables (`--bg`, `--amber`, etc.), never hardcode colors.
- **Icons:** [Tabler Icons](https://tabler.io/icons) only (`ti-*` classes), never emoji in the UI.
- **This is a desktop app, not a website:** no `alert()`/`confirm()`/`prompt()` (use the custom modal component), no browser context menus, no external CDN links — everything ships bundled in the binary.

## Documentation is not optional

If your change adds a Tauri command, update [`docs/api.md`](docs/api.md). If it changes the schema, update [`docs/db-schema.md`](docs/db-schema.md). If it adds/removes/renames a nav module, update the module table in `README.md`. If you find or fix a bug worth remembering, add a line to [`docs/known-issues.md`](docs/known-issues.md). The [PR template](.github/PULL_REQUEST_TEMPLATE.md) checklist covers all of this — go through it before opening.

## Testing

There's no automated test suite yet — verification is `cargo check`/`cargo clippy` plus actually running the app (`dev.bat`) and exercising the change by hand. "It compiles" is not "it works" for a desktop app; please confirm the change actually behaves correctly in the running app before opening a PR.
