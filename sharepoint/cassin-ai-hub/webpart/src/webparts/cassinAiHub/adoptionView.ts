import { MOVES, STAGES, stageOf, daysBetween, type IAdoption, type IGroupRow, type IPerson, type Move } from './adoptionModel';
import { esc } from './render';

// The admin "Copilot adoption" page, laid out as in preview/adoption-preview.html. Every value
// that comes from Graph or Entra ID goes through esc().

type Tab = 'overview' | 'habits' | 'roles' | 'people';
const TABS: Array<[Tab, string]> = [['overview', 'Overview'], ['habits', 'Habits'], ['roles', 'Roles'], ['people', 'People']];
const MOVE_COLOR: Record<Move, string> = { new: '#0077CE', ramped_up: '#2F8A5B', steady: '#C7D5DF', cooled: '#B87A1F', lapsed: '#B4463A' };
const MOVE_RANK: Record<Move, number> = { ramped_up: 0, new: 1, steady: 2, cooled: 3, lapsed: 4 };
const PAGE = 15;
interface IFilter { q: string; role: string; stage: string; move: string }

const pct = (a: number, b: number): number => (b ? Math.round(100 * a / b) : 0);
const monthName = (m: string): string => new Date(`${m}-15T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
const shortDate = (d: string): string => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const longDate = (d: string): string => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export class AdoptionView {
  private _tab: Tab = 'overview';
  private _sort: { key: string; dir: number } = { key: 'days', dir: -1 };
  private _filter: IFilter = { q: '', role: '', stage: '', move: '' };
  private _showAll = false;
  private _root: HTMLElement | undefined;
  private readonly _onResize = (): void => this._drawCharts();

  public constructor(private readonly _m: IAdoption, private readonly _saved: boolean) {}

  public html(): string {
    const m = this._m;
    return `<div class="ad">
      <div class="ad-head">
        <div class="ad-lock">🔒 Visible to AI Hub Admins only</div>
        <div class="ad-tabs" role="tablist">${TABS.map(([k, l]) =>
          `<button type="button" role="tab" data-ad-tab="${k}" aria-selected="${k === this._tab}" class="${k === this._tab ? 'on' : ''}">${l}</button>`).join('')}</div>
      </div>
      ${m.namesHidden ? `<div class="ad-warn"><b>Names are hidden in Microsoft's reports.</b> Microsoft 365 is set to conceal user names in usage reports, so people can't be matched to names or job titles. A Global Admin can change this in the Microsoft 365 admin center: <b>Settings → Org settings → Services → Reports</b>, then clear <b>Display concealed user, group, and site names in all reports</b>. Monthly history isn't saved while names are hidden.</div>` : ''}
      <section data-ad-view="overview" ${this._tab === 'overview' ? '' : 'hidden'}>${this._overview()}</section>
      <section data-ad-view="habits" ${this._tab === 'habits' ? '' : 'hidden'}>${this._habits()}</section>
      <section data-ad-view="roles" ${this._tab === 'roles' ? '' : 'hidden'}>${this._roles()}</section>
      <section data-ad-view="people" ${this._tab === 'people' ? '' : 'hidden'}>${this._peopleShell()}</section>
      <p class="ad-note">Source: Microsoft 365 Copilot usage reports and Entra ID (names and job titles) through Microsoft Graph, read as you.
        ${m.refresh ? `Microsoft's data is up to ${longDate(m.refresh)}.` : ''}
        Monthly history is saved to the admin-only Copilot Adoption History list on this site${this._saved ? ' (this month\'s was just saved)' : ''}.
        Everything stays in Cassin's Microsoft 365. This page counts usage only; it never reads what anyone asks Copilot.</p>
      <div class="ad-pd" data-ad-drawer hidden><div class="ad-scrim" data-ad-close></div><aside class="ad-drawer" aria-label="Person detail"></aside></div>
    </div>`;
  }

  public mount(root: HTMLElement): void {
    this._root = root;
    this._renderPeople();
    this._drawCharts();
    window.removeEventListener('resize', this._onResize);
    window.addEventListener('resize', this._onResize);
  }

  public dispose(): void {
    window.removeEventListener('resize', this._onResize);
  }

  /** Returns true when the click belonged to the adoption page. */
  public onClick(e: Event): boolean {
    const t = e.target as HTMLElement;
    const tab = t.closest<HTMLElement>('[data-ad-tab]');
    if (tab) { this._setTab(tab.getAttribute('data-ad-tab') as Tab); return true; }
    const goto = t.closest<HTMLElement>('[data-ad-goto]');
    if (goto) {
      this._filter.move = goto.getAttribute('data-ad-goto') || '';
      const sel = this._root?.querySelector<HTMLSelectElement>('[data-ad-f="move"]');
      if (sel) sel.value = this._filter.move;
      this._setTab('people'); this._renderPeople(); return true;
    }
    const person = t.closest<HTMLElement>('[data-ad-person]');
    if (person) { this._openPerson(Number(person.getAttribute('data-ad-person'))); return true; }
    if (t.closest('[data-ad-close]')) { this._closePerson(); return true; }
    const sort = t.closest<HTMLElement>('[data-ad-sort]');
    if (sort) {
      const key = sort.getAttribute('data-ad-sort') || 'days';
      this._sort = { key, dir: this._sort.key === key ? -this._sort.dir : (key === 'name' ? 1 : -1) };
      this._renderPeople(); return true;
    }
    if (t.closest('[data-ad-more]')) { e.preventDefault(); this._showAll = true; this._renderPeople(); return true; }
    return false;
  }

  public onInput(e: Event): boolean {
    const el = e.target as HTMLInputElement;
    const f = el.getAttribute('data-ad-f') as keyof IFilter | null;
    if (!f) return false;
    this._filter[f] = el.value;
    this._showAll = false;
    this._renderPeople();
    return true;
  }

  public onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') this._closePerson();
  }

  // ---------------------------------------------------------------- overview
  private _overview(): string {
    const m = this._m;
    const active = m.people.filter(p => p.status === 'active').length;
    const never = m.people.filter(p => p.status === 'never');
    const lapsed = m.people.filter(p => p.status === 'lapsed').sort((a, b) => (b.last || '').localeCompare(a.last || ''));
    const n = (v: number): string => v.toLocaleString('en-US');
    let promptsTile = { accent: false, label: 'Licensed', value: String(m.licensed), sub: 'Microsoft 365 Copilot licenses assigned', delta: '' };
    if (m.promptsNow !== null) {
      const change = m.promptsBefore ? Math.round(100 * (m.promptsNow - m.promptsBefore) / m.promptsBefore) : null;
      promptsTile = {
        accent: false, label: 'Prompts, last 28 days', value: n(m.promptsNow), sub: `About ${active ? n(Math.round(m.promptsNow / active)) : 0} per active person`,
        delta: change === null ? '' : `<div class="delta ${change >= 0 ? 'up' : 'down'}">${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}% vs the monthly average before</div>`
      };
    }
    const tiles: Array<{ accent: boolean; label: string; value: string; sub: string; delta: string }> = [
      { accent: true, label: 'Active last 28 days', value: `${pct(active, m.licensed)}%`, sub: `${active} of ${m.licensed} licensed people`, delta: '' },
      promptsTile,
      { accent: false, label: 'Not started', value: String(never.length), sub: 'Licensed, never used', delta: '' },
      { accent: false, label: 'Recently lapsed', value: String(lapsed.length), sub: 'No activity in 28 days', delta: '' }
    ];
    const rows = (list: IPerson[], cols: (p: IPerson) => string, span: number): string =>
      list.slice(0, 8).map(p => `<tr class="click" data-ad-person="${this._m.people.indexOf(p)}">${cols(p)}</tr>`).join('') +
      (list.length > 8 ? `<tr><td colspan="${span}" class="faint">+ ${list.length - 8} more on the People tab</td></tr>` : '') +
      (list.length ? '' : `<tr><td colspan="${span}" class="faint">No one.</td></tr>`);
    return `<div class="ad-tiles">${tiles.map(t => `<div class="ad-tile${t.accent ? ' accent' : ''}"><div class="k">${t.label}</div><div class="v">${t.value}</div><div class="s">${t.sub}</div>${t.delta}</div>`).join('')}</div>
      <div class="ad-grid2">
        <div class="ad-panel"><h3>Copilot use over time</h3>
          <p class="hint">People using Copilot on an average day (7-day average), against licensed people.</p>
          <div class="ad-legend"><span><i style="background:#00426C"></i>Active on an average day</span><span><i style="background:#C7D5DF"></i>Licensed</span></div>
          <div data-ad-chart="trend"></div></div>
        <div class="ad-panel"><h3>Where people use it</h3><p class="hint">Active users by app, last 28 days.</p>
          <div class="ad-bars">${m.appCounts.map(a => `<div class="row"><span>${esc(a.app.label)}</span><div class="track"><div class="fill" style="width:${pct(a.users, m.licensed)}%"></div></div><span class="num">${a.users} · ${pct(a.users, m.licensed)}%</span></div>`).join('') || '<p class="faint">No app activity in the report.</p>'}</div></div>
      </div>
      ${m.promptsNow !== null ? `<div class="ad-panel"><h3>Prompts over time</h3>
          <p class="hint">${m.hasDailyPrompts ? 'Prompts people sent Copilot each day (7-day average). More prompts from the same people means Copilot is becoming part of the work.'
            : 'Prompts people sent Copilot each month. The first bar is the monthly average over the five months before the last 28 days, from Microsoft\'s 180-day report; each month after launch is added as it\'s saved.'}</p>
          <div data-ad-chart="prompts"></div></div>` : ''}
      <div class="ad-grid2b">
        <div class="ad-panel"><h3>Not started <span class="count">(${never.length})</span></h3>
          <p class="hint">Licensed, but no Copilot activity yet. A quick check-in or the Get Started page usually helps.</p>
          <table><thead><tr><th>Name</th><th>Role</th></tr></thead><tbody>${rows(never, p => `<td>${esc(p.name)}</td><td>${esc(p.role)}</td>`, 2)}</tbody></table></div>
        <div class="ad-panel"><h3>Recently lapsed <span class="count">(${lapsed.length})</span></h3>
          <p class="hint">Used Copilot before, but not in the last 28 days.</p>
          <table><thead><tr><th>Name</th><th>Last used</th><th>Where</th></tr></thead><tbody>${rows(lapsed, p => `<td>${esc(p.name)}</td><td>${p.last ? shortDate(p.last) : ''}</td><td>${esc(this._lastApp(p))}</td>`, 3)}</tbody></table></div>
      </div>`;
  }

  private _lastApp(p: IPerson): string {
    const keys = Object.keys(p.apps).sort((a, b) => p.apps[b].localeCompare(p.apps[a]));
    return keys.length ? (this._m.apps.find(a => a.key === keys[0])?.label || '') : '';
  }

  // ---------------------------------------------------------------- habits
  private _habits(): string {
    const m = this._m;
    if (!m.hasDays) {
      return `<div class="ad-warn">Microsoft's Copilot usage report for Cassin doesn't include active days per person yet, so habit stages can't be shown. Microsoft is rolling this out in its updated report; this tab fills in by itself once it arrives. The other tabs work in the meantime.</div>`;
    }
    const first = m.monthStages[0];
    const tiles = STAGES.map((s, i) => {
      const n = m.nowStages[i];
      let delta = '';
      if (first) {
        const d = n - first[i], good = i === 0 ? d < 0 : d > 0;
        delta = `<div class="delta ${d === 0 ? '' : good ? 'up' : 'down'}">${d > 0 ? '▲' : d < 0 ? '▼' : '='} ${Math.abs(d)} since ${monthName(m.months[0])}</div>`;
      }
      return `<div class="ad-tile stage" style="--c:${s.color}"><div class="k">${s.label}</div><div class="v">${n}</div><div class="s">${s.range} · ${pct(n, m.licensed)}%</div>${delta}</div>`;
    }).join('');
    const moveCounts = (Object.keys(MOVES) as Move[]).map(k => m.moves[k]);
    const total = moveCounts.reduce((a, b) => a + b, 0);
    const maxMove = Math.max(1, ...moveCounts);
    const moved = m.hasMoves
      ? `<div class="ad-bars">${(Object.keys(MOVES) as Move[]).map(k => `<div class="row mv-row"><button type="button" class="link mv ${k}" data-ad-goto="${k}">${MOVES[k]}</button><div class="track"><div class="fill" style="width:${100 * m.moves[k] / maxMove}%;background:${MOVE_COLOR[k]}"></div></div><span class="num">${m.moves[k]}</span></div>`).join('')}</div>
         <p class="hint" style="margin-top:12px">Select a group to see who. ${total ? '' : 'No change to report yet.'}</p>`
      : '<p class="faint">Microsoft\'s 180-day report didn\'t include active days, so changes can\'t be worked out yet.</p>';
    return `<div class="ad-tiles five">${tiles}</div>
      <div class="ad-grid2">
        <div class="ad-panel"><h3>Habit formation by month</h3>
          <p class="hint">Licensed people by number of days they used Copilot each month.${m.months.length ? '' : ' Each month is saved here as it completes, so this chart grows from launch.'}</p>
          <div class="ad-legend">${STAGES.map(s => `<span><i style="background:${s.color}"></i>${s.label} <span class="faint">${s.range}</span></span>`).join('')}</div>
          <div data-ad-chart="monthly"></div>
          <p class="hint" style="margin-top:6px">The number on each bar is people at Habitual or Power.</p></div>
        <div class="ad-panel"><h3>Who moved</h3>
          <p class="hint">Each person's last 28 days against their monthly average over the five months before, from Microsoft's 180-day report.</p>${moved}</div>
      </div>`;
  }

  // ---------------------------------------------------------------- roles
  private _groupTable(rows: IGroupRow[], extras: boolean): string {
    const m = this._m;
    const head = `<th>Name</th><th class="n">People</th><th class="n">Active</th>${m.hasDays ? '<th>Habit mix</th><th class="n">Habitual or Power</th><th class="n">Median days</th>' : ''}` +
      (extras ? `${m.hasPrompts ? '<th class="n">Prompts / person</th>' : ''}<th class="n">Apps / person</th>${m.hasMoves ? '<th class="n">Moved up</th><th class="n">Dropped</th>' : ''}` : '');
    const body = rows.map(g => {
      const total = g.stages.reduce((a, b) => a + b, 0) || 1;
      const mix = `<div class="stack" title="${STAGES.map((s, i) => `${s.label}: ${g.stages[i]}`).join(', ')}">${STAGES.map((s, i) => g.stages[i] ? `<span style="width:${100 * g.stages[i] / total}%;background:${s.color}"></span>` : '').join('')}</div>`;
      return `<tr><td>${esc(g.name)}</td><td class="n">${g.people}</td><td class="n">${g.activePct}%</td>` +
        (m.hasDays ? `<td>${mix}</td><td class="n">${g.habitualPct}%</td><td class="n">${g.medianDays}</td>` : '') +
        (extras ? `${m.hasPrompts ? `<td class="n">${g.promptsPerPerson ?? '–'}</td>` : ''}<td class="n">${g.appsPerPerson ?? '–'}</td>` +
          (m.hasMoves ? `<td class="n"><span class="delta up">${g.movedUp}</span></td><td class="n"><span class="delta ${g.dropped ? 'down' : ''}">${g.dropped}</span></td>` : '') : '') +
        '</tr>';
    }).join('');
    return `<div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  private _roles(): string {
    const m = this._m;
    const none = m.people.length > 0 && m.people.every(p => !p.role);
    return `<div class="ad-panel"><h3>By role</h3>
        <p class="hint">Last 28 days, by job title in Entra ID. Titles held by fewer than 5 people are combined into "Other".</p>
        ${none ? '<p class="faint">No job titles found in Entra ID, or the web part can\'t read them yet (it needs the User.Read.All permission approved).</p>' : this._groupTable(m.roles, true).replace('<th>Name</th>', '<th>Role</th>')}</div>`;
  }

  // ---------------------------------------------------------------- people
  private _peopleShell(): string {
    const m = this._m;
    const roles = Array.from(new Set(m.people.map(p => p.role).filter(Boolean))).sort();
    const opt = (v: string, l: string): string => `<option value="${esc(v)}">${esc(l)}</option>`;
    return `<div class="ad-panel"><h3>People <span class="count" data-ad-count></span></h3>
      <p class="hint">Last 28 days. Select a person for their history, apps and a suggested next step.</p>
      <div class="ad-filters">
        <input data-ad-f="q" placeholder="Search by name" aria-label="Search by name">
        <select data-ad-f="role" aria-label="Role">${opt('', 'All roles')}${roles.map(r => opt(r, r)).join('')}</select>
        ${m.hasDays ? `<select data-ad-f="stage" aria-label="Stage">${opt('', 'All stages')}${STAGES.map((s, i) => opt(String(i), s.label)).join('')}</select>` : ''}
        <select data-ad-f="move" aria-label="Change">${opt('', 'Any change')}${(Object.keys(MOVES) as Move[]).map(k => opt(k, MOVES[k])).join('')}</select>
      </div>
      <div class="scroll"><table><thead><tr>
        <th data-ad-sort="name" class="sort">Name</th><th>Role</th>
        ${m.hasDays ? '<th data-ad-sort="stage" class="sort">Stage</th><th data-ad-sort="days" class="sort n">Active days</th>' : '<th data-ad-sort="last" class="sort">Last used</th>'}
        ${m.hasPrompts ? '<th data-ad-sort="prompts" class="sort n">Prompts</th>' : ''}
        ${m.months.length && m.hasDays ? `<th>${monthName(m.months[0])} → now</th>` : ''}
        <th>Apps</th><th data-ad-sort="move" class="sort">Change</th>
      </tr></thead><tbody data-ad-rows></tbody></table></div>
      <p><button type="button" class="btn ghost" data-ad-more hidden></button></p></div>`;
  }

  private _renderPeople(): void {
    const root = this._root;
    if (!root) return;
    const m = this._m, f = this._filter, q = f.q.trim().toLowerCase();
    if (!m.hasDays && this._sort.key === 'days') this._sort = { key: 'last', dir: -1 };
    const rows = m.people.filter(p => (!q || p.name.toLowerCase().includes(q)) && (!f.role || p.role === f.role) &&
      (f.stage === '' || p.stage === Number(f.stage)) && (!f.move || p.move === f.move));
    const val = (p: IPerson): string | number => {
      switch (this._sort.key) {
        case 'name': return p.name.toLowerCase();
        case 'stage': return (p.stage ?? -1) * 100 + (p.days ?? 0);
        case 'prompts': return p.prompts ?? -1;
        case 'last': return p.last || '';
        case 'move': return p.move ? -MOVE_RANK[p.move] : -9;
        default: return p.days ?? -1;
      }
    };
    rows.sort((a, b) => { const x = val(a), y = val(b); return x > y ? this._sort.dir : x < y ? -this._sort.dir : a.name.localeCompare(b.name); });
    const shown = this._showAll ? rows : rows.slice(0, PAGE);
    const cols = 4 + (m.hasPrompts ? 1 : 0) + (m.months.length && m.hasDays ? 1 : 0) + (m.hasDays ? 1 : 0);
    const tbody = root.querySelector('[data-ad-rows]');
    if (tbody) {
      tbody.innerHTML = shown.map(p => `<tr class="click" data-ad-person="${m.people.indexOf(p)}">
        <td>${esc(p.name)}</td><td>${esc(p.role)}</td>
        ${m.hasDays ? `<td>${this._stage(p.stage)}</td><td class="n">${p.days}</td>` : `<td>${p.last ? shortDate(p.last) : '–'}</td>`}
        ${m.hasPrompts ? `<td class="n">${p.prompts}</td>` : ''}
        ${m.months.length && m.hasDays ? `<td>${this._spark(p)}</td>` : ''}
        <td>${this._chips(p)}</td><td>${this._move(p.move)}</td></tr>`).join('') ||
        `<tr><td colspan="${cols}" class="faint">No one matches.</td></tr>`;
    }
    const count = root.querySelector('[data-ad-count]');
    if (count) count.textContent = `(${rows.length})`;
    const more = root.querySelector<HTMLButtonElement>('[data-ad-more]');
    if (more) { more.hidden = this._showAll || rows.length <= PAGE; more.textContent = `Show all ${rows.length}`; }
  }

  private _stage(s: number | null): string {
    return s === null ? '–' : `<span class="stg" style="--c:${STAGES[s].color}"><i></i>${STAGES[s].label}</span>`;
  }
  private _move(mv: Move | null): string {
    return mv ? `<span class="mv ${mv}">${MOVES[mv]}</span>` : '<span class="faint">–</span>';
  }
  private _chips(p: IPerson): string {
    return `<span class="apps">${this._m.apps.map(a => `<b class="${p.appsRecent.indexOf(a.key) >= 0 ? 'on' : ''}" title="${esc(a.label)}">${a.letter}</b>`).join('')}</span>`;
  }
  private _spark(p: IPerson): string {
    const vals = [...p.monthly, p.days];
    const W = vals.length * 14, H = 22;
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-label="Active days by month">${vals.map((d, i) => {
      const h = d ? Math.max(2, Math.round(H * Math.min(d, 21) / 21)) : 1;
      return `<rect x="${i * 14}" y="${H - h}" width="11" height="${h}" fill="${d ? STAGES[stageOf(d)].color : '#E1E5EA'}"/>`;
    }).join('')}</svg>`;
  }

  // ---------------------------------------------------------------- person drawer
  private _nextStep(p: IPerson): string {
    const used = (k: string): boolean => p.appsRecent.indexOf(k) >= 0;
    const has = (k: string): boolean => this._m.apps.some(a => a.key === k);
    if (p.status === 'never') return 'Hasn\'t tried Copilot yet. Send the Get Started page, or offer 15 minutes with someone from the AI Working Group.';
    if (p.status === 'lapsed') return `Last used ${p.last ? shortDate(p.last) : 'a while ago'}. A quick check-in often finds a blocker. Share this week's Friday Tip as a reason to try it again.`;
    if (p.stage === 4) return 'Uses Copilot most working days. A good candidate to share prompts in the Prompt Library or join the AI Working Group.';
    if (has('word') && !used('word')) return 'Not using Copilot in Word yet. Point them to the drafting and summarizing prompts in the Prompt Library.';
    if (has('outlook') && !used('outlook')) return 'Not using Copilot in Outlook yet. Summarizing long threads is the quickest win for most people at the firm.';
    if (p.move === 'cooled') return 'Using it less than before. Worth asking what changed; a Demo Video for their practice area may help.';
    if (p.stage !== null && p.stage <= 2) return 'Uses it some weeks. The Friday Tips archive is a good way to build a weekly habit.';
    return 'Using it regularly. Nothing needed.';
  }

  private _openPerson(i: number): void {
    const p = this._m.people[i], m = this._m;
    const pd = this._root?.querySelector<HTMLElement>('[data-ad-drawer]');
    if (!p || !pd) return;
    const vals = m.hasDays ? [...p.monthly, p.days ?? 0] : [];
    const labels = [...m.months.map(monthName), 'Now'];
    const H = 120, W = Math.max(400, vals.length * 64), bw = 46, gap = 18, T = 18;
    const chart = vals.length ? `<h4>Active days by month</h4><svg width="100%" viewBox="0 -${T} ${W} ${H + 22 + T}" role="img" aria-label="Active days by month">
      ${[0, 10, 20].map(v => `<line x1="0" x2="${W}" y1="${H - H * v / 22}" y2="${H - H * v / 22}" stroke="#E4E1DD"/>`).join('')}
      ${vals.map((d, j) => { const v = d ?? 0, h = Math.max(1, H * Math.min(v, 22) / 22), x = 8 + j * (bw + gap); return `<rect x="${x}" y="${H - h}" width="${bw}" height="${h}" fill="${v ? STAGES[stageOf(v)].color : '#E1E5EA'}"/><text x="${x + bw / 2}" y="${H - h - 5}" font-size="12" text-anchor="middle" fill="#021D3C">${v}</text><text x="${x + bw / 2}" y="${H + 16}" font-size="11.5" text-anchor="middle" fill="#6E7C8C">${labels[j]}</text>`; }).join('')}
    </svg>${m.months.length ? '' : '<p class="faint">Earlier months appear here as they are saved.</p>'}` : '';
    const apps = m.apps.filter(a => p.apps[a.key]).sort((a, b) => p.apps[b.key].localeCompare(p.apps[a.key]))
      .map(a => `<tr><td>${esc(a.label)}</td><td class="n">${shortDate(p.apps[a.key])}${m.refresh && daysBetween(p.apps[a.key], m.refresh) > 28 ? ' <span class="faint">(over 28 days)</span>' : ''}</td></tr>`).join('') ||
      '<tr><td colspan="2" class="faint">No Copilot activity</td></tr>';
    const mini = [
      m.hasDays ? [String(p.days), 'Active days (28)'] : [p.last ? shortDate(p.last) : '–', 'Last used'],
      m.hasPrompts ? [String(p.prompts), 'Prompts (28)'] : null,
      [String(p.appsRecent.length), 'Apps used (28)']
    ].filter((x): x is string[] => !!x);
    pd.querySelector('aside')!.innerHTML = `
      <div class="hd"><button type="button" class="x" data-ad-close aria-label="Close">×</button>
        <h3>${esc(p.name)}</h3><p>${esc(p.role)}</p>
        <div class="tags">${p.stage !== null ? `<span>${this._stage(p.stage)}</span>` : ''}${p.move ? `<span>${this._move(p.move)}</span>` : ''}</div></div>
      <div class="bd">
        <div class="mini">${mini.map(([v, k]) => `<div><div class="v">${v}</div><div class="k">${k}</div></div>`).join('')}</div>
        ${chart}
        <h4>Last used, by app</h4><table>${apps}</table>
        <h4>Suggested next step</h4><div class="next">${this._nextStep(p)}</div>
        <p class="faint" style="margin-top:14px">This page counts usage only. It never reads what anyone asks Copilot.</p>
      </div>`;
    pd.hidden = false;
    pd.querySelector<HTMLElement>('.x')?.focus();
  }

  private _closePerson(): void {
    const pd = this._root?.querySelector<HTMLElement>('[data-ad-drawer]');
    if (pd) pd.hidden = true;
  }

  // ---------------------------------------------------------------- tabs and charts
  private _setTab(tab: Tab): void {
    this._tab = tab;
    this._root?.querySelectorAll<HTMLElement>('[data-ad-tab]').forEach(b => {
      const on = b.getAttribute('data-ad-tab') === tab;
      b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on));
    });
    this._root?.querySelectorAll<HTMLElement>('[data-ad-view]').forEach(v => { v.hidden = v.getAttribute('data-ad-view') !== tab; });
    this._drawCharts();
  }

  private _drawCharts(): void {
    const trend = this._root?.querySelector<HTMLElement>('[data-ad-chart="trend"]');
    if (trend && trend.offsetParent) trend.innerHTML = this._trendSvg(trend.clientWidth || 700);
    const prompts = this._root?.querySelector<HTMLElement>('[data-ad-chart="prompts"]');
    if (prompts && prompts.offsetParent) prompts.innerHTML = this._promptsSvg(prompts.clientWidth || 700);
    const monthly = this._root?.querySelector<HTMLElement>('[data-ad-chart="monthly"]');
    if (monthly && monthly.offsetParent) monthly.innerHTML = this._monthlySvg(monthly.clientWidth || 700);
  }

  private _trendSvg(W: number): string {
    const pts = this._m.trend;
    if (pts.length < 2) return '<p class="faint">Microsoft\'s trend report isn\'t available yet.</p>';
    // 7-day average: daily use dips every weekend.
    const avg = pts.map((p, i) => {
      const win = pts.slice(Math.max(0, i - 6), i + 1);
      return { date: p.date, active: win.reduce((s, x) => s + x.active, 0) / win.length, enabled: p.enabled };
    }).slice(6);
    const series = avg.length >= 2 ? avg : pts;
    const H = 260, P = { l: 36, r: 12, t: 10, b: 28 };
    const max = Math.max(10, ...series.map(p => Math.max(p.enabled, p.active)));
    const top = Math.ceil(max / 20) * 20;
    const x = (i: number): number => P.l + (W - P.l - P.r) * i / (series.length - 1);
    const y = (v: number): number => P.t + (H - P.t - P.b) * (1 - v / top);
    const line = (k: 'active' | 'enabled'): string => series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join('');
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(top * f));
    const grid = ticks.map(v => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="#E4E1DD"/><text x="${P.l - 6}" y="${y(v) + 4}" font-size="11" text-anchor="end" fill="#6E7C8C">${v}</text>`).join('');
    const step = Math.max(1, Math.round(series.length / 6));
    const labels = series.map((p, i) => (i % step === 0 && i < series.length - step / 2) || i === series.length - 1
      ? `<text x="${x(i)}" y="${H - 8}" font-size="11" text-anchor="${i === series.length - 1 ? 'end' : 'middle'}" fill="#6E7C8C">${shortDate(p.date)}</text>` : '').join('');
    const last = series[series.length - 1];
    return `<svg width="100%" viewBox="0 0 ${W} ${H}" role="img" aria-label="Copilot use over time">${grid}
      <path d="${line('active')}L${x(series.length - 1)},${y(0)}L${x(0)},${y(0)}Z" fill="#00426C" fill-opacity=".10"/>
      ${series.some(p => p.enabled) ? `<path d="${line('enabled')}" fill="none" stroke="#C7D5DF" stroke-width="2" stroke-dasharray="5 4"/>` : ''}
      <path d="${line('active')}" fill="none" stroke="#00426C" stroke-width="2.5"/>
      <circle cx="${x(series.length - 1)}" cy="${y(last.active)}" r="4.5" fill="#00426C"/>
      <text x="${x(series.length - 1) - 8}" y="${y(last.active) - 10}" font-size="12" font-weight="600" text-anchor="end" fill="#021D3C">${Math.round(last.active)} a day</text>
      ${labels}</svg>`;
  }

  // Daily prompts (7-day average) when Microsoft's trend report has them; otherwise one bar
  // per month: the average before (180-day report), each saved month, then the last 28 days.
  private _promptsSvg(W: number): string {
    const m = this._m;
    const H = 240, P = { l: 48, r: 12, t: 18, b: 28 };
    const n = (v: number): string => Math.round(v).toLocaleString('en-US');
    if (m.hasDailyPrompts) {
      const pts = m.trend.filter(t => t.prompts !== null) as Array<{ date: string; prompts: number }>;
      if (pts.length < 2) return '<p class="faint">Not enough days yet.</p>';
      const avg = pts.map((p, i) => { const w = pts.slice(Math.max(0, i - 6), i + 1); return { date: p.date, v: w.reduce((t, x) => t + x.prompts, 0) / w.length }; });
      const series = avg.length > 8 ? avg.slice(6) : avg;
      const top = Math.max(10, ...series.map(p => p.v)) * 1.1;
      const x = (i: number): number => P.l + (W - P.l - P.r) * i / (series.length - 1);
      const y = (v: number): number => P.t + (H - P.t - P.b) * (1 - v / top);
      const line = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
      const ticks = [0, 0.5, 1].map(f => top / 1.1 * f);
      const step = Math.max(1, Math.round(series.length / 6));
      const last = series[series.length - 1];
      return `<svg width="100%" viewBox="0 0 ${W} ${H}" role="img" aria-label="Prompts per day">
        ${ticks.map(v => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="#E4E1DD"/><text x="${P.l - 6}" y="${y(v) + 4}" font-size="11" text-anchor="end" fill="#6E7C8C">${n(v)}</text>`).join('')}
        <path d="${line}L${x(series.length - 1)},${y(0)}L${x(0)},${y(0)}Z" fill="#2A73B0" fill-opacity=".12"/>
        <path d="${line}" fill="none" stroke="#2A73B0" stroke-width="2.5"/>
        <circle cx="${x(series.length - 1)}" cy="${y(last.v)}" r="4.5" fill="#2A73B0"/>
        <text x="${x(series.length - 1) - 8}" y="${y(last.v) - 10}" font-size="12" font-weight="600" text-anchor="end" fill="#021D3C">${n(last.v)} a day</text>
        ${series.map((p, i) => (i % step === 0 && i < series.length - step / 2) || i === series.length - 1
          ? `<text x="${x(i)}" y="${H - 8}" font-size="11" text-anchor="${i === series.length - 1 ? 'end' : 'middle'}" fill="#6E7C8C">${shortDate(p.date)}</text>` : '').join('')}
      </svg>`;
    }
    const bars: Array<[string, number, boolean]> = [];
    if (m.promptsBefore !== null) bars.push(['Monthly average before', m.promptsBefore, false]);
    m.months.forEach((mo, i) => bars.push([monthName(mo), m.monthPrompts[i] || 0, false]));
    bars.push(['Last 28 days', m.promptsNow || 0, true]);
    const top = Math.max(1, ...bars.map(b => b[1])) * 1.15;
    const slot = (W - P.l - P.r) / Math.max(bars.length, 3), bw = Math.min(90, slot * 0.6);
    const y = (v: number): number => P.t + (H - P.t - P.b) * (1 - v / top);
    return `<svg width="100%" viewBox="0 0 ${W} ${H}" role="img" aria-label="Prompts per month">
      <line x1="${P.l}" x2="${W - P.r}" y1="${y(0)}" y2="${y(0)}" stroke="#C7D5DF"/>
      ${bars.map(([label, v, now], i) => {
        const x = P.l + slot * i + (slot - bw) / 2;
        return `<rect x="${x}" y="${y(v)}" width="${bw}" height="${Math.max(0, y(0) - y(v))}" fill="${now ? '#00426C' : '#9FBFDB'}"/>
          <text x="${x + bw / 2}" y="${y(v) - 6}" font-size="12" font-weight="600" text-anchor="middle" fill="#021D3C">${n(v)}</text>
          <text x="${x + bw / 2}" y="${H - 8}" font-size="11.5" text-anchor="middle" fill="#3B5068" font-weight="${now ? 600 : 400}">${label}</text>`;
      }).join('')}
    </svg>`;
  }

  private _monthlySvg(W: number): string {
    const m = this._m;
    const cols = [...m.monthStages, m.nowStages];
    const names = [...m.months.map(monthName), 'Last 28 days'];
    const H = 280, P = { l: 36, r: 12, t: 10, b: 28 };
    const top = Math.max(1, ...cols.map(c => c.reduce((a, b) => a + b, 0)));
    const slot = (W - P.l - P.r) / Math.max(cols.length, 3), bw = Math.min(64, slot * 0.62);
    const y = (v: number): number => P.t + (H - P.t - P.b) * (1 - v / top);
    const ticks = [0, Math.round(top / 3), Math.round(2 * top / 3), top];
    let out = ticks.map(v => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="#E4E1DD"/><text x="${P.l - 6}" y="${y(v) + 4}" font-size="11" text-anchor="end" fill="#6E7C8C">${v}</text>`).join('');
    cols.forEach((counts, i) => {
      const x = P.l + slot * i + (slot - bw) / 2;
      let acc = 0;
      counts.forEach((n, s) => {
        if (!n) return;
        const y0 = y(acc), y1 = y(acc + n);
        out += `<rect x="${x}" y="${y1}" width="${bw}" height="${Math.max(0, y0 - y1 - 1)}" fill="${STAGES[s].color}"><title>${names[i]}: ${STAGES[s].label} ${n}</title></rect>`;
        acc += n;
      });
      const hab = counts[3] + counts[4];
      if (y(acc - hab) - y(acc) >= 18) out += `<text x="${x + bw / 2}" y="${y(acc - hab / 2) + 4}" font-size="11.5" text-anchor="middle" fill="#fff" font-weight="600">${hab}</text>`;
      out += `<text x="${x + bw / 2}" y="${H - 8}" font-size="11.5" text-anchor="middle" fill="#3B5068" font-weight="${i === cols.length - 1 ? 600 : 400}">${names[i]}</text>`;
    });
    return `<svg width="100%" viewBox="0 0 ${W} ${H}" role="img" aria-label="Habit stages by month">${out}</svg>`;
  }
}
