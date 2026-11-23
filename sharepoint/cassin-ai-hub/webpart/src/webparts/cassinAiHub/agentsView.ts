import type { AdoptionError } from './adoptionData';
import type { IAgentRow, IAgentsView } from './agentsModel';
import { esc } from './render';

// The admin "Agent usage" page: which agents are used, how often, who built them, and the
// time they save. Every value from Microsoft or a list goes through esc().

const longDate = (d: string): string => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const shortDate = (d: string): string => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const n = (v: number): string => Math.round(v).toLocaleString('en-US');
/** Minutes as hours, e.g. "12.5 h"; under an hour as minutes. */
const hours = (min: number): string => (min < 60 ? `${n(min)} min` : `${(min / 60).toLocaleString('en-US', { maximumFractionDigits: min < 600 ? 1 : 0 })} h`);

type SortKey = 'runs28' | 'runsAll' | 'saved' | 'name';

export class AgentsView {
  private _root: HTMLElement | undefined;
  private _open = new Set<string>();
  private _sort: { key: SortKey; dir: number } = { key: 'runs28', dir: -1 };
  private _searching = false;

  public constructor(private _v: IAgentsView, private _problem: AdoptionError | null,
                     private readonly _links: { savingsUrl: string; savingsMissing: boolean }, searching: boolean) {
    this._searching = searching;
  }

  public html(): string {
    return `<div class="ad ag">
      <div class="ad-head"><div class="ad-lock">🔒 Visible to AI Hub Admins only</div></div>
      ${this._status()}
      ${this._v.rows.length ? this._tiles() + this._table() : this._empty()}
      ${this._note()}
    </div>`;
  }

  public mount(root: HTMLElement): void {
    this._root = root;
  }

  /** After this visit's audit search: the new counts (or null: keep what's shown) and any problem. */
  public update(v: IAgentsView | null, problem: AdoptionError | null): void {
    this._searching = false;
    if (v) this._v = v;
    this._problem = problem;
    this._redraw();
  }

  public onClick(e: Event): boolean {
    const t = e.target as HTMLElement;
    const sort = t.closest<HTMLElement>('[data-ag-sort]');
    if (sort) {
      const key = sort.getAttribute('data-ag-sort') as SortKey;
      this._sort = { key, dir: this._sort.key === key ? -this._sort.dir : (key === 'name' ? 1 : -1) };
      this._redraw(); return true;
    }
    const row = t.closest<HTMLElement>('[data-ag-row]');
    if (row) {
      const key = row.getAttribute('data-ag-row') || '';
      if (this._open.has(key)) this._open.delete(key); else this._open.add(key);
      this._redraw(); return true;
    }
    return false;
  }

  private _redraw(): void {
    const el = this._root?.querySelector<HTMLElement>('.ag');
    if (el) el.outerHTML = this.html();
  }

  private _status(): string {
    const v = this._v, out: string[] = [];
    if (this._problem) {
      const why = this._problem.kind === 'consent'
        ? "This page can't search Microsoft's audit log yet. A SharePoint admin needs to approve the web part's AuditLogsQuery.Read.All permission: SharePoint admin center → Advanced → API access."
        : this._problem.kind === 'role'
        ? "Your account can't search Microsoft's audit log, so it can't add newer figures. The AI Admin account (or anyone with Purview's Audit Reader role) refreshes them when it opens this page."
        : "Microsoft's audit log couldn't be searched on this visit. The page tries again next time.";
      out.push(`<div class="ad-warn">${why}${this._problem.message ? `<p class="detail">Microsoft's reply: <code>${esc(this._problem.message.slice(0, 300))}</code></p>` : ''}</div>`);
    }
    if (this._links.savingsMissing) {
      out.push('<div class="ad-warn">The Agent Time Savings list isn\'t on this site yet, so time saved and "built by" can\'t be shown. Run the deploy script again to add it.</div>');
    }
    const pending = v.pending;
    if (this._searching) {
      out.push(`<div class="ad-info">Searching Microsoft's audit log for ${pending ? `${shortDate(pending.start)} to ${longDate(pending.end)}` : 'newer days'}. This can take a few minutes; if it takes longer, the results appear the next time this page is opened.</div>`);
    } else if (pending) {
      out.push(`<div class="ad-info">Microsoft is still searching the audit log for ${shortDate(pending.start)} to ${longDate(pending.end)}. Those days are added the next time this page is opened by an account that can search the audit log (such as AI Admin).</div>`);
    }
    return out.join('');
  }

  private _empty(): string {
    if (!this._v.through && this._v.recountFrom) {
      return `<div class="ad-info">Agent use is being recounted from ${longDate(this._v.recountFrom)}, with agents that Microsoft lists under more than one id combined and conversations Microsoft logs twice counted once. The figures appear when Microsoft's audit search finishes: on this visit if it's quick, otherwise the next time an account that can search the audit log (such as AI Admin) opens this page.</div>`;
    }
    if (!this._v.through) {
      return '<div class="ad-info">No agent use counted yet. The first count covers the last 30 days and starts the first time an account that can search Microsoft\'s audit log (such as AI Admin) opens this page.</div>';
    }
    return `<div class="ad-info">No one used a Copilot agent between ${longDate(this._v.since || this._v.through)} and ${longDate(this._v.through)}.</div>`;
  }

  private _tiles(): string {
    const v = this._v;
    const tile = (k: string, val: string, sub: string, accent = false): string =>
      `<div class="ad-tile${accent ? ' accent' : ''}"><div class="k">${k}</div><div class="v">${val}</div><div class="s">${sub}</div></div>`;
    return `<div class="ad-tiles">
      ${tile('Agent runs, last 28 days', n(v.runs28), `${v.people28} ${v.people28 === 1 ? 'person' : 'people'}, ${v.agents28} agent${v.agents28 === 1 ? '' : 's'}`)}
      ${tile('Time saved, last 28 days', hours(v.saved28), 'Estimate: runs × minutes per run', true)}
      ${tile(`Time saved since ${v.since ? shortDate(v.since) : 'counting began'}`, hours(v.savedAll), `${n(v.runsAll)} runs in all`, true)}
      ${tile('Agents used', String(v.rows.length), v.noMinutes ? `${v.noMinutes} without a time estimate yet` : 'All have a time estimate')}
    </div>`;
  }

  private _table(): string {
    const v = this._v;
    const val = (r: IAgentRow): number | string => {
      switch (this._sort.key) {
        case 'name': return r.name.toLowerCase();
        case 'runsAll': return r.runsAll;
        case 'saved': return r.savedAll ?? -1;
        default: return r.runs28;
      }
    };
    const rows = [...v.rows].sort((a, b) => { const x = val(a), y = val(b); return x > y ? this._sort.dir : x < y ? -this._sort.dir : b.runsAll - a.runsAll; });
    const th = (k: SortKey, label: string, cls = 'n'): string =>
      `<th data-ag-sort="${k}" class="sort ${cls}${this._sort.key === k ? ' on' : ''}">${label}</th>`;
    const since = v.since ? shortDate(v.since) : 'start';
    const body = rows.map(r => {
      const open = this._open.has(r.key);
      const main = `<tr class="click" data-ag-row="${esc(r.key)}" aria-expanded="${open}">
        <td><span class="caret">${open ? '▾' : '▸'}</span> ${esc(r.name)}</td>
        <td>${r.builtBy ? esc(r.builtBy) : '<span class="faint">Not set</span>'}</td>
        <td class="n">${n(r.runs28)}</td><td class="n">${r.people28}</td>
        <td>${this._spark(r.weekly)}</td>
        <td>${r.lastUsed ? shortDate(r.lastUsed) : '–'}</td>
        <td class="n">${n(r.runsAll)}</td>
        <td class="n">${r.minutes === null ? '<span class="faint">–</span>' : n(r.minutes)}</td>
        <td class="n">${r.savedAll === null ? '<span class="faint">Add minutes</span>' : `<b>${hours(r.savedAll)}</b>`}</td></tr>`;
      if (!open) return main;
      const people = r.users.slice(0, 50).map(u => `<li><span>${esc(u.name || u.upn)}</span><span class="faint">${n(u.runs28)} in 28 days · ${n(u.runsAll)} in all</span></li>`).join('');
      return `${main}<tr class="ag-detail"><td colspan="9"><div class="ag-people"><b>Who uses it</b> <span class="faint">(${r.users.length})</span><ul>${people}</ul>${r.users.length > 50 ? '<p class="faint">Top 50 shown.</p>' : ''}</div></td></tr>`;
    }).join('');
    return `<div class="ad-panel"><h3>Agents <span class="count">(${v.rows.length})</span></h3>
      <p class="hint">Each conversation with an agent counts as one run. Select an agent to see who uses it. Time saved is runs × the agent's minutes per run.</p>
      <div class="scroll"><table class="ag-table"><thead><tr>
        ${th('name', 'Agent', '')}<th>Built by</th>${th('runs28', 'Runs, 28 days')}<th class="n">People</th><th>Last 8 weeks</th><th>Last used</th>
        ${th('runsAll', `Runs since ${since}`)}<th class="n">Min per run</th>${th('saved', 'Time saved')}
      </tr></thead><tbody>${body}</tbody></table></div></div>`;
  }

  private _spark(w: number[]): string {
    const max = Math.max(1, ...w), H = 20;
    return `<svg width="${w.length * 9}" height="${H}" viewBox="0 0 ${w.length * 9} ${H}" aria-label="Runs per week, last 8 weeks">${w.map((v, i) => {
      const h = v ? Math.max(2, Math.round(H * v / max)) : 1;
      return `<rect x="${i * 9}" y="${H - h}" width="7" height="${h}" fill="${v ? '#2A73B0' : '#E1E5EA'}"><title>${n(v)} runs</title></rect>`;
    }).join('')}</svg>`;
  }

  private _note(): string {
    const v = this._v;
    return `<p class="ad-note">Source: Microsoft Purview's audit log of Copilot use, through Microsoft Graph${v.through ? `, counted up to ${longDate(v.through)}` : ''}. Microsoft's log runs a day or two behind, and new days are added when an account that can search it (such as AI Admin) opens this page. A run counts once the agent answers: Microsoft doesn't record whether an agent's task was finished.
      Time saved is an estimate: the minutes per run and "built by" come from the admin-only <a href="${esc(this._links.savingsUrl)}">Agent Time Savings list</a>, where you can change them (a change applies to every run counted). Agents seen for the first time are added to that list for you to fill in.
      Everything stays in Cassin's Microsoft 365. This page counts use only; it never reads what anyone asks an agent.</p>`;
  }
}
