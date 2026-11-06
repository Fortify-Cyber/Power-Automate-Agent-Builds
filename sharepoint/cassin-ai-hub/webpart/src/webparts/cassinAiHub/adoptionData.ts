import type { MSGraphClientFactory, MSGraphClientV3, SPHttpClient } from '@microsoft/sp-http';
import { SPHttpClient as Http } from '@microsoft/sp-http';

import {
  buildAdoption, cleanStored, makeSnapshot, parseCsv, parseTrend, parseUsage,
  type IAdoption, type IDirectoryUser, type ISnapshot, type IStoredAdoption, type IUsageReport, type ITrendPoint, type Row
} from './adoptionModel';

// Everything the adoption page reads, all inside Cassin's Microsoft 365:
//  - Microsoft Graph, as the signed-in person: the Copilot usage reports (Reports.Read.All)
//    and names and job titles from Entra ID (User.Read.All). Both permissions are approved
//    once by a SharePoint admin (SharePoint admin center → Advanced → API access). Microsoft
//    only answers the reports call for accounts with a reports role in Entra ID.
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
}

interface ILive { usage28: IUsageReport; usage180: IUsageReport | null; trend: ITrendPoint[]; directory: IDirectoryUser[] }

export class AdoptionData {
  private _graph: MSGraphClientV3 | undefined;

  public constructor(private readonly _factory: MSGraphClientFactory, private readonly _http: SPHttpClient,
                     private readonly _webUrl: string, private readonly _webRelUrl: string) {}

  public async load(): Promise<IAdoptionLoad> {
    const snapshots = await this._snapshots().catch(() => [] as ISnapshot[]);
    let live: ILive;
    try {
      live = await this._live();
    } catch (err) {
      // This account can't read Microsoft's reports (or the call failed): show the copy saved
      // for admins when there is one.
      const stored = await this._readLatest().catch(() => null);
      if (stored) {
        const model = buildAdoption({ ...stored, snapshots });
        return { model, saved: false, source: 'stored', savedAt: stored.savedAt, shared: false };
      }
      const e = err as AdoptionError;
      if (e && e.isAdoptionError && (e.kind === 'role' || e.kind === 'consent')) throw new AdoptionError(e.message, 'nodata');
      throw err;
    }
    const model = buildAdoption({ ...live, snapshots });
    let saved = false, shared = false;
    if (model.refresh && model.hasDays && !model.namesHidden) {
      saved = await this._saveSnapshot(makeSnapshot(live.usage28.rows, model.refresh, model.licensed), snapshots).catch(err => {
        console.warn('Cassin AI Hub: could not save this month\'s adoption snapshot', err);
        return false;
      });
    }
    if (model.refresh && !model.namesHidden) {
      shared = await this._saveLatest(live, model.refresh).catch(err => {
        console.warn('Cassin AI Hub: could not save the figures for other admins', err);
        return false;
      });
    }
    if (/[?&]adoptionDebug=1/.test(window.location.search)) {
      console.info('Cassin AI Hub adoption: report fields', model.fields, 'daily prompts in trend:', model.hasDailyPrompts, model);
    }
    return { model, saved, source: 'live', shared };
  }

  private async _live(): Promise<ILive> {
    const [usage28, usage180, trend, directory] = await Promise.all([
      this._report(`${REPORTS}/getMicrosoft365CopilotUsageUserDetail(period='D28')`).then(r => parseUsage(r, 28)),
      // Only for "who moved"; the page still works without it.
      this._report(`${REPORTS}/getMicrosoft365CopilotUsageUserDetail(period='D180')`).then(r => parseUsage(r, 180)).catch(() => null),
      this._report(`${REPORTS}/getMicrosoft365CopilotUserCountTrend(period='D180')`).then(parseTrend).catch(() => []),
      this._directory().catch(() => [] as IDirectoryUser[])
    ]);
    return { usage28, usage180, trend, directory };
  }

  private async _latestItem(): Promise<{ Id: number; RefreshDate: string | null } | null> {
    const res = await this._http.get(`${this._listApi()}/items?$select=Id,Title,RefreshDate&$filter=Title eq '${LATEST}'&$top=1`,
      Http.configurations.v1, { headers: { Accept: 'application/json;odata=nometadata' } });
    if (!res.ok) return null;
    const body = await res.json() as { value: Array<{ Id: number; RefreshDate: string | null }> };
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
  private async _saveLatest(live: ILive, refresh: string): Promise<boolean> {
    let item = await this._latestItem();
    if (item && item.RefreshDate === refresh) return false;
    const wanted = new Set(live.usage28.rows.map(r => r.upn.toLowerCase()));
    const data: IStoredAdoption = {
      v: 1, savedAt: new Date().toISOString(),
      usage28: { ...live.usage28, fields: [] },
      usage180: live.usage180 ? { ...live.usage180, fields: [] } : null,
      trend: live.trend,
      directory: live.directory.filter(d => wanted.has(d.upn.toLowerCase()))
    };
    const json = JSON.stringify(data);
    const headers: Record<string, string> = { Accept: 'application/json;odata=nometadata', 'Content-Type': 'application/json;odata=nometadata' };
    if (!item) {
      const res = await this._http.post(`${this._listApi()}/items`, Http.configurations.v1,
        { headers, body: JSON.stringify({ Title: LATEST, RefreshDate: refresh }) });
      if (!res.ok) return false;
      item = await res.json() as { Id: number; RefreshDate: string | null };
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
    let first = true;
    while (next) {
      let body: unknown;
      try {
        body = first ? await client.api(next).version('beta').get() : await client.api(next).get();
      } catch (err) {
        throw this._explain(err);
      }
      first = false;
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
    let next: string | undefined = '/users?$select=userPrincipalName,displayName,jobTitle&$top=999';
    while (next) {
      const page = await client.api(next).get() as { value: Array<Record<string, string | null>>; '@odata.nextLink'?: string };
      page.value.forEach(u => out.push({
        upn: u.userPrincipalName || '', name: u.displayName || '', title: (u.jobTitle || '').trim()
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

  private _explain(err: unknown): AdoptionError {
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
