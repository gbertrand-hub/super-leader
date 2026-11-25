# SUPER LEADER B5.7 - restrict local lab TCP 55322 inbound access.
# Default is READ ONLY. -BlockInbound requires an elevated PowerShell.
# No changes to Docker containers, EFOS, SQL, remote Supabase or other ports.
[CmdletBinding()]
param([switch]$BlockInbound,[switch]$RemoveBlock)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($BlockInbound -and $RemoveBlock) { throw 'Select one action only.' }
$RuleName = 'SuperLeader-B5-LocalPostgres-55322-InboundBlock'
$DbName = 'supabase_db_super-leader-preprod-b5-isolated'
Write-Host 'SUPER LEADER B5.7 - PRIVATE DATABASE PORT GUARD' -ForegroundColor Cyan
$Running = ((& docker inspect -f '{{.State.Running}}' $DbName) | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $Running -ne 'true') { throw 'Isolated B5 database is not running.' }
$Ports = ((& docker port $DbName '5432/tcp') | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $Ports -notmatch ':55322(?:\r?\n|$)') { throw 'Unexpected PostgreSQL port mapping.' }
Write-Host 'Private B5 container verified; PostgreSQL mapped to host TCP 55322.'
Write-Host ('Host binding: ' + $(if ($Ports -match '0\.0\.0\.0|\[::\]') { 'ALL INTERFACES (inbound rule recommended)' } else { 'limited interface' }))
if (-not (Get-Command Get-NetFirewallRule -ErrorAction SilentlyContinue)) { throw 'Windows NetSecurity cmdlets unavailable.' }
$Rule = Get-NetFirewallRule -Name $RuleName -ErrorAction SilentlyContinue
if ($RemoveBlock) {
    if (-not $Rule) { Write-Host 'No matching rule exists. No change made.'; return }
    if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run PowerShell as Administrator to remove the dedicated firewall rule.'
    }
    Remove-NetFirewallRule -Name $RuleName
    Write-Host 'Removed only the dedicated B5 TCP 55322 rule.' -ForegroundColor Yellow
    return
}
if ($BlockInbound) {
    if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run PowerShell as Administrator to add the dedicated inbound firewall rule.'
    }
    if (-not $Rule) {
        New-NetFirewallRule -Name $RuleName -DisplayName 'Super Leader B5 PostgreSQL - block inbound TCP 55322' -Direction Inbound -Action Block -Protocol TCP -LocalPort 55322 -Profile Any -Enabled True | Out-Null
    }
    else {
        if ($Rule.Direction -ne 'Inbound' -or $Rule.Action -ne 'Block') { throw 'Existing B5 rule has unexpected action.' }
        Set-NetFirewallRule -Name $RuleName -Enabled True
    }
}
$Rule = Get-NetFirewallRule -Name $RuleName -ErrorAction SilentlyContinue
if ($Rule) {
    $Filter = $Rule | Get-NetFirewallPortFilter
    $Ok = ($Rule.Enabled -eq 'True' -and $Rule.Direction -eq 'Inbound' -and $Rule.Action -eq 'Block' -and $Filter.Protocol -eq 'TCP' -and [string]$Filter.LocalPort -eq '55322')
    Write-Host ('Dedicated inbound block rule: ' + $(if ($Ok) { 'ACTIVE' } else { 'INCOMPLETE - CHECK WINDOWS FIREWALL' }))
    if (-not $Ok) { throw 'Dedicated rule is not configured as expected.' }
}
else {
    Write-Warning 'No dedicated inbound block rule yet. Do not import the production schema.'
    Write-Host 'Use an elevated PowerShell to run this script with -BlockInbound.'
}
Write-Host 'Only the host firewall rule for TCP 55322 is managed by this script.'
Write-Host 'Windows/WSL networking can require independent testing from another device.'
