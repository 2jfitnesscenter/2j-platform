import assert from 'node:assert/strict';
import { validateAuditEvent } from '../src/index.ts';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const base = { id: 'event-1', occurredAt: '2026-10-07T12:00:00Z', actorId: 'actor-1', action: 'client.view', resourceType: 'client', resourceId: 'client-1', correlationId: 'request-1', outcome: 'success' };

test('audit envelope accepts minimal metadata and rejects credential or sensitive payloads', () => {
  assert.doesNotThrow(() => validateAuditEvent(base));
  assert.throws(() => validateAuditEvent({ ...base, changes: { accessToken: 'not-logged' } }), /Sensitive audit field/);
  assert.throws(() => validateAuditEvent({ ...base, changes: { apiKey: 'not-logged' } }), /Sensitive audit field/);
  assert.throws(() => validateAuditEvent({ ...base, changes: { api_key: 'not-logged' } }), /Sensitive audit field/);
  assert.throws(() => validateAuditEvent({ ...base, changes: { privateKey: 'not-logged' } }), /Sensitive audit field/);
  assert.throws(() => validateAuditEvent({ ...base, changes: { diagnosis: 'not-logged' } }), /Sensitive audit field/);
  assert.throws(() => validateAuditEvent({ ...base, changes: { summary: { password: 'not-logged' } } }), /scalar/);
});

test('audit changes are summarized and bounded in size', () => {
  assert.throws(() => validateAuditEvent({ ...base, changes: { status: 'x'.repeat(241) } }), /too long/);
  assert.throws(() => validateAuditEvent({ ...base, occurredAt: 'yesterday' }), /ISO 8601/);
  assert.throws(() => validateAuditEvent({ ...base, action: '' }), /required/);
  assert.throws(() => validateAuditEvent({ ...base, unexpectedPayload: 'not allowed' }), /Unknown audit field/);
});

test('machine schema requires the same identity/correlation audit envelope', async () => {
  const schema = JSON.parse(await readFile(new URL('../audit-event.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(schema.required, ['id', 'occurredAt', 'actorId', 'action', 'resourceType', 'resourceId', 'correlationId', 'outcome']);
  assert.equal(schema.additionalProperties, false);
  const deniedKey = new RegExp(schema.properties.changes.propertyNames.not.pattern);
  for (const key of ['apiKey', 'api_key', 'privateKey', 'password', 'medicalRecord']) assert.match(key, deniedKey);
  assert.deepEqual(schema.properties.changes.additionalProperties.type, ['string', 'number', 'boolean', 'null']);
});
