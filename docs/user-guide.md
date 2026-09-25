# Your Daily Digest ☀️

**Daily Digest** is a Copilot agent that reads your inbox, Microsoft To Do and Planner and gives you one short briefing of what needs your attention:

- 🔴 **Needs attention now**: urgent requests, approvals and deadlines, plus ⚠️ warnings on suspicious payment or password requests
- 📨 **Waiting on your reply**: emails sent to you that ask a question or need a response (threads you've already answered are skipped)
- ✅ **Tasks**: overdue, due today and due this week
- 👀 **For awareness**: everything else, kept brief

It only sees **your** mail and tasks. It can't send, delete or move anything, and nothing is shared with anyone else.

Setup takes about **5 minutes, once**: run the digest the first time (Part 1), then schedule it (Part 2).

---

## Part 1: Run your first digest (about 2 minutes)

You have to do this once by hand so Daily Digest can ask for permission to read your mail and tasks. A scheduled digest can't ask for permission, so it would fail if you skipped this.

### Step 1: Open Microsoft 365 Copilot
Use whichever you prefer. They all work the same way:
- **In a browser:** go to **https://m365.cloud.microsoft/chat** and sign in with your work account.
- **In Teams:** click **Copilot** in the left-hand bar.
- **In Outlook** (new Outlook or Outlook on the web): click the **Copilot** icon at the top right, or in the left-hand app bar.

> 📸 *Screenshot: Copilot open, with the left-hand panel visible.*

### Step 2: Find Daily Digest
1. In the left-hand panel of Copilot, look under **Agents** for **Daily Digest**. It has a small robot icon.
2. If you don't see it, click **All agents** (or **Get agents**), type **Daily Digest** in the search box, and select it.
3. The agent opens in its own chat. The title at the top says **Daily Digest**, and you'll see suggestion buttons such as *Run my daily digest*.

> Still can't find it? It can take up to 24 hours to appear after IT rolls it out. After that, contact IT.

> 📸 *Screenshot: the Agents list with Daily Digest highlighted.*

### Step 3: Run it
1. Click the **Run my daily digest** suggestion, or type `Run my daily digest` and press **Enter**.
2. **The first time only**, you'll see a card asking for permission to connect to *Office 365 Outlook*, *Office 365 Users*, *Microsoft To Do* and *Planner*. Click **Allow** (or **Connect** / **Sign in**) for each one. You may see up to four prompts, one after another.
3. Wait 20–60 seconds while it reads your mail and tasks. Your digest then appears in the chat.

> 📸 *Screenshot: the connection permission card with the Allow button.*

> **"Web search is off"** at the top of the chat is not an error. Daily Digest never searches the web, so your email content stays inside Microsoft 365. You can close the notice with the **X**.

> **Seeing "Sorry, I wasn't able to respond to that"?** That's normal on the first run: Copilot sometimes stops while the permission cards are still waiting. **Scroll up** and click **Allow** on every permission card (there can be up to four), then send **Run my daily digest** again. From then on your permissions are saved and it runs normally.

**Check it once:** click a subject line and make sure it opens the right email in Outlook. If anything looks wrong, tell IT (see the end of this guide).

---

## Part 2: Get it every weekday morning automatically (about 2 minutes)

### Step 4: Schedule the prompt
1. Stay in the **Daily Digest** chat from Part 1.
2. Move your mouse over **your own message** `Run my daily digest` (the one you typed or clicked, not the digest reply). A small row of icons appears under or beside it.
3. Click **Schedule this prompt**. It's a clock icon. If you only see **…** (More options), click that first and then **Schedule this prompt**.

> 📸 *Screenshot: hovering over the "Run my daily digest" message, with the Schedule this prompt icon highlighted.*

### Step 5: Choose when it runs
A scheduling panel opens. Fill it in like this:

| Setting | What to choose |
|---|---|
| **Frequency / Repeat** | **Daily**. If it offers days of the week, choose **Monday–Friday** only. |
| **Start** | Tomorrow's date |
| **Time** | Before you usually start work, e.g. **7:30 AM**. It uses your own time zone. |
| **How many times it runs / End** | The **largest number or latest end date** allowed. If there's a limit, you'll need to reschedule when it ends. See Tip 3 below. |
| **Email me / Notify me when the response is ready** | **On**, so you get an email each morning with a link to your digest |

Then click **Save**.

> 📸 *Screenshot: the completed scheduling panel.*

### Step 6: Confirm it's scheduled
1. At the top right of Copilot, click **…** (**Settings and more**), then **Scheduled prompts**.
2. You should see **Run my daily digest**, with **Daily Digest** and the time you chose.
3. Optional: click **Run now** to test it straight away.

> 📸 *Screenshot: the Scheduled prompts page.*

**That's it.** Each weekday morning your digest runs by itself. It appears in Copilot's **Chats** list, shown in **bold** with a clock icon, and if you turned on email notifications you'll also get an email with a link to it.

---

## If "Schedule this prompt" doesn't appear in the Daily Digest chat

Microsoft is still rolling out scheduling for agents. If you don't see the option in Step 4, schedule it from the main Copilot chat instead:

1. In Copilot, click **New chat**. Use the main Copilot chat, not the Daily Digest agent chat.
2. Type `@Daily Digest run my daily digest`. When you type `@`, a list of agents appears. Choose **Daily Digest** from it, then type the rest.
3. Press **Enter** and check that the digest appears.
4. Hover over your message and click **Schedule this prompt**, then continue from **Step 5** above.

If neither way works yet, just open Daily Digest each morning and click **Run my daily digest**. It takes one click.

---

## Managing your schedule

Open **… (Settings and more) → Scheduled prompts** at the top right of Copilot. Next to your digest you can:

| Action | What it does |
|---|---|
| **Run now** | Runs it immediately |
| **Edit schedule** | Changes the time, days or end date |
| **Turn off** | Pauses it, e.g. while you're on vacation |
| **Delete** | Removes it permanently |

You can have up to **10** scheduled prompts in total.

---

## Handy follow-ups
After the digest appears, you can ask things like:
- "Draft a reply to #2" (it writes the draft in the chat for you to copy; it can't send it)
- "Tell me more about the Contoso email"
- "Run my digest for everything since Friday"
- "What's overdue?"

## Tips
1. **Flag an email** in Outlook, or add a task in **To Do** or **Planner**, and it shows up in the next digest.
2. **Mondays automatically cover the weekend**, so nothing from Friday evening onward is missed.
3. **If your digest stops arriving**, check **Scheduled prompts**. It may have reached its end date or number of runs. Use **Edit schedule** to extend it.
4. **The digest is AI-generated.** Open the linked email before acting on anything important, and **always confirm payment or bank-detail changes by phone**.

## Something wrong or missing?
Tell IT which item was wrong and what you expected. For example: "It listed a newsletter as urgent" or "It missed an email from a client asking for a signed contract." IT can tune the digest for everyone.
