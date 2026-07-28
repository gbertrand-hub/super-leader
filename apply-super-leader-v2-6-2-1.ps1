$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = $scriptRoot
$payloadRoot = Join-Path $scriptRoot "super-leader-v2-6-2-1-payload"
$targetFile = Join-Path $projectRoot "src\app\actions\performance.ts"
$payloadFile = Join-Path $payloadRoot "src\app\actions\performance.ts"

if (-not (Test-Path (Join-Path $projectRoot "package.json"))) {
  Write-Host "ERROR: Copy this script, the BAT file and the payload folder beside package.json." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

if (-not (Test-Path $payloadFile)) {
  Write-Host "ERROR: Corrected performance.ts is missing from the payload." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $projectRoot "backup-performance-action-v2-6-2-1-$timestamp"
$backupFile = Join-Path $backupRoot "src\app\actions\performance.ts"

if (Test-Path $targetFile) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $backupFile) | Out-Null
  Copy-Item -LiteralPath $targetFile -Destination $backupFile -Force
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $targetFile) | Out-Null
Copy-Item -LiteralPath $payloadFile -Destination $targetFile -Force

$content = Get-Content -LiteralPath $targetFile -Raw
if ($content -notmatch "export async function reopenWorkdayAction") {
  throw "Validation failed: reopenWorkdayAction was not found after installation."
}

$nextCache = Join-Path $projectRoot ".next"
if (Test-Path $nextCache) {
  Remove-Item $nextCache -Recurse -Force
}

Write-Host "" 
Write-Host "SUCCESS: V2.6.2.1 performance action hotfix installed." -ForegroundColor Green
Write-Host "The export reopenWorkdayAction is now present." -ForegroundColor Green
Write-Host "Backup: $backupRoot" -ForegroundColor DarkGray
Write-Host "Restart Super Leader with start.bat or npm run dev." -ForegroundColor Yellow
Write-Host "No Supabase SQL is required." -ForegroundColor Yellow
Read-Host "Press Enter to close"
