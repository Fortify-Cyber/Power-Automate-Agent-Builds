# Filing as a skill: experiment plan (dev only)

**Question:** can filing work as a **skill** you call from an ordinary Microsoft 365 Copilot chat, with the behaviour written as editable rules, as well as the flow-based Filing Assistant? If so, Cassia could change behaviour by editing the rules instead of waiting for a new build.

Three things are compared:
1. **The skill** (`filing-skill/outlook-filing/SKILL.md`, zipped as `out/outlook-filing-skill_0_2.zip`): the Filing Rules, safety rules and the Outlook calls to make, as an Agent Skills `SKILL.md`, added to a new Copilot Studio agent of the **GitHub Copilot** type together with two Outlook tools. This is the main test.
2. **Filing Skill Test agent**: the same rules, read from a SharePoint document, plus four Outlook tools (read Inbox, list folders, find where a conversation is filed, move email). This shows what the rules can do when the model *does* have mail tools.
3. **Filing Assistant** (the current pilot): fixed code in a flow. The baseline.

## Part A0: the skill in Copilot Chat, deployed by the admin (the main path)
Build the plugin package (skills only):
```bash
python3 build/build_skill_plugin.py   # -> out/fortify-email-filing-plugin_0_3_0.zip
```
It contains `manifest.json` (Microsoft 365 app manifest v1.28, validated against Microsoft's schema), two icons and `skills/outlook-filing/SKILL.md`.

**Try it yourself first:** sideload it with the Microsoft 365 Agents Toolkit CLI (`npm install -g @microsoft/m365agentstoolkit-cli`, `atk auth login`, `atk install --file-path out/fortify-email-filing-plugin_0_3_0.zip --scope Personal`), or upload it in Copilot Chat's skills area if your tenant lets users upload skills.

**Push it to everyone:** Microsoft 365 admin center → **Agents → Tools → Upload** → choose the zip → deploy/install it for a group (the pilot group first), then **Everyone**. Admin-deployed plugins appear in both Copilot Chat and Copilot Cowork. (Microsoft's build guide also describes **Manage apps → Upload custom app**, which lists it under *Discover* for people to add themselves rather than installing it for them.)

**How people use it:** in the Copilot prompt box, Copilot uses the skill automatically when someone says "help me file", or they pick **outlook-filing** themselves from **Agents and Skills** (in Cowork, type **/** or use **+**). Skills in Copilot Chat are rolling out worldwide from October to mid-November 2026.

**What to check:** the same steps as Part A (can it list the Inbox, list folders, see where a conversation is filed, move an email?). In Copilot Chat the skill has only Copilot's built-in mail access, so it may suggest well but be unable to move email; the skill is told to say so rather than pretend.

## Part A: the skill (do this first)
Skills can only be added to Copilot Studio agents built on the **GitHub Copilot** agent type (preview). Agents shown as "Powered by: **Standard**" (all existing Fortify agents) don't have a Skills section. That agent type is **billed per use**: Microsoft says using, building and testing it "might consume Copilot Credits", so watch **Power Platform admin center → Licensing → Copilot Studio** during the test.

1. **Create the agent:** Copilot Studio → the arrow next to **New agent** → choose the **GitHub Copilot** agent type (preview) → name it *Filing Skill (GitHub Copilot)*. If that choice isn't offered, the preview isn't enabled in this environment; note that as a result.
2. **Add the skill:** **Build** tab → **Skills** → **Add skill** → **Upload a skill** → `out/outlook-filing-skill_0_2.zip` (or `filing-skill/outlook-filing/SKILL.md` on its own).
3. **Add the Outlook tools** the skill uses: **Office 365 Outlook → Send an HTTP request** and **Office 365 Outlook → Move email (V2)**, both using the end user's credentials. The skill tells the agent which Graph calls to make.
4. **Pick the model**, save, and test in the test pane: "Help me file". Every list should end with *Outlook filing skill v0.2 · Rules version 1*.
5. Record on the scorecard which steps it could do (list Inbox, list folders, find where a conversation is filed, move), then the same rows as the other columns (accuracy, invented folders, consistency over 3 chats, volume).
6. **Rule change:** edit `SKILL.md` (for example "at most 10 emails", rules version 2), then **Skills → the skill → … → Replace**, and check the next chat follows it. This should take effect immediately, unlike SharePoint knowledge.

**Who can see it:** a skill belongs to the agent you add it to. Nobody else sees it until you share or publish that agent, the same as any other agent. There's no organization-wide skill catalog in the product yet (Microsoft's roadmap lists one); for now you share a skill by downloading and re-uploading its file.

If the skill can suggest but not move, a workable combination is the skill for suggestions plus Filing Assistant (or the test agent's move tool) for filing, which Part B shows.

## Part B: the agent with tools and the baseline

**What's being compared**

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

| Measure | Skill (Copilot chat) | Filing Assistant | Test agent: GPT-5 Chat | Test agent: Claude Opus 4.8 |
|---|---|---|---|---|
| Could list Inbox / folders / thread location / move? | | yes / yes / yes / yes | | |
| Suggestions matching the answer key (of 20) | | | | |
| Wrong folder suggested | | | | |
| **Invented folders** (must be 0) | | | | |
| Emails missed or listed twice | | | | |
| Same list in all 3 runs? | | n/a (fixed code) | | |
| Followed the "never suggest" list? | | | | |
| Partial matches correct (count) | | n/a (not built) | | |
| Skipped the "Other" tab? | | n/a (not built) | | |
| Got through ~100 emails? | | | | |
| Seconds per reply (list / file) | | | | |
| Filing moved the right emails, all of each conversation? | | | | |
| Rule edit took effect after | | n/a (rebuild) | | |
| Showed the right Filing Rules version? | | n/a | | |

**Decision:** if the skill (or a test-agent column) passes every row (85%+, zero invented folders, consistent across runs, handles volume, files correctly), it's a candidate to replace or sit alongside Filing Assistant. If it fails on consistency or invented folders, keep the flow and move the editable parts into a settings list the flow reads instead (option 1).
