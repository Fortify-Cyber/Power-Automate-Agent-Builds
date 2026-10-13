# Filing Assistant: pilot guide (v1.0.1.1)

For Fortify. **Filing Assistant** is a small, separate Copilot Studio agent that suggests an Outlook folder for each email the user has already dealt with, and files them only after the user confirms. It implements the request in [handoff/email-filing-agent-brief.md](handoff/email-filing-agent-brief.md).

It's separate from Daily Digest on purpose. A first attempt added filing to the Daily Digest agent (1.1.0.0–1.1.0.8). With both sets of rules in one prompt, the model swung between inventing folders and suggesting nothing, and every filing change put the live digest at risk. Daily Digest is back to exactly 1.0.0.8, and filing now lives in `filing-agent/`.

## How it works
Since 1.0.1.0 the finding and matching run as **code** in the *Find emails to file* topic (Power Fx), not as model instructions. The same mailbox always gives the same suggestions. The model only interprets the user's reply ("file all except 2", "5 goes to Cassin") and calls the move tool.

1. **Find emails to file.** These are Inbox emails the user replied to, replied all to, or forwarded (Outlook's `PidTagLastVerbExecuted` marker, `0x1081` = 102, 103 or 104), plus emails with a completed flag. Unread and still-flagged emails are left out. It shows 15 at a time, oldest first.
2. **Suggest a folder,** using two signals only:
   1. **Same thread:** another email from the conversation is already in one of the user's folders.
   2. **Folder name in the subject:** whole-word match after splitting on spaces, `_`, `-`, `.`, `,`, `:`, `/` and `&`. A one-word folder needs its word in the subject ("Fortify_SOW_Cassin_9.17.26" → Cassin). A longer name needs all its words, or at least two ("Oak Ave payoff letter" → Oak Ave Loan). Words under 3 letters and filler words such as "the" and "LLC" are ignored. The best match wins, then the deepest folder; a tie is Not sure. Folders named only with a number (such as 2026), and Closed or Dead folders and everything inside them, are skipped for this signal.

   Everything else is **Not sure**. There's no guessing from the topic or the sender.
3. **Confirm by typing:** **file all**, **file all except 2**, **5 goes to Cassin**, **skip 3**, then **next** or **undo**.
4. **File** with Outlook's *Move email (V2)*, one email at a time, as the user. After each move the agent checks the email landed in the folder it asked for.

Every reply ends with *Filing Assistant v[version]*, so you can see which build answered.

### Components
| Component | What it does |
|---|---|
| *Find emails to file* topic | Runs the searches, builds folder paths, applies both rules, numbers and shows the list, and returns `Batch` (`number \| message id \| folder id \| folder path`) to the agent |
| Read mail for filing (tool) | Graph GET, called only by the topic: the "replied" searches (one per value, compared with `cast(ep/value, Edm.Int32)`), completed flags, `/me/mailFolders/delta`, and thread lookups |
| Get my mail folders (tool) | Used by the agent when the user names a folder ("5 goes to Cassin") and for undo |
| Move email to a folder (tool) | *Move email (V2)*. Move only, fixed to the user's own mailbox. |

All of them use one Office 365 Outlook connection with end-user credentials. The model is pinned to GPT-5.5 Chat (`GPT55Chat`).

### Not in this version
Click-to-confirm card, filing to two folders, matching on the email body, remembered settings, a "ready to file" line in the Daily Digest, and an Outlook button. Add them one at a time once the basics are reliable.

## Install and test (Fortify dev environment)
```bash
python3 build/build_solution.py --source filing-agent
# -> out/FortifyFilingAssistant_1_0_1_1.zip
```
1. **Import:** make.powerapps.com → dev environment → **Solutions → Import solution** → the zip. Pick your Office 365 Outlook connection.
2. **Clean up:** delete the **Fortify Daily Digest (Pilot)** solution from dev if it's still there. When upgrading from Filing Assistant 1.0.0.x, delete the tools **Get emails to file**, **Find where threads are filed** and **Send an HTTP request**, and the **Test** topic, in Copilot Studio. An unmanaged import never removes old components.
3. **Set up in Copilot Studio:** refresh the browser tab, open **Filing Assistant**, check there are **3 tools** set to **End user credentials** and a **Find emails to file** topic, and click **Publish**. The model is already GPT-5.5 Chat.
4. **Test:** click **Start over** in the test pane, then say **Help me file**. Check that the reply ends with the version you just imported. If it doesn't, the test pane is still running an older build: refresh the tab and start over.

### What to check
| # | Do this | Expect |
|---|---|---|
| 1 | Help me file | A Found line, suggested emails first, Not sure underneath, and the version stamp |
| 2 | Look at each suggestion | Every folder exists, and every reason is either *same thread* or *subject has "[a real folder name]"* |
| 3 | Look at Not sure | Emails with no thread history and no folder name in the subject |
| 4 | file all except [a wrong one] | Only confirmed emails move. Check them in Outlook. |
| 5 | undo | That batch is back in the Inbox |
| 6 | next | The next 15 |

**Pass mark (from the brief):** at least 85% of suggestions right without correction, no email filed before it was dealt with, and no folders that don't exist.

## If the topic fails
Errors now come from Power Fx and name the step (for example `set_results`). In the test pane, open the topic's run to see each variable's value, and send Fortify the step id and error text. The topic's steps are in `filing-agent/topics/FindEmailsToFile.mcs.yml`, in order: email searches → `set_emails` → `set_candidates` → folders → `set_folder_paths` → threads → `set_results` → `set_final` → `set_message`.

## Before the Cassin pilot
- Export a managed package (`pac solution export --name FortifyFilingAssistant --managed`) for Cassin's admin. It installs alongside Daily Digest and doesn't change it.
- Add a short user guide and the security note: it can move email in the user's own mailbox, only after confirmation, and can't delete anything.
