import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: member pilot authentication tests cannot be skipped.');
process.env.NODE_ENV = 'test';
const sql = postgres(process.env.DATABASE_URL, { max: 8, connect_timeout: 5 });
await migrateDatabase(sql);
const origin = 'http://127.0.0.1:5173';
const app = buildServer(process.env.DATABASE_URL, { logger: false, memberPilotAuthEnabled: true, memberAppOrigin: origin });
const disabledApp = buildServer(process.env.DATABASE_URL, { logger: false });
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');

async function createMember(firstName, code, { facet = true } = {}) {
  const clientId = randomUUID(); const personId = randomUUID(); const subjectId = randomUUID();
  const subject = `member-${randomUUID()}`;
  await sql`INSERT INTO clients(id,first_name,last_name,status) VALUES (${clientId},${firstName},'Pilot test','active')`;
  await sql`INSERT INTO platform_persons(id,status,created_by) VALUES (${personId},'active','member-pilot-test')`;
  if (facet) await sql`INSERT INTO platform_person_clients(person_id,client_id,linked_by) VALUES (${personId},${clientId},'member-pilot-test')`;
  await sql`INSERT INTO platform_person_auth_subjects(id,person_id,auth_subject,provider,status,created_by) VALUES (${subjectId},${personId},${subject},'platform-pilot','active','member-pilot-test')`;
  await sql`INSERT INTO platform_member_pilot_credentials(auth_subject_link_id,code_hash) VALUES (${subjectId},${hash(code)})`;
  return { clientId, personId, subjectId, code };
}

const memberA = await createMember('Ada', `code-a-${randomUUID()}`);
const memberB = await createMember('Bea', `code-b-${randomUUID()}`);
after(async () => { await Promise.all([app.close(), disabledApp.close()]); await sql.end(); });

test('pilot login issues hashed opaque sessions, binds each member server-side, rotates, revokes, and audits', async () => {
  assert.equal((await app.inject({ method: 'POST', url: '/api/pilot/member/login', headers: { origin, 'content-type': 'application/json' }, payload: { code: 'incorrect' } })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/pilot/member/login', headers: { 'content-type': 'application/json' }, payload: { code: memberA.code } })).statusCode, 403);
  const loginA = await app.inject({ method: 'POST', url: '/api/pilot/member/login', headers: { origin, 'content-type': 'application/json' }, payload: { code: memberA.code } });
  assert.equal(loginA.statusCode, 200, loginA.body);
  const cookieA = loginA.headers['set-cookie'].split(';')[0]; const rawA = cookieA.split('=')[1];
  assert.match(loginA.headers['set-cookie'], /HttpOnly/); assert.match(loginA.headers['set-cookie'], /SameSite=Lax/); assert.equal(loginA.headers['cache-control'], 'no-store');
  const storedA = await sql`SELECT session_hash,person_id,expires_at FROM platform_member_sessions WHERE person_id=${memberA.personId}`;
  assert.equal(storedA.length, 1); assert.equal(storedA[0].session_hash.trim(), hash(rawA)); assert.notEqual(storedA[0].session_hash.trim(), rawA);
  const tampered = `${rawA[0] === 'A' ? 'B' : 'A'}${rawA.slice(1)}`;
  assert.equal((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: `2j_member_pilot=${tampered}` } })).statusCode, 401);
  const own = await app.inject({ method: 'GET', url: `/api/me?clientId=${memberB.clientId}`, headers: { cookie: cookieA, 'x-client-id': memberB.clientId } });
  assert.equal(own.statusCode, 200); assert.equal(own.json().profile.id, memberA.clientId); assert.equal(own.json().profile.firstName, 'Ada');
  const rotateB = await app.inject({ method: 'POST', url: '/api/pilot/member/login', headers: { origin, cookie: cookieA, 'content-type': 'application/json' }, payload: { code: memberB.code } });
  assert.equal(rotateB.statusCode, 200); const cookieB = rotateB.headers['set-cookie'].split(';')[0];
  assert.notEqual(cookieB, cookieA);
  assert.ok((await sql`SELECT revoked_at FROM platform_member_sessions WHERE session_hash=${hash(rawA)}`)[0].revoked_at);
  const ownB = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: cookieB } });
  assert.equal(ownB.statusCode, 200); assert.equal(ownB.json().profile.id, memberB.clientId); assert.equal(ownB.json().profile.firstName, 'Bea');
  const spoofBody = await app.inject({ method: 'POST', url: `/api/me/sessions/${randomUUID()}/reservations`, headers: { cookie: cookieB, origin, 'content-type': 'application/json' }, payload: { clientId: memberA.clientId } });
  assert.equal(spoofBody.statusCode, 403); assert.equal(spoofBody.json().error, 'member_pilot_action_not_enabled');
  assert.equal((await app.inject({ method: 'POST', url: `/api/me/sessions/${randomUUID()}/reservations`, headers: { cookie: cookieB, origin: 'https://attacker.example', 'content-type': 'application/json' }, payload: {} })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/client-portal/conversations', headers: { cookie: cookieB, origin: 'https://attacker.example', 'content-type': 'application/json' }, payload: {} })).statusCode, 403);
  const logout = await app.inject({ method: 'POST', url: '/api/pilot/member/logout', headers: { origin, cookie: cookieB, 'content-type': 'application/json' }, payload: {} });
  assert.equal(logout.statusCode, 204); assert.match(logout.headers['set-cookie'], /Max-Age=0/);
  assert.equal((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: cookieB } })).statusCode, 401);
  const audits = await sql`SELECT action FROM platform_member_session_audit_events WHERE person_id IN (${memberA.personId},${memberB.personId}) ORDER BY occurred_at,id`;
  assert.equal(audits.filter(row => row.action === 'session.created').length, 2);
  assert.equal(audits.filter(row => row.action === 'session.revoked').length, 2);
});

test('expired sessions fail closed, unsafe self-service requires same-origin, and auth is disabled by default', async () => {
  const raw = randomBytes(32).toString('base64url');
  await sql`INSERT INTO platform_member_sessions(session_hash,person_id,auth_subject_link_id,created_at,expires_at)
    VALUES (${hash(raw)},${memberA.personId},${memberA.subjectId},now()-interval '9 hours',now()-interval '1 second')`;
  const cookie = `2j_member_pilot=${raw}`;
  assert.equal((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/pilot/member/logout', headers: { origin: 'https://attacker.example', cookie, 'content-type': 'application/json' }, payload: {} })).statusCode, 403);
  assert.equal((await disabledApp.inject({ method: 'POST', url: '/api/pilot/member/login', headers: { origin, 'content-type': 'application/json' }, payload: { code: memberA.code } })).statusCode, 404);
  assert.equal((await disabledApp.inject({ method: 'GET', url: '/api/me' })).statusCode, 401);
});

test('resolved Member route metadata enforces CSRF for encoded path variants and both mutation methods', async () => {
  const inserted = await sql`INSERT INTO notifications(recipient_kind,recipient_id,type,title,body,deeplink,dedupe_key)
    VALUES ('client',${memberA.clientId},'document_pending','CSRF route test','Synthetic regression row','/profile',${`member-pilot-csrf-${randomUUID()}`}) RETURNING id`;
  const notificationId = inserted[0].id;
  const cookie = await (async () => {
    const response = await app.inject({ method: 'POST', url: '/api/pilot/member/login', headers: { origin, 'content-type': 'application/json' }, payload: { code: memberA.code } });
    assert.equal(response.statusCode, 200);
    return response.headers['set-cookie'].split(';')[0];
  })();
  const paths = [
    { method: 'POST', url: '/api/me/notifications/read-all', resolves: true },
    { method: 'POST', url: '/api/%6de/notifications/read-all', resolves: true },
    { method: 'POST', url: '/api/m%65/notifications/read-all', resolves: true },
    { method: 'POST', url: '/api/me/notificati%6Fns/read-all', resolves: true },
    { method: 'POST', url: '/api/%6D%65/notifications/read-all', resolves: true },
    { method: 'PATCH', url: `/api/me/notifications/%${notificationId.charCodeAt(0).toString(16)}${notificationId.slice(1)}/read`, resolves: true },
    { method: 'POST', url: '/api/client-portal/conversations', resolves: true },
    { method: 'POST', url: '/api/client-%70ortal/conversations', resolves: true },
    { method: 'POST', url: '/api/client-portal%2fconversations', resolves: false },
  ];
  for (const { method, url, resolves } of paths) {
    const wrongOrigin = await app.inject({ method, url, headers: { cookie, origin: 'http://evil.example' }, payload: {} });
    assert.equal(wrongOrigin.statusCode, resolves ? 403 : 404, `${method} ${url} must fail closed; got ${wrongOrigin.statusCode}: ${wrongOrigin.body}`);
  }
  const deniedNotification = await sql`SELECT read_at AS "readAt" FROM notifications WHERE id=${notificationId}`;
  assert.equal(deniedNotification[0].readAt, null, 'denied encoded mutations must not change notification state');
  const sessionId = randomUUID();
  const encodedWrongOrigin = await app.inject({ method: 'POST', url: `/api/%6de/sessions/${sessionId}/reservations`, headers: { cookie, origin: 'http://evil.example', 'idempotency-key': randomUUID() }, payload: {} });
  assert.equal(encodedWrongOrigin.statusCode, 403); assert.equal(encodedWrongOrigin.json().error, 'origin_rejected');
  const encodedCorrectOrigin = await app.inject({ method: 'POST', url: `/api/%6de/sessions/${sessionId}/reservations`, headers: { cookie, origin, 'idempotency-key': randomUUID() }, payload: {} });
  assert.equal(encodedCorrectOrigin.statusCode, 403); assert.equal(encodedCorrectOrigin.json().error, 'member_pilot_action_not_enabled', 'the valid Origin passes CSRF and is then blocked by the off-by-default booking flag');
  const refererFallback = await app.inject({ method: 'POST', url: `/api/me/sessions/${sessionId}/waitlist`, headers: { cookie, referer: `${origin}/member`, 'idempotency-key': randomUUID() }, payload: {} });
  assert.equal(refererFallback.statusCode, 403); assert.equal(refererFallback.json().error, 'member_pilot_action_not_enabled');
  for (const { method, url, resolves } of paths.filter(path => path.resolves)) {
    const expectedSuccess = method === 'POST' && url.includes('conversations') ? 201 : 200;
    const correctOrigin = await app.inject({ method, url, headers: { cookie, origin }, payload: {} });
    assert.equal(correctOrigin.statusCode, expectedSuccess, `${method} ${url} should accept its exact configured Origin`);
    const correctReferer = await app.inject({ method, url, headers: { cookie, referer: `${origin}/member` }, payload: {} });
    assert.equal(correctReferer.statusCode, expectedSuccess, `${method} ${url} should accept matching Referer without Origin`);
    const wrongReferer = await app.inject({ method, url, headers: { cookie, referer: 'http://evil.example/page' }, payload: {} });
    assert.equal(wrongReferer.statusCode, 403, `${method} ${url} should reject a wrong Referer`);
    const absentOriginAndReferer = await app.inject({ method, url, headers: { cookie }, payload: {} });
    assert.equal(absentOriginAndReferer.statusCode, 403, `${method} ${url} should reject absent Origin and Referer`);
  }
  for (const [method, url] of [['PATCH', `/api/me/notifications/${notificationId}/read`], ['POST', '/api/me/notifications/read-all']]) {
    const wrongOrigin = await app.inject({ method, url, headers: { cookie, origin: 'http://evil.example' }, payload: {} });
    assert.equal(wrongOrigin.statusCode, 403);
    const wrongReferer = await app.inject({ method, url, headers: { cookie, referer: 'http://evil.example/page' }, payload: {} });
    assert.equal(wrongReferer.statusCode, 403);
    const correctOrigin = await app.inject({ method, url, headers: { cookie, origin }, payload: {} });
    assert.equal(correctOrigin.statusCode, 200, correctOrigin.body);
    const correctReferer = await app.inject({ method, url, headers: { cookie, referer: `${origin}/member` }, payload: {} });
    assert.equal(correctReferer.statusCode, 200, correctReferer.body);
  }
  const readAfterDenied = await sql`SELECT read_at AS "readAt" FROM notifications WHERE id=${notificationId}`;
  assert.ok(readAfterDenied[0].readAt, 'an allowed Referer request should have marked the synthetic notification as read');
  await sql`INSERT INTO notifications(recipient_kind,recipient_id,type,title,body,deeplink,dedupe_key)
    VALUES ('client',${memberA.clientId},'document_pending','CSRF denied test','Synthetic regression row','/profile',${`member-pilot-csrf-denied-${randomUUID()}`})`;
  for (const url of ['/api/me/notifications/read-all', '/api/%6de/notifications/read-all', '/api/m%65/notifications/read-all', '/api/me/notificati%6Fns/read-all', '/api/%6D%65/notifications/read-all']) {
    const result = await app.inject({ method: 'POST', url, headers: { cookie, origin: 'null' }, payload: {} });
    assert.equal(result.statusCode, 403, `${url} must reject a null Origin`);
  }
  const deniedRow = await sql`SELECT read_at AS "readAt" FROM notifications WHERE recipient_kind='client' AND recipient_id=${memberA.clientId} AND title='CSRF denied test'`;
  assert.equal(deniedRow[0].readAt, null, 'rejected encoded routes must not mutate notification state');
  const safeRead = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie, origin: 'http://evil.example' } });
  assert.equal(safeRead.statusCode, 200, 'GET remains a safe Member read');
  const safeHead = await app.inject({ method: 'HEAD', url: '/api/me', headers: { cookie, origin: 'http://evil.example' } });
  assert.equal(safeHead.statusCode, 200, 'HEAD remains a safe Member read');
  const malformed = await app.inject({ method: 'PATCH', url: '/api/%6de/notifications/%E0%A4%A/read', headers: { cookie, origin: 'http://evil.example' }, payload: {} });
  assert.ok([400, 404].includes(malformed.statusCode), malformed.body);
  const malformedSlash = await app.inject({ method: 'POST', url: '/api/me%2fnotifications/read-all', headers: { cookie, origin: 'http://evil.example' }, payload: {} });
  assert.equal(malformedSlash.statusCode, 404);
  for (const url of ['/api//me/notifications/read-all', '/api/me/notifications/read-all/', '/api/me/./notifications/read-all', '/api/me/notifications/read-all?clientId=other']) {
    const result = await app.inject({ method: 'POST', url, headers: { cookie, origin: 'http://evil.example' }, payload: {} });
    assert.ok([403, 404].includes(result.statusCode), `${url} must either be protected or not resolve to a route; got ${result.statusCode}`);
  }
});

test('revoked subjects, inactive persons, archived clients, and missing facets fail closed', async () => {
  const revokedSubjectMember = await createMember('Revoked subject', `code-revoked-${randomUUID()}`);
  const inactivePersonMember = await createMember('Inactive person', `code-inactive-${randomUUID()}`);
  const archivedClientMember = await createMember('Archived client', `code-archived-${randomUUID()}`);
  const missingFacetMember = await createMember('Missing facet', `code-no-facet-${randomUUID()}`, { facet: false });
  async function login(member) {
    const response = await app.inject({ method: 'POST', url: '/api/pilot/member/login', headers: { origin, 'content-type': 'application/json' }, payload: { code: member.code } });
    assert.equal(response.statusCode, 200, response.body); return response.headers['set-cookie'].split(';')[0];
  }
  const revokedCookie = await login(revokedSubjectMember);
  const inactiveCookie = await login(inactivePersonMember);
  const archivedCookie = await login(archivedClientMember);
  const missingFacetLogin = await app.inject({ method: 'POST', url: '/api/pilot/member/login', headers: { origin, 'content-type': 'application/json' }, payload: { code: missingFacetMember.code } });
  assert.equal(missingFacetLogin.statusCode, 401);
  await sql`UPDATE platform_person_auth_subjects SET status='revoked',revoked_at=now(),revoked_by='member-pilot-test' WHERE id=${revokedSubjectMember.subjectId}`;
  await sql`UPDATE platform_persons SET status='revoked' WHERE id=${inactivePersonMember.personId}`;
  await sql`UPDATE clients SET status='archived' WHERE id=${archivedClientMember.clientId}`;
  for (const cookie of [revokedCookie,inactiveCookie,archivedCookie]) assert.equal((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode, 401);
});

test('pilot member auth cannot be enabled outside development or test', () => {
  const prior = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  try {
    assert.throws(() => buildServer(process.env.DATABASE_URL, { memberPilotAuthEnabled: true, memberAppOrigin: origin }), /restricted to development\/test/);
    assert.throws(() => buildServer(process.env.DATABASE_URL, { memberPilotBookingEnabled: true }), /development\/test Member pilot authentication/);
    assert.throws(() => buildServer(process.env.DATABASE_URL, { memberPilotCohortManagementEnabled: true }), /restricted to development\/test/);
  }
  finally { process.env.NODE_ENV = prior; }
});
