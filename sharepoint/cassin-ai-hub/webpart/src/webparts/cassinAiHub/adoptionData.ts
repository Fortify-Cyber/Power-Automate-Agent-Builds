import type { MSGraphClientFactory, MSGraphClientV3, SPHttpClient } from '@microsoft/sp-http';
import { SPHttpClient as Http } from '@microsoft/sp-http';

import {
  buildAdoption, makeSnapshot, parseCsv, parseTrend, parseUsage,
  type IAdoption, type IDirectoryUser, type ISnapshot, type Row
} from './adoptionModel';

// Everything the adoption page reads, all inside Cassin's Microsoft 365:
//  - Microsoft Graph, as the signed-in admin: the Copilot usage reports (Reports.Read.All)
//    and names and job titles from Entra ID (User.Read.All). Both permissions
//    are approved once by a SharePoint admin (SharePoint admin center → Advanced → API access).
//  - The admin-only "Copilot Adoption History" list on this site, where one snapshot a month
//    is saved so the month-by-month views fill in over time.
// Nothing is sent anywhere else.

export const HISTORY_LIST = 'Lists/CopilotAdoptionHistory';

// The web part compiles to ES5, where a subclass of Error loses its prototype (instanceof
// fails), so restore it; the web part also checks `kind` rather than relying on instanceof.
export class AdoptionError extends Error {
  public readonly isAdoptionError = true;
  public constructor(message: string, public readonly kind: 'consent' | 'role' | 'other') {
    super(message);
    Object.setPrototypeOf(this, AdoptionError.prototype);
  }
}

const REPORTS = '/copilot/reports';

export class AdoptionData {
  private _graph: MSGraphClientV3 | undefined;

  public constructor(private readonly _factory: MSGraphClientFactory, private readonly _http: SPHttpClient,
                     private readonly _webUrl: string, private readonly _webRelUrl: string) {}

  public async load(): Promise<{ model: IAdoption; saved: boolean }> {
    const [usage28, usage180, trend, directory, snapshots] = await Promise.all([
      this._report(`${REPORTS}/getMicrosoft365CopilotUsageUserDetail(period='D28')`).then(r => parseUsage(r, 28)),
      // Only for "who moved"; the page still works without it.
      this._report(`${REPORTS}/getMicrosoft365CopilotUsageUserDetail(period='D180')`).then(r => parseUsage(r, 180)).catch(() => null),
      this._report(`${REPORTS}/getMicrosoft365CopilotUserCountTrend(period='D180')`).then(parseTrend).catch(() => []),
      this._directory().catch(() => [] as IDirectoryUser[]),
      this._snapshots().catch(() => [] as ISnapshot[])
    ]);
    const model = buildAdoption({ usage28, usage180, trend, directory, snapshots });
    let saved = false;
    if (model.refresh && model.hasDays && !model.namesHidden) {
      saved = await this._saveSnapshot(makeSnapshot(usage28.rows, model.refresh, model.licensed), snapshots).catch(err => {
        console.warn('Cassin AI Hub: could not save this month\'s adoption snapshot', err);
        return false;
      });
    }
    if (/[?&]adoptionDebug=1/.test(window.location.search)) {
      console.info('Cassin AI Hub adoption: report fields', model.fields, 'daily prompts in trend:', model.hasDailyPrompts, model);
    }
    return { model, saved };
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
