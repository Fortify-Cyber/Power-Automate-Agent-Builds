# Friday Copilot Tips: setup guide

Set it up once in **Fortify** and test it there. Then repeat steps 1–5 in **Cassin** with Cassin's settings. It takes about 45 minutes the first time and 20 minutes for Cassin.

## What you need

| | Detail |
|---|---|
| Power Platform environment | One with Dataverse, so you can import a solution. The environment you use for Daily Digest works. |
| Your role | *Environment Maker* or *System Administrator* in that environment, and edit rights on a SharePoint site |
| DLP | **SharePoint**, **Office 365 Outlook** and **Approvals** must be in the same data policy group (normally *Business*). All three are standard connectors, so no premium licenses are needed. |
| Mailbox | Optional: a shared mailbox to send from, such as `copilot-tips@…`. The flow owner needs **Send As** permission on it. Without one, the tip is sent from the flow owner's mailbox. |
| Recipients | The all-staff distribution list address |
| Tools | PowerShell 7 (for the list script). To build the zip yourself, you also need Python 3 with PyYAML. |

> **Who should own the flow?** The flow runs as whoever creates its connections. In Fortify that can be you. In Cassin, use a Cassin account that won't be disabled, such as a service account or a Cassin IT admin, so the tips don't stop if someone leaves.

## Fastest: one command
`deploy/Deploy-FridayTips.ps1` does steps 1–3 for you. It creates the list, loads the tips, imports the solution with every setting filled in, wires up the connections and turns the flow on.

1. Install the [Power Platform CLI](https://aka.ms/PowerPlatformCLI) (`dotnet tool install --global Microsoft.PowerApps.CLI.Tool`) and PowerShell 7.
2. Fill in `deploy/fortify.json` (or `deploy/cassin.json`): the environment URL, SharePoint site, recipients and reviewer.
3. Run it:
   ```powershell
   ./copilot-tips/deploy/Deploy-FridayTips.ps1 -Config ./copilot-tips/deploy/fortify.json
   ```
   Add `-UseDeviceCode` if you're in a remote shell. You then sign in with a code at microsoft.com/devicelogin.
4. **First time only:** pac can't create the three connections (SharePoint, Office 365 Outlook, Approvals), because each needs a browser sign-in. If one is missing, the script prints a direct link. Create the connection there (**+ New connection**, about a minute), then re-run the script with `-SkipList`.
5. Go to step 4 (Test) below.

Re-running is safe. The list script skips tips that are already there, and the import upgrades the solution in place and re-applies the settings from the config file. To change a setting later, edit the config file and re-run with `-SkipList`, or change it in the portal.

> **Find the environment URL:** Power Platform admin center → **Manage → Environments** → the environment → **Environment URL**. Or run `pac env list`.

The manual steps below do the same thing by hand.

---

## Step 1: Create the SharePoint list and load the tips
Pick a site the reviewer can edit, such as the IT or AI site.

```powershell
# Fortify
./copilot-tips/scripts/New-TipsList.ps1 -SiteUrl https://fortifycyber.sharepoint.com/sites/<site> -FirstFriday 2026-10-02

# Cassin (sign in with the Cassin account)
./copilot-tips/scripts/New-TipsList.ps1 -SiteUrl https://<cassin>.sharepoint.com/sites/<site> -FirstFriday 2026-10-16 -TenantId <cassin-tenant-id>
```
- The script signs in with Microsoft Graph PowerShell and asks for **Sites.Manage.All**. If your tenant blocks user consent, a Global Admin has to approve it once.
- It creates the **Friday Copilot Tips** list and adds the 20 tips as **Queued**, one Friday apart.
- At the end it prints the **site URL** and **list name**. Keep them for step 3.
- Optional: in the list, go to **All Items → Edit current view** and tick *Planned Friday*, *Subject*, *Status* and *Works with*, sorted by *Planned Friday*.

<details><summary>No PowerShell? Create the list by hand</summary>

Site contents → **New → List → Blank list** named `Friday Copilot Tips`. Then add these columns. **Type each column name exactly as shown when you create it**, because the flow uses these internal names. You can rename the display name afterwards.

| Column | Type |
|---|---|
| WeekDate | Date (no time) |
| Subject | Single line of text |
| WhyItMatters | Multiple lines of text (plain text) |
| TipSteps | Multiple lines of text (plain text). One step per line. |
| TryPrompt | Multiple lines of text (plain text) |
| LearnUrl, LearnLabel, VideoUrl, VideoLabel | Single line of text |
| WorksWith | Choice: `Copilot Chat (everyone)`, `Microsoft 365 Copilot license` |
| Status | Choice: `Queued`, `Sent`, `Skipped`. Default: `Queued` |
| SentOn | Date and time |
| Notes | Multiple lines of text (plain text) |

Then copy the rows in from `tips/tips.csv`. In that file, ` | ` separates the steps; put each step on its own line instead.
</details>

## Step 2: Import the solution
1. Get the zip: `out/FridayCopilotTips_1_0_0_0.zip`. To build it yourself, run `python3 copilot-tips/build/build_tips_solution.py`.
2. Go to [make.powerautomate.com](https://make.powerautomate.com), pick the environment (top right), then **Solutions → Import solution** and choose the zip.
3. **Connections:** for each of the three (*SharePoint*, *Office 365 Outlook*, *Approvals*), choose an existing connection or create one. Use the account that should own the flow.
4. **Environment variables:** fill them in (see the table below), then select **Import**.

## Step 3: Settings (environment variables)

| Setting | Fortify (test) | Cassin (live) |
|---|---|---|
| SharePoint site URL | from step 1 | from step 1 |
| List name | `Friday Copilot Tips` | `Friday Copilot Tips` |
| Recipients | **your own address** at first | the all-staff distribution list |
| Reviewer email | `mgalbo@fortifycyber.com` | the reviewer's **Cassin** account (see the note below) |
| Send from shared mailbox | `none`, or a Fortify shared mailbox | e.g. `copilot-tips@cassin…` |
| Organization name | `Fortify Cyber` | `Cassin & Cassin LLP` |
| Sign-off | e.g. `The Fortify AI Team` | e.g. `The Cassin AI Team` |
| Brand color | `#1b2a4a` | Cassin's color (hex) |
| Friday send time | `09:00` | `09:00` |
| Send without review | `No` | `No` |
| Test mode | `Yes` while testing | `No` |

To change a setting later: **Solutions → Friday Copilot Tips → Environment variables** → open it → **Current value**.

> **Reviewer in Cassin:** Approvals only work for users in the same tenant. Use a Cassin account for the reviewer. Guest accounts may get the email but can't always respond to the approval.

## Step 4: Test in Fortify (about 10 minutes)
With **Recipients = your address** and **Test mode = Yes**:

1. **Solutions → Friday Copilot Tips →** open the **Friday Copilot Tip** flow and select **Turn on**.
2. Select **Run**, then confirm.
3. Within a minute you should get:
   - an email **"[Preview] Friday Copilot Tip: …"** showing exactly what staff will see, under a yellow "Preview only" banner
   - an **approval** in Teams (Approvals app) and in Outlook
4. **Approve** it. The real email arrives within a minute, followed by a **"Sent: …"** confirmation. In the list, the tip is now **Sent** with a *Sent on* date.
5. Check the email in Outlook desktop, Outlook on the web and your phone. Click the links.
6. **Test a rejection:** select **Run** again (the next tip comes up), then **Reject** it. You should get a **"Not sent"** email, and the tip stays **Queued**.
7. Put the test tip back: set the first tip's **Status** back to **Queued** and clear *Sent on*.

**If something fails,** you'll get a "Problem with the Friday Copilot Tip flow" email with a link to the run. The usual causes:
- **Send from shared mailbox:** Send As permission is missing, or hasn't taken effect yet (it can take up to an hour).
- **Get queued tips:** the site URL or list name is wrong.
- **Mark tip as sent:** the connection account can't edit the list.
- **"Flow save failed … DynamicOperationRequestClientFailure … refresh token has expired due to inactivity"** when you turn the flow on: the flow is reusing an old connection whose sign-in expired. A connection that hasn't been used for 90 days can still show as *Connected* in `pac connection list`. Go to **Connections**, open that connection, select **Fix connection** (or **Edit**), sign in again, then turn the flow on.

## Step 5: Go live
1. Set **Test mode = No**.
2. Set **Recipients** to the distribution list.
3. Check the list's **Planned Friday** dates. Tips go out earliest first, starting with the next Queued tip.
4. Check the distribution list's **delivery management**. If only certain senders are allowed, add the shared mailbox (or the flow owner).
5. Optional: send a one-line heads-up to staff, e.g. *"Starting this Friday: a five-minute Copilot tip every week. Reply with questions or ideas."*

From now on, every Thursday at 10 AM ET the reviewer gets the preview and the approval. See [reviewer-guide.md](reviewer-guide.md).

## Moving from Fortify to Cassin
Repeat steps 1–5 in the Cassin tenant with the Cassin column of the table. It's the **same zip**. Only the list, the connections and the settings change. Don't change anything in the Fortify copy; keep it as your test bench.

## Going fully automatic later
Set **Send without review = Yes**. The flow then sends the next Queued tip every Friday on its own. The reviewer still gets a **[Heads-up]** preview on Thursday, and can stop that week's tip by setting it to **Skipped**. Keep the list stocked; the preview warns you when fewer than 3 tips are left.

## Updating the flow or template
1. Edit `email-template.html` or `build/build_tips_solution.py`.
2. Bump `version` in `solution.yml` (e.g. `1.0.1.0`), then rebuild with `python3 copilot-tips/build/build_tips_solution.py --check`.
3. Import the new zip over the old one (**Solutions → Import**). Your settings, connections and list are kept.

**Command-line alternative to the portal:**
```bash
pac auth create --environment https://<env>.crm.dynamics.com
pac solution create-settings --solution-zip out/FridayCopilotTips_1_0_0_0.zip --settings-file tips-settings.json
# fill in tips-settings.json (connection IDs come from `pac connection list`), then:
pac solution import --path out/FridayCopilotTips_1_0_0_0.zip --settings-file tips-settings.json
```

## Changing the schedule or time zone
Friday **send time** is a setting. The **Thursday 10 AM preview** and the **Eastern** time zone are set in the build (`solution.yml → flow.weeklyPreview`, and `TIME_ZONE` in the build script). Change them there and re-import, or edit the flow's trigger directly in the designer.
