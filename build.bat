@echo off
cd /d "%~dp0"
echo Building CTRL (release)...
cargo tauri build
echo.
echo Build complete.
echo   App:     src-tauri\target\release\ctrl.exe
echo   CLI:     src-tauri\target\release\ctrl-cli.exe
echo.
echo Copy both to your portable CTRL folder.
