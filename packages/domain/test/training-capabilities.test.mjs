import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolveTrainingCapabilities, TRAINING_CAPABILITIES_CONTRACT, TRAINING_CAPABILITIES_TTL_MS } from '../src/training-capabilities.ts';

const personId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const generatedAt = '2026-10-21T12:00:00.000Z';
const linked = { status: 'active', trainingUserId: 'opaque-training-1' };
const effective = (trainingAccessLevel, accessState = 'active') => [{ trainingAccessLevel, accessState, effectiveFrom: '2026-10-01' }];
const resolve = (link = linked, memberships = [], suspensionStatus = 'none') => resolveTrainingCapabilities({ personId, link, memberships, generatedAt, suspensionStatus });

test('V2 schema and fixtures match the wire contract and cover baseline, commercial rights and suspension', async () => {
  const schema = JSON.parse(await readFile(new URL('../../../contracts/2J-capabilities-v2.schema.json', import.meta.url), 'utf8'));
  const fixture = JSON.parse(await readFile(new URL('../../../contracts/fixtures/2J-capabilities-v2.json', import.meta.url), 'utf8'));
  assert.equal(schema.properties.contract.const, TRAINING_CAPABILITIES_CONTRACT);
  assert.deepEqual(schema.properties.capabilityLevel.enum, ['full', 'autonomous', 'baseline', 'blocked']);
  assert.equal(fixture.length, 11);
  for (const item of fixture) {
    if (item.name === 'Platform unavailable') { assert.equal(item.expectedConsumerPolicy, 'cached_within_ttl_else_blocked'); continue; }
    const result = resolve(item.link, item.memberships, item.suspensionStatus);
    assert.equal(result.capabilityLevel, item.expected.capabilityLevel, item.name);
    assert.equal(result.accessState, item.expected.accessState ?? 'active', item.name);
    assert.equal(result.reasonCode, item.expected.reasonCode, item.name);
  }
});

test('Fuerza full includes autonomous baseline and professional AI/follow-up', () => {
  const result = resolve(linked, effective('full'));
  assert.equal(result.capabilityLevel, 'full');
  assert.deepEqual(result.capabilities, { autonomousTraining:true,routineCreation:true,personalRoutineCreation:true,personalRoutineManagement:true,workoutRecording:true,workoutHistory:true,guidedTraining:true,premiumPrograms:true,aiCoach:true,professionalFollowUp:true });
});

test('other active membership keeps approved guided/Premium extras but not AI or follow-up', () => {
  const result = resolve(linked, effective('autonomous'));
  assert.equal(result.capabilityLevel, 'autonomous');
  assert.equal(result.capabilities.autonomousTraining, true); assert.equal(result.capabilities.personalRoutineManagement, true);
  assert.equal(result.capabilities.guidedTraining, true); assert.equal(result.capabilities.premiumPrograms, true);
  assert.equal(result.capabilities.aiCoach, false); assert.equal(result.capabilities.professionalFollowUp, false);
});

test('no membership or ended/unpaid commercial rights retain only free autonomous baseline', () => {
  for (const memberships of [[], effective('full','ended'), effective('full','blocked_unpaid')]) {
    const result = resolve(linked, memberships);
    assert.equal(result.capabilityLevel, 'baseline'); assert.equal(result.accessState, 'baseline');
    assert.equal(result.capabilities.autonomousTraining, true); assert.equal(result.capabilities.personalRoutineCreation,true); assert.equal(result.capabilities.personalRoutineManagement, true);
    assert.equal(result.capabilities.workoutRecording, true); assert.equal(result.capabilities.workoutHistory, true);
    assert.equal(result.capabilities.routineCreation, false); assert.equal(result.capabilities.guidedTraining, false);
    assert.equal(result.capabilities.premiumPrograms, false); assert.equal(result.capabilities.aiCoach, false); assert.equal(result.capabilities.professionalFollowUp, false);
  }
});

test('suspension overrides full and baseline, and lifting recomputes from current rights', () => {
  const full = resolve(linked, effective('full'), 'suspended');
  assert.equal(full.capabilityLevel,'blocked'); assert.equal(full.accessState,'suspended'); assert.equal(full.reasonCode,'ADMIN_SUSPENDED');
  assert.equal(full.trainingSubject.trainingUserId,linked.trainingUserId); assert.ok(Object.values(full.capabilities).every(value=>!value));
  const liftedFull=resolve(linked,effective('full'),'lifted'); assert.equal(liftedFull.capabilityLevel,'full');
  const liftedFree=resolve(linked,[],'lifted'); assert.equal(liftedFree.capabilityLevel,'baseline');
});

test('provisional commercial grants retain their explicit levels', () => {
  for (const [kind, level] of [['full','full'],['autonomous','autonomous']]) {
    const result=resolve(linked,effective(kind,'provisional')); assert.equal(result.capabilityLevel,level); assert.equal(result.accessState,'provisional');
  }
});

test('missing and revoked links remain blocked independently of membership', () => {
  const revoked=resolve({status:'revoked',trainingUserId:'opaque-training-1'},effective('full'));
  assert.equal(revoked.capabilityLevel,'blocked'); assert.equal(revoked.reasonCode,'TRAINING_LINK_REVOKED');
  assert.equal(revoked.trainingSubject.trainingUserId,undefined); assert.ok(Object.values(revoked.capabilities).every(value=>!value));
  const missing=resolve({status:'not_linked'},[]); assert.equal(missing.reasonCode,'TRAINING_LINK_MISSING');
});

test('contract is V2 and expires after the short technical TTL', () => {
  const result=resolve(linked,effective('full'));
  assert.equal(result.contract,'2J-CAPABILITIES-V2'); assert.equal(result.version,2);
  assert.equal(Date.parse(result.expiresAt)-Date.parse(result.generatedAt),TRAINING_CAPABILITIES_TTL_MS); assert.equal(TRAINING_CAPABILITIES_TTL_MS,60_000);
});

test('expiresAt is clipped to an earlier Platform-known transition', () => {
  const result=resolveTrainingCapabilities({personId,link:linked,memberships:effective('full'),generatedAt,nextKnownAccessTransition:'2026-10-21T12:00:15.000Z'});
  assert.equal(result.expiresAt,'2026-10-21T12:00:15.000Z');
});

test('invalid timestamps and person ids are rejected', () => {
  assert.throws(()=>resolveTrainingCapabilities({personId:'invalid',link:linked,memberships:[],generatedAt}),/personId/);
  assert.throws(()=>resolveTrainingCapabilities({personId,link:linked,memberships:[],generatedAt:'bad'}),/generatedAt/);
});
