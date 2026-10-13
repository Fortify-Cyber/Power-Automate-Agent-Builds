# Email Filing Assistant: project brief (handoff for a new thread)

_Last updated October 13, 2026, after the Cassin AI committee meeting._

## 1. Context
- **Client:** Cassin & Cassin LLP, a law firm focused on commercial lending. Microsoft 365 E5, and **all ~150 staff have Microsoft 365 Copilot licenses**.
- **Delivered by:** Fortify Cyber (Mike Galbo).
- **Already live:** the **Daily Digest** agent, a Copilot Studio agent that emails each user a morning summary of their Inbox (🔴 high priority, 📨 waiting on your reply, 👥 team items you're copied on, 📰 updates, with marketing filtered out).
  - Source code: repo `Fortify-Cyber/Power-Automate-Agent-Builds`, branch `claude/power-automate-llm-digest-ezkoha`.
  - Being rolled out firm-wide after the committee tests v1.0.0.8.
- **Broader push:** an AI adoption survey found people want **workflow-specific tools, not general training**, and that "accuracy" is the most cited barrier, mostly among infrequent users. The filing assistant is the next "real lift" workflow. Other candidates from the survey, for a separate prioritization exercise, include document redlining, extracting data into analysis forms and checklists, closing checklists, QC against source documents, precedent search and time entry.

## 2. The ask
Help users **file emails into their client and matter folders in Outlook**, without disrupting how they work.

## 3. What the team told us

### Written feedback
- **Cassia Schaeffer:**
  - Folder structure: Client → Transaction subfolders → Closed/Dead/Other. Some clients also have deal-type folders (conventional, bridge, payoff), plus Misc. folders (tech, PTO, networking, reference).
  - Reviews and files every email herself, and relies on flags (action items, diligence received, comments sent, follow-ups) and categories.
  - **Auto-filing would make her miss emails.**
  - Lenders email about several deals at once, deals get merged, and the same borrower's counsel works on several matters, so **sender ≠ folder**. Some emails belong in **more than one folder**.
  - Wants suggestions with an **"all correct except this one, which goes here"** control. Asked whether it can handle **100+ emails a day** without errors.
- **Second written response:**
  - Folder structure: Client / Matter → Year → Transaction type, plus Operational, Admin and Business Development folders.
  - **"A suggested folder is helpful, but definitely no filing before the email is addressed."**

### Meeting, October 13
- **Michael Hurley (partner):** moving an email into a folder means it has been dealt with. The tool should prompt with where the AI thinks the email should go and let the user **click yes or no**. "I don't think anyone wants" automatic moving. His folders: Client → Year → Lending product → Transaction. Some colleagues move closed deals to a "Closed" folder; some lawyers don't organize at all.
- **Elliot Tepfer:** Client → sub-matter per deal, plus a **"Current deals" folder** that's moved to **"Deals closed"** when done. The matter is identified by the **transaction or matter name, which appears in the subject line about 70–80% of the time.**
- **Eric Kaden (associate):** typing approvals is slower than dragging. Wants a **one-click button on the email itself, like the Reply button** ("File to: X").
- **Jordan Hersch:** "too many emails", so he uses one big inbox with no folders. **The feature must be optional.**
- **Mike (facilitator):** suggested a form-like way to "apply to all" or exclude specific emails, and wants a way to give feedback when a suggestion is wrong.

### Consensus
- **Suggest, never auto-move.** The user confirms every filing.
- Only suggest filing for emails the user has already dealt with.
- Every user's folder structure is different and deep (3–4 levels). No firm-wide template.
- Some emails need to go to **two folders** (merged deals, reference material).
- Must be **opt-in**, and must not touch flags or categories.
- Confirming must be **faster than dragging**, ideally one click.

## 4. Proposed design (from the scoping document)
- **Where suggestions appear:** a **"Ready to file"** list, either in the Daily Digest or on demand via a "Help me file" request. It shows emails the user has **dealt with** but are still in the Inbox. Proposed definition of "dealt with": the user replied, or flagged the email and marked the flag complete (for the team to confirm).
- **Where suggestions come from**, in order:
  1. Where earlier emails in the **same thread** were filed.
  2. **Matter or deal names in the subject.** Elliot estimates these are present 70–80% of the time.
  3. Loan numbers, borrower names and property addresses that match folder names.
  4. The user's past corrections.
- **Folders:** the assistant reads the user's own folder tree and lets them exclude some (for example Closed/Dead).
- **Low confidence:** shown as "Not sure", never guessed.
- **Confirming:** approve all, approve with exceptions, or approve per email. Filing to multiple folders is supported.
- **Filing:** done by a **Power Automate flow**, not the chat, so 100+ moves complete reliably. Suggestions are made in batches of 25–50.
- **Out of scope for the first version:** automatic filing or Outlook rules, creating, renaming or deleting folders, changing flags or categories, deleting email, and filing attachments to SharePoint or a DMS.
- **Phases:**
  1. Suggest-only pilot with 2–3 users who use different folder styles, nothing moved, measuring accuracy (2 weeks).
  2. Confirm-to-file (1–2 weeks).
  3. Opt-in rollout.
- **Proposed success measures:** at least 85% of suggestions accepted without correction, zero emails filed before they were dealt with, and users reporting time saved.

## 5. The open design question: how users confirm
Eric's "button on the email" point is the main decision for the new thread.

| Option | How it feels | Effort and notes |
|---|---|---|
| A. Type in Copilot chat ("file all except #2 → X") | Flexible, but typing is slower than dragging | Lowest effort. Fits the existing agent. |
| B. **Adaptive Card form in Copilot**: a checkbox per email, a folder dropdown pre-filled with the suggestion, and a "File selected" button | Click-based, supports "apply to all" and exceptions | Medium. Copilot Studio supports cards, but rendering in Microsoft 365 Copilot needs testing. |
| C. **Outlook add-in button on each email**: "File to: Loan ABC ✓" next to Reply | Most natural, one click, exactly what Eric described | Highest. Needs an Office add-in deployed via Integrated apps, a hosted service and an AI source for suggestions. |
| D. Buttons in the digest email (Outlook actionable messages) | One click from the morning email | Medium-high. Needs actionable-message registration and an HTTP endpoint. |

**Suggested path:** pilot with **B** (fastest route to click-to-confirm). Evaluate **C** if the pilot shows people want filing directly from the email.

## 6. Open questions for the team or client
1. Is the definition of "dealt with" (replied, or flag completed) right? Should "read and older than X days" also count?
2. For emails that belong in two places: **copy** to both folders, or file once plus a **category**?
3. Which folders should never be suggested? For example Closed/Dead, personal or Misc.
4. Should suggestions come with the morning digest, on demand, or both?
5. Who pilots? Suggested: Cassia (structured, flags-heavy), Elliot (Current deals → Deals closed), and an associate such as Eric (copied on a partner's email).
6. Is a follow-up tracker ("flagged items still waiting on a response") a higher priority than filing?

## 7. Technical notes carried over from the Daily Digest build

### Platform
- A Copilot Studio agent (GPT-5 Chat, pinned) packaged as a Dataverse solution and built from YAML source by `build/build_solution.py`.
- All connector tools run as **Invoker**, meaning each user's own credentials. There are no app registrations or service accounts.
- Copilot Studio usage is zero-rated for users with Microsoft 365 Copilot licenses.

### Mail access
- Mail is read with Outlook's **Send an HTTP request (Graph)**, pinned to GET with `$select`. That's how we get `webLink`, which `Get emails (V3)` doesn't return. Full message bodies overload the agent.
- The only send is "Email me my digest". Its recipient is locked to `=System.User.Email`, and CC, BCC, From and Reply-To are locked to blank.

### Gotchas we hit
- **Curly braces:** `{...}` in agent instructions is parsed as Power Fx and breaks publishing. Use `[...]` instead.
- **Tool calls before the reply:** a tool must be called before the agent writes its reply. "Do X after replying" never runs.
- **Tool input names:** inputs inside a request body use the connector's **flat names** (for example `To`, `Subject`), not `emailMessage.To`.
- **Timeouts:** keep tool calls per turn low (we use about 8). Large payloads or reasoning models stall in Microsoft 365 Copilot.
- **Moving mail changes message IDs:** this breaks links. Use `Prefer: IdType="ImmutableId"`.
- **Unmanaged imports never delete components.** The client gets a **managed** solution (`releases/`), so upgrades remove components cleanly.

### Environments
| Environment | URL / ID | Use |
|---|---|---|
| Fortify Automation DEV (sandbox) | org98af81a5.crm3.dynamics.com | Testing (currently behind) |
| Fortify Cyber (default) | org44f2ca29.crm.dynamics.com | Fortify's live copy, where we test changes |
| Cassin (default) | `Default-9776f7c3-2d24-4770-9d8f-882c4817ec83` | Client production |

### Cassin deployment
Cassin's **Conditional Access blocks device-code sign-in (error 53003)**, so Fortify can't sign in from outside. Cassin's admin imports the managed package on their own device using `docs/client-deployment-runbook.md`.

### Filing-specific technical risks to validate first
- Whether a Power Automate flow called by the agent can run with **each user's own** Outlook connection.
- Adaptive Card rendering in Microsoft 365 Copilot.
- Reading deep folder trees efficiently (`/me/mailFolders` with child folders).
- Graph's move and copy endpoints with immutable IDs.

## 8. Key documents
- `docs/filing-pilot-guide.md`: **the first build (v1.1.0.0)**: what's in it, how to install the pilot, technical checks and the test script.
- `docs/scoping/Daily Digest - Email Filing Assistant - Scoping Document.docx`: the scoping document reviewed with the team.
- `docs/architecture-and-costs.md`, `docs/admin-deployment-guide.md`, `docs/client-deployment-runbook.md`, `docs/user-guide.md`
- `agent/`: Daily Digest source (instructions, tools, topics).
