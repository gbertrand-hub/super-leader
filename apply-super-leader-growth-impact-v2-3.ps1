$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = $scriptRoot
$payloadRoot = Join-Path $scriptRoot "super-leader-growth-impact-v2-3-payload"

if (-not (Test-Path (Join-Path $projectRoot "package.json"))) {
  Write-Host "ERROR: Copy the BAT file, the PowerShell file and the payload folder beside package.json." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

if (-not (Test-Path $payloadRoot)) {
  Write-Host "ERROR: The folder super-leader-growth-impact-v2-3-payload is missing." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $projectRoot "backup-growth-impact-v2-3-$timestamp"
$files = @(
  "src\app\actions\growth.ts",
  "src\app\dashboard\growth\page.tsx",
  "src\components\dashboard\navigation.tsx",
  "src\i18n\messages.ts",
  "src\lib\performance\scoring.ts",
  "src\app\actions\performance.ts",
  "src\app\dashboard\performance\page.tsx",
  "src\lib\storage\private-attachments.ts",
  "src\components\forms\secure-attachment-upload.tsx",
  "src\app\api\attachments\upload-url\route.ts",
  "src\app\api\attachments\[kind]\[id]\route.ts",
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

Write-Host "Applying Super Leader V2.3 - Growth Plan and Impact Contributions..." -ForegroundColor Cyan
Copy-Item -Path (Join-Path $payloadRoot "*") -Destination $projectRoot -Recurse -Force

$nextCache = Join-Path $projectRoot ".next"
if (Test-Path $nextCache) {
  Write-Host "Clearing the Next.js cache..." -ForegroundColor Cyan
  Remove-Item $nextCache -Recurse -Force
}

Write-Host ""
Write-Host "SUCCESS: Super Leader V2.3 has been installed." -ForegroundColor Green
Write-Host "IMPORTANT: Run supabase/027_growth_impact_v2_3.sql in Supabase SQL Editor." -ForegroundColor Yellow
Write-Host "Then restart Super Leader with start.bat and open /dashboard/growth." -ForegroundColor Yellow
Write-Host "Backup: $backupRoot" -ForegroundColor DarkGray
Read-Host "Press Enter to close"
