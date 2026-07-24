$ErrorActionPreference = "Stop"
Write-Host "=== Super Leader - Mise a jour Feedback entre collegues ===" -ForegroundColor Cyan
if (-not (Test-Path "package.json")) { throw "Lance ce script depuis le dossier racine contenant package.json." }
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "backup-peer-feedback-$stamp"
New-Item -ItemType Directory -Path $backup | Out-Null
foreach ($item in @("src")) { if (Test-Path $item) { Copy-Item $item $backup -Recurse -Force } }
Copy-Item "$PSScriptRoot\payload\*" "." -Recurse -Force
Write-Host "Fichiers copies. Sauvegarde : $backup" -ForegroundColor Green
Write-Host "Verification TypeScript et production..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "Le build a echoue. Restaure le dossier $backup si necessaire." }
Write-Host "Mise a jour appliquee avec succes." -ForegroundColor Green
Write-Host "Etape manuelle restante :" -ForegroundColor Yellow
Write-Host "Executer supabase\003_peer_feedback.sql dans Supabase > SQL Editor, puis relancer npm run dev."
