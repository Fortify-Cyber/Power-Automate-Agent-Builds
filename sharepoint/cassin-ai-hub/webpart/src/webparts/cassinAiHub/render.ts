import type { IAgent, IFaq, IFeedback, IPrompt, ITip, IVideo } from './data';

// HTML for each hub section, ported from the mockup. Everything taken from a list goes
// through esc(): list items are written by staff (prompts, feedback), so treat them as text.
export const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);

// Only http(s) links are rendered as links, so a list value can't become a script URL.
const safeUrl = (u: string | undefined): string => (/^https?:\/\//i.test(u || '') ? esc(u) : '');

const longDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const pillClass = (s: string): string => 's-' + (s || '').replace(/[^A-Za-z]/g, '');

function groupBy<T>(rows: T[], key: (r: T) => string): Array<[string, T[]]> {
  const map = new Map<string, T[]>();
  rows.forEach(r => {
    const k = key(r) || 'Other';
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  });
  return Array.from(map.entries());
}

const copyBtn = (text: string, label = 'Copy prompt'): string =>
  `<button class="btn" type="button" data-copy="${esc(text)}">${label}</button>`;

function watchBtn(url: string | undefined, label = '▶ Watch', ghost = true): string {
  const href = safeUrl(url);
  return href ? `<a class="btn${ghost ? ' ghost' : ''}" href="${href}" target="_blank" rel="noopener">${esc(label)}</a>` : '';
}

export function empty(text: string): string {
  return `<div class="empty">${esc(text)}</div>`;
}

// ---- Prompts ---------------------------------------------------------------

export function promptCard(p: IPrompt, clamp = false): string {
  return `<article class="card">
    <h4>${esc(p.Title)}</h4>
    <div class="meta"><span class="chip">${esc(p.Category)}</span>${p.WorksIn.map(w => `<span class="chip n">${esc(w)}</span>`).join('')}</div>
    <p class="prompt">${clamp ? `<span class="clamp">${esc(p.PromptText)}</span>` : esc(p.PromptText)}</p>
    ${p.HowToUse || p.WatchOuts ? `<details class="more"><summary>How to use it</summary>
      ${p.HowToUse ? `<p>${esc(p.HowToUse)}</p>` : ''}
      ${p.WatchOuts ? `<p><strong>Check before you rely on it:</strong> ${esc(p.WatchOuts)}</p>` : ''}</details>` : ''}
    <div class="foot row">${copyBtn(p.PromptText)}<span style="font-size:13px;color:var(--faint)">${esc(p.Practice)}</span></div>
  </article>`;
}

export function featuredPrompts(prompts: IPrompt[], libraryUrl: string, max: number): string {
  const featured = prompts.filter(p => p.Featured).slice(0, max);
  if (!featured.length) return empty('No featured prompts yet. Tick Featured on a prompt in the Prompt Library.');
  return `<div class="grid">${featured.map(p => promptCard(p, true)).join('')}</div>
    <p style="margin-top:14px"><a href="${esc(libraryUrl)}">See all ${prompts.length} prompts →</a></p>`;
}

export interface IPromptFilter { q: string; cat: string }

export function promptLibraryShell(prompts: IPrompt[], f: IPromptFilter): string {
  const cats = ['All', ...Array.from(new Set(prompts.map(p => p.Category).filter(Boolean)))];
  return `<div class="toolbar"><input type="search" data-search placeholder="Search prompts (try: title, loan, email)" aria-label="Search prompts" value="${esc(f.q)}"></div>
    <div class="toolbar" role="group" aria-label="Filter by category">${cats.map(c =>
      `<button type="button" class="filter${c === f.cat ? ' on' : ''}" data-cat="${esc(c)}" aria-pressed="${c === f.cat}">${esc(c)}</button>`).join('')}</div>
    <div data-results>${promptResults(prompts, f)}</div>`;
}

export function promptResults(prompts: IPrompt[], f: IPromptFilter): string {
  const q = f.q.trim().toLowerCase();
  const rows = prompts.filter(p => (f.cat === 'All' || p.Category === f.cat) &&
    (!q || `${p.Title} ${p.PromptText} ${p.Practice} ${p.WorksIn.join(' ')}`.toLowerCase().includes(q)));
  if (!rows.length) return empty('No prompts match. Try another word, or submit one.');
  return groupBy(rows, p => p.Category).map(([g, ps]) =>
    `<h3 class="group">${esc(g)} (${ps.length})</h3><div class="grid">${ps.map(p => promptCard(p)).join('')}</div>`).join('');
}

// ---- Friday tips -----------------------------------------------------------

const steps = (s: string): string[] => (s || '').split(/\r?\n/).map(x => x.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);

export function tipCard(t: ITip): string {
  const list = steps(t.Steps);
  return `<article class="tip"><div class="num"><span>Tip</span><b>${esc(t.TipNumber ?? '')}</b><span>${t.TipDate ? shortDate(t.TipDate) : ''}</span></div>
    <div><div class="eyebrow">${t.TipDate ? longDate(t.TipDate) : ''}${t.WorksWith ? ' · ' + esc(t.WorksWith) : ''}</div>
    <h3>${esc(t.Title)}</h3>${t.WhyItHelps ? `<p>${esc(t.WhyItHelps)}</p>` : ''}
    ${list.length ? `<h5>Try it</h5><ol>${list.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
    ${t.TipPrompt ? `<h5>Copy and paste this into Copilot</h5><p class="prompt">${esc(t.TipPrompt)}</p>` : ''}
    <div class="row">${t.TipPrompt ? copyBtn(t.TipPrompt) : ''}
      ${watchBtn(t.VideoLink?.Url, t.VideoLink?.Description ? `▶ Watch: ${t.VideoLink.Description}` : undefined)}
      ${safeUrl(t.ArticleLink?.Url) ? `<a class="btn ghost" href="${safeUrl(t.ArticleLink?.Url)}" target="_blank" rel="noopener">Read more</a>` : ''}</div>
    </div></article>`;
}

export function allTips(tips: ITip[]): string {
  return tips.length ? tips.map(tipCard).join('') : empty('No tips yet.');
}

export function latestTip(tips: ITip[], tipsPageUrl: string): string {
  const t = tips[0];
  if (!t) return empty('No tips yet.');
  return `<div class="compact"><div class="eyebrow">Tip ${esc(t.TipNumber ?? '')}${t.TipDate ? ' · ' + longDate(t.TipDate) : ''}</div>
    <h4>${esc(t.Title)}</h4>${t.WhyItHelps ? `<p style="font-size:15px">${esc(t.WhyItHelps)}</p>` : ''}
    ${t.TipPrompt ? `<p class="prompt"><span class="clamp">${esc(t.TipPrompt)}</span></p>` : ''}
    <div class="row">${t.TipPrompt ? copyBtn(t.TipPrompt) : ''}${watchBtn(t.VideoLink?.Url)}</div>
    <p style="margin:12px 0 0;font-size:14px"><a href="${esc(tipsPageUrl)}">See all tips →</a></p></div>`;
}

// ---- Videos, agents, FAQ, feedback ----------------------------------------

export function videos(rows: IVideo[]): string {
  if (!rows.length) return empty('No videos yet.');
  return groupBy(rows, v => v.App).map(([app, vs]) => `<h3 class="group">${esc(app)}</h3><div class="grid">${vs.map(v => `<article class="card">
    <div class="meta">${v.SkillLevel ? `<span class="chip">${esc(v.SkillLevel)}</span>` : ''}${v.VideoSource ? `<span class="chip n">From ${esc(v.VideoSource)}</span>` : ''}</div>
    <h4>${esc(v.Title)}</h4>${v.VideoDescription ? `<p style="color:var(--muted);font-size:15px">${esc(v.VideoDescription)}</p>` : ''}
    <div class="foot row">${watchBtn(v.VideoLink?.Url, '▶ Watch', false)}</div></article>`).join('')}</div>`).join('');
}

export function agents(rows: IAgent[]): string {
  if (!rows.length) return empty('No agents listed yet.');
  return `<div class="grid">${rows.map(a => `<article class="card">
    <div class="meta"><span class="pill ${pillClass(a.AgentStatus)}">${esc(a.AgentStatus)}</span></div>
    <h4>${esc(a.Title)}</h4>${a.WhatItDoes ? `<p style="font-size:15px">${esc(a.WhatItDoes)}</p>` : ''}
    ${a.HowToStart ? `<p style="font-size:15px;color:var(--muted)"><strong style="color:var(--navy)">How to start:</strong> ${esc(a.HowToStart)}</p>` : ''}
    <p class="foot" style="font-size:13px;color:var(--faint);margin:0">Champion: ${esc(a.Champion || 'to be named')}</p></article>`).join('')}</div>`;
}

export function faq(rows: IFaq[]): string {
  if (!rows.length) return empty('No questions yet.');
  return groupBy(rows, f => f.Topic).map(([t, qs]) => `<h3 class="group">${esc(t)}</h3>${qs.map(f =>
    `<details class="faq"><summary>${esc(f.Title)}</summary><p>${esc(f.Answer)}</p></details>`).join('')}`).join('');
}

export function myFeedback(rows: IFeedback[]): string {
  if (!rows.length) return empty("You haven't sent any feedback yet.");
  return `<table class="list"><thead><tr><th>Summary</th><th>Type</th><th>About</th><th>Status</th><th>Our response</th><th>Sent</th></tr></thead><tbody>${rows.map(f =>
    `<tr><td>${esc(f.Title)}</td><td>${esc(f.FeedbackType)}</td><td>${esc(f.About)}</td>
      <td><span class="pill ${pillClass(f.FeedbackStatus)}">${esc(f.FeedbackStatus || 'New')}</span></td>
      <td>${f.Response ? esc(f.Response) : '<span style="color:var(--faint)">–</span>'}</td><td>${shortDate(f.Created)}</td></tr>`).join('')}</tbody></table>`;
}
