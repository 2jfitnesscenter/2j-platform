import assert from 'node:assert/strict';
import { can, requirePermission, rolePermissions } from '../src/index.ts';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('approved role matrix grants only named operations and denies by default', () => {
  assert.equal(can({ actorId: 'fixture', role: 'trainer' }, 'clients.read'), true);
  assert.equal(can({ actorId: 'fixture', role: 'trainer' }, 'billing.refund'), false);
  assert.equal(can({ actorId: 'fixture', role: 'reception-management' }, 'billing.read-basic'), true);
  assert.equal(can({ actorId: 'fixture', role: 'reception-management' }, 'health.read'), false);
  assert.equal(can({ actorId: 'fixture', role: 'accountant' }, 'billing.read-basic'), false);
  assert.throws(() => requirePermission({ actorId: 'fixture', role: 'accountant' }, 'billing.refund'), { code: 'FORBIDDEN', statusCode: 403 });
});

test('explicit deny takes precedence over the admin wildcard', () => {
  assert.equal(can({ actorId: 'fixture', role: 'admin', deniedPermissions: ['configuration.manage'] }, 'configuration.manage'), false);
});

test('admin can perform operations unless explicitly denied', () => {
  assert.equal(can({ actorId: 'fixture', role: 'admin' }, 'settings.manage'), true);
  assert.equal(can({ actorId: 'fixture', role: 'admin' }, 'does.not.exist'), false);
  assert.equal(can({ actorId: 'fixture', role: 'admin', deniedPermissions: ['settings.manage'] }, 'settings.manage'), false);
});

test('runtime role matrix matches its reviewable JSON contract', async () => {
  const contract = JSON.parse(await readFile(new URL('../role-permissions.json', import.meta.url), 'utf8'));
  assert.deepEqual(contract.roles, rolePermissions);
  assert.ok(contract.unresolved.length > 0);
});
