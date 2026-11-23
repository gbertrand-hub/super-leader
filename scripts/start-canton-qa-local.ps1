param()
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env.local"
$expectedRef = "xehstmnqljjhacjiukvc"
$prodRef = "jjbuxrlvxnlnrjcorpwt"

if (!(Test-Path $envFile)) { throw "Missing QA .env.local. Do not copy the production .env.local here." }

$values = @{}
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
        $values[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'")
    }
}
$url = [string]$values["NEXT_PUBLIC_SUPABASE_URL"]
try { $ref = ([uri]$url).Host.Split(".")[0] }
catch { throw "NEXT_PUBLIC_SUPABASE_URL is invalid." }

if ($ref -eq $prodRef) { throw "BLOCKED: production Supabase project detected. No QA writes allowed." }
if ($ref -ne $expectedRef) { throw "BLOCKED: unknown Supabase project ($ref)." }
foreach ($key in @("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY","SUPABASE_SERVICE_ROLE_KEY")) {
    if ([string]::IsNullOrWhiteSpace([string]$values[$key])) { throw "Missing $key (get its QA value from Supabase dashboard)." }
}
foreach ($key in @("CANTON_LOCAL_QA_WRITE_ENABLED","CANTON_VISITOR_ENABLE_LIVE","CANTON_TEST_DATABASE_READY")) {
    if ($values[$key] -ne "true") { throw "Expected $key=true in the QA .env.local." }
}

if ($env:VERCEL_ENV) { throw "BLOCKED: VERCEL_ENV is set. Local QA testing requires it to be unset." }
$port = 3211
$expectedSiteUrl = "http://localhost:$port"
if ([string]$values["NEXT_PUBLIC_SITE_URL"] -ne $expectedSiteUrl) {
    throw "NEXT_PUBLIC_SITE_URL must be $expectedSiteUrl in this QA .env.local."
}
$nextCmd = Join-Path $root "node_modules\.bin\next.cmd"
if (!(Test-Path $nextCmd)) { throw "Next.js is not installed. Run npm ci from this QA worktree first." }
$env:NODE_ENV = "development"
Write-Host "QA target verified: $ref" -ForegroundColor Green
Write-Host "Starting local server on $expectedSiteUrl (QA only)" -ForegroundColor Green
Set-Location $root
& $nextCmd dev -p $port
