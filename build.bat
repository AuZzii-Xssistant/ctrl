@echo off
cd /d "%~dp0"
cargo tauri build
echo.
echo Build complete. Binary at: src-tauri\target\release\ctrl.exe
