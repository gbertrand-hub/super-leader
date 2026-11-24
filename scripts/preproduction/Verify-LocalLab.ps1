# B5: private Supabase local lab check. No DB start or schema replay.
# Default is read-only. -PreparePostgres17 changes only a private config.toml.
[CmdletBinding()]
param([switch]$PreparePostgres17)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $env:LOCALAPPDATA) { throw 'Requires Windows LOCALAPPDATA.' }
$Root = Join-Path $env:LOCALAPPDATA 'SuperLeader\PreprodLab-B5'
$Config = Join-Path $Root 'supabase\config.toml'
$Link = Join-Path $Root 'supabase\.temp\project-ref'
$Dump = Join-Path $env:LOCALAPPDATA 'SuperLeader\PrivateSchemaExports\schema-20261124-211550-347\public-schema-only.sql'
$Hash = 'F126AFE9D38B7B3C4F8C030FB03596CCAE6826CAD107E280709AB585C71D3785'
Write-Host 'SUPER LEADER B5 - PRIVATE LAB READINESS' -ForegroundColor Cyan
Write-Host ('Mode: ' + $(if ($PreparePostgres17) { 'LOCAL PG17 CONFIG ONLY' } else { 'READ ONLY' }))
if (-not (Test-Path -LiteralPath $Config -PathType Leaf)) { throw 'Lab config.toml missing.' }
if (Test-Path -LiteralPath $Link) { throw 'STOP: lab contains a remote project link.' }
if (-not (Test-Path -LiteralPath $Dump -PathType Leaf)) { throw 'Private B4 SQL missing.' }
if ((Get-FileHash -LiteralPath $Dump -Algorithm SHA256).Hash -ne $Hash) { throw 'B4 SQL hash mismatch.' }
Write-Host 'B4 fingerprint: MATCH'
$Toml = [System.IO.File]::ReadAllText($Config)
if ($Toml -match 'jjbuxrlvxnlnrjcorpwt|xehstmnqljjhacjiukvc') { throw 'STOP: real Supabase project reference in lab config.' }
if ($Toml -notmatch '(?m)^project_id\s*=\s*"super-leader-preprod-b5-isolated"\s*$') {
    throw 'Unexpected lab project_id.'
}
Write-Host 'Local project ID: verified'
$Migrations = Join-Path $Root 'supabase\migrations'
if (Test-Path -LiteralPath $Migrations) {
    $Scripts = @(Get-ChildItem -LiteralPath $Migrations -File -Filter '*.sql')
    if ($Scripts.Count -gt 0) { throw 'STOP: lab has existing SQL migrations.' }
}
if (Test-Path -LiteralPath (Join-Path $Root 'supabase\seed.sql') -PathType Leaf) {
    throw 'STOP: lab has a SQL seed file.'
}
Write-Host 'Private lab migrations and seeds: NONE'
function Get-LocalValue {
    param([string]$Text, [string]$Section, [string]$Key)
    $Spat = '(?ms)^\[' + [regex]::Escape($Section) + '\]\s*\r?\n(?<body>.*?)(?=^\[|\z)'
    $Smatch = [regex]::Match($Text, $Spat)
    if (-not $Smatch.Success) { throw ('Missing config section: ' + $Section) }
    $Kpat = '(?m)^' + [regex]::Escape($Key) + '\s*=\s*(?<v>[^#\r\n]+)'
    $Kmatch = [regex]::Match($Smatch.Groups['body'].Value, $Kpat)
    if (-not $Kmatch.Success) { throw ('Missing config key: ' + $Section + '.' + $Key) }
    return $Kmatch.Groups['v'].Value.Trim()
}
foreach ($PortRule in @(@('api','port','55321'),@('db','port','55322'),@('db','shadow_port','55320'))) {
    $Found = Get-LocalValue -Text $Toml -Section $PortRule[0] -Key $PortRule[1]
    if ($Found -ne $PortRule[2]) {
        throw ('Local port mismatch: ' + $PortRule[0] + '.' + $PortRule[1] + ' expected ' + $PortRule[2])
    }
}
Write-Host 'Core ports: DEDICATED'
$Major = Get-LocalValue -Text $Toml -Section 'db' -Key 'major_version'
if ($Major -ne '17') {
    if (-not $PreparePostgres17) {
        throw ('Local PostgreSQL is ' + $Major + '; run with -PreparePostgres17 to set 17 safely.')
    }
    if ($Major -ne '15') { throw ('Unexpected PostgreSQL major_version ' + $Major + '. No changes made.') }
    $DbSection = [regex]::Match($Toml, '(?ms)^\[db\]\s*\r?\n(?<body>.*?)(?=^\[|\z)')
    if (-not $DbSection.Success) { throw 'Missing [db] config section.' }
    $Body = $DbSection.Groups['body'].Value
    $Key = [regex]::Match($Body, '(?m)^major_version\s*=\s*(?<number>15)\s*$')
    if (-not $Key.Success) { throw 'Cannot safely replace local PostgreSQL version.' }
    $Start = $DbSection.Groups['body'].Index + $Key.Groups['number'].Index
    $Updated = $Toml.Substring(0,$Start) + '17' + $Toml.Substring($Start + 2)
    $Backup = $Config + '.before-pg17-b5'
    if (-not (Test-Path -LiteralPath $Backup)) {
        Copy-Item -LiteralPath $Config -Destination $Backup
    }
    [System.IO.File]::WriteAllText($Config,$Updated,(New-Object System.Text.UTF8Encoding($false)))
    $Toml = [System.IO.File]::ReadAllText($Config)
    if ((Get-LocalValue -Text $Toml -Section 'db' -Key 'major_version') -ne '17') {
        throw 'Local PostgreSQL version update verification failed.'
    }
    Write-Host 'Local PostgreSQL changed from 15 to 17 (private config only).' -ForegroundColor Green
}
Write-Host 'Local PostgreSQL major_version: 17'
if (-not (Get-Command 'docker' -ErrorAction SilentlyContinue)) { throw 'Docker CLI missing.' }
$ErrPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    $MemoryText = (& docker info --format '{{.MemTotal}}' 2>&1 | Out-String).Trim()
    $DockerExit = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $ErrPreference
}
if ($DockerExit -ne 0 -or $MemoryText -notmatch '^\d+$') {
    throw 'Docker memory check failed.'
}
$DockerGiB = [math]::Round([double]::Parse($MemoryText)/1GB,2)
Write-Host ('Docker memory: ' + $DockerGiB + ' GiB')
if ($DockerGiB -lt 7) { Write-Warning 'Full Supabase stack typically needs at least 7 GiB of RAM.' }
$Ports = @(55320,55321,55322,55323,55324,55327,55329)
if (Get-Command 'Get-NetTCPConnection' -ErrorAction SilentlyContinue) {
    $Busy = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $Ports -contains [int]$_.LocalPort } |
        Select-Object -ExpandProperty LocalPort -Unique)
    if ($Busy.Count -gt 0) { throw ('Private port conflict: ' + ($Busy -join ', ')) }
}
Write-Host 'Local port listeners: CLEAR'
Write-Host 'B5 LOCAL READINESS: PASS' -ForegroundColor Green
Write-Host 'No containers started, no SQL executed, no remote projects contacted.'
