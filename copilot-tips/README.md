# Friday Copilot Tips

A short weekly email that goes to the whole organization every Friday morning. Each one has **one** Microsoft Copilot tip that takes about five minutes to try. It's written in plain English for everyone, from reception to the partners, and links to Microsoft's own articles and videos.

It's a Power Automate cloud flow, packaged as a solution. You set it up and test it in the **Fortify** environment, then import the same zip into **Cassin** and change the settings.

## How a week works

| When | What happens |
|---|---|
| **Thursday 10:00 AM ET** | The flow takes the next **Queued** tip from the SharePoint list. It emails the reviewer an exact preview and sends an **Approve / Reject** request in Teams and Outlook. |
| Thursday–Friday | The reviewer approves. Or they reject, fix the tip in SharePoint, and select **Run** on the flow to get a new preview. |
| **Friday 9:00 AM ET** | Once approved, the tip goes to the all-staff distribution list. The list row changes to **Sent**, and the reviewer gets a confirmation. |

Safety rails:
- **Nothing sends without approval.** If nobody decides by Friday afternoon, nothing goes out and the tip stays in the queue for next week.
- **Status is checked again at send time.** Setting a tip to *Skipped* after approving it still stops it.
- **Low-queue warning.** When fewer than 3 tips are left, the preview and the confirmation both say so.
- **Failure alerts.** If any step fails (for example, an expired connection), the reviewer gets an email with a link to the failed run.
- **No reply-all storms.** When sending from a shared mailbox, the list is Bcc'd.

When you're comfortable, set **Send without review = Yes**. The flow then runs on its own, and the reviewer still gets a heads-up copy on Thursday, with time to set a tip to *Skipped*.

## Why Power Automate and not Brevo
Both would work. For an internal email to your own staff, Power Automate is simpler and more reliable:

| | Power Automate + Outlook | Brevo |
|---|---|---|
| Delivery | Sent inside Microsoft 365 to your own distribution list, so it lands in the Inbox with no "External" tag | Comes from outside the tenant, so it needs SPF/DKIM/DMARC setup and allow-listing, or it can land in Junk and trip phishing warnings |
| Recipients | The existing distribution list keeps itself up to date | You'd have to export staff to Brevo and keep that list in sync |
| Review step | Built-in Approvals in Teams and Outlook | Manual (log in, check the campaign, schedule it) |
| Cost and licensing | Standard connectors, covered by Microsoft 365 | Separate account; the free tier caps sends per day |
| Data | Stays in your tenant | Staff addresses stored with a third party |

Brevo is the better fit for emailing *clients* (open and click tracking, unsubscribe handling). You don't need that here.

## What's in this folder
```
email-template.html        the email design (Outlook-safe HTML)
tips/tips.csv              the tip library: 20 tips from Microsoft Support / Learn, with official videos
solution.yml               solution, flow, connections and settings (environment variables)
build/build_tips_solution.py  builds the importable solution zip; also renders previews and checks links
scripts/New-TipsList.ps1   creates the SharePoint list and loads the tips
docs/setup-guide.md        step by step: Fortify test, then Cassin go-live
docs/reviewer-guide.md     for the reviewer: the weekly routine, editing and adding tips
```

## Quick start
```bash
pip install pyyaml
python3 copilot-tips/build/build_tips_solution.py --previews   # -> out/FridayCopilotTips_1_0_0_0.zip + out/previews/
```
Then follow [docs/setup-guide.md](docs/setup-guide.md).

## Changing things
- **Tip content:** edit the rows in the SharePoint list. Changes take effect the next time the flow runs; there's nothing to redeploy. To add tips to the library for future clients, add rows to `tips/tips.csv` and run the build with `--verify-links`.
- **Look of the email:** edit `email-template.html`, rebuild, and re-import the zip. Bump `version` in `solution.yml` first.
- **Per-organization settings** (recipients, reviewer, sender, name, sign-off, color, send time): these are environment variables. Change them in the solution; no rebuild needed.
