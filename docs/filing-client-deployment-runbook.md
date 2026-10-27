# Filing Assistant: client deployment runbook (managed package)

Two parts: **Fortify** exports a managed package from the dev environment (part A), then the **client's Microsoft 365 / Power Platform administrator** installs it (part B, about 20 minutes in a browser). Filing Assistant installs alongside Daily Digest and doesn't change it.

---

## Part A: Fortify exports the package
1. **Check the solution is complete.** In **https://make.powerapps.com**, select the **Fortify Automation DEV** environment → **Solutions → Fortify Filing Assistant**. It should contain:
   - the agent **Filing Assistant**
   - the cloud flow **Filing Assistant - Find and file emails**
   - one connection reference for **Office 365 Outlook**
   - the agent's tool for the flow (an agent component named after the flow)

   If the tool isn't listed, select the agent, then **Advanced → Add required objects**. Delete any old tools left from earlier versions (*Get emails to file*, *Get my mail folders*, *Find where threads are filed*, *Move email to a folder*) in Copilot Studio first.
2. **Publish the agent** in Copilot Studio, so the exported version matches what you tested.
3. **Export:** **Solutions → Fortify Filing Assistant → Export solution → Publish → Next → Managed → Export**, then **Download**. You get `FortifyFilingAssistant_<version>_managed.zip`. Send it to the client admin together with this runbook (part B).

---

## Part B: the client admin installs it

**You need:**
- the package `FortifyFilingAssistant_<version>_managed.zip`
- an account with **System Administrator** on the target environment (normally the **default** environment, the same one as Daily Digest)
- for step 6 (org-wide only): **Global**, **AI** or **Teams Administrator**
- Microsoft 365 Copilot licences for the pilot users

### 1. Pre-checks (3 min)
1. **Data policy:** **https://admin.powerplatform.microsoft.com → Security → Data and privacy → Data policy**. If a policy covers the environment, **Office 365 Outlook** and **Microsoft Copilot Studio** must be in the **same** group (normally **Business**). No policies means nothing to do.
2. **Encryption:** the environment must **not** use customer-managed encryption keys (**Environments → [environment] → Settings**, or ask whoever manages encryption). Flows can't use each person's own Outlook connection in a customer-managed-key environment.

### 2. Import (5 min)
1. **https://make.powerapps.com** → select the environment (top right) → **Solutions → Import solution**.
2. **Browse** to the package → **Next**.
3. When asked for a connection for **Office 365 Outlook**, select or create one with your own account. It's only used for the import and your own test; each user's filing runs with **their own** connection.
4. **Import**, and wait for the banner. A yellow banner saying the flow "may not have turned on" or that "the original workflow definition has been deactivated and replaced" is normal. Step 3 checks it.

### 3. Turn on the flow and choose who can run it (3 min)
1. **https://make.powerautomate.com** → same environment → **Solutions → Fortify Filing Assistant** → open **Filing Assistant - Find and file emails**.
2. If it shows **Off**, click **Turn on**. If that shows an error, send the text to Fortify.
3. **Run only users → Edit:**
   - Add the pilot users, or a security group for them.
   - Under **Connections used**, set **Office 365 Outlook** to **Provided by run-only user**.
   - **Save**.

   This means each person's run uses their own Outlook, and nobody's flow can read anyone else's mail.

### 4. Check the agent and test (5 min)
1. **https://copilotstudio.microsoft.com** → same environment → **Agents → Filing Assistant**.
2. **Tools:** the tool **Filing Assistant - Find and file emails** should list three inputs, **Mode**, **BatchKey** and **Selections**, each set to *Dynamically fill with AI*. If one is missing, add it with **+ Add input**. Under **Completion → Advanced**, both outputs, **message** and **batchkey**, should be available to the agent.
3. **Settings → Generative AI → model:** it's set to **GPT-5.5 Chat**. If that model isn't offered in your environment, pick the closest available **GPT-5 Chat** model (not a preview or experimental one).
4. **Test** pane: say **Help me file**. Approve the Outlook connection prompt. A numbered list should appear, ending with *Filing Assistant v…*.
5. **Publish** (top right).

### 5. Make it available to the pilot users (3 min)
1. In the agent: **Channels → Teams and Microsoft 365 Copilot** → tick **Make agent available in Microsoft 365 Copilot** → **Add channel** → **Publish** again.
2. **Pilot (no admin approval):**
   - Click **Share** at the top of the agent and add the pilot users or their group.
   - In the channel's **Availability options**, choose **Show to my teammates and shared users**.
   - Send the users the **Copy link** link. They open it and click **Add**.

### 6. Later: roll out to everyone
1. In **Availability options**, choose **Show to everyone in my org → Submit for admin approval**.
2. In **https://admin.microsoft.com → Copilot → Agents → Requests**, approve **Filing Assistant**.
3. Deploy it to a group or the whole organization. It can take up to 24 hours to appear.
4. Also add those people (or **Everyone**, or a group) to the flow's **Run only users** (step 3).

### First use, for each user
They open Filing Assistant in Copilot and say **Help me file**. The first time, they're asked to connect Outlook; they click **Allow**. Send them the short "how it works" summary.

**Recommended at Cassin: connect once from the phone.** In the pilot, clicking **Allow** on a computer (Teams or Copilot in the browser) sometimes did nothing, while the same step worked first time in the **Microsoft 365 Copilot app on a phone**. Sign-in logs showed no blocked sign-ins for the Power Platform services, so it isn't a Conditional Access block. Until it's resolved, ask each user to do their first **Help me file** and **Allow** in the Copilot app on their phone; the connection should then be reused on their computer (not yet confirmed; Teams still failed for one user afterwards, so prefer Microsoft 365 Copilot over the Teams chat).

---

## Upgrading to a new version
1. Fortify sends a new managed package (part A).
2. Import it the same way and keep the default **Upgrade** option. Expect the same yellow banner.
3. Check the flow is **On** (step 3.2). The Run only users setting is kept.
4. In Copilot Studio, **Publish** the agent. Users get the update automatically, though they may need a new chat.

## What it can and can't do (for your security review)
- **Each person's own mailbox only**, through their own Outlook connection. There's no app registration, service account or tenant-wide permission.
- **It only moves email from the Inbox to the user's own folders, and only after the user names what to file in the chat.** It can't delete, send, reply, flag or categorize. It never creates, renames or deletes folders.
- **It reads** subjects, senders, dates, folder names and Outlook's short **preview** of each email (the first ~255 characters Outlook already shows in the message list; the list displays up to 140 of them). It never reads full email bodies or attachments.
- **The suggestions, the list and the moves are done by the flow's fixed logic**, not by the AI. The AI only passes the user's choices to the flow. An email's content can't instruct it to do anything.
- **Web search is off.**
- **The managed package uninstalls cleanly:** **Solutions → Fortify Filing Assistant → Delete**.

## Licensing and cost
- **Agent use is included** for Microsoft 365 Copilot-licensed users running it as themselves.
- **The flow is a Power Automate cloud flow, not a Copilot Studio agent flow.** Microsoft's billing page says cloud flows "use Power Automate licensing, not Copilot Credits" and aren't subject to Copilot Studio billing or enforcement. The flow uses only the standard Office 365 Outlook connector, which Microsoft 365 E5 covers.
- **Copilot Studio may show a warning in Agent status:** "This agent uses premium features. You'll need an upgraded license to publish it." Daily Digest shows the same warning, and both agents publish and run normally, so it can be ignored. Don't click **Go premium**. If publishing is ever actually blocked, contact Fortify before buying anything.
- After the first few days, check **https://admin.powerplatform.microsoft.com → Licensing → Copilot Studio** for Copilot Credit use. Zero is expected.

## Troubleshooting
| Symptom | Fix |
|---|---|
| Import fails with a data policy error | Put the two connectors in step 1.1 in the same group |
| Flow won't turn on | Send Fortify the error text from **Turn on** |
| The agent just shows the list again instead of filing | The tool is missing the **BatchKey** or **Selections** input (step 4.2) |
| "This agent is currently unavailable" | That user has no Microsoft 365 Copilot licence (see Licensing and cost) |
| The agent shows an error from the flow | make.powerautomate.com → the flow → **Run history** → the failed run. Send Fortify the red step's name and its error |
| A user sees "That list has changed since I showed it" | The Inbox changed between the list and the reply. Say **Help me file** again |
| The user clicks **Allow** on "Connect to continue" and nothing happens, or it keeps coming back | 1. Check the user is in the flow's **Run only users** (step 3), with Office 365 Outlook set to **Provided by run-only user**. 2. Quickest workaround: the user creates the connection once in the **Microsoft 365 Copilot app on their phone** (this worked for a pilot user when desktop didn't), or at **make.powerautomate.com** → same environment → **Connections → + New connection → Office 365 Outlook**. Then they start a new chat. 3. If it fails on desktop but works on the phone, a **Conditional Access** policy is the likely cause: in **Entra admin center → Sign-in logs**, filter by the user and the time they clicked Allow, and look for failures for apps such as *Microsoft Flow Service*, *Azure API Connections*, *PowerApps Service* or *Power Platform API*. The failure names the policy and the requirement (for example MFA or a compliant device). 4. If the environment isn't the default one, the user also needs a security role in it (for example **Basic User**). The calendar and other actions listed on the card are just the standard Outlook connector's permission list; the agent only uses mail. |
| Agent not visible to a user | Check they were shared the agent (step 5) and are a run-only user (step 3) |
