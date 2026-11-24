# Super Leader B5 - Safely initialize a PRIVATE local Supabase lab.
# Default: preflight only. -Initialize: create local config only.
# Does NOT start containers, restore SQL, run migrations or contact production.
# Keep ASCII for Windows PowerShell 5.1.
[CmdletBinding()]
param(
    [switch]$Initialize
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$LabId = 'super-leader-preprod-b5-isolated'
$ExpectedHash = 'F126AFE9D38B7B3C4F8C030FB03596CCAE6826CAD107E280709AB585C71D3785'
$Root = Join-Path $env:LOCALAPPDATA 'SuperLeader\PreprodLab-B5'
$PrivateDump = Join-Path $env:LOCALAPPDATA 'SuperLeader\PrivateSchemaExports\schema-20261124-211550-347\public-schema-only.sql'
$Config = Join-Path $Root 'supabase\config.toml'

function Run-LocalTool {
    param(
        [string]$Tool,
        [string[]]$Arguments,
        [string]$Description
    )
    # Native tools may print harmless warnings to stderr.
    $ErrorActionPreference = 'Continue'
    $Output = (& $Tool @Arguments 2>&1 | Out-String)
    $ExitCode = $LASTEXITCODE
    if ($ExitCode -ne 0) {
        throw ($Description + ' failed with exit code ' + $ExitCode + '. Review locally, without sharing secrets.')
    }
    return $Output.Trim()
}

Write-Host 'SUPER LEADER B5 - ISOLATED LOCAL LAB' -ForegroundColor Cyan
Write-Host ('Mode: ' + $(if ($Initialize) { 'INITIALIZE PRIVATE CONFIG ONLY' } else { 'PREFLIGHT ONLY' }))
Write-Host ('Lab folder: ' + $Root)
Write-Host 'Remote Supabase projects and production remain untouched.'

if (-not (Test-Path -LiteralPath $PrivateDump -PathType Leaf)) {
    throw 'Expected private schema dump is missing. No changes made.'
}
$ActualHash = (Get-FileHash -LiteralPath $PrivateDump -Algorithm SHA256).Hash
if ($ActualHash -ne $ExpectedHash) {
    throw 'Private schema dump SHA256 does not match the verified B4 snapshot.'
}
Write-Host 'B4 SQL fingerprint matches. The SQL file will not be copied.'

$Npx = Get-Command 'npx.cmd' -ErrorAction SilentlyContinue
if (-not $Npx) {
    throw 'npx.cmd unavailable. No changes made.'
}
$Docker = Get-Command 'docker' -ErrorAction SilentlyContinue
if (-not $Docker) {
    throw 'Docker CLI unavailable. No changes made.'
}
$Version = Run-LocalTool -Tool $Docker.Source -Arguments @('info','--format','{{.ServerVersion}}') -Description 'Docker engine'
Write-Host ('Docker engine: ' + $Version)
$CliArgs = @('--yes', 'supabase@2.117.0')
$CliVersion = Run-LocalTool -Tool $Npx.Source -Arguments ($CliArgs + @('--version')) -Description 'Supabase CLI version'
if ($CliVersion -notmatch '2\.117\.0') {
    throw 'Supabase CLI version is unexpected. No changes made.'
}
Write-Host 'Pinned Supabase CLI 2.117.0 is available.'

# Ports are intentionally separate from the Supabase defaults and the EFOS ports.
$Ports = @(55320,55321,55322,55323,55324,55327,55329)
$UsedPorts = @()
if (Get-Command 'Get-NetTCPConnection' -ErrorAction SilentlyContinue) {
    $UsedPorts = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $Ports -contains [int]$_.LocalPort } |
        Select-Object -ExpandProperty LocalPort -Unique)
}
if ($UsedPorts.Count -gt 0) {
    throw ('Isolated port conflict: ' + ($UsedPorts -join ', ') + '. No changes made.')
}
Write-Host 'Dedicated port range 55320-55329 has no detected listener.'
Write-Host 'Port check is indicative; Docker publishing and firewall still require review.'

if (-not $Initialize) {
    Write-Host 'B5 PREFLIGHT PASS. No folders or containers created.' -ForegroundColor Green
    return
}

# Never reinitialize an arbitrary directory, or a project linked to production.
if (Test-Path -LiteralPath $Root) {
    if (Test-Path -LiteralPath $Config) {
        $Existing = [System.IO.File]::ReadAllText($Config)
        if ($Existing -notmatch '(?m)^project_id\s*=\s*"super-leader-preprod-b5-isolated"\s*$') {
            throw 'Existing lab config belongs to a different project. Refusing to modify.'
        }
        if (Test-Path -LiteralPath (Join-Path $Root 'supabase\.temp\project-ref')) {
            throw 'Local lab unexpectedly has a remote project link. Refusing to continue.'
        }
        Write-Host 'B5 LAB ALREADY INITIALIZED. No changes made.' -ForegroundColor Green
        return
    }
    if (@(Get-ChildItem -LiteralPath $Root -Force).Count -gt 0) {
        throw 'Lab directory exists and is not empty. Refusing to overwrite.'
    }
} else {
    $null = New-Item -ItemType Directory -Path $Root -Force
}

$InitHelp = Run-LocalTool -Tool $Npx.Source -Arguments ($CliArgs + @('init','--help')) -Description 'Supabase init flags'
$InitArgs = @('init')
if ($InitHelp -match '--yes') {
    $InitArgs += '--yes'
}
Push-Location $Root
try {
    $null = Run-LocalTool -Tool $Npx.Source -Arguments ($CliArgs + $InitArgs) -Description 'Local Supabase initialization'
} finally {
    Pop-Location
}
if (-not (Test-Path -LiteralPath $Config)) {
    throw 'Supabase init did not create the expected config.toml.'
}
if (Test-Path -LiteralPath (Join-Path $Root 'supabase\.temp\project-ref')) {
    throw 'Unexpected remote project link in private lab. STOP.'
}

# Patch only keys in the freshly initialized local config.
$Toml = [System.IO.File]::ReadAllText($Config)
$ProjectPattern = '(?m)^project_id\s*=\s*".*?"\s*$'
if (-not [regex]::IsMatch($Toml, $ProjectPattern)) {
    throw 'Generated config does not expose a project_id. Do not start lab.'
}
$Toml = [regex]::Replace($Toml, $ProjectPattern, ('project_id = "' + $LabId + '"'))

function Set-TomlNumber {
    param([string]$Text,[string]$Section,[string]$Key,[int]$Value,[switch]$Optional)
    $SectionPattern = '(?ms)(^\[' + [regex]::Escape($Section) + '\]\s*\r?\n)(.*?)(?=^\[|\z)'
    $Match = [regex]::Match($Text,$SectionPattern)
    if (-not $Match.Success) {
        if ($Optional) { return $Text }
        throw ('Missing required Supabase section ' + $Section)
    }
    $Content = $Match.Groups[2].Value
    $KeyPattern = '(?m)^' + [regex]::Escape($Key) + '\s*=\s*\d+\s*$'
    if (-not [regex]::IsMatch($Content,$KeyPattern)) {
        if ($Optional) { return $Text }
        throw ('Missing key ' + $Section + '.' + $Key)
    }
    $Updated = [regex]::Replace($Content,$KeyPattern,($Key + ' = ' + $Value),1)
    return $Text.Substring(0,$Match.Groups[2].Index) + $Updated + $Text.Substring($Match.Groups[2].Index+$Content.Length)
}
$Toml = Set-TomlNumber -Text $Toml -Section 'api' -Key 'port' -Value 55321
$Toml = Set-TomlNumber -Text $Toml -Section 'db' -Key 'port' -Value 55322
$Toml = Set-TomlNumber -Text $Toml -Section 'db' -Key 'shadow_port' -Value 55320 -Optional
$Toml = Set-TomlNumber -Text $Toml -Section 'studio' -Key 'port' -Value 55323 -Optional
$Toml = Set-TomlNumber -Text $Toml -Section 'inbucket' -Key 'port' -Value 55324 -Optional
$Toml = Set-TomlNumber -Text $Toml -Section 'analytics' -Key 'port' -Value 55327 -Optional
$Toml = Set-TomlNumber -Text $Toml -Section 'db.pooler' -Key 'port' -Value 55329 -Optional

# No application migrations or production SQL are placed into the lab.
# The lab must not be linked to any remote project.
[System.IO.File]::WriteAllText($Config,$Toml,(New-Object System.Text.UTF8Encoding($false)))

Write-Host 'B5 PRIVATE LAB INITIALIZED - NO DATABASE STARTED.' -ForegroundColor Green
Write-Host ('Config location: ' + $Config)
Write-Host 'No production data copied; no SQL run; no remote project linked.'
Write-Host 'Next gate: validate local config, versions, memory and isolated startup.'
