// Ported from 2jfitnessapp frontend/src/lib/format.js (commit b7d8e68). The UI translator and locale are injected instead of read from the
// Búnker i18n module (React store), so this package has no UI dependency.
export interface Formatter {
  /** Translates an English source string; {0}, {1}… are replaced by args. */
  t: (source: string, ...args: unknown[]) => string;
  /** BCP-47 locale used for dates and numbers, e.g. 'es-ES'. */
  locale: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
export const isoOf = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const todayISO = (now: Date = new Date()): string => isoOf(now);

export const DAYN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

/** Initials of up to the first two words of a name. */
export function initials(name: string | null | undefined): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0]![0]! + (parts[1]?.[0] || '')).toUpperCase();
}

/**
 * Calendar-only values (YYYY-MM-DD) are kept at local noon so timezone conversion cannot move them to the previous day.
 * Timestamps are parsed as the instant they represent. Numeric strings are epoch milliseconds.
 */
export function dateValue(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(raw + 'T12:00:00')
    : /^\d{10,16}$/.test(raw) ? new Date(Number(raw))
    : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const dateSortValue = (value: unknown): number => dateValue(value)?.getTime() || 0;

export function fmtDate(value: unknown, f: Formatter, long = false): string {
  const d = dateValue(value);
  if (!d) return '—';
  return d.toLocaleDateString(f.locale, long ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short' });
}

/** Minutes below an hour, "Xh Ym" from an hour up. */
export function fmtDur(ms: number): string {
  const m = Math.floor(ms / 60000);
  return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + ' min';
}

/** Imported history has no clock: an unknown duration is left out rather than shown as "0 min". */
export const durPart = (ms: number): string[] => (ms >= 60000 ? [fmtDur(ms)] : []);

/** Non-finite values read as '—', never 'NaN'. Nothing is invented. */
export function fmtNum(n: unknown, f: Formatter): string {
  return Number.isFinite(Number(n)) ? (Math.round(Number(n) * 10) / 10).toLocaleString(f.locale) : '—';
}

export const fmtVol = (v: unknown, unit: string, f: Formatter): string => (Number.isFinite(v) ? fmtNum(v, f) + ' ' + unit : '—');

export const exCount = (n: number, f: Formatter): string => f.t(n === 1 ? '{0} exercise' : '{0} exercises', n);
export const routineCount = (n: number, f: Formatter): string => f.t(n === 1 ? '{0} routine' : '{0} routines', n);
export const daysPerWeekLabel = (n: number, f: Formatter): string => f.t(n === 1 ? '{0} day/week' : '{0} days/week', n);
export const sessionsPerWeekLabel = (n: number, f: Formatter): string => f.t(n === 1 ? '{0} session/week' : '{0} sessions/week', n);
export const weeksLabel = (n: number, f: Formatter): string => f.t(n === 1 ? '{0} week' : '{0} weeks', n);
export const supersetCount = (n: number, f: Formatter): string => f.t(n === 1 ? '{0} superset' : '{0} supersets', n);

/** Age in whole years from an ISO birth date, or null when missing, invalid or out of range. */
export function ageFrom(birthDate: string | null | undefined, now: Date = new Date()): number | null {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (Number.isNaN(b.getTime())) return null;
  let age = now.getFullYear() - b.getFullYear();
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

/** ISO week key 'YYYY-W' for a calendar date. */
export function weekKey(d: string): string {
  const dt = new Date(d + 'T12:00:00');
  const day = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - day + 3);
  const jan4 = new Date(dt.getFullYear(), 0, 4);
  const week = 1 + Math.round(((dt.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return dt.getFullYear() + '-' + week;
}

export const uid = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
