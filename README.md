# Fortify Daily Digest

An LLM-powered daily digest of each employee's **emails that need attention or a reply**. It's delivered as a Copilot Studio agent and packaged as a Power Platform solution that can be deployed to every employee of a Microsoft 365 E5 + Copilot client.

It replaces two rule-based Power Automate flows (**Fortify End of Day Digest** and **Daily Outlook Task Digest**). They were reviewed with the Power Platform CLI; see [docs/flow-review.md](docs/flow-review.md).

## How it works
- Employees open **Daily Digest** in Microsoft 365 Copilot, Teams or Outlook and say *"Run my daily digest"*, or schedule that prompt for every weekday morning.
- The agent reads **their own** inbox and sent items through connector tools that run with the user's own credentials. It returns a prioritized briefing (🔴 high priority, 📨 waiting on your reply, 📰 updates, with marketing and cold outreach filtered out) and can email it to the user's own inbox.
- The LLM keeps the old flows' rules (urgency keywords, three email groups), fixes their bugs (reply detection, weekend gap, punctuation), and adds judgment, next-step suggestions and phishing/BEC warnings.

**Filing Assistant** (pilot) is a second, separate agent in `filing-agent/`. It suggests an Outlook folder for each email a user has dealt with and files them only after the user confirms. See [docs/filing-pilot-guide.md](docs/filing-pilot-guide.md).

**Filing as a skill** (experiment, dev only): `filing-skill/outlook-filing/SKILL.md` is the filing rules as a Microsoft 365 Copilot / Agent Builder skill, and `filing-skill-test/` is a comparison agent that follows the same rules (from a SharePoint document) with Outlook tools. See [docs/filing-skill-test.md](docs/filing-skill-test.md).

**Daily Digest as an organization prompt** (trial): `prompts/daily-digest.md` is a plain Copilot Chat version to publish from the Microsoft 365 admin center (Copilot → Prompts), with steps and a comparison checklist.

Why this design, and what it costs ($0 extra for Copilot-licensed users): [docs/architecture-and-costs.md](docs/architecture-and-costs.md).

## Repository layout
```
agent/                      Daily Digest agent source (edit these)
  instructions.md             the agent's system instructions: digest rules and output format
  agent.mcs.yml               agent definition (model, conversation starters, capabilities)
  settings.mcs.yml            bot settings (auth, orchestration)
  tools/*.mcs.yml             connector tools (Outlook, Office 365 Users), all end-user auth
  topics/*.mcs.yml            system topics (greeting, sign-in, errors, ...)
  connectionreferences.mcs.yml connection references packaged with the solution
  solution.yml                solution name, version, publisher
filing-agent/               Filing Assistant agent source; workflows/ holds its Power Automate flow
filing-skill/                Filing skill experiment: outlook-filing/SKILL.md (zip it to upload)
filing-skill-test/          Filing Skill Test experiment: agent source, tools and Filing-Rules.md/.docx
build/build_solution.py     builds agent/ (or --source filing-agent) into out/<solution>_<version>.zip
deploy/                     pac-based import + publish (PowerShell and bash)
scripts/Review-Flows.ps1    pac-based review of existing cloud flows
legacy-flows/               exported definitions of the two flows being replaced
docs/                       flow review, architecture/costs, admin guide, user guide, filing pilot guide
```

## Quick start
```bash
pip install pyyaml
python3 build/build_solution.py --check          # build + validate with `pac solution unpack`
python3 build/build_solution.py --pilot          # separate "Daily Digest (Pilot)" agent for a pilot group
python3 build/build_solution.py --source filing-agent   # Filing Assistant
python3 build/build_solution.py --source filing-skill-test   # Filing Skill Test (experiment)
python3 build/build_skill_plugin.py                         # outlook-filing skill as a Copilot plugin
deploy/deploy.sh https://<env>.crm.dynamics.com    # import + publish with pac
```
Then finish the rollout in Copilot Studio and the Microsoft 365 admin center: [docs/admin-deployment-guide.md](docs/admin-deployment-guide.md). Give employees [docs/user-guide.md](docs/user-guide.md).

## Changing the digest
Most changes are edits to [`agent/instructions.md`](agent/instructions.md): what counts as urgent, sections, tone, length. After editing, bump `version` in `agent/solution.yml`, rebuild, and redeploy.

> Don't use `{curly braces}` in the instructions. Copilot Studio parses them as Power Fx, and the agent will fail to publish. Use `[square brackets]` for placeholders. The build script enforces this.

## Reviewing flows with the Power Platform CLI
```powershell
pac auth create --environment https://<env>.crm.dynamics.com
pac power-automate list-cloud-flows
pac power-automate list-flow-actions --workflow-id <id>
pac power-automate list-flow-runs --workflow-id <id>
./scripts/Review-Flows.ps1 -EnvironmentUrl https://<env>.crm.dynamics.com -NameFilter Digest -OrgDomain contoso.com
```
