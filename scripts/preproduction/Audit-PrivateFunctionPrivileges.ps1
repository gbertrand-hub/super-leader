# SUPER LEADER B5.7 - detailed offline function/permission audit of the private B4 export.
# Does not print schema SQL, function names, secrets, URLs, or function bodies.
# No external services, Docker commands, migrations or SQL execution.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PrivateSql = Join-Path $env:LOCALAPPDATA 'SuperLeader\PrivateSchemaExports\schema-20261124-211550-347\public-schema-only.sql'
$ExpectedHash = 'F126AFE9D38B7B3C4F8C030FB03596CCAE6826CAD107E280709AB585C71D3785'
Write-Host 'SUPER LEADER B5.7 - OFFLINE FUNCTION/PRIVILEGE INVENTORY' -ForegroundColor Cyan
Write-Host 'Offline and read-only. No schema will be restored.'
if (-not (Test-Path -LiteralPath $PrivateSql -PathType Leaf)) { throw 'Private schema export missing.' }
if ((Get-FileHash -LiteralPath $PrivateSql -Algorithm SHA256).Hash -ne $ExpectedHash) {
    throw 'Private B4 export hash mismatch.'
}
$Sql = [System.IO.File]::ReadAllText($PrivateSql,[System.Text.Encoding]::UTF8)
$Options = [System.Text.RegularExpressions.RegexOptions]::Multiline -bor [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
function Count-Expression {
    param([string]$Text,[string]$Pattern)
    return [System.Text.RegularExpressions.Regex]::Matches($Text,$Pattern,$Options).Count
}
$Functions = [System.Text.RegularExpressions.Regex]::Matches($Sql,'^\s*CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+',$Options)
$Summaries = [ordered]@{
    parsed_definition_headers = 0
    unparsed_function_bodies = 0
    security_definer = 0
    security_definer_with_search_path = 0
    security_definer_without_search_path = 0
    security_definer_with_dynamic_sql = 0
    security_definer_with_dml = 0
    security_definer_with_auth_context_reference = 0
    security_definer_with_external_io_marker = 0
    invoker_or_unspecified = 0
}
$DollarPattern = '\bAS\s+(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)'
for ($I = 0; $I -lt $Functions.Count; $I++) {
    $From = $Functions[$I].Index
    $To = if ($I + 1 -lt $Functions.Count) { $Functions[$I + 1].Index } else { $Sql.Length }
    $Part = $Sql.Substring($From,$To-$From)
    $Opening = [System.Text.RegularExpressions.Regex]::Match($Part,$DollarPattern,[System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (-not $Opening.Success) {
        $Summaries['unparsed_function_bodies']++
        continue
    }
    $Delimiter = $Opening.Groups[1].Value
    $BodyStart = $Opening.Index + $Opening.Length
    $BodyEnd = $Part.IndexOf($Delimiter,$BodyStart,[System.StringComparison]::Ordinal)
    if ($BodyEnd -lt 0) {
        $Summaries['unparsed_function_bodies']++
        continue
    }
    $Header = $Part.Substring(0,$Opening.Index)
    $Body = $Part.Substring($BodyStart,$BodyEnd-$BodyStart)
    $Summaries['parsed_definition_headers']++
    $Definer = $Header -match '\bSECURITY\s+DEFINER\b'
    if (-not $Definer) {
        $Summaries['invoker_or_unspecified']++
        continue
    }
    $Summaries['security_definer']++
    $SearchPath = $Header -match '\bSET\s+search_path\b'
    if ($SearchPath) {
        $Summaries['security_definer_with_search_path']++
    } else {
        $Summaries['security_definer_without_search_path']++
    }
    if ($Body -match '\bEXECUTE\s+(?:format\s*\(|\w|[''"]|\()') {
        $Summaries['security_definer_with_dynamic_sql']++
    }
    if ($Body -match '(?m)^\s*(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b') {
        $Summaries['security_definer_with_dml']++
    }
    if ($Body -match '\b(?:auth\.(?:uid|jwt|role)\s*\(|current_setting\s*\(|has_role\s*\(|is_admin\s*\()') {
        $Summaries['security_definer_with_auth_context_reference']++
    }
    if ($Body -match '\b(?:net\.http_|http_(?:get|post|delete)|dblink|aws_s3\.)') {
        $Summaries['security_definer_with_external_io_marker']++
    }
}
Write-Host ('Function declarations found: ' + $Functions.Count)
foreach ($Key in $Summaries.Keys) { Write-Host ('{0,-52} {1,5}' -f $Key,$Summaries[$Key]) }
$RlsEnabled = Count-Expression $Sql '^\s*ALTER\s+TABLE\s+[^\r\n]+\bENABLE\s+ROW\s+LEVEL\s+SECURITY\s*;'
$RlsForced = Count-Expression $Sql '^\s*ALTER\s+TABLE\s+[^\r\n]+\bFORCE\s+ROW\s+LEVEL\s+SECURITY\s*;'
$Policies = Count-Expression $Sql '^\s*CREATE\s+POLICY\s+'
$GrantsPublic = Count-Expression $Sql '^\s*GRANT\s+EXECUTE\s+ON\s+(?:ALL\s+)?FUNCTIONS?\b[^\r\n]*\bTO\s+PUBLIC\b'
$GrantsApi = Count-Expression $Sql '^\s*GRANT\s+EXECUTE\s+ON\s+(?:ALL\s+)?FUNCTIONS?\b[^\r\n]*\bTO\s+(?:anon|authenticated)\b'
$AlterDefault = Count-Expression $Sql '^\s*ALTER\s+DEFAULT\s+PRIVILEGES\b'
$ViewCount = Count-Expression $Sql '^\s*CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+'
$ViewsInvoker = Count-Expression $Sql '\bsecurity_invoker\s*=\s*true\b'
$GrantTables = Count-Expression $Sql '^\s*GRANT\s+(?:ALL|SELECT|INSERT|UPDATE|DELETE)\b[^\r\n]*\bTO\s+(?:PUBLIC|anon|authenticated)\b'
Write-Host ('RLS ENABLE statements: ' + $RlsEnabled)
Write-Host ('RLS FORCE statements: ' + $RlsForced)
Write-Host ('RLS policies: ' + $Policies)
Write-Host ('Explicit GRANT EXECUTE TO PUBLIC lines: ' + $GrantsPublic)
Write-Host ('Explicit GRANT EXECUTE TO API roles lines: ' + $GrantsApi)
Write-Host ('ALTER DEFAULT PRIVILEGES statements: ' + $AlterDefault)
Write-Host ('GRANT table privileges to public/API roles lines: ' + $GrantTables)
Write-Host ('View declarations: ' + $ViewCount)
Write-Host ('security_invoker=true mentions: ' + $ViewsInvoker)
Write-Host 'NOTE: PostgreSQL grants EXECUTE to PUBLIC on new functions by default unless revoked.'
Write-Host 'NOTE: A reference to auth context is not proof of correct authorization.'
Write-Host 'NOTE: Text heuristics may miss dynamic SQL, escaped tokens and multiline grants.'
if ($Functions.Count -ne 178 -or $Summaries['unparsed_function_bodies'] -gt 0) {
    Write-Warning 'Function parsing incomplete. Require review before schema replay.'
}
if ($Summaries['security_definer_without_search_path'] -gt 0) {
    Write-Warning 'SECURITY DEFINER functions without explicit function-level search_path require review.'
}
Write-Host 'B5.7 INVENTORY FINISHED - NO SCHEMA RESTORE AUTHORIZED' -ForegroundColor Yellow
Write-Host 'Share only the aggregated counts printed above, not the private SQL file.'
