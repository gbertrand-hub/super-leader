$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$payload = Join-Path $root "payload"
$projectFile = Join-Path $root "package.json"

if (-not (Test-Path $projectFile)) {
  Write-Host "ERREUR: place apply-update.ps1, apply-update.bat et payload dans le dossier qui contient package.json." -ForegroundColor Red
  exit 1
}

$target = Join-Path $root "src\app\api\diagnostic\supabase\route.ts"
$backupDir = Join-Path $root ("backup-supabase-diagnostic-" + (Get-Date -Format "yyyyMMdd-HHmmss"))

if (Test-Path $target) {
  New-Item -ItemType Directory -Force -Path (Join-Path $backupDir "src\app\api\diagnostic\supabase") | Out-Null
  Copy-Item $target (Join-Path $backupDir "src\app\api\diagnostic\supabase\route.ts") -Force
}

Copy-Item (Join-Path $payload "*") $root -Recurse -Force

Write-Host "Diagnostic V2 installe. Sauvegarde: $backupDir" -ForegroundColor Green
Write-Host "Verification du build..." -ForegroundColor Cyan
npm run build

Write-Host "TERMINE. Execute maintenant git add ., git commit et git push." -ForegroundColor Green
