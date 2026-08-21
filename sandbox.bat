@echo off
REM CTRL Sandbox — runs against sandbox.db with dry-run execution (no real system changes)
set CTRL_DB=%~dp0sandbox.db
set CTRL_SANDBOX=1
echo [SANDBOX] DB: %CTRL_DB%
echo [SANDBOX] Tweaks/fixes/scripts/builder/backup/env vars/profiles will NOT run — dry-run mode active
start "" "%~dp0src-tauri\target\release\ctrl.exe"
