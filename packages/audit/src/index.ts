export interface AuditEvent {
  readonly id: string;
  readonly occurredAt: string;
  readonly actorId: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly correlationId: string;
  readonly outcome: 'success' | 'denied' | 'failure';
  readonly reasonCode?: string;
  readonly changes?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface AppendOnlyAuditWriter {
  append(event: AuditEvent): Promise<void>;
}

const forbiddenKey = /password|secret|token|credential|authorization|api[-_]?key|private[-_]?key|medical|diagnos|document.?content|health.?content/i;
const allowedEventKeys = new Set(['id', 'occurredAt', 'actorId', 'action', 'resourceType', 'resourceId', 'correlationId', 'outcome', 'reasonCode', 'changes']);
const fieldMaxLength: Readonly<Record<string, number>> = {
  id: 120, occurredAt: 40, actorId: 120, action: 160, resourceType: 120,
  resourceId: 160, correlationId: 160, reasonCode: 120,
};

function isIsoDateTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  if (!zone) return false;
  const year = Number(yearText); const month = Number(monthText); const day = Number(dayText);
  const hour = Number(hourText); const minute = Number(minuteText); const second = Number(secondText);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(0, 0, 0, 0);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)) return false;
  return !Number.isNaN(Date.parse(value));
}

export function validateAuditEvent(event: AuditEvent): void {
  for (const key of Object.keys(event)) {
    if (!allowedEventKeys.has(key)) throw new Error(`Unknown audit field: ${key}`);
  }
  const required = ['id', 'occurredAt', 'actorId', 'action', 'resourceType', 'resourceId', 'correlationId', 'outcome'] as const;
  for (const key of required) {
    if (typeof event[key] !== 'string' || event[key].length === 0) throw new Error(`Audit field is required: ${key}`);
  }
  if (!isIsoDateTime(event.occurredAt)) throw new Error('Audit timestamp must be ISO 8601 with a valid calendar date and timezone');
  if (!['success', 'denied', 'failure'].includes(event.outcome)) throw new Error('Invalid audit outcome');
  if (event.changes !== undefined && (event.changes === null || typeof event.changes !== 'object' || Array.isArray(event.changes))) {
    throw new Error('Audit changes must be an object of scalar summaries');
  }
  if (Object.keys(event.changes ?? {}).length > 30) throw new Error('Audit changes exceed the property limit');
  for (const [key, value] of Object.entries(event.changes ?? {})) {
    if (forbiddenKey.test(key)) throw new Error(`Sensitive audit field is forbidden: ${key}`);
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw new Error(`Audit values must be scalar: ${key}`);
    if (typeof value === 'string' && value.length > 240) throw new Error(`Audit value too long: ${key}`);
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Audit number must be finite: ${key}`);
  }
  for (const [key, value] of Object.entries(event)) {
    if (forbiddenKey.test(key)) throw new Error(`Sensitive audit field is forbidden: ${key}`);
    if (typeof value === 'string' && fieldMaxLength[key] !== undefined && value.length > fieldMaxLength[key]) throw new Error(`Audit field too long: ${key}`);
  }
}
