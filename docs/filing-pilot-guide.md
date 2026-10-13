# Filing Assistant: pilot guide (v1.0.2.2)

For Fortify. **Filing Assistant** is a small, separate Copilot Studio agent that suggests an Outlook folder for each email the user has already dealt with, and files them only after the user confirms. It implements the request in [handoff/email-filing-agent-brief.md](handoff/email-filing-agent-brief.md).

It's separate from Daily Digest on purpose. A first attempt added filing to the Daily Digest agent (1.1.0.0–1.1.0.8). With both sets of rules in one prompt, the model swung between inventing folders and suggesting nothing, and every filing change put the live digest at risk. Daily Digest is back to exactly 1.0.0.8, and filing now lives in `filing-agent/`.

## How it works
The model (GPT-5.5 Chat) does the finding and matching with four tools, following short, strict instructions. It can still occasionally miss an obvious match. Nothing moves without confirmation, so a miss costs the user one correction, not a misfiled email.

1. **Find emails to file.** These are Inbox emails the user replied to, replied all to, or forwarded (Outlook's `PidTagLastVerbExecuted` marker, `0x1081` = 102, 103 or 104), plus emails with a completed flag. Unread and still-flagged emails are left out. It shows 15 at a time, oldest first.
2. **Suggest a folder,** using two signals only:
   1. **Same thread:** another email from the conversation is already in one of the user's folders.
   2. **Folder name in the subject:** a folder's name appears in the subject as whole words, treating `_`, `-` and `.` as spaces ("Fortify_SOW_Cassin_9.17.26" → Cassin; "Twin Bridges" doesn't match Bridge). Folders named only with a number (such as 2026), Closed and Dead are skipped for this signal. If several match, the deepest folder wins.

   Everything else is **Not sure**. There's no guessing from the topic or the sender.
3. **Confirm by typing:** **file all**, **file all except 2**, **5 goes to Cassin**, **skip 3**, then **next** or **undo**.
4. **File** with Outlook's *Move email (V2)*, one email at a time, as the user. After each move the agent checks the email landed in the folder it asked for.

Every reply ends with *Filing Assistant v[version]*, so you can see which build answered.

### Tools (all Office 365 Outlook, end-user credentials, one connection)
| Tool | What it does |
|---|---|
| Get emails to file | Graph GET: one call per replied value (102, 103, 104) plus completed flags. Exchange only accepts one exact value per call for this marker, compared with `cast(ep/value, Edm.Int32)`. |
| Get my mail folders | Graph GET `/me/mailFolders/delta`: the whole folder tree as a flat list |
| Find where threads are filed | Graph GET: emails in the same conversations, in any folder |
| Move email to a folder | *Move email (V2)*. Move only, fixed to the user's own mailbox. |

The model is pinned to GPT-5.5 Chat (`GPT55Chat`).

### Why not code-based matching?
Versions 1.0.1.0–1.0.1.1 tried to do the matching as Power Fx in a topic. Topics can call the agent's tools, but Copilot Studio doesn't pass the Outlook HTTP action's response back to a topic: the action's output has no schema, so the tool step has no Outputs to map. The supported alternative is a Power Automate flow that returns text to the topic. Look into that after the pilot only if missed matches matter in practice, and first confirm the flow can run with each user's own Outlook connection (not the flow owner's) and what it costs.

### Not in this version
Click-to-confirm card, filing to two folders, matching on the email body, remembered settings, a "ready to file" line in the Daily Digest, and an Outlook button. Add them one at a time once the basics are reliable.

## Install and test (Fortify dev environment)
```bash
python3 build/build_solution.py --source filing-agent
# -> out/FortifyFilingAssistant_1_0_2_2.zip
```
1. **Import:** make.powerapps.com → dev environment → **Solutions → Import solution** → the zip. Pick your Office 365 Outlook connection.
2. **Clean up:** an unmanaged import never removes old components. When upgrading from 1.0.1.x, delete the **Find emails to file** topic and the **Read mail for filing** tool in Copilot Studio (and the **Test** topic and **Send an HTTP request** tool if they're still there). Delete the **Fortify Daily Digest (Pilot)** solution from dev if it's still there.
3. **Set up in Copilot Studio:** refresh the browser tab, open **Filing Assistant**, check there are exactly **4 tools** (Get emails to file, Get my mail folders, Find where threads are filed, Move email to a folder), each set to **End user credentials**, and click **Publish**. The model is already GPT-5.5 Chat.
4. **Test:** click **Start over** in the test pane, then say **Help me file**. Check that the reply ends with the version you just imported. If it doesn't, the test pane is still running an older build: refresh the tab and start over.

### What to check
| # | Do this | Expect |
|---|---|---|
| 1 | Help me file | A Found line, up to 15 emails, suggested ones first and Not sure underneath, numbered straight through (no restart at 1), and the version stamp |
| 2 | Look at each suggestion | Every folder exists, and every reason is either *same thread* or *subject has "[a real folder name]"* |
| 3 | Look at Not sure | Emails with no thread history and no folder name in the subject |
| 4 | file all except [a wrong one] | Only confirmed emails move. Check them in Outlook. |
| 5 | undo | That batch is back in the Inbox |
| 6 | next | The next 15, without the ones already shown (including skipped and Not sure) |

**Pass mark (from the brief):** at least 85% of suggestions right without correction, no email filed before it was dealt with, and no folders that don't exist.

## If something looks wrong
Open the run in the test pane's activity view. Check which tools were called, with which Uri, and what they returned. If a suggestion is wrong but the tool results are right, note the email and folder: those cases tell us whether the rules or the model need changing.

## Before the Cassin pilot
- Export a managed package (`pac solution export --name FortifyFilingAssistant --managed`) for Cassin's admin. It installs alongside Daily Digest and doesn't change it.
- Add a short user guide and the security note: it can move email in the user's own mailbox, only after confirmation, and can't delete anything.
