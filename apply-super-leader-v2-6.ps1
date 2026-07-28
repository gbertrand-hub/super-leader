$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = $scriptRoot
$payloadRoot = Join-Path $scriptRoot "super-leader-v2-6-payload"

if (-not (Test-Path (Join-Path $projectRoot "package.json"))) {
  Write-Host "ERROR: Copy the BAT file, PowerShell file and payload folder beside package.json." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

if (-not (Test-Path $payloadRoot)) {
  Write-Host "ERROR: The folder super-leader-v2-6-payload is missing." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $projectRoot "backup-day-report-time-v2-6-$timestamp"
$files = @(
  "src\app\actions\performance.ts",
  "src\app\dashboard\performance\page.tsx",
  "src\app\dashboard\my-day\page.tsx",
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

Write-Host "Applying Super Leader V2.6..." -ForegroundColor Cyan
Copy-Item -Path (Join-Path $payloadRoot "*") -Destination $projectRoot -Recurse -Force

$changeLog = Join-Path $projectRoot "CHANGELOG.txt"
$changeLine = "SUPER LEADER V2.6 - GOUVERNANCE DE MA JOURNEE, RAPPORTS ET TEMPS"
if (Test-Path $changeLog) {
  $existing = Get-Content -LiteralPath $changeLog -Raw
  if ($existing -notmatch [regex]::Escape($changeLine)) {
    Add-Content -LiteralPath $changeLog -Value "`r`n$changeLine`r`n- Confirmation avant la cloture de la journee.`r`n- Reouverture controlee avec motif, notification, audit et ancienne heure conservee.`r`n- Rapport unique, verrouille apres soumission et versions archivees avant correction.`r`n- Calcul du temps total, hors planning, de nuit et de week-end, y compris apres minuit.`r`n- Alerte de bien-etre configurable sans paiement automatique.`r`n- Acces direct Mes reunions dans Ma journee.`r`n"
  }
}

$nextCache = Join-Path $projectRoot ".next"
if (Test-Path $nextCache) {
  Write-Host "Clearing the Next.js cache..." -ForegroundColor Cyan
  Remove-Item $nextCache -Recurse -Force
}

Write-Host ""
Write-Host "SUCCESS: Super Leader V2.6 has been installed." -ForegroundColor Green
Write-Host "REQUIRED: Run supabase/033_day_report_time_governance_v2_6.sql in Supabase SQL Editor." -ForegroundColor Yellow
Write-Host "Restart with start.bat, then test Ma journee and Performance." -ForegroundColor Yellow
Write-Host "Before production, run: npm run build" -ForegroundColor Yellow
Write-Host "Backup: $backupRoot" -ForegroundColor DarkGray
Read-Host "Press Enter to close"
