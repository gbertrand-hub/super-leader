$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = $scriptRoot
$payloadRoot = Join-Path $scriptRoot "super-leader-v2-6-3-payload"

if (-not (Test-Path (Join-Path $projectRoot "package.json"))) {
  Write-Host "ERROR: Copy the BAT file, PowerShell file and payload folder beside package.json." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

if (-not (Test-Path $payloadRoot)) {
  Write-Host "ERROR: The folder super-leader-v2-6-3-payload is missing." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $projectRoot "backup-events-v2-6-3-$timestamp"
$files = @(
  "src\components\dashboard\navigation.tsx",
  "src\lib\billing\entitlements.ts",
  "src\i18n\messages.ts"
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

Write-Host "Applying Super Leader V2.6.3..." -ForegroundColor Cyan
Copy-Item -Path (Join-Path $payloadRoot "*") -Destination $projectRoot -Recurse -Force

$changeLog = Join-Path $projectRoot "CHANGELOG.txt"
$changeLine = "SUPER LEADER V2.6.3 - EVENTS AND TEMPORARY TEAMS"
if (Test-Path $changeLog) {
  $existing = Get-Content -LiteralPath $changeLog -Raw
  if ($existing -notmatch [regex]::Escape($changeLine)) {
    Add-Content -LiteralPath $changeLog -Value "`r`n$changeLine`r`n- Event operations centre.`r`n- Cross-team temporary mission teams.`r`n- Tasks, schedule, documents and final report.`r`n- Event permissions, notifications and audit trail.`r`n"
  }
}

$nextCache = Join-Path $projectRoot ".next"
if (Test-Path $nextCache) {
  Write-Host "Clearing the Next.js cache..." -ForegroundColor Cyan
  Remove-Item $nextCache -Recurse -Force
}

Write-Host ""
Write-Host "SUCCESS: Super Leader V2.6.3 has been installed." -ForegroundColor Green
Write-Host "Run in Supabase SQL Editor:" -ForegroundColor Yellow
Write-Host "supabase/034_events_temporary_teams_v2_6_3.sql" -ForegroundColor Yellow
Write-Host "Then restart with start.bat and open /dashboard/events." -ForegroundColor Yellow
Write-Host "Before production, run: npm run build" -ForegroundColor Yellow
Write-Host "Backup: $backupRoot" -ForegroundColor DarkGray
Read-Host "Press Enter to close"
