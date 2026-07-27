$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = $scriptRoot
$payloadRoot = Join-Path $scriptRoot "super-leader-academy-v2-2-1-payload"

if (-not (Test-Path (Join-Path $projectRoot "package.json"))) {
  Write-Host "ERROR: Copy this script, the BAT file and the payload folder into the Super Leader project folder, beside package.json." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

if (-not (Test-Path $payloadRoot)) {
  Write-Host "ERROR: The folder super-leader-academy-v2-2-1-payload is missing." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $projectRoot "backup-academy-v2-2-1-$timestamp"
$files = @(
  "src\app\actions\academy.ts",
  "src\app\dashboard\academy\page.tsx",
  "src\app\dashboard\academy\certificate\[certificateId]\page.tsx",
  "src\app\academy\verify\[token]\page.tsx",
  "src\app\dashboard\my-day\page.tsx",
  "src\i18n\messages.ts",
  "CHANGELOG.txt"
)

Write-Host "Creating backup..." -ForegroundColor Cyan
foreach ($relative in $files) {
  $source = Join-Path $projectRoot $relative
  if (Test-Path -LiteralPath $source) {
    $destination = Join-Path $backupRoot $relative
    $destinationDir = Split-Path -Parent $destination
    New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
  }
}

Write-Host "Applying Super Leader Academy V2.2.1..." -ForegroundColor Cyan
Copy-Item -Path (Join-Path $payloadRoot "*") -Destination $projectRoot -Recurse -Force

$nextCache = Join-Path $projectRoot ".next"
if (Test-Path $nextCache) {
  Write-Host "Clearing the Next.js cache..." -ForegroundColor Cyan
  Remove-Item $nextCache -Recurse -Force
}

Write-Host ""
Write-Host "SUCCESS: Super Leader Academy V2.2.1 has been installed." -ForegroundColor Green
Write-Host "REQUIRED: Run supabase/022_academy_recurring_sessions_v2_2_1.sql in Supabase SQL Editor." -ForegroundColor Yellow
Write-Host "Then restart Super Leader with start.bat." -ForegroundColor Yellow
Write-Host "Backup: $backupRoot" -ForegroundColor DarkGray
Read-Host "Press Enter to close"
