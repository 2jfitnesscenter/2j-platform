import assert from 'node:assert/strict';
import { can, knownPermissions, requirePermission, rolePermissions } from '../src/index.ts';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('approved role matrix grants only named operations and denies by default', () => {
  assert.equal(can({ actorId: 'fixture', role: 'trainer' }, 'clients.read'), true);
  assert.equal(can({ actorId: 'fixture', role: 'trainer' }, 'billing.refund'), false);
  assert.equal(can({ actorId: 'fixture', role: 'reception-management' }, 'billing.read-basic'), true);
  assert.equal(can({ actorId: 'fixture', role: 'trainer' }, 'reservations.manage'), true);
  assert.equal(can({ actorId: 'fixture', role: 'trainer' }, 'reservations.attendance'), true);
  assert.equal(can({ actorId: 'fixture', role: 'trainer' }, 'scheduling.override_capacity'), true);
  assert.equal(can({ actorId: 'fixture', role: 'trainer' }, 'communication.send'), true);
  assert.equal(can({ actorId: 'fixture', role: 'trainer' }, 'communication.internal_notes.write'), true);
  assert.equal(can({ actorId: 'fixture', role: 'trainer' }, 'forms.manage'), false);
  assert.equal(can({ actorId: 'fixture', role: 'trainer' }, 'news.read'), false);
  assert.equal(can({ actorId: 'fixture', role: 'trainer' }, 'news.manage'), false);
  assert.equal(can({ actorId: 'fixture', role: 'reception-management' }, 'news.manage'), false);
  assert.equal(can({ actorId: 'fixture', role: 'accountant' }, 'news.read'), false);
  assert.equal(can({ actorId: 'fixture', role: 'admin' }, 'news.read'), true);
  assert.equal(can({ actorId: 'fixture', role: 'admin' }, 'news.manage'), true);
  assert.equal(can({ actorId: 'fixture', role: 'trainer' }, 'documents.override'), false);
  assert.equal(can({ actorId: 'fixture', role: 'trainer' }, 'forms.responses.sensitive.read'), false);
  assert.equal(can({ actorId: 'fixture', role: 'admin' }, 'forms.responses.sensitive.read'), true);
  assert.equal(can({ actorId: 'fixture', role: 'accountant' }, 'forms.responses.sensitive.read'), false);
  assert.equal(can({ actorId: 'fixture', role: 'admin' }, 'documents.requirement.override'), true);
  assert.equal(can({ actorId: 'fixture', role: 'reception-management' }, 'documents.read'), true);
  assert.equal(can({ actorId: 'fixture', role: 'reception-management' }, 'communication.internal_notes.write'), false);
  assert.equal(can({ actorId: 'fixture', role: 'admin' }, 'scheduling.override_capacity'), true);
  assert.equal(can({ actorId: 'fixture', role: 'reception-management' }, 'scheduling.override_capacity'), false);
  assert.equal(can({ actorId: 'fixture', role: 'reception-management' }, 'reservations.attendance'), false);
  assert.equal(can({ actorId: 'fixture', role: 'reception-management' }, 'health.read'), false);
  assert.equal(can({ actorId: 'fixture', role: 'accountant' }, 'billing.read-basic'), true);
  assert.equal(can({ actorId: 'fixture', role: 'accountant' }, 'billing.read-tax'), true);
  assert.equal(can({ actorId: 'fixture', role: 'accountant' }, 'billing.export'), true);
  assert.equal(can({ actorId: 'fixture', role: 'accountant' }, 'billing.payments.manage'), false);
  assert.equal(can({ actorId: 'fixture', role: 'accountant' }, 'billing.cash.manage'), false);
  assert.equal(can({ actorId: 'fixture', role: 'accountant' }, 'billing.write-tax'), false);
  assert.equal(can({ actorId: 'fixture', role: 'accountant' }, 'billing.validate_transfer'), false);
  assert.equal(can({ actorId: 'fixture', role: 'accountant' }, 'communication.read'), false);
  assert.equal(can({ actorId: 'fixture', role: 'accountant' }, 'documents.read'), false);
  assert.throws(() => requirePermission({ actorId: 'fixture', role: 'accountant' }, 'billing.refund'), { code: 'FORBIDDEN', statusCode: 403 });
});

test('2J-073 entitlement operations follow the approved Reception, Trainer, Accountant and Admin matrix', () => {
  const has = (role, permission) => can({ actorId: 'fixture', role }, permission);
  for (const permission of ['entitlements.read','entitlements.manage','entitlements.renew','entitlements.pause','entitlements.cancel']) assert.equal(has('reception-management', permission), true, `${permission} should be granted to Reception`);
  for (const permission of ['entitlements.adjust','catalog.pricing.manage','billing.payments.manage']) assert.equal(has('reception-management', permission), false, `${permission} should remain denied to Reception`);
  assert.equal(has('trainer','entitlements.read'), true);
  assert.equal(has('trainer','entitlements.recurrence.manage'), true);
  assert.equal(can({ actorId:'fixture',role:'trainer',deniedPermissions:['entitlements.recurrence.manage'] },'entitlements.recurrence.manage'),false);
  assert.equal(has('reception-management','entitlements.recurrence.manage'), false);
  assert.equal(has('accountant','entitlements.recurrence.manage'), false);
  assert.equal(has('admin','entitlements.recurrence.manage'), true);
  for (const permission of ['entitlements.manage','entitlements.renew','entitlements.pause','entitlements.cancel','entitlements.adjust','catalog.pricing.manage','billing.payments.manage']) assert.equal(has('trainer', permission), false, `${permission} should remain denied to Trainer`);
  for (const permission of ['entitlements.read','entitlements.manage','entitlements.renew','entitlements.pause','entitlements.cancel','entitlements.adjust','catalog.pricing.manage']) assert.equal(has('accountant', permission), false, `${permission} should remain denied to Accountant`);
  for (const permission of ['entitlements.read','entitlements.manage','entitlements.renew','entitlements.pause','entitlements.cancel','entitlements.adjust','catalog.pricing.manage']) assert.equal(has('admin', permission), true, `${permission} should remain available to Admin`);
});

test('explicit deny takes precedence over the admin wildcard', () => {
  assert.equal(can({ actorId: 'fixture', role: 'admin', deniedPermissions: ['configuration.manage'] }, 'configuration.manage'), false);
});

test('admin can perform operations unless explicitly denied', () => {
  assert.equal(can({ actorId: 'fixture', role: 'admin' }, 'settings.manage'), true);
  assert.equal(can({ actorId: 'fixture', role: 'admin' }, 'clients.manage'), true);
  assert.equal(can({ actorId: 'fixture', role: 'trainer' }, 'clients.manage'), false);
  assert.equal(can({ actorId: 'fixture', role: 'reception-management' }, 'clients.manage'), false);
  assert.equal(can({ actorId: 'fixture', role: 'admin' }, 'does.not.exist'), false);
  assert.equal(can({ actorId: 'fixture', role: 'admin', deniedPermissions: ['settings.manage'] }, 'settings.manage'), false);
});

test('person identity administration is restricted to Admin', () => {
  for (const role of ['trainer', 'reception-management', 'accountant']) assert.equal(can({ actorId: 'fixture', role }, 'identity.people.manage'), false);
  assert.equal(can({ actorId: 'fixture', role: 'admin' }, 'identity.people.manage'), true);
});

test('limited Member booking cohort management is restricted to Admin', () => {
  for (const role of ['trainer', 'reception-management', 'accountant']) assert.equal(can({ actorId: 'fixture', role }, 'member.pilot.booking.manage'), false);
  assert.equal(can({ actorId: 'fixture', role: 'admin' }, 'member.pilot.booking.manage'), true);
});

test('Training suspension is Admin-only until a Trainer receives an explicit granular grant', () => {
  assert.equal(knownPermissions.has('training.suspension.manage'), true);
  assert.equal(can({ actorId: 'fixture', role: 'admin' }, 'training.suspension.manage'), true);
  assert.equal(can({ actorId: 'fixture', role: 'trainer' }, 'training.suspension.manage'), false);
  assert.equal(can({ actorId: 'fixture', role: 'reception-management' }, 'training.suspension.manage'), false);
  assert.equal(can({ actorId: 'fixture', role: 'accountant' }, 'training.suspension.manage'), false);
});

test('owner cash panel permission is an explicit server-side grant and never comes from Admin wildcard', () => {
  assert.equal(knownPermissions.has('owner.panel.read'), true);
  for (const role of ['admin', 'trainer', 'reception-management', 'accountant']) {
    assert.equal(can({ actorId: 'fixture', role }, 'owner.panel.read'), false, `${role} must not imply owner access`);
  }
  assert.equal(can({ actorId: 'fixture', role: 'admin', explicitPermissions: ['owner.panel.read'] }, 'owner.panel.read'), true);
  assert.equal(can({ actorId: 'fixture', role: 'admin', explicitPermissions: ['owner.panel.read'], deniedPermissions: ['owner.panel.read'] }, 'owner.panel.read'), false);
});

test('runtime role matrix matches its reviewable JSON contract', async () => {
  const contract = JSON.parse(await readFile(new URL('../role-permissions.json', import.meta.url), 'utf8'));
  assert.deepEqual(contract.roles, rolePermissions);
  assert.deepEqual(new Set(contract.knownPermissions), knownPermissions);
  assert.ok(contract.unresolved.length > 0);
});

test('prototype names are not treated as registered roles', () => {
  for (const role of ['toString', 'constructor', '__proto__']) {
    assert.equal(can({ actorId: 'fixture', role }, 'clients.read'), false);
    assert.throws(() => requirePermission({ actorId: 'fixture', role }, 'clients.read'), { code: 'FORBIDDEN', statusCode: 403 });
  }
});
