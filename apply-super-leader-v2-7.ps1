$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = $scriptRoot
$payloadRoot = Join-Path $scriptRoot "super-leader-v2-7-payload"

if (-not (Test-Path (Join-Path $projectRoot "package.json"))) {
  Write-Host "ERROR: Copy the BAT file, PowerShell file and payload folder beside package.json." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

if (-not (Test-Path $payloadRoot)) {
  Write-Host "ERROR: The folder super-leader-v2-7-payload is missing." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $projectRoot "backup-zoom-v2-7-$timestamp"
$files = @(
  ".env.example",
  "proxy.ts",
  "src\app\actions\events.ts",
  "src\app\actions\performance.ts",
  "src\app\dashboard\events\page.tsx",
  "src\app\dashboard\my-day\page.tsx",
  "src\app\dashboard\performance\page.tsx",
  "src\components\dashboard\navigation.tsx",
  "src\i18n\messages.ts",
  "src\lib\navigation\dashboard-menu.ts"
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

Write-Host "Applying Super Leader V2.7..." -ForegroundColor Cyan
Copy-Item -Path (Join-Path $payloadRoot "*") -Destination $projectRoot -Recurse -Force

$changeLog = Join-Path $projectRoot "CHANGELOG.txt"
$changeLine = "SUPER LEADER V2.7 - ZOOM API ET PRESENCE AUTOMATIQUE"
if (Test-Path $changeLog) {
  $existing = Get-Content -LiteralPath $changeLog -Raw
  if ($existing -notmatch [regex]::Escape($changeLine)) {
    Add-Content -LiteralPath $changeLog -Value "`r`n$changeLine`r`n- Creation Zoom depuis Performance et Evenements.`r`n- Boutons Rejoindre et Demarrer comme hote.`r`n- Webhooks signes pour entree, sortie et fin de reunion.`r`n- Calcul automatique des presences, retards et durees.`r`n- Ecran d administration des integrations.`r`n"
  }
}

$nextCache = Join-Path $projectRoot ".next"
if (Test-Path $nextCache) {
  Write-Host "Clearing the Next.js cache..." -ForegroundColor Cyan
  Remove-Item $nextCache -Recurse -Force
}

Write-Host ""
Write-Host "SUCCESS: Super Leader V2.7 has been installed." -ForegroundColor Green
Write-Host "NEXT: Run supabase/035_zoom_meetings_v2_7.sql in Supabase SQL Editor." -ForegroundColor Yellow
Write-Host "Configure the four ZOOM_* variables in .env.local and Vercel." -ForegroundColor Yellow
Write-Host "Restart with start.bat, then open /dashboard/integrations." -ForegroundColor Yellow
Write-Host "Before production, run: npm run build" -ForegroundColor Yellow
Write-Host "Backup: $backupRoot" -ForegroundColor DarkGray
Read-Host "Press Enter to close"
