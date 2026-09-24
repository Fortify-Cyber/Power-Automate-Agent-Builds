<#
.SYNOPSIS
    Deploys the Fortify Daily Digest Copilot agent into a client's Power Platform environment.

.DESCRIPTION
    1. Signs in to the target environment with the Power Platform CLI (pac).
    2. Imports the Daily Digest solution.
    3. Publishes the agent.
    4. Prints the remaining admin-center steps (Teams / Microsoft 365 Copilot channel and rollout).

    Prerequisites: Power Platform CLI (https://aka.ms/PowerPlatformCLI) and an account with the
    System Administrator or System Customizer role in the target environment.

.PARAMETER EnvironmentUrl
    The Dataverse URL of the target environment, e.g. https://contoso.crm.dynamics.com

.PARAMETER SolutionZip
    Path to the solution zip. Defaults to the newest out/FortifyDailyDigest_*.zip (build it with
    `python3 build/build_solution.py`).

.PARAMETER TenantId
    Optional. The client's Entra tenant ID, for signing in to a tenant other than your home tenant.

.EXAMPLE
    ./deploy/Deploy-DailyDigest.ps1 -EnvironmentUrl https://contoso.crm.dynamics.com
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $EnvironmentUrl,
    [string] $SolutionZip,
    [string] $TenantId
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$botSchema = 'fc_DailyDigest'

function Invoke-Pac {
    & pac @args
    if ($LASTEXITCODE -ne 0) { throw "pac $($args -join ' ') failed with exit code $LASTEXITCODE" }
}

if (-not (Get-Command pac -ErrorAction SilentlyContinue)) {
    throw 'The Power Platform CLI (pac) is not installed. Install it from https://aka.ms/PowerPlatformCLI and re-run.'
}

if (-not $SolutionZip) {
    $SolutionZip = Get-ChildItem (Join-Path $repoRoot 'out') -Filter 'FortifyDailyDigest_*.zip' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
    if (-not $SolutionZip) {
        Write-Host 'No solution zip found. Building it...' -ForegroundColor Cyan
        & python (Join-Path $repoRoot 'build/build_solution.py')
        if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
        $SolutionZip = Get-ChildItem (Join-Path $repoRoot 'out') -Filter 'FortifyDailyDigest_*.zip' |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
    }
}
Write-Host "Solution: $SolutionZip" -ForegroundColor Cyan

Write-Host "`n[1/3] Signing in to $EnvironmentUrl ..." -ForegroundColor Cyan
$authArgs = @('auth', 'create', '--name', 'DailyDigestDeploy', '--environment', $EnvironmentUrl)
if ($TenantId) { $authArgs += @('--tenant', $TenantId) }
Invoke-Pac @authArgs
Invoke-Pac auth select --name DailyDigestDeploy

Write-Host "`n[2/3] Importing solution ..." -ForegroundColor Cyan
Invoke-Pac solution import --path $SolutionZip --publish-changes --async --max-async-wait-time 30

Write-Host "`n[3/3] Publishing the agent ..." -ForegroundColor Cyan
Invoke-Pac copilot publish --bot $botSchema

Write-Host @"

Daily Digest is imported and published in $EnvironmentUrl.

Remaining steps (about 10 minutes, see docs/admin-deployment-guide.md):
  A. Copilot Studio (copilotstudio.microsoft.com) > Daily Digest > Channels >
     'Teams and Microsoft 365 Copilot' > turn on 'Make agent available in Microsoft 365 Copilot' > Add channel.
  B. In the same pane, choose 'Availability options' > 'Show to everyone in my org' > Submit for admin approval.
  C. Microsoft 365 admin center > Settings > Integrated apps > Daily Digest > Publish, and assign it to
     all users (or a pilot group). Optionally pin it for users in Copilot and Teams.
  D. Send employees docs/user-guide.md so they can schedule their digest.
"@ -ForegroundColor Green
