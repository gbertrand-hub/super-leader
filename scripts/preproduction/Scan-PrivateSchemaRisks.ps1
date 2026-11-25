# SUPER LEADER B5.6 - offline safety review of PRIVATE B4 public-schema export.
# Read only: no database connection, no SQL execution, no network, no report files.
# Never prints SQL text, URLs, secrets, paths to private exports, or function bodies.
# Heuristic scan: does NOT authorize restoring the SQL.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Lab = Join-Path $env:LOCALAPPDATA 'SuperLeader\PreprodLab-B5'
$PrivateSql = Join-Path $env:LOCALAPPDATA 'SuperLeader\PrivateSchemaExports\schema-20261124-211550-347\public-schema-only.sql'
$ExpectedHash = 'F126AFE9D38B7B3C4F8C030FB03596CCAE6826CAD107E280709AB585C71D3785'
$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$LocalConfig = Join-Path $Lab 'supabase\config.toml'
$LinkFile = Join-Path $Lab 'supabase\.temp\project-ref'

Write-Host 'SUPER LEADER B5.6 - PRIVATE SCHEMA OFFLINE RISK SCAN' -ForegroundColor Cyan
Write-Host 'READ ONLY - no SQL executed, no Docker or remote project contacted.'

if (-not (Test-Path -LiteralPath $LocalConfig -PathType Leaf)) {
    throw 'Private lab config missing.'
}
$ConfigText = [System.IO.File]::ReadAllText($LocalConfig)
if ($ConfigText -notmatch '(?m)^project_id\s*=\s*"super-leader-preprod-b5-isolated"\s*$') {
    throw 'Unexpected private lab project ID.'
}
if (Test-Path -LiteralPath $LinkFile) { throw 'STOP: private lab has remote project link.' }
if (-not (Test-Path -LiteralPath $PrivateSql -PathType Leaf)) {
    throw 'Private schema SQL not found.'
}
$File = (Resolve-Path -LiteralPath $PrivateSql).Path
if ($File.StartsWith($RepoRoot.TrimEnd('\') + '\',[System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Private SQL must not be in a Git worktree.'
}
if ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash -ne $ExpectedHash) {
    throw 'B4 private schema fingerprint mismatch.'
}
$Size = (Get-Item -LiteralPath $File).Length
if ($Size -lt 4096) { throw 'Private schema file is unexpectedly small.' }
Write-Host ('B4 private fingerprint: MATCH; SQL file size: ' + $Size + ' bytes')
$Sql = [System.IO.File]::ReadAllText($File,[System.Text.Encoding]::UTF8)
$Options = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase -bor [System.Text.RegularExpressions.RegexOptions]::Multiline

$Rules = @(
    @{ Name='pg_cron schedule calls'; Pattern='\bcron\.(?:schedule|schedule_in_database)\s*\('; Level='BLOCK' },
    @{ Name='pg_cron extension declarations'; Pattern='^\s*CREATE\s+EXTENSION(?:\s+IF\s+NOT\s+EXISTS)?\s+"?pg_cron"?\b'; Level='REVIEW' },
    @{ Name='cron job writes'; Pattern='^\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:"?cron"?\.)?"?job"?\b'; Level='BLOCK' },
    @{ Name='Network and external request calls'; Pattern='\b(?:net\.http_(?:get|post|delete)|(?:extensions\.)?http_(?:get|post|put|delete)|dblink(?:_connect|_exec)?|aws_s3\.[A-Za-z_]+)\s*\('; Level='REVIEW' },
    @{ Name='HTTP/HTTPS URL literals'; Pattern='https?://'; Level='REVIEW' },
    @{ Name='External foreign-data definitions'; Pattern='^\s*CREATE\s+(?:SERVER|FOREIGN\s+TABLE|FOREIGN\s+DATA\s+WRAPPER|USER\s+MAPPING)\b'; Level='REVIEW' },
    @{ Name='Operating-system file or program access'; Pattern='\b(?:pg_(?:read_file|read_binary_file|ls_dir|execute_server_program)|lo_(?:import|export))\s*\(|^\s*COPY\b[^\r\n]*\bPROGRAM\b'; Level='BLOCK' },
    @{ Name='Dangerous psql meta commands'; Pattern='^\s*\\(?:connect|c|i|ir|include|copy|gexec|!)(?:\s|$)'; Level='BLOCK' },
    @{ Name='CREATE/ALTER/DROP DATABASE'; Pattern='^\s*(?:CREATE|ALTER|DROP)\s+DATABASE\b'; Level='BLOCK' },
    @{ Name='CREATE/ALTER/DROP ROLE or USER'; Pattern='^\s*(?:CREATE|ALTER|DROP)\s+(?:ROLE|USER)\b'; Level='BLOCK' },
    @{ Name='SET ROLE or session authorization'; Pattern='^\s*(?:SET\s+ROLE|SET\s+SESSION\s+AUTHORIZATION|RESET\s+ROLE)\b'; Level='REVIEW' },
    @{ Name='Event triggers'; Pattern='^\s*CREATE\s+EVENT\s+TRIGGER\b'; Level='BLOCK' },
    @{ Name='DO statements'; Pattern='^\s*DO\s+\$'; Level='REVIEW' },
    @{ Name='SECURITY DEFINER declarations'; Pattern='\bSECURITY\s+DEFINER\b'; Level='REVIEW' },
    @{ Name='GRANT ALL/EXECUTE to PUBLIC or API roles'; Pattern='^\s*GRANT\s+(?:ALL|EXECUTE)\b[^\r\n]*\bTO\s+(?:PUBLIC|anon|authenticated)\b'; Level='REVIEW' },
    @{ Name='INSERT/UPDATE/DELETE/MERGE/TRUNCATE lines (may be inside functions)'; Pattern='^\s*(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b'; Level='REVIEW' },
    @{ Name='COPY data from stdin'; Pattern='^\s*COPY\s+[^\r\n]*\bFROM\s+stdin\s*;'; Level='BLOCK' },
    @{ Name='pg_dump data-section markers'; Pattern='^\s*--\s*Data\s+for\s+Name\s*:'; Level='BLOCK' }
)

$Counts = @{}
$BlockCount = 0
$ReviewCount = 0
foreach ($Rule in $Rules) {
    $Found = [System.Text.RegularExpressions.Regex]::Matches($Sql,$Rule.Pattern,$Options).Count
    $Counts[$Rule.Name] = $Found
    if ($Found -gt 0) {
        if ($Rule.Level -eq 'BLOCK') { $BlockCount += $Found } else { $ReviewCount += $Found }
    }
    Write-Host ('{0,-65} {1,7} [{2}]' -f $Rule.Name,$Found,$Rule.Level)
}
$Tables = [System.Text.RegularExpressions.Regex]::Matches($Sql,'^\s*CREATE\s+(?:UNLOGGED\s+)?TABLE\s+',$Options).Count
$Functions = [System.Text.RegularExpressions.Regex]::Matches($Sql,'^\s*CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+',$Options).Count
$Triggers = [System.Text.RegularExpressions.Regex]::Matches($Sql,'^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+',$Options).Count
$Policies = [System.Text.RegularExpressions.Regex]::Matches($Sql,'^\s*CREATE\s+POLICY\s+',$Options).Count
Write-Host ('Object coverage (approx): tables=' + $Tables + '; functions=' + $Functions + '; triggers=' + $Triggers + '; policies=' + $Policies)
if ($Tables -lt 250 -or $Triggers -ne 178) {
    throw 'B5.6 COVERAGE HOLD: schema does not meet the known B4 table/trigger baseline.'
}
if ($BlockCount -gt 0) {
    Write-Warning ('B5.6 CRITICAL MARKERS DETECTED: ' + $BlockCount + '. Never restore this SQL unchanged.')
}
if ($ReviewCount -gt 0) {
    Write-Warning ('B5.6 REVIEW MARKERS DETECTED: ' + $ReviewCount + '. Each must be assessed before replay.')
}
Write-Host 'B5.6 OFFLINE RISK SCAN COMPLETE - RESTORE NOT AUTHORIZED' -ForegroundColor Yellow
Write-Host 'This regex scan does not prove the absence of side effects, secrets, or SQL hidden in function bodies.'
Write-Host 'Keep private SQL outside Git. Share ONLY this aggregate console report, never SQL contents.'
