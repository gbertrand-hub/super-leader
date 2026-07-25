@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0apply-update.ps1"
if errorlevel 1 (
  echo.
  echo La mise a jour a echoue. Lis le message ci-dessus.
  pause
  exit /b 1
)
pause
