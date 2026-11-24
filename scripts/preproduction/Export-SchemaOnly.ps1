# Super Leader B4: Safe preflight for a private, schema-only Supabase dump.
# Preflight is the default. -ExportSchema is an explicit, separate operation.
# No restore, migration, production writes or copying of business data.
# Keep this file ASCII-only for compatibility with Windows PowerShell 5.1.
[CmdletBinding()]
param(
    [switch]$ExportSchema
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProductionRef = 'jjbuxrlvxnlnrjcorpwt'
$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$LinkedRefFile = Join-Path $RepoRoot 'supabase\.temp\project-ref'
$Mode = 'LOCAL PREFLIGHT ONLY'
if ($ExportSchema) { $Mode = 'SCHEMA EXPORT - EXPLICITLY REQUESTED' }

Write-Host 'SUPER LEADER B4 - PRIVATE SCHEMA-ONLY PREFLIGHT' -ForegroundColor Cyan
Write-Host ('Expected source project: ' + $ProductionRef)
Write-Host ('Mode: ' + $Mode)

# Use installed Supabase CLI if present. Otherwise, invoke the CLI using npx
# with a pinned version. This downloads only to the npm cache on first use;
# no npm dependency or lockfile is added to the application worktree.
$SupabaseCli = Get-Command 'supabase' -ErrorAction SilentlyContinue
$CliPrefixArgs = @()
if ($SupabaseCli) {
    $CliCommand = $SupabaseCli.Source
    Write-Host 'Supabase CLI executable found in PATH.'
} else {
    $NpxCli = Get-Command 'npx.cmd' -ErrorAction SilentlyContinue
    if (-not $NpxCli) {
        throw 'Supabase CLI and npx.cmd are both missing. Install Node.js/npm or Supabase CLI. No changes made.'
    }
    $CliCommand = $NpxCli.Source
    $CliPrefixArgs = @('--yes', 'supabase@2.117.0')
    Write-Host 'Supabase CLI is not installed globally; using npx with pinned supabase@2.117.0.'
    Write-Host 'First use may download the CLI to the local npm cache.'
}
$CliVersionText = (& $CliCommand @CliPrefixArgs --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
    throw 'Supabase CLI version check failed. No changes made.'
}
Write-Host ('Supabase CLI: ' + $CliVersionText)

$HelpText = (& $CliCommand @CliPrefixArgs db dump --help 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) {
    throw 'Cannot read Supabase CLI dump help. No changes made.'
}
if ($HelpText -notmatch '--schema' -or $HelpText -notmatch '--file') {
    throw 'Missing expected CLI dump flags. No changes made.'
}

if (-not (Test-Path -LiteralPath $LinkedRefFile)) {
    throw 'Linked project reference file is missing. No changes made.'
}
$LinkedRef = (Get-Content -LiteralPath $LinkedRefFile -Raw).Trim()
if ($LinkedRef -ne $ProductionRef) {
    throw ('Wrong linked Supabase project: ' + $LinkedRef + '. No changes made.')
}
Write-Host 'Local project reference matches the expected source.'
Write-Host 'This is a local check, not a live authentication check.'

if (-not (Get-Command 'docker' -ErrorAction SilentlyContinue)) {
    throw 'Docker CLI is missing from PATH. No changes made.'
}
$DockerVersion = (& docker info --format '{{.ServerVersion}}' 2>$null | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($DockerVersion)) {
    throw 'Docker engine is unavailable. Start Docker Desktop, then retry.'
}
Write-Host ('Docker engine: ' + $DockerVersion)

$PrivateRoot = if ($env:LOCALAPPDATA) {
    Join-Path $env:LOCALAPPDATA 'SuperLeader\PrivateSchemaExports'
} else {
    Join-Path $HOME '.super-leader\private-schema-exports'
}
Write-Host ('Private output location: ' + $PrivateRoot)
Write-Host 'Scope: public schema only. No business rows or auth users.'
Write-Host 'No production changes, new projects, migrations or restores.'

if (-not $ExportSchema) {
    Write-Host 'PREFLIGHT PASS' -ForegroundColor Green
    return
}

# The export is separate from preflight and must be explicitly requested.
# Never store the SQL under Git; function definitions may contain secrets.
$Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$PrivateDir = Join-Path $PrivateRoot ('schema-' + $Timestamp)
$null = New-Item -ItemType Directory -Path $PrivateDir -Force
$OutputFile = Join-Path $PrivateDir 'public-schema-only.sql'
$DumpArgs = @('db', 'dump')

# Some CLI versions expose --linked explicitly; others use the linked
# project by default. The local project reference is checked above.
if ($HelpText -match '--linked') {
    $DumpArgs += '--linked'
}
$DumpArgs += @('--schema', 'public', '--file', $OutputFile)

Write-Host 'Starting a schema-only dump from the linked project...' -ForegroundColor Yellow
try {
    Push-Location $RepoRoot
    try {
        & $CliCommand @CliPrefixArgs @DumpArgs
        $DumpExitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    if ($DumpExitCode -ne 0) {
        throw ('Supabase CLI returned exit code ' + $DumpExitCode)
    }
    if (-not (Test-Path -LiteralPath $OutputFile)) {
        throw 'Expected schema SQL file was not created.'
    }
    $OutputInfo = Get-Item -LiteralPath $OutputFile
    if ($OutputInfo.Length -eq 0) {
        throw 'Schema SQL file is empty.'
    }
    $Sha256 = (Get-FileHash -LiteralPath $OutputFile -Algorithm SHA256).Hash
    Write-Host 'SCHEMA EXPORT COMPLETED; NO RESTORE WAS PERFORMED.' -ForegroundColor Green
    Write-Host ('Private file: ' + $OutputFile)
    Write-Host ('Bytes: ' + $OutputInfo.Length)
    Write-Host ('SHA256: ' + $Sha256)
    Write-Host 'Do not upload, commit or share the SQL file: it may contain secrets.' -ForegroundColor Yellow
} catch {
    if (Test-Path -LiteralPath $OutputFile) {
        Remove-Item -LiteralPath $OutputFile -Force
    }
    throw
}
