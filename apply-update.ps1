$ErrorActionPreference = "Stop"

$ProjectRoot = Get-Location
if (-not (Test-Path (Join-Path $ProjectRoot "package.json"))) {
  throw "Lance ce script depuis le dossier contenant package.json."
}

$PayloadRoot = Join-Path $PSScriptRoot "payload"
$BackupRoot = Join-Path (Split-Path $ProjectRoot -Parent) ("backup-password-link-fix-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null

$Targets = @(
  "src/app/actions/members.ts",
  "src/app/page.tsx",
  "src/app/update-password/page.tsx",
  "src/components/auth/recovery-hash-redirect.tsx"
)

foreach ($RelativePath in $Targets) {
  $Existing = Join-Path $ProjectRoot $RelativePath
  if (Test-Path $Existing) {
    $BackupFile = Join-Path $BackupRoot $RelativePath
    New-Item -ItemType Directory -Force -Path (Split-Path $BackupFile -Parent) | Out-Null
    Copy-Item $Existing $BackupFile -Force
  }
}

Copy-Item (Join-Path $PayloadRoot "*") $ProjectRoot -Recurse -Force
Remove-Item (Join-Path $ProjectRoot ".next") -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Verification TypeScript..." -ForegroundColor Cyan
& npx tsc --noEmit
if ($LASTEXITCODE -ne 0) {
  throw "La verification TypeScript a echoue. Sauvegarde: $BackupRoot"
}

Write-Host "Build Next.js..." -ForegroundColor Cyan
& npm run build
if ($LASTEXITCODE -ne 0) {
  throw "Le build a echoue. Sauvegarde: $BackupRoot"
}

Write-Host "Correction installee avec succes." -ForegroundColor Green
Write-Host "Sauvegarde: $BackupRoot"
