$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$payload = Join-Path $root "payload"

if (-not (Test-Path (Join-Path $root "package.json"))) {
  Write-Host "ERREUR: place apply-update.ps1, apply-update.bat and payload in the project root (same folder as package.json)." -ForegroundColor Red
  exit 1
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = Join-Path $root "backup-vercel-supabase-fix-$stamp"
New-Item -ItemType Directory -Force -Path $backup | Out-Null

$files = @(
  "proxy.ts",
  "src/lib/supabase/env.ts",
  "src/lib/supabase/server.ts",
  "src/lib/supabase/client.ts",
  "src/lib/supabase/admin.ts",
  "src/app/actions/auth.ts",
  "src/app/api/diagnostic/supabase/route.ts"
)

foreach ($relative in $files) {
  $source = Join-Path $root $relative
  if (Test-Path $source) {
    $destination = Join-Path $backup $relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    Copy-Item $source $destination -Force
  }
}

Copy-Item (Join-Path $payload "*") $root -Recurse -Force

Write-Host "Update copied. Backup: $backup" -ForegroundColor Green
Write-Host "Running build verification..." -ForegroundColor Cyan
npm run build

Write-Host "DONE. Next: git add ., commit, push, then open /api/diagnostic/supabase on the production domain." -ForegroundColor Green
