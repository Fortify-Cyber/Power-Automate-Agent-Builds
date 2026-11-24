// Agent usage for the admin "Agent usage" page: which Copilot agents people at Cassin use, how
// often, who built them, and the time they save. Pure functions, no Graph or SharePoint calls.
//
// Source: Microsoft Purview's audit log (CopilotInteraction records, read through Microsoft
// Graph by agentsData.ts). Each record says who talked to which agent and when. The records
// also describe what Copilot touched, but only the agent, the person, the day and the
// conversation id are read here, and only counts are kept: nothing anyone asked is stored.
//
// A "run" is one conversation with an agent: the records of one conversation (thread) on one
// day count once. Microsoft doesn't record whether the agent's task finished, so a run counts
// once the agent has answered.
//
// Apps built in Copilot Studio can be logged without an agent name or id, identified only by
// AppIdentity "Copilot.Studio.<app id>" (and possibly as ConnectedAIAppInteraction records):
// those count too, named "Copilot Studio app (…id)" until an admin names them in the Agent
// Time Savings list.
//
// Agents are counted by name, not by Microsoft's agent id: the same agent can show up under
// several ids (Microsoft logs some conversations once per id, and an agent republished or
// used from another app gets another id). A conversation logged twice counts once: same
// person, same agent name, and the same conversation id or the same second.

export type Row = Record<string, unknown>;

/** What one audit record says, for counting. */
export interface IAgentHit { day: string; key: string; id: string; name: string; upn: string; thread: string; when: string }

/** Agent names compared loosely: case, spaces and punctuation don't matter. */
export const normName = (n: string): string => n.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Counts per day, per agent, per person: runs. Kept in the hub's admin-only history list. */
export interface IAgentStore {
  v: 1;
  /** How runs are counted. Counts saved by an earlier version are thrown away and recounted. */
  cv: 3;
  /** Set when earlier counts were thrown away: the first new search starts here. */
  recountFrom: string | null;
  /** The last UTC day counted, inclusive (YYYY-MM-DD); null before the first search. */
  through: string | null;
  /** The first day counted. */
  since: string | null;
  /** A search Microsoft is still running: picked up on a later visit. */
  pending: { queryId: string; start: string; end: string; createdAt: string } | null;
  agents: Record<string, { id: string; name: string }>;
  days: Record<string, Record<string, Record<string, number>>>;
}

export const emptyStore = (): IAgentStore => ({ v: 1, cv: 3, recountFrom: null, through: null, since: null, pending: null, agents: {}, days: {} });

const DAY = 864e5;
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
export const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Finds a field anywhere in an audit record (Microsoft nests it differently by version), ignoring case. */
function find(o: unknown, name: string, depth = 0): unknown {
  if (!o || typeof o !== 'object' || depth > 4) return undefined;
  const lower = name.toLowerCase();
  for (const k of Object.keys(o as Row)) if (k.toLowerCase() === lower) return (o as Row)[k];
  for (const k of Object.keys(o as Row)) {
    const v = (o as Row)[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) { const f = find(v, name, depth + 1); if (f !== undefined) return f; }
  }
  return undefined;
}
const s = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * One CopilotInteraction record → who used which agent and when; null for Copilot use that
 * isn't an agent, or a record where the agent hasn't answered.
 */
export function parseAuditRecord(rec: Row): IAgentHit | null {
  const data = (rec.auditData ?? rec.AuditData ?? rec) as Row;
  let id = s(find(data, 'AgentId'));
  const name = s(find(data, 'AgentName'));
  // A placeholder id (all ones) says nothing about which agent it was.
  if (/^[1-]+$/.test(id)) id = '';
  if (!id && !name) {
    const app = s(find(data, 'AppIdentity'));
    if (!/^Copilot\.Studio\./i.test(app)) return null;
    id = app;
  }
  const when = s(rec.createdDateTime) || s(find(data, 'CreationTime'));
  const day = when.slice(0, 10);
  if (!isDate(day)) return null;
  const upn = (s(rec.userPrincipalName) || s(find(data, 'UserId'))).toLowerCase();
  if (!upn) return null;
  // Only prompts so far, no answer: not a run (yet).
  const msgs = find(data, 'Messages');
  if (Array.isArray(msgs) && msgs.length && msgs.every(m => m && (m as Row).isPrompt === true)) return null;
  const thread = s(find(data, 'ThreadId')) || s(rec.id) || `${upn}|${when}`;
  const key = name && normName(name) ? `name:${normName(name)}` : id.toLowerCase();
  return { day, key, id, name: name || unnamed(id), upn, thread, when: when.slice(0, 19) };
}

/** A name for an agent or app Microsoft logs without one. */
export function unnamed(id: string): string {
  const tail = id.replace(/[^0-9a-z]/gi, '').slice(-6);
  return /^Copilot\.Studio\./i.test(id) ? `Copilot Studio app (…${tail})` : id;
}

/** Puts a search's results for [start, end] into the store, replacing those days (so a repeat is harmless). */
export function mergeHits(store: IAgentStore, start: string, end: string, hits: IAgentHit[]): IAgentStore {
  const days = { ...store.days };
  for (let d = start; d <= end; d = addDays(d, 1)) delete days[d];
  const seen = new Set<string>();
  const agents = { ...store.agents };
  hits.forEach(h => {
    if (h.day < start || h.day > end) return;
    const byThread = `${h.day}|${h.key}|${h.upn}|t|${h.thread}`, byTime = `${h.key}|${h.upn}|w|${h.when}`;
    const dup = seen.has(byThread) || (h.when.length >= 19 && seen.has(byTime));
    seen.add(byThread); if (h.when.length >= 19) seen.add(byTime);
    if (dup) return;
    const day = days[h.day] || (days[h.day] = {});
    const agent = day[h.key] || (day[h.key] = {});
    agent[h.upn] = (agent[h.upn] || 0) + 1;
    // Keep the latest name Microsoft reports for the agent.
    if (!agents[h.key] || h.name) agents[h.key] = { id: h.id || agents[h.key]?.id || '', name: h.name || agents[h.key]?.name || h.key };
  });
  const through = !store.through || end > store.through ? end : store.through;
  const since = !store.since || start < store.since ? start : store.since;
  return { ...store, days, agents, through, since, recountFrom: null };
}

/** The saved store comes back from a list admins can edit: keep only well-formed values. */
export function cleanStore(raw: unknown): IAgentStore {
  const x = raw as Partial<IAgentStore> | null;
  const out = emptyStore();
  if (!x || typeof x !== 'object' || x.v !== 1) return out;
  if ((x as { cv?: unknown }).cv !== 3) {
    // Counted an older way (by agent id, so repeats; or without Copilot Studio apps): start
    // again from the same first day.
    out.recountFrom = isDate(x.since) ? x.since : null;
    return out;
  }
  out.recountFrom = isDate(x.recountFrom) ? x.recountFrom : null;
  out.through = isDate(x.through) ? x.through : null;
  out.since = isDate(x.since) ? x.since : null;
  const p = x.pending;
  if (p && typeof p.queryId === 'string' && /^[\w-]{1,80}$/.test(p.queryId) && isDate(p.start) && isDate(p.end)) {
    out.pending = { queryId: p.queryId, start: p.start, end: p.end, createdAt: s(p.createdAt, 40) };
  }
  const keyOk = (k: string): boolean => k.length > 0 && k.length <= 200;
  Object.keys(x.agents || {}).forEach(k => {
    const a = (x.agents as Record<string, { id?: unknown; name?: unknown }>)[k];
    if (keyOk(k) && a) out.agents[k] = { id: s(a.id), name: s(a.name) || k };
  });
  Object.keys(x.days || {}).forEach(d => {
    if (!isDate(d)) return;
    const day: Record<string, Record<string, number>> = {};
    const src = (x.days as Record<string, Record<string, Record<string, unknown>>>)[d] || {};
    Object.keys(src).forEach(k => {
      if (!keyOk(k) || !src[k] || typeof src[k] !== 'object') return;
      const people: Record<string, number> = {};
      Object.keys(src[k]).forEach(u => {
        const n = Math.round(Number(src[k][u]));
        if (/^[^\s<>"']{1,200}$/.test(u) && isFinite(n) && n > 0) people[u.toLowerCase()] = Math.min(n, 10000);
      });
      if (Object.keys(people).length) day[k] = people;
    });
    out.days[d] = day;
  });
  return out;
}

// ---- what the page shows ---------------------------------------------------

/** A row of the Agent Time Savings list: who built an agent and the minutes one run saves. */
export interface ITimeSaving { itemId?: number; name: string; agentId: string; builtBy: string; minutes: number | null }

export interface IAgentRow {
  key: string; name: string; builtBy: string; minutes: number | null; listed: boolean;
  runs28: number; people28: number; runsAll: number; peopleAll: number; lastUsed: string | null;
  /** Minutes saved: last 28 days and since counting began (null without a minutes figure). */
  saved28: number | null; savedAll: number | null;
  /** Runs per week, oldest first, the last 8 weeks. */
  weekly: number[];
  users: Array<{ upn: string; name: string; runs28: number; runsAll: number }>;
}

export interface IAgentsView {
  through: string | null; since: string | null; pending: IAgentStore['pending'];
  /** Earlier counts were thrown away and are being recounted from this day. */
  recountFrom: string | null;
  rows: IAgentRow[];
  runs28: number; people28: number; agents28: number; saved28: number; savedAll: number; runsAll: number;
  /** Agents with runs but no minutes figure yet. */
  noMinutes: number;
}

export function buildAgents(store: IAgentStore, savings: ITimeSaving[], names: Map<string, string>): IAgentsView {
  const through = store.through;
  const from28 = through ? addDays(through, -27) : '';
  const byId = new Map(savings.filter(x => x.agentId).map(x => [x.agentId.toLowerCase(), x]));
  const byName = new Map(savings.map(x => [normName(x.name), x]));
  const weekStart = (i: number): string => (through ? addDays(through, -7 * (8 - i) + 1) : '');
  const rows = Object.keys(store.agents).map(key => {
    const a = store.agents[key];
    const svById = a.id ? byId.get(a.id.toLowerCase()) : undefined;
    const sv = svById || byName.get(normName(a.name));
    let runs28 = 0, runsAll = 0;
    let last: string | null = null;
    const weekly = [0, 0, 0, 0, 0, 0, 0, 0];
    const users = new Map<string, { runs28: number; runsAll: number }>();
    Object.keys(store.days).forEach(d => {
      const people = store.days[d][key];
      if (!people) return;
      Object.keys(people).forEach(u => {
        const n = people[u];
        const t = users.get(u) || { runs28: 0, runsAll: 0 };
        t.runsAll += n; runsAll += n;
        if (d >= from28) { t.runs28 += n; runs28 += n; }
        users.set(u, t);
      });
      if (!last || d > last) last = d;
      for (let i = 0; i < 8; i++) {
        if (d >= weekStart(i) && d < (i === 7 ? addDays(through as string, 1) : weekStart(i + 1))) {
          weekly[i] += Object.keys(people).reduce((t, u) => t + people[u], 0);
        }
      }
    });
    const minutes = sv && sv.minutes !== null && sv.minutes >= 0 ? sv.minutes : null;
    return {
      // The name an admin gave it in the list wins (for apps Microsoft logs without a name).
      key, name: svById?.name || a.name || sv?.name || key, builtBy: sv?.builtBy || '', minutes, listed: !!sv,
      runs28, runsAll, lastUsed: last,
      people28: Array.from(users.values()).filter(u => u.runs28 > 0).length, peopleAll: users.size,
      saved28: minutes === null ? null : runs28 * minutes, savedAll: minutes === null ? null : runsAll * minutes,
      weekly,
      users: Array.from(users.entries()).map(([upn, u]) => ({ upn, name: names.get(upn) || upn, ...u }))
        .sort((x, y) => y.runs28 - x.runs28 || y.runsAll - x.runsAll || x.name.localeCompare(y.name))
    };
  }).filter(r => r.runsAll > 0)
    .sort((x, y) => y.runs28 - x.runs28 || y.runsAll - x.runsAll || x.name.localeCompare(y.name));
  const people28 = new Set<string>();
  rows.forEach(r => r.users.forEach(u => { if (u.runs28) people28.add(u.upn); }));
  return {
    through, since: store.since, pending: store.pending, recountFrom: store.recountFrom, rows,
    runs28: rows.reduce((t, r) => t + r.runs28, 0), runsAll: rows.reduce((t, r) => t + r.runsAll, 0),
    people28: people28.size, agents28: rows.filter(r => r.runs28 > 0).length,
    saved28: rows.reduce((t, r) => t + (r.saved28 || 0), 0), savedAll: rows.reduce((t, r) => t + (r.savedAll || 0), 0),
    noMinutes: rows.filter(r => r.minutes === null).length
  };
}
