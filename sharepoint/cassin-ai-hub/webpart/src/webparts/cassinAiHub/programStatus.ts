import type { IFeedbackItem, IRoadmapItem, IWaiting } from './data';
import { esc } from './render';

// The AI Working Group's Program status page: the roadmap (by stage, by track, all items),
// what Fortify is waiting on from Cassin, and feedback to triage. Moved from the Notion page
// "Cassin & Cassin × Fortify — AI Program Status". Read from three lists that only site owners
// and members can open (Hub Feedback is the firm's own form; owners and members see every item).

export const STAGES = ['Scoping', 'Building', 'Pilot', 'Firm rollout', 'Live'];
export const TRACKS = ['Quick Wins', 'Big Bets', 'Fill-ins', 'Not Now'];
const OPEN_FEEDBACK = ['New', 'Reviewing', 'Planned', ''];
const CONFIDENCE: Record<string, string> = { 'On track': 'ok', 'At risk': 'risk', Slipped: 'slip' };
const STAGE_COLOR: Record<string, string> = { Scoping: '#E1E5EA', Building: '#E4DCF5', Pilot: '#D6E9F8', 'Firm rollout': '#BFE3CB', Live: '#D7F0DD' };

type Tab = 'stage' | 'track' | 'all' | 'waiting' | 'feedback';

export interface IListLinks { roadmap: string; waiting: string; feedback: string }

const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const safeUrl = (u: string | undefined): string => (/^https?:\/\//i.test(u || '') ? esc(u) : '');
const isOpenFeedback = (f: IFeedbackItem): boolean => OPEN_FEEDBACK.indexOf(f.FeedbackStatus || '') >= 0;

export class ProgramStatusView {
  private _tab: Tab = 'stage';
  private _showDoneWaiting = false;
  private _showClosedFeedback = false;
  private _root: HTMLElement | undefined;

  public constructor(private readonly _items: IRoadmapItem[], private readonly _waiting: IWaiting[],
                     private readonly _feedback: IFeedbackItem[], private readonly _links: IListLinks,
                     /** Owners and members, who can edit the lists and see every feedback item. The
                      * read-only AI Working Group group sees the roadmap but not others' feedback. */
                     private readonly _canManage: boolean = true,
                     private readonly _today: string = new Date().toISOString().slice(0, 10)) {}

  /** Open feedback for a roadmap item, matched on the Feedback form's "About" value. */
  private _openFeedback(item: IRoadmapItem): number {
    const name = (item.FeedbackAs || item.Title).toLowerCase();
    return this._feedback.filter(f => isOpenFeedback(f) && (f.About || '').toLowerCase() === name).length;
  }

  public html(): string {
    const openWaiting = this._waiting.filter(w => w.WaitingStatus !== 'Done').length;
    const openFeedback = this._feedback.filter(isOpenFeedback).length;
    const tabs: Array<[Tab, string]> = [['stage', 'By stage'], ['track', 'By track'], ['all', 'All items'],
      ['waiting', `Waiting on Cassin (${openWaiting})`]];
    // Feedback is private to the sender and the site owners (the Feedback page says so), so
    // read-only working group members don't get the tab.
    if (this._canManage) tabs.push(['feedback', `Feedback (${openFeedback})`]);
    const count = (s: string): number => this._items.filter(i => i.RoadmapStage === s).length;
    const unpublished = this._items.filter(i => (i.RoadmapStage === 'Firm rollout' || i.RoadmapStage === 'Live') && !i.PublishedLink?.Url);
    return `<div class="ad ps">
      <div class="ad-tiles five">${STAGES.map(s => `<div class="ad-tile stage" style="--c:${STAGE_COLOR[s]}"><div class="k">${s}</div><div class="v">${count(s)}</div></div>`).join('')}</div>
      ${unpublished.length && this._canManage ? `<div class="ad-warn"><b>Ready for the hub?</b> ${unpublished.map(i => esc(i.Title)).join(', ')} ${unpublished.length === 1 ? 'is' : 'are'} at Firm rollout or Live with no <i>Published on hub</i> link. Add ${unpublished.length === 1 ? 'it' : 'them'} to Agents &amp; Tools, the Prompt Library or a tip, then paste that link into the roadmap item.</div>` : ''}
      <div class="ad-head"><div class="ad-lock">🔒 AI Working Group only</div>
        <div class="ad-tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" data-ps-tab="${k}" aria-selected="${k === this._tab}" class="${k === this._tab ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <section data-ps-view="stage">${this._board('RoadmapStage', STAGES)}${this._edit(this._links.roadmap, 'Edit the roadmap')}</section>
      <section data-ps-view="track" hidden>${this._board('Track', TRACKS)}${this._edit(this._links.roadmap, 'Edit the roadmap')}</section>
      <section data-ps-view="all" hidden>${this._table()}${this._edit(this._links.roadmap, 'Edit the roadmap')}</section>
      <section data-ps-view="waiting" hidden><div data-ps-waiting></div>${this._edit(this._links.waiting, 'Add or update items')}</section>
      ${this._canManage ? `<section data-ps-view="feedback" hidden><div data-ps-feedback></div>${this._edit(this._links.feedback, 'Open the feedback list')}</section>` : ''}
    </div>`;
  }

  public mount(root: HTMLElement): void {
    this._root = root;
    this._renderWaiting();
    this._renderFeedback();
  }

  public onClick(e: Event): boolean {
    const t = e.target as HTMLElement;
    const tab = t.closest<HTMLElement>('[data-ps-tab]');
    if (tab) {
      this._tab = tab.getAttribute('data-ps-tab') as Tab;
      this._root?.querySelectorAll<HTMLElement>('[data-ps-tab]').forEach(b => {
        const on = b === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on));
      });
      this._root?.querySelectorAll<HTMLElement>('[data-ps-view]').forEach(v => { v.hidden = v.getAttribute('data-ps-view') !== this._tab; });
      return true;
    }
    const toggle = t.closest<HTMLElement>('[data-ps-toggle]');
    if (toggle) {
      if (toggle.getAttribute('data-ps-toggle') === 'waiting') { this._showDoneWaiting = !this._showDoneWaiting; this._renderWaiting(); }
      else { this._showClosedFeedback = !this._showClosedFeedback; this._renderFeedback(); }
      return true;
    }
    return false;
  }

  private _edit(url: string, label: string): string {
    return this._canManage ? `<p class="manage"><a href="${esc(url)}">${label} →</a></p>` : '';
  }

  private _pill(text: string, cls: string): string {
    return text ? `<span class="ps-pill ${cls}">${esc(text)}</span>` : '';
  }

  private _card(i: IRoadmapItem, by: 'RoadmapStage' | 'Track'): string {
    const fb = this._canManage ? this._openFeedback(i) : 0;
    const other = by === 'RoadmapStage' ? this._pill(i.Track, 'track') : this._pill(i.RoadmapStage, 'stage');
    const facts = [
      i.TargetWindow && i.TargetWindow !== 'n/a' ? `<div><dt>Target</dt><dd>${esc(i.TargetWindow)}</dd></div>` : '',
      i.TimeSaved ? `<div><dt>Saves</dt><dd>${esc(i.TimeSaved)}</dd></div>` : '',
      `<div><dt>Champion</dt><dd>${esc(i.Champion && i.Champion !== 'TBD' ? i.Champion : 'TBD')}</dd></div>`
    ].join('');
    const video = safeUrl(i.DemoVideo?.Url);
    const published = safeUrl(i.PublishedLink?.Url);
    return `<article class="ps-card">
      <h4>${esc(i.Title)}</h4>
      <div class="ps-tags">${other}${this._pill(i.Confidence, CONFIDENCE[i.Confidence] || '')}${i.ItemType.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>
      <dl>${facts}</dl>
      ${i.NextUp ? `<p class="ps-next"><b>Next up:</b> ${esc(i.NextUp)}</p>` : ''}
      ${fb ? `<p class="ps-fb">${fb} open feedback</p>` : ''}
      ${i.RoadmapNotes ? `<details><summary>Notes</summary><p>${esc(i.RoadmapNotes)}</p></details>` : ''}
      ${video || published ? `<p class="ps-links">${video ? `<a href="${video}" target="_blank" rel="noopener">▶ Demo</a>` : ''}${published ? `<a href="${published}">On the hub →</a>` : ''}</p>` : ''}
    </article>`;
  }

  private _board(by: 'RoadmapStage' | 'Track', columns: string[]): string {
    const known = new Set(columns);
    const extra = this._items.filter(i => !known.has(i[by]));
    const cols = extra.length ? [...columns, 'Not set'] : columns;
    return `<div class="ps-board" style="--cols:${cols.length}">${cols.map(c => {
      const items = c === 'Not set' ? extra : this._items.filter(i => i[by] === c);
      return `<div class="ps-col"><div class="ps-col-head"><span>${esc(c)}</span><span class="count">${items.length}</span></div>
        ${items.map(i => this._card(i, by)).join('') || '<p class="faint">Nothing here.</p>'}</div>`;
    }).join('')}</div>`;
  }

  private _table(): string {
    const rows = [...this._items].sort((a, b) =>
      (TRACKS.indexOf(a.Track) + 10) % 10 - (TRACKS.indexOf(b.Track) + 10) % 10 || a.Title.localeCompare(b.Title));
    return `<div class="ad-panel"><div class="scroll"><table><thead><tr><th>Item</th><th>Type</th><th>Home</th><th>Track</th><th>Stage</th>
      <th>Est. time saved</th><th>Target window</th><th>Confidence</th><th>Champion</th>${this._canManage ? '<th class="n">Open feedback</th>' : ''}<th>Next up</th><th>Notes</th></tr></thead><tbody>
      ${rows.map(i => `<tr><td><b>${esc(i.Title)}</b></td><td>${esc(i.ItemType.join(', '))}</td><td>${esc(i.HomeArea.join(', '))}</td>
        <td>${esc(i.Track)}</td><td>${this._pill(i.RoadmapStage, 'stage')}</td><td>${esc(i.TimeSaved)}</td><td>${esc(i.TargetWindow)}</td>
        <td>${this._pill(i.Confidence, CONFIDENCE[i.Confidence] || '')}</td><td>${esc(i.Champion)}</td>${this._canManage ? `<td class="n">${this._openFeedback(i) || ''}</td>` : ''}
        <td class="wide">${esc(i.NextUp)}</td><td class="wide">${i.RoadmapNotes ? `<details><summary>Show</summary><p>${esc(i.RoadmapNotes)}</p></details>` : ''}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  }

  private _renderWaiting(): void {
    const el = this._root?.querySelector('[data-ps-waiting]');
    if (!el) return;
    const rows = this._waiting.filter(w => this._showDoneWaiting || w.WaitingStatus !== 'Done')
      .sort((a, b) => (a.DueDate || '9999').localeCompare(b.DueDate || '9999') || a.Id - b.Id);
    const done = this._waiting.length - this._waiting.filter(w => w.WaitingStatus !== 'Done').length;
    el.innerHTML = `<div class="ad-panel"><h3>Waiting on Cassin</h3>
      <p class="hint">What Fortify needs from Cassin to keep the roadmap moving. Give each item an owner and a due date.</p>
      <div class="scroll"><table><thead><tr><th>Item</th><th>Owner</th><th>Roadmap items</th><th>Due</th><th>Status</th><th>Notes</th></tr></thead><tbody>
      ${rows.map(w => {
        const overdue = !!w.DueDate && w.WaitingStatus !== 'Done' && w.DueDate.slice(0, 10) < this._today;
        return `<tr><td class="wide">${esc(w.Title)}</td><td>${w.WaitingOwner?.Title ? esc(w.WaitingOwner.Title) : '<span class="faint">Not set</span>'}</td>
          <td>${(w.RoadmapItems || []).map(r => `<span class="chip">${esc(r.Title)}</span>`).join('')}</td>
          <td class="${overdue ? 'overdue' : ''}">${w.DueDate ? shortDate(w.DueDate) + (overdue ? ' (overdue)' : '') : '<span class="faint">–</span>'}</td>
          <td>${this._pill(w.WaitingStatus || 'Open', 'w-' + (w.WaitingStatus || 'Open').replace(/\s/g, ''))}</td><td>${esc(w.WaitingNotes)}</td></tr>`;
      }).join('') || '<tr><td colspan="6" class="faint">Nothing outstanding.</td></tr>'}
      </tbody></table></div>
      ${done ? `<p><button type="button" class="btn ghost" data-ps-toggle="waiting">${this._showDoneWaiting ? 'Hide done items' : `Show ${done} done`}</button></p>` : ''}</div>`;
  }

  private _renderFeedback(): void {
    const el = this._root?.querySelector('[data-ps-feedback]');
    if (!el) return;
    const rows = this._feedback.filter(f => this._showClosedFeedback || isOpenFeedback(f));
    const closed = this._feedback.length - this._feedback.filter(isOpenFeedback).length;
    el.innerHTML = `<div class="ad-panel"><h3>Feedback</h3>
      <p class="hint">Everything sent through the hub's Feedback page, newest first. Set Status and <i>Our response</i> in the list; the sender sees both.</p>
      <div class="scroll"><table><thead><tr><th>Summary</th><th>About</th><th>Rating</th><th>Details</th><th>From</th><th>Status</th><th>Sent</th><th>Our response</th></tr></thead><tbody>
      ${rows.map(f => `<tr><td><b>${esc(f.Title)}</b></td><td>${esc(f.About)}</td><td>${esc(f.Rating)}</td>
        <td class="wide">${f.Details ? `<details><summary>${esc(f.FeedbackType || 'Details')}</summary><p>${esc(f.Details)}</p></details>` : ''}</td>
        <td>${esc(f.Author?.Title || '')}</td><td>${this._pill(f.FeedbackStatus || 'New', 'f-' + (f.FeedbackStatus || 'New').replace(/[^A-Za-z]/g, ''))}</td>
        <td>${f.Created ? shortDate(f.Created) : ''}</td><td class="wide">${esc(f.Response)}${f.DoneOn ? ` <span class="faint">(${shortDate(f.DoneOn)})</span>` : ''}</td></tr>`).join('') ||
        '<tr><td colspan="8" class="faint">No open feedback.</td></tr>'}
      </tbody></table></div>
      ${closed ? `<p><button type="button" class="btn ghost" data-ps-toggle="feedback">${this._showClosedFeedback ? 'Hide done' : `Show ${closed} done or won't do`}</button></p>` : ''}</div>`;
  }
}
