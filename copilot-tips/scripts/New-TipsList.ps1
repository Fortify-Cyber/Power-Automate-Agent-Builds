<#
.SYNOPSIS
    Creates the "Friday Copilot Tips" SharePoint list and loads the tip library into it.

.DESCRIPTION
    Uses Microsoft Graph PowerShell, so there's no app registration to set up. Sign in as someone
    who can edit the site. The list gets exactly the column names the flow expects. Each tip
    from tips/tips.csv becomes one row with Status = Queued, one Friday apart starting at
    -FirstFriday.

    Safe to re-run: an existing list is reused, missing columns are added, and a tip whose
    Title is already in the list is skipped.

.EXAMPLE
    ./scripts/New-TipsList.ps1 -SiteUrl https://fortifycyber.sharepoint.com/sites/IT -FirstFriday 2026-10-02

.EXAMPLE
    # Cassin: different tenant, same library
    ./scripts/New-TipsList.ps1 -SiteUrl https://cassin.sharepoint.com/sites/AI -FirstFriday 2026-10-16 -TenantId <cassin-tenant-id>
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$SiteUrl,
    [string]$ListName = "Friday Copilot Tips",
    [datetime]$FirstFriday,
    [string]$TipsCsv = (Join-Path $PSScriptRoot "../tips/tips.csv"),
    [string]$TenantId,
    [switch]$SkipImport,
    # Sign in with a code at https://microsoft.com/devicelogin (for remote or headless shells)
    [switch]$UseDeviceCode
)
$ErrorActionPreference = "Stop"

if (-not (Get-Module -ListAvailable Microsoft.Graph.Authentication)) {
    Write-Host "Installing Microsoft.Graph.Authentication for the current user..."
    Install-Module Microsoft.Graph.Authentication -Scope CurrentUser -Force
}
Import-Module Microsoft.Graph.Authentication

$connect = @{ Scopes = @("Sites.Manage.All"); NoWelcome = $true }
if ($TenantId) { $connect.TenantId = $TenantId }
if ($UseDeviceCode) { $connect.UseDeviceCode = $true }
# Reuse an existing Graph sign-in that already has the scope we need.
$ctx = Get-MgContext
if (-not ($ctx -and $ctx.Scopes -contains "Sites.Manage.All" -and (-not $TenantId -or $ctx.TenantId -eq $TenantId))) {
    Connect-MgGraph @connect
}

function Invoke-Graph([string]$Method, [string]$Path, $Body) {
    $req = @{ Method = $Method; Uri = "https://graph.microsoft.com/v1.0$Path"; OutputType = "PSObject" }
    if ($Body) { $req.Body = ($Body | ConvertTo-Json -Depth 10); $req.ContentType = "application/json" }
    Invoke-MgGraphRequest @req
}

# --- Site
$uri = [Uri]$SiteUrl.TrimEnd("/")
$site = Invoke-Graph GET "/sites/$($uri.Host):$($uri.AbsolutePath)"
Write-Host "Site: $($site.displayName) ($($site.webUrl))"

# --- Columns the flow reads and writes (internal names matter; don't rename them)
$multi = @{ allowMultipleLines = $true; textType = "plain"; linesForEditing = 4 }
$columns = @(
    @{ name = "WeekDate";     displayName = "Planned Friday"; description = "Tips go out in this order (earliest Queued first)."; dateTime = @{ format = "dateOnly" } }
    @{ name = "Subject";      displayName = "Subject";        description = "Email subject line."; text = @{} }
    @{ name = "WhyItMatters"; displayName = "Why it helps";   description = "One sentence on the benefit."; text = $multi }
    @{ name = "TipSteps";     displayName = "Steps";          description = "One step per line. Don't number them."; text = $multi }
    @{ name = "TryPrompt";    displayName = "Prompt to try";  description = "A prompt people can copy and paste."; text = $multi }
    @{ name = "LearnUrl";     displayName = "Microsoft article URL"; text = @{} }
    @{ name = "LearnLabel";   displayName = "Microsoft article title"; text = @{} }
    @{ name = "VideoUrl";     displayName = "Video URL";      description = "Optional. Official Microsoft video."; text = @{} }
    @{ name = "VideoLabel";   displayName = "Video title";    description = "Optional. Required if Video URL is set."; text = @{} }
    @{ name = "WorksWith";    displayName = "Works with";     choice = @{ choices = @("Copilot Chat (everyone)", "Microsoft 365 Copilot license"); displayAs = "dropDownMenu" }; defaultValue = @{ value = "Copilot Chat (everyone)" } }
    @{ name = "Status";       displayName = "Status";         description = "Queued = waiting to send. Sent = done. Skipped = never send."; choice = @{ choices = @("Queued", "Sent", "Skipped"); displayAs = "dropDownMenu" }; defaultValue = @{ value = "Queued" } }
    @{ name = "SentOn";       displayName = "Sent on";        description = "Filled in by the flow."; dateTime = @{ format = "dateTime" } }
    @{ name = "Notes";        displayName = "Notes";          description = "Reviewer notes. Not emailed."; text = $multi }
)

# --- List (create or reuse)
$existing = (Invoke-Graph GET "/sites/$($site.id)/lists?`$select=id,displayName,webUrl").value |
    Where-Object { $_.displayName -eq $ListName }
if ($existing) {
    $list = $existing | Select-Object -First 1
    Write-Host "Using existing list: $($list.webUrl)"
    $have = (Invoke-Graph GET "/sites/$($site.id)/lists/$($list.id)/columns?`$select=name").value.name
    foreach ($c in $columns | Where-Object { $_.name -notin $have }) {
        Invoke-Graph POST "/sites/$($site.id)/lists/$($list.id)/columns" $c | Out-Null
        Write-Host "  added column $($c.name)"
    }
} else {
    $list = Invoke-Graph POST "/sites/$($site.id)/lists" @{
        displayName = $ListName
        description = "Weekly Copilot tips. The Friday Copilot Tip flow sends the earliest Queued tip each week."
        columns     = $columns
        list        = @{ template = "genericList" }
    }
    Write-Host "Created list: $($list.webUrl)"
}

# --- Tips
if (-not $SkipImport) {
    if (-not $PSBoundParameters.ContainsKey("FirstFriday")) {
        $d = (Get-Date).Date.AddDays(1)
        while ($d.DayOfWeek -ne "Friday") { $d = $d.AddDays(1) }
        $FirstFriday = $d
    }
    if ($FirstFriday.DayOfWeek -ne "Friday") { throw "-FirstFriday $($FirstFriday.ToString('yyyy-MM-dd')) is a $($FirstFriday.DayOfWeek)" }

    $titles = @()
    $page = "/sites/$($site.id)/lists/$($list.id)/items?`$expand=fields(`$select=Title,WeekDate)&`$top=500"
    $latest = $null
    while ($page) {
        $resp = Invoke-Graph GET $page
        foreach ($i in $resp.value) {
            $titles += $i.fields.Title
            if ($i.fields.WeekDate -and ([datetime]$i.fields.WeekDate -gt $latest)) { $latest = [datetime]$i.fields.WeekDate }
        }
        $page = if ($resp.'@odata.nextLink') { $resp.'@odata.nextLink' -replace '^https://graph.microsoft.com/v1.0', '' } else { $null }
    }
    # Adding to a list that already has tips: continue the schedule after the last one.
    $next = $FirstFriday
    if ($latest -and $latest.Date -ge $next) { $next = $latest.Date.AddDays(7) }

    $added = 0
    foreach ($t in Import-Csv -Path $TipsCsv -Encoding UTF8) {
        if ($t.Title -in $titles) { Write-Host "  skip (already in list): $($t.Title)"; continue }
        $fields = @{
            Title        = $t.Title
            WeekDate     = $next.ToString("yyyy-MM-dd") + "T12:00:00Z"
            Subject      = $t.Subject
            WhyItMatters = $t.WhyItMatters
            TipSteps     = (($t.TipSteps -split '\s\|\s') | ForEach-Object { $_.Trim() }) -join "`n"
            TryPrompt    = $t.TryPrompt
            LearnUrl     = $t.LearnUrl
            LearnLabel   = $t.LearnLabel
            WorksWith    = $t.WorksWith
            Status       = "Queued"
        }
        if ($t.VideoUrl) { $fields.VideoUrl = $t.VideoUrl; $fields.VideoLabel = $t.VideoLabel }
        if ($t.Notes)    { $fields.Notes = $t.Notes }
        Invoke-Graph POST "/sites/$($site.id)/lists/$($list.id)/items" @{ fields = $fields } | Out-Null
        Write-Host ("  {0}  {1}" -f $next.ToString("yyyy-MM-dd"), $t.Title)
        $next = $next.AddDays(7)
        $added++
    }
    Write-Host "Added $added tip(s)."
}

Write-Host ""
Write-Host "Use these values for the flow's environment variables:"
Write-Host "  Friday Tips - SharePoint site URL : $($site.webUrl)"
Write-Host "  Friday Tips - List name           : $ListName"
Write-Host ""
Write-Host "Tip: in the list, All Items > Edit current view > tick Planned Friday, Subject, Status and Works with."
