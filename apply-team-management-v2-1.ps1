$ErrorActionPreference = "Stop"

$ProjectRoot = $PSScriptRoot
$PackageJson = Join-Path $ProjectRoot "package.json"
if (-not (Test-Path -LiteralPath $PackageJson)) {
  throw "Place les fichiers de cette mise a jour dans le dossier Super Leader contenant package.json."
}

$PayloadRoot = Join-Path $ProjectRoot "team-management-v2-1-payload"
if (-not (Test-Path -LiteralPath $PayloadRoot)) {
  throw "Le dossier team-management-v2-1-payload est introuvable."
}

$BackupBase = Join-Path (Split-Path $ProjectRoot -Parent) "super-leader-backups"
$BackupRoot = Join-Path $BackupBase ("team-management-v2-1-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null

$Targets = @(
  "src/app/actions/company.ts",
  "src/app/actions/members.ts",
  "src/app/dashboard/team/page.tsx",
  "src/app/dashboard/members/page.tsx",
  "src/i18n/messages.ts",
  "src/lib/auth/permissions.ts",
  "src/lib/auth/scope.ts",
  "supabase/020_team_management_v2_1.sql",
  "docs/team-management-v2-1.md",
  "docs/team-management-v2-1-test-matrix.md"
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
    throw "Fichier de mise a jour introuvable: $RelativePath"
  }

  $DestinationFile = Join-Path $ProjectRoot $RelativePath
  New-Item -ItemType Directory -Force -Path (Split-Path $DestinationFile -Parent) | Out-Null
  Copy-Item -LiteralPath $PayloadFile -Destination $DestinationFile -Force
}

Remove-Item (Join-Path $ProjectRoot ".next") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $ProjectRoot "tsconfig.tsbuildinfo") -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Gestion complete des equipes V2.1 appliquee avec succes." -ForegroundColor Green
Write-Host "Sauvegarde: $BackupRoot" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Etape Supabase obligatoire:" -ForegroundColor Yellow
Write-Host "Execute supabase\020_team_management_v2_1.sql dans SQL Editor." -ForegroundColor Yellow
Write-Host "Ensuite relance Super Leader avec start.bat." -ForegroundColor Cyan
