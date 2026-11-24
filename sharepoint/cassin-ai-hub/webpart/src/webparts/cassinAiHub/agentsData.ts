import type { MSGraphClientFactory, MSGraphClientV3, SPHttpClient } from '@microsoft/sp-http';
import { SPHttpClient as Http } from '@microsoft/sp-http';

import { AdoptionError, HISTORY_LIST, withTimeout } from './adoptionData';
import {
  addDays, buildAgents, cleanStore, emptyStore, mergeHits, normName, parseAuditRecord,
  type IAgentHit, type IAgentStore, type IAgentsView, type ITimeSaving, type Row
} from './agentsModel';

// Everything the Agent usage page reads, all inside Cassin's Microsoft 365:
//  - Microsoft Purview's audit log, searched through Microsoft Graph as the signed-in admin
//    (AuditLogsQuery.Read.All, approved in SharePoint admin center → Advanced → API access;
//    the account also needs audit search rights in Purview, such as Audit Reader). A search
//    takes Microsoft minutes to an hour, so it's started on one visit and read on a later one.
//    Only counts are kept (agent, person, day): nothing anyone asked an agent is read or saved.
//  - The admin-only Copilot Adoption History list: an "agents" item whose agents.json
//    attachment holds the counts, so everyone who can open the page sees them.
//  - The admin-only Agent Time Savings list: who built each agent and the minutes one run
//    saves (estimates admins can edit). Agents seen for the first time are added to it.
//  - Names from Entra ID (User.Read.All), to show people's names rather than addresses.

export const SAVINGS_LIST = 'Lists/AgentTimeSavings';
const ITEM = 'agents';
const FILE = 'agents.json';
const FIRST_DAYS = 30;     // the first search covers the last 30 days
const MAX_WINDOW = 30;     // later searches catch up 30 days at a time
const SETTLE_DAYS = 2;     // audit records can arrive a day or more late: leave the last 2 days
const POLL_MS = 20e3, POLL_FOR_MS = 3 * 60e3;
const CALL_MS = 45e3;
const MAX_PAGES = 1000;

export interface IAgentsLoad {
  view: IAgentsView;
  /** Why this account couldn't refresh the counts (shown, not saved). */
  problem: AdoptionError | null;
  /** The counts after this visit's audit search, when it finishes while the page is open. */
  refresh?: Promise<{ view: IAgentsView | null; problem: AdoptionError | null }>;
  savingsUrl: string;
  savingsMissing: boolean;
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => window.setTimeout(resolve, ms));
const todayUtc = (): string => new Date().toISOString().slice(0, 10);

export class AgentsData {
  private _graph: MSGraphClientV3 | undefined;

  public constructor(private readonly _factory: MSGraphClientFactory, private readonly _http: SPHttpClient,
                     private readonly _webUrl: string, private readonly _webRelUrl: string) {}

  public async load(): Promise<IAgentsLoad> {
    const [stored, savingsRes, names] = await Promise.all([
      withTimeout(this._readStore(), 30e3, 'SharePoint').catch(() => null),
      withTimeout(this._savings(), 30e3, 'SharePoint').then(v => ({ v, missing: false })).catch(() => ({ v: [] as ITimeSaving[], missing: true })),
      withTimeout(this._names(), 45e3, 'Microsoft Graph').catch(() => new Map<string, string>())
    ]);
    const store = stored?.store || emptyStore();
    const savings = savingsRes.v;
    const view = buildAgents(store, savings, names);
    const base = { savingsUrl: `${this._webUrl}/${SAVINGS_LIST}`, savingsMissing: savingsRes.missing };
    // Only people who can write the history list (owners, AI Hub Admins) can save new counts.
    if (!stored?.canWrite) return { view, problem: null, ...base };
    const refresh = this._refresh(store, stored.itemId, savings, names, savingsRes.missing)
      .then(s => ({ view: s ? buildAgents(s, savings, names) : null, problem: null }))
      .catch(err => {
        const e = (err as AdoptionError)?.isAdoptionError ? err as AdoptionError : new AdoptionError(String((err as Error)?.message || err), 'other');
        console.warn('Cassin AI Hub agents: could not refresh from the audit log', e.message);
        return { view: null, problem: e };
      });
    return { view, problem: null, refresh, ...base };
  }

  // Picks up a finished search, or starts the next one, and waits a few minutes for it while
  // the page is open. Resolves to the new counts, or null when there's nothing new yet.
  private async _refresh(store: IAgentStore, itemId: number | null, savings: ITimeSaving[], names: Map<string, string>, noSavings: boolean): Promise<IAgentStore | null> {
    let s = store;
    const lastFull = addDays(todayUtc(), -SETTLE_DAYS);
    if (!s.pending) {
      // A recount picks up from the old first day (30 days at a time, like any catch-up).
      const start = s.through ? addDays(s.through, 1) : (s.recountFrom && s.recountFrom <= lastFull ? s.recountFrom : addDays(lastFull, -(FIRST_DAYS - 1)));
      if (start > lastFull) return null;
      const end = addDays(start, MAX_WINDOW - 1) < lastFull ? addDays(start, MAX_WINDOW - 1) : lastFull;
      const queryId = await this._startSearch(start, end);
      s = { ...s, pending: { queryId, start, end, createdAt: new Date().toISOString() } };
      itemId = await this._writeStore(s, itemId);
    }
    const p = s.pending as NonNullable<IAgentStore['pending']>;
    const started = Date.now();
    for (;;) {
      const status = await this._status(p.queryId);
      if (status === 'succeeded') break;
      if (status === 'failed' || status === 'cancelled' || status === 'gone' ||
          (Date.now() - Date.parse(p.createdAt) > 24 * 3600e3)) {
        // Start again on the next visit.
        await this._writeStore({ ...s, pending: null }, itemId);
        throw new AdoptionError(`Microsoft's audit search ${status === 'gone' ? 'is no longer available' : `ended as "${status}"`}; a new one starts on the next visit.`, 'other');
      }
      if (Date.now() - started > POLL_FOR_MS) return null;
      await sleep(POLL_MS);
    }
    const hits = await this._records(p.queryId);
    const merged = mergeHits({ ...s, pending: null }, p.start, p.end, hits);
    await this._writeStore(merged, itemId);
    if (!noSavings) await this._addNewAgents(merged, savings).catch(err => console.warn('Cassin AI Hub agents: could not add new agents to the time savings list', err));
    console.info(`Cassin AI Hub agents: counted ${hits.length} agent records for ${p.start} to ${p.end}`);
    return merged;
  }

  // ---- Microsoft Graph: the audit log ----------------------------------------

  private async _startSearch(start: string, end: string): Promise<string> {
    const client = await this._client();
    const body = {
      displayName: `Cassin AI Hub agent usage ${start} to ${end}`,
      filterStartDateTime: `${start}T00:00:00Z`,
      filterEndDateTime: `${addDays(end, 1)}T00:00:00Z`,
      // Copilot and agent use, and apps built in Copilot Studio (which Microsoft can log as
      // "connected AI app" interactions).
      recordTypeFilters: ['copilotInteraction', 'connectedAIAppInteraction']
    };
    const post = (b: object): Promise<{ id?: string }> =>
      withTimeout(client.api('/security/auditLog/queries').post(b) as Promise<{ id?: string }>, CALL_MS, 'Microsoft Graph');
    try {
      let res: { id?: string };
      try {
        res = await post(body);
      } catch (err) {
        // A tenant whose Graph doesn't know the second record type: search Copilot use only.
        if ((err as { statusCode?: number })?.statusCode !== 400) throw err;
        res = await post({ ...body, recordTypeFilters: ['copilotInteraction'] });
      }
      if (!res?.id) throw new Error('Microsoft returned no search id');
      return res.id;
    } catch (err) { throw this._explain(err); }
  }

  private async _status(id: string): Promise<string> {
    const client = await this._client();
    try {
      const q = await withTimeout(client.api(`/security/auditLog/queries/${encodeURIComponent(id)}`).select('id,status').get() as Promise<{ status?: string }>, CALL_MS, 'Microsoft Graph');
      return String(q?.status || 'unknown');
    } catch (err) {
      if ((err as { statusCode?: number })?.statusCode === 404) return 'gone';
      throw this._explain(err);
    }
  }

  private async _records(id: string): Promise<IAgentHit[]> {
    const client = await this._client();
    const hits: IAgentHit[] = [];
    let next: string | undefined = `/security/auditLog/queries/${encodeURIComponent(id)}/records?$top=1000`;
    const seen = new Set<string>();
    let retried = false;
    while (next && !seen.has(next)) {
      if (seen.size >= MAX_PAGES) throw new AdoptionError('Too many audit records to count in one visit', 'other');
      seen.add(next);
      let page: { value?: Row[]; '@odata.nextLink'?: string };
      try {
        page = await withTimeout(client.api(next).get() as Promise<typeof page>, CALL_MS, 'Microsoft Graph');
      } catch (err) {
        // If Microsoft won't take $top here, page with its own size instead.
        if (!retried && (err as { statusCode?: number })?.statusCode === 400 && /\$top/.test(next)) {
          retried = true; seen.clear(); next = next.replace(/\?\$top=1000$/, ''); continue;
        }
        throw this._explain(err);
      }
      (page.value || []).forEach(r => { const h = parseAuditRecord(r); if (h) hits.push(h); });
      next = page['@odata.nextLink'];
    }
    return hits;
  }

  private async _names(): Promise<Map<string, string>> {
    const client = await this._client();
    const out = new Map<string, string>();
    let next: string | undefined = '/users?$select=userPrincipalName,displayName&$top=999';
    const seen = new Set<string>();
    while (next && !seen.has(next) && seen.size < 50) {
      seen.add(next);
      type UsersPage = { value: Array<Record<string, unknown>>; '@odata.nextLink'?: string };
      const page: UsersPage = await withTimeout(client.api(next).get() as Promise<UsersPage>, CALL_MS, 'Microsoft Graph');
      page.value.forEach((u: Record<string, unknown>) => { if (typeof u.userPrincipalName === 'string') out.set(u.userPrincipalName.toLowerCase(), typeof u.displayName === 'string' ? u.displayName : ''); });
      next = page['@odata.nextLink'];
    }
    return out;
  }

  private async _client(): Promise<MSGraphClientV3> {
    if (!this._graph) {
      try { this._graph = await this._factory.getClient('3'); } catch (err) { throw this._explain(err); }
    }
    return this._graph;
  }

  private _explain(err: unknown): AdoptionError {
    if ((err as AdoptionError)?.isAdoptionError) return err as AdoptionError;
    const e = err as { statusCode?: number; code?: string; message?: string };
    const msg = `${e?.code || ''} ${e?.message || String(err)}`.trim();
    if (/AADSTS65001|consent|AADSTS650057|invalid_resource|has not been approved/i.test(msg)) return new AdoptionError(msg, 'consent');
    if (e?.statusCode === 401 || e?.statusCode === 403 || /Forbidden|Authorization_RequestDenied|Unauthorized/i.test(msg)) return new AdoptionError(msg, 'role');
    return new AdoptionError(msg, 'other');
  }

  // ---- SharePoint: the saved counts and the time savings list -----------------

  private _listApi(list: string): string {
    const path = `${this._webRelUrl.replace(/\/$/, '')}/${list}`.replace(/'/g, "''");
    return `${this._webUrl}/_api/web/GetList('${encodeURIComponent(path)}')`;
  }

  private async _readStore(): Promise<{ store: IAgentStore; itemId: number | null; canWrite: boolean } | null> {
    const api = this._listApi(HISTORY_LIST);
    const res = await this._http.get(`${api}/items?$select=Id,Title&$filter=Title eq '${ITEM}'&$top=1`, Http.configurations.v1,
      { headers: { Accept: 'application/json;odata=nometadata' } });
    if (!res.ok) return null;
    const item = ((await res.json()) as { value: Array<{ Id: number }> }).value[0];
    const perms = await this._http.get(`${api}/EffectiveBasePermissions`, Http.configurations.v1, { headers: { Accept: 'application/json;odata=nometadata' } })
      .then(r => (r.ok ? r.json() : null)).catch(() => null) as { Low?: number | string } | null;
    // AddListItems (0x2) and EditListItems (0x4) are in the low half of the permission mask.
    const low = Number(perms?.Low ?? 0);
    const canWrite = (low & 0x2) !== 0 && (low & 0x4) !== 0;
    if (!item) return { store: emptyStore(), itemId: null, canWrite };
    const file = await this._http.get(`${api}/items(${item.Id})/AttachmentFiles('${FILE}')/$value`, Http.configurations.v1, { headers: { Accept: 'application/json' } });
    let store = emptyStore();
    if (file.ok) { try { store = cleanStore(JSON.parse(await file.text())); } catch { /* damaged: start again */ } }
    return { store, itemId: item.Id, canWrite };
  }

  private async _writeStore(store: IAgentStore, itemId: number | null): Promise<number | null> {
    const api = this._listApi(HISTORY_LIST);
    const headers = { Accept: 'application/json;odata=nometadata', 'Content-Type': 'application/json;odata=nometadata' };
    let id = itemId;
    if (!id) {
      const res = await this._http.post(`${api}/items`, Http.configurations.v1, { headers, body: JSON.stringify({ Title: ITEM }) });
      if (!res.ok) throw new AdoptionError(`Couldn't save the agent counts (${res.status})`, 'other');
      id = ((await res.json()) as { Id: number }).Id;
    }
    const json = JSON.stringify(store);
    const file = `${api}/items(${id})/AttachmentFiles`;
    let res = await this._http.post(`${file}('${FILE}')/$value`, Http.configurations.v1, { headers: { 'X-HTTP-Method': 'PUT' }, body: json });
    if (!res.ok) res = await this._http.post(`${file}/add(FileName='${FILE}')`, Http.configurations.v1, { body: json });
    if (!res.ok) throw new AdoptionError(`Couldn't save the agent counts (${res.status})`, 'other');
    return id;
  }

  private async _savings(): Promise<ITimeSaving[]> {
    const res = await this._http.get(`${this._listApi(SAVINGS_LIST)}/items?$select=Id,Title,AgentId,BuiltBy,MinutesPerRun&$top=500`, Http.configurations.v1,
      { headers: { Accept: 'application/json;odata=nometadata' } });
    if (!res.ok) throw new Error(`Agent Time Savings list: ${res.status}`);
    const body = await res.json() as { value: Array<{ Id: number; Title: string | null; AgentId: string | null; BuiltBy: string | null; MinutesPerRun: number | null }> };
    return body.value.filter(v => v.Title).map(v => ({
      itemId: v.Id, name: String(v.Title), agentId: String(v.AgentId || ''), builtBy: String(v.BuiltBy || ''),
      minutes: typeof v.MinutesPerRun === 'number' && isFinite(v.MinutesPerRun) && v.MinutesPerRun >= 0 ? Math.min(v.MinutesPerRun, 10000) : null
    }));
  }

  // Agents seen for the first time go into the time savings list, so admins can fill in who
  // built them and the minutes a run saves. A listed agent that matches by name gets its id.
  private async _addNewAgents(store: IAgentStore, savings: ITimeSaving[]): Promise<void> {
    const api = this._listApi(SAVINGS_LIST);
    const headers = { Accept: 'application/json;odata=nometadata', 'Content-Type': 'application/json;odata=nometadata' };
    const byId = new Set(savings.filter(x => x.agentId).map(x => x.agentId.toLowerCase()));
    const byName = new Map(savings.map(x => [normName(x.name), x]));
    for (const key of Object.keys(store.agents)) {
      const a = store.agents[key];
      if (a.id && byId.has(a.id.toLowerCase())) continue;
      const match = byName.get(normName(a.name));
      if (match) {
        if (a.id && !match.agentId && match.itemId) {
          await this._http.post(`${api}/items(${match.itemId})`, Http.configurations.v1,
            { headers: { ...headers, 'X-HTTP-Method': 'MERGE', 'IF-MATCH': '*' }, body: JSON.stringify({ AgentId: a.id }) });
          match.agentId = a.id;
        }
        continue;
      }
      // Apps logged without a name get "Copilot Studio app (…id)": rename the row to name it.
      const res = await this._http.post(`${api}/items`, Http.configurations.v1, { headers, body: JSON.stringify({ Title: a.name.slice(0, 255), AgentId: a.id }) });
      if (res.ok) savings.push({ name: a.name, agentId: a.id, builtBy: '', minutes: null });
    }
  }
}
