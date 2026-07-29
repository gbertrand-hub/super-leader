$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = $scriptRoot
$payloadRoot = Join-Path $scriptRoot "super-leader-v2-6-5-payload"

if (-not (Test-Path (Join-Path $projectRoot "package.json"))) {
  Write-Host "ERROR: Copy the BAT file, PowerShell file and payload folder beside package.json." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

if (-not (Test-Path $payloadRoot)) {
  Write-Host "ERROR: The folder super-leader-v2-6-5-payload is missing." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $projectRoot "backup-navigation-v2-6-5-$timestamp"
$files = @(
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

Write-Host "Applying Super Leader V2.6.5..." -ForegroundColor Cyan
Copy-Item -Path (Join-Path $payloadRoot "*") -Destination $projectRoot -Recurse -Force

$changeLog = Join-Path $projectRoot "CHANGELOG.txt"
$changeLine = "SUPER LEADER V2.6.5 - NAVIGATION UNIFIEE ET MENU DYNAMIQUE"
if (Test-Path $changeLog) {
  $existing = Get-Content -LiteralPath $changeLog -Raw
  if ($existing -notmatch [regex]::Escape($changeLine)) {
    Add-Content -LiteralPath $changeLog -Value "`r`n$changeLine`r`n- Menu centralise en cinq sections fonctionnelles.`r`n- Affichage selon le role, le plan et l espace plateforme.`r`n- Modules non inclus visibles comme verrouilles pour Owner et Admin.`r`n- Couverture de toutes les pages principales du dashboard.`r`n- Traductions FR et EN harmonisees.`r`n"
  }
}

$nextCache = Join-Path $projectRoot ".next"
if (Test-Path $nextCache) {
  Write-Host "Clearing the Next.js cache..." -ForegroundColor Cyan
  Remove-Item $nextCache -Recurse -Force
}

Write-Host ""
Write-Host "SUCCESS: Super Leader V2.6.5 has been installed." -ForegroundColor Green
Write-Host "No Supabase SQL migration is required." -ForegroundColor Yellow
Write-Host "Restart with start.bat and review the sidebar with Owner, Manager and Employee accounts." -ForegroundColor Yellow
Write-Host "Before production, run: npm run build" -ForegroundColor Yellow
Write-Host "Backup: $backupRoot" -ForegroundColor DarkGray
Read-Host "Press Enter to close"
