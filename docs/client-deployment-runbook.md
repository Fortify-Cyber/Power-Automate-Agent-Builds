# Daily Digest: client deployment runbook (managed package)

For the client's Microsoft 365 / Power Platform administrator. About **15 minutes**, done in a browser on your normal work device.

**You need:**
- the file `FortifyDailyDigest_1_0_0_7_managed.zip`
- an account with **System Administrator** on the target Power Platform environment, plus **Global**, **AI** or **Teams Administrator** for step 5
- Microsoft 365 Copilot licenses for the people who will use it (users without one get "This agent is currently unavailable")

---

## 1. Check the data policy (2 min)
1. Go to **https://admin.powerplatform.microsoft.com** → **Security → Data and privacy → Data policy** (or **Policies → Data policies**).
2. For the policy that covers your target environment (usually the **default** environment), make sure these three connectors are in the **same** group, normally **Business**:
   - **Office 365 Outlook**
   - **Office 365 Users**
   - **Microsoft Copilot Studio**

## 2. Import the solution (5 min)
1. Go to **https://make.powerapps.com**. At the top right, select the environment to install into (your **default** environment is fine).
2. In the left menu, click **Solutions → Import solution**.
3. Click **Browse**, choose `FortifyDailyDigest_1_0_0_7_managed.zip`, then click **Next**.
4. If asked about **connections**, select or create connections for *Office 365 Outlook* and *Office 365 Users* with your own account. They're only used for testing; every employee's digest runs with **their own** sign-in.
5. Click **Import** and wait for the green *"Solution imported successfully"* banner (1–3 minutes). **Fortify Daily Digest** then appears in the list as *Managed*.

## 3. Publish and test (3 min)
1. Go to **https://copilotstudio.microsoft.com** and select the **same environment** (top right).
2. Open **Agents → Daily Digest** and click **Publish** (top right). Wait about 15 seconds.
3. In the **Test** pane, click **Email me my digest** and click **Allow** on the permission prompts.
4. Check that the digest appears in the chat and that an email titled **Daily Digest - [today's date]** arrives in your inbox (check Junk too).

## 4. Make it available in Microsoft 365 Copilot and Teams (2 min)
1. Still in Copilot Studio, open **Channels → Teams and Microsoft 365 Copilot**.
2. Tick **Make agent available in Microsoft 365 Copilot**, then click **Add channel**.
3. Click **Availability options → Show to everyone in my org → Submit for admin approval**.

## 5. Approve and deploy (3 min)
1. Go to **https://admin.microsoft.com → Copilot → Agents** (or **Settings → Integrated apps**), then the **Requests** tab.
2. Open **Daily Digest**, review it, and **Approve / Publish** it.
3. Deploy it to a **pilot group** first (recommended), or to everyone. Optionally pin it for users.
4. It can take up to 24 hours to appear for everyone.

## 6. Tell staff
Send the announcement and the user guide. Each person sets up their weekday digest once, in about 5 minutes.

---

## What it can and can't do (for your security review)
- **Reads each person's own mailbox only**, with their own sign-in. There's no app registration, no service account and no tenant-wide permissions.
- **Can't** delete, move or reply to email.
- **Its only send is the digest, to the signed-in user.** The recipient is fixed to the user's own address (`System.User.Email`), and CC, BCC, From and Reply-To are fixed to blank. Neither a prompt nor an email can redirect it.
- **Web search is off.** Mail content stays within Microsoft 365.
- **Managed package:** it can't be edited by accident and uninstalls cleanly (**Solutions → Fortify Daily Digest → Delete**). Updates from Fortify replace it in place.

## Troubleshooting
| Symptom | Fix |
|---|---|
| Import fails with a DLP / data policy error | Put the three connectors in step 1 in the same group |
| "This agent is currently unavailable. It has reached its usage limit." | That user has no Microsoft 365 Copilot license |
| First run says "Sorry, I wasn't able to respond to that" | The user scrolls up, clicks **Allow** on each permission card, and runs it again |
| No digest email | Check Junk. Make sure the request included "email it to me" (the **Email me my digest** button does this) |
| Agent not visible to users | Check the deployment in step 5. Allow up to 24 hours |
