# Super Leader B4 - Private schema dump inspection (read-only, offline).
# No SQL is executed. No SQL content is printed, uploaded, or copied.
# Designed for Windows PowerShell 5.1 and PowerShell 7.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-fA-F0-9]{64}$')]
    [string]$ExpectedSha256
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path

if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
    throw 'Schema file does not exist. No actions taken.'
}
$ResolvedFile = (Resolve-Path -LiteralPath $FilePath).Path
$PathComparison = [System.StringComparison]::OrdinalIgnoreCase
if ($ResolvedFile.StartsWith($RepoRoot.TrimEnd('\') + '\', $PathComparison)) {
    throw 'Schema file must be outside the Git worktree to avoid accidental commits.'
}

$FileInfo = Get-Item -LiteralPath $ResolvedFile
if ($FileInfo.Length -lt 4096) {
    throw 'Schema SQL appears unexpectedly small. No restore should be attempted.'
}

$Hash = (Get-FileHash -LiteralPath $ResolvedFile -Algorithm SHA256).Hash.ToUpperInvariant()
$Expected = $ExpectedSha256.ToUpperInvariant()
if ($Hash -ne $Expected) {
    throw 'SHA256 MISMATCH. The selected local schema SQL is not the previously exported file.'
}

# All further checks are offline text heuristics; they do not parse full SQL
# and cannot prove schema reproducibility or the absence of sensitive values.
$Sql = [System.IO.File]::ReadAllText($ResolvedFile, [System.Text.Encoding]::UTF8)
$Settings = [System.Text.RegularExpressions.RegexOptions]::Multiline -bor [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
function Count-SqlPattern {
    param([string]$Pattern)
    return [System.Text.RegularExpressions.Regex]::Matches($Sql, $Pattern, $Settings).Count
}

$TableCount = Count-SqlPattern '^\s*CREATE\s+(?:UNLOGGED\s+)?TABLE\s+'
$FunctionCount = Count-SqlPattern '^\s*CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+'
$ProcedureCount = Count-SqlPattern '^\s*CREATE\s+(?:OR\s+REPLACE\s+)?PROCEDURE\s+'
$PolicyCount = Count-SqlPattern '^\s*CREATE\s+POLICY\s+'
$IndexCount = Count-SqlPattern '^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+'
# PostgreSQL can emit both CREATE TRIGGER and CREATE OR REPLACE TRIGGER.
# Reference baseline was independently confirmed on the production catalog:
# 178 non-internal, non-extension-owned triggers across public tables.
$ExpectedPublicTriggers = 178
$TriggerCount = Count-SqlPattern '^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+'
$PgDumpTriggerCommentCount = Count-SqlPattern '^\s*--\s*Name:\s*[^\r\n;]+;\s*Type:\s*TRIGGER\s*;'
$TriggerAlterCount = Count-SqlPattern '^\s*ALTER\s+TABLE[^\r\n]*\b(?:ENABLE|DISABLE)\s+(?:ALWAYS\s+|REPLICA\s+)?TRIGGER\b'
$TriggerMentionCount = Count-SqlPattern '\bTRIGGER\b'
$ViewCount = Count-SqlPattern '^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+'

# pg_dump data-block signatures. We never echo matching SQL text.
$CopyFromStdinCount = Count-SqlPattern '^\s*COPY\s+\S+[^\r\n]*\bFROM\s+stdin\s*;'
$DataSectionCount = Count-SqlPattern '^\s*--\s*Data\s+for\s+Name\s*:'
$DatabaseDdlCount = Count-SqlPattern '^\s*(?:CREATE|DROP)\s+DATABASE\b'
$RoleDdlCount = Count-SqlPattern '^\s*(?:CREATE|ALTER|DROP)\s+ROLE\b'
$PublicSchemaDeclared = (Count-SqlPattern '^\s*CREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?public\b') -gt 0

Write-Host 'SUPER LEADER B4 - PRIVATE SCHEMA INSPECTION' -ForegroundColor Cyan
Write-Host 'SHA256 MATCH: YES'
Write-Host ('Bytes: ' + $FileInfo.Length)
Write-Host ('CREATE TABLE statements (approximate): ' + $TableCount)
Write-Host ('CREATE FUNCTION statements (approximate): ' + $FunctionCount)
Write-Host ('CREATE PROCEDURE statements (approximate): ' + $ProcedureCount)
Write-Host ('CREATE POLICY statements (approximate): ' + $PolicyCount)
Write-Host ('CREATE INDEX statements (approximate): ' + $IndexCount)
Write-Host ('CREATE TRIGGER statements (approximate): ' + $TriggerCount)
Write-Host ('Expected public user-defined triggers: ' + $ExpectedPublicTriggers)
Write-Host ('pg_dump trigger object comments: ' + $PgDumpTriggerCommentCount)
Write-Host ('ALTER TABLE ENABLE/DISABLE TRIGGER statements: ' + $TriggerAlterCount)
Write-Host ('TRIGGER keyword mentions (anywhere): ' + $TriggerMentionCount)
Write-Host ('CREATE VIEW statements (approximate): ' + $ViewCount)
Write-Host ('pg_dump data section markers: ' + $DataSectionCount)
Write-Host ('COPY FROM stdin statements: ' + $CopyFromStdinCount)
Write-Host ('CREATE/DROP DATABASE statements: ' + $DatabaseDdlCount)
Write-Host ('CREATE/ALTER/DROP ROLE statements: ' + $RoleDdlCount)
Write-Host ('Explicit CREATE SCHEMA public: ' + $PublicSchemaDeclared)

$UnsafeMarkers = $CopyFromStdinCount + $DataSectionCount + $DatabaseDdlCount + $RoleDdlCount
if ($UnsafeMarkers -gt 0) {
    Write-Warning 'Unexpected top-level data or cluster DDL markers detected.'
    throw 'INSPECTION BLOCKED. Do not restore or share this file.'
}
if ($TableCount -lt 250) {
    Write-Warning 'Fewer than 250 CREATE TABLE statements detected; expected public schema is around 315 tables.'
    throw 'INSPECTION INCOMPLETE. Review privately before any restore.'
}
if ($TriggerCount -ne $ExpectedPublicTriggers) {
    Write-Warning 'TRIGGER GAP: SQL declarations do not match the 178 live public user-defined triggers.'
    Write-Warning 'Possible explanations: alternate dump syntax, insufficient schema coverage, or missing trigger definitions.'
    Write-Warning 'Do not restore or modify production. Review the counts above first.'
    throw 'B4 TRIGGER COVERAGE BLOCKED. A full local schema replay must not begin yet.'
}
Write-Host 'B4 PRIVATE SQL INSPECTION: PASS (HEURISTIC ONLY)' -ForegroundColor Green
Write-Host 'No SQL executed, uploaded, copied, or displayed.'
Write-Host 'Next: prepare an isolated disposable restore with auth/storage dependencies and cron disabled.'
