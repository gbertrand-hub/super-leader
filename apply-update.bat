@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0apply-update.ps1"
if errorlevel 1 (
  echo.
  echo Update failed. Read the error above.
  pause
  exit /b 1
)
pause
