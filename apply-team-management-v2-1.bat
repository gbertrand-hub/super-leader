@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0apply-team-management-v2-1.ps1"
if errorlevel 1 (
  echo.
  echo La mise a jour a echoue.
  pause
  exit /b 1
)
echo.
pause
