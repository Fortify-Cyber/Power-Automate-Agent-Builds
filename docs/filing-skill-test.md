# Filing Skill Test: experiment plan (dev only)

**Question:** can a current AI model, following an editable rules document, file email as well as the flow-based Filing Assistant? If so, Cassia could change behaviour by editing a document instead of waiting for a new build.

**What's being compared**

| | Filing Assistant (current pilot) | Filing Skill Test (experiment) |
|---|---|---|
| Who decides what to list and suggest | Fixed code in a Power Automate flow | The AI model, following **Filing Rules** |
| Where the rules live | `filing-agent/workflows/generate_find_and_file.py` (rebuild to change) | A Word document in SharePoint, added as **knowledge** (edit to change) |
| Tools | One flow | Four Outlook tools: Get Inbox emails, Get my mail folders, Find where threads are filed, Move email to a folder |
| Model | GPT-5 Chat (relays only) | Whatever you pick for each test run |

Filing Skill Test is a **separate solution** (`FortifyFilingSkillTest`) with its own Outlook connection reference. Installing it doesn't change Filing Assistant or Daily Digest. **Dev environment only**; don't install it at Cassin.

New in the Filing Rules (not in the flow yet): **partial folder-name matching** and **skipping the Focused Inbox's "Other" tab**. The rules also ask for one line per conversation, batches of 20 and the email preview, like Filing Assistant 1.1.0.9.

## Setup (about 15 minutes)
```bash
python3 build/build_solution.py --source filing-skill-test   # -> out/FortifyFilingSkillTest_0_1_0_0.zip
```
1. **Import** the zip into the **Fortify Automation DEV** environment (Solutions → Import solution). Pick your Office 365 Outlook connection when asked.
2. **Put the rules in SharePoint:** upload `filing-skill-test/Filing-Rules.docx` to a SharePoint document library you can edit (for the real thing, a library Cassia owns).
3. **Add it as knowledge:** Copilot Studio → **Filing Skill Test** → **Knowledge → Add knowledge → SharePoint** → paste the document's URL → **Add**. Wait until its status shows **Ready**. (For a quicker first run you can use **Upload file** instead, but then edits to the SharePoint copy won't be picked up.)
4. **Pick the model** for this run: **Settings → Generative AI → model**. Suggested runs, in order: **GPT-5 Chat**, then **Claude Opus 4.8** (fine in Fortify's own dev tenant; at Cassin, Anthropic models need their CISO's approval).
5. **Publish**, then test in the **test pane** or in Microsoft 365 Copilot (Channels → Teams and Microsoft 365 Copilot → See agent in Microsoft 365).

The first time, click **Allow** for the Outlook connection (once, then wait).

**Check it read the rules:** every list must end with *Filing Rules version 1*. If the version is missing or wrong, the agent didn't use the document, which is a result in itself. To tell a model problem from a knowledge-lookup problem, re-run with the Filing Rules text pasted at the end of the agent's instructions (Variant B).

## Test plan
Use the **same test mailbox** for both agents. Compare **suggestions** first (nothing moves), then test filing on a handful of emails at the end, because filing changes the Inbox for both.

1. **Answer key (once):** in Outlook, write down the correct folder (or "Not sure") for the newest 20 conversations in the Focused Inbox. This is what both agents are scored against.
2. **Filing Assistant:** say **Help me file**. Record each line's suggestion.
3. **Filing Skill Test:** say **Help me file** in **three new chats**. Record each run's suggestions.
4. **Volume:** say **next** repeatedly until about 100 emails have been listed, or it stops. Note where it stops or slows down.
5. **Filing:** in each agent, file 3 conversations (one by "file 1", one by "2 goes to [folder]", one by "archive 3"). Check in Outlook that every email of each conversation moved, and nothing else.
6. **Rule change:** edit one rule in the Word document (for example, change "at most 20 emails" to "at most 10" and the version to 2), save, then start a new chat after 15 minutes, 1 hour and the next day. Note when the agent first shows *version 2* and follows the new rule. (SharePoint knowledge is re-indexed on a schedule, so changes aren't instant.)
7. Repeat steps 3–6 for the next model.

## Scorecard
Pass marks come from the client brief: at least 85% of suggestions right, no invented folders, nothing filed before confirmation.

| Measure | Filing Assistant | Skill Test: GPT-5 Chat | Skill Test: Claude Opus 4.8 |
|---|---|---|---|
| Suggestions matching the answer key (of 20) | | | |
| Wrong folder suggested | | | |
| **Invented folders** (must be 0) | | | |
| Emails missed or listed twice | | | |
| Same list in all 3 runs? | n/a (fixed code) | | |
| Followed the "never suggest" list? | | | |
| Partial matches correct (count) | n/a (not built) | | |
| Skipped the "Other" tab? | n/a (not built) | | |
| Got through ~100 emails? | | | |
| Seconds per reply (list / file) | | | |
| Filing moved the right emails, all of each conversation? | | | |
| Rule edit took effect after | n/a (rebuild) | | |
| Showed the right Filing Rules version? | n/a | | |

**Decision:** if a Skill Test column passes every row (85%+, zero invented folders, consistent across runs, handles volume, files correctly), it's a candidate to replace or sit alongside Filing Assistant. If it fails on consistency or invented folders, keep the flow and move the editable parts into a settings list the flow reads instead (option 1).
