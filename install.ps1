$ErrorActionPreference = "Stop"
Write-Host "=== Installation de Super Leader ===" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js n'est pas installe. Installez Node.js 22 LTS puis relancez ce script."
}

if (-not (Test-Path ".env.local")) {
  Copy-Item ".env.example" ".env.local"
  Write-Host "Fichier .env.local cree. Remplissez vos identifiants Supabase avant de lancer l'application." -ForegroundColor Yellow
}

npm install
Write-Host "Installation terminee." -ForegroundColor Green
Write-Host "1. Ouvrez .env.local et ajoutez vos cles Supabase."
Write-Host "2. Lancez: npm run dev"
Write-Host "3. Ouvrez: http://localhost:3002"
