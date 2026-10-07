import assert from 'node:assert/strict';
import { isSessionCurrent } from '../src/index.ts';
import test from 'node:test';

const store = { currentVersion: async (subjectId) => subjectId === 'active-user' ? 3 : 4 };
const claims = { subjectId: 'active-user', sessionVersion: 3, issuedAt: 100, expiresAt: 200 };

test('session epoch invalidates previously issued sessions after role or credential changes', async () => {
  assert.equal(await isSessionCurrent(claims, store, 150), true);
  assert.equal(await isSessionCurrent({ ...claims, sessionVersion: 2 }, store, 150), false);
});

test('session checks reject expired, future-issued, and malformed claims', async () => {
  assert.equal(await isSessionCurrent(claims, store, 200), false);
  assert.equal(await isSessionCurrent({ ...claims, issuedAt: 151 }, store, 150), false);
  assert.equal(await isSessionCurrent({ ...claims, sessionVersion: 3.5 }, store, 150), false);
});
