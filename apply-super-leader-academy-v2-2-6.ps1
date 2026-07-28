$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = $scriptRoot
$payloadRoot = Join-Path $scriptRoot "super-leader-academy-v2-2-6-payload"

if (-not (Test-Path (Join-Path $projectRoot "package.json"))) {
  Write-Host "ERROR: Copy this script, the BAT file and the payload folder into the Super Leader project folder, beside package.json." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

if (-not (Test-Path $payloadRoot)) {
  Write-Host "ERROR: The folder super-leader-academy-v2-2-6-payload is missing." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $projectRoot "backup-academy-v2-2-6-$timestamp"
$files = @(
  "src\app\dashboard\academy\certificate\[certificateId]\page.tsx",
  "src\app\academy\verify\[token]\page.tsx",
  "src\app\api\academy\certificate-qr\[token]\route.ts",
  "src\lib\academy\certificate-links.ts",
  "src\i18n\messages.ts",
  "public\branding\ilead-global-logo.png",
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

Write-Host "Applying Super Leader Academy V2.2.6..." -ForegroundColor Cyan
Copy-Item -Path (Join-Path $payloadRoot "*") -Destination $projectRoot -Recurse -Force

$nextCache = Join-Path $projectRoot ".next"
if (Test-Path $nextCache) {
  Write-Host "Clearing the Next.js cache..." -ForegroundColor Cyan
  Remove-Item $nextCache -Recurse -Force
}

$envFile = Join-Path $projectRoot ".env.local"
if (Test-Path $envFile) {
  $envContent = Get-Content -LiteralPath $envFile -Raw
  if ($envContent -notmatch "(?m)^NEXT_PUBLIC_SITE_URL=") {
    Write-Host "WARNING: Add NEXT_PUBLIC_SITE_URL=https://app.ileadglobal.org to .env.local and Vercel." -ForegroundColor Yellow
  }
} else {
  Write-Host "WARNING: .env.local was not found. The QR will use the Vercel URL or localhost fallback." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "SUCCESS: Super Leader Academy V2.2.6 has been installed." -ForegroundColor Green
Write-Host "No Supabase SQL migration is required." -ForegroundColor Green
Write-Host "Restart Super Leader with start.bat, then open an existing certificate and scan its QR code." -ForegroundColor Yellow
Write-Host "Backup: $backupRoot" -ForegroundColor DarkGray
Read-Host "Press Enter to close"
