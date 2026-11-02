# AI News automation (design, in review)

A weekly Power Automate flow that reads Microsoft's Copilot announcements, decides which ones
matter to Cassin, and posts them to the AI Hub's News. It starts in **Review** mode (posts are
created as unpublished drafts and Mike gets an email) and switches to **Publish** mode
(posts go live on their own) once the output looks right.

- `prompt.md`: the selection and writing rules the flow's AI step follows.
- `dry-run-2026-11-02.html`: those rules applied to the last four weeks of real articles.

## How it works
1. **Weekly trigger**, Monday 7:00 AM Eastern.
2. **Read the feed:** the Microsoft Copilot Blog RSS feed
   (`https://techcommunity.microsoft.com/t5/s/gxcuf89792/rss/board?board.id=microsoft-copilot-blog`),
   which carries each article's full text. It keeps items published in the last 7 days.
3. **Skip anything already seen** by checking the article link in the **AI News Log** list on
   the hub. The log is seeded with Copilot for Legal, which is already posted by hand.
4. **AI step** (AI Builder "Run a prompt", using `prompt.md`): returns a score, a reason and,
   for scores 4 and 5, the post text as JSON.
5. **Log every article** with its score, reason and decision, so you can see why something
   was or wasn't posted.
6. **Create the news post** for each article marked to publish: headline, summary, bullets,
   "Try it" steps, then the Microsoft source link and the standard footer.
   - **Review mode:** saved as a draft and not visible to staff. One email to the reviewer
     lists the week's drafts with links to open, edit and publish them.
   - **Publish mode:** published straight to News. The email becomes a weekly
     "here's what was posted" note.

## Settings (environment variables in the solution)
| Setting | Starts as |
|---|---|
| Mode | `Review` |
| Reviewer email | mgalbo@fortifycyber.com |
| Hub site | https://cassinllp.sharepoint.com/sites/AIHub |
| Minimum score to post | 4 |

## What it needs at Cassin
- Connections for **RSS**, **SharePoint** and **Office 365 Outlook**. These are standard
  connectors.
- **The AI step (open question, November 2).** AI Builder's "Run a prompt" may make the flow
  premium, so the flow owner would need Power Automate Premium. Microsoft's own pages
  disagree on this. It also uses AI Builder or Copilot Credits, about 3 to 5 articles a week.
  AI prompts can't be packaged in a solution, so the prompt is created once by hand from
  `prompt.md`. See the options in the November 2 discussion: AI Builder at Cassin, a
  keyword-only flow, or a Fortify-curated feed.
- Imported by Cassin's admin as a managed solution, like Daily Digest, into the same
  environment.
