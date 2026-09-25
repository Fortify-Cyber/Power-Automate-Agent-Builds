# Daily Digest: admin deployment guide

For the client's IT administrator. Plan on about 30 minutes for the deployment, then a one-week pilot.

## What you're deploying
**Daily Digest** is a Copilot Studio agent that appears in Microsoft 365 Copilot, Teams and Outlook. When an employee asks it to *"Run my daily digest"*, or schedules that prompt, it reviews **their own** inbox, Microsoft To Do and Planner tasks and returns a prioritized briefing.

- **No app registration, no service account, no mailbox-wide permissions.** Every tool runs with the signed-in user's own credentials (Copilot Studio "end-user credentials"), so a user can only ever see their own data.
- **Read-only.** The agent can't send, delete or move mail.
- **Web search is off.** Mailbox content is never sent to Bing.
- **No extra cost for Microsoft 365 Copilot-licensed users.** Microsoft zero-rates Copilot Studio agent usage by Copilot-licensed users running as themselves. See [architecture-and-costs.md](architecture-and-costs.md).

## Prerequisites

| Requirement | Detail |
|---|---|
| Licenses | Microsoft 365 Copilot for every user who will use the agent |
| Environment | A Power Platform environment with Dataverse. The tenant's **default environment** works. A dedicated production environment (e.g. "Copilot Agents") is better if you have the Dataverse capacity. |
| Roles | *System Administrator* in that environment (import and publish), and *Global Admin*, *AI Administrator* or *Teams Administrator* (approve and deploy the agent) |
| DLP | In the environment's data policy, **Office 365 Outlook, Office 365 Users, Microsoft To Do (Business), Planner** and **Microsoft Copilot Studio** must all be in the same group (normally *Business*) |
| Tooling | [Power Platform CLI](https://aka.ms/PowerPlatformCLI) and Python 3 with PyYAML (to build from source), or just the prebuilt solution zip |

## Step 1: Get the environment URL
Power Platform admin center → **Manage → Environments** → select the environment → copy the **Environment URL** (e.g. `https://contoso.crm.dynamics.com`).

## Step 2: Build the solution (skip if you received a zip)
```bash
pip install pyyaml
python3 build/build_solution.py --check
# -> out/FortifyDailyDigest_1_0_0_0.zip
```

## Step 3: Import and publish
**Windows (PowerShell):**
```powershell
./deploy/Deploy-DailyDigest.ps1 -EnvironmentUrl https://contoso.crm.dynamics.com -TenantId <client-tenant-id>
```
**macOS / Linux / CI:**
```bash
deploy/deploy.sh https://contoso.crm.dynamics.com <client-tenant-id>
```
Or import it by hand: make.powerapps.com → select the environment → **Solutions → Import solution** → choose the zip → **Import**. Then open the agent in Copilot Studio and select **Publish**.

## Step 4: Verify in Copilot Studio
1. Open [copilotstudio.microsoft.com](https://copilotstudio.microsoft.com), select the environment, then open **Daily Digest**.
2. **Tools**: confirm the six tools are listed (Get my profile, Get inbox emails, Get sent emails, List to-do lists, List tasks in a to-do list, List my Planner tasks) and that each one's authentication is **End user credentials**. If a tool shows a connection warning, open it and create or select a connection.
3. **Test** pane: type `Run my daily digest`, approve the connection prompts, and check that the digest renders.

## Step 5: Publish to Microsoft 365 Copilot and Teams
1. In the agent, go to **Channels → Teams and Microsoft 365 Copilot**.
2. Tick **Make agent available in Microsoft 365 Copilot**, then **Add channel**.
3. Select **Availability options → Show to everyone in my org** (or *Show to my teammates and shared users* for the pilot) → **Submit for admin approval**.

## Step 6: Approve and roll out to everyone
1. Microsoft 365 admin center → **Settings → Integrated apps** (or Copilot → Agents) → find **Daily Digest** → **Publish**.
2. **Deploy**: assign it to **Entire organization** or to a security group. For the pilot, assign a pilot group first.
3. Optional: pin it for users.
   - **Teams admin center → Teams apps → Setup policies**: add Daily Digest to pinned apps.
   - Microsoft 365 admin center → **Copilot → Agents**: pin it for users.
4. Send employees the [user guide](user-guide.md). Each person schedules their own digest once, in about 30 seconds.

> It can take up to 24 hours for a newly deployed agent to appear for every user.

## Pilot plan (recommended)
| Day | Action |
|---|---|
| 1 | Deploy to a pilot group of 5–10 people across different roles |
| 1–5 | Pilot users run the digest daily and send feedback (missed items, noise, formatting) |
| 5 | Adjust `agent/instructions.md`, rebuild, redeploy (see Updates) |
| 6 | Deploy to the entire organization |

## Updates
1. Edit the source (`agent/instructions.md`, `agent/tools/`, `agent/topics/`).
2. Increase `version` in `agent/solution.yml` (e.g. `1.0.1.0`).
3. Re-run the deploy script. The import upgrades the solution in place and republishes the agent.
4. Content changes reach users automatically. Changing the agent's name, icon or channel settings may require admin re-approval (step 6).

## Monitoring and governance
- **Usage**: Copilot Studio → the agent → **Analytics**.
- **Credit consumption**: Power Platform admin center → **Licensing → Copilot Studio**. This should stay at zero for Copilot-licensed users. If the tenant has no Copilot Credit pack or pay-as-you-go billing plan, nothing can be charged.
- **Audit**: Copilot and agent interactions are recorded in Microsoft Purview Audit.
- **Removal**: unassign the agent in Integrated apps (removes it for users immediately), then delete the *Fortify Daily Digest* solution from the environment.

## Troubleshooting
| Symptom | Fix |
|---|---|
| Import fails with a DLP error | Put the five connectors listed under Prerequisites in the same DLP group |
| The agent says it can't reach Outlook, To Do or Planner | The user needs to approve the connection prompt the first time. In Teams, open the agent chat and run it once interactively. |
| First run ends with "Sorry, I wasn't able to respond to that" under a permission card | Expected on first use. The user clicks **Allow** on every connection card (up to four), then runs the digest again. |
| Agent missing in Copilot for some users | Check the Integrated apps assignment. Allow up to 24 hours. |
| "Schedule" isn't offered in the agent chat | Scheduled prompts for custom agents are still rolling out. Users can schedule `@Daily Digest run my daily digest` from Copilot Chat instead, or run it on demand. See the user guide. |
