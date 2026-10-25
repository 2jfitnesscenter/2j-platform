const DAY_MS = 24 * 60 * 60 * 1000;
const BUSINESS_TIME_ZONE = 'Atlantic/Canary';

export type OperationalAccess = 'active' | 'provisional' | 'blocked_unpaid' | 'ended';

export interface EntitlementPeriodWindow {
  readonly startsOn: string;
  readonly endsOn: string | null;
}

export interface ContractMonthlyEntitlementPeriod extends EntitlementPeriodWindow {
  readonly periodIndex: number;
  readonly startsOn: string;
  readonly endsOn: string;
}

export type ContractQuantityRule = 'weekday_ratio_v1' | 'fixed_v1' | 'unlimited';
export type ContractQuantityTermKind = 'natural_month' | 'custom_range' | 'rolling_months' | 'pack' | 'one_off';

export interface ContractQuantityRuleInput {
  readonly termKind: ContractQuantityTermKind | null;
  readonly rightType: string;
  readonly quantityRule: ContractQuantityRule | null;
  readonly quantity: number | null;
  readonly weeklyFrequency: number | null;
}

export type ContractQuantityRuleError = 'quantity_rule_not_allowed' | 'quantity_rule_required' | 'quantity_invalid' | 'weekly_frequency_invalid';

export class EntitlementMaterializationError extends Error {
  readonly code: 'bag_empty' | 'contract_terms_missing' | 'quantity_rule_invalid' | 'payment_activation_required' | 'idempotency_conflict';
  constructor(code: 'bag_empty' | 'contract_terms_missing' | 'quantity_rule_invalid' | 'payment_activation_required' | 'idempotency_conflict') {
    super(code);
    this.name = 'EntitlementMaterializationError';
    this.code = code;
  }
}

/** Split an already-determined contract range at natural month boundaries. */
export function splitContractIntoMonthlyEntitlementPeriods(contractStart: string, contractEnd: string): ContractMonthlyEntitlementPeriod[] {
  try { parseDateOnly(contractStart); parseDateOnly(contractEnd); }
  catch { throw new RangeError('contract dates must be valid YYYY-MM-DD values'); }
  if (contractEnd < contractStart) throw new RangeError('contractEnd must be on or after contractStart');
  const periods: ContractMonthlyEntitlementPeriod[] = [];
  let startsOn = contractStart;
  while (startsOn <= contractEnd) {
    const year = Number(startsOn.slice(0, 4));
    const month = Number(startsOn.slice(5, 7));
    const monthEndDate = new Date(0);
    monthEndDate.setUTCHours(0, 0, 0, 0);
    monthEndDate.setUTCFullYear(year, month, 0);
    const monthEnd = monthEndDate.toISOString().slice(0, 10);
    const endsOn = monthEnd < contractEnd ? monthEnd : contractEnd;
    periods.push({ periodIndex: periods.length, startsOn, endsOn });
    if (endsOn === contractEnd) break;
    startsOn = addDays(endsOn, 1);
  }
  return periods;
}

/** Check the quantity semantics for a term-enabled right; legacy rights stay outside this model. */
export function validateContractQuantityRule(input: ContractQuantityRuleInput): { valid: true } | { valid: false; error: ContractQuantityRuleError } {
  if (input.rightType !== 'sessions_quota') return input.quantityRule == null ? { valid: true } : { valid: false, error: 'quantity_rule_not_allowed' };
  if (input.termKind == null) return input.quantityRule == null ? { valid: true } : { valid: false, error: 'quantity_rule_not_allowed' };
  if (input.quantityRule == null) return { valid: false, error: 'quantity_rule_required' };
  if (input.quantityRule === 'weekday_ratio_v1') {
    if (input.termKind === 'pack' || input.termKind === 'one_off') return { valid: false, error: 'quantity_rule_not_allowed' };
    if (input.quantity != null) return { valid: false, error: 'quantity_invalid' };
    if (input.weeklyFrequency == null || !Number.isInteger(input.weeklyFrequency) || input.weeklyFrequency < 1 || input.weeklyFrequency > 5) return { valid: false, error: 'weekly_frequency_invalid' };
    return { valid: true };
  }
  if (input.quantityRule === 'unlimited') {
    if (input.termKind === 'pack' || input.termKind === 'one_off') return { valid: false, error: 'quantity_rule_not_allowed' };
    if (input.quantity != null) return { valid: false, error: 'quantity_invalid' };
    if (input.weeklyFrequency != null) return { valid: false, error: 'weekly_frequency_invalid' };
    return { valid: true };
  }
  if (input.termKind !== 'pack' && input.termKind !== 'one_off') return { valid: false, error: 'quantity_rule_not_allowed' };
  if (!Number.isInteger(input.quantity) || input.quantity! < 1 || input.quantity! > 100000) return { valid: false, error: 'quantity_invalid' };
  if (input.weeklyFrequency != null) return { valid: false, error: 'weekly_frequency_invalid' };
  return { valid: true };
}

export interface FixedEntitlementPeriodCandidate {
  readonly periodIndex: 0;
  readonly entitlementMode: 'quota';
  readonly formulaId: 'fixed_v1';
  readonly periodStart: string;
  readonly periodEnd: string | null;
  readonly sessionsGranted: number;
}

/** Build (but do not activate or persist) a fixed-quantity period candidate for a future validated-payment coordinator. */
export function buildFixedEntitlementPeriodCandidate(activationDate: string, quantity: number, validDays: number | null): FixedEntitlementPeriodCandidate {
  try { parseDateOnly(activationDate); } catch { throw new RangeError('activationDate must be a valid YYYY-MM-DD value'); }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) throw new RangeError('quantity must be an integer from 1 to 100000');
  if (validDays != null && (!Number.isInteger(validDays) || validDays < 1 || validDays > 3660)) throw new RangeError('validDays must be an integer from 1 to 3660');
  return { periodIndex: 0, entitlementMode: 'quota', formulaId: 'fixed_v1', periodStart: activationDate, periodEnd: validDays == null ? null : addDays(activationDate, validDays - 1), sessionsGranted: quantity };
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
  const days = Math.floor((end.valueOf() - start.valueOf()) / DAY_MS) + 1;
  const weeks = Math.floor(days / 7);
  let count = weeks * 5;
  const remainder = days % 7;
  for (let offset = 0; offset < remainder; offset += 1) {
    const weekday = new Date(start.valueOf() + offset * DAY_MS).getUTCDay();
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
