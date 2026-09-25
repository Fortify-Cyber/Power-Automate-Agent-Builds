# Review of the existing digest flows

Reviewed on 2026-09-24 using the Power Platform CLI and the Dataverse Web API. The definitions are saved in [`legacy-flows/`](../legacy-flows); a personal email address has been redacted.

| Flow | Environment | Schedule | What it does |
|---|---|---|---|
| **Fortify End of Day Digest** | Fortify Automation DEV (sandbox) | Weekdays 5:00 PM ET | Emails that need a response, ranked by fixed rules |
| **Daily Outlook Task Digest** | Fortify Cyber (default) | Daily 7:00 AM ET | Open Microsoft To Do tasks as an HTML table |

Together these two flows make up the "open action items and emails that need review" digest. The new Copilot agent replaces both.

---

## Fortify End of Day Digest

**How it works:** it gets the last 150 Inbox and 150 Sent Items messages and keeps inbox mail from the last 12 hours whose conversation has no sent message. Each message is then ranked:
1. **Priority**: High importance, or the subject contains *urgent, asap, eod, today, deadline, signature, execute* or *wire*.
2. **Addressed to you**: the To line contains `mgalbo@fortifycyber.com`.
3. **For awareness**: everything else.

The flow builds HTML for each group and emails it.

### Findings

| # | Severity | Finding | Effect | How the agent handles it |
|---|---|---|---|---|
| 1 | 🔴 High | **Subjects and previews go into the HTML unescaped** (`concat('<a href=\"', Link, '\">', Subject, ...)`) | Anyone who emails the user can put HTML, including links or hidden content, into the digest. That makes the digest a phishing channel. | The agent writes the digest itself and treats email content as data. It also flags likely BEC and phishing. |
| 2 | 🔴 High | **Hardcoded to one person.** The recipient and the "addressed to you" rule both use `mgalbo@fortifycyber.com`. | Can't be rolled out to other employees without a copy per person. | The agent reads the signed-in user's own profile (`Get my profile`), so the same agent works for all 150 users. |
| 3 | 🟠 Medium | **Reply detection is wrong for active threads.** A conversation is dropped if *any* sent message exists in it. | A new question that arrives after your last reply is hidden. These are often the most important messages. | A message is excluded only if you replied *after* it arrived. |
| 4 | 🟠 Medium | **Weekend gap.** The window is always the last 12 hours. | Monday's digest misses everything from Friday 5 PM to Monday 5 AM. | Monday runs cover everything since Friday. |
| 5 | 🟠 Medium | **Keyword match splits on spaces only** (`split(subject, ' ')`) | "URGENT:", "ASAP!" and "(EOD)" never match, because the punctuation stays attached. | The agent matches whole words and ignores punctuation, and also uses judgment ("a client asking for a signed contract by tomorrow" counts even without a keyword). |
| 6 | 🟡 Low | **Fetches the latest 150 messages, then filters by time** | A busy inbox can push relevant mail past message 150. | Filters by received date on the server and follows paging. |
| 7 | 🟡 Low | No filter for automated or bulk senders | Newsletters and notifications fill "For awareness". | Automated and bulk mail is counted but not listed. |
| 8 | 🟡 Low | "Addressed to you" doesn't separate To from CC in practice, and there's no check for a question or request | Weak signal for "needs reply". | Requires the user to be on the To line *and* a question or request to be present. |
| 9 | 🟡 Low | No error handling (no Scope/try-catch, no run-after on failure) | If a connector call fails, no digest is sent and nobody is told. | The agent continues with the other sources and notes what was unavailable. |
| 10 | 🟠 Medium | **Subject links never worked.** `Get emails (V3)` doesn't return a `webLink` field, so `coalesce(webLink, '')` is always empty. | Clicking a subject in the digest opens nothing. | The agent reads mail through a read-only Graph GET that returns the real `webLink`. |
| 11 | 🟡 Low | Date header uses `utcNow()` without time-zone conversion | The date label can be wrong for runs near midnight UTC. | The agent works in the user's local date. |

## Daily Outlook Task Digest

**How it works:** it lists all To Do lists (excluding *Flagged emails*), lists up to 999 tasks in each, appends every task to an array one at a time, filters out completed tasks, and emails an HTML table.

### Findings

| # | Severity | Finding | Effect | How the agent handles it |
|---|---|---|---|---|
| 1 | 🔴 High | **Sends corporate task data to a personal Gmail address** (`To: <personal>;mgalbo@fortifycyber.com`) | Corporate data leaves the tenant. A client's DLP policy would block this, and it's a bad look in a security product. | The digest stays inside Microsoft 365 (Copilot chat plus Copilot's own notification). |
| 2 | 🟠 Medium | Hardcoded recipients | Single-user only. | Per-user by design. |
| 3 | 🟠 Medium | **No prioritization.** Tasks are listed in API order in a raw table, with no overdue or due-today grouping. | Important items get lost. | Groups tasks as Overdue, Due today, Due this week, and No due date but high importance. |
| 4 | 🟡 Low | Excludes the *Flagged emails* list | Emails the user flagged for follow-up never appear. | Includes them, labeled "Flagged email". |
| 5 | 🟡 Low | Nested Apply to each with Append to array | Slow, and uses many actions (API request limits) for users with many tasks. | Not applicable. |
| 6 | 🟡 Low | Downloads completed tasks, then filters them out | Wasted calls. | The agent keeps only open tasks. |
| 7 | 🟡 Low | Planner tasks aren't included (older Planner flows in the same environment are turned off) | Action items in Planner are missed. | Adds **Planner – List my tasks**. |
| 8 | 🟡 Low | Runs 7 days a week | Weekend emails nobody acts on. | Users choose their own schedule (e.g. weekdays 7:30 AM). |

## Summary

The rules in both flows are sound as a starting point. The Copilot agent keeps them (the same urgency keywords, the same three email groups, open-tasks-only) and fixes the gaps: per-user identity, correct reply detection, weekend coverage, prioritized tasks, and safe handling of untrusted email content.

**Recommended action on the existing flows:** turn off **Daily Outlook Task Digest** now because of the personal-address data leak (finding 1). Keep **Fortify End of Day Digest** as a fallback until the agent has been piloted, then turn it off as well.
