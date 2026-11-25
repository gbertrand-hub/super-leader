# SUPER LEADER B5.8.1 - corrected offline inventory of privileged functions.
# Read only: no database operations, no SQL execution, no network, no SQL/function text printed.
# -SelfTest exercises synthetic SQL only; it does not read the private schema export.
# A lexical scan is not a full PostgreSQL parser and does NOT authorize restore.
[CmdletBinding()]
param([switch]$SelfTest)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Opts = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase -bor [System.Text.RegularExpressions.RegexOptions]::Multiline
function Count-Pattern {
    param([string]$Text,[string]$Pattern)
    return [System.Text.RegularExpressions.Regex]::Matches($Text,$Pattern,$Opts).Count
}
function Get-FunctionStatement {
    param([string]$Text,[int]$Start)
    $Pieces = New-Object 'System.Collections.Generic.List[string]'
    $Bodies = New-Object 'System.Collections.Generic.List[string]'
    $I = $Start
    $Begin = $Start
    $End = -1
    while ($I -lt $Text.Length) {
        $C = $Text[$I]
        $Next = if (($I + 1) -lt $Text.Length) { $Text[$I+1] } else { [char]0 }
        if ($C -eq ';') {
            if ($I -gt $Begin) { $Pieces.Add($Text.Substring($Begin, $I - $Begin)) }
            $End = $I + 1
            break
        }

        $Skip = $false
        $SkipEnd = $I
        if ($C -eq '-' -and $Next -eq '-') {
            $Skip = $true
            $Stop = $Text.IndexOf([char]10,$I+2)
            $SkipEnd = if ($Stop -lt 0) { $Text.Length } else { $Stop+1 }
        }
        elseif ($C -eq '/' -and $Next -eq '*') {
            $Skip = $true
            $Depth = 1
            $J = $I+2
            while ($J -lt ($Text.Length - 1) -and $Depth -gt 0) {
                if ($Text[$J] -eq '/' -and $Text[$J+1] -eq '*') { $Depth++; $J+=2; continue }
                if ($Text[$J] -eq '*' -and $Text[$J+1] -eq '/') { $Depth--; $J+=2; continue }
                $J++
            }
            if ($Depth -ne 0) { throw 'Unclosed SQL block comment.' }
            $SkipEnd = $J
        }
        elseif ($C -eq "'") {
            $Skip = $true
            $J = $I+1
            $Closed = $false
            while ($J -lt $Text.Length) {
                if ($Text[$J] -eq '\') { $J+=2; continue }
                if ($Text[$J] -eq "'") {
                    if (($J+1) -lt $Text.Length -and $Text[$J+1] -eq "'") { $J+=2; continue }
                    $Closed = $true; $J++; break
                }
                $J++
            }
            if (-not $Closed) { throw 'Unclosed SQL single-quoted literal.' }
            $SkipEnd = $J
        }
        elseif ($C -eq '"') {
            $Skip = $true
            $J = $I+1
            $Closed = $false
            while ($J -lt $Text.Length) {
                if ($Text[$J] -eq '"') {
                    if (($J+1) -lt $Text.Length -and $Text[$J+1] -eq '"') { $J+=2; continue }
                    $Closed = $true; $J++; break
                }
                $J++
            }
            if (-not $Closed) { throw 'Unclosed SQL quoted identifier.' }
            $SkipEnd = $J
        }
        elseif ($C -eq '$') {
            $Look = $Text.Substring($I,[Math]::Min(80,$Text.Length-$I))
            $M = [regex]::Match($Look,'^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$')
            if ($M.Success) {
                $Delimiter = $M.Value
                $BodyStart = $I + $Delimiter.Length
                $BodyEnd = $Text.IndexOf($Delimiter,$BodyStart,[StringComparison]::Ordinal)
                if ($BodyEnd -lt 0) { throw 'Unclosed PostgreSQL dollar-quoted body.' }
                $Bodies.Add($Text.Substring($BodyStart,$BodyEnd-$BodyStart))
                $Skip = $true
                $SkipEnd = $BodyEnd + $Delimiter.Length
            }
        }
        if ($Skip) {
            if ($I -gt $Begin) { $Pieces.Add($Text.Substring($Begin,$I-$Begin)) }
            $I = $SkipEnd
            $Begin = $I
            continue
        }
        $I++
    }
    if ($End -lt 0) { throw 'CREATE FUNCTION statement has no outer semicolon.' }
    return [pscustomobject]@{
        End=$End
        Ddl=($Pieces -join ' ')
        Body=($Bodies -join [Environment]::NewLine)
        DollarBodyCount=$Bodies.Count
    }
}

function Inspect-FunctionSql {
    param([string]$Sql,[int]$ExpectedFunctions)
    $Functions = [regex]::Matches($Sql,'(?im)^[ \t]*CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+')
    if ($Functions.Count -ne $ExpectedFunctions) {
        throw ('Unexpected CREATE FUNCTION count: '+$Functions.Count+'; expected '+$ExpectedFunctions)
    }
    $Res = [ordered]@{
        Functions=$Functions.Count
        Definer=0
        DefinerWithPath=0
        DefinerWithoutPath=0
        DefinerWithDynamic=0
        DefinerWithDml=0
        DefinerWithAuth=0
        DefinerWithGrant=0
        MissingDollarBody=0
        SuspiciousSections=0
    }
    for ($F=0; $F -lt $Functions.Count; $F++) {
        $At = $Functions[$F].Index
        $Info = Get-FunctionStatement -Text $Sql -Start $At
        if (($F+1) -lt $Functions.Count -and $Info.End -gt $Functions[$F+1].Index) {
            throw 'Overlapping function statements: lexical audit cannot proceed.'
        }
        if ($Info.DollarBodyCount -lt 1) { $Res.MissingDollarBody++ }
        if (Count-Pattern $Info.Ddl '\bSECURITY\s+DEFINER\b') {
            $Res.Definer++
            if (Count-Pattern $Info.Ddl '\bSET\s+search_path\s*(?:=|TO)\s*') {
                $Res.DefinerWithPath++
            }
            else {
                $Res.DefinerWithoutPath++
            }
            if (Count-Pattern $Info.Body '\bEXECUTE\b') { $Res.DefinerWithDynamic++ }
            if (Count-Pattern $Info.Body '^[ \t]*(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b') { $Res.DefinerWithDml++ }
            if (Count-Pattern $Info.Body '\bauth\.uid\s*\(|\bcurrent_setting\s*\([ \t]*''request\.jwt\.claims') {
                $Res.DefinerWithAuth++
            }
            if (Count-Pattern $Info.Body '\b(?:GRANT|REVOKE|SET\s+ROLE)\b') { $Res.DefinerWithGrant++ }
        }
        if ((Count-Pattern $Info.Ddl '\bCREATE\s+FUNCTION\b') -ne 1) { $Res.SuspiciousSections++ }
    }
    return [pscustomobject]$Res
}

Write-Host 'SUPER LEADER B5.8.1 - PRECISE FUNCTION SCOPE (OFFLINE)' -ForegroundColor Cyan
if ($SelfTest) {
    $Fixture = @'
CREATE FUNCTION public.fn_one() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $body$
BEGIN
  INSERT INTO public.fake VALUES (1);
  EXECUTE 'SELECT 1; -- ignore';
  RETURN 1;
END;
$body$;
CREATE FUNCTION public.fn_two() RETURNS integer
LANGUAGE sql SECURITY INVOKER
AS $$ SELECT 2; $$;
CREATE FUNCTION public.fn_three() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
AS $inner$
BEGIN
  PERFORM 1;
  RETURN 3;
END;
$inner$;
'@
    $Test = Inspect-FunctionSql -Sql $Fixture -ExpectedFunctions 3
    if ($Test.Definer -ne 2 -or $Test.DefinerWithPath -ne 1 -or $Test.DefinerWithoutPath -ne 1 -or $Test.DefinerWithDml -ne 1 -or $Test.DefinerWithDynamic -ne 1 -or $Test.MissingDollarBody -ne 0 -or $Test.SuspiciousSections -ne 0) {
        throw 'B5.8.1 SYNTHETIC SELF TEST FAILED.'
    }
    Write-Host 'B5.8.1 SYNTHETIC SELF TEST: PASS' -ForegroundColor Green
    return
}

$File = Join-Path $env:LOCALAPPDATA 'SuperLeader\PrivateSchemaExports\schema-20261124-211550-347\public-schema-only.sql'
$Hash = 'F126AFE9D38B7B3C4F8C030FB03596CCAE6826CAD107E280709AB585C71D3785'
if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { throw 'Private B4 SQL is missing.' }
if ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash -ne $Hash) { throw 'Private B4 fingerprint mismatch.' }
$Repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$Resolved = (Resolve-Path -LiteralPath $File).Path
if ($Resolved.StartsWith($Repo.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Private B4 SQL must stay outside Git.' }
Write-Host 'B4 private SQL fingerprint: MATCH'
$Sql = [System.IO.File]::ReadAllText($Resolved,[System.Text.Encoding]::UTF8)
$Result = Inspect-FunctionSql -Sql $Sql -ExpectedFunctions 178
$RawDefiner = Count-Pattern $Sql '\bSECURITY\s+DEFINER\b'
$Policies = Count-Pattern $Sql '^[ \t]*CREATE\s+POLICY\b'
$Rls = Count-Pattern $Sql '^[ \t]*ALTER\s+TABLE[^\r\n]*\bENABLE\s+ROW\s+LEVEL\s+SECURITY\b'
Write-Host ('Function definitions: '+$Result.Functions)
Write-Host ('SECURITY DEFINER text occurrences (B5.6): '+$RawDefiner)
Write-Host ('Scoped SECURITY DEFINER functions: '+$Result.Definer)
Write-Host ('  Definer with per-function search_path declaration: '+$Result.DefinerWithPath)
Write-Host ('  Definer without per-function search_path declaration: '+$Result.DefinerWithoutPath)
Write-Host ('  Definer with EXECUTE in dollar body: '+$Result.DefinerWithDynamic)
Write-Host ('  Definer with apparent write statements in body: '+$Result.DefinerWithDml)
Write-Host ('  Definer with auth.uid() or JWT claim references: '+$Result.DefinerWithAuth)
Write-Host ('  Definer with GRANT/REVOKE/SET ROLE markers in body: '+$Result.DefinerWithGrant)
Write-Host ('  Functions missing dollar-quoted body: '+$Result.MissingDollarBody)
Write-Host ('  Function sections requiring parser review: '+$Result.SuspiciousSections)
Write-Host ('RLS enabled table declarations: '+$Rls)
Write-Host ('CREATE POLICY declarations: '+$Policies)
Write-Host 'Note: EXECUTE privileges on PostgreSQL functions may be granted to PUBLIC by default.'
Write-Host 'No function text, names, SQL, or credentials were printed.'
if ($Result.Definer -ne $RawDefiner) { Write-Warning 'Raw vs scoped definer counts differ: investigate offline.' }
if ($Result.DefinerWithoutPath -gt 0) { Write-Warning 'Some privileged functions lack pinned search_path declarations.' }
if ($Result.DefinerWithDynamic -gt 0) { Write-Warning 'Some privileged functions contain EXECUTE markers: targeted review required.' }
if ($Result.MissingDollarBody -gt 0 -or $Result.SuspiciousSections -gt 0) { Write-Warning 'SQL parser assumptions require manual verification.' }
if ($Rls -ne 315 -or $Policies -ne 169) { Write-Warning 'RLS/policy coverage differs from B4 baseline.' }
Write-Host 'B5.8.1 CORRECTED OFFLINE AUDIT COMPLETE - NO RESTORE AUTHORIZED' -ForegroundColor Yellow
