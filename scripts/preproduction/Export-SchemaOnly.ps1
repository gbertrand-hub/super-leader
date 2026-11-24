# Super Leader B4 — Production schema-only extraction gate.
# Preflight by default. Pass -ExportSchema for an explicitly requested read-only dump.
# No database restore, migration, project creation, or data copy.
# Never commit/share the resulting SQL file: function definitions may contain secrets.
[CmdletBinding()]
param(
    [switch]$ExportSchema
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProductionRef = "jjbuxrlvxnlnrjcorpwt"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$LinkedRefFile = Join-Path $RepoRoot "supabase\.temp\project-ref"

Write-Host "SUPER LEADER B4 — PRIVATE SCHEMA-ONLY EXPORT" -ForegroundColor Cyan
Write-Host "Production project (source): $ProductionRef"
Write-Host "Mode: $(if ($ExportSchema) { 'READ-ONLY SCHEMA EXPORT' } else { 'LOCAL PREFLIGHT ONLY' })"

if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
    throw "Supabase CLI is not installed or not available in PATH. No changes made."
}
$cliVersion = (& supabase --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw "Could not determine Supabase CLI version." }
Write-Host "Supabase CLI: $cliVersion"

$helpText = (& supabase db dump --help 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) { throw "Cannot inspect 'supabase db dump --help'." }
if ($helpText -notmatch '--schema' -or ($helpText -notmatch '--file' -and $helpText -notmatch '\-f\b')) {
    throw "Supabase CLI db dump flags could not be verified. No export attempted."
}

$dumpArgs = @()
if ($helpText -match '--remote') {
    # CLI v3+: address the production project explicitly.
    $dumpArgs = @('db', 'dump', "--remote=$ProductionRef", '--schema', 'public', '--file')
    Write-Host "Remote source: explicitly pinned production project ref."
} elseif ($helpText -match '--linked') {
    # Older CLI: only permit the linked project if it equals production ref.
    if (-not (Test-Path $LinkedRefFile)) {
        throw "Linked project reference file not found. Cannot verify --linked target."
    }
    $linkedRef = (Get-Content -Path $LinkedRefFile -Raw).Trim()
    if ($linkedRef -ne $ProductionRef) {
        throw "Linked project is not the expected production project. No export attempted."
    }
    $dumpArgs = @('db', 'dump', '--linked', '--schema', 'public', '--file')
    Write-Host "Remote source: linked project ref verified."
} else {
    throw "Unsupported CLI flags. No export attempted."
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is not installed or not available in PATH; required by Supabase CLI dump."
}
$dockerVersion = (& docker info --format '{{.ServerVersion}}' 2>$null | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($dockerVersion)) {
    throw "Docker engine is not running. Start Docker Desktop and retry."
}
Write-Host "Docker engine: $dockerVersion"

$privateRoot = if ($env:LOCALAPPDATA) {
    Join-Path $env:LOCALAPPDATA 'SuperLeader\PrivateSchemaExports'
} else {
    Join-Path $HOME '.super-leader\private-schema-exports'
}
Write-Host "Private output root: $privateRoot"
Write-Host "Schema only: public. No auth.users, storage objects, or business table rows."
Write-Host "No project creation, no migrations, no writes to any remote database."

if (-not $ExportSchema) {
    Write-Host "PREFLIGHT PASS. To export, rerun with -ExportSchema." -ForegroundColor Green
    return
}

# The export is intentionally outside Git worktrees.
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
$dir = Join-Path $privateRoot ("schema-" + $timestamp)
$null = New-Item -Path $dir -ItemType Directory -Force
$file = Join-Path $dir 'public-schema-only.sql'

Write-Host "Starting schema-only read from production..." -ForegroundColor Yellow
try {
    & supabase @dumpArgs $file
    if ($LASTEXITCODE -ne 0) { throw "Supabase CLI dump returned exit code $LASTEXITCODE." }
    if (-not (Test-Path -LiteralPath $file)) { throw "Schema SQL file was not created." }
    $info = Get-Item -LiteralPath $file
    if ($info.Length -eq 0) { throw "Schema SQL file is empty." }
    $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
    Write-Host "EXPORT COMPLETED (NOT RESTORED)." -ForegroundColor Green
    Write-Host "Private file: $file"
    Write-Host "Bytes: $($info.Length)"
    Write-Host "SHA256: $hash"
    Write-Host "DO NOT COMMIT, UPLOAD, OR SHARE THIS SQL FILE. It may contain sensitive function definitions." -ForegroundColor Yellow
    Write-Host "Next gate: inspect SQL securely, reconstruct in disposable DB, then compare schema fingerprints."
} catch {
    if (Test-Path -LiteralPath $file) {
        Remove-Item -LiteralPath $file -Force
    }
    throw
}
