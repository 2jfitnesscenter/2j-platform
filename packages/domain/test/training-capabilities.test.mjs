import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolveTrainingCapabilities, TRAINING_CAPABILITIES_CONTRACT, TRAINING_CAPABILITIES_TTL_MS } from '../src/training-capabilities.ts';

const personId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const generatedAt = '2026-10-21T12:00:00.000Z';
const linked = { status: 'active', trainingUserId: 'opaque-training-1' };
const effective = (trainingAccessLevel, accessState = 'active') => [{ trainingAccessLevel, accessState, effectiveFrom: '2026-10-01' }];
const resolve = (link = linked, memberships = []) => resolveTrainingCapabilities({ personId, link, memberships, generatedAt });

test('capabilities contract fixture documents the exact V1 wire shape and three levels', async () => {
  const schema = JSON.parse(await readFile(new URL('../../../contracts/2J-capabilities-v1.schema.json', import.meta.url), 'utf8'));
  const fixture = JSON.parse(await readFile(new URL('../../../contracts/fixtures/2J-capabilities-v1.json', import.meta.url), 'utf8'));
  assert.equal(schema.properties.contract.const, TRAINING_CAPABILITIES_CONTRACT);
  assert.deepEqual(schema.properties.capabilityLevel.enum, ['full', 'autonomous', 'blocked']);
  assert.equal(fixture.length, 11);
  for (const item of fixture) {
    if (item.name === 'Platform unavailable') {
      assert.equal(item.expectedConsumerPolicy, 'cached_within_ttl_else_blocked');
      continue;
    }
    const result = resolve(item.link, item.memberships);
    assert.equal(result.capabilityLevel, item.expected.capabilityLevel, item.name);
    assert.equal(result.accessState, item.expected.accessState, item.name);
    assert.equal(result.reasonCode, item.expected.reasonCode, item.name);
  }
});

test('explicit full access maps to full; AI and professional follow-up are full-only', () => {
  const result = resolve(linked, effective('full'));
  assert.equal(result.capabilityLevel, 'full');
  assert.deepEqual(result.capabilities, { autonomousTraining: true, routineCreation: true, guidedTraining: true, premiumPrograms: true, aiCoach: true, professionalFollowUp: true });
});

test('explicit autonomous access maps to autonomous without full-only capabilities', () => {
  const result = resolve(linked, effective('autonomous'));
  assert.equal(result.capabilityLevel, 'autonomous');
  assert.equal(result.capabilities.premiumPrograms, true);
  assert.equal(result.capabilities.routineCreation, true);
  assert.equal(result.capabilities.aiCoach, false);
  assert.equal(result.capabilities.professionalFollowUp, false);
});

test('provisional retains the explicit access level while exposing provisional state', () => {
  for (const [kind, level] of [['full', 'full'], ['autonomous', 'autonomous']]) {
    const result = resolve(linked, effective(kind, 'provisional'));
    assert.equal(result.capabilityLevel, level);
    assert.equal(result.accessState, 'provisional');
  }
});

test('unpaid, ended, missing membership, and revoked links fail closed', () => {
  const unpaid = resolve(linked, effective('full', 'blocked_unpaid'));
  assert.equal(unpaid.capabilityLevel, 'blocked'); assert.equal(unpaid.reasonCode, 'UNPAID_BLOCK');
  const ended = resolve(linked, effective('autonomous', 'ended'));
  assert.equal(ended.capabilityLevel, 'blocked'); assert.equal(ended.reasonCode, 'PERIOD_ENDED');
  assert.equal(resolve(linked).reasonCode, 'NO_ACTIVE_MEMBERSHIP');
  const revoked = resolve({ status: 'revoked', trainingUserId: 'opaque-training-1' }, effective('full'));
  assert.equal(revoked.capabilityLevel, 'blocked'); assert.equal(revoked.reasonCode, 'TRAINING_LINK_REVOKED');
  assert.equal(revoked.accessState, 'active', 'link revocation remains distinct from entitlement state');
  assert.equal(revoked.trainingSubject.trainingUserId, undefined);
  assert.ok(Object.values(revoked.capabilities).every(value => value === false));
  const missing = resolve({ status: 'not_linked' }, effective('autonomous', 'provisional'));
  assert.equal(missing.reasonCode, 'TRAINING_LINK_MISSING'); assert.equal(missing.accessState, 'provisional');
});

test('late validated payment is represented by Platform active state and restores mapped level', () => {
  assert.equal(resolve(linked, effective('full', 'active')).capabilityLevel, 'full');
  assert.equal(resolve(linked, effective('autonomous', 'active')).capabilityLevel, 'autonomous');
});

test('contract is versioned and expires after the short technical TTL', () => {
  const result = resolve(linked, effective('full'));
  assert.equal(result.contract, '2J-CAPABILITIES-V1'); assert.equal(result.version, 1);
  assert.equal(Date.parse(result.expiresAt) - Date.parse(result.generatedAt), TRAINING_CAPABILITIES_TTL_MS);
  assert.equal(TRAINING_CAPABILITIES_TTL_MS, 60_000);
});

test('expiresAt is clipped to an earlier Platform-known transition', () => {
  const result = resolveTrainingCapabilities({ personId, link: linked, memberships: effective('full'), generatedAt, nextKnownAccessTransition: '2026-10-21T12:00:15.000Z' });
  assert.equal(result.expiresAt, '2026-10-21T12:00:15.000Z');
});

test('invalid future contract generation timestamps and person ids are rejected', () => {
  assert.throws(() => resolveTrainingCapabilities({ personId: 'invalid', link: linked, memberships: [], generatedAt }), /personId/);
  assert.throws(() => resolveTrainingCapabilities({ personId, link: linked, memberships: [], generatedAt: 'bad' }), /generatedAt/);
});
