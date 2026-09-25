# Friday Copilot Tips: reviewer guide

About two minutes a week.

## Every Thursday around 10 AM ET
You get two things:
1. An email, **"[Preview] Friday Copilot Tip: …"**. This is exactly what staff will get. The yellow banner at the top is only in your copy.
2. An **approval request** in Teams (Approvals app, or the activity feed) and in Outlook.

Read the preview and click the links. Then:

| You want to… | Do this |
|---|---|
| Send it as is | **Approve**. It goes out Friday at 9:00 AM ET, and you get a "Sent" confirmation. |
| Fix something first | **Reject**. Open the tip in SharePoint (the link is in the approval), make the fix, then go to Power Automate → **Friday Copilot Tip** → **Run**. You'll get a fresh preview to approve. |
| Send a different tip this week | **Reject**. In the list, give the tip you want an earlier **Planned Friday** date (or set the current one to *Skipped*), then **Run**. |
| Skip this tip for good | Set its **Status** to **Skipped**. This works even after you've approved it, as long as it's before Friday 9 AM. |
| Skip this week entirely | **Reject** and do nothing else. The tip stays Queued for next Thursday. |

If you don't answer by Friday afternoon, nothing is sent and the tip waits until next week. You'll get an email saying so.

## Before approving, check that
- The steps match what you see in Copilot today. Microsoft moves buttons around, so try it once yourself.
- The links open the right Microsoft page or video.
- **Works with** is correct. Tips marked *Microsoft 365 Copilot license* only work for licensed users.
- It makes sense for someone who has never used Copilot.

## The tips list
**Friday Copilot Tips** in SharePoint. Each row is one email.

| Column | What it's for |
|---|---|
| Title | Headline in the email |
| Planned Friday | Order of sending. The earliest **Queued** tip goes next. |
| Subject | Email subject. Keep the `Friday Copilot Tip:` prefix so people recognize it. |
| Why it helps | One sentence on the benefit |
| Steps | **One step per line**, unnumbered (the email numbers them). Keep it to 2–4 steps. |
| Prompt to try | A prompt people can copy and paste. Keep it generic. |
| Microsoft article URL / title | A Microsoft Support or Learn page (required) |
| Video URL / title | Optional. An official Microsoft video (YouTube or Support). The email hides the button when blank. |
| Works with | *Copilot Chat (everyone)* or *Microsoft 365 Copilot license* |
| Status | **Queued** = waiting. **Sent** = done (set by the flow). **Skipped** = never send. |
| Notes | For you only. Never emailed. |

## Adding tips
The list starts with 20 tips, about five months' worth. When the preview says **"only N tips left"**, add more:
1. In the list, select **New** and fill in the columns. Status = Queued, and pick a Planned Friday after the last one.
2. Good sources: [What's new in Microsoft 365 Copilot](https://learn.microsoft.com/en-us/microsoft-365/copilot/release-notes), [Microsoft 365 Copilot help & learning](https://support.microsoft.com/en-us/microsoft-365-copilot/), [Copilot adoption hub](https://adoption.microsoft.com/en-us/copilot/), and the Microsoft 365 YouTube channel.
3. Rules of thumb: one idea per email, five minutes, plain words, a prompt they can paste, and a Microsoft link so people can learn more.

To keep the master library in this repo up to date (so future clients start with it), add the same rows to `copilot-tips/tips/tips.csv`. Then run:
```bash
python3 copilot-tips/build/build_tips_solution.py --previews --verify-links
```
This checks every link and renders each tip to `out/previews/` so you can see them all at once.

## Resending or reusing a tip
Set its Status back to **Queued** and give it a new Planned Friday.
