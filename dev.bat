@echo off
cd /d "%~dp0"
echo Building ctrl-cli (debug)...
cargo build --manifest-path src-tauri\Cargo.toml --bin ctrl-cli
echo.
echo Starting CTRL dev server...
cargo tauri dev
