$ErrorActionPreference = "Stop"

$ProjectRoot = $PSScriptRoot
$PackageJson = Join-Path $ProjectRoot "package.json"
if (-not (Test-Path -LiteralPath $PackageJson)) {
  throw "Place les fichiers de ce correctif dans le dossier Super Leader contenant package.json."
}

$PayloadRoot = Join-Path $ProjectRoot "members-hotfix-payload"
if (-not (Test-Path -LiteralPath $PayloadRoot)) {
  throw "Le dossier members-hotfix-payload est introuvable."
}

$BackupBase = Join-Path (Split-Path $ProjectRoot -Parent) "super-leader-backups"
$BackupRoot = Join-Path $BackupBase ("members-display-hotfix-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null

$Targets = @(
  "src/app/dashboard/members/page.tsx",
  "src/app/dashboard/company/page.tsx"
)

foreach ($RelativePath in $Targets) {
  $CurrentFile = Join-Path $ProjectRoot $RelativePath
  if (Test-Path -LiteralPath $CurrentFile) {
    $BackupFile = Join-Path $BackupRoot $RelativePath
    New-Item -ItemType Directory -Force -Path (Split-Path $BackupFile -Parent) | Out-Null
    Copy-Item -LiteralPath $CurrentFile -Destination $BackupFile -Force
  }

  $PayloadFile = Join-Path $PayloadRoot $RelativePath
  if (-not (Test-Path -LiteralPath $PayloadFile)) {
    throw "Fichier du correctif introuvable: $RelativePath"
  }

  $DestinationFile = Join-Path $ProjectRoot $RelativePath
  New-Item -ItemType Directory -Force -Path (Split-Path $DestinationFile -Parent) | Out-Null
  Copy-Item -LiteralPath $PayloadFile -Destination $DestinationFile -Force
}

Remove-Item (Join-Path $ProjectRoot ".next") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $ProjectRoot "tsconfig.tsbuildinfo") -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Correction Collaborateurs appliquee avec succes." -ForegroundColor Green
Write-Host "Aucune requete SQL Supabase n'est necessaire." -ForegroundColor Yellow
Write-Host "Ferme puis relance Super Leader avec start.bat." -ForegroundColor Cyan
Write-Host "Sauvegarde: $BackupRoot"
