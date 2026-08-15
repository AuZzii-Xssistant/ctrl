@echo off
cd /d "%~dp0"
set MSG=%*
if "%MSG%"=="" set MSG=commit by script
git add -A
git commit -m "%MSG%"
git push
echo.
pause
