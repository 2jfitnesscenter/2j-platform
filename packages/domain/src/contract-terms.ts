export const CONTRACT_TERM_KINDS = ['natural_month', 'custom_range', 'rolling_months', 'pack', 'one_off'] as const;
export type ContractTermKind = typeof CONTRACT_TERM_KINDS[number];

export type ContractRangeError = 'invalid_date' | 'custom_range_invalid' | 'custom_range_before_assignment' | 'custom_range_exceeds_max_span';

export interface ContractPaymentDeadlineInput {
  readonly termKind: 'natural_month' | 'custom_range' | 'rolling_months';
  readonly assignedLocalDate: string;
  readonly contractStart: string;
  readonly contractEnd: string;
  readonly dueDay: number;
  readonly graceDays: number;
}

export interface ContractPaymentDeadline {
  readonly rule: 'monthly_day10_v1' | 'grace_from_assignment_v1';
  readonly assignedLocalDate: string;
  readonly inputs: { readonly dueDay: number } | { readonly graceDays: number };
  readonly dueOn: string;
  /** Payment remains valid through dueOn; an enforced access block begins at this local date's midnight. */
  readonly accessBlockEffectiveOn: string;
}

/** Calculate the authoritative inclusive payment date using date-only Atlantic/Canary business dates. */
export function calculateContractPaymentDeadline(input: ContractPaymentDeadlineInput): ContractPaymentDeadline {
  parseDateOnly(input.assignedLocalDate);
  const start = parseDateOnly(input.contractStart);
  const end = parseDateOnly(input.contractEnd);
  let dueOn: string;
  let rule: ContractPaymentDeadline['rule'];
  let inputs: ContractPaymentDeadline['inputs'];
  if (input.termKind === 'natural_month') {
    const validation = validateNaturalMonthContract(input.assignedLocalDate, input.contractStart, input.contractEnd);
    if (!validation.valid) throw new RangeError(validation.error);
    if (!Number.isInteger(input.dueDay) || input.dueDay < 1 || input.dueDay > 28) throw new RangeError('dueDay must be an integer from 1 to 28');
    dueOn = formatDateOnly({ year: start.year, month: start.month, day: input.dueDay });
    rule = 'monthly_day10_v1';
    inputs = { dueDay: input.dueDay };
  } else {
    if (dateOrdinal(start) < dateOrdinal(parseDateOnly(input.assignedLocalDate)) || dateOrdinal(end) < dateOrdinal(start)) throw new RangeError('contract range must start on or after assignment and end on or after start');
    if (!Number.isInteger(input.graceDays) || input.graceDays < 1 || input.graceDays > 60) throw new RangeError('graceDays must be an integer from 1 to 60');
    dueOn = addDateDays(input.assignedLocalDate, input.graceDays);
    rule = 'grace_from_assignment_v1';
    inputs = { graceDays: input.graceDays };
  }
  // Keep the payment deadline (inclusive) separate from the next local midnight when access can be blocked.
  return { rule, assignedLocalDate: input.assignedLocalDate, inputs, dueOn, accessBlockEffectiveOn: addDateDays(dueOn, 1) };
}

/** Contract anniversary arithmetic on strict DATE-only values; supported terms are the approved 3/6/12 months. */
export function calculateContractEnd(startDate: string, termMonths: number): string {
  const start = parseDateOnly(startDate);
  if (![3, 6, 12].includes(termMonths)) throw new RangeError('termMonths must be 3, 6, or 12');
  const targetIndex = start.year * 12 + start.month - 1 + termMonths;
  const targetYear = Math.floor(targetIndex / 12);
  if (targetYear > 9999) throw new RangeError('calculated contract end exceeds supported date range');
  const targetMonth = targetIndex % 12 + 1;
  const targetLastDay = daysInMonth(targetYear, targetMonth);
  const startIsMonthEnd = start.day === daysInMonth(start.year, start.month);
  if (startIsMonthEnd) return formatDateOnly({ year: targetYear, month: targetMonth, day: targetLastDay });
  const anniversary = { year: targetYear, month: targetMonth, day: Math.min(start.day, targetLastDay) };
  return formatDateOnly(addDateDays(anniversary, -1));
}

/** Natural-month product: the service month starts on day one and cannot already have begun at assignment time. */
export function validateNaturalMonthContract(assignedLocalDate: string, contractStart: string, contractEnd: string): { valid: true } | { valid: false; error: 'invalid_date' | 'natural_month_invalid' | 'natural_month_already_started' } {
  let assigned: DateOnly, start: DateOnly, end: DateOnly;
  try { assigned = parseDateOnly(assignedLocalDate); start = parseDateOnly(contractStart); end = parseDateOnly(contractEnd); }
  catch { return { valid: false, error: 'invalid_date' }; }
  if (dateOrdinal(assigned) > dateOrdinal(start)) return { valid: false, error: 'natural_month_already_started' };
  if (start.day !== 1 || start.year !== end.year || start.month !== end.month || end.day !== daysInMonth(end.year, end.month)) return { valid: false, error: 'natural_month_invalid' };
  return { valid: true };
}

/** Validates a custom range using inclusive calendar days; it never changes price or session quantity. */
export function validateCustomContractRange(assignedLocalDate: string, contractStart: string, contractEnd: string, maxSpanDays?: number | null): { valid: true; spanDays: number } | { valid: false; error: ContractRangeError } {
  let assigned: DateOnly, start: DateOnly, end: DateOnly;
  try { assigned = parseDateOnly(assignedLocalDate); start = parseDateOnly(contractStart); end = parseDateOnly(contractEnd); }
  catch { return { valid: false, error: 'invalid_date' }; }
  if (dateOrdinal(start) > dateOrdinal(end)) return { valid: false, error: 'custom_range_invalid' };
  if (dateOrdinal(start) < dateOrdinal(assigned)) return { valid: false, error: 'custom_range_before_assignment' };
  const spanDays = dateOrdinal(end) - dateOrdinal(start) + 1;
  if (maxSpanDays != null && (!Number.isInteger(maxSpanDays) || maxSpanDays < 1 || spanDays > maxSpanDays)) return { valid: false, error: 'custom_range_exceeds_max_span' };
  return { valid: true, spanDays };
}

export function isValidDateOnly(value: string): boolean {
  try { parseDateOnly(value); return true; } catch { return false; }
}

export function addDateDays(value: string, days: number): string;
export function addDateDays(value: DateOnly, days: number): DateOnly;
export function addDateDays(value: string | DateOnly, days: number): string | DateOnly {
  if (!Number.isInteger(days)) throw new RangeError('days must be an integer');
  const date = typeof value === 'string' ? parseDateOnly(value) : value;
  const result = dateFromOrdinal(dateOrdinal(date) + days);
  return typeof value === 'string' ? formatDateOnly(result) : result;
}

type DateOnly = { year: number; month: number; day: number };

function parseDateOnly(value: string): DateOnly {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError('date must be YYYY-MM-DD');
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (date.year < 1 || date.month < 1 || date.month > 12 || date.day < 1 || date.day > daysInMonth(date.year, date.month)) throw new RangeError('invalid calendar date');
  return date;
}

function formatDateOnly(date: DateOnly) { return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`; }
function daysInMonth(year: number, month: number) {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
function dateOrdinal(date: DateOnly) {
  const priorYear = date.year - 1;
  let days = 365 * priorYear + Math.floor(priorYear / 4) - Math.floor(priorYear / 100) + Math.floor(priorYear / 400);
  for (let month = 1; month < date.month; month++) days += daysInMonth(date.year, month);
  return days + date.day - 1;
}

function dateFromOrdinal(ordinal: number): DateOnly {
  const maximum = daysBeforeYear(10000);
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= maximum) throw new RangeError('date arithmetic exceeds supported date range');
  let low = 1, high = 10000;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (daysBeforeYear(middle) <= ordinal) low = middle;
    else high = middle;
  }
  let remaining = ordinal - daysBeforeYear(low), month = 1;
  while (remaining >= daysInMonth(low, month)) remaining -= daysInMonth(low, month++);
  return { year: low, month, day: remaining + 1 };
}

function daysBeforeYear(year: number) {
  const priorYear = year - 1;
  return 365 * priorYear + Math.floor(priorYear / 4) - Math.floor(priorYear / 100) + Math.floor(priorYear / 400);
}
