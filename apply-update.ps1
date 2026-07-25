$ErrorActionPreference = "Stop"

$root = (Get-Location).Path
$packageJson = Join-Path $root "package.json"

if (-not (Test-Path $packageJson)) {
  Write-Host "ERREUR : lance ce script depuis le dossier contenant package.json." -ForegroundColor Red
  exit 1
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = Join-Path $root "backup-production-cleanup-$stamp"
New-Item -ItemType Directory -Path $backup -Force | Out-Null

$itemsToBackup = @(
  "src\app\actions\company.ts",
  ".env.example",
  "src\app\api\diagnostic\supabase"
)

foreach ($relativePath in $itemsToBackup) {
  $source = Join-Path $root $relativePath
  if (Test-Path $source) {
    $destination = Join-Path $backup $relativePath
    $destinationParent = Split-Path $destination -Parent
    New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
    Copy-Item $source $destination -Recurse -Force
  }
}

$payload = Join-Path $PSScriptRoot "payload"
Copy-Item (Join-Path $payload "*") $root -Recurse -Force

$diagnosticRoute = Join-Path $root "src\app\api\diagnostic\supabase"
if (Test-Path $diagnosticRoute) {
  Remove-Item $diagnosticRoute -Recurse -Force
  Write-Host "Route temporaire de diagnostic supprimée." -ForegroundColor Yellow
}

Write-Host "Sauvegarde créée : $backup" -ForegroundColor Cyan
Write-Host "Vérification du projet..." -ForegroundColor Cyan

npm run build
if ($LASTEXITCODE -ne 0) {
  Write-Host "Le build a échoué. Les fichiers précédents sont dans : $backup" -ForegroundColor Red
  exit $LASTEXITCODE
}

Write-Host "Mise à jour appliquée avec succès." -ForegroundColor Green
Write-Host "Prochaine étape : git add ., git commit, puis git push." -ForegroundColor Green
