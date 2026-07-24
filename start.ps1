$ErrorActionPreference = "Stop"
if (-not (Test-Path ".env.local")) {
  Write-Host "Le fichier .env.local est absent. Executez d'abord .\\install.ps1" -ForegroundColor Red
  exit 1
}
npm run dev
