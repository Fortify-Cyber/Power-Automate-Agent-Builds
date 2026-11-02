# AI Hub weekly news

A Power Automate flow that, every Monday at 7:00 AM Eastern, reads the Microsoft Copilot
blog, picks the articles that matter to Cassin using keyword rules, and posts them to the
AI Hub's News.

- **Review mode** (how it starts): posts are saved as unpublished drafts, and the reviewer gets
  an email listing every article, what the flow decided and why, with links to the drafts.
- **Publish mode:** posts go live by themselves, and the email lists what was published.

Standard connectors only (RSS, SharePoint, Office 365 Outlook), so no premium licence or AI
credits. It was chosen over an AI version (`prompt.md`, kept for reference) for that reason.

## What a post looks like
- **Title:** Microsoft's article title.
- **Body:** one line, for example "Microsoft's announcement covers Word, Outlook, Teams.",
  then **Read Microsoft's announcement →**, then a short footer reminding people to check the
  source and follow the AI Acceptable Use Policy.

## How it decides (`rules.json`)
1. **Skip** if the title contains any `skipTitle` word, or the article contains a `skipBody`
   phrase. These cover Frontier-only and preview features, pricing and licensing, admin and
   security topics, other industries, developer tools, PowerPoint, Cowork, AI model
   announcements, and meeting recordings, transcripts and recaps.
2. **Score** the rest: each `strongWords` match (legal, contract, the monthly "What's New in
   Microsoft Copilot" roundup) scores 2. Each app in `apps` scores 1; these are matched
   case-sensitively, so "Word" means the app, not the word.
3. **Post** if the score reaches `minScore` (2).
4. Skip any article already in the **AI News Log** list, which is seeded with Copilot for Legal.

Over the last six weeks of articles, these rules make the same picks as the reviewed dry run
(`dry-run-2026-11-02.html`): the monthly roundups and Copilot for Legal, which is already
posted. **Remove "cowork" from `skipTitle` once the Legal plugin for Cowork is deployed at Cassin.**

## Set it up (about 15 minutes)
1. **Create the AI News Log list.** In PowerShell (`pwsh-preview`), from the `cassin-ai-hub`
   folder, run the deploy script as usual. Existing pages aren't touched:
   ```powershell
   ./Deploy-CassinAIHub.ps1 -TenantName cassinllp -ClientId <client-id>
   ```
2. **Import the solution.** Go to https://make.powerautomate.com and select Cassin's default
   environment, the same one as Daily Digest. Then **Solutions → Import solution**, choose
   `release/FortifyCassinAINews_1_0_0_0.zip`, then **Next**.
   - **Connections:** for each of RSS, SharePoint and Office 365 Outlook, pick an existing
     connection or select **+ New connection** and sign in. Use the account that should
     appear as the author of the news posts and the sender of the weekly email (for example
     aiadmin@cassinllp.com).
   - **Environment variables:** the defaults are filled in. Check the reviewer email.
   - Select **Import** and wait for the success message.
3. **Turn it on and test.** Open the solution, then the **Cassin AI Hub - Weekly news** flow,
   and select **Turn on**. Then select **Run → Run flow** to test it now rather than waiting
   for Monday.
   - The email arrives within a few minutes. This week it should list the October "What's
     New in Microsoft Copilot" roundup as a **Draft**.
   - Open the draft from the email, check it, then select **Post news** (or delete it).
   - The AI News Log list on the hub shows the result.
4. **Go fully automatic** when you're happy: in the solution, open **Environment
   variables → AI News Mode** and set its **current value** to `Publish`.

## Change the rules or settings
Everything is an environment variable in the solution (Solutions → Cassin AI Hub News →
Environment variables). Set a **current value**; the defaults stay as a fallback.

| Variable | What it does |
|---|---|
| AI News Mode | `Review` (drafts + email) or `Publish` (automatic) |
| AI News Reviewer Email | Who gets the weekly email |
| AI Hub Site URL | The hub site |
| AI News Feed URL | The Microsoft Copilot Blog RSS feed |
| AI News Rules | The keyword lists and minimum score (JSON, as in `rules.json`) |

To see why an article was or wasn't posted, check the **Why** column in the AI News Log list.

## Rebuild the solution
```bash
python3 news-automation/build_news_solution.py --check   # needs the Power Platform CLI (pac) for --check
```
Bump `SOLUTION["version"]` in the script for each release so importing it upgrades the
existing copy. Then copy `out/*.zip` to `release/`.
