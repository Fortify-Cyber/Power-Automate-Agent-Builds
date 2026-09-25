# Architecture and cost decision

**Client profile:** 150 employees, Microsoft 365 E5, **all licensed for Microsoft 365 Copilot**.
**Decision:** Option D, a Copilot Studio agent that each employee runs as themselves, delivered daily by Copilot scheduled prompts.

## Options considered

| | A. Central Power Automate flow + AI prompt | B. Central Copilot Studio agent flow | C. Copilot Chat scheduled prompt only | **D. Daily Digest agent + scheduled prompts** ✅ |
|---|---|---|---|---|
| How it runs | One scheduled flow loops over every user | Same, built and billed in Copilot Studio | Each user writes their own prompt | One governed agent. Each user schedules it. |
| Data access | App registration with Graph permissions over everyone's mail | Same | User's own | **User's own** (end-user credentials) |
| LLM | AI Builder prompt | AI Builder prompt | Copilot | Copilot Studio (GPT-5 Chat by default) |
| Licensing | Process license, $150/month (E5's seeded Power Automate covers standard connectors only) | Copilot Credits | Included with M365 Copilot | **Included with M365 Copilot** |
| Est. cost for 150 users | ~$167/month | ~$100/month | $0 | **$0** |
| Consistent format, central updates | ✅ | ✅ | ❌ | ✅ |
| Rollout | Add users to an Entra group | Add users to an Entra group | Each user writes a prompt | Admin deploys once. Each user clicks Schedule once. |
| Security review burden | High (tenant-wide mailbox access) | High | Low | **Low** |

Cost estimates assume 22 workdays, about 20 flow actions and 5,000 tokens per digest, and pay-as-you-go pricing at $0.01 per Copilot Credit. AI prompt basic tier: 0.1 credits per 1K tokens. Agent flow actions: 13 credits per 100 actions.

## Why D
1. **$0 incremental cost.** Microsoft's Copilot Studio billing table marks agent answers, agent actions, tools and tenant graph grounding as "No charge" when *"the user of the agent is licensed with Microsoft 365 Copilot, and the agent operates using the authenticated Microsoft 365 Copilot user's identity."*
2. **Smallest attack surface.** There's no service principal with `Mail.Read` across 150 mailboxes, and each user's digest can only read what that user can already read. For a security firm's client, this is the design their security team will approve fastest.
3. **One artifact, deployed once.** A single solution with a single agent. The admin assigns it to the organization or a group in the Microsoft 365 admin center.
4. **Interactive follow-ups** ("draft a reply to #2") come free with the chat experience.

## Trade-offs and mitigations
| Trade-off | Mitigation |
|---|---|
| Each employee has to schedule the prompt once | 30-second step in the [user guide](user-guide.md). Or pin the agent so it's one click on demand. |
| Scheduled prompts for custom agents are still rolling out (they reached some tenants through the Frontier program first) | Scheduling from Copilot Chat with `@Daily Digest` works as a fallback, as does running it on demand. If a guaranteed 7 AM email without user action becomes a hard requirement, Option B can reuse the same instructions (~$100/month). |
| LLM output varies slightly from day to day | A fixed output template in the instructions, plus a pilot week to tune them |
| Copilot-licensed users only | Unlicensed users wouldn't be covered. If the tenant has no Copilot Credits capacity, their use is simply blocked, so there are no surprise charges. |

## Data flow
```
Employee (Copilot / Teams / Outlook)
   │  "Run my daily digest"  (typed, or fired by their scheduled prompt)
   ▼
Daily Digest agent (Copilot Studio, client's Power Platform environment)
   │  tools, each running with the employee's own credentials
   ├── Office 365 Users  → Get my profile
   ├── Office 365 Outlook → Get inbox emails / Get sent emails   (Graph HTTP request, pinned to GET)
   ├── Microsoft To Do    → List lists / List tasks              (read-only)
   ├── Planner            → List my tasks                        (read-only)
   └── Office 365 Outlook → Email me my digest   (recipient locked to the signed-in user)
   ▼
Prioritized digest in chat, and in the user's inbox when requested (the scheduled prompt asks for it)
```
Everything stays inside the Microsoft 365 / Power Platform service boundary. Web browsing is turned off for the agent.

## Sources
- [Copilot Studio billing rates and what Microsoft 365 Copilot users get at no charge](https://learn.microsoft.com/en-us/microsoft-copilot-studio/requirements-messages-management)
- [Copilot Studio licensing](https://learn.microsoft.com/en-us/microsoft-copilot-studio/billing-licensing)
- [Power Automate licensing FAQ (Process license, flow groups)](https://learn.microsoft.com/en-us/power-platform/admin/power-automate-licensing/faqs)
- [AI Builder / Copilot Credits](https://learn.microsoft.com/en-us/ai-builder/credit-management)
- [Scheduled prompts (admin)](https://learn.microsoft.com/en-us/copilot/microsoft-365/scheduled-prompts)
