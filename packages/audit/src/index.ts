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

const forbiddenKey = /password|secret|token|credential|authorization|medical|diagnos|document.?content|health.?content/i;
const allowedEventKeys = new Set(['id', 'occurredAt', 'actorId', 'action', 'resourceType', 'resourceId', 'correlationId', 'outcome', 'reasonCode', 'changes']);

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
  for (const [key, value] of Object.entries(event.changes ?? {})) {
    if (forbiddenKey.test(key)) throw new Error(`Sensitive audit field is forbidden: ${key}`);
    if (typeof value === 'string' && value.length > 240) throw new Error(`Audit value too long: ${key}`);
  }
  for (const [key, value] of Object.entries(event)) {
    if (forbiddenKey.test(key)) throw new Error(`Sensitive audit field is forbidden: ${key}`);
    if (typeof value === 'string' && value.length > 500) throw new Error(`Audit field too long: ${key}`);
  }
}
