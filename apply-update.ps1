$ErrorActionPreference = "Stop"

$ProjectRoot = Get-Location
if (-not (Test-Path (Join-Path $ProjectRoot "package.json"))) {
  throw "Lance ce script depuis le dossier Super Leader contenant package.json."
}

$PayloadRoot = Join-Path $PSScriptRoot "payload"
if (-not (Test-Path $PayloadRoot)) {
  throw "Le dossier payload est introuvable. Copie payload, apply-update.bat et apply-update.ps1 dans le projet."
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js est introuvable."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm est introuvable."
}

$Drive = (Get-Item $ProjectRoot).PSDrive
if ($Drive.Free -lt 2GB) {
  $FreeGB = [math]::Round($Drive.Free / 1GB, 2)
  throw "Espace disque insuffisant sur $($Drive.Name): $FreeGB Go libres. Libere au moins 2 Go."
}

$BackupBase = Join-Path (Split-Path $ProjectRoot -Parent) "super-leader-backups"
$BackupRoot = Join-Path $BackupBase ("temporary-password-v1-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null

$FilesToBackup = @(
  ".env.example",
  "proxy.ts",
  "src/app/actions/auth.ts",
  "src/app/actions/members.ts",
  "src/app/dashboard/layout.tsx",
  "src/app/login/page.tsx",
  "src/components/members/manual-access-controls.tsx",
  "src/i18n/messages.ts"
)

foreach ($RelativePath in $FilesToBackup) {
  $SourceFile = Join-Path $ProjectRoot $RelativePath
  if (Test-Path -LiteralPath $SourceFile) {
    $BackupFile = Join-Path $BackupRoot $RelativePath
    New-Item -ItemType Directory -Force -Path (Split-Path $BackupFile -Parent) | Out-Null
    Copy-Item -LiteralPath $SourceFile -Destination $BackupFile -Force
  }
}

$DirectoriesToBackup = @(
  "src/app/change-password-required",
  "src/app/auth/temporary-access-expired",
  "src/lib/auth"
)
foreach ($RelativePath in $DirectoriesToBackup) {
  $SourceDirectory = Join-Path $ProjectRoot $RelativePath
  if (Test-Path -LiteralPath $SourceDirectory) {
    $BackupDirectory = Join-Path $BackupRoot $RelativePath
    New-Item -ItemType Directory -Force -Path (Split-Path $BackupDirectory -Parent) | Out-Null
    Copy-Item -LiteralPath $SourceDirectory -Destination $BackupDirectory -Recurse -Force
  }
}

Write-Host "Installation de Premiere connexion & Mot de passe temporaire V1..." -ForegroundColor Cyan
Get-ChildItem -LiteralPath $PayloadRoot -Force | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $ProjectRoot -Recurse -Force
}

# Evite qu'ESLint analyse une seconde copie du code dans payload.
Remove-Item $PayloadRoot -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $ProjectRoot ".next") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $ProjectRoot "tsconfig.tsbuildinfo") -Force -ErrorAction SilentlyContinue

Write-Host "Verification TypeScript..." -ForegroundColor Cyan
& npx tsc --noEmit
if ($LASTEXITCODE -ne 0) {
  throw "La verification TypeScript a echoue. Sauvegarde: $BackupRoot"
}

Write-Host "Verification ESLint..." -ForegroundColor Cyan
& npm run lint
if ($LASTEXITCODE -ne 0) {
  throw "ESLint a echoue. Sauvegarde: $BackupRoot"
}

Write-Host "Build Next.js..." -ForegroundColor Cyan
& npm run build
if ($LASTEXITCODE -ne 0) {
  throw "Le build Next.js a echoue. Sauvegarde: $BackupRoot"
}

Write-Host ""
Write-Host "Premiere connexion & Mot de passe temporaire V1 installe avec succes." -ForegroundColor Green
Write-Host "Sauvegarde: $BackupRoot"
Write-Host ""
Write-Host "Etape Supabase obligatoire:" -ForegroundColor Yellow
Write-Host "Execute supabase\018_temporary_password_first_login.sql dans SQL Editor."
Write-Host "Puis teste: http://localhost:3002/dashboard/members"
