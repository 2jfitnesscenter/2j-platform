import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolveTrainingCapabilities, resolveTrainingCapabilitiesV21, TRAINING_CAPABILITIES_CONTRACT, TRAINING_CAPABILITIES_CONTRACT_V21 } from '../src/training-capabilities.ts';

const personId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const generatedAt = '2026-10-21T12:00:00.000Z';
const run = item => resolveTrainingCapabilitiesV21({ personId, link: item.link, memberships: item.memberships, generatedAt, suspensionStatus: item.suspensionStatus });

test('V2.1 fixtures: the free baseline is richer (Entrena con 2J + Premium), an unlinked person is registered, revoked and suspended stay blocked', async () => {
  const fixture = JSON.parse(await readFile(new URL('../../../contracts/fixtures/2J-capabilities-v2.1.json', import.meta.url), 'utf8'));
  assert.equal(fixture.length, 9);
  for (const item of fixture) {
    const result = run(item);
    assert.equal(result.contract, TRAINING_CAPABILITIES_CONTRACT_V21, item.name);
    assert.equal(result.revision, 1);
    assert.equal(result.version, 2);
    assert.equal(result.capabilityLevel, item.expected.capabilityLevel, item.name);
    assert.equal(result.accessState, item.expected.accessState, item.name);
    assert.equal(result.reasonCode, item.expected.reasonCode, item.name);
    assert.equal(result.trainingSubject.linkStatus, item.expected.linkStatus, item.name);
    for (const flag of ['guidedTraining', 'premiumPrograms', 'aiCoach', 'professionalFollowUp']) assert.equal(result.capabilities[flag], item.expected[flag], `${item.name}: ${flag}`);
    assert.equal(result.trainingSubject.trainingUserId !== undefined, item.expected.linkStatus === 'active', `${item.name}: trainingUserId only for an active link`);
  }
});

test('V2.1 baseline is exactly the V2 baseline plus guidedTraining and premiumPrograms; routineCreation, aiCoach and professionalFollowUp stay off', () => {
  const v2 = resolveTrainingCapabilities({ personId, link: { status: 'active', trainingUserId: 'u1' }, memberships: [], generatedAt });
  const v21 = resolveTrainingCapabilitiesV21({ personId, link: { status: 'active', trainingUserId: 'u1' }, memberships: [], generatedAt });
  const added = Object.keys(v21.capabilities).filter(key => v21.capabilities[key] !== v2.capabilities[key]);
  assert.deepEqual(added.sort(), ['guidedTraining', 'premiumPrograms']);
  assert.equal(v21.capabilities.routineCreation, false);
  assert.equal(v21.capabilities.aiCoach, false);
  assert.equal(v21.capabilities.professionalFollowUp, false);
});

test('V2 is untouched: the same person still gets the V2 contract, the V2 baseline and TRAINING_LINK_MISSING when unlinked', () => {
  const unlinked = resolveTrainingCapabilities({ personId, link: { status: 'not_linked' }, memberships: [], generatedAt });
  assert.equal(unlinked.contract, TRAINING_CAPABILITIES_CONTRACT);
  assert.equal(unlinked.capabilityLevel, 'blocked');
  assert.equal(unlinked.reasonCode, 'TRAINING_LINK_MISSING');
  const linked = resolveTrainingCapabilities({ personId, link: { status: 'active', trainingUserId: 'u1' }, memberships: [], generatedAt });
  assert.equal(linked.capabilities.guidedTraining, false);
  assert.equal(linked.capabilities.premiumPrograms, false);
  assert.equal('revision' in linked, false);
});

test('V2.1 keeps the V2 window rules (TTL at most 60 s, shortened by a known transition) and the paid levels', () => {
  const result = resolveTrainingCapabilitiesV21({ personId, link: { status: 'active', trainingUserId: 'u1' }, memberships: [], generatedAt, nextKnownAccessTransition: '2026-10-21T12:00:20.000Z' });
  assert.equal(result.expiresAt, '2026-10-21T12:00:20.000Z');
  const normal = resolveTrainingCapabilitiesV21({ personId, link: { status: 'not_linked' }, memberships: [], generatedAt });
  assert.equal(Date.parse(normal.expiresAt) - Date.parse(normal.generatedAt), 60_000);
  assert.throws(() => resolveTrainingCapabilitiesV21({ personId: 'nope', link: { status: 'not_linked' }, memberships: [], generatedAt }), RangeError);
});

test('the V2.1 JSON schema describes the same shape as V2 with the new contract id and revision', async () => {
  const v2 = JSON.parse(await readFile(new URL('../../../contracts/2J-capabilities-v2.schema.json', import.meta.url), 'utf8'));
  const v21 = JSON.parse(await readFile(new URL('../../../contracts/2J-capabilities-v2.1.schema.json', import.meta.url), 'utf8'));
  assert.equal(v21.properties.contract.const, '2J-CAPABILITIES-V2.1');
  assert.equal(v21.properties.revision.const, 1);
  assert.deepEqual(v21.required.filter(key => !v2.required.includes(key)), ['revision']);
  assert.deepEqual(v21.properties.capabilities, v2.properties.capabilities);
  assert.equal(v2.properties.contract.const, '2J-CAPABILITIES-V2', 'V2 schema untouched');
});
