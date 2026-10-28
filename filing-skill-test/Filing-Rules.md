# Filing Rules

**Rules version:** 1 (October 28, 2026)
**Owner:** Cassia Schaeffer
**Used by:** Filing Skill Test (experiment)

The assistant follows these rules every time someone says "Help me file". To change how it behaves, edit this document and update the version line above. The assistant shows the version it used at the bottom of every list, so you can tell whether it picked up your change.

---

## 1. Which emails to list

- Only emails in the **Inbox** itself, not emails already in other folders.
- Only emails that have been **read**.
- **Skip** emails that are still **flagged** (flagged means "still working on it"). Emails whose flag is marked complete are fine.
- **Skip** emails in Outlook's **"Other"** tab. Only list emails in the **Focused** tab.
- Newest first.

## 2. How many to show at once

- Show at most **20 emails** per list.
- If there are more, say how many more there are, and that the user can say **next**.

## 3. Group conversations

- Show **one line per conversation**, not one line per email.
- If a conversation has more than one email in the list, show the number of emails, for example "3 emails".
- Filing a line files every email in that conversation that is in the list.

## 4. What to show for each line

- The **subject**, as plain text. Do not turn it into a link.
- The **sender** (for a conversation, up to three different senders).
- The **date** of the newest email, like "Oct 14".
- The **first sentence or so** of the newest email (about 25 words), in quotation marks, on its own line.
- The **suggested folder** as its full path, for example "Inbox › Cassin › Oak Ave Loan", and the **reason**, on its own line.

## 5. How to choose a folder

Check these in order and use the first one that applies.

1. **Same conversation already filed.** If another email from the same conversation is already in one of the user's folders, suggest that folder. Reason: *same thread*.
   - Ignore copies that are in the Inbox, Sent Items, Drafts, Deleted Items, Junk Email or Outbox.
   - If the conversation is in Archive and also in a real folder, choose the real folder.
   - If it's in several real folders, choose the one holding the most recent email.
2. **Folder name in the subject (whole words).** A folder's full name appears in the subject as whole words. Ignore capitals, and treat _ - . , : / & as spaces. If more than one folder matches, choose the most specific (deepest) one. Reason: *subject has "[folder name]"*.
3. **Partial folder name in the subject.** The subject contains the main part of a folder's name, for example "Oak Ave payoff letter" and a folder called "Oak Ave Loan". Ignore words like LLC, Inc, LP, NA, Loan, Deal, Matter, and numbers in brackets such as (1916) when comparing. Only use this when exactly one folder fits. Reason: *partial match: "[words that matched]"* so the user can check it.
4. Otherwise, the email is **Not sure**. Don't guess from the sender or the topic.

## 6. Folders never to suggest

- Inbox, Sent Items, Drafts, Deleted Items, Junk Email, Outbox, Conversation History, Notes, Calendar, Contacts, Tasks.
- **Archive**, except through rule 5.1 (same conversation).
- Any folder whose name, or any folder above it, contains the word **Closed** or **Dead** (for example "Closed/Dead" or "Deals Closed"), except through rule 5.1.
- Folders named only with a number, such as "2026".
- Generic folders: New, Old, Misc, Other, General, Pending, Reference, Admin, Documents, Personal, Tech, PTO, Networking, Current Deals.

## 7. How to lay out the list

1. A heading: "Ready to file: [number] emails in [number] conversations".
2. A section **Suggested** with the lines that have a folder, newest first.
3. A section **Not sure** with the rest, newest first.
4. Number every line once, straight through both sections (1, 2, 3 …). Write each number in bold at the start of the line.
5. End with: "Reply **file all** to file the suggested ones, or adjust: **file all except 2** · **5 goes to [folder name]** · **skip 3**. Nothing moves until you say so."

## 8. Confirming

- **file all** means every line in the Suggested section, never the Not sure ones.
- **file all except 2, 4** leaves those out.
- **5 goes to [folder name]** sends that line to the folder the user names. If no folder has that name, or more than one does, ask which one.
- **archive 5** means 5 goes to Archive.
- After filing, say how many emails moved and to which folders, then show the next list.
