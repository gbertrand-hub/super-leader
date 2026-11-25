# Super Leader B5.4 - isolated PostgreSQL 17 startup (database only).
# Default: checks only. -StartDatabase launches ONLY the local B5 database.
# No dump restore, no schema SQL, no cloud project, no destructive Docker commands.
[CmdletBinding()]
param([switch]$StartDatabase)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Lab = Join-Path $env:LOCALAPPDATA 'SuperLeader\PreprodLab-B5'
$DbName = 'supabase_db_super-leader-preprod-b5-isolated'
$Config = Join-Path $Lab 'supabase\config.toml'
$CheckScript = Join-Path $PSScriptRoot 'Verify-LocalLab.ps1'

Write-Host 'SUPER LEADER B5.4 - ISOLATED DATABASE-ONLY START' -ForegroundColor Cyan
Write-Host ('Mode: ' + $(if ($StartDatabase) { 'START LOCAL DATABASE ONLY' } else { 'PREFLIGHT ONLY' }))
if (-not (Test-Path -LiteralPath $CheckScript -PathType Leaf)) {
    throw 'Missing B5 readiness verifier.'
}
& $CheckScript
if (-not (Test-Path -LiteralPath $Config -PathType Leaf)) { throw 'Missing isolated lab config.' }
if (-not (Get-Command 'npx.cmd' -ErrorAction SilentlyContinue)) { throw 'npx.cmd missing.' }
if (-not (Get-Command 'docker' -ErrorAction SilentlyContinue)) { throw 'Docker missing.' }

$FreeBytes = (Get-PSDrive -Name C).Free
$FreeGiB = [math]::Round($FreeBytes / 1GB, 2)
Write-Host ('C: free disk: ' + $FreeGiB + ' GiB')
if ($FreeGiB -lt 10) {
    throw 'C: has under 10 GiB free. Do not start more Docker images.'
}

$MemoryBytesText = (& docker info --format '{{.MemTotal}}' 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $MemoryBytesText -notmatch '^\d+$') {
    throw 'Docker memory is unavailable.'
}
$MemoryGiB = [math]::Round([double]::Parse($MemoryBytesText) / 1GB, 2)
Write-Host ('Docker memory: ' + $MemoryGiB + ' GiB')
if ($MemoryGiB -lt 3.25) {
    throw 'Docker memory under 3.25 GiB. Database-only startup is not safe.'
}
Write-Host 'Full Supabase stack is NOT permitted by this script.'
Write-Host 'Existing EFOS containers will not be stopped or modified.'

$Existing = @(& docker ps --all --format '{{.Names}}')
if ($LASTEXITCODE -ne 0) { throw 'Cannot list Docker containers safely.' }
if ($Existing -contains $DbName) {
    Write-Host ('Local lab PostgreSQL container already exists: ' + $DbName) -ForegroundColor Yellow
    Write-Host 'Do not recreate or reset it. Inspect with docker ps -a.'
    return
}

if (-not $StartDatabase) {
    Write-Host 'B5.4 PREFLIGHT PASS: no containers started.' -ForegroundColor Green
    Write-Host 'Next: rerun with -StartDatabase to start local PostgreSQL only.'
    return
}

# Supabase CLI local db start requires this private lab directory as current working directory.
# The CLI version is pinned and --help is checked before running any startup.
Push-Location -LiteralPath $Lab
try {
    Write-Host 'Checking the pinned CLI database command...'
    & npx.cmd --yes supabase@2.117.0 db start --help | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'Supabase 2.117.0 db start --help failed. Database not started.'
    }
    Write-Host 'Starting ONLY private local Supabase PostgreSQL (no cloud link, no SQL dump)...' -ForegroundColor Cyan
    # PowerShell 5.1 native stderr may be verbose; exit code is authoritative.
    & npx.cmd --yes supabase@2.117.0 db start
    if ($LASTEXITCODE -ne 0) {
        throw 'Local database startup failed. Existing EFOS containers were not targeted.'
    }
} finally {
    Pop-Location
}
$NamesAfter = @(& docker ps --format '{{.Names}}')
if ($LASTEXITCODE -ne 0) { throw 'Database started but Docker verification failed.' }
if ($NamesAfter -notcontains $DbName) {
    throw 'Supabase command returned success, but expected isolated database container was not found.'
}
Write-Host ('B5.4 ISOLATED DATABASE STARTED: ' + $DbName) -ForegroundColor Green
Write-Host 'No production data restored. No public schema imported.'
Write-Host 'Next gate: local PostgreSQL version/role/extension check before any SQL replay.'
