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
function Expand-Tokens([string] $Text) { $Text.Replace("{{siteUrl}}", $siteUrl) }
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
$logo = Join-Path $root "assets/cassin-logo-white.png"
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

if (Test-ListEmpty $L) {
    foreach ($a in (Read-Content "agents.json")) {
        Add-PnPListItem -List $L -Values @{
            Title = $a.Title; AgentStatus = $a.AgentStatus; WhatItDoes = $a.WhatItDoes
            HowToStart = $a.HowToStart; Champion = $a.Champion } | Out-Null
    }
    Write-Host "  added agents"
}
Set-HubView $L "All agents" @("LinkTitle", "AgentStatus", "WhatItDoes", "HowToStart", "Champion") `
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

Set-PnPList -Identity $L -ReadSecurity AllUsersReadAccessOnItemsTheyCreate -WriteSecurity WriteOnlyMyItems | Out-Null
Set-HubView $L "All feedback" @("LinkTitle", "FeedbackType", "About", "Details", "FeedbackStatus", "Author", "Created") `
    "<OrderBy><FieldRef Name=`"Created`" Ascending=`"FALSE`" /></OrderBy>" -Default
Set-HubView $L "My feedback" @("LinkTitle", "FeedbackType", "About", "FeedbackStatus", "Response", "Created") `
    "<Where><Eq><FieldRef Name=`"Author`" /><Value Type=`"Integer`"><UserID /></Value></Eq></Where><OrderBy><FieldRef Name=`"Created`" Ascending=`"FALSE`" /></OrderBy>"
Set-Formatter $L "FeedbackStatus" (New-Pill ([ordered]@{ "New" = "#efe7df"; "Reviewing" = "#d6e9f8"; "Planned" = "#e4dcf5"; "Done" = "#d7f0dd" }))

# ---------------------------------------------------------------------------
# 4. Permissions: Visitors read the site and can submit prompts and feedback
# ---------------------------------------------------------------------------
Write-Step "Permissions"
$visitors = Get-PnPGroup -AssociatedVisitorGroup
foreach ($list in "Lists/PromptLibrary", "Lists/HubFeedback") {
    Set-PnPList -Identity $list -BreakRoleInheritance -CopyRoleAssignments | Out-Null
    Set-PnPListPermission -Identity $list -Group $visitors.Title -AddRole "Contribute" | Out-Null
}
Write-Host "  '$($visitors.Title)' can add to Prompt Library and Hub Feedback"
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
               "AI Agents" = "Lists/AIAgents"; "AI FAQ" = "Lists/AIFAQ"; "Hub Feedback" = "Lists/HubFeedback" }

# The Cassin AI Hub web part (webpart/, shipped as package/cassin-ai-hub-webpart.sppkg) draws
# each list section in the hub design. Without it in the app catalog, "Hub" parts fall back
# to SharePoint's standard list web part showing the same list.
$hubWebPartId = "49691dea-d53b-4628-9298-1e11ab7a38cd"
$script:hubWebPart = $null

function Test-HubWebPart([string] $Page) {
    if ($null -eq $script:hubWebPart) {
        $script:hubWebPart = [bool] (Get-PnPPageComponent -Page $Page -ListAvailable |
            Where-Object { $_.Id.Trim("{}") -eq $hubWebPartId })
        if ($script:hubWebPart) { Write-Host "  using the Cassin AI Hub web part" }
        else {
            Write-Host "  Cassin AI Hub web part not found in the app catalog, so the pages use standard list web parts." -ForegroundColor Yellow
            Write-Host "  Upload package/cassin-ai-hub-webpart.sppkg (README step 3). If you just did, wait 5 minutes and re-run with -RebuildPages." -ForegroundColor Yellow
        }
    }
    $script:hubWebPart
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
    switch ($Part.Type) {
        "Text" {
            Add-PnPPageTextPart -Page $Page -Section $Section -Column $Column -Order $Order -Text (Expand-Tokens $Part.Html) | Out-Null
        }
        "Hub" {
            if (Test-HubWebPart $Page) {
                Add-PnPPageWebPart -Page $Page -Section $Section -Column $Column -Order $Order -Component $hubWebPartId `
                    -WebPartProperties @{ section = [string] $Part.Section; maxItems = 6 } | Out-Null
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

# SharePoint won't delete the site's home page, so point home at the default page while
# the hub pages are rebuilt. The hub home page is set again below.
if ($RebuildPages) { try { Set-PnPHomePage -RootFolderRelativeUrl "SitePages/Home.aspx" } catch { } }

foreach ($pg in (Read-Content "pages.json")) {
    if (Test-PageExists $pg.Name) {
        if (-not $RebuildPages) { Write-Host "  $($pg.Title): exists, skipped (use -RebuildPages to recreate)"; continue }
        if (-not (Remove-HubPage $pg.Name)) { continue }
    }
    $header = if ($pg.Layout -eq "Home") { @{} } else { @{ HeaderLayoutType = "ColorBlock" } }
    Add-PnPPage -Name $pg.Name -Title $pg.Title -LayoutType $pg.Layout -CommentsEnabled:$false @header | Out-Null
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
    if (Test-PageExists $n.Name) { Write-Host "  $($n.Title): exists, skipped"; continue }
    Add-PnPPage -Name $n.Name -Title $n.Title -LayoutType Article -PromoteAs NewsArticle -HeaderLayoutType ColorBlock | Out-Null
    Add-PnPPageSection -Page $n.Name -SectionTemplate OneColumn -Order 1 | Out-Null
    Add-PnPPageTextPart -Page $n.Name -Section 1 -Column 1 -Text (Expand-Tokens $n.Html) | Out-Null
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
    $url = if ($Path -match "^https?://") { $Path } else { "$siteRel/$Path" }
    if ($Parent) { Add-PnPNavigationNode -Location $Location -Title $Title -Url $url -Parent $Parent }
    else         { Add-PnPNavigationNode -Location $Location -Title $Title -Url $url }
}
foreach ($loc in "TopNavigationBar", "QuickLaunch") {
    Get-PnPNavigationNode -Location $loc | ForEach-Object { Remove-PnPNavigationNode -Identity $_ -Force }
    Add-Nav $loc "Home" "SitePages/Hub-Home.aspx" | Out-Null
    $start = Add-Nav $loc "Get Started" "SitePages/Get-Started.aspx"
    Add-Nav $loc "Get started with Copilot" "SitePages/Get-Started.aspx" $start | Out-Null
    Add-Nav $loc "Use AI responsibly" "SitePages/Use-AI-Responsibly.aspx" $start | Out-Null
    Add-Nav $loc "FAQ" "SitePages/FAQ.aspx" $start | Out-Null
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
if (-not $ShareWithEveryone) {
    Write-Host "The site is not shared with the firm yet. Add pilot users to '$($visitors.Title)', or re-run with -ShareWithEveryone at launch."
}
