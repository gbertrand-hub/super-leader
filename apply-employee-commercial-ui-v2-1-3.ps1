$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = $scriptRoot
$payloadRoot = Join-Path $scriptRoot "employee-commercial-ui-v2-1-3-payload"

if (-not (Test-Path (Join-Path $projectRoot "package.json"))) {
  Write-Host "ERROR: Copy this script, the BAT file and the payload folder into the Super Leader project folder, beside package.json." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

if (-not (Test-Path $payloadRoot)) {
  Write-Host "ERROR: The folder employee-commercial-ui-v2-1-3-payload is missing." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $projectRoot "backup-v2-1-3-$timestamp"
$files = @(
  "src\i18n\messages.ts",
  "src\app\dashboard\sales\page.tsx",
  "src\app\dashboard\collections\page.tsx",
  "src\app\dashboard\crm\[clientId]\page.tsx",
  "src\app\actions\crm.ts"
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

Write-Host "Applying Super Leader V2.1.3..." -ForegroundColor Cyan
Copy-Item -Path (Join-Path $payloadRoot "*") -Destination $projectRoot -Recurse -Force

$nextCache = Join-Path $projectRoot ".next"
if (Test-Path $nextCache) {
  Write-Host "Clearing the Next.js cache..." -ForegroundColor Cyan
  Remove-Item $nextCache -Recurse -Force
}

Write-Host "" 
Write-Host "SUCCESS: Super Leader V2.1.3 has been installed." -ForegroundColor Green
Write-Host "No Supabase SQL query is required." -ForegroundColor Green
Write-Host "Restart Super Leader with start.bat." -ForegroundColor Yellow
Write-Host "Backup: $backupRoot" -ForegroundColor DarkGray
Read-Host "Press Enter to close"
