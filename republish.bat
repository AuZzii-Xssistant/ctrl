@echo off
cd /d "%~dp0"
setlocal

set TAG=v0.1.0-beta
set APP=src-tauri\target\release\ctrl.exe
set CLI=src-tauri\target\release\ctrl-cli.exe
set NSIS=src-tauri\target\release\bundle\nsis\CTRL_0.1.0_x64-setup.exe

echo Checking build artifacts...
if not exist "%APP%"  ( echo MISSING: %APP%  - run build.bat first & pause & exit /b 1 )
if not exist "%CLI%"  ( echo MISSING: %CLI%  - run build.bat first & pause & exit /b 1 )
if not exist "%NSIS%" ( echo MISSING: %NSIS% - run build.bat first & pause & exit /b 1 )

echo Deleting existing release + tag (%TAG%)...
gh release delete %TAG% --yes 2>nul
git push origin --delete %TAG% 2>nul
git tag -d %TAG% 2>nul

echo Re-tagging and pushing...
git tag %TAG%
git push origin %TAG%

echo Creating release...
gh release create %TAG% "%APP%" "%CLI%" "%NSIS%" ^
  --title "CTRL %TAG%" ^
  --notes "Early beta - may have a lot of bugs. Use at your own risk."

echo.
echo Republished %TAG%.
endlocal
pause
