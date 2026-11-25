# SUPER LEADER B6 - development restart/readiness gate.
# Read-only: checks private lab, network posture, local code, and selected runtime config.
# No SQL replay, cloud calls, Docker changes, EFOS operations, Vercel actions or secrets printed.
[CmdletBinding()]
param([switch]$RunTests)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ExpectedRepo = 'C:\Projects\SUPER-LEADER\super-leader-v4-10-141-audit'
$Repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
if (-not $Repo.Equals($ExpectedRepo,[StringComparison]::OrdinalIgnoreCase)) {
    throw 'STOP: only the dedicated Super Leader audit worktree is allowed.'
}
$Lab = Join-Path $env:LOCALAPPDATA 'SuperLeader\PreprodLab-B5'
$Cfg = Join-Path $Lab 'supabase\config.toml'
$Sql = Join-Path $env:LOCALAPPDATA 'SuperLeader\PrivateSchemaExports\schema-20261124-211550-347\public-schema-only.sql'
$SqlHash = 'F126AFE9D38B7B3C4F8C030FB03596CCAE6826CAD107E280709AB585C71D3785'
$DbName = 'supabase_db_super-leader-preprod-b5-isolated'
$FirewallName = 'SuperLeader-B5-LocalPostgres-55322-InboundBlock'
Write-Host 'SUPER LEADER B6 - DEVELOPMENT RESTART READINESS' -ForegroundColor Cyan
Write-Host 'READ ONLY - neither production nor EFOS is modified.'

function Mark {
    param([string]$Label,[string]$State)
    $Color = if ($State -eq 'PASS') { 'Green' } elseif ($State -eq 'HOLD') { 'Yellow' } else { 'Red' }
    Write-Host ('{0,-51} {1}' -f $Label,$State) -ForegroundColor $Color
}
function Run-External {
    param([string]$Exe,[string[]]$Args)
    $Output = @(& $Exe @Args 2>&1)
    if ($LASTEXITCODE -ne 0) { throw ('Local command failed: ' + $Exe) }
    return (($Output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine).Trim()
}

# Guard against running from production, cloud-linked or wrong Git tree.
$ActualRoot = Run-External -Exe 'git' -Args @('-C',$Repo,'rev-parse','--show-toplevel')
if (-not $ActualRoot.Replace('/','\').Equals($Repo,[StringComparison]::OrdinalIgnoreCase)) {
    throw 'STOP: worktree and Git root disagree.'
}
$Head = Run-External -Exe 'git' -Args @('-C',$Repo,'rev-parse','HEAD')
$AuditHead = Run-External -Exe 'git' -Args @('-C',$Repo,'rev-parse','refs/remotes/origin/audit/architecture-stability-v4-10-141')
if ($Head -ne $AuditHead) { throw 'STOP: HEAD is not the expected audit branch tip.' }
Mark 'Audit worktree at verified commit' 'PASS'

if (-not (Test-Path -LiteralPath $Cfg -PathType Leaf)) { throw 'Missing private lab config.' }
if (Test-Path -LiteralPath (Join-Path $Lab 'supabase\.temp\project-ref')) { throw 'STOP: private lab linked to remote Supabase project.' }
$Toml = [System.IO.File]::ReadAllText($Cfg)
if ($Toml -notmatch '(?m)^project_id\s*=\s*"super-leader-preprod-b5-isolated"\s*$' -or
    $Toml -match 'jjbuxrlvxnlnrjcorpwt|xehstmnqljjhacjiukvc') {
    throw 'STOP: unexpected preproduction Supabase configuration.'
}
Mark 'Private lab not linked to cloud project' 'PASS'
if (-not (Test-Path -LiteralPath $Sql -PathType Leaf)) { throw 'Private B4 schema export missing.' }
if ((Get-FileHash -LiteralPath $Sql -Algorithm SHA256).Hash -ne $SqlHash) { throw 'STOP: private B4 export fingerprint mismatch.' }
Mark 'Private schema fingerprint (no SQL displayed)' 'PASS'

$Running = Run-External -Exe 'docker' -Args @('inspect','-f','{{.State.Running}}',$DbName)
if ($Running -ne 'true') { throw 'STOP: isolated PostgreSQL is not running.' }
$Version = Run-External -Exe 'docker' -Args @('exec',$DbName,'psql','-X','-q','-tA','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c','SHOW server_version;')
if ($Version -notmatch '^17\.') { throw 'STOP: unexpected private PostgreSQL major version.' }
Mark ('Isolated PostgreSQL '+$Version) 'PASS'
$TableCount = Run-External -Exe 'docker' -Args @('exec',$DbName,'psql','-X','-q','-tA','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',"SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='public';")
if ($TableCount -ne '0') { throw 'STOP: private public schema is not empty; read-only readiness only.' }
Mark 'Private public tables: 0 (no restore yet)' 'PASS'

$Ports = Run-External -Exe 'docker' -Args @('port',$DbName,'5432/tcp')
if ($Ports -notmatch ':55322(?:\r?\n|$)') { throw 'STOP: unexpected host PostgreSQL port.' }
if (-not (Get-Command Get-NetFirewallRule -ErrorAction SilentlyContinue)) {
    throw 'Windows Firewall cmdlets missing.'
}
$Rule = Get-NetFirewallRule -Name $FirewallName -ErrorAction SilentlyContinue
if (-not $Rule) { throw 'STOP: B5 firewall rule is absent.' }
$Filter = $Rule | Get-NetFirewallPortFilter
if (-not ($Rule.Enabled -eq 'True' -and $Rule.Direction -eq 'Inbound' -and
          $Rule.Action -eq 'Block' -and $Filter.Protocol -eq 'TCP' -and
          [string]$Filter.LocalPort -eq '55322')) {
    throw 'STOP: dedicated port 55322 inbound firewall rule is invalid.'
}
Mark 'Windows dedicated inbound firewall rule' 'PASS'
if ($Ports -match '0\.0\.0\.0|\[::\]') {
    Mark 'Network isolation (bound to all interfaces)' 'HOLD'
    Write-Warning 'External-device network test or localhost-only Docker binding is required before any schema replay.'
}
else {
    Mark 'Restricted PostgreSQL bind address' 'PASS'
    Write-Host 'Note: external connectivity still requires a separate network verification.'
}

# Detect local runtime env files and only report classification, never values.
$EnvFiles = @('.env','.env.local','.env.development','.env.development.local')
$RuntimeEnv = @($EnvFiles | ForEach-Object { Join-Path $Repo $_ } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
$SensitiveConfig = $false
foreach ($File in $RuntimeEnv) {
    $EnvText = [System.IO.File]::ReadAllText($File)
    if ($EnvText -match '(?im)^\s*(?:NEXT_PUBLIC_SUPABASE_URL|SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)\s*=') {
        $SensitiveConfig = $true
    }
}
foreach ($Name in @('NEXT_PUBLIC_SUPABASE_URL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY')) {
    if ([Environment]::GetEnvironmentVariable($Name,'Process')) { $SensitiveConfig = $true }
}
if ($SensitiveConfig) {
    Mark 'Safe development server/backend configuration' 'HOLD'
    Write-Warning 'Supabase connection variables detected. Do not start dev server until target and credentials are audited.'
}
else {
    Mark 'Safe development server/backend configuration' 'HOLD'
    Write-Host 'No Supabase connection variables found; full app login is not configured.'
}

if ($RunTests) {
    if (-not (Test-Path -LiteralPath (Join-Path $Repo 'node_modules') -PathType Container)) {
        Mark 'Local stability tests (node_modules missing)' 'HOLD'
    }
    else {
        $Npm = if (Get-Command 'npm.cmd' -ErrorAction SilentlyContinue) { 'npm.cmd' } else { 'npm' }
        Push-Location -LiteralPath $Repo
        try {
            Write-Host 'Running local code-only stability suite (no database changes)...'
            & $Npm run test:stability
            if ($LASTEXITCODE -ne 0) { throw 'Local stability tests failed.' }
            Mark 'Local code stability suite' 'PASS'
        } finally { Pop-Location }
    }
}
else {
    Mark 'Local code tests (use -RunTests)' 'HOLD'
}

Write-Host ''
Write-Host 'DECISION: Code changes and regression tests in AUDIT worktree: ALLOWED.' -ForegroundColor Green
Write-Host 'DECISION: Full application login/end-to-end testing: NOT READY.' -ForegroundColor Yellow
Write-Host 'DECISION: SQL schema restore: NOT AUTHORIZED. 117 SECURITY DEFINER functions require review.' -ForegroundColor Yellow
Write-Host 'DECISION: Production deployment / EFOS modification: NOT PART OF THIS GATE.'
Write-Host 'B6 READINESS REVIEW COMPLETE - NO CHANGES APPLIED' -ForegroundColor Cyan
