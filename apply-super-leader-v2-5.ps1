$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = $scriptRoot
$payloadRoot = Join-Path $scriptRoot "super-leader-v2-5-payload"

if (-not (Test-Path (Join-Path $projectRoot "package.json"))) {
  Write-Host "ERROR: Copy the BAT file, PowerShell file and payload folder beside package.json." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

if (-not (Test-Path $payloadRoot)) {
  Write-Host "ERROR: The folder super-leader-v2-5-payload is missing." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $projectRoot "backup-subscriptions-v2-5-$timestamp"
$files = @(
  ".env.example",
  "src\app\page.tsx",
  "src\app\dashboard\page.tsx",
  "src\app\dashboard\layout.tsx",
  "src\components\dashboard\navigation.tsx",
  "src\i18n\messages.ts",
  "src\app\actions\acquisition.ts",
  "src\app\actions\company.ts",
  "src\app\actions\members.ts",
  "src\app\actions\academy.ts",
  "src\app\actions\growth.ts",
  "src\app\actions\sales.ts",
  "src\app\actions\collections.ts",
  "src\app\actions\crm.ts",
  "src\app\actions\feedback-automation.ts",
  "src\app\actions\performance.ts",
  "src\app\actions\feedback.ts",
  "src\app\actions\recognition.ts"
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

Write-Host "Applying Super Leader V2.5..." -ForegroundColor Cyan
Copy-Item -Path (Join-Path $payloadRoot "*") -Destination $projectRoot -Recurse -Force

$envFile = Join-Path $projectRoot ".env.local"
if (Test-Path $envFile) {
  $envContent = Get-Content -LiteralPath $envFile -Raw
  if ($envContent -notmatch "(?m)^SUPER_LEADER_BILLING_MODE=") {
    Add-Content -LiteralPath $envFile -Value "`r`n# Super Leader V2.5 - billing test mode`r`nSUPER_LEADER_BILLING_MODE=test"
  }
  if ($envContent -notmatch "(?m)^SUPER_LEADER_BILLING_PROVIDER=") {
    Add-Content -LiteralPath $envFile -Value "SUPER_LEADER_BILLING_PROVIDER=manual"
  }
}

$changeLog = Join-Path $projectRoot "CHANGELOG.txt"
$changeLine = "V2.5 - Plans, abonnements & controle des fonctionnalites"
if (Test-Path $changeLog) {
  $existing = Get-Content -LiteralPath $changeLog -Raw
  if ($existing -notmatch [regex]::Escape($changeLine)) {
    Add-Content -LiteralPath $changeLog -Value "`r`n$changeLine`r`n- Catalogue Starter, Growth et Enterprise configurable.`r`n- Essais, suspensions, annulations programmees et plan historique protege.`r`n- Controle des modules, limites de collaborateurs, coupons et factures de test.`r`n- Page publique /pricing. Aucun paiement reel active.`r`n"
  }
}

$nextCache = Join-Path $projectRoot ".next"
if (Test-Path $nextCache) {
  Write-Host "Clearing the Next.js cache..." -ForegroundColor Cyan
  Remove-Item $nextCache -Recurse -Force
}

Write-Host ""
Write-Host "SUCCESS: Super Leader V2.5 has been installed." -ForegroundColor Green
Write-Host "REQUIRED: Run supabase/030_subscriptions_feature_control_v2_5.sql in Supabase SQL Editor." -ForegroundColor Yellow
Write-Host "Restart with start.bat and open http://localhost:3002/dashboard/subscription." -ForegroundColor Yellow
Write-Host "The billing mode is TEST/MANUAL. No live payment is enabled." -ForegroundColor Yellow
Write-Host "Backup: $backupRoot" -ForegroundColor DarkGray
Read-Host "Press Enter to close"
