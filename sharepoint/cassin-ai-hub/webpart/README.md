# Cassin AI Hub web part

The SharePoint Framework (SPFx 1.24) web part that draws the hub's list-driven sections in
the Cassin design: this week's tip, featured prompts, the searchable Prompt Library with
Copy buttons, all Friday tips, demo videos, agents, FAQ and "Your feedback". It reads the
hub's lists live through SharePoint REST as the signed-in user, so content changes need no
code change. Each instance shows one section, chosen in its **Section** setting.

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
