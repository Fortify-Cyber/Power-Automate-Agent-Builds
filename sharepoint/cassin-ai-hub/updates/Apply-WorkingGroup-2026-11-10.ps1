<#
.SYNOPSIS
    Applies the decisions from the AI Working Group call of Nov 10, 2026 to the hub's lists:
    the AI Roadmap, Waiting on Cassin and AI Agents.

.DESCRIPTION
    Run once, after Deploy-CassinAIHub.ps1 (which adds Eric Kaden's prompts, the Team filter and
    the On hold statuses). Safe to run again: items are matched by name, new items are only
    added if they aren't there yet, and notes are only appended once.

    Changes:
    - AI Roadmap: Cassin AI Hub to Firm rollout; Email Filing Assistant on hold; next steps for
      Fannie & Freddie Guide Q&A, Deal Intake and Sig Pages & Exec Letters (the first item for
      legal assistants, moved to Quick Wins); new items for the agency team prompts and a time
      entry assistant.
    - Waiting on Cassin: the Copilot app stopgap question closed; five new items from the call.
    - AI Agents: Email Filing Assistant on hold, so it leaves "Coming next" on Agents & Tools.

.EXAMPLE
    ./updates/Apply-WorkingGroup-2026-11-10.ps1 -TenantName cassinllp -ClientId <client-id>
#>
#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $TenantName,
    [Parameter(Mandatory)] [string] $ClientId,
    [string] $SiteAlias = "AIHub"
)

$ErrorActionPreference = "Stop"
Import-Module PnP.PowerShell -MinimumVersion 3.0.0
$siteUrl = "https://$TenantName.sharepoint.com/sites/$SiteAlias"
$marker  = "Nov 10 WG:"

Write-Host "Signing in to $siteUrl" -ForegroundColor Cyan
Connect-PnPOnline -Url $siteUrl -Interactive -ClientId $ClientId

function Find-Item([string] $List, [string] $Title) {
    $t = [System.Security.SecurityElement]::Escape($Title)
    Get-PnPListItem -List $List -Query "<View><Query><Where><Eq><FieldRef Name='Title'/><Value Type='Text'>$t</Value></Eq></Where></Query></View>" |
        Select-Object -First 1
}

# Sets fields on the item called $Title. A "Note" is appended to $NoteField once.
function Update-Item([string] $List, [string] $Title, [hashtable] $Values, [string] $NoteField = "", [string] $Note = "") {
    $item = Find-Item $List $Title
    if (-not $item) { Write-Host "  $Title`: not found in $List, skipped" -ForegroundColor Yellow; return }
    $v = @{} + $Values
    if ($Note) {
        $old = [string] $item[$NoteField]
        if ($old -notlike "*$marker*") { $v[$NoteField] = ($old.TrimEnd() + "`n`n$marker $Note").Trim() }
    }
    if ($v.Count) { Set-PnPListItem -List $List -Identity $item.Id -Values $v | Out-Null }
    Write-Host "  $Title`: updated"
}

function Add-Item([string] $List, [string] $Title, [hashtable] $Values) {
    if (Find-Item $List $Title) { Write-Host "  $Title`: already there"; return }
    Add-PnPListItem -List $List -Values (@{ Title = $Title } + $Values) | Out-Null
    Write-Host "  $Title`: added"
}

# Roadmap item IDs for a lookup column. PnP needs object[], and PowerShell would turn a
# one-item array returned from a function into a plain number, hence the leading comma.
function Get-Ids([string[]] $Titles) {
    $ids = [object[]] @($Titles | ForEach-Object { $i = Find-Item "Lists/AIRoadmap" $_; if ($i) { $i.Id } })
    return ,$ids
}

# ---- AI Roadmap ------------------------------------------------------------
Write-Host "`n== AI Roadmap" -ForegroundColor Cyan
$R = "Lists/AIRoadmap"
Update-Item $R "Cassin AI Hub (SharePoint)" @{
    RoadmapStage = "Firm rollout"
    NextUp = "Announce the hub to the firm, and add an AI Hub button to the firm's start page (with John and Michael)."
} "RoadmapNotes" "Working group signed off. Changes from the call: Copy prompt moved to the top of each prompt, a Team filter in the Prompt Library (Agency team first), and a note to open videos in Edge if YouTube asks to sign in."
Update-Item $R "Email Filing Assistant" @{ RoadmapStage = "On hold"; NextUp = "" } "RoadmapNotes" `
    "On hold. Folder naming conventions vary too much for one set of filing rules, and running it in Copilot Cowork would cost about `$3,500 a month at full use. Revisit later."
Update-Item $R "Fannie & Freddie Guide Q&A" @{ NextUp = "Will and Mike to meet this week to plan the pilot." }
Update-Item $R "Deal Intake" @{ NextUp = "Walk through the current intake workflow with Tom, then a first draft for the team to test." } "RoadmapNotes" `
    "CMMS isn't connected to Microsoft 365; opening a matter in CMMS sets up the NetDocs folders. CMMS is an outsourced, custom system."
Update-Item $R "Sig Pages & Exec Letters" @{
    Track = "Quick Wins"
    NextUp = "Ask Jen Maldonado to help shape it: the first item built for legal assistants."
} "RoadmapNotes" "Legal assistants use Copilot least, and nothing on the hub is aimed at them yet. Every deal has signature pages and they rarely come back right the first time, so this touches every legal assistant."
Add-Item $R "Agency team prompts" @{
    RoadmapStage = "Pilot"; Track = "Quick Wins"; ItemType = [string[]] @("Prompt"); HomeArea = [string[]] @("Prompt Pack")
    Champion = "Eric Kaden"; NextUp = "Working group tests Eric's 9 prompts; Will and others send theirs."
    RoadmapNotes = "$marker Eric shared 9 agency prompts (background searches, search check, good standing, incumbency, title exception, org chart, recorded documents, executed documents, title commitment). In the Prompt Library under the Agency team filter, marked as being tested."
    PublishedLink = "$siteUrl/SitePages/Prompt-Library.aspx, Prompt Library"
}
Add-Item $R "Time Entry Assistant" @{
    RoadmapStage = "Scoping"; Track = "Not Now"; ItemType = [string[]] @("Agent"); HomeArea = [string[]] @("Background")
    Champion = "TBD"; TimeSaved = "Time entry, for everyone"
    RoadmapNotes = "$marker From Elliot's feedback: drafting time entries from email guesses at matters and can't attribute time, because much of the work happens in NetDocs. It would need NetDocs document activity to be useful."
}

# ---- Waiting on Cassin -----------------------------------------------------
Write-Host "`n== Waiting on Cassin" -ForegroundColor Cyan
$W = "Lists/WaitingOnCassin"
Update-Item $W "Is the Copilot app an acceptable stopgap for email filing while we fix Teams?" @{ WaitingStatus = "Done" } "WaitingNotes" `
    "Email Filing Assistant is on hold, so no longer needed."
$adds = @(
    @("Prompt documents from the working group (Will and others)", @("Agency team prompts"), "Eric's 9 are in the Prompt Library; send yours to Mike to add and credit."),
    @("Add the AI Hub to the firm's start page", @("Cassin AI Hub (SharePoint)"), "With John and Michael, alongside CMMS and NetDocs."),
    @("Ask Jen Maldonado to help shape prompts for legal assistants", @("Sig Pages & Exec Letters"), "Signature pages first."),
    @("Retest the Plan my week prompt with and without brackets", @(), "Cassie: the prompt didn't read the calendar correctly without brackets."),
    @("Time with Tom to walk through the deal intake workflow", @("Deal Intake"), "Then a first draft for the team to test.")
)
foreach ($a in $adds) {
    $v = @{ WaitingStatus = "Open"; WaitingNotes = $a[2] }
    $ids = Get-Ids $a[1]
    if ($ids.Count) { $v.RoadmapItems = $ids }
    Add-Item $W $a[0] $v
}

# ---- AI Agents (Agents & Tools, firm-wide) ---------------------------------
Write-Host "`n== AI Agents" -ForegroundColor Cyan
try {
    $choices = @((Get-PnPField -List "Lists/AIAgents" -Identity "AgentStatus").Choices)
    if ($choices -notcontains "On hold") {
        Set-PnPField -List "Lists/AIAgents" -Identity "AgentStatus" -Values @{ Choices = [string[]] ($choices + "On hold") } | Out-Null
    }
} catch { }
Update-Item "Lists/AIAgents" "Email Filing Assistant" @{ AgentStatus = "On hold" }

Write-Host "`nDone. Check AI Program status: $siteUrl/SitePages/Program-Status.aspx" -ForegroundColor Green
