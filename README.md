# Fortify Daily Digest

An LLM-powered daily digest of each employee's **open action items and emails that need review**. It's delivered as a Copilot Studio agent and packaged as a Power Platform solution that can be deployed to every employee of a Microsoft 365 E5 + Copilot client.

It replaces two rule-based Power Automate flows (**Fortify End of Day Digest** and **Daily Outlook Task Digest**). They were reviewed with the Power Platform CLI; see [docs/flow-review.md](docs/flow-review.md).

## How it works
- Employees open **Daily Digest** in Microsoft 365 Copilot, Teams or Outlook and say *"Run my daily digest"*, or schedule that prompt for every weekday morning.
- The agent reads **their own** inbox, sent items, Microsoft To Do and Planner through connector tools that run with the user's own credentials. It returns a prioritized briefing: 🔴 needs attention now, 📨 waiting on your reply, ✅ tasks due, 👀 for awareness.
- The LLM keeps the old flows' rules (urgency keywords, three email groups, open tasks only), fixes their bugs (reply detection, weekend gap, punctuation), and adds judgment, next-step suggestions and phishing/BEC warnings.

Why this design, and what it costs ($0 extra for Copilot-licensed users): [docs/architecture-and-costs.md](docs/architecture-and-costs.md).

## Repository layout
```
agent/                      Copilot Studio agent source (edit these)
  instructions.md             the agent's system instructions: digest rules and output format
  agent.mcs.yml               agent definition (model, conversation starters, capabilities)
  settings.mcs.yml            bot settings (auth, orchestration)
  tools/*.mcs.yml             connector tools (Outlook, Office 365 Users, To Do, Planner), all end-user auth
  topics/*.mcs.yml            system topics (greeting, sign-in, errors, ...)
  connectionreferences.mcs.yml connection references packaged with the solution
  solution.yml                solution name, version, publisher
build/build_solution.py     builds agent/ into out/FortifyDailyDigest_<version>.zip
deploy/                     pac-based import + publish (PowerShell and bash)
scripts/Review-Flows.ps1    pac-based review of existing cloud flows
legacy-flows/               exported definitions of the two flows being replaced
docs/                       flow review, architecture/costs, admin guide, user guide
```

## Quick start
```bash
pip install pyyaml
python3 build/build_solution.py --check          # build + validate with `pac solution unpack`
deploy/deploy.sh https://<env>.crm.dynamics.com    # import + publish with pac
```
Then finish the rollout in Copilot Studio and the Microsoft 365 admin center: [docs/admin-deployment-guide.md](docs/admin-deployment-guide.md). Give employees [docs/user-guide.md](docs/user-guide.md).

## Changing the digest
Most changes are edits to [`agent/instructions.md`](agent/instructions.md): what counts as urgent, sections, tone, length. After editing, bump `version` in `agent/solution.yml`, rebuild, and redeploy.

## Reviewing flows with the Power Platform CLI
```powershell
pac auth create --environment https://<env>.crm.dynamics.com
pac power-automate list-cloud-flows
pac power-automate list-flow-actions --workflow-id <id>
pac power-automate list-flow-runs --workflow-id <id>
./scripts/Review-Flows.ps1 -EnvironmentUrl https://<env>.crm.dynamics.com -NameFilter Digest -OrgDomain contoso.com
```
