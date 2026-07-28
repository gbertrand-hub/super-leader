$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = $scriptRoot
$payloadRoot = Join-Path $scriptRoot "super-leader-v2-4-1-payload"

if (-not (Test-Path (Join-Path $projectRoot "package.json"))) {
  Write-Host "ERROR: Copy the BAT file, PowerShell file and payload folder beside package.json." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

if (-not (Test-Path $payloadRoot)) {
  Write-Host "ERROR: The folder super-leader-v2-4-1-payload is missing." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $projectRoot "backup-landing-v2-4-1-$timestamp"
$files = @(
  "src\app\page.tsx"
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

Write-Host "Applying Super Leader V2.4.1..." -ForegroundColor Cyan
Copy-Item -Path (Join-Path $payloadRoot "*") -Destination $projectRoot -Recurse -Force

$changeLog = Join-Path $projectRoot "CHANGELOG.txt"
$changeLine = "V2.4.1 - Landing Page commerciale & parcours de conversion"
if (Test-Path $changeLog) {
  $existing = Get-Content -LiteralPath $changeLog -Raw
  if ($existing -notmatch [regex]::Escape($changeLine)) {
    Add-Content -LiteralPath $changeLog -Value "`r`n$changeLine`r`n- Nouvelle landing page commerciale responsive FR/EN.`r`n- Parcours distincts demande de demo et acces interne iLEAD.`r`n- Presentation des fonctionnalites, du fonctionnement et de la securite.`r`n"
  }
}

$nextCache = Join-Path $projectRoot ".next"
if (Test-Path $nextCache) {
  Write-Host "Clearing the Next.js cache..." -ForegroundColor Cyan
  Remove-Item $nextCache -Recurse -Force
}

Write-Host ""
Write-Host "SUCCESS: Super Leader V2.4.1 has been installed." -ForegroundColor Green
Write-Host "No Supabase SQL migration is required." -ForegroundColor Yellow
Write-Host "Restart Super Leader with start.bat and open http://localhost:3002." -ForegroundColor Yellow
Write-Host "Test the demo form, internal access form and FR/EN display." -ForegroundColor Yellow
Write-Host "Backup: $backupRoot" -ForegroundColor DarkGray
Read-Host "Press Enter to close"
