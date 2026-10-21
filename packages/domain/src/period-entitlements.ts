const DAY_MS = 24 * 60 * 60 * 1000;
const BUSINESS_TIME_ZONE = 'Atlantic/Canary';

export type OperationalAccess = 'active' | 'provisional' | 'blocked_unpaid' | 'ended';

export interface EntitlementPeriodWindow {
  readonly startsOn: string;
  readonly endsOn: string | null;
}

export interface PeriodAccessInput extends EntitlementPeriodWindow {
  readonly now: Date;
  readonly recurring: boolean;
  readonly paymentValidated: boolean;
}

function parseDateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError(`Invalid date: ${value}`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new RangeError(`Invalid date: ${value}`);
  }
  return date;
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  return formatDateOnly(new Date(parseDateOnly(value).valueOf() + days * DAY_MS));
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Inclusive Monday-Friday count. Public holidays are intentionally not excluded. */
export function weekdaysInRange(startsOn: string, endsOn: string): number {
  const start = parseDateOnly(startsOn);
  const end = parseDateOnly(endsOn);
  if (end < start) throw new RangeError('endsOn must be on or after startsOn');
  let count = 0;
  for (let day = start.valueOf(); day <= end.valueOf(); day += DAY_MS) {
    const weekday = new Date(day).getUTCDay();
    if (weekday >= 1 && weekday <= 5) count += 1;
  }
  return count;
}

/** Integer ROUND_HALF_UP(days × weekly frequency / 5), with no locale/timezone dependency. */
export function sessionsForPeriod(weekdays: number, weeklyFrequency: number): number {
  if (!Number.isInteger(weekdays) || weekdays < 0) throw new RangeError('weekdays must be a non-negative integer');
  if (!Number.isInteger(weeklyFrequency) || weeklyFrequency < 1 || weeklyFrequency > 5) {
    throw new RangeError('weeklyFrequency must be an integer from 1 to 5');
  }
  return roundHalfUp(weekdays * weeklyFrequency, 5);
}

export function roundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || numerator < 0) throw new RangeError('numerator must be a non-negative safe integer');
  if (!Number.isSafeInteger(denominator) || denominator <= 0) throw new RangeError('denominator must be a positive safe integer');
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

export function proratedSessionsForPayment(
  effectiveActivationOn: string,
  periodEndsOn: string,
  weeklyFrequency: number,
): number {
  return sessionsForPeriod(weekdaysInRange(effectiveActivationOn, periodEndsOn), weeklyFrequency);
}

/** Get the business date using the center's fixed business timezone, independent of host TZ. */
export function canaryBusinessDate(now: Date): string {
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) throw new RangeError('now must be a valid Date');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type: 'year' | 'month' | 'day') => parts.find((entry) => entry.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Convert a Canary local midnight to its exact UTC instant, including DST changes. */
export function canaryLocalMidnightUtc(localDate: string): Date {
  parseDateOnly(localDate);
  const target = Date.parse(`${localDate}T00:00:00.000Z`);
  let candidate = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(candidate);
    const part = (type: string) => parts.find((entry) => entry.type === type)?.value;
    const observed = `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}.000Z`;
    const adjustment = target - Date.parse(observed);
    if (adjustment === 0) return new Date(candidate);
    candidate += adjustment;
  }
  throw new RangeError('Could not resolve Canary local midnight');
}

/** Earliest next period boundary Platform already knows for one entitlement period. */
export function nextPeriodAccessTransition(input: PeriodAccessInput): Date | null {
  const today = canaryBusinessDate(input.now);
  const candidates: Date[] = [];
  if (input.startsOn > today) candidates.push(canaryLocalMidnightUtc(input.startsOn));
  if (input.endsOn !== null && input.endsOn >= today) candidates.push(canaryLocalMidnightUtc(addDays(input.endsOn, 1)));
  if (!input.paymentValidated && input.recurring && derivePeriodAccess(input) === 'provisional') {
    const graceCutoff = `${input.startsOn.slice(0, 7)}-11`;
    candidates.push(canaryLocalMidnightUtc(graceCutoff));
  }
  return candidates.filter((candidate) => candidate.getTime() > input.now.getTime()).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
}

/**
 * Derive operational access for one recurring monthly period. The 10th remains
 * available for the entire Canary business date; blocking begins on the 11th.
 */
export function derivePeriodAccess(input: PeriodAccessInput): OperationalAccess {
  const today = canaryBusinessDate(input.now);
  parseDateOnly(input.startsOn);
  if (input.endsOn !== null) parseDateOnly(input.endsOn);
  if (input.endsOn !== null && input.endsOn < input.startsOn) throw new RangeError('endsOn must be on or after startsOn');
  if (input.endsOn !== null && today > input.endsOn) return 'ended';
  if (today < input.startsOn) return 'blocked_unpaid';
  if (input.paymentValidated) return 'active';
  if (input.recurring && today <= `${input.startsOn.slice(0, 7)}-10`) return 'provisional';
  return 'blocked_unpaid';
}

export interface MonthlyPeriod {
  readonly startsOn: string;
  readonly endsOn: string;
  readonly idempotencyKey: string;
}

/** Construct only the immediate next calendar-month period; callers persist with this unique key. */
export function nextMonthlyPeriod(
  assignmentId: string,
  current: EntitlementPeriodWindow,
  recurrenceEnabled: boolean,
): MonthlyPeriod | null {
  if (!recurrenceEnabled || current.endsOn === null) return null;
  const start = parseDateOnly(current.startsOn);
  const end = parseDateOnly(current.endsOn);
  const expectedLastDay = lastDayOfMonth(start.getUTCFullYear(), start.getUTCMonth() + 1);
  if (end.getUTCDate() !== expectedLastDay || end.getUTCMonth() !== start.getUTCMonth() || end.getUTCFullYear() !== start.getUTCFullYear()) {
    throw new RangeError('recurrence requires a complete natural-month period');
  }
  const nextStart = addDays(current.endsOn, 1);
  const nextStartDate = parseDateOnly(nextStart);
  const nextEnd = formatDateOnly(new Date(Date.UTC(nextStartDate.getUTCFullYear(), nextStartDate.getUTCMonth() + 1, 0)));
  return {
    startsOn: nextStart,
    endsOn: nextEnd,
    idempotencyKey: `period:${assignmentId}:${nextStart}`,
  };
}

/** A balance is intentionally scoped to a single period; it never falls through to another bag. */
export function availablePeriodBalance(entries: readonly { readonly quantity: number }[]): number {
  return entries.reduce((balance, entry) => balance + entry.quantity, 0);
}

export function mayConsumeFromPeriod(balance: number, quantity: number): boolean {
  return Number.isInteger(balance) && Number.isInteger(quantity) && balance >= quantity && quantity > 0;
}
