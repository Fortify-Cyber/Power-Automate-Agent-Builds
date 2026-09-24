<#
.SYNOPSIS
    Reviews Power Automate cloud flows in an environment using the Power Platform CLI (pac).

.DESCRIPTION
    Uses the pac power-automate commands to:
      - list cloud flows (optionally filtered by name),
      - list each flow's actions and the connectors they use,
      - show recent run history (to spot failures),
      - flag risky patterns in action parameters: personal mail domains
        (data leaving the tenant) and hardcoded @<your-domain> recipients
        (flows that can't be rolled out to other users).

    Requires the Power Platform CLI (https://aka.ms/PowerPlatformCLI). The
    power-automate commands are in preview and need admin rights in the environment.

.EXAMPLE
    ./scripts/Review-Flows.ps1 -EnvironmentUrl https://org44f2ca29.crm.dynamics.com -NameFilter Digest -OrgDomain fortifycyber.com
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $EnvironmentUrl,
    [string] $NameFilter = '',
    [string] $OrgDomain = '',
    [string[]] $PersonalDomains = @('gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'proton.me')
)

$ErrorActionPreference = 'Stop'

function Invoke-PacJson {
    $out = & pac @args --json
    if ($LASTEXITCODE -ne 0) { throw "pac $($args -join ' ') failed" }
    ($out | Out-String) | ConvertFrom-Json
}

if (-not (& pac auth list | Select-String -Quiet $EnvironmentUrl)) {
    & pac auth create --environment $EnvironmentUrl
}

$flows = Invoke-PacJson power-automate list-cloud-flows --environment $EnvironmentUrl
if ($NameFilter) { $flows = $flows | Where-Object { $_.name -like "*$NameFilter*" } }

foreach ($flow in $flows) {
    $id = $flow.workflowid
    Write-Host "`n=== $($flow.name)  ($id)" -ForegroundColor Cyan

    $actions = Invoke-PacJson power-automate list-flow-actions --environment $EnvironmentUrl --workflow-id $id
    $actions | Group-Object connector | ForEach-Object {
        Write-Host ("  {0,-40} {1} action(s)" -f ($_.Name ?? 'built-in'), $_.Count)
    }

    $runs = Invoke-PacJson power-automate list-flow-runs --environment $EnvironmentUrl --workflow-id $id
    $recent = $runs | Select-Object -First 20
    $failed = @($recent | Where-Object { $_.status -match 'Failed|Faulted' }).Count
    Write-Host "  Last $(@($recent).Count) runs: $failed failed"

    foreach ($domain in $PersonalDomains) {
        $hits = Invoke-PacJson power-automate list-flow-actions --environment $EnvironmentUrl --workflow-id $id --parameter-value "@$domain"
        foreach ($h in $hits) { Write-Warning "  Personal address ($domain) in action '$($h.name)': corporate data may leave the tenant." }
    }
    if ($OrgDomain) {
        $hits = Invoke-PacJson power-automate list-flow-actions --environment $EnvironmentUrl --workflow-id $id --parameter-value "@$OrgDomain"
        foreach ($h in $hits) { Write-Warning "  Hardcoded @$OrgDomain address in action '$($h.name)': the flow is tied to one user." }
    }
}
