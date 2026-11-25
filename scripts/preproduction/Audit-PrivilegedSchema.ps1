# SUPER LEADER B5.8 - offline aggregate audit of privileged functions and RLS markers.
# Read-only. No data copies, no SQL executed, no paths/secrets/function names displayed.
# Counts are heuristic and DO NOT authorize SQL restore.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$SqlPath = Join-Path $env:LOCALAPPDATA 'SuperLeader\PrivateSchemaExports\schema-20261124-211550-347\public-schema-only.sql'
$ExpectedHash = 'F126AFE9D38B7B3C4F8C030FB03596CCAE6826CAD107E280709AB585C71D3785'
Write-Host 'SUPER LEADER B5.8 - PRIVILEGED FUNCTION / RLS OFFLINE REVIEW' -ForegroundColor Cyan
Write-Host 'READ ONLY - private SQL remains off GitHub and is not executed or printed.'
if (-not (Test-Path -LiteralPath $SqlPath -PathType Leaf)) { throw 'Private B4 SQL missing.' }
if ((Get-FileHash -LiteralPath $SqlPath -Algorithm SHA256).Hash -ne $ExpectedHash) { throw 'Private B4 SQL fingerprint mismatch.' }
$Sql = [System.IO.File]::ReadAllText($SqlPath,[System.Text.Encoding]::UTF8)
$Opts = [System.Text.RegularExpressions.RegexOptions]::Multiline -bor [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
function Count-Risk {
    param([string]$Text,[string]$Pattern)
    return [System.Text.RegularExpressions.Regex]::Matches($Text,$Pattern,$Opts).Count
}

$FnStart = [regex]::Matches($Sql,'(?im)^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+')
$NextObject = [regex]::Matches($Sql,'(?im)^--\s*Name:\s+')
if ($FnStart.Count -ne 178) { throw ('Unexpected CREATE FUNCTION baseline: ' + $FnStart.Count) }
Write-Host ('CREATE FUNCTION definitions: ' + $FnStart.Count)

$SeenDefiner = 0
$WithPath = 0
$WithoutPath = 0
$WithDynamicSql = 0
$WithMutations = 0
$WithAuthCheck = 0
$WithPotentialPrivilegeChange = 0
$UncertainWindows = 0
foreach ($Start in $FnStart) {
    $End = $Sql.Length
    foreach ($Header in $NextObject) {
        if ($Header.Index -gt $Start.Index) {
            $End = $Header.Index
            break
        }
    }
    if ($End -le $Start.Index) { $UncertainWindows++; continue }
    $Body = $Sql.Substring($Start.Index,$End-$Start.Index)
    # Scan one pg_dump function section; no body content is emitted.
    if (Count-Risk $Body '\bSECURITY\s+DEFINER\b') {
        $SeenDefiner++
        if (Count-Risk $Body '\bSET\s+(?:search_path|\"search_path\")\s*(?:=|TO)\s*') { $WithPath++ }
        else { $WithoutPath++ }
        if (Count-Risk $Body '\bEXECUTE\b') { $WithDynamicSql++ }
        if (Count-Risk $Body '(?m)^\s*(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b') { $WithMutations++ }
        if (Count-Risk $Body '\bauth\.uid\s*\(|\bcurrent_setting\s*\(\s*''request\.jwt\.claims') { $WithAuthCheck++ }
        if (Count-Risk $Body '\b(?:SET\s+ROLE|ALTER\s+ROLE|GRANT\s+|REVOKE\s+)') { $WithPotentialPrivilegeChange++ }
    }
}
$RawDefiner = Count-Risk $Sql '\bSECURITY\s+DEFINER\b'
$RawDml = Count-Risk $Sql '(?m)^\s*(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b'
$RlsEnable = Count-Risk $Sql '^\s*ALTER\s+TABLE[^\r\n]*\bENABLE\s+ROW\s+LEVEL\s+SECURITY\b'
$RlsForce = Count-Risk $Sql '^\s*ALTER\s+TABLE[^\r\n]*\bFORCE\s+ROW\s+LEVEL\s+SECURITY\b'
$Policies = Count-Risk $Sql '^\s*CREATE\s+POLICY\b'
$PolicyPublic = Count-Risk $Sql '^\s*CREATE\s+POLICY[^\r\n]*\bTO\s+PUBLIC\b'
$GrantExecute = Count-Risk $Sql '^\s*GRANT\s+EXECUTE\b'
$RevokeExecute = Count-Risk $Sql '^\s*REVOKE\s+EXECUTE\b'
$DefaultPrivileges = Count-Risk $Sql '^\s*ALTER\s+DEFAULT\s+PRIVILEGES\b'
$SecurityInvokerViews = Count-Risk $Sql '\bsecurity_invoker\s*=\s*true\b'
$DynamicSql = Count-Risk $Sql '\bEXECUTE\s+(?:format\s*\(|''|\"|\$|[A-Za-z_])'
$ExtensionCreate = Count-Risk $Sql '^\s*CREATE\s+EXTENSION\b'

Write-Host ('SECURITY DEFINER text occurrences (B5.6): ' + $RawDefiner)
Write-Host ('SECURITY DEFINER function sections (heuristic): ' + $SeenDefiner)
Write-Host ('  With per-function search_path setting: ' + $WithPath)
Write-Host ('  Without detected per-function search_path: ' + $WithoutPath)
Write-Host ('  With EXECUTE marker: ' + $WithDynamicSql)
Write-Host ('  With apparent write statements: ' + $WithMutations)
Write-Host ('  With auth.uid() or JWT claim accessor: ' + $WithAuthCheck)
Write-Host ('  With GRANT / REVOKE / SET ROLE markers: ' + $WithPotentialPrivilegeChange)
Write-Host ('DML text lines, including function bodies (B5.6): ' + $RawDml)
Write-Host ('Possible dynamic SQL markers anywhere in export: ' + $DynamicSql)
Write-Host ('RLS ENABLE TABLE declarations: ' + $RlsEnable)
Write-Host ('RLS FORCE TABLE declarations: ' + $RlsForce)
Write-Host ('CREATE POLICY declarations: ' + $Policies)
Write-Host ('CREATE POLICY lines explicitly TO PUBLIC: ' + $PolicyPublic)
Write-Host ('Explicit GRANT EXECUTE declarations: ' + $GrantExecute)
Write-Host ('Explicit REVOKE EXECUTE declarations: ' + $RevokeExecute)
Write-Host ('ALTER DEFAULT PRIVILEGES declarations: ' + $DefaultPrivileges)
Write-Host ('security_invoker=true markers: ' + $SecurityInvokerViews)
Write-Host ('CREATE EXTENSION declarations: ' + $ExtensionCreate)
if ($UncertainWindows -gt 0 -or $RawDefiner -ne $SeenDefiner) {
    Write-Warning 'Function section isolation and SECURITY DEFINER counts differ. Manual parsing is required.'
}
if ($WithoutPath -gt 0) {
    Write-Warning 'SECURITY DEFINER functions without detected pinned search_path need human security review.'
}
if ($WithDynamicSql -gt 0) {
    Write-Warning 'Dynamic SQL inside privileged function sections requires targeted review.'
}
if ($Policies -ne 169) { Write-Warning 'Policy coverage differs from expected production baseline.' }
Write-Host 'B5.8 OFFLINE INVENTORY COMPLETE - NO RESTORE AUTHORIZED' -ForegroundColor Yellow
Write-Host 'Counts are heuristic. No automated classification establishes safety of privileged functions.'
Write-Host 'Next: review security-definer functions and grants privately; prepare an isolated safe replay plan.'
