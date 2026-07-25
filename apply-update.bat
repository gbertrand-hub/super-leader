@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0apply-update.ps1"
if errorlevel 1 (
  echo.
  echo La correction a rencontre une erreur.
  pause
  exit /b 1
)
echo.
echo Correction terminee.
pause
