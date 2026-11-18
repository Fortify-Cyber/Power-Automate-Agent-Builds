import type { MSGraphClientFactory, MSGraphClientV3, SPHttpClient } from '@microsoft/sp-http';
import { SPHttpClient as Http } from '@microsoft/sp-http';

import {
  buildAdoption, cleanStored, currentRows, makeSnapshot, parseCsv, parseTrend, parseUsage,
  type IAdoption, type IDirectoryUser, type ISnapshot, type IStoredAdoption, type IUsageReport, type ITrendPoint, type Row
} from './adoptionModel';
import { buildCredits, parseBalance, parseServiceRecords, parseUserRecords, sumUsers, type ICreditsRaw, type ICreditsView } from './creditsModel';

// Everything the adoption page reads, all inside Cassin's Microsoft 365:
//  - Microsoft Graph, as the signed-in person: the Copilot usage reports (Reports.Read.All)
//    and names and job titles from Entra ID (User.Read.All). Both permissions are approved
//    once by a SharePoint admin (SharePoint admin center → Advanced → API access). Microsoft
//    only answers the reports call for accounts with a reports role in Entra ID.
//  - Microsoft Graph (beta) Copilot Cost Management API, as the signed-in person: Copilot
//    credits per service per day (Cowork, Work IQ, ...), per person, and the credit balance
//    (CopilotCostManagement.Read.All, approved the same way). Optional: if it fails, only the
//    Credits tab says so.
//  - The admin-only "Copilot Adoption History" list on this site (owners and AI Hub Admins):
//    one snapshot a month, so the month-by-month views fill in over time, and a "latest" item
//    whose attachment holds the current figures. When someone whose account can read the
//    reports opens the page, it refreshes that copy; everyone else who can open the page sees
//    the copy, so nobody else needs a role in Entra ID. Access is the site's own groups.
// Nothing is sent anywhere else.

export const HISTORY_LIST = 'Lists/CopilotAdoptionHistory';

// The web part compiles to ES5, where a subclass of Error loses its prototype (instanceof
// fails), so restore it; the web part also checks `kind` rather than relying on instanceof.
export class AdoptionError extends Error {
  public readonly isAdoptionError = true;
  public constructor(message: string, public readonly kind: 'consent' | 'role' | 'nodata' | 'other') {
    super(message);
    Object.setPrototypeOf(this, AdoptionError.prototype);
  }
}

const REPORTS = '/copilot/reports';
const LATEST = 'latest';
const LATEST_FILE = 'latest.json';

export interface IAdoptionLoad {
  model: IAdoption;
  /** This month's history snapshot was saved on this visit. */
  saved: boolean;
  /** "live" = read from Microsoft as this viewer; "stored" = the copy saved for admins. */
  source: 'live' | 'stored';
  /** When the copy was saved (stored), or whether this visit refreshed it (live). */
  savedAt?: string;
  shared: boolean;
  /** Live only: the Copilot credits, read after the rest of the page is shown (they take
   *  dozens of calls). Resolves to null when there's nothing newer to show; never rejects. */
  credits?: Promise<ICreditsView | null>;
}

interface ILive { usage28: IUsageReport; usage180: IUsageReport | null; trend: ITrendPoint[]; directory: IDirectoryUser[]; credits: ICreditsRaw | null }

// Time limits, so a slow or stuck answer from Microsoft can never leave the page on "Loading…".
const CALL_MS = 45e3;        // one Graph call
const REPORTS_MS = 90e3;     // the usage reports and directory together (else: the saved copy)
const CREDITS_MS = 150e3;    // all the credit calls together
const MAX_PAGES = 50;        // paging guard for any one list

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new AdoptionError(`${what} took longer than ${Math.round(ms / 1000)} seconds to answer`, 'other')), ms);
    p.then(v => { window.clearTimeout(t); resolve(v); }, e => { window.clearTimeout(t); reject(e); });
  });
}

const COST = '/copilot/costManagement';
const CREDIT_DAYS = 56;      // service usage: this 28 days and the 28 before
const CREDIT_USER_DAYS = 28; // per person: the last 28 days
/** Completed UTC days, oldest first, ending yesterday. */
function lastDays(n: number): string[] {
  const out: string[] = [];
  const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  for (let i = n; i >= 1; i--) out.push(new Date(today - i * 864e5).toISOString().slice(0, 10));
  return out;
}
const nextDay = (d: string): string => new Date(Date.parse(`${d}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
/** Runs `fn` over `items`, a few at a time, keeping Graph happy. */
async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  return out;
}

export class AdoptionData {
  private _graph: MSGraphClientV3 | undefined;

  public constructor(private readonly _factory: MSGraphClientFactory, private readonly _http: SPHttpClient,
                     private readonly _webUrl: string, private readonly _webRelUrl: string) {}

  public async load(): Promise<IAdoptionLoad> {
    const storedP = withTimeout(this._readLatest(), 30e3, 'SharePoint').catch(() => null);
    const snapshots = await withTimeout(this._snapshots(), 30e3, 'SharePoint').catch(() => [] as ISnapshot[]);
    let live: ILive;
    try {
      live = await withTimeout(this._live(), REPORTS_MS, "Microsoft's Copilot usage reports");
    } catch (err) {
      // This account can't read Microsoft's reports (or the call failed or timed out): show the
      // copy saved for admins when there is one.
      console.warn('Cassin AI Hub adoption: reading Microsoft live failed, using the saved copy', (err as Error)?.message);
      const stored = await storedP;
      if (stored) {
        const model = buildAdoption({ ...stored, snapshots });
        return { model, saved: false, source: 'stored', savedAt: stored.savedAt, shared: false };
      }
      const e = err as AdoptionError;
      if (e && e.isAdoptionError && (e.kind === 'role' || e.kind === 'consent')) throw new AdoptionError(e.message, 'nodata');
      throw err;
    }
    // Credits come later (see `credits` below); meanwhile the Credits tab shows the saved ones.
    const stored = await storedP;
    live.credits = stored?.credits || null;
    const model = buildAdoption({ ...live, snapshots });
    let saved = false, shared = false;
    const canSave = !!model.refresh && !model.namesHidden;
    if (canSave && model.hasDays) {
      saved = await withTimeout(this._saveSnapshot(makeSnapshot(currentRows(live.usage28.rows, live.directory), model.refresh as string, model.licensed), snapshots), 30e3, 'SharePoint').catch(err => {
        console.warn('Cassin AI Hub: could not save this month\'s adoption snapshot', err);
        return false;
      });
    }
    if (canSave) {
      shared = await withTimeout(this._saveLatest(live, model.refresh as string), 30e3, 'SharePoint').catch(err => {
        console.warn('Cassin AI Hub: could not save the figures for other admins', err);
        return false;
      });
    }
    if (/[?&]adoptionDebug=1/.test(window.location.search)) {
      console.info('Cassin AI Hub adoption: report fields', model.fields, 'daily prompts in trend:', model.hasDailyPrompts, model);
    }
    const credits = this._credits().then(async raw => {
      // A slow or failed read keeps the last good figures rather than replacing them with an error.
      if (raw.error === 'other' && stored?.credits && !stored.credits.error) return null;
      if (canSave) {
        await withTimeout(this._saveLatest({ ...live, credits: raw }, model.refresh as string, true), 30e3, 'SharePoint').catch(err => {
          console.warn('Cassin AI Hub: could not save the credits for other admins', err);
        });
      }
      return buildCredits(raw, live.directory);
    }).catch(err => { console.warn('Cassin AI Hub credits', err); return null; });
    return { model, saved, source: 'live', shared, credits };
  }

  private async _live(): Promise<ILive> {
    const [usage28, usage180, trend, directory] = await Promise.all([
      this._report(`${REPORTS}/getMicrosoft365CopilotUsageUserDetail(period='D28')`).then(r => parseUsage(r, 28)),
      // Only for "who moved"; the page still works without it.
      this._report(`${REPORTS}/getMicrosoft365CopilotUsageUserDetail(period='D180')`).then(r => parseUsage(r, 180)).catch(() => null),
      this._report(`${REPORTS}/getMicrosoft365CopilotUserCountTrend(period='D180')`).then(parseTrend).catch(() => []),
      this._directory().catch(() => [] as IDirectoryUser[])
    ]);
    return { usage28, usage180, trend, directory, credits: null };
  }

  // Copilot credits. Never throws: a failure is recorded so the Credits tab can explain it.
  private async _credits(): Promise<ICreditsRaw> {
    const started = Date.now();
    const empty = (error: ICreditsRaw['error'], detail = ''): ICreditsRaw => ({ days: [], users: [], userDays: 0, balance: null, error, detail: detail.slice(0, 300) });
    const raw = await withTimeout(this._readCredits(), CREDITS_MS, "Microsoft's Copilot cost reports")
      .catch(err => empty('other', String((err as Error)?.message || '')));
    console.info(`Cassin AI Hub credits: read in ${Math.round((Date.now() - started) / 1000)} s${raw.error ? ` (${raw.error}: ${raw.detail})` : ''}`);
    return raw;
  }

  private async _readCredits(): Promise<ICreditsRaw> {
    const empty = (error: ICreditsRaw['error'], detail = ''): ICreditsRaw => ({ days: [], users: [], userDays: 0, balance: null, error, detail: detail.slice(0, 300) });
    const days = lastDays(CREDIT_DAYS);
    const svcUrl = (d: string): string => `${COST}/usageReports/serviceUsageRecords?startDate=${d}&endDate=${nextDay(d)}&$top=100`;
    let first: Row[];
    try {
      // One call first: if the permission isn't approved, stop here rather than fail 56 times.
      first = await this._rows(svcUrl(days[days.length - 1]));
      if (/[?&]adoptionDebug=1/.test(window.location.search)) console.info('Cassin AI Hub credits: service usage for', days[days.length - 1], first);
    } catch (err) {
      const e = err as AdoptionError;
      console.warn('Cassin AI Hub credits: could not read the cost report', e?.message);
      return empty(e && e.isAdoptionError && (e.kind === 'consent' || e.kind === 'role') ? e.kind : 'other', String(e?.message || '').trim());
    }
    try {
      const rest = await pool(days.slice(0, -1), 4, d => this._rows(svcUrl(d)).catch(() => [] as Row[]));
      const byDay = [...rest, first].map((rows, i) => ({ date: days[i], byService: parseServiceRecords(rows) }));
      const userDays = days.slice(-CREDIT_USER_DAYS);
      const users = await pool(userDays, 4, d =>
        this._rows(`${COST}/usageReports/userUsageRecords?startDate=${d}&endDate=${nextDay(d)}&$top=100`).then(parseUserRecords).catch(() => []));
      const client = await this._client();
      const balance = await this._get(client, `${COST}/getTenantCreditBalance`, true).then(parseBalance).catch(() => null);
      return { days: byDay, users: sumUsers(users), userDays: CREDIT_USER_DAYS, balance, error: null };
    } catch {
      return empty('other');
    }
  }

  // All rows of a beta list endpoint, following paging.
  private async _rows(path: string): Promise<Row[]> {
    const client = await this._client();
    const rows: Row[] = [];
    let next: string | undefined = path;
    const seen = new Set<string>();
    while (next && !seen.has(next) && seen.size < MAX_PAGES) {
      seen.add(next);
      let page: { value?: Row[]; '@odata.nextLink'?: string };
      try {
        page = await this._get(client, next, seen.size === 1) as typeof page;
      } catch (err) {
        throw this._explain(err);
      }
      rows.push(...(page.value || []));
      next = page['@odata.nextLink'];
    }
    return rows;
  }

  private async _latestItem(): Promise<{ Id: number; RefreshDate: string | null; Modified?: string } | null> {
    const res = await this._http.get(`${this._listApi()}/items?$select=Id,Title,RefreshDate,Modified&$filter=Title eq '${LATEST}'&$top=1`,
      Http.configurations.v1, { headers: { Accept: 'application/json;odata=nometadata' } });
    if (!res.ok) return null;
    const body = await res.json() as { value: Array<{ Id: number; RefreshDate: string | null; Modified?: string }> };
    return body.value[0] || null;
  }

  private async _readLatest(): Promise<IStoredAdoption | null> {
    const item = await this._latestItem();
    if (!item) return null;
    const res = await this._http.get(`${this._listApi()}/items(${item.Id})/AttachmentFiles('${LATEST_FILE}')/$value`,
      Http.configurations.v1, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    try { return cleanStored(JSON.parse(await res.text())); } catch { return null; }
  }

  // Saves the current figures for admins who can't read Microsoft's reports themselves; only
  // when Microsoft has newer data than the saved copy. Only the people in the saved report
  // are kept from the directory.
  private async _saveLatest(live: ILive, refresh: string, force = false): Promise<boolean> {
    let item = await this._latestItem();
    // Rewrite when Microsoft has newer usage data, or at least every 6 hours (credits move daily).
    const fresh = item?.Modified && Date.now() - Date.parse(item.Modified) < 6 * 3600e3;
    if (!force && item && item.RefreshDate === refresh && fresh) return false;
    const wanted = new Set(live.usage28.rows.map(r => r.upn.toLowerCase()));
    const creditIds = new Set((live.credits?.users || []).map(u => u.userId));
    const data: IStoredAdoption = {
      v: 1, savedAt: new Date().toISOString(),
      usage28: { ...live.usage28, fields: [] },
      usage180: live.usage180 ? { ...live.usage180, fields: [] } : null,
      trend: live.trend,
      directory: live.directory.filter(d => wanted.has(d.upn.toLowerCase()) || (!!d.id && creditIds.has(d.id))),
      credits: live.credits
    };
    const json = JSON.stringify(data);
    const headers: Record<string, string> = { Accept: 'application/json;odata=nometadata', 'Content-Type': 'application/json;odata=nometadata' };
    if (!item) {
      const res = await this._http.post(`${this._listApi()}/items`, Http.configurations.v1,
        { headers, body: JSON.stringify({ Title: LATEST, RefreshDate: refresh }) });
      if (!res.ok) return false;
      item = await res.json() as { Id: number; RefreshDate: string | null; Modified?: string };
    }
    const file = `${this._listApi()}/items(${item.Id})/AttachmentFiles`;
    let res = await this._http.post(`${file}('${LATEST_FILE}')/$value`, Http.configurations.v1,
      { headers: { 'X-HTTP-Method': 'PUT' }, body: json });
    if (!res.ok) res = await this._http.post(`${file}/add(FileName='${LATEST_FILE}')`, Http.configurations.v1, { body: json });
    if (!res.ok) return false;
    await this._http.post(`${this._listApi()}/items(${item.Id})`, Http.configurations.v1,
      { headers: { ...headers, 'X-HTTP-Method': 'MERGE', 'IF-MATCH': '*' }, body: JSON.stringify({ RefreshDate: refresh }) });
    return true;
  }

  private async _client(): Promise<MSGraphClientV3> {
    if (!this._graph) {
      try {
        this._graph = await this._factory.getClient('3');
      } catch (err) {
        throw this._explain(err);
      }
    }
    return this._graph;
  }

  // Reads a report as JSON (beta) and follows paging; a CSV answer is parsed too.
  private async _report(path: string): Promise<Row[]> {
    const client = await this._client();
    const rows: Row[] = [];
    let next: string | undefined = path;
    const seen = new Set<string>();
    while (next && !seen.has(next) && seen.size < MAX_PAGES) {
      seen.add(next);
      let body: unknown;
      try {
        body = await this._get(client, next, seen.size === 1);
      } catch (err) {
        throw this._explain(err);
      }
      if (typeof body === 'string') { rows.push(...parseCsv(body)); break; }
      const page = body as { value?: Row[]; '@odata.nextLink'?: string };
      rows.push(...(page.value || []));
      next = page['@odata.nextLink'];
    }
    return rows;
  }

  private async _directory(): Promise<IDirectoryUser[]> {
    const client = await this._client();
    const out: IDirectoryUser[] = [];
    let next: string | undefined = '/users?$select=id,userPrincipalName,displayName,jobTitle,accountEnabled&$top=999';
    const seen = new Set<string>();
    while (next && !seen.has(next) && seen.size < MAX_PAGES) {
      seen.add(next);
      const page = await this._get(client, next, false) as { value: Array<Record<string, string | boolean | null>>; '@odata.nextLink'?: string };
      const s = (v: unknown): string => (typeof v === 'string' ? v : '');
      page.value.forEach(u => out.push({
        upn: s(u.userPrincipalName), name: s(u.displayName), title: s(u.jobTitle).trim(), id: s(u.id).toLowerCase(),
        ...(u.accountEnabled === false ? { enabled: false } : {})
      }));
      next = page['@odata.nextLink'];
    }
    return out;
  }

  private _listApi(): string {
    const path = `${this._webRelUrl.replace(/\/$/, '')}/${HISTORY_LIST}`.replace(/'/g, "''");
    return `${this._webUrl}/_api/web/GetList('${encodeURIComponent(path)}')`;
  }

  private async _snapshots(): Promise<ISnapshot[]> {
    const res = await this._http.get(`${this._listApi()}/items?$select=Id,Title,Snapshot&$top=60&$orderby=Title desc`,
      Http.configurations.v1, { headers: { Accept: 'application/json;odata=nometadata' } });
    if (!res.ok) return [];
    const body = await res.json() as { value: Array<{ Id: number; Title: string; Snapshot: string }> };
    const out: ISnapshot[] = [];
    body.value.forEach(item => {
      try {
        const s = JSON.parse(item.Snapshot) as ISnapshot;
        if (s && s.month && s.people) out.push({ ...s, month: item.Title || s.month, id: item.Id });
      } catch { /* a hand-edited or damaged row: skip it */ }
    });
    return out;
  }

  // One row per month. A later report for the same month replaces the earlier one, so the
  // month ends up with the window closest to its end.
  private async _saveSnapshot(snap: ISnapshot, existing: ISnapshot[]): Promise<boolean> {
    const found = existing.find(s => s.month === snap.month);
    if (found && found.refresh >= snap.refresh) return false;
    const body = JSON.stringify({ Title: snap.month, RefreshDate: snap.refresh, Snapshot: JSON.stringify(snap) });
    const headers: Record<string, string> = { Accept: 'application/json;odata=nometadata', 'Content-Type': 'application/json;odata=nometadata' };
    const url = found?.id ? `${this._listApi()}/items(${found.id})` : `${this._listApi()}/items`;
    if (found?.id) { headers['X-HTTP-Method'] = 'MERGE'; headers['IF-MATCH'] = '*'; }
    const res = await this._http.post(url, Http.configurations.v1, { headers, body });
    return res.ok;
  }

  // One Graph call with a time limit. Only the first page of a beta list needs .version('beta');
  // later pages are full nextLink URLs.
  private _get(client: MSGraphClientV3, url: string, beta: boolean): Promise<unknown> {
    const req = beta ? client.api(url).version('beta') : client.api(url);
    return withTimeout(req.get() as Promise<unknown>, CALL_MS, 'Microsoft Graph');
  }

  private _explain(err: unknown): AdoptionError {
    if ((err as AdoptionError)?.isAdoptionError) return err as AdoptionError;
    const e = err as { statusCode?: number; code?: string; message?: string };
    const msg = `${e?.code || ''} ${e?.message || String(err)}`;
    if (/AADSTS65001|consent|AADSTS650057|invalid_resource|has not been approved/i.test(msg)) {
      return new AdoptionError(msg, 'consent');
    }
    if (e?.statusCode === 403 || /Forbidden|Authorization_RequestDenied|S2SUnauthorized|UnknownError.*403/i.test(msg)) {
      return new AdoptionError(msg, 'role');
    }
    return new AdoptionError(msg, 'other');
  }
}
