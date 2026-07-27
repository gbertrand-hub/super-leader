@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0apply-members-hotfix.ps1"
if errorlevel 1 (
  echo.
  echo La correction a echoue.
  pause
  exit /b 1
)
echo.
pause
