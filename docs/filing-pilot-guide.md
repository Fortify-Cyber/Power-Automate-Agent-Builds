# Filing Assistant: pilot guide (v1.1.0.4)

For Fortify. **Filing Assistant** is a separate Copilot Studio agent that suggests an Outlook folder for each email the user has already dealt with, and files them only after the user confirms. It implements the request in [handoff/email-filing-agent-brief.md](handoff/email-filing-agent-brief.md). Daily Digest is unchanged (1.0.0.8).

## How it works (since 1.1.0.0)
All the mechanical work runs as **code in a Power Automate cloud flow**, *Filing Assistant - Find and file emails*. The same mailbox gives the same list every time. The agent (GPT-5.5 Chat) only turns the user's words into the flow's inputs and shows the flow's reply.

1. **Find emails to file:** every **read** Inbox email that isn't **still flagged** (flags mean "still working on it"). **Newest first**, 30 emails at a time, shown **one line per conversation** ("· 4 emails"). Filing a line files every email of that conversation in the list. Each list has up to three sections:
   - **✅ Replied, forwarded or completed** (judged on the conversation's newest email in the list, so a thread with an unanswered new message goes under Read): the user replied, replied all or forwarded (Outlook's `PidTagLastVerbExecuted` marker, `0x1081` = 102/103/104, one Graph query per value), marked the flag complete, or **sent something later in the same thread** (a message in Sent Items or from their own address, after this email arrived).
   - **📖 Read, no reply:** read, with none of the above. Any age. Kept separate so the user can file just the replied ones.
   - **❓ Not sure:** no suggested folder (from either group; read-only ones are tagged *read, no reply*).
   Up to 1,000 read emails are considered per run, counting back from the start of the current list. Older emails of a conversation that fall in a later list come up again there, suggested to the same folder (same thread).
2. **Suggest a folder**, in this order:
   1. **Same thread:** another email in the conversation is already in one of the user's folders. A specific folder beats Archive; Archive counts if that's where the thread is. Inbox, Sent Items, Drafts, Deleted Items, Junk Email and Outbox never count.
   2. **Folder name in the subject:** whole words, treating `_ - . , : / &` as spaces ("Fortify_SOW_Cassin_9.17.26" → Cassin; "Twin Bridges" isn't "Bridge"). The deepest matching folder wins; an exact tie is Not sure. Never suggests Archive, system folders, folders named only with a number (2026), or Closed/Dead folders and anything inside them.
   3. Otherwise **Not sure**.
3. **Confirm:** "file all" (both sections), "file replied only", "file all except 2", "5 goes to Cassin", "skip 3", in any combination. The agent passes them to the flow as `all`, `replied`, `read`, `1,3,4`, `5=Cassin`, and so on.
4. **File:** the flow moves each confirmed email (Outlook *Move email (V2)* with `Id::<folder id>`, falling back to Graph `POST /me/messages/{id}/move`), reports what moved and what didn't, and **shows the next (older) 30 in the same reply**. So 100 emails take about four replies ("file all" each time). Emails the user didn't file stay in the Inbox; **Help me file** later starts again from the newest, and they come back further down.

**Speed:** conversations are matched 10 at a time and filed 5 at a time (each conversation's emails one after another). Copilot Studio waits at most 100 seconds for the flow, so check run durations in the flow's Run history; if a file-and-next-list run takes more than about 60 seconds, lower `BATCH` in the generator.

**The agent never handles message or folder ids.** The flow returns a short **batchkey** (`Before|NextBefore|RepliedCount,ReadCount|Order|Filed`, where Order lists each line's email positions, e.g. `1.4,2,3.5`) that the agent passes back. In file mode the flow rebuilds the same batch from those times, checks it still matches (emails shown minus emails filed), and moves nothing if the list has changed. Filing part of a list and then the rest works, because the key records which numbers were filed.

**Each user's own mailbox:** the flow's Outlook connection is set to *Provided by run-only user* (`runtimeSource: invoker`). The flow runs with the signed-in user's own connection; nobody's flow can read anyone else's mail.

### Components
| Component | What it does |
|---|---|
| Flow *Filing Assistant - Find and file emails* | Everything above. Inputs: Mode (`suggest`/`file`), BatchKey, Selections (`none` when not used). Outputs: `message` (Markdown shown as-is), `batchkey`. Source: `filing-agent/workflows/generate_find_and_file.py` → `FindAndFileEmails.json`. |
| Agent *Filing Assistant* | Instructions only (`filing-agent/instructions.md`), model GPT-5.5 Chat. One tool: the flow, added in Copilot Studio (step 4 below). |

### Not in this version
Undo (users drag emails back in Outlook), filing to two folders, matching on the email body, partial folder-name matches ("Oak Ave payoff" → "Oak Ave Loan"), a "ready to file" line in the Daily Digest, and an Outlook button.

## Install and test (Fortify dev environment)
```bash
python3 filing-agent/workflows/generate_find_and_file.py   # only after editing the generator
python3 build/build_solution.py --source filing-agent       # -> out/FortifyFilingAssistant_1_1_0_4.zip
```
1. **Remove the old tools.** In Copilot Studio → Filing Assistant → **Tools**, delete *Get emails to file*, *Get my mail folders*, *Find where threads are filed* and *Move email to a folder*. An import never removes old components.
2. **Import** the zip in make.powerapps.com → dev environment → **Solutions → Import solution**. When asked for connections, pick your Office 365 Outlook connection.
3. **Check the flow.** In make.powerautomate.com → **Solutions → Fortify Filing Assistant**, open *Filing Assistant - Find and file emails*:
   - It should be **On**. If it's off, turn it on.
   - Under **Run only users**, the Office 365 Outlook connection should say **Provided by run-only user**. If it doesn't, set it.
4. **Add the flow as the agent's tool.** Copilot Studio → Filing Assistant → **Tools → Add a tool → Flow** → *Filing Assistant - Find and file emails*. Check the tool lists all three inputs (**Mode**, **BatchKey**, **Selections**), each **Dynamically fill with AI**. If BatchKey or Selections is missing, use **+ Add input** to add it; without them the agent can't file and just shows the list again. Under **Completion → Advanced**, make both outputs (**message**, **batchkey**) available to the agent. Then **Publish**.
5. **Test:** refresh the tab, click **Start over**, and say **Help me file**. The reply should end with **v1.1.0.4**.
6. **Use it in Microsoft 365 Copilot** (needed for test 6). Once per agent, in Copilot Studio: **Channels → Teams and Microsoft 365 Copilot**, tick **Make agent available in Microsoft 365 Copilot**, **Add channel**, then **Publish**. Then **Availability options**:
   - **See agent in Microsoft 365**: opens Copilot with an **Add** button, just for you. No admin approval needed.
   - **Show to my teammates and shared users**: share the agent with the second account first (**Share** at the top of the agent), then send them the link from **Copy link**.
   - **Show to everyone in my org**: needs admin approval in the Microsoft 365 admin center (**Copilot → Agents → Requests**). Use this for the Cassin rollout, not for testing.

   After any later import, **Publish** again so Copilot gets the new instructions. The test pane uses the draft; Copilot uses the last published version.

### What to check
| # | Do this | Expect |
|---|---|---|
| 1 | Help me file | A numbered list: Replied, then Read no reply, then Not sure. Identical if you ask again. No still-flagged emails. |
| 1a | Help me file, with a thread that has several emails in your Inbox | One line for the thread, "· N emails", newest emails at the top |
| 1c | file that thread's number | Every email of the thread moves; the reply says "(N emails)" |
| 1b | file replied only | Only the Replied section moves |
| 2 | file 1 (one email you're sure about) | "✅ Filed 1 email", and the email is in that folder in Outlook |
| 3 | 2 goes to [a folder name] | Moves it, or says clearly that the name matched no folder or more than one |
| 4 | file all | The suggested ones move, and the next (older) batch appears underneath in the same reply |
| 5 | next | Skips to the next (older) 30 without filing |
| 5a | In the flow's Run history, open the run from step 4 | Duration well under 100 seconds (ideally under 60) |
| 6 | Run 1–2 with a **second account** in Microsoft 365 Copilot | It asks that person to connect Outlook once, and shows *their* emails and folders |
| 7 | Next day: Power Platform admin center → **Licensing → Copilot Studio** | Note any Copilot Credit use. Zero means the flow costs nothing. |

**Pass mark (from the brief):** at least 85% of suggestions right without correction, no email filed before it was dealt with, and no folders that don't exist.

## If something fails
- **Import error:** send Fortify the error text. The flow is generated by `generate_find_and_file.py`, so fixes go there.
- **The agent shows an error from the flow:** open make.powerautomate.com → the flow → **Run history** → the failed run. The red step names what failed. Send its name and error.
- **Copilot Studio asks you for BatchKey or Selections:** turn off prompting for those inputs in the tool's settings (install step 4).

## Before the Cassin pilot
- Confirm cost (step 7) and that test 6 passed with a second account.
- Confirm Cassin's environment doesn't use customer-managed encryption keys (flows can't use each user's own connection there yet).
- Export a managed package and send it with [filing-client-deployment-runbook.md](filing-client-deployment-runbook.md), which covers both the export and the client admin's install. It installs alongside Daily Digest.
- Add a short user guide and the security note: it moves email only within the user's own mailbox, only after confirmation, and can't delete anything.
