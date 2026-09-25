<#
.SYNOPSIS
    Deploys Friday Copilot Tips end to end: SharePoint list + tips, solution import, settings, flow on.

.DESCRIPTION
    1. Builds the solution zip (copilot-tips/build/build_tips_solution.py).
    2. Creates the SharePoint list and loads the tips (scripts/New-TipsList.ps1; safe to re-run).
    3. Signs in to the Power Platform environment with pac.
    4. Finds your SharePoint, Office 365 Outlook and Approvals connections in that environment.
    5. Imports the solution with every setting filled in and the connections wired up.
    6. Turns the flow on.

    Connections are the one thing pac can't create, because each needs a one-time browser sign-in.
    If one is missing, the script prints the link to create it. Create it, then run the script again.

    Re-running is safe. It upgrades the solution in place and re-applies the settings from the config file.

.EXAMPLE
    ./copilot-tips/deploy/Deploy-FridayTips.ps1 -Config ./copilot-tips/deploy/fortify.json

.EXAMPLE
    # Remote or headless shell: sign in with codes at https://microsoft.com/devicelogin
    ./copilot-tips/deploy/Deploy-FridayTips.ps1 -Config ./copilot-tips/deploy/cassin.json -UseDeviceCode
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$Config,
    [switch]$UseDeviceCode,
    [switch]$SkipList,         # the list already exists and is stocked
    [switch]$LeaveOff,         # import without turning the flow on
    [string]$Zip,              # use this zip instead of building
    [string]$SharePointConnectionId,
    [string]$OutlookConnectionId,
    [string]$ApprovalsConnectionId
)
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$repo = Resolve-Path (Join-Path $root "..")

# --- Config
$cfg = Get-Content -Raw -Path $Config | ConvertFrom-Json
$required = "EnvironmentUrl", "SiteUrl", "ListName", "Recipients", "Reviewer"
foreach ($k in $required + "SharedMailbox", "FirstFriday", "TenantId") {
    if ("$($cfg.$k)" -match "^<") { throw "$Config`: replace the placeholder for $k ($($cfg.$k))" }
}
foreach ($k in $required) { if (-not "$($cfg.$k)".Trim()) { throw "$Config`: $k is required" } }
$envUrl = $cfg.EnvironmentUrl.TrimEnd("/")
$yesNo = { param($b) if ($b) { "yes" } else { "no" } }

if (-not (Get-Command pac -ErrorAction SilentlyContinue)) {
    throw "Install the Power Platform CLI first: https://aka.ms/PowerPlatformCLI (or: dotnet tool install --global Microsoft.PowerApps.CLI.Tool)"
}

# --- 1. Build
if (-not $Zip) {
    $py = if (Get-Command python3 -ErrorAction SilentlyContinue) { "python3" } else { "python" }
    & $py (Join-Path $root "build/build_tips_solution.py")
    if ($LASTEXITCODE) { throw "Build failed" }
    $Zip = (Get-ChildItem (Join-Path $repo "out") -Filter "FridayCopilotTips_*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
}
Write-Host "[1/5] Solution: $Zip"

# --- 2. SharePoint list + tips
if ($SkipList) {
    Write-Host "[2/5] SharePoint list: skipped"
} else {
    Write-Host "[2/5] SharePoint list and tips..."
    $listArgs = @{ SiteUrl = $cfg.SiteUrl; ListName = $cfg.ListName }
    if ($cfg.FirstFriday) { $listArgs.FirstFriday = [datetime]$cfg.FirstFriday }
    if ($cfg.TenantId) { $listArgs.TenantId = $cfg.TenantId }
    if ($UseDeviceCode) { $listArgs.UseDeviceCode = $true }
    & (Join-Path $root "scripts/New-TipsList.ps1") @listArgs
}

# --- 3. Sign in to the environment
Write-Host "[3/5] Signing in to $envUrl ..."
$authName = "FridayTips-" + ([Uri]$envUrl).Host.Split(".")[0]
$authArgs = @("auth", "create", "--name", $authName, "--environment", $envUrl)
if ($cfg.TenantId) { $authArgs += @("--tenant", $cfg.TenantId) }
if ($UseDeviceCode) { $authArgs += "--deviceCode" }
pac @authArgs
if ($LASTEXITCODE) { throw "pac auth create failed" }
pac auth select --name $authName | Out-Null

# --- 4. Connections
Write-Host "[4/5] Looking for connections..."
$listing = (pac connection list --environment $envUrl) -join "`n"
$envId = ((pac org who) -join "`n" | Select-String -Pattern "Environment ID:\s*([0-9a-fA-F-]{36})").Matches.Groups[1].Value
$connLink = if ($envId) { "https://make.powerautomate.com/environments/$envId/connections" } else { "https://make.powerautomate.com/connections" }

function Find-Connection([string]$Api, [string]$Given) {
    if ($Given) { return $Given }
    $lines = $listing -split "`n" | Where-Object { $_ -match "/apis/$Api(\s|$)" -or $_ -match "\s$Api(\s|$)" }
    $ok = @($lines | Where-Object { $_ -match "Connected" })
    $pick = if ($ok) { $ok[0] } elseif ($lines) { @($lines)[0] } else { $null }
    if ($pick) { return ($pick.Trim() -split "\s+")[0] }
    return $null
}
$conns = [ordered]@{
    "fc_FridayTips_SharePoint" = @{ Api = "shared_sharepointonline"; Label = "SharePoint";         Id = (Find-Connection "shared_sharepointonline" $SharePointConnectionId) }
    "fc_FridayTips_Outlook"    = @{ Api = "shared_office365";        Label = "Office 365 Outlook"; Id = (Find-Connection "shared_office365" $OutlookConnectionId) }
    "fc_FridayTips_Approvals"  = @{ Api = "shared_approvals";        Label = "Approvals";          Id = (Find-Connection "shared_approvals" $ApprovalsConnectionId) }
}
$missing = @($conns.Values | Where-Object { -not $_.Id })
if ($missing) {
    Write-Host ""
    Write-Host "These connections don't exist in this environment yet:" -ForegroundColor Yellow
    $missing | ForEach-Object { Write-Host "  - $($_.Label)" }
    Write-Host ""
    Write-Host "Create them (about a minute): $connLink"
    Write-Host "  + New connection -> search the name -> Create -> sign in as the account that should own the flow."
    Write-Host "Then run this script again with -SkipList."
    Write-Host ""
    Write-Host "Connections pac can see:"
    Write-Host $listing
    exit 1
}
$conns.GetEnumerator() | ForEach-Object { Write-Host ("  {0,-20} {1}" -f $_.Value.Label, $_.Value.Id) }

# --- 5. Import with settings
$settings = @{
    EnvironmentVariables = @(
        @{ SchemaName = "fc_FCT_SiteUrl";       Value = $cfg.SiteUrl }
        @{ SchemaName = "fc_FCT_ListName";      Value = $cfg.ListName }
        @{ SchemaName = "fc_FCT_Recipients";    Value = $cfg.Recipients }
        @{ SchemaName = "fc_FCT_ApproverEmail"; Value = $cfg.Reviewer }
        @{ SchemaName = "fc_FCT_SharedMailbox"; Value = $(if ($cfg.SharedMailbox) { $cfg.SharedMailbox } else { "none" }) }
        @{ SchemaName = "fc_FCT_OrgName";       Value = $cfg.OrgName }
        @{ SchemaName = "fc_FCT_SignOff";       Value = $cfg.SignOff }
        @{ SchemaName = "fc_FCT_BrandColor";    Value = $cfg.BrandColor }
        @{ SchemaName = "fc_FCT_SendTime";      Value = $cfg.SendTime }
        @{ SchemaName = "fc_FCT_AutoSend";      Value = (& $yesNo $cfg.AutoSend) }
        @{ SchemaName = "fc_FCT_SendNow";       Value = (& $yesNo $cfg.TestMode) }
    ) | Where-Object { "$($_.Value)" -ne "" }
    ConnectionReferences = @($conns.GetEnumerator() | ForEach-Object {
        @{ LogicalName = $_.Key; ConnectionId = $_.Value.Id; ConnectorId = "/providers/Microsoft.PowerApps/apis/$($_.Value.Api)" }
    })
}
$settingsFile = Join-Path ([IO.Path]::GetTempPath()) "friday-tips-settings-$authName.json"
$settings | ConvertTo-Json -Depth 5 | Set-Content -Path $settingsFile -Encoding UTF8

Write-Host "[5/5] Importing the solution$(if (-not $LeaveOff) { ' and turning the flow on' })..."
$importArgs = @("solution", "import", "--path", $Zip, "--settings-file", $settingsFile,
                "--publish-changes", "--async", "--max-async-wait-time", "30")
if (-not $LeaveOff) { $importArgs += "--activate-plugins" }
pac @importArgs
if ($LASTEXITCODE) { throw "pac solution import failed" }
Remove-Item $settingsFile -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Done. Friday Copilot Tips is deployed to $envUrl." -ForegroundColor Green
Write-Host "  Recipients: $($cfg.Recipients)   Reviewer: $($cfg.Reviewer)   Test mode: $(& $yesNo $cfg.TestMode)"
Write-Host ""
Write-Host "Next: open https://make.powerautomate.com -> Solutions -> Friday Copilot Tips -> Friday Copilot Tip -> Run."
Write-Host "Within a minute the reviewer gets the [Preview] email and the approval. See copilot-tips/docs/setup-guide.md, step 4."
if ($LeaveOff) { Write-Host "The flow was left off (-LeaveOff): select Turn on first." }
