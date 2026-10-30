# Cassin AI Hub: SharePoint site

A SharePoint communication site for Cassin & Cassin's Microsoft 365 Copilot program. It holds the firm's prompt library, every Friday tip, demo videos, agents, news, guidance and a feedback form. It uses Cassin's brand: navy `#021D3C` and `#00426C`, warm sand panels, and the Cassin logo.

**See it first:** open [`preview/index.html`](preview/index.html) in a browser. It's a clickable mock built from the same content files the deploy script loads. Nothing in the preview is saved.

## What's on the site

| Page | What it is | Backed by |
|---|---|---|
| **Home** | Welcome band, links to every section, news, this week's tip, featured prompts | |
| **Get Started** | First five minutes, where Copilot lives, how to write a prompt. Menu also has *Use AI responsibly* and *FAQ* | page text |
| **Prompt Library** | 25 starter prompts written for commercial real estate lending work, grouped by category, with search and filters. Staff can **submit** prompts, which wait for approval | `Prompt Library` list (content approval on) |
| **Friday Tips** | Every tip sent so far (Oct 2–23), newest first, with steps, prompt and video | `Friday Tips` list |
| **Demo Videos** | Microsoft how-to videos plus anything recorded at Cassin | `Demo Videos` list + `Recordings` library |
| **Agents & Tools** | Daily Digest (live), Email Filing Assistant (pilot), the next two builds | `AI Agents` list |
| **News** | SharePoint news. Three starter posts | site news |
| **Use AI Responsibly** | Five habits: what Copilot can see, checking its work, attorney review | page text |
| **FAQ** | 10 common questions | `AI FAQ` list |
| **Feedback** | A form for ideas, problems and wins. People see only their own submissions; owners see all, and set Status and a response | `Hub Feedback` list |

All content lives in `content/*.json`. To change what the site says, edit those files rather than the script.

## Porting it to Cassin (about 20 minutes)

Cassin's Conditional Access blocks device-code sign-in (error 53003), so **a Cassin administrator runs this on their own work device**, the same way as the Daily Digest import.

**You need:**
- the **SharePoint Administrator** or **Global Administrator** role at Cassin
- **PowerShell 7.4 or later**: `winget install Microsoft.PowerShell` on Windows, `brew install --cask powershell` (or `powershell@preview`) on a Mac, then start it with `pwsh`
- the **PnP.PowerShell** module (3.x): `Install-Module PnP.PowerShell -Scope CurrentUser`
- this folder (`sharepoint/cassin-ai-hub`) copied to that device

### 1. Confirm the site address (1 min)
The script creates `https://<tenant>.sharepoint.com/sites/AIHub`. Check the tenant prefix by opening SharePoint at Cassin: it's the part before `.sharepoint.com` (for example `cassinllp`). To use a different URL or name, pass `-SiteAlias` and `-SiteTitle`.

### 2. Register a sign-in app for PnP PowerShell (5 min, once)
PnP no longer ships a shared app, so each tenant registers its own:
```powershell
Register-PnPEntraIDAppForInteractiveLogin -ApplicationName "PnP PowerShell (Cassin)" `
    -Tenant <tenant>.onmicrosoft.com -SharePointDelegatePermissions AllSites.FullControl
```
Sign in when the browser opens and **accept the consent prompt**. Copy the **Client ID** it prints. The app only has *delegated* permissions, so it can do no more than the signed-in admin.

### 3. Install the Cassin web part (5 min, once)
The pages use a custom web part that draws the prompts, tips, videos, agents, FAQ and feedback as Cassin-styled cards with Copy buttons and search. Without it, the script falls back to SharePoint's standard list tables.
1. Go to **SharePoint admin center → More features → Apps → Open**, then **Manage apps**. If asked, let it create the app catalog.
2. Select **Upload** and choose `package/cassin-ai-hub-webpart.sppkg`.
3. In the panel that opens, choose **Enable this app and add it to all sites**, then **Enable**.

It reads the hub's lists as the signed-in person, with no extra permissions and nothing sent outside Microsoft 365. Cassin's brand fonts are bundled inside it, so no outside requests are made.

To update it later, upload the new `.sppkg` the same way and choose **Replace**. Pages pick up the new version automatically.

### 4. Run the build (5–10 min)
From the `cassin-ai-hub` folder:
```powershell
./Deploy-CassinAIHub.ps1 -TenantName <tenant> -ClientId <client-id-from-step-2>
```
You'll sign in once for the admin center and once for the new site. The script:
1. adds a **Cassin** theme to the tenant's theme list and creates the site
2. applies the theme, a navy header with the Cassin logo, and a footer
3. creates the six lists and the Recordings library, then loads the starter content
4. sets permissions: site **Visitors** can read everything and can **add** to Prompt Library and Hub Feedback
5. builds the pages (with the Cassin web part) and news posts, sets the home page, and builds the menu

It's safe to run again. Lists and content aren't duplicated, and pages that already exist are skipped unless you add `-RebuildPages`, which **overwrites edits made in the browser**. If you installed the web part after a first run, re-run with `-RebuildPages` to switch the pages over.

If the footer menu doesn't exist yet, the script skips the footer links and says so. Add them in the browser (scroll to the footer, select **Edit**).

### 5. Check it (5 min)
Open the site and check:
- [ ] Home shows the news posts, this week's tip and the featured prompts.
- [ ] **Prompt Library**: the Submit a prompt button opens the form. Submit a test prompt, then approve it from the list's **Approve/reject items** view.
- [ ] **Feedback**: submit a test item and confirm it appears under *Your feedback*.
- [ ] The menu shows the eight items, with Get Started opening a three-item dropdown.

If a section says it couldn't load, or you see a plain list table instead of cards, check step 3 and re-run with `-RebuildPages`. To change what a Cassin web part shows, edit the page, select it, and pick a **Section** in its settings.

### 6. Optional polish (10 min, in the browser)
- **Brand fonts for the rest of the page.** The Cassin web part already uses Cassin's fonts. For page text and the header, add Roboto Serif and IBM Plex Sans (both free) in **SharePoint admin center → Brand center → Fonts** and apply them under **Settings → Change the look**.
- **Home page tiles.** For icon tiles instead of text links, replace the two link rows on Home with a **Quick links** web part (Tiles or Filmstrip layout).
- **News images.** Add a banner image to each news post. Posts without one get a generic thumbnail.
- **Anonymous feedback.** The feedback list records who submitted. If people want to stay anonymous, create a Microsoft Form with anonymous responses and add it to the Feedback page with the **Microsoft Forms** web part.

### 7. Launch
1. Add the AI Working Group as **site owners** (Settings → Site permissions). Owners approve prompts and answer feedback.
2. Pilot: add a few people to the **Visitors** group.
3. Firm-wide: run the script again with `-ShareWithEveryone`, or share the site with *Everyone except external users* as **Read**.
4. Optional: in the SharePoint admin center, make it a **home site** or add it to the **Viva Connections** app bar so it appears in Teams.

## Keeping it current

| Task | How |
|---|---|
| Add this week's Friday tip | Friday Tips → **+ New**. Fill in Tip #, Sent on, prompt and video. Home shows the newest tip automatically |
| Approve a submitted prompt | Prompt Library → view **Approve/reject items** → select → **Approve** |
| Feature a prompt on Home | Edit the prompt and tick **Featured** (Home shows up to six) |
| Answer feedback | Hub Feedback → set **Status** and **Our response**. The submitter sees both |
| Add a Cassin video | Upload it to **Recordings**, copy its link, then add a row in Demo Videos with *From = Cassin* |
| Update an agent's status or champion | AI Agents → edit the row |
| Post news | **+ New → News post** on the home page |

**Friday Tip automation.** The weekly tip flow currently runs from Fortify's tenant (`fortifycyber.sharepoint.com/sites/AI`), so it can't write to Cassin's site directly. Either add each tip to the hub by hand (about 2 minutes), or later move the flow into Cassin's tenant and have it add a row to **Friday Tips** when it sends.

## Rolling back
Delete the site in **SharePoint admin center → Active sites**. It stays restorable from *Deleted sites* for 93 days. To remove the theme as well: `Remove-PnPTenantTheme -Identity Cassin`. To remove the web part, delete *Cassin AI Hub web part* from the app catalog's **Manage apps**.

## Files
```
Deploy-CassinAIHub.ps1   builds or updates the site (PnP.PowerShell 3.x)
content/                 everything the site shows: prompts, tips, videos, agents, FAQ, news, page layouts
theme/cassin-theme.json  SharePoint theme palette from Cassin's brand colors
assets/                  Cassin logo (white, for the navy header)
preview/                 clickable preview: build_preview.py turns template.html + content into index.html
package/                 cassin-ai-hub-webpart.sppkg, the built web part to upload (step 3)
webpart/                 the web part's source (SharePoint Framework); see webpart/README.md to rebuild
```
After editing `content/`, run `python3 preview/build_preview.py` to refresh the preview, and re-run the deploy script to load new list content. The deploy script only seeds **empty** lists, so add rows to an existing list in SharePoint itself.
