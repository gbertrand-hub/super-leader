$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = $scriptRoot
$payloadRoot = Join-Path $scriptRoot "super-leader-v2-5-2-payload"

if (-not (Test-Path (Join-Path $projectRoot "package.json"))) {
  Write-Host "ERROR: Copy the BAT file, PowerShell file and payload folder beside package.json." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

if (-not (Test-Path $payloadRoot)) {
  Write-Host "ERROR: The folder super-leader-v2-5-2-payload is missing." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $projectRoot "backup-free-plan-v2-5-2-$timestamp"
$files = @(
  "src\app\pricing\page.tsx",
  "src\app\signup\page.tsx",
  "src\components\acquisition\organization-signup-form.tsx",
  "src\lib\acquisition\requests.ts",
  "src\app\actions\auth.ts",
  "src\app\actions\acquisition.ts",
  "src\app\dashboard\acquisition\page.tsx",
  "src\app\dashboard\subscription\page.tsx"
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

Write-Host "Applying Super Leader V2.5.2..." -ForegroundColor Cyan
Copy-Item -Path (Join-Path $payloadRoot "*") -Destination $projectRoot -Recurse -Force

$changeLog = Join-Path $projectRoot "CHANGELOG.txt"
$changeLine = "V2.5.2 - Plan Free, limite de 5 utilisateurs et conversion vers Starter"
if (Test-Path $changeLog) {
  $existing = Get-Content -LiteralPath $changeLog -Raw
  if ($existing -notmatch [regex]::Escape($changeLine)) {
    Add-Content -LiteralPath $changeLog -Value "`r`n$changeLine`r`n- Nouveau plan Free public a 0 USD.`r`n- Limite de 5 utilisateurs actifs, proprietaire inclus.`r`n- Demande d activation gratuite et approbation dans le pipeline Acquisition.`r`n- Attribution automatique du plan demande lors de la conversion.`r`n- Appel a l action pour passer vers Starter.`r`n- Aucun paiement reel active.`r`n"
  }
}

$nextCache = Join-Path $projectRoot ".next"
if (Test-Path $nextCache) {
  Write-Host "Clearing the Next.js cache..." -ForegroundColor Cyan
  Remove-Item $nextCache -Recurse -Force
}

Write-Host ""
Write-Host "SUCCESS: Super Leader V2.5.2 has been installed." -ForegroundColor Green
Write-Host "REQUIRED: Run supabase/032_free_plan_v2_5_2.sql in Supabase SQL Editor." -ForegroundColor Yellow
Write-Host "Restart with start.bat and test /pricing, /signup?plan=free and /dashboard/acquisition." -ForegroundColor Yellow
Write-Host "Live payments remain disabled." -ForegroundColor Yellow
Write-Host "Backup: $backupRoot" -ForegroundColor DarkGray
Read-Host "Press Enter to close"
