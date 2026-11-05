# Cassin AI Hub web part

The SharePoint Framework (SPFx 1.24) web part that draws the hub's list-driven sections in
the Cassin design: this week's tip, featured prompts, the searchable Prompt Library with
Copy buttons, all Friday tips, demo videos, agents, FAQ and "Your feedback". It reads the
hub's lists live through SharePoint REST as the signed-in user, so content changes need no
code change. Each instance shows one section, chosen in its **Section** setting.

The **programStatus** section is the AI Working Group's roadmap page, read from the `AI Roadmap`,
`Waiting on Cassin` and `Hub Feedback` lists (owners and members only). The **agents** section
shows *Use these now* (Live) and *Coming next* (Pilot, Up next).

The **adoption** section is the admin-only Copilot adoption page. It reads Microsoft's Copilot
usage reports (`/copilot/reports/...`, beta for JSON) and Entra ID users through Microsoft
Graph as the signed-in admin, so the package requests `Reports.Read.All` and `User.Read.All`
(approved in SharePoint admin center → Advanced → API access). It saves one snapshot a month
to the `Copilot Adoption History` list. Microsoft documents the per-person active days and
prompt counts only in prose, so `adoptionModel.ts` finds those fields by name pattern and the
page says so if they're missing. Add `?adoptionDebug=1` to the page address to log the
report's field names to the console.

The built package is `../package/cassin-ai-hub-webpart.sppkg`. Deployment is in the parent
README (step 3).

## Build
Node 22 or 24:
```bash
npm ci
npm run build        # writes sharepoint/solution/cassin-ai-hub-webpart.sppkg
```
Copy the new `.sppkg` to `../package/` and bump `version` in `config/package-solution.json`
(and `package.json`) for each release so the app catalog shows an update.

## Files
- `src/webparts/cassinAiHub/CassinAiHubWebPart.ts`: the web part, section picker, Copy and search
- `src/webparts/cassinAiHub/data.ts`: list reads. Field names must match `Deploy-CassinAIHub.ps1`
- `src/webparts/cassinAiHub/render.ts`: HTML for each section (from the mockup in `../preview`)
- `src/webparts/cassinAiHub/styles.ts`: the Cassin styles, scoped under `.cah`
- `src/webparts/cassinAiHub/adoptionModel.ts`: parses the Copilot reports and works out stages, changes, departments (pure functions)
- `src/webparts/cassinAiHub/adoptionData.ts`: Microsoft Graph reads and the monthly snapshot
- `src/webparts/cassinAiHub/adoptionView.ts`: the adoption page (from `../preview/adoption-preview.html`)
- `src/webparts/cassinAiHub/programStatus.ts`: the working group's AI Program status page (roadmap boards, Waiting on Cassin, feedback)
