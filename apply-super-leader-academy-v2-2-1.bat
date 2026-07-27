@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0apply-super-leader-academy-v2-2-1.ps1"
endlocal
