// Copilot adoption: turns Microsoft's Copilot usage reports (Microsoft Graph), the Entra ID
// directory and the hub's monthly snapshots into what the admin page shows. Pure functions,
// no SharePoint or Graph calls, so they can be checked on their own (adoptionModel.test.ts).
//
// Microsoft documents the v2 per-person fields (active usage days, prompts submitted) only
// in prose, not by property name, so fields are found by name pattern rather than hard-coded.
// If Microsoft's report doesn't carry them, `hasDays` / `hasPrompts` are false and the page
// says so instead of showing zeros.

export type Row = Record<string, unknown>;
export type Move = 'new' | 'ramped_up' | 'steady' | 'cooled' | 'lapsed';

export const STAGES = [
  { key: 'inactive', label: 'Inactive', range: '0 days', color: '#E1E5EA' },
  { key: 'beginner', label: 'Beginner', range: '1–5 days', color: '#B9D7EE' },
  { key: 'developing', label: 'Developing', range: '6–10 days', color: '#6FA9D6' },
  { key: 'habitual', label: 'Habitual', range: '11–15 days', color: '#2A73B0' },
  { key: 'power', label: 'Power', range: '16+ days', color: '#00426C' }
] as const;

export const MOVES: Record<Move, string> = {
  new: 'New', ramped_up: 'Ramped up', steady: 'Steady', cooled: 'Cooled', lapsed: 'Lapsed'
};

/** Habit stage from active days in a 28-day window (the bands in Microsoft's ValueLens). */
export const stageOf = (days: number): number => days <= 0 ? 0 : days <= 5 ? 1 : days <= 10 ? 2 : days <= 15 ? 3 : 4;

/** Roles smaller than this are combined into "Other" to keep the table readable. */
export const MIN_GROUP = 5;

export interface IApp { key: string; label: string; letter: string }

// Matched in order against the normalised "...LastActivityDate" field name.
const APP_RULES: Array<[RegExp, IApp]> = [
  [/chatweb/, { key: 'chatweb', label: 'Copilot Chat (web)', letter: 'Cw' }],
  [/chat/, { key: 'chat', label: 'Copilot Chat', letter: 'C' }],
  [/teams/, { key: 'teams', label: 'Teams', letter: 'T' }],
  [/outlook/, { key: 'outlook', label: 'Outlook', letter: 'O' }],
  [/word/, { key: 'word', label: 'Word', letter: 'W' }],
  [/excel/, { key: 'excel', label: 'Excel', letter: 'X' }],
  [/powerpoint/, { key: 'powerpoint', label: 'PowerPoint', letter: 'P' }],
  [/onenote/, { key: 'onenote', label: 'OneNote', letter: 'N' }],
  [/loop/, { key: 'loop', label: 'Loop', letter: 'L' }],
  [/agent/, { key: 'agents', label: 'Agents', letter: 'A' }],
  [/edge/, { key: 'edge', label: 'Edge', letter: 'E' }],
  [/microsoft365copilot|m365copilot/, { key: 'm365app', label: 'Microsoft 365 Copilot app', letter: 'M' }]
];

export const norm = (k: string): string => k.toLowerCase().replace(/[^a-z0-9]/g, '');

const DAY = 864e5;
export const toDate = (s: string): Date => new Date(`${s.slice(0, 10)}T00:00:00Z`);
export const daysBetween = (a: string, b: string): number => Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY);
export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v);
  return null;
}
function asDate(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

/**
 * One report row as a flat map of normalised field name to value. Older report versions
 * nest per-period figures in an array of { reportPeriod, ... }; the entry for `periodDays`
 * is merged in.
 */
export function flatten(row: Row, periodDays: number): Map<string, unknown> {
  const out = new Map<string, unknown>();
  Object.keys(row).forEach(k => {
    const v = row[k];
    if (Array.isArray(v)) {
      const match = v.find(e => e && typeof e === 'object' &&
        String((e as Row).reportPeriod ?? (e as Row)['Report Period'] ?? '').replace(/\D/g, '') === String(periodDays));
      if (match) Object.keys(match as Row).forEach(m => out.set(norm(m), (match as Row)[m]));
    } else {
      out.set(norm(k), v);
    }
  });
  return out;
}

// Picks the field for a figure: every key passing `test`, preferring the all-apps total.
function pickKey(keys: string[], test: (k: string) => boolean): string | null {
  const hits = keys.filter(test);
  if (!hits.length) return null;
  const allApps = hits.find(k => /allapps|anyapp|total/.test(k));
  return allApps || hits.sort((a, b) => a.length - b.length)[0];
}
export const daysKey = (keys: string[]): string | null =>
  pickKey(keys, k => /active(usage)?days/.test(k) && !/average|avg/.test(k));
export const promptsKey = (keys: string[]): string | null =>
  pickKey(keys, k => /prompt/.test(k) && !/average|avg/.test(k) &&
    // Prefer the all-apps figure over Copilot Chat's own.
    !(/chat/.test(k) && keys.some(o => /prompt/.test(o) && !/chat|average|avg/.test(o))));

export interface IUsage {
  upn: string; name: string; refresh: string | null; last: string | null;
  apps: Record<string, string>; days: number | null; prompts: number | null;
}

export interface IUsageReport {
  rows: IUsage[]; apps: IApp[]; refresh: string | null;
  hasDays: boolean; hasPrompts: boolean; fields: string[];
}

/** Parses the Copilot usage user detail report for one period (28 or 180 days). */
export function parseUsage(raw: Row[], periodDays: number): IUsageReport {
  const flat = raw.map(r => flatten(r, periodDays));
  const keySet = new Set<string>();
  flat.forEach(m => m.forEach((_, k) => keySet.add(k)));
  const keys = Array.from(keySet);
  const dk = daysKey(keys), pk = promptsKey(keys);
  const appKeys: Array<[string, IApp]> = [];
  keys.filter(k => k.endsWith('lastactivitydate') && k !== 'lastactivitydate').forEach(k => {
    const rule = APP_RULES.find(([re]) => re.test(k.replace(/lastactivitydate$/, '')));
    if (rule && !appKeys.some(([, a]) => a.key === rule[1].key)) appKeys.push([k, rule[1]]);
  });
  let refresh: string | null = null;
  const rows = flat.map(m => {
    const r = asDate(m.get('reportrefreshdate'));
    if (r && (!refresh || r > refresh)) refresh = r;
    const apps: Record<string, string> = {};
    appKeys.forEach(([k, a]) => { const d = asDate(m.get(k)); if (d) apps[a.key] = d; });
    return {
      upn: String(m.get('userprincipalname') ?? ''),
      name: String(m.get('displayname') ?? ''),
      refresh: r,
      last: asDate(m.get('lastactivitydate')),
      apps,
      days: dk ? asNumber(m.get(dk)) : null,
      prompts: pk ? asNumber(m.get(pk)) : null
    };
  }).filter(u => u.upn);
  const order = APP_RULES.map(([, a]) => a.key);
  return {
    rows, refresh, hasDays: !!dk, hasPrompts: !!pk, fields: keys,
    apps: appKeys.map(([, a]) => a).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  };
}

/** Minimal CSV reader for when Graph answers with a CSV file instead of JSON. */
export function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let cell = '', row: string[] = [], quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = ''; if (row.some(x => x !== '')) rows.push(row); row = [];
    } else cell += c;
  }
  row.push(cell); if (row.some(x => x !== '')) rows.push(row);
  const [head, ...body] = rows;
  if (!head) return [];
  return body.map(r => { const o: Row = {}; head.forEach((h, i) => { o[h] = r[i] ?? ''; }); return o; });
}

export interface ITrendPoint {
  date: string; active: number; enabled: number;
  /** Prompts submitted that day, when Microsoft's report carries them (its updated version does). */
  prompts: number | null;
}

/** Parses the user count trend report: one point per day. */
export function parseTrend(raw: Row[]): ITrendPoint[] {
  const points: Row[] = [];
  raw.forEach(r => {
    const nested = Object.keys(r).map(k => r[k]).find(v => Array.isArray(v) && v.length && typeof v[0] === 'object');
    if (Array.isArray(nested)) points.push(...(nested as Row[])); else points.push(r);
  });
  const flat = points.map(p => flatten(p, 0));
  const keySet = new Set<string>();
  flat.forEach(m => m.forEach((_, k) => keySet.add(k)));
  const pk = promptsKey(Array.from(keySet));
  return flat.map(m => {
    const date = asDate(m.get('reportdate'));
    const active = asNumber(m.get('anyappactiveusers'));
    const enabled = asNumber(m.get('anyappenabledusers'));
    return date && active !== null ? { date, active, enabled: enabled ?? 0, prompts: pk ? asNumber(m.get(pk)) : null } : null;
  }).filter((p): p is ITrendPoint => !!p).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Microsoft's daily "enabled users" count has gaps: days at 0 and weekend dips while licences
 * are being assigned. Licences don't come and go daily, so a 0 carries the last count forward
 * and each day takes the highest count of its week.
 */
export function steadyEnabled(trend: ITrendPoint[]): ITrendPoint[] {
  let last = 0;
  const carried = trend.map(t => { if (t.enabled > 0) last = t.enabled; return last; });
  return trend.map((t, i) => ({ ...t, enabled: Math.max(...carried.slice(Math.max(0, i - 6), i + 1)) }));
}

export interface IDirectoryUser { upn: string; name: string; title: string }

/** One saved month: active days and prompts per person over the 28 days ending `refresh`. */
export interface ISnapshot {
  month: string; refresh: string; licensed: number; people: Record<string, [number, number]>;
  /** The list item, when read from the hub. */
  id?: number;
}

/** The month a 28-day window ending on `refresh` mostly covers (YYYY-MM). */
export const snapshotMonth = (refresh: string): string => isoDate(new Date(toDate(refresh).getTime() - 14 * DAY)).slice(0, 7);

export function makeSnapshot(rows: IUsage[], refresh: string, licensed: number): ISnapshot {
  const people: Record<string, [number, number]> = {};
  rows.forEach(r => { if (r.days) people[r.upn.toLowerCase()] = [r.days, r.prompts ?? 0]; });
  return { month: snapshotMonth(refresh), refresh, licensed, people };
}

export interface IPerson {
  upn: string; name: string; role: string;
  days: number | null; prompts: number | null; last: string | null; apps: Record<string, string>;
  appsRecent: string[]; stage: number | null; move: Move | null;
  status: 'active' | 'never' | 'lapsed';
  monthly: Array<number | null>;
}

export interface IGroupRow {
  name: string; people: number; activePct: number; habitualPct: number; medianDays: number;
  promptsPerPerson: number | null; appsPerPerson: number | null; movedUp: number; dropped: number;
  stages: number[];
}

export interface IAdoption {
  refresh: string | null; licensed: number; people: IPerson[]; apps: IApp[];
  hasDays: boolean; hasPrompts: boolean; hasMoves: boolean; namesHidden: boolean;
  trend: ITrendPoint[]; months: string[]; monthStages: number[][]; nowStages: number[];
  appCounts: Array<{ app: IApp; users: number }>;
  roles: IGroupRow[]; moves: Record<Move, number>;
  /** Prompts in the last 28 days, the monthly average over the five months before (from the
   * 180-day report), and each saved month's total. Null when the report has no prompt counts. */
  promptsNow: number | null; promptsBefore: number | null; monthPrompts: number[];
  hasDailyPrompts: boolean;
  fields: string[];
}

const median = (a: number[]): number => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

function moveOf(d28: number | null, d180: number | null): Move | null {
  if (d28 === null || d180 === null) return null;
  // The 180-day figure includes the last 28 days; compare against the 152 days before,
  // scaled to a 28-day month.
  const before = stageOf(Math.round(Math.max(0, d180 - d28) * 28 / 152));
  const now = stageOf(d28);
  if (before === 0 && now === 0) return null;
  if (before === 0) return 'new';
  if (now === 0) return 'lapsed';
  return now > before ? 'ramped_up' : now < before ? 'cooled' : 'steady';
}

function groupRows(people: IPerson[], key: (p: IPerson) => string): IGroupRow[] {
  const groups = new Map<string, IPerson[]>();
  people.forEach(p => { const k = key(p) || 'Not set'; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(p); });
  // Combine small groups into "Other".
  const other: IPerson[] = [];
  Array.from(groups.keys()).forEach(k => { if (groups.get(k)!.length < MIN_GROUP) { other.push(...groups.get(k)!); groups.delete(k); } });
  if (other.length) groups.set('Other', [...(groups.get('Other') || []), ...other]);
  return Array.from(groups.entries()).map(([name, g]) => {
    const act = g.filter(p => (p.days ?? 0) > 0);
    const withPrompts = act.filter(p => p.prompts !== null);
    return {
      name, people: g.length,
      activePct: Math.round(100 * g.filter(p => p.status === 'active').length / g.length),
      habitualPct: Math.round(100 * g.filter(p => (p.stage ?? 0) >= 3).length / g.length),
      medianDays: median(act.map(p => p.days as number)),
      promptsPerPerson: withPrompts.length ? Math.round(withPrompts.reduce((s, p) => s + (p.prompts as number), 0) / withPrompts.length) : null,
      appsPerPerson: act.length ? Math.round(10 * act.reduce((s, p) => s + p.appsRecent.length, 0) / act.length) / 10 : null,
      movedUp: g.filter(p => p.move === 'new' || p.move === 'ramped_up').length,
      dropped: g.filter(p => p.move === 'cooled' || p.move === 'lapsed').length,
      stages: STAGES.map((_, s) => g.filter(p => p.stage === s).length)
    };
  }).sort((a, b) => b.habitualPct - a.habitualPct || b.activePct - a.activePct || a.name.localeCompare(b.name));
}

function cleanSnapshot(s: ISnapshot): ISnapshot | null {
  if (!s || typeof s.month !== 'string' || !/^\d{4}-\d{2}$/.test(s.month) || !s.people || typeof s.people !== 'object') return null;
  const num = (v: unknown): number => { const n = Math.round(Number(v)); return isFinite(n) && n > 0 ? Math.min(n, 100000) : 0; };
  const people: Record<string, [number, number]> = {};
  Object.keys(s.people).forEach(k => {
    const v = s.people[k];
    if (Array.isArray(v) && num(v[0])) people[k.toLowerCase()] = [Math.min(num(v[0]), 31), num(v[1])];
  });
  return { month: s.month, refresh: String(s.refresh || ''), licensed: num(s.licensed), people, id: s.id };
}

/**
 * The figures an account with Microsoft's reports access saves for everyone else who can open
 * the page (owners, AI Hub Admins), so they don't each need that access in Entra ID. Read
 * back from a list admins can edit, so every value is checked before use.
 */
export interface IStoredAdoption {
  v: 1; savedAt: string; usage28: IUsageReport; usage180: IUsageReport | null; trend: ITrendPoint[]; directory: IDirectoryUser[];
}

const APP_BY_KEY: Record<string, IApp> = {};
APP_RULES.forEach(([, a]) => { APP_BY_KEY[a.key] = a; });
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | null => { const n = asNumber(v); return n === null ? null : Math.max(0, Math.min(n, 1e7)); };

function cleanReport(r: unknown): IUsageReport | null {
  const x = r as Partial<IUsageReport> | null;
  if (!x || !Array.isArray(x.rows)) return null;
  const rows: IUsage[] = x.rows.map(u => {
    const apps: Record<string, string> = {};
    const raw = (u && typeof u.apps === 'object' && u.apps) || {};
    Object.keys(raw).forEach(k => { const d = asDate((raw as Record<string, unknown>)[k]); if (APP_BY_KEY[k] && d) apps[k] = d; });
    return { upn: str(u?.upn), name: str(u?.name), refresh: asDate(u?.refresh), last: asDate(u?.last), apps, days: num(u?.days), prompts: num(u?.prompts) };
  }).filter(u => u.upn);
  const apps = (Array.isArray(x.apps) ? x.apps : []).map(a => APP_BY_KEY[str((a as IApp)?.key)]).filter((a): a is IApp => !!a);
  return { rows, apps, refresh: asDate(x.refresh), hasDays: x.hasDays === true, hasPrompts: x.hasPrompts === true, fields: [] };
}

export function cleanStored(raw: unknown): IStoredAdoption | null {
  const x = raw as Partial<IStoredAdoption> | null;
  if (!x || x.v !== 1) return null;
  const usage28 = cleanReport(x.usage28);
  if (!usage28) return null;
  const trend = (Array.isArray(x.trend) ? x.trend : []).map(t => {
    const date = asDate(t?.date), active = num(t?.active);
    return date && active !== null ? { date, active, enabled: num(t?.enabled) ?? 0, prompts: num(t?.prompts) } : null;
  }).filter((t): t is ITrendPoint => !!t);
  const directory = (Array.isArray(x.directory) ? x.directory : []).map(d => ({ upn: str(d?.upn), name: str(d?.name), title: str(d?.title) })).filter(d => d.upn);
  return { v: 1, savedAt: str(x.savedAt), usage28, usage180: cleanReport(x.usage180), trend, directory };
}

export interface IAdoptionInput {
  usage28: IUsageReport; usage180: IUsageReport | null; trend: ITrendPoint[];
  directory: IDirectoryUser[]; snapshots: ISnapshot[]; maxMonths?: number;
}

export function buildAdoption(input: IAdoptionInput): IAdoption {
  const { usage28, usage180, directory } = input;
  const trend = steadyEnabled(input.trend);
  const refresh = usage28.refresh;
  const dir = new Map(directory.map(d => [d.upn.toLowerCase(), d]));
  const d180 = new Map((usage180?.rows || []).map(r => [r.upn.toLowerCase(), r.days]));
  const p180 = new Map((usage180?.rows || []).map(r => [r.upn.toLowerCase(), r.prompts]));
  const hasMoves = !!usage180?.hasDays && usage28.hasDays;

  // Months already complete, oldest first; the month the current window falls in is shown
  // as "Last 28 days" instead.
  const current = refresh ? snapshotMonth(refresh) : '';
  // Snapshots come back from a SharePoint list that admins can edit by hand, so keep only
  // well-formed months and numbers: nothing from the list reaches the page as text.
  const snaps = input.snapshots.map(cleanSnapshot).filter((s): s is ISnapshot => !!s && s.month < current).sort((a, b) => a.month.localeCompare(b.month))
    .slice(-(input.maxMonths ?? 6));

  const people: IPerson[] = usage28.rows.map(u => {
    const key = u.upn.toLowerCase();
    const d = dir.get(key);
    const appsRecent = Object.keys(u.apps).filter(a => !refresh || daysBetween(u.apps[a], refresh) <= 28);
    const recent = !!u.last && (!refresh || daysBetween(u.last, refresh) <= 28);
    const status: IPerson['status'] = !u.last ? 'never' : recent ? 'active' : 'lapsed';
    const days = usage28.hasDays ? (u.days ?? 0) : null;
    return {
      upn: u.upn, name: d?.name || u.name || u.upn, role: d?.title || '',
      days, prompts: usage28.hasPrompts ? (u.prompts ?? 0) : null, last: u.last, apps: u.apps, appsRecent,
      stage: days === null ? null : stageOf(days),
      move: hasMoves ? moveOf(days, d180.get(key) ?? 0) : (status === 'lapsed' ? 'lapsed' : null),
      status,
      monthly: snaps.map(s => (s.people[key] ? s.people[key][0] : 0))
    };
  });

  // With concealed names on, Microsoft replaces names with hashes that match no one in Entra ID.
  const hashed = people.filter(p => /^[0-9A-F]{32}$/i.test(p.upn)).length;
  const namesHidden = people.length > 0 && hashed / people.length > 0.5;

  const latestTrend = trend.length ? trend[trend.length - 1] : null;
  const licensed = Math.max(people.length, latestTrend?.enabled || 0);

  const monthStages = snaps.map(s => {
    const counts = [0, 0, 0, 0, 0];
    Object.keys(s.people).forEach(k => { counts[stageOf(s.people[k][0])]++; });
    counts[0] = Math.max(0, s.licensed - counts.slice(1).reduce((a, b) => a + b, 0));
    return counts;
  });
  const nowStages = STAGES.map((_, s) => people.filter(p => p.stage === s).length);

  // Prompts: the 180-day figure includes the last 28 days, so the five months before are the
  // difference, scaled to a 28-day month (as for active days).
  const promptsNow = usage28.hasPrompts ? people.reduce((t, p) => t + (p.prompts ?? 0), 0) : null;
  let promptsBefore: number | null = null;
  if (promptsNow !== null && usage180?.hasPrompts) {
    const before = usage28.rows.reduce((t, u) => t + Math.max(0, (p180.get(u.upn.toLowerCase()) ?? 0) - (u.prompts ?? 0)), 0);
    promptsBefore = Math.round(before * 28 / 152);
  }

  const moves = { new: 0, ramped_up: 0, steady: 0, cooled: 0, lapsed: 0 } as Record<Move, number>;
  people.forEach(p => { if (p.move) moves[p.move]++; });

  return {
    refresh, licensed, people, apps: usage28.apps,
    hasDays: usage28.hasDays, hasPrompts: usage28.hasPrompts, hasMoves, namesHidden,
    trend, months: snaps.map(s => s.month), monthStages, nowStages,
    // Apps nobody used in the window (Loop, Edge, ...) are left out.
    appCounts: usage28.apps.map(app => ({ app, users: people.filter(p => p.appsRecent.indexOf(app.key) >= 0).length }))
      .filter(a => a.users > 0).sort((a, b) => b.users - a.users),
    roles: groupRows(people, p => p.role),
    moves, promptsNow, promptsBefore,
    monthPrompts: snaps.map(sn => Object.keys(sn.people).reduce((t, k) => t + sn.people[k][1], 0)),
    hasDailyPrompts: trend.some(t => t.prompts !== null),
    fields: usage28.fields
  };
}
