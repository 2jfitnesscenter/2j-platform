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

export function validateAuditEvent(event: AuditEvent): void {
  for (const key of Object.keys(event)) {
    if (!allowedEventKeys.has(key)) throw new Error(`Unknown audit field: ${key}`);
  }
  const required = ['id', 'occurredAt', 'actorId', 'action', 'resourceType', 'resourceId', 'correlationId', 'outcome'] as const;
  for (const key of required) {
    if (typeof event[key] !== 'string' || event[key].length === 0) throw new Error(`Audit field is required: ${key}`);
  }
  if (Number.isNaN(Date.parse(event.occurredAt)) || !/^\d{4}-\d\d-\d\dT/.test(event.occurredAt)) throw new Error('Audit timestamp must be ISO 8601');
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
