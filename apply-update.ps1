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
  throw "Node.js est introuvable. Installe Node.js puis relance le script."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm est introuvable. Installe Node.js puis relance le script."
}

$Drive = (Get-Item $ProjectRoot).PSDrive
if ($Drive.Free -lt 5GB) {
  $FreeGB = [math]::Round($Drive.Free / 1GB, 2)
  throw "Espace disque insuffisant sur $($Drive.Name): ($FreeGB Go libres). Libere au moins 5 Go avant la mise a jour."
}

$BackupBase = Join-Path (Split-Path $ProjectRoot -Parent) "super-leader-backups"
$BackupRoot = Join-Path $BackupBase ("feedback-automation-v2-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null

$Targets = @(
  ".env.example",
  "vercel.json",
  "docs/feedback-automation-setup.md",
  "supabase/011_feedback_automation_omnichannel.sql",
  "src/app/actions/crm.ts",
  "src/app/actions/customer-feedback.ts",
  "src/app/actions/feedback-automation.ts",
  "src/app/api/cron/feedback-automation/route.ts",
  "src/app/api/webhooks/resend/route.ts",
  "src/app/api/webhooks/twilio/route.ts",
  "src/app/api/webhooks/whatsapp/route.ts",
  "src/app/dashboard/crm/page.tsx",
  "src/app/dashboard/feedback-automation/page.tsx",
  "src/app/dashboard/page.tsx",
  "src/app/feedback/customer/[token]/page.tsx",
  "src/components/dashboard/navigation.tsx",
  "src/i18n/messages.ts",
  "src/lib/crm/feedback-automation.ts",
  "src/lib/crm/feedback-delivery.ts",
  "src/lib/crm/feedback-events.ts",
  "src/lib/crm/webhook-security.ts"
)

Write-Host "Creation de la sauvegarde..." -ForegroundColor Cyan
foreach ($RelativePath in $Targets) {
  $Existing = Join-Path $ProjectRoot $RelativePath
  if (Test-Path -LiteralPath $Existing) {
    $BackupFile = Join-Path $BackupRoot $RelativePath
    New-Item -ItemType Directory -Force -Path (Split-Path $BackupFile -Parent) | Out-Null
    Copy-Item -LiteralPath $Existing -Destination $BackupFile -Force
  }
}

Write-Host "Installation de l'automatisation omnicanale du feedback V2..." -ForegroundColor Cyan
Copy-Item (Join-Path $PayloadRoot "*") $ProjectRoot -Recurse -Force

Remove-Item (Join-Path $ProjectRoot ".next") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $ProjectRoot "tsconfig.tsbuildinfo") -Force -ErrorAction SilentlyContinue

Write-Host "Verification TypeScript..." -ForegroundColor Cyan
& npx tsc --noEmit
if ($LASTEXITCODE -ne 0) {
  throw "La verification TypeScript a echoue. Sauvegarde disponible dans: $BackupRoot"
}

Write-Host "Verification ESLint..." -ForegroundColor Cyan
& npm run lint
if ($LASTEXITCODE -ne 0) {
  throw "La verification ESLint a echoue. Sauvegarde disponible dans: $BackupRoot"
}

Write-Host "Build Next.js..." -ForegroundColor Cyan
& npm run build
if ($LASTEXITCODE -ne 0) {
  throw "Le build Next.js a echoue. Sauvegarde disponible dans: $BackupRoot"
}

Write-Host ""
Write-Host "Automatisation omnicanale du feedback V2 installee avec succes." -ForegroundColor Green
Write-Host "Sauvegarde: $BackupRoot"
Write-Host ""
Write-Host "ETAPE OBLIGATOIRE SUPABASE:" -ForegroundColor Yellow
Write-Host "Execute supabase/011_feedback_automation_omnichannel.sql dans Supabase SQL Editor."
Write-Host "La migration 010 doit deja etre installee."
Write-Host ""
Write-Host "CONFIGURATION VERCEL:" -ForegroundColor Yellow
Write-Host "Ajoute les variables des fournisseurs et CRON_SECRET dans Vercel."
Write-Host "Consulte docs/feedback-automation-setup.md."
Write-Host ""
Write-Host "Route locale:"
Write-Host "http://localhost:3002/dashboard/feedback-automation"
Write-Host ""
Write-Host "Pour publier:" -ForegroundColor Yellow
Write-Host "git add src supabase docs .env.example vercel.json"
Write-Host "git commit -m \"Add omnichannel customer feedback automation\""
Write-Host "git push origin main"
Write-Host ""
Write-Host "Le dossier payload peut rester dans le projet: il est ignore par Git."
