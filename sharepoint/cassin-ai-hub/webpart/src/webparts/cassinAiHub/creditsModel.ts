// Copilot credits (Cowork and the other usage-billed services) for the adoption page's Credits
// tab, from Microsoft's Copilot Cost Management API (Graph beta, /copilot/costManagement).
// Pure functions, no Graph calls, so they can be checked on their own.
//
// Microsoft reports credits, not money: no prices, invoices or currency. Service usage comes
// per completed UTC day; per-person usage too (credits and sessions). Field names are taken
// from Microsoft's response examples, and read defensively since the API is a preview.

export type CreditsError = 'consent' | 'role' | 'other';

export interface ICreditDay { date: string; byService: Record<string, number> }
export interface ICreditUser { userId: string; credits: number; sessions: number }
export interface ICreditBalance { purchased: number | null; consumed: number | null; remaining: number | null }

/** What the page reads (and saves for other admins). */
export interface ICreditsRaw {
  days: ICreditDay[]; users: ICreditUser[]; userDays: number; balance: ICreditBalance | null; error: CreditsError | null;
  /** Microsoft's own wording when it refused, to pass on to an administrator. */
  detail?: string;
}

type Row = Record<string, unknown>;
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return isFinite(n) ? Math.max(0, Math.min(n, 1e9)) : null;
};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** One day's service usage records: credits per service id (lower case). */
export function parseServiceRecords(rows: Row[]): Record<string, number> {
  const out: Record<string, number> = {};
  rows.forEach(r => {
    const id = (str(r.serviceId) || str(r.id) || str(r.service)).trim();
    const q = num(r.consumedQuantity ?? r.quantity);
    if (id && q !== null) out[id.toLowerCase()] = (out[id.toLowerCase()] || 0) + q;
  });
  return out;
}

/** One day's per-person records. */
export function parseUserRecords(rows: Row[]): ICreditUser[] {
  return rows.map(r => ({ userId: (str(r.userId) || str(r.id)).toLowerCase(), credits: num(r.consumedQuantity ?? r.quantity) ?? 0, sessions: num(r.sessionCount) ?? 0 }))
    .filter(u => u.userId);
}

/** Adds up the per-person records of several days. */
export function sumUsers(days: ICreditUser[][]): ICreditUser[] {
  const m = new Map<string, ICreditUser>();
  days.forEach(d => d.forEach(u => {
    const t = m.get(u.userId) || { userId: u.userId, credits: 0, sessions: 0 };
    t.credits += u.credits; t.sessions += u.sessions; m.set(u.userId, t);
  }));
  return Array.from(m.values()).filter(u => u.credits > 0 || u.sessions > 0);
}

/** The tenant's credit balance, summed over its billing methods (prepaid, pay-as-you-go). */
export function parseBalance(body: unknown): ICreditBalance | null {
  const list = (body as { billingMethodBalances?: Row[] } | null)?.billingMethodBalances;
  if (!Array.isArray(list) || !list.length) return null;
  const total = (k: string): number | null => {
    const vals = list.map(b => num(b[k])).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  return { purchased: total('purchasedQuantity'), consumed: total('consumedQuantity'), remaining: total('remainingQuantity') };
}

/** The saved copy comes back from a list admins can edit: keep only well-formed values. */
export function cleanCredits(raw: unknown): ICreditsRaw | null {
  const x = raw as Partial<ICreditsRaw> | null;
  if (!x || typeof x !== 'object') return null;
  const days = (Array.isArray(x.days) ? x.days : []).filter(d => d && isDate(d.date)).map(d => {
    const byService: Record<string, number> = {};
    Object.keys(d.byService || {}).forEach(k => { const v = num((d.byService as Record<string, unknown>)[k]); if (/^[\w.-]{1,40}$/.test(k) && v !== null) byService[k.toLowerCase()] = v; });
    return { date: d.date, byService };
  });
  const users = (Array.isArray(x.users) ? x.users : []).map(u => ({ userId: str(u?.userId).toLowerCase(), credits: num(u?.credits) ?? 0, sessions: num(u?.sessions) ?? 0 }))
    .filter(u => /^[0-9a-f-]{36}$/.test(u.userId));
  const b = x.balance as ICreditBalance | null | undefined;
  const balance = b ? { purchased: num(b.purchased), consumed: num(b.consumed), remaining: num(b.remaining) } : null;
  const error = x.error === 'consent' || x.error === 'role' || x.error === 'other' ? x.error : null;
  return { days, users, userDays: Math.min(num(x.userDays) ?? 0, 60), balance, error, detail: str(x.detail).slice(0, 300) };
}

// ---- what the Credits tab shows ----------------------------------------------

const SERVICE_NAMES: Record<string, string> = {
  cowork: 'Cowork', workiq: 'Work IQ', code: 'Code', copilotmanagedruntime: 'Copilot Managed Runtime',
  managedruntime: 'Copilot Managed Runtime', teamsphoneagent: 'Teams Phone Agent',
  advancedworkinsharepoint: 'Advanced work in SharePoint', advancedworkinonedrive: 'Advanced work in OneDrive'
};
/** A readable name for a service id ("workIQ" → "Work IQ"; unknown ids are spaced out). */
export function serviceName(id: string): string {
  const key = id.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SERVICE_NAMES[key] || id.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase());
}

export interface ICreditPerson { userId: string; upn: string | null; name: string; role: string; credits: number; sessions: number; share: number }
export interface ICreditsView {
  error: CreditsError | null;
  detail: string;
  /** Services seen, most credits first; Cowork first if present. */
  services: Array<{ id: string; name: string; last28: number }>;
  days: Array<{ date: string; byService: Record<string, number>; total: number }>;
  coworkLast28: number; coworkPrev28: number | null; allLast28: number; allPrev28: number | null;
  people: ICreditPerson[]; userDays: number; balance: ICreditBalance | null;
  hasUsage: boolean;
}

export function buildCredits(raw: ICreditsRaw | null | undefined,
                             directory: Array<{ upn: string; name: string; title: string; id?: string }>): ICreditsView | null {
  if (!raw) return null;
  const days = [...raw.days].sort((a, b) => a.date.localeCompare(b.date)).map(d => ({
    date: d.date, byService: d.byService, total: Object.keys(d.byService).reduce((t, k) => t + d.byService[k], 0)
  }));
  const last = days.slice(-28), prev = days.length > 28 ? days.slice(-56, -28) : [];
  const sum = (ds: typeof days, k?: string): number => ds.reduce((t, d) => t + (k ? d.byService[k] || 0 : d.total), 0);
  const ids = Array.from(new Set(days.reduce<string[]>((a, d) => a.concat(Object.keys(d.byService)), [])));
  const services = ids.map(id => ({ id, name: serviceName(id), last28: sum(last, id) }))
    .sort((a, b) => (a.id === 'cowork' ? -1 : b.id === 'cowork' ? 1 : b.last28 - a.last28));
  const byId = new Map(directory.filter(d => d.id).map(d => [String(d.id).toLowerCase(), d]));
  const total = raw.users.reduce((t, u) => t + u.credits, 0);
  const people = raw.users.map(u => {
    const d = byId.get(u.userId);
    return { userId: u.userId, upn: d?.upn || null, name: d?.name || 'Unknown person', role: d?.title || '', credits: u.credits, sessions: u.sessions,
      share: total ? Math.round(1000 * u.credits / total) / 10 : 0 };
  }).sort((a, b) => b.credits - a.credits || a.name.localeCompare(b.name));
  const allLast28 = sum(last);
  return {
    error: raw.error, detail: raw.detail || '', services, days,
    coworkLast28: sum(last, 'cowork'), coworkPrev28: prev.length >= 28 ? sum(prev, 'cowork') : null,
    allLast28, allPrev28: prev.length >= 28 ? sum(prev) : null,
    people, userDays: raw.userDays, balance: raw.balance,
    hasUsage: allLast28 > 0 || people.length > 0 || !!raw.balance
  };
}
