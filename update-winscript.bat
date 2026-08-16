@echo off
title WinScript -> CTRL Updater
echo ============================================================
echo  WinScript -^> CTRL Updater
echo ============================================================
echo.
python "%~dp0tools\winscript-import.py"
echo.
echo [Builder] Regenerating data/builder JSON from WinScript source...
node "%~dp0tools\winscript-converter.js" "%~dp0..\winscript-ref" "%~dp0data\builder"
echo.
pause
