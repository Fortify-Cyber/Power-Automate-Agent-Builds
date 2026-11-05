<#
.SYNOPSIS
    Builds the Cassin AI Hub SharePoint communication site: theme, lists, starter
    content, pages, navigation and permissions.

.DESCRIPTION
    Run by a Cassin SharePoint (or Global) administrator, on their own device, with
    PowerShell 7.4+ and PnP.PowerShell 3.x. Cassin's Conditional Access blocks
    device-code sign-in, so this uses interactive browser sign-in only.

    Safe to re-run. Existing lists and fields are kept, starter content is only added
    to empty lists, and existing pages are left alone unless -RebuildPages is passed.

    Everything the site shows lives in content/*.json. Edit those files, not this
    script, to change prompts, tips, videos, FAQ, news or page text.

.PARAMETER TenantName
    The SharePoint tenant prefix, for example "cassinllp" for cassinllp.sharepoint.com.

.PARAMETER ClientId
    The Entra ID app used to sign in to PnP PowerShell. Create it once with
    Register-PnPEntraIDAppForInteractiveLogin (see README.md, step 2).

.PARAMETER ShareWithEveryone
    Adds "Everyone except external users" to the site's Visitors group. Leave it off
    for a pilot, then re-run with it (or share from the site) when you launch.

.PARAMETER RebuildPages
    Deletes and recreates the hub pages from content/pages.json. Overwrites any edits
    made to those pages in the browser.

.PARAMETER RebuildPage
    Like -RebuildPages, but only for the named pages, for example
    -RebuildPage Hub-Home, Use-AI-Responsibly. Names are the "Name" values in pages.json.

.PARAMETER AdoptionAdmins
    Email addresses to add to the "AI Hub Admins" group, who can open the Copilot adoption
    page as well as the site owners. They also need the Reports Reader role in Entra ID
    (see README). Members can also be added later in Site settings, People and groups.

.EXAMPLE
    ./Deploy-CassinAIHub.ps1 -TenantName cassinllp -ClientId 00000000-0000-0000-0000-000000000000
#>
#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $TenantName,
    [Parameter(Mandatory)] [string] $ClientId,
    [string] $SiteAlias = "AIHub",
    [string] $SiteTitle = "Cassin AI Hub",
    [switch] $ShareWithEveryone,
    [switch] $RebuildPages,
    [string[]] $RebuildPage = @(),
    [string[]] $AdoptionAdmins = @(),
    [switch] $SkipTheme
)

$ErrorActionPreference = "Stop"
Import-Module PnP.PowerShell -MinimumVersion 3.0.0

$root       = $PSScriptRoot
$contentDir = Join-Path $root "content"
$adminUrl   = "https://$TenantName-admin.sharepoint.com"
$siteUrl    = "https://$TenantName.sharepoint.com/sites/$SiteAlias"
$siteRel    = "/sites/$SiteAlias"
$themeName  = "Cassin"

function Write-Step([string] $Text) { Write-Host "`n== $Text" -ForegroundColor Cyan }
function Read-Content([string] $File) {
    Get-Content (Join-Path $contentDir $File) -Raw -Encoding utf8 | ConvertFrom-Json
}
# Links kept in content/settings.json, such as the AI Acceptable Use Policy. In page HTML the
# URL is HTML-encoded (it contains &); in button and menu links it's used as is.
$settings = Read-Content "settings.json"
function Expand-Tokens([string] $Text, [switch] $Html) {
    $policy = if ($Html) { [System.Net.WebUtility]::HtmlEncode($settings.policyUrl) } else { $settings.policyUrl }
    $Text.Replace("{{siteUrl}}", $siteUrl).Replace("{{policyUrl}}", $policy)
}
# Several PnP "get" cmdlets throw instead of returning nothing when the object is missing.
function Find-Object([scriptblock] $Get) { try { & $Get } catch { $null } }

# ---------------------------------------------------------------------------
# 1. Tenant: theme and site
# ---------------------------------------------------------------------------
Write-Step "Signing in to the SharePoint admin center ($adminUrl)"
Connect-PnPOnline -Url $adminUrl -Interactive -ClientId $ClientId

if (-not $SkipTheme) {
    Write-Step "Adding the '$themeName' theme (Cassin navy #00426C / #021D3C)"
    $palette = Get-Content (Join-Path $root "theme/cassin-theme.json") -Raw | ConvertFrom-Json -AsHashtable
    Add-PnPTenantTheme -Identity $themeName -Palette $palette -IsInverted $false -Overwrite
}

Write-Step "Creating the communication site $siteUrl"
$existing = Find-Object { Get-PnPTenantSite -Identity $siteUrl }
if ($existing) {
    Write-Host "Site already exists, reusing it."
} else {
    New-PnPSite -Type CommunicationSite -Title $SiteTitle -Url $siteUrl -SiteDesign Topic -Lcid 1033 `
        -Description "Prompts, Friday tips, demo videos, agents and news for Microsoft 365 Copilot at Cassin & Cassin." -Wait | Out-Null
    Write-Host "Created."
}

Write-Step "Connecting to the new site"
Connect-PnPOnline -Url $siteUrl -Interactive -ClientId $ClientId

# ---------------------------------------------------------------------------
# 2. Look and feel: theme, header, logo, footer
# ---------------------------------------------------------------------------
Write-Step "Applying theme, header and footer"
if (-not $SkipTheme) { Set-PnPWebTheme -Theme $themeName }
Set-PnPWebHeader -HeaderLayout Standard -HeaderEmphasis Strong -LogoAlignment Left
# Navy background so the logo stays readable on white cards (SharePoint Discover, search).
$logo = Join-Path $root "assets/cassin-logo-navy.png"
if (Test-Path $logo) { Set-PnPSite -LogoFilePath $logo }
Set-PnPFooter -Enabled:$true -Layout Simple -BackgroundTheme Strong -Title "Cassin & Cassin LLP $([char]0x00B7) AI Hub"

# ---------------------------------------------------------------------------
# 3. Lists
# ---------------------------------------------------------------------------
function Get-ChoiceXml([string[]] $Choices) {
    ($Choices | ForEach-Object { "<CHOICE>$([System.Security.SecurityElement]::Escape($_))</CHOICE>" }) -join ""
}

# Fields are created with DisplayName = internal name so SharePoint keeps the internal
# name we chose (AddFieldAsXml otherwise derives it from the display name), then renamed.
function Add-HubField {
    param([string] $List, [string] $Name, [string] $Display, [string] $Type,
          [string] $Extra = "", [string] $Inner = "")
    # Get-PnPField also matches on display name, so compare the internal name: a built-in
    # hidden field can share a display name with ours.
    $found = Find-Object { Get-PnPField -List $List -Identity $Name }
    if ($found -and $found.InternalName -eq $Name) { return }
    $xml = "<Field ID=`"{$([guid]::NewGuid())}`" Type=`"$Type`" Name=`"$Name`" StaticName=`"$Name`" DisplayName=`"$Name`" $Extra>$Inner</Field>"
    Add-PnPFieldFromXml -List $List -FieldXml $xml | Out-Null
    Set-PnPField -List $List -Identity $Name -Values @{ Title = $Display } | Out-Null
}
function Add-NoteField([string] $List, [string] $Name, [string] $Display, [string] $Extra = "") {
    Add-HubField $List $Name $Display "Note" "NumLines=`"6`" RichText=`"FALSE`" AppendOnly=`"FALSE`" $Extra"
}
function Add-ChoiceField([string] $List, [string] $Name, [string] $Display, [string[]] $Choices,
                         [string] $Default = "", [switch] $Multi, [string] $Extra = "") {
    $type  = if ($Multi) { "MultiChoice" } else { "Choice" }
    $fmt   = if ($Multi) { "" } else { "Format=`"Dropdown`"" }
    $inner = "<CHOICES>$(Get-ChoiceXml $Choices)</CHOICES>"
    if ($Default) { $inner += "<Default>$([System.Security.SecurityElement]::Escape($Default))</Default>" }
    Add-HubField $List $Name $Display $type "$fmt FillInChoice=`"FALSE`" $Extra" $inner
}
function New-HubList([string] $Title, [string] $Url, [string] $TitleLabel, [string] $Description,
                     [string] $Template = "GenericList") {
    if (-not (Find-Object { Get-PnPList -Identity $Url })) {
        New-PnPList -Title $Title -Url $Url -Template $Template | Out-Null
        Write-Host "  created $Title"
    }
    Set-PnPList -Identity $Url -Description $Description | Out-Null
    if ($TitleLabel) { Set-PnPField -List $Url -Identity "Title" -Values @{ Title = $TitleLabel } | Out-Null }
}
function Set-HubView([string] $List, [string] $Title, [string[]] $Fields, [string] $Query = "",
                     [int] $RowLimit = 100, [switch] $Default) {
    # Update in place on re-runs: SharePoint won't delete a list's default view.
    if (Find-Object { Get-PnPView -List $List -Identity $Title }) {
        Set-PnPView -List $List -Identity $Title -Fields $Fields `
            -Values @{ ViewQuery = $Query; RowLimit = [uint32] $RowLimit; DefaultView = [bool] $Default } | Out-Null
    } else {
        Add-PnPView -List $List -Title $Title -Fields $Fields -Query $Query -RowLimit $RowLimit -Paged -SetAsDefault:$Default | Out-Null
    }
}
function Set-Formatter([string] $List, [string] $Field, [hashtable] $Json) {
    $Json['$schema'] = "https://developer.microsoft.com/json-schemas/sp/v2/column-formatting.schema.json"
    # [string] unwraps the PSObject that pipeline output carries; Set-PnPField rejects it otherwise.
    $text = [string] ($Json | ConvertTo-Json -Depth 10 -Compress)
    Set-PnPField -List $List -Identity $Field -Values @{ CustomFormatter = $text } | Out-Null
}
function Test-ListEmpty([string] $List) { (Get-PnPList -Identity $List).ItemCount -eq 0 }

$apps      = "Copilot Chat", "Outlook", "Word", "Excel", "PowerPoint", "Teams"
$noNewForm = "ShowInNewForm=`"FALSE`""

# Shared column formats: the prompt box from the Friday Tip email, a Watch button, status pills.
$promptBox = @{ elmType = "div"; txtContent = "@currentField"
    style = @{ "border-left" = "4px solid #00426C"; "background-color" = "#f7f9fc"; padding = "8px 12px"
               "white-space" = "pre-wrap"; "font-style" = "italic"; color = "#021D3C" } }
$watchBtn = @{ elmType = "a"; txtContent = "$([char]0x25B6) Watch"
    attributes = @{ href = "@currentField"; target = "_blank" }
    style = @{ display = "=if(@currentField == '', 'none', 'inline-block')"; "background-color" = "#00426C"
               color = "#ffffff"; padding = "4px 12px"; "text-decoration" = "none"; "font-weight" = "600" } }
function New-Pill([hashtable] $Colors) {
    $expr = "'#eeeeee'"
    foreach ($k in $Colors.Keys) { $expr = "if(@currentField == '$k', '$($Colors[$k])', $expr)" }
    @{ elmType = "span"; txtContent = "@currentField"
       style = @{ "background-color" = "=$expr"; color = "#021D3C"; padding = "2px 10px"
                  "border-radius" = "12px"; "font-weight" = "600"; "font-size" = "12px" } }
}

# ---- Prompt Library -------------------------------------------------------
Write-Step "Prompt Library"
$L = "Lists/PromptLibrary"
New-HubList "Prompt Library" $L "Prompt name" "Copilot prompts that work at Cassin. Anyone can submit one; the AI Working Group approves them."
Add-NoteField   $L "PromptText" "Prompt" "Required=`"TRUE`""
Add-ChoiceField $L "Category" "Category" @("Getting started", "Email & correspondence", "Document review", "Drafting",
    "Deal management", "Meetings & calls", "Research & summaries", "Excel & data", "Getting organized") -Extra "Required=`"TRUE`""
Add-ChoiceField $L "Practice" "Practice" @("All practices", "Agency lending", "Balance sheet & bridge lending", "CMBS",
    "Affordable housing", "Leasing", "Restructuring & workouts", "Private client", "Firm operations") -Default "All practices"
Add-ChoiceField $L "WorksIn" "Works in" $apps -Multi
Add-NoteField   $L "HowToUse" "How to use it"
Add-NoteField   $L "WatchOuts" "Check before you rely on it"
Add-HubField    $L "Featured" "Featured" "Boolean" $noNewForm "<Default>0</Default>"
Add-HubField    $L "Contributor" "Source" "Text" $noNewForm
Set-PnPField -List $L -Identity "PromptText" -Values @{ Description = "Use [brackets] for the parts people fill in. Don't include client names, deal details or anything confidential: approved prompts are visible to the whole firm." } | Out-Null

if (Test-ListEmpty $L) {
    foreach ($p in (Read-Content "prompts.json")) {
        Add-PnPListItem -List $L -Values @{
            Title = $p.Title; PromptText = $p.Prompt; Category = $p.Category; Practice = $p.Practice
            WorksIn = [string[]] $p.WorksIn; HowToUse = $p.HowToUse; WatchOuts = $p.WatchOuts
            Featured = [bool] $p.Featured; Contributor = $p.Contributor } | Out-Null
    }
    Write-Host "  added starter prompts"
}
# Content approval: staff submissions stay pending (visible to the submitter and owners)
# until approved. Turned on after seeding, so the starter prompts are already approved.
Set-PnPList -Identity $L -EnableModeration $true -WriteSecurity WriteOnlyMyItems | Out-Null
Set-HubView $L "By category" @("LinkTitle", "PromptText", "WorksIn", "Practice") `
    "<GroupBy Collapse=`"FALSE`"><FieldRef Name=`"Category`" /></GroupBy><OrderBy><FieldRef Name=`"Title`" /></OrderBy>" -Default
Set-HubView $L "Featured" @("LinkTitle", "PromptText", "WorksIn") `
    "<Where><Eq><FieldRef Name=`"Featured`" /><Value Type=`"Boolean`">1</Value></Eq></Where><OrderBy><FieldRef Name=`"Title`" /></OrderBy>" -RowLimit 6
Set-Formatter $L "PromptText" $promptBox

# ---- Friday Tips ----------------------------------------------------------
Write-Step "Friday Tips"
$L = "Lists/FridayTips"
New-HubList "Friday Tips" $L "Tip" "Every Friday Copilot Tip, newest first."
Add-HubField    $L "TipNumber" "Tip #" "Number" "Decimals=`"0`" Min=`"1`""
Add-HubField    $L "TipDate" "Sent on" "DateTime" "Format=`"DateOnly`" Required=`"TRUE`""
Add-HubField    $L "Headline" "Headline" "Text"
Add-HubField    $L "WorksWith" "Works with" "Text"
Add-NoteField   $L "WhyItHelps" "Why it helps"
Add-NoteField   $L "Steps" "Try it"
Add-NoteField   $L "TipPrompt" "Copy and paste this into Copilot"
Add-HubField    $L "VideoLink" "Video" "URL" "Format=`"Hyperlink`""
Add-HubField    $L "ArticleLink" "Read more" "URL" "Format=`"Hyperlink`""

if (Test-ListEmpty $L) {
    foreach ($t in (Read-Content "friday-tips.json")) {
        Add-PnPListItem -List $L -Values @{
            Title = $t.Title; TipNumber = $t.TipNumber; TipDate = [datetime] $t.TipDate; Headline = $t.Headline
            WorksWith = $t.WorksWith; WhyItHelps = $t.WhyItHelps; Steps = $t.Steps; TipPrompt = $t.Prompt
            VideoLink = "$($t.VideoLink), $($t.VideoTitle)"; ArticleLink = "$($t.ArticleLink), $($t.ArticleTitle)" } | Out-Null
    }
    Write-Host "  added the tips sent so far"
}
$newestFirst = "<OrderBy><FieldRef Name=`"TipDate`" Ascending=`"FALSE`" /></OrderBy>"
Set-HubView $L "All tips" @("TipNumber", "LinkTitle", "TipDate", "WhyItHelps", "TipPrompt", "VideoLink") $newestFirst -Default
Set-HubView $L "Latest tip" @("LinkTitle", "WhyItHelps", "TipPrompt", "VideoLink") $newestFirst -RowLimit 1
Set-Formatter $L "TipPrompt" $promptBox
Set-Formatter $L "VideoLink" $watchBtn

# ---- Demo Videos ----------------------------------------------------------
Write-Step "Demo Videos and Recordings library"
New-HubList "Recordings" "Recordings" "" "Videos recorded at Cassin (Teams recordings, Clipchamp, screen recordings). List each one in Demo Videos." "DocumentLibrary"
$L = "Lists/DemoVideos"
New-HubList "Demo Videos" $L "Video" "Short how-to videos for Copilot and the firm's agents."
Add-HubField    $L "VideoLink" "Link" "URL" "Format=`"Hyperlink`" Required=`"TRUE`""
Add-ChoiceField $L "App" "App" ($apps + "Agents") -Extra "Required=`"TRUE`""
# Not "Level": every list has a hidden built-in "_Level" field titled Level (a number), and
# Add-PnPListItem resolved the key to it. Remove the column an earlier run created under that name.
$oldLevel = Find-Object { Get-PnPField -List $L -Identity "Level" }
if ($oldLevel -and $oldLevel.InternalName -eq "Level") { Remove-PnPField -List $L -Identity $oldLevel -Force }
Add-ChoiceField $L "SkillLevel" "Level" @("Beginner", "Intermediate", "Advanced") -Default "Beginner"
Add-ChoiceField $L "VideoSource" "From" @("Microsoft", "Fortify", "Cassin") -Default "Cassin"
Add-NoteField   $L "VideoDescription" "What it covers"

if (Test-ListEmpty $L) {
    foreach ($v in (Read-Content "videos.json")) {
        Add-PnPListItem -List $L -Values @{
            Title = $v.Title; VideoLink = "$($v.VideoLink), Watch"; App = $v.App; SkillLevel = $v.Level
            VideoSource = $v.Source; VideoDescription = $v.Description } | Out-Null
    }
    Write-Host "  added starter videos"
}
Set-HubView $L "By app" @("LinkTitle", "VideoLink", "VideoDescription", "SkillLevel", "VideoSource") `
    "<GroupBy Collapse=`"FALSE`"><FieldRef Name=`"App`" /></GroupBy><OrderBy><FieldRef Name=`"Title`" /></OrderBy>" -Default
Set-Formatter $L "VideoLink" $watchBtn

# ---- AI Agents ------------------------------------------------------------
Write-Step "AI Agents"
$L = "Lists/AIAgents"
New-HubList "AI Agents" $L "Agent" "Agents built for the firm, what they do and how to start."
Add-ChoiceField $L "AgentStatus" "Status" @("Live", "Pilot", "Up next", "Proposed", "Retired") -Default "Proposed"
Add-NoteField   $L "WhatItDoes" "What it does"
Add-NoteField   $L "HowToStart" "How to start"
Add-HubField    $L "Champion" "Champion" "Text"
# Rough timing shown under "Coming next" on Agents & Tools, e.g. "Late November".
Add-HubField    $L "Expected" "Expected" "Text"

if (Test-ListEmpty $L) {
    foreach ($a in (Read-Content "agents.json")) {
        Add-PnPListItem -List $L -Values @{
            Title = $a.Title; AgentStatus = $a.AgentStatus; WhatItDoes = $a.WhatItDoes
            HowToStart = $a.HowToStart; Champion = $a.Champion; Expected = $a.Expected } | Out-Null
    }
    Write-Host "  added agents"
}
Set-HubView $L "All agents" @("LinkTitle", "AgentStatus", "WhatItDoes", "HowToStart", "Expected", "Champion") `
    "<Where><Neq><FieldRef Name=`"AgentStatus`" /><Value Type=`"Choice`">Retired</Value></Neq></Where><OrderBy><FieldRef Name=`"ID`" /></OrderBy>" -Default
Set-Formatter $L "AgentStatus" (New-Pill ([ordered]@{ "Live" = "#d7f0dd"; "Pilot" = "#d6e9f8"; "Up next" = "#efe7df" }))

# ---- FAQ ------------------------------------------------------------------
Write-Step "FAQ"
$L = "Lists/AIFAQ"
New-HubList "AI FAQ" $L "Question" "Common questions about Copilot and the AI program."
Add-NoteField   $L "Answer" "Answer"
Add-ChoiceField $L "Topic" "Topic" @("Getting started", "Getting better results", "Using AI responsibly", "Agents", "This site") -Default "Getting started"

if (Test-ListEmpty $L) {
    foreach ($q in (Read-Content "faq.json")) {
        Add-PnPListItem -List $L -Values @{ Title = $q.Title; Answer = $q.Answer; Topic = $q.Topic } | Out-Null
    }
    Write-Host "  added FAQ"
}
Set-HubView $L "By topic" @("LinkTitle", "Answer") `
    "<GroupBy Collapse=`"FALSE`"><FieldRef Name=`"Topic`" /></GroupBy><OrderBy><FieldRef Name=`"ID`" /></OrderBy>" -Default

# ---- Feedback -------------------------------------------------------------
Write-Step "Hub Feedback"
$L = "Lists/HubFeedback"
New-HubList "Hub Feedback" $L "Summary" "Ideas, problems and wins. People see only their own submissions; site owners see all."
Add-ChoiceField $L "FeedbackType" "Type" @("Idea for a prompt or tip", "Idea for an agent or workflow", "Something isn't working",
    "A win worth sharing", "Question", "Other") -Extra "Required=`"TRUE`""
Add-ChoiceField $L "About" "About" @("Copilot in general", "Daily Digest", "Email Filing Assistant", "Friday Tips",
    "Prompt Library", "This site", "Other") -Default "Copilot in general"
Add-NoteField   $L "Details" "Details" "Required=`"TRUE`""
Add-HubField    $L "FollowUp" "OK to contact me about this?" "Boolean" "" "<Default>1</Default>"
Add-ChoiceField $L "FeedbackStatus" "Status" @("New", "Reviewing", "Planned", "Done", "Won't do") -Default "New" -Extra $noNewForm
Add-NoteField   $L "Response" "Our response" $noNewForm
$firstRating = -not (Find-Object { Get-PnPField -List $L -Identity "Rating" })
Add-ChoiceField $L "Rating" "How is it working?" @("Working well", "Mixed", "Not working")
Add-HubField    $L "DoneOn" "Done on" "DateTime" "Format=`"DateOnly`" $noNewForm"
if ($firstRating) {
    # Once, when these columns arrive: bring over the feedback collected in Notion.
    foreach ($f in (Read-Content "agent-feedback.json")) {
        $v = @{ Title = $f.Title; FeedbackType = $f.FeedbackType; About = $f.About; Details = $f.Details; FeedbackStatus = $f.FeedbackStatus }
        if ($f.Rating) { $v.Rating = $f.Rating }
        if ($f.Response) { $v.Response = $f.Response }
        if ($f.DoneOn) { $v.DoneOn = [datetime] $f.DoneOn }
        Add-PnPListItem -List $L -Values $v | Out-Null
    }
    Write-Host "  added the feedback from Notion"
}

Set-PnPList -Identity $L -ReadSecurity AllUsersReadAccessOnItemsTheyCreate -WriteSecurity WriteOnlyMyItems | Out-Null
Set-HubView $L "All feedback" @("LinkTitle", "FeedbackType", "About", "Rating", "Details", "FeedbackStatus", "Author", "Created") `
    "<OrderBy><FieldRef Name=`"Created`" Ascending=`"FALSE`" /></OrderBy>" -Default
Set-HubView $L "My feedback" @("LinkTitle", "FeedbackType", "About", "FeedbackStatus", "Response", "Created") `
    "<Where><Eq><FieldRef Name=`"Author`" /><Value Type=`"Integer`"><UserID /></Value></Eq></Where><OrderBy><FieldRef Name=`"Created`" Ascending=`"FALSE`" /></OrderBy>"
Set-Formatter $L "FeedbackStatus" (New-Pill ([ordered]@{ "New" = "#efe7df"; "Reviewing" = "#d6e9f8"; "Planned" = "#e4dcf5"; "Done" = "#d7f0dd" }))

# ---- Client AI opt-outs ---------------------------------------------------
# Readable by everyone on the site; only owners and members can change it (it keeps the
# site's permissions, unlike Prompt Library and Hub Feedback).
Write-Step "Client AI Opt-Outs"
$L = "Lists/ClientAIOptOuts"
New-HubList "Client AI Opt-Outs" $L "Client" "Clients who have asked that AI not be used on their matters, or only with conditions. Check before using AI on a matter."
Add-HubField    $L "ClientNumber" "Client number" "Text"
Add-ChoiceField $L "OptOutScope" "Restriction" @("No AI on any matter", "No AI on client documents", "AI only with partner approval",
    "AI only with client consent", "Other (see notes)") -Extra "Required=`"TRUE`""
Add-HubField    $L "AppliesTo" "Applies to" "Text"
Add-HubField    $L "EffectiveDate" "Effective" "DateTime" "Format=`"DateOnly`""
Add-ChoiceField $L "OptOutSource" "Source" @("Engagement letter", "Outside counsel guidelines", "Client instruction", "Other") -Default "Client instruction"
Add-HubField    $L "ResponsiblePartner" "Responsible partner" "Text"
Add-NoteField   $L "OptOutNotes" "Notes"
Set-HubView $L "All clients" @("LinkTitle", "ClientNumber", "OptOutScope", "AppliesTo", "EffectiveDate", "ResponsiblePartner", "OptOutNotes") `
    "<OrderBy><FieldRef Name=`"Title`" /></OrderBy>" -RowLimit 500 -Default
Set-Formatter $L "OptOutScope" (New-Pill ([ordered]@{ "No AI on any matter" = "#f6d5d5"; "No AI on client documents" = "#f6d5d5";
    "AI only with partner approval" = "#efe7df"; "AI only with client consent" = "#efe7df" }))

# ---- AI News Log ------------------------------------------------------------
# Memory and audit trail for the weekly news flow (news-automation/): one row per Microsoft
# article it has checked, so it never posts the same article twice. Owners and members only.
Write-Step "AI News Log"
$L = "Lists/AINewsLog"
New-HubList "AI News Log" $L "Article" "Every Microsoft article the weekly news flow has checked, and what it decided."
Add-HubField    $L "ArticleUrl" "Article link" "Text" "MaxLength=`"255`" Required=`"TRUE`""
Add-HubField    $L "Score" "Score" "Number" "Decimals=`"0`""
Add-ChoiceField $L "Decision" "Decision" @("Draft", "Published", "Skipped", "Not relevant", "Error")
Add-NoteField   $L "Reason" "Why"
Add-HubField    $L "NewsPage" "News post" "Text" "MaxLength=`"255`""
Add-HubField    $L "ArticleDate" "Published by Microsoft" "DateTime" "Format=`"DateOnly`""
if (Test-ListEmpty $L) {
    # Already posted by hand (news.json: Copilot-for-Legal), so the flow mustn't post it again.
    Add-PnPListItem -List $L -Values @{
        Title = "Introducing Microsoft Copilot for legal"
        ArticleUrl = "https://techcommunity.microsoft.com/t5/microsoft-copilot-blog/introducing-microsoft-copilot-for-legal/ba-p/4564246"
        Decision = "Published"; Reason = "Posted by hand on the hub."
        NewsPage = "$siteUrl/SitePages/Copilot-for-Legal.aspx"; ArticleDate = [datetime] "2026-10-15" } | Out-Null
    Write-Host "  seeded with the Copilot for Legal post"
}
Set-HubView $L "All articles" @("LinkTitle", "Decision", "Score", "Reason", "ArticleDate", "NewsPage", "Created") `
    "<OrderBy><FieldRef Name=`"Created`" Ascending=`"FALSE`" /></OrderBy>" -RowLimit 200 -Default
Set-Formatter $L "Decision" (New-Pill ([ordered]@{ "Published" = "#d7f0dd"; "Draft" = "#d6e9f8"; "Error" = "#f6d5d5" }))

# ---- AI Roadmap and Waiting on Cassin (AI Working Group only) ---------------
# The working group's pipeline, moved from Notion: every agent, skill, flow and prompt in
# progress, and what Fortify needs from Cassin. Shown on the Program status page. The firm
# sees only what's published to Agents & Tools, the Prompt Library or the tips.
Write-Step "AI Roadmap"
$L = "Lists/AIRoadmap"
New-HubList "AI Roadmap" $L "Item" "Every agent, skill, flow and prompt in the AI program: stage, timing and what's next. AI Working Group only."
Add-ChoiceField $L "RoadmapStage" "Stage" @("Scoping", "Building", "Pilot", "Firm rollout", "Live") -Default "Scoping"
Add-ChoiceField $L "Track" "Track" @("Quick Wins", "Big Bets", "Fill-ins", "Not Now") -Default "Quick Wins"
Add-ChoiceField $L "ItemType" "Type" @("Agent", "Skill", "Flow", "Prompt", "Native (Copilot for Legal)") -Multi
Add-ChoiceField $L "HomeArea" "Home" @("Deal Assistant", "Inbox Assistant", "Agency Guide Q&A", "Copilot for Legal", "Prompt Pack", "Background") -Multi
Add-ChoiceField $L "Confidence" "Confidence" @("On track", "At risk", "Slipped")
Add-HubField    $L "TimeSaved" "Est. time saved" "Text"
Add-HubField    $L "TargetWindow" "Target window" "Text"
Add-HubField    $L "Champion" "Champion" "Text"
Add-NoteField   $L "NextUp" "Next up"
Add-NoteField   $L "RoadmapNotes" "Notes"
Add-HubField    $L "DemoVideo" "Demo video" "URL" "Format=`"Hyperlink`""
Add-HubField    $L "PublishedLink" "Published on hub" "URL" "Format=`"Hyperlink`""
Add-HubField    $L "FeedbackAs" "Name in the feedback form" "Text"
if (Test-ListEmpty $L) {
    foreach ($r in (Read-Content "roadmap.json")) {
        $v = @{ Title = $r.Title; RoadmapStage = $r.Stage; Track = $r.Track; TimeSaved = $r.TimeSaved; TargetWindow = $r.TargetWindow
                Champion = $r.Champion; NextUp = $r.NextUp; RoadmapNotes = $r.Notes; FeedbackAs = $r.FeedbackAs }
        if ($r.Type.Count) { $v.ItemType = [string[]] $r.Type }
        if ($r.Home.Count) { $v.HomeArea = [string[]] $r.Home }
        if ($r.Confidence) { $v.Confidence = $r.Confidence }
        if ($r.DemoVideo) { $v.DemoVideo = "$($r.DemoVideo), Demo video" }
        if ($r.PublishedOn) { $v.PublishedLink = "$siteUrl/$($r.PublishedOn), On the hub" }
        Add-PnPListItem -List $L -Values $v | Out-Null
    }
    Write-Host "  added the roadmap from Notion"
}
Set-HubView $L "All items" @("LinkTitle", "RoadmapStage", "ItemType", "HomeArea", "TargetWindow", "Confidence", "Champion", "NextUp") `
    "<GroupBy Collapse=`"FALSE`"><FieldRef Name=`"Track`" /></GroupBy><OrderBy><FieldRef Name=`"Title`" /></OrderBy>" -RowLimit 300 -Default
Set-HubView $L "By stage" @("LinkTitle", "Track", "ItemType", "TargetWindow", "Confidence", "Champion", "PublishedLink") `
    "<GroupBy Collapse=`"FALSE`"><FieldRef Name=`"RoadmapStage`" /></GroupBy><OrderBy><FieldRef Name=`"Title`" /></OrderBy>" -RowLimit 300
Set-Formatter $L "RoadmapStage" (New-Pill ([ordered]@{ "Live" = "#d7f0dd"; "Firm rollout" = "#bfe3cb"; "Pilot" = "#d6e9f8"; "Building" = "#e4dcf5" }))
Set-Formatter $L "Confidence" (New-Pill ([ordered]@{ "On track" = "#d7f0dd"; "At risk" = "#fbe7c6"; "Slipped" = "#f6d5d5" }))

Write-Step "Waiting on Cassin"
$L = "Lists/WaitingOnCassin"
New-HubList "Waiting on Cassin" $L "Item" "What Fortify needs from Cassin to keep the roadmap moving. AI Working Group only."
Add-HubField    $L "WaitingOwner" "Owner" "User" "UserSelectionMode=`"PeopleOnly`""
$roadmapList = Get-PnPList -Identity "Lists/AIRoadmap"
Add-HubField    $L "RoadmapItems" "Roadmap items" "LookupMulti" "Mult=`"TRUE`" List=`"{$($roadmapList.Id)}`" ShowField=`"Title`""
Add-HubField    $L "DueDate" "Due" "DateTime" "Format=`"DateOnly`""
Add-ChoiceField $L "WaitingStatus" "Status" @("Open", "In progress", "Done") -Default "Open"
Add-NoteField   $L "WaitingNotes" "Notes"
if (Test-ListEmpty $L) {
    $roadmapIds = @{}
    Get-PnPListItem -List "Lists/AIRoadmap" -PageSize 500 | ForEach-Object { $roadmapIds[[string] $_["Title"]] = $_.Id }
    foreach ($w in (Read-Content "waiting-on-cassin.json")) {
        $v = @{ Title = $w.Title; WaitingStatus = $w.Status; WaitingNotes = $w.Notes }
        $ids = @($w.Agents | Where-Object { $roadmapIds.ContainsKey($_) } | ForEach-Object { $roadmapIds[$_] })
        if ($ids.Count) { $v.RoadmapItems = [int[]] $ids }
        if ($w.Due) { $v.DueDate = [datetime] $w.Due }
        Add-PnPListItem -List $L -Values $v | Out-Null
    }
    Write-Host "  added the open items from Notion"
}
Set-HubView $L "Open items" @("LinkTitle", "WaitingOwner", "RoadmapItems", "DueDate", "WaitingStatus", "WaitingNotes") `
    "<Where><Neq><FieldRef Name=`"WaitingStatus`" /><Value Type=`"Choice`">Done</Value></Neq></Where><OrderBy><FieldRef Name=`"DueDate`" /></OrderBy>" -Default
Set-HubView $L "By owner" @("LinkTitle", "RoadmapItems", "DueDate", "WaitingStatus", "WaitingNotes") `
    "<GroupBy Collapse=`"FALSE`"><FieldRef Name=`"WaitingOwner`" /></GroupBy><OrderBy><FieldRef Name=`"DueDate`" /></OrderBy>"
Set-Formatter $L "WaitingStatus" (New-Pill ([ordered]@{ "Open" = "#efe7df"; "In progress" = "#d6e9f8"; "Done" = "#d7f0dd" }))

# ---- Copilot adoption history (admins only) ----------------------------------
# The adoption page reads Microsoft's Copilot usage reports live (web part, Microsoft Graph).
# This list keeps one snapshot a month (active days and prompts per person, no content) so the
# page can show habits over time. Only owners and AI Hub Admins can see it (section 4).
Write-Step "Copilot Adoption History"
$L = "Lists/CopilotAdoptionHistory"
New-HubList "Copilot Adoption History" $L "Month" "One snapshot a month of Copilot use per person, saved by the Copilot adoption page. Admins only."
Add-HubField  $L "RefreshDate" "Microsoft data up to" "Text" "MaxLength=`"10`""
Add-NoteField $L "Snapshot" "Snapshot (JSON)"
Set-HubView $L "All months" @("LinkTitle", "RefreshDate", "Modified") `
    "<OrderBy><FieldRef Name=`"Title`" Ascending=`"FALSE`" /></OrderBy>" -RowLimit 60 -Default

# ---------------------------------------------------------------------------
# 4. Permissions: Visitors read the site and can submit prompts and feedback
# ---------------------------------------------------------------------------
Write-Step "Permissions"
$visitors = Get-PnPGroup -AssociatedVisitorGroup
$owners   = Get-PnPGroup -AssociatedOwnerGroup
$members  = Get-PnPGroup -AssociatedMemberGroup
foreach ($list in "Lists/PromptLibrary", "Lists/HubFeedback") {
    Set-PnPList -Identity $list -BreakRoleInheritance -CopyRoleAssignments | Out-Null
    Set-PnPListPermission -Identity $list -Group $visitors.Title -AddRole "Contribute" | Out-Null
}
Write-Host "  '$($visitors.Title)' can add to Prompt Library and Hub Feedback"
Set-PnPList -Identity "Lists/AINewsLog" -BreakRoleInheritance -CopyRoleAssignments | Out-Null
Set-PnPListPermission -Identity "Lists/AINewsLog" -Group $visitors.Title -RemoveRole "Read" | Out-Null
Write-Host "  AI News Log: owners and members only"

# The working group's lists: owners and members (the AI Working Group) only. Start from no
# access rather than a copy of the site's, so visitors can't end up with it.
foreach ($L in "Lists/AIRoadmap", "Lists/WaitingOnCassin") {
    Set-PnPList -Identity $L -BreakRoleInheritance | Out-Null
    Set-PnPListPermission -Identity $L -Group $owners.Title -AddRole "Full Control" | Out-Null
    Set-PnPListPermission -Identity $L -Group $members.Title -AddRole "Contribute" | Out-Null
    foreach ($role in "Read", "Contribute", "Edit", "Full Control") {
        try { Set-PnPListPermission -Identity $L -Group $visitors.Title -RemoveRole $role | Out-Null } catch { }
    }
}
Write-Host "  AI Roadmap and Waiting on Cassin: owners and members (the AI Working Group) only"

# AI Hub Admins: who, besides the site owners, can open the Copilot adoption page.
$adminGroup = "AI Hub Admins"
if (-not (Find-Object { Get-PnPGroup -Identity $adminGroup })) {
    New-PnPGroup -Title $adminGroup -Description "Can open the Copilot adoption page on the AI Hub." | Out-Null
    Write-Host "  created the '$adminGroup' group"
}
foreach ($email in $AdoptionAdmins) {
    Add-PnPGroupMember -Group $adminGroup -LoginName "i:0#.f|membership|$email" | Out-Null
    Write-Host "  added $email to '$adminGroup'"
}
$L = "Lists/CopilotAdoptionHistory"
# Start from no access (not a copy of the site's), then grant only owners and AI Hub Admins,
# so it doesn't matter what level visitors or members have on the site.
Set-PnPList -Identity $L -BreakRoleInheritance | Out-Null
Set-PnPListPermission -Identity $L -Group $owners.Title -AddRole "Full Control" | Out-Null
Set-PnPListPermission -Identity $L -Group $adminGroup -AddRole "Contribute" | Out-Null
# On a re-run the list already has its own permissions: take visitors and members off it if
# someone added them by hand (it's fine if they were never there).
foreach ($g in $visitors.Title, $members.Title) {
    foreach ($role in "Read", "Contribute", "Edit", "Full Control") {
        try { Set-PnPListPermission -Identity $L -Group $g -RemoveRole $role | Out-Null } catch { }
    }
}
Write-Host "  Copilot Adoption History: owners and '$adminGroup' only"
if ($ShareWithEveryone) {
    $tenantId = Get-PnPTenantId
    Add-PnPGroupMember -Group $visitors.Title -LoginName "c:0-.f|rolemanager|spo-grid-all-users/$tenantId" | Out-Null
    Write-Host "  shared with Everyone except external users"
}

# ---------------------------------------------------------------------------
# 5. Pages and news
# ---------------------------------------------------------------------------
Write-Step "Pages"
$listUrls = @{ "Prompt Library" = "Lists/PromptLibrary"; "Friday Tips" = "Lists/FridayTips"; "Demo Videos" = "Lists/DemoVideos"
               "AI Agents" = "Lists/AIAgents"; "AI FAQ" = "Lists/AIFAQ"; "Hub Feedback" = "Lists/HubFeedback"
               "Client AI Opt-Outs" = "Lists/ClientAIOptOuts" }

# The Cassin AI Hub web part (webpart/, shipped as package/cassin-ai-hub-webpart.sppkg) draws
# each list section in the hub design. Without it in the app catalog, "Hub" parts fall back
# to SharePoint's standard list web part showing the same list.
$hubWebPartId = "49691dea-d53b-4628-9298-1e11ab7a38cd"
$script:hubComponent = $null
$script:hubChecked = $false

# Returns the web part's component object, or $null when it isn't installed. Pass this object
# to Add-PnPPageWebPart, not the id: PnP matches a bare id against component ids that
# SharePoint wraps in braces, finds nothing, and silently adds a web part with an empty id,
# which breaks the whole page ("Component id is not a valid Guid").
function Get-HubComponent([string] $Page) {
    if (-not $script:hubChecked) {
        $script:hubChecked = $true
        $script:hubComponent = Get-PnPPageComponent -Page $Page -ListAvailable |
            Where-Object { $_.Id.Trim("{}") -eq $hubWebPartId } | Select-Object -First 1
        if ($script:hubComponent) { Write-Host "  using the Cassin AI Hub web part" }
        else {
            Write-Host "  Cassin AI Hub web part not found in the app catalog, so the pages use standard list web parts." -ForegroundColor Yellow
            Write-Host "  Upload package/cassin-ai-hub-webpart.sppkg (README step 3). If you just did, wait 5 minutes and re-run with -RebuildPages." -ForegroundColor Yellow
        }
    }
    $script:hubComponent
}

function Add-ListPart([string] $Page, [int] $Section, [int] $Column, [int] $Order, $Part) {
    $url  = $listUrls[$Part.List]
    $list = Get-PnPList -Identity $url
    $view = Get-PnPView -List $url -Identity $Part.View
    Add-PnPPageWebPart -Page $Page -Section $Section -Column $Column -Order $Order -DefaultWebPartType List -WebPartProperties @{
        isDocumentLibrary = $false; selectedListId = $list.Id.ToString(); listTitle = $list.Title
        selectedListUrl = "$siteRel/$url"; webRelativeListUrl = "/$url"; selectedViewId = $view.Id.ToString()
        hideCommandBar = $false; webpartHeightKey = 4 } | Out-Null
}

function Add-HubPart([string] $Page, [int] $Section, [int] $Column, [int] $Order, $Part) {
    if ($Part.Type -eq "Hub" -and -not $Part.List -and -not (Get-HubComponent $Page)) {
        # A section with no list behind it (the adoption page) needs the web part itself.
        Add-PnPPageTextPart -Page $Page -Section $Section -Column $Column -Order $Order `
            -Text "<p>This page needs the Cassin AI Hub web part. Upload package/cassin-ai-hub-webpart.sppkg (README step 3), then run the deploy script again with -RebuildPage $Page.</p>" | Out-Null
        return
    }
    switch ($Part.Type) {
        "Text" {
            Add-PnPPageTextPart -Page $Page -Section $Section -Column $Column -Order $Order -Text (Expand-Tokens $Part.Html -Html) | Out-Null
        }
        "Hub" {
            $component = Get-HubComponent $Page
            if ($component) {
                $wp = Add-PnPPageWebPart -Page $Page -Section $Section -Column $Column -Order $Order -Component $component `
                    -WebPartProperties @{ section = [string] $Part.Section; maxItems = 6 }
                if (-not $wp.WebPartId) { throw "The Cassin AI Hub web part was added to $Page without its id. Stopping before the page is published." }
            } else {
                Add-ListPart $Page $Section $Column $Order $Part
            }
        }
        "List" { Add-ListPart $Page $Section $Column $Order $Part }
        "News" {
            Add-PnPPageWebPart -Page $Page -Section $Section -Column $Column -Order $Order -DefaultWebPartType News | Out-Null
        }
        "Button" {
            $url = [string] (Expand-Tokens $Part.Url)
            try {
                Add-PnPPageWebPart -Page $Page -Section $Section -Column $Column -Order $Order -DefaultWebPartType Button `
                    -WebPartProperties @{ label = $Part.Label; linkUrl = $url; alignment = "Left" } | Out-Null
            } catch {
                Add-PnPPageTextPart -Page $Page -Section $Section -Column $Column -Order $Order `
                    -Text "<p><a href=`"$url`"><strong>$($Part.Label) $([char]0x2192)</strong></a></p>" | Out-Null
            }
        }
    }
}

# A page someone has open in Edit mode is checked out or locked, and can't be deleted.
# Undo a checkout and retry; if it's still locked, skip that page rather than stop.
function Remove-HubPage([string] $Name) {
    try { Remove-PnPPage -Identity "$Name.aspx" -Force; return $true } catch { }
    try { Undo-PnPFileCheckedOut -Url "$siteRel/SitePages/$Name.aspx" } catch { }
    try { Remove-PnPPage -Identity "$Name.aspx" -Force; return $true } catch {
        Write-Host "  $Name`: skipped, the page is open for editing in a browser. Close that tab (Discard changes)," -ForegroundColor Yellow
        Write-Host "  wait about 10 minutes for the lock to clear, then run this again with -RebuildPages." -ForegroundColor Yellow
        return $false
    }
}

function Test-PageExists([string] $Name) {
    try { Get-PnPPage -Identity "$Name.aspx" | Out-Null; $true } catch { $false }
}

# Restricted pages ("Access" in pages.json): "admins" is site owners and AI Hub Admins (the
# adoption page); "workinggroup" is site owners and members (Program status). Applied on every
# run, so a page that was rebuilt or shared by mistake is locked down again.
function Set-PageAccess([string] $Name, [string] $Access) {
    $group = switch ($Access) { "admins" { $adminGroup } "workinggroup" { $members.Title } default { throw "Unknown Access '$Access' for $Name in pages.json." } }
    $query = "<View><Query><Where><Eq><FieldRef Name='FileLeafRef'/><Value Type='Text'>$Name.aspx</Value></Eq></Where></Query></View>"
    $item = Get-PnPListItem -List "SitePages" -Query $query | Select-Object -First 1
    if (-not $item) { throw "Couldn't find $Name.aspx in Site Pages to restrict it." }
    Set-PnPListItemPermission -List "SitePages" -Identity $item.Id -Group $owners.Title -AddRole "Full Control" -ClearExisting | Out-Null
    Set-PnPListItemPermission -List "SitePages" -Identity $item.Id -Group $group -AddRole "Read" | Out-Null
    Write-Host "    restricted to '$($owners.Title)' and '$group'"
}

# SharePoint won't delete the site's home page, so point home at the default page while
# the hub pages are rebuilt. The hub home page is set again below.
if ($RebuildPages -or $RebuildPage -contains "Hub-Home") { try { Set-PnPHomePage -RootFolderRelativeUrl "SitePages/Home.aspx" } catch { } }

foreach ($pg in (Read-Content "pages.json")) {
    if (Test-PageExists $pg.Name) {
        if (-not ($RebuildPages -or $RebuildPage -contains $pg.Name)) {
            Write-Host "  $($pg.Title): exists, skipped (use -RebuildPage $($pg.Name) to recreate)"
            if ($pg.Access) { Set-PageAccess $pg.Name $pg.Access }
            continue
        }
        if (-not (Remove-HubPage $pg.Name)) { continue }
    }
    $header = if ($pg.Layout -eq "Home") { @{} } else { @{ HeaderLayoutType = "ColorBlock" } }
    Add-PnPPage -Name $pg.Name -Title $pg.Title -LayoutType $pg.Layout -CommentsEnabled:$false @header | Out-Null
    # Lock a restricted page down before anything is published on it.
    if ($pg.Access) { Set-PageAccess $pg.Name $pg.Access }
    $s = 0
    foreach ($section in $pg.Sections) {
        $s++
        Add-PnPPageSection -Page $pg.Name -SectionTemplate $section.Template -Order $s -ZoneEmphasis $section.Emphasis | Out-Null
        $c = 0
        foreach ($column in $section.Columns) {
            $c++; $o = 0
            foreach ($part in $column) { $o++; Add-HubPart $pg.Name $s $c $o $part }
        }
    }
    Set-PnPPage -Identity $pg.Name -Publish | Out-Null
    if ($pg.IsHomePage) { Set-PnPHomePage -RootFolderRelativeUrl "SitePages/$($pg.Name).aspx" }
    Write-Host "  $($pg.Title)"
}

Write-Step "News posts"
foreach ($n in (Read-Content "news.json")) {
    # "Remove": true takes a post off the site (to the recycle bin, restorable for 93 days).
    if ($n.Remove) {
        if (Test-PageExists $n.Name) {
            Remove-PnPPage -Identity "$($n.Name).aspx" -Recycle -Force
            Write-Host "  $($n.Title): removed (it's in the site recycle bin)"
        }
        continue
    }
    if (Test-PageExists $n.Name) { Write-Host "  $($n.Title): exists, skipped"; continue }
    Add-PnPPage -Name $n.Name -Title $n.Title -LayoutType Article -PromoteAs NewsArticle -HeaderLayoutType ColorBlock | Out-Null
    Add-PnPPageSection -Page $n.Name -SectionTemplate OneColumn -Order 1 | Out-Null
    Add-PnPPageTextPart -Page $n.Name -Section 1 -Column 1 -Text (Expand-Tokens $n.Html -Html) | Out-Null
    Set-PnPPage -Identity $n.Name -Publish | Out-Null
    Write-Host "  $($n.Title)"
}

# ---------------------------------------------------------------------------
# 6. Navigation
# ---------------------------------------------------------------------------
Write-Step "Navigation"
# A communication site's menu bar shows either the top navigation or the quick launch,
# depending on the site's settings, so write the same menu to both.
function Add-Nav([string] $Location, [string] $Title, [string] $Path, $Parent = $null) {
    $external = $Path -match "^https?://"   # e.g. the policy in OneDrive: outside this site
    $url = if ($external) { $Path } else { "$siteRel/$Path" }
    $nav = @{ Location = $Location; Title = $Title; Url = $url; External = $external }
    if ($Parent) { $nav.Parent = $Parent }
    Add-PnPNavigationNode @nav
}
foreach ($loc in "TopNavigationBar", "QuickLaunch") {
    Get-PnPNavigationNode -Location $loc | ForEach-Object { Remove-PnPNavigationNode -Identity $_ -Force }
    Add-Nav $loc "Home" "SitePages/Hub-Home.aspx" | Out-Null
    $start = Add-Nav $loc "Get Started" "SitePages/Get-Started.aspx"
    Add-Nav $loc "Get started with Copilot" "SitePages/Get-Started.aspx" $start | Out-Null
    Add-Nav $loc "FAQ" "SitePages/FAQ.aspx" $start | Out-Null
    $policy = Add-Nav $loc "AI Policy" "SitePages/Use-AI-Responsibly.aspx"
    Add-Nav $loc $settings.policyTitle $settings.policyUrl $policy | Out-Null
    Add-Nav $loc "Client AI opt-outs" "SitePages/Client-AI-Opt-Outs.aspx" $policy | Out-Null
    Add-Nav $loc "Use AI responsibly" "SitePages/Use-AI-Responsibly.aspx" $policy | Out-Null
    Add-Nav $loc "Prompt Library" "SitePages/Prompt-Library.aspx" | Out-Null
    Add-Nav $loc "Friday Tips" "SitePages/Friday-Tips.aspx" | Out-Null
    Add-Nav $loc "Demo Videos" "SitePages/Demo-Videos.aspx" | Out-Null
    Add-Nav $loc "Agents & Tools" "SitePages/Agents-and-Tools.aspx" | Out-Null
    Add-Nav $loc "News" "_layouts/15/news.aspx" | Out-Null
    Add-Nav $loc "Feedback" "SitePages/Feedback.aspx" | Out-Null
    $titles = (Get-PnPNavigationNode -Location $loc | ForEach-Object Title) -join " | "
    Write-Host "  $loc`: $titles"
}

# A new site has no footer menu until someone edits the footer once in the browser, and
# PnP can't create it ("Unable to define Navigation Node collection"). The links are
# optional, so carry on and say how to add them.
try {
    Get-PnPNavigationNode -Location Footer | ForEach-Object { Remove-PnPNavigationNode -Identity $_ -Force }
    Add-PnPNavigationNode -Location Footer -Title "Copilot Chat" -Url "https://m365.cloud.microsoft/chat" | Out-Null
    Add-PnPNavigationNode -Location Footer -Title "Use AI responsibly" -Url "$siteRel/SitePages/Use-AI-Responsibly.aspx" | Out-Null
    Add-PnPNavigationNode -Location Footer -Title "Feedback" -Url "$siteRel/SitePages/Feedback.aspx" | Out-Null
} catch {
    Write-Host "  Footer links skipped: SharePoint hasn't created the footer menu yet. Add them in the browser" -ForegroundColor Yellow
    Write-Host "  (scroll to the footer, select Edit) or re-run this script after editing the footer once." -ForegroundColor Yellow
}

Write-Step "Done"
Write-Host "Open $siteUrl" -ForegroundColor Green
Write-Host "Program status (owners and members only): $siteUrl/SitePages/Program-Status.aspx"
Write-Host "Copilot adoption (owners and '$adminGroup' only): $siteUrl/SitePages/Copilot-Adoption.aspx"
if (-not $ShareWithEveryone) {
    Write-Host "The site is not shared with the firm yet. Add pilot users to '$($visitors.Title)', or re-run with -ShareWithEveryone at launch."
}
