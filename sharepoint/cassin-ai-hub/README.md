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
| **Agents & Tools** | **Use these now** (live agents, with how to start) and a short **Coming next** (in pilot or up next, with rough timing). Proposed agents aren't shown | `AI Agents` list |
| **News** | SharePoint news for the whole firm: new agents, firm AI announcements and major Microsoft updates relevant to legal work. Pilot and AI Working Group updates belong in the Working Group's own channel | site news (pages in Site Pages) |
| **AI Policy** menu | Link to the firm's **AI Acceptable Use Policy** (a Word document, address in `content/settings.json`), the client opt-out list, and *Use AI Responsibly* | |
| **Use AI Responsibly** | The policy link, six habits: what Copilot can see, checking its work, attorney review, client opt-outs | page text |
| **Client AI Opt-Outs** | Clients who have asked that AI not be used on their matters, or only with conditions. Everyone can read it; only owners and members can edit | `Client AI Opt-Outs` list |
| **FAQ** | 10 common questions | `AI FAQ` list |
| **Feedback** | A form for ideas, problems and wins. People see only their own submissions; owners see all, and set Status and a response | `Hub Feedback` list |
| **AI Program status** (working group only) | The full pipeline moved from Notion: every agent, skill, flow and prompt by stage and by track, what Fortify is waiting on from Cassin, and feedback to triage. Only site owners and members can open it. See step 9 | `AI Roadmap` and `Waiting on Cassin` lists, plus `Hub Feedback` |
| **Copilot adoption** (admins only) | Who is using Copilot, how often and in which apps: active people and prompts over time, habit stages, roles, each person's history and a suggested next step. Only site owners and **AI Hub Admins** can open it. See step 8 | Microsoft's Copilot usage reports and Entra ID (Microsoft Graph), plus the `Copilot Adoption History` list |

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

It's safe to run again. Lists and content aren't duplicated, and pages that already exist are skipped unless you add `-RebuildPages` (all pages) or `-RebuildPage <name>, <name>` (just those), which **overwrite edits made to those pages in the browser**. If you installed the web part after a first run, re-run with `-RebuildPages` to switch the pages over.

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

### 8. Turn on the Copilot adoption page (15 min, once)
The page reads Microsoft's own Copilot usage reports and Entra ID (names and job titles) through Microsoft Graph, in the admin's browser, as that admin. Nothing leaves Cassin's Microsoft 365, and it never reads what anyone asks Copilot. Once a month it saves a snapshot (active days and prompt count per person) to the admin-only **Copilot Adoption History** list, so the month-by-month views grow from launch. "Who moved" works from day one, from Microsoft's 180-day report.

1. **Update the web part.** In the app catalog (step 3), **Upload** `package/cassin-ai-hub-webpart.sppkg` (version 1.2 or later) and replace the old one. Select **Enable app**. It notes that the app requests API access; that's expected.
2. **Approve the API access.** **SharePoint admin center → Advanced → API access.** Approve both pending requests from *Cassin AI Hub web part*: **Microsoft Graph, Reports.Read.All** and **Microsoft Graph, User.Read.All**. Approval applies to SharePoint's shared app for custom web parts, so any web part in Cassin's app catalog could use these two permissions (only Fortify's is installed).
3. **Run the script** with the people who should see the page (besides site owners):
   ```powershell
   ./Deploy-CassinAIHub.ps1 -TenantName cassinllp -ClientId <client-id> -AdoptionAdmins person1@cassinllp.com, person2@cassinllp.com
   ```
   It creates the **AI Hub Admins** group, the **Copilot Adoption History** list (owners and AI Hub Admins only) and the **Copilot adoption** page (owners and AI Hub Admins only). Existing pages aren't touched.
4. **Give each admin the Reports Reader role.** Microsoft only shows Copilot usage reports to people with a reports role. **Entra admin center → Roles & admins → Reports Reader → Add assignments**, add each AI Hub Admin and any site owner who'll use the page. (Global Administrators and Global Readers already have access.) Reports Reader can also read the other Microsoft 365 usage reports in the admin center; it can't change anything.
5. **Show names in the reports.** By default Microsoft 365 hides names in usage reports. **Microsoft 365 admin center → Settings → Org settings → Services → Reports**, clear **Display concealed user, group, and site names in all reports**, then **Save**. This affects every Microsoft 365 usage report, for people who can already see them. While names are hidden, the page says so and doesn't save history.
6. **Open it:** `https://cassinllp.sharepoint.com/sites/AIHub/SitePages/Copilot-Adoption.aspx`, or from the **For the AI Working Group and admins** bar under this week's tip on Home.

**Finding the restricted pages.** They aren't in the site menu on purpose: SharePoint can only hide menu links from Microsoft 365 or security groups, not from the site's own Owners, Members and AI Hub Admins groups, so a menu link would show to everyone. Instead the web part shows a bar, only to people who can open them: on Home under this week's tip, and at the top of Program status and Copilot adoption to move between the two. (If the working group and admins are ever set up as Microsoft 365 or security groups in Entra ID, the links can move into an audience-targeted menu.)

Microsoft's data runs 2 to 3 days behind. **Check on first use:** Microsoft hasn't published the exact field names for active days and prompts per person in its updated report, so the page finds them by name. If the Habits tab says active days aren't included yet, the rest of the page still works; open the page with `?adoptionDebug=1` at the end of the address and send Fortify the field list it writes to the browser console (F12 → Console).

### 9. AI Program status for the working group (5 min, once)
The roadmap that lived in Notion ("Cassin & Cassin × Fortify — AI Program Status") is now on the hub, for the AI Working Group only. The firm keeps seeing only what's ready on Agents & Tools.

1. Upload the web part (version 1.2) to the app catalog as in step 8.1, and run the deploy script as usual. It creates the **AI Roadmap** and **Waiting on Cassin** lists, imports the 19 roadmap items, 11 open items and 3 feedback items from Notion (once), adds *How is it working?* and *Done on* to Hub Feedback and *Expected* to AI Agents, and builds the **AI Program status** page.
2. Make sure the working group is in the site's **Owners** or **Members** group: they're the only people who can open the page and the two lists (members can edit list items, not the page).
3. Open `https://cassinllp.sharepoint.com/sites/AIHub/SitePages/Program-Status.aspx`. Owners and members also see it in the **For the AI Working Group and admins** bar under this week's tip on Home.
4. On **AI Agents**, fill in **Expected** (for example "Late November") for anything in pilot or up next; it appears under *Coming next*.

How it fits together:
- **The roadmap is the workshop; the hub's lists are the shelf.** When an item reaches *Firm rollout*, publish it where staff will use it (Agents & Tools, the Prompt Library or a Friday tip), then paste that link into the item's **Published on hub** column. Program status flags anything at Firm rollout or Live without one.
- **Feedback** is the firm's one form (the Feedback page). Its *About* choice links feedback to a roadmap item; an item named differently in the form (Friday Copilot Tip is "Friday Tips") has that name in **Name in the feedback form**.
- **Owners** on Waiting on Cassin are real people, so they can be @mentioned and filtered; give each item an owner and a due date. Overdue items show in red.
- For a board inside the list itself: open AI Roadmap, then **All items → Board**, grouped by Stage or Track.

## Keeping it current

| Task | How |
|---|---|
| Add this week's Friday tip | Friday Tips → **+ New**. Fill in Tip #, Sent on, prompt and video. Home shows the newest tip automatically |
| Approve a submitted prompt | Prompt Library → view **Approve/reject items** → select → **Approve** |
| Feature a prompt on Home | Edit the prompt and tick **Featured** (Home shows up to six) |
| Answer feedback | Hub Feedback → set **Status** and **Our response**. The submitter sees both |
| Add a Cassin video | Upload it to **Recordings**, copy its link, then add a row in Demo Videos with *From = Cassin* |
| Update an agent's status or champion | AI Agents → edit the row |
| Post news | Home → News → **+ Add → News post**. For an outside article (for example a Microsoft announcement), **+ Add → News link** and paste the address: no writing needed |
| Edit or remove a news post | Open the post → **Edit** → **Republish**. To remove one: **Settings → Site contents → Site Pages**, select it, **Delete** (it stays in the recycle bin for 93 days) |
| Load or update the client opt-out list | Client AI Opt-Outs list → **Edit in grid view**, then paste rows from Excel (columns in this order: Client, Client number, Restriction, Applies to, Effective, Responsible partner, Notes). Restriction must match one of its choices. Then edit the page and remove the "being compiled" note |
| Update the roadmap | AI Roadmap list: edit the item's Stage, Target window, Confidence, Next up or Notes. **+ New** for a new idea. Program status updates as soon as you save |
| Log something Fortify needs from Cassin | Waiting on Cassin list → **+ New**, with an Owner and Due date. Set Status to Done when it arrives |
| Show an agent to the firm | Add or edit it in **AI Agents** (Status *Live*, *Pilot* or *Up next*, plus *Expected*), then paste the Agents & Tools link into the roadmap item's **Published on hub** |
| Add or remove an adoption admin | **Settings → Site permissions → Advanced permissions settings → AI Hub Admins**, then **New → Add users** (or remove). Give new admins the Reports Reader role too (step 8) |
| Move or replace the AI policy document | Change `policyUrl` in `content/settings.json`, then run the script with `-RebuildPage Hub-Home, Use-AI-Responsibly, Client-AI-Opt-Outs` (the menu updates on every run) |

**Friday Tip automation.** The weekly tip flow currently runs from Fortify's tenant (`fortifycyber.sharepoint.com/sites/AI`), so it can't write to Cassin's site directly. Either add each tip to the hub by hand (about 2 minutes), or later move the flow into Cassin's tenant and have it add a row to **Friday Tips** when it sends.

## Rolling back
Delete the site in **SharePoint admin center → Active sites**. It stays restorable from *Deleted sites* for 93 days. To remove the theme as well: `Remove-PnPTenantTheme -Identity Cassin`. To remove the web part, delete *Cassin AI Hub web part* from the app catalog's **Manage apps**, and remove its two Microsoft Graph permissions in **SharePoint admin center → Advanced → API access**.

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
