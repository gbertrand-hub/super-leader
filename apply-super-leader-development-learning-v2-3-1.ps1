$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = $scriptRoot
$payloadRoot = Join-Path $scriptRoot "super-leader-development-learning-v2-3-1-payload"

if (-not (Test-Path (Join-Path $projectRoot "package.json"))) {
  Write-Host "ERROR: Copy the BAT file, the PowerShell file and the payload folder beside package.json." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

if (-not (Test-Path $payloadRoot)) {
  Write-Host "ERROR: The folder super-leader-development-learning-v2-3-1-payload is missing." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $projectRoot "backup-development-learning-v2-3-1-$timestamp"
$files = @(
  "src\app\actions\growth.ts",
  "src\app\dashboard\growth\page.tsx",
  "src\app\actions\academy.ts",
  "src\app\dashboard\academy\page.tsx",
  "src\components\academy-course-wizard.tsx",
  "src\app\actions\performance.ts",
  "src\i18n\messages.ts",
  "README.md",
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

Write-Host "Applying Super Leader V2.3.1 - Development Learning Hours..." -ForegroundColor Cyan
Copy-Item -Path (Join-Path $payloadRoot "*") -Destination $projectRoot -Recurse -Force

$nextCache = Join-Path $projectRoot ".next"
if (Test-Path $nextCache) {
  Write-Host "Clearing the Next.js cache..." -ForegroundColor Cyan
  Remove-Item $nextCache -Recurse -Force
}

Write-Host ""
Write-Host "SUCCESS: Super Leader V2.3.1 has been installed." -ForegroundColor Green
Write-Host "IMPORTANT: Run supabase/028_development_learning_hours_v2_3_1.sql in Supabase SQL Editor." -ForegroundColor Yellow
Write-Host "Then restart Super Leader with start.bat and open /dashboard/growth." -ForegroundColor Yellow
Write-Host "Backup: $backupRoot" -ForegroundColor DarkGray
Read-Host "Press Enter to close"
