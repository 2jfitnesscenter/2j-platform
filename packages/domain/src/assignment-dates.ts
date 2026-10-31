import { calculateContractEnd } from './contract-terms.js';

export interface AssignmentDateDefaults {
  readonly startsOn: string;
  readonly endsOn: string | null;
  readonly dueOn: string;
}

export interface AssignmentDatePlan {
  readonly kind: string;
  readonly renewalCadence: string | null;
  readonly periodDays: number | null;
  readonly termKind?: string | null;
  readonly termMonths?: number | null;
  readonly maxSpanDays?: number | null;
  readonly dueDay?: number | null;
  readonly graceDays?: number | null;
  readonly assignedLocalDate?: string | null;
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

function endOfMonth(date: string): string {
  const [year, month] = date.split('-').map(Number);
  return new Date(Date.UTC(year!, month!, 0)).toISOString().slice(0, 10);
}

/** Calendar-based initial dates for an assignment. Date-only values use Atlantic/Canary business dates. */
export function assignmentDateDefaults(startsOn: string, plan: AssignmentDatePlan, today: string): AssignmentDateDefaults {
  let endsOn: string | null = null;
  if (plan.termKind === 'natural_month' || plan.termKind == null && plan.kind === 'recurring' && plan.renewalCadence === 'monthly') endsOn = endOfMonth(startsOn);
  else if (plan.termKind === 'rolling_months' && plan.termMonths != null) {
    endsOn = calculateContractEnd(startsOn, plan.termMonths);
  }
  else if (plan.termKind === 'custom_range' && plan.maxSpanDays != null && Number.isInteger(plan.maxSpanDays) && plan.maxSpanDays > 0) endsOn = addDays(startsOn, plan.maxSpanDays - 1);
  else if (plan.kind === 'recurring' && plan.renewalCadence === 'weekly') endsOn = addDays(startsOn, 6);
  else if (plan.periodDays != null && Number.isInteger(plan.periodDays) && plan.periodDays > 0) endsOn = addDays(startsOn, plan.periodDays - 1);

  if ((plan.termKind === 'custom_range' || plan.termKind === 'rolling_months') && plan.assignedLocalDate && plan.graceDays != null) {
    return { startsOn, endsOn, dueOn: addDays(plan.assignedLocalDate, plan.graceDays) };
  }
  const [year, month] = startsOn.split('-');
  const dueDay = plan.termKind === 'natural_month' && plan.dueDay != null ? plan.dueDay : 10;
  const due = `${year}-${month}-${String(dueDay).padStart(2, '0')}`;
  return { startsOn, endsOn, dueOn: due < today ? startsOn : due };
}
