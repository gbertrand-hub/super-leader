# SUPER LEADER B5.5 - isolated local database inspection (READ ONLY).
# No SQL import, migrations, production access, EFOS modification, or secrets printed.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Db = 'supabase_db_super-leader-preprod-b5-isolated'
$Root = Join-Path $env:LOCALAPPDATA 'SuperLeader\PreprodLab-B5'
$Config = Join-Path $Root 'supabase\config.toml'
$RemoteLink = Join-Path $Root 'supabase\.temp\project-ref'
$PrivateSql = Join-Path $env:LOCALAPPDATA 'SuperLeader\PrivateSchemaExports\schema-20261124-211550-347\public-schema-only.sql'
$Hash = 'F126AFE9D38B7B3C4F8C030FB03596CCAE6826CAD107E280709AB585C71D3785'
Write-Host 'SUPER LEADER B5.5 - READ-ONLY LOCAL DATABASE CHECK' -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath $Config -PathType Leaf)) { throw 'Private lab config missing.' }
if (Test-Path -LiteralPath $RemoteLink) { throw 'STOP: remote project link found.' }
$Text = [System.IO.File]::ReadAllText($Config)
if ($Text -notmatch '(?m)^project_id\s*=\s*"super-leader-preprod-b5-isolated"\s*$') {
    throw 'Unexpected local project identity.'
}
if ($Text -match 'jjbuxrlvxnlnrjcorpwt|xehstmnqljjhacjiukvc') {
    throw 'STOP: remote project reference in private config.'
}
if (-not (Test-Path -LiteralPath $PrivateSql -PathType Leaf)) { throw 'Private B4 export not found.' }
if ((Get-FileHash -LiteralPath $PrivateSql -Algorithm SHA256).Hash -ne $Hash) {
    throw 'Private B4 SQL fingerprint mismatch.'
}
Write-Host 'B4 private SQL fingerprint: MATCH'
$Running = ((& docker inspect -f '{{.State.Running}}' $Db) | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $Running -ne 'true') { throw 'Private PostgreSQL container is not running.' }
$ImageName = ((& docker inspect -f '{{.Config.Image}}' $Db) | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $ImageName -notmatch '(?i)postgres') { throw 'Unexpected container image.' }
Write-Host ('Private image: ' + $ImageName)
function Read-LocalDatabase {
    param([string]$Sql)
    $Output = @(& docker exec $Db psql -X -q -U postgres -d postgres -tA -v ON_ERROR_STOP=1 -c $Sql)
    if ($LASTEXITCODE -ne 0) { throw 'A local read-only PostgreSQL query failed.' }
    return ($Output -join [Environment]::NewLine).Trim()
}
$PgVersion = Read-LocalDatabase 'SHOW server_version;'
Write-Host ('PostgreSQL version: ' + $PgVersion)
if ($PgVersion -notmatch '^17\.') { throw 'PostgreSQL 17 is required.' }
$PublicTables = Read-LocalDatabase "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='public';"
Write-Host ('Public application tables: ' + $PublicTables)
if ($PublicTables -ne '0') { throw 'Public database is not empty. Stop before restoration.' }
$Roles = Read-LocalDatabase "SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','postgres');"
Write-Host ('Core Supabase roles found (of 4): ' + $Roles)
if ($Roles -ne '4') { throw 'Core Supabase roles are incomplete.' }
$Managed = Read-LocalDatabase "SELECT n.nspname || '=' || count(c.oid) FROM pg_namespace n LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relkind IN ('r','p') WHERE n.nspname IN ('auth','storage') GROUP BY n.nspname ORDER BY n.nspname;"
Write-Host ('Managed auth/storage schemas: ' + ($Managed -replace '\r?\n','; '))
$Deps = Read-LocalDatabase "SELECT 'auth.users='||(to_regclass('auth.users') IS NOT NULL)::text || ', storage.objects='||(to_regclass('storage.objects') IS NOT NULL)::text || ', auth.uid='||(to_regprocedure('auth.uid()') IS NOT NULL)::text;"
Write-Host ('Supabase dependencies: ' + $Deps)
if ($Deps -match 'false') { Write-Warning 'A managed prerequisite is missing. Do not restore yet.' }
$Extensions = Read-LocalDatabase "SELECT extname || '=' || extversion FROM pg_extension ORDER BY extname;"
Write-Host ('Installed extensions: ' + ($Extensions -replace '\r?\n','; '))
$Cron = Read-LocalDatabase "SELECT 'available='||(EXISTS(SELECT 1 FROM pg_available_extensions WHERE name='pg_cron'))::text||', installed='||(EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron'))::text;"
Write-Host ('pg_cron: ' + $Cron)
Write-Host 'Any production cron schedules must remain disabled in this lab.'
$Ports = @(& docker port $Db '5432/tcp')
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect published PostgreSQL port.' }
$PortsText = $Ports -join '; '
Write-Host ('Published PostgreSQL ports: ' + $PortsText)
if ($PortsText -notmatch ':55322(\s|;|$)') { throw 'Unexpected local port mapping.' }
if ($PortsText -match '0\.0\.0\.0|\[::\]') {
    Write-Warning 'Database is exposed on all local host network interfaces. Restrict firewall and trusted networks.'
}
Write-Host 'B5.5 LOCAL DATABASE INSPECTION COMPLETE (READ ONLY)' -ForegroundColor Green
Write-Host 'No production SQL executed, no data copied, no EFOS changes.'
Write-Host 'Next: inspect private B4 SQL locally for unsafe DDL, cron and network calls before import.'
