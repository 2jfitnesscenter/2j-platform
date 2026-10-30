import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { createBookingEligibilityResolver } from '../src/booking-eligibility.ts';
import { createTrainingLinkTransactions } from '../src/training-link-protocol.ts';
import { createTrainingCanonicalLinkLifecycle } from '../src/training-link-lifecycle.ts';

process.env.NODE_ENV ??= 'test';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: PostgreSQL client-app integration tests cannot be skipped.');
const sql = postgres(process.env.DATABASE_URL, { max: 12, connect_timeout: 5 });
await migrateDatabase(sql);
const eligibility = createBookingEligibilityResolver();
const admin = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'client-app-test-admin', role: 'admin' }), bookingEligibilityResolver: eligibility });
const anonymous = buildServer(process.env.DATABASE_URL);
const makeClient = async name => {
  const response = await admin.inject({ method: 'POST', url: '/api/clients', headers: { 'idempotency-key': randomUUID() }, payload: { firstName: name, lastName: `Client app ${randomUUID().slice(0,8)}` } });
  assert.equal(response.statusCode, 201, response.body); return response.json();
};
const a = await makeClient('Ada'); const b = await makeClient('Bea'); const c = await makeClient('Celia');
const memberPersons = { [a.id]: randomUUID(), [b.id]: randomUUID(), [c.id]: randomUUID() };
for (const client of [a, b, c]) {
  const personId = memberPersons[client.id];
  await sql`INSERT INTO platform_persons(id,status,created_by) VALUES (${personId}::uuid,'active','client-app-test')`;
  await sql`INSERT INTO platform_person_clients(person_id,client_id,linked_by) VALUES (${personId}::uuid,${client.id}::uuid,'client-app-test')`;
  await sql`INSERT INTO platform_member_booking_pilot_cohort(person_id,status,enabled_by) VALUES (${personId}::uuid,'active','client-app-test')`;
}
const trainingUserA = `training-${randomUUID()}`;
const trainingUserB = `training-revoked-${randomUUID()}`;
await sql`INSERT INTO training_account_links(request_id,person_id,training_user_id,method,created_by,updated_by) VALUES (${randomUUID()},${memberPersons[a.id]}::uuid,${trainingUserA},'explicit_admin','client-app-test','client-app-test')`;
const [revokedTrainingLink] = await sql`INSERT INTO training_account_links(request_id,person_id,training_user_id,method,created_by,updated_by) VALUES (${randomUUID()},${memberPersons[b.id]}::uuid,${trainingUserB},'explicit_admin','client-app-test','client-app-test') RETURNING link_id`;
await sql`UPDATE training_account_links SET status='revoked',revoked_at=now(),updated_by='client-app-test' WHERE link_id=${revokedTrainingLink.link_id}`;
const pendingAuth = { personId: memberPersons[c.id], provider: 'fixture-central-auth', providerVersion: 1, authSubject: `client-app-pending-${randomUUID()}` };
await sql`INSERT INTO platform_person_auth_subjects(person_id,auth_subject,provider,provider_version,created_by) VALUES (${pendingAuth.personId}::uuid,${pendingAuth.authSubject},${pendingAuth.provider},${pendingAuth.providerVersion},'client-app-test')`;
const linkProtocol = createTrainingLinkTransactions(sql, { enabled: true, serviceCallsEnabled: true });
const pendingTransaction = await linkProtocol.create({ ...pendingAuth, requestId: randomUUID() });
const pendingTrainingUser = `training-pending-${randomUUID()}`;
assert.equal((await linkProtocol.verify({ transactionId: pendingTransaction.transaction.transactionId, challenge: pendingTransaction.challenge, assertion: {}, auth: pendingAuth }, async () => pendingTrainingUser)).status, 'verified');
const [pendingStored] = await sql`SELECT nonce_hash,verified_at FROM training_link_transactions WHERE transaction_id=${pendingTransaction.transaction.transactionId}`;
const pendingReceipt = { v: 1, status: 'verified', receiptId: randomUUID(), receiptVersion: 1, transactionId: pendingTransaction.transaction.transactionId, personId: pendingAuth.personId, trainingUserId: pendingTrainingUser, audience: '2j-training-account-link', purpose: 'training-account-link', challengeDigest: pendingStored.nonce_hash.trim(), verifiedAt: new Date(pendingStored.verified_at).toISOString() };
const linkLifecycle = createTrainingCanonicalLinkLifecycle(sql, { trainingVerifiedLinkingEnabled: true, trainingServiceCallsEnabled: true, trainingCanonicalLinkingEnabled: true, reconcileReceipt: async () => pendingReceipt });
assert.equal((await linkLifecycle.reconcile({ transactionId: pendingTransaction.transaction.transactionId, auth: { authSubject: pendingAuth.authSubject, provider: pendingAuth.provider, providerVersion: pendingAuth.providerVersion, personId: pendingAuth.personId } })).status, 'pending');
const summaryRequests = [];
let summaryUnavailable = false;
const trainingAdapter = { getSummary: async trainingUserId => {
  summaryRequests.push(trainingUserId);
  if (summaryUnavailable) return { status: 'unavailable' };
  return { status: 'available', summary: { v: 1, trainingUserId, trainingStatus: 'active', asOf: new Date().toISOString(), currentProgram: { id: 'program-private-id', name: 'Fuerza' }, recentActivity: { lastTrainingAt: '2026-10-12', sessionsLast30Days: 4 } } };
} };
const [area] = await sql`SELECT id FROM areas WHERE status='active' ORDER BY id LIMIT 1`;
const serviceResponse = await admin.inject({ method: 'POST', url: '/api/services', payload: { name: `App client ${randomUUID()}`, areaId: area.id, status: 'active' } });
assert.equal(serviceResponse.statusCode, 201, serviceResponse.body);
const service = serviceResponse.json();
const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const planResponse = await admin.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': randomUUID() }, payload: {
  name: `Client self-service ${randomUUID()}`, serviceIds: [service.id], kind: 'session_pack', renewalCadence: null, basePriceCents: 1000,
  modules: [{ module: 'reservations', accessLevel: 'full', capabilities: [] }],
  rights: [{ rightType: 'service_access', serviceId: service.id }, { rightType: 'sessions_quota', serviceId: service.id, quotaScope: 'per_service', quantity: 10 }],
} });
assert.equal(planResponse.statusCode, 201, planResponse.body);
assert.equal((await admin.inject({ method: 'POST', url: `/api/plans/${planResponse.json().id}/activate`, payload: {} })).statusCode, 200);
for (const client of [a, b]) {
  const sale = await admin.inject({ method: 'POST', url: `/api/clients/${client.id}/plans`, headers: { 'idempotency-key': randomUUID() }, payload: { planId: planResponse.json().id, startsOn: localDate, dueOn: localDate, amountCents: 1000 } });
  assert.equal(sale.statusCode, 201, sale.body);
}
const startsAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
const [session] = await sql`INSERT INTO calendar_sessions(service_id,area_id,starts_at,duration_minutes,capacity,created_by) VALUES (${service.id},${area.id},${startsAt},45,1,'client-app-test') RETURNING id`;
const byClient = clientId => buildServer(process.env.DATABASE_URL, {
  memberPilotAuthEnabled: true, memberPilotBookingEnabled: true, memberAppOrigin: 'http://127.0.0.1:5173',
  clientAuthorizationResolver: async () => ({ clientId, personId: memberPersons[clientId] }),
  bookingEligibilityResolver: eligibility,
  trainingServiceCallsEnabled: true, trainingSummaryEnabled: true,
  trainingSummaryAdapter: trainingAdapter,
});
const appA = byClient(a.id); const appB = byClient(b.id);
const appC = byClient(c.id);
const cohortAdmin = buildServer(process.env.DATABASE_URL, { memberPilotCohortManagementEnabled: true, authorizationResolver: async () => ({ actorId: 'cohort-test-admin', role: 'admin' }) });
const cohortTrainer = buildServer(process.env.DATABASE_URL, { memberPilotCohortManagementEnabled: true, authorizationResolver: async () => ({ actorId: 'cohort-test-trainer', role: 'trainer' }) });
const readOnlyMember = buildServer(process.env.DATABASE_URL, { memberPilotAuthEnabled: true, memberAppOrigin: 'http://127.0.0.1:5173', clientAuthorizationResolver: async () => ({ clientId: b.id, personId: memberPersons[b.id] }) });
const mismatchedPersonMember = buildServer(process.env.DATABASE_URL, { clientAuthorizationResolver: async () => ({ clientId: a.id, personId: memberPersons[b.id] }) });
after(async () => {
  await Promise.all([admin.close(), anonymous.close(), appA.close(), appB.close(), appC.close(), cohortAdmin.close(), cohortTrainer.close(), readOnlyMember.close(), mismatchedPersonMember.close()]);
  await sql.end();
});

test('Member preferences are canonical-person scoped, persisted, strict and available without an active fee', async () => {
  const safeOrigin = { origin: 'http://127.0.0.1:5173' };
  const defaults = await appA.inject({ method: 'GET', url: '/api/me/preferences?clientId=' + b.id + '&personId=' + memberPersons[b.id] });
  assert.equal(defaults.statusCode, 200, defaults.body); assert.deepEqual(defaults.json(), { preferences: { appearance: 'system', language: 'es' } });
  const appearance = await appA.inject({ method: 'PATCH', url: '/api/me/preferences', headers: safeOrigin, payload: { appearance: 'light' } });
  assert.equal(appearance.statusCode, 200, appearance.body); assert.deepEqual(appearance.json(), { preferences: { appearance: 'light', language: 'es' } });
  const language = await appA.inject({ method: 'PATCH', url: '/api/me/preferences', headers: safeOrigin, payload: { language: 'es' } });
  assert.equal(language.statusCode, 200); assert.equal(language.json().preferences.language, 'es');
  assert.deepEqual((await appB.inject({ method: 'GET', url: '/api/me/preferences' })).json(), { preferences: { appearance: 'system', language: 'es' } });
  assert.equal((await appA.inject({ method: 'PATCH', url: '/api/me/preferences', headers: safeOrigin, payload: { personId: memberPersons[b.id], appearance: 'dark' } })).statusCode, 400);
  assert.equal((await appA.inject({ method: 'PATCH', url: '/api/me/preferences', headers: safeOrigin, payload: { clientId: b.id } })).statusCode, 400);
  assert.equal((await appA.inject({ method: 'PATCH', url: '/api/me/preferences', headers: safeOrigin, payload: { appearance: 'sepia' } })).statusCode, 400);
  assert.equal((await appA.inject({ method: 'PATCH', url: '/api/me/preferences', headers: safeOrigin, payload: { language: 'en' } })).statusCode, 400);
  assert.equal((await appA.inject({ method: 'PATCH', url: '/api/me/preferences', headers: safeOrigin, payload: { marketing: false } })).statusCode, 400);
  assert.deepEqual((await appB.inject({ method: 'GET', url: '/api/me/preferences' })).json(), { preferences: { appearance: 'system', language: 'es' } }, 'Member A cannot change Member B preferences');
  assert.equal((await appC.inject({ method: 'GET', url: '/api/me/preferences' })).statusCode, 200, 'identity preferences do not require an active fee');
  assert.equal((await anonymous.inject({ method: 'GET', url: '/api/me/preferences' })).statusCode, 401);
  assert.equal((await anonymous.inject({ method: 'PATCH', url: '/api/me/preferences', headers: safeOrigin, payload: { appearance: 'dark' } })).statusCode, 401);
  assert.equal((await mismatchedPersonMember.inject({ method: 'GET', url: '/api/me/preferences' })).statusCode, 409, 'a person id not bound to the authenticated client fails closed');
  const [stored] = await sql`SELECT appearance,language FROM platform_member_preferences WHERE person_id=${memberPersons[a.id]}::uuid`;
  assert.deepEqual(stored, { appearance: 'light', language: 'es' });
});

test('self-service facade derives the identity server-side and hides another client’s bookings', async () => {
  const me = await appA.inject({ method: 'GET', url: '/api/me' });
  assert.equal(me.statusCode, 200); assert.equal(me.json().profile.id, a.id);
  const linkedSummary = await appA.inject({ method: 'GET', url: `/api/me/training-summary?trainingUserId=${trainingUserB}` });
  assert.equal(linkedSummary.statusCode, 200);
  assert.equal(linkedSummary.json().status, 'linked'); assert.equal(linkedSummary.json().summaryStatus, 'available');
  assert.deepEqual(linkedSummary.json().summary, { trainingStatus: 'active', asOf: linkedSummary.json().summary.asOf, currentProgram: { name: 'Fuerza' }, recentActivity: { lastTrainingAt: '2026-10-12', sessionsLast30Days: 4 } });
  assert.deepEqual(summaryRequests, [trainingUserA], 'the server looks up only the canonical active-link Training ID');
  assert.equal(JSON.stringify(linkedSummary.json()).includes(trainingUserA), false, 'raw remote identity stays server-side');
  assert.equal(JSON.stringify(linkedSummary.json()).includes('program-private-id'), false, 'remote program IDs stay server-side');
  assert.deepEqual((await appB.inject({ method: 'GET', url: `/api/me/training-summary?trainingUserId=${trainingUserA}` })).json(), { status: 'not_linked' }, 'revoked links and browser-supplied alternate IDs are ignored');
  assert.deepEqual((await appC.inject({ method: 'GET', url: '/api/me/training-summary' })).json(), { status: 'not_linked' }, 'a verified-but-pending canonical link is not exposed');
  summaryUnavailable = true;
  const unavailable = await appA.inject({ method: 'GET', url: '/api/me/training-summary' });
  assert.deepEqual(unavailable.json(), { status: 'linked', summaryStatus: 'unavailable' });
  assert.equal((await appA.inject({ method: 'GET', url: '/api/me' })).statusCode, 200, 'profile remains available while Training is down');
  summaryUnavailable = false;
  const querySpoof = await appA.inject({ method: 'GET', url: `/api/me?clientId=${b.id}` });
  assert.equal(querySpoof.statusCode, 200); assert.equal(querySpoof.json().profile.id, a.id);
  const ownMembership = await appA.inject({ method: 'GET', url: '/api/me/membership' });
  const assignment = await sql`SELECT id FROM client_plan_assignments WHERE client_id=${a.id} ORDER BY created_at DESC,id DESC LIMIT 1`;
  assert.equal(ownMembership.statusCode, 200); assert.equal(ownMembership.json().assignments[0].id, assignment[0].id);
  assert.equal(ownMembership.json().assignments[0].rights.some(right => right.serviceId === service.id && right.serviceName === service.name), true);
  assert.equal(JSON.stringify(ownMembership.json()).includes(b.firstName), false);
  const spoof = await appA.inject({ method: 'POST', url: `/api/me/sessions/${session.id}/reservations`, headers: { origin: 'http://127.0.0.1:5173' }, payload: { clientId: b.id } });
  assert.equal(spoof.statusCode, 400); assert.equal(spoof.json().error, 'invalid_self_service_request');
  const reserved = await appA.inject({ method: 'POST', url: `/api/me/sessions/${session.id}/reservations`, headers: { origin: 'http://127.0.0.1:5173', 'idempotency-key': randomUUID() }, payload: {} });
  assert.equal(reserved.statusCode, 201, reserved.body);
  assert.equal((await sql`SELECT client_id FROM calendar_reservations WHERE id=${reserved.json().id}`)[0].client_id, a.id);
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const publicSessions = await appA.inject({ method: 'GET', url: `/api/me/sessions?from=${localDate}&to=${new Date(Date.now()+8*86_400_000).toISOString().slice(0,10)}` });
  assert.equal(publicSessions.statusCode, 200);
  const bookingServices = await appA.inject({ method: 'GET', url: '/api/me/booking-services' });
  assert.equal(bookingServices.statusCode, 200);
  assert.equal(bookingServices.json().services.some(row => row.id === service.id && row.name === service.name), true);
  assert.equal(JSON.stringify(bookingServices.json()).includes(b.firstName), false);
  assert.deepEqual(Object.keys(bookingServices.json().services[0] ?? {}).sort(), ['id', 'name']);
  assert.equal((await anonymous.inject({ method: 'GET', url: '/api/me/booking-services' })).statusCode, 401);
  const publicSession = publicSessions.json().sessions.find(row => row.id === session.id);
  assert.equal(publicSession.myReservationStatus, 'reserved');
  assert.equal(publicSession.professionalName === null || typeof publicSession.professionalName === 'string', true);
  assert.equal(JSON.stringify(publicSession).includes(b.firstName), false);
  assert.equal('email' in publicSession || 'phone' in publicSession || 'clientId' in publicSession, false);
  assert.deepEqual((await appB.inject({ method: 'GET', url: '/api/me/bookings' })).json().reservations, []);
  const foreignCancel = await appB.inject({ method: 'PATCH', url: `/api/me/bookings/${reserved.json().id}/cancel`, headers: { origin: 'http://127.0.0.1:5173' }, payload: {} });
  assert.equal(foreignCancel.statusCode, 404);
  const foreignPreview = await appB.inject({ method: 'GET', url: `/api/me/bookings/${reserved.json().id}/cancellation-preview` });
  assert.equal(foreignPreview.statusCode, 404);
  assert.equal((await sql`SELECT status FROM calendar_reservations WHERE id=${reserved.json().id}`)[0].status, 'reserved');
});

test('Member session list includes server-computed eligibility states without detail requests', async () => {
  const otherServiceResponse = await admin.inject({ method: 'POST', url: '/api/services', payload: { name: `Uncovered ${randomUUID()}`, areaId: area.id, status: 'active' } });
  assert.equal(otherServiceResponse.statusCode, 201, otherServiceResponse.body);
  const otherService = otherServiceResponse.json();
  const makeSession = async (dayOffset, sessionServiceId = service.id, capacity = 2) => {
    const startsAt = new Date(Date.now() + dayOffset * 86_400_000 + 12 * 3_600_000).toISOString();
    const [row] = await sql`INSERT INTO calendar_sessions(service_id,area_id,starts_at,duration_minutes,capacity,created_by)
      VALUES (${sessionServiceId},${area.id},${startsAt},45,${capacity},'eligibility-list-test') RETURNING id`;
    return row.id;
  };
  const availableId = await makeSession(3);
  const fullId = await makeSession(4, service.id, 1);
  const bookedId = await makeSession(5);
  const notAllowedId = await makeSession(6, otherService.id);
  const waitlistedId = await makeSession(7);
  const suspendedId = await makeSession(8, otherService.id);
  await sql`INSERT INTO calendar_reservations(session_id,client_id,entitlement_reference,created_by)
    VALUES (${fullId},${b.id},'synthetic-test','eligibility-list-test'),(${bookedId},${a.id},'synthetic-test','eligibility-list-test')`;
  await sql`INSERT INTO calendar_waitlist_entries(session_id,client_id,entitlement_reference,created_by)
    VALUES (${waitlistedId},${a.id},'synthetic-test','eligibility-list-test'),(${suspendedId},${a.id},'synthetic-test','eligibility-list-test')`;

  const from = new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const to = new Date(Date.parse(`${from}T12:00:00Z`) + 10 * 86_400_000).toISOString().slice(0, 10);
  const response = await appA.inject({ method: 'GET', url: `/api/me/sessions?from=${from}&to=${to}` });
  assert.equal(response.statusCode, 200, response.body);
  const listed = response.json().sessions;
  const byId = new Map(listed.map(row => [row.id, row]));
  assert.equal(byId.get(availableId)?.availability.status, 'available');
  assert.equal(byId.get(fullId)?.availability.status, 'full');
  assert.equal(byId.get(bookedId)?.availability.status, 'booked');
  assert.deepEqual(byId.get(notAllowedId)?.availability, { status: 'not_allowed_by_plan', reason: 'service_not_allowed', canJoinWaitlist: false });
  assert.equal(byId.get(waitlistedId)?.availability.status, 'waitlisted');
  assert.deepEqual(byId.get(suspendedId)?.availability, { status: 'waitlist_suspended', reason: 'service_not_allowed', canJoinWaitlist: false });
  for (const id of [availableId, fullId, bookedId, notAllowedId, waitlistedId, suspendedId]) {
    assert.equal('myWaitlistEntryId' in byId.get(id), false, 'internal waitlist entry IDs are not exposed');
    assert.equal(typeof byId.get(id)?.availability.status, 'string');
    assert.equal(typeof byId.get(id)?.availability.canJoinWaitlist, 'boolean');
  }
});

test('an active Member without any fee can still read Profile, inbox and documents', async () => {
  const client = await makeClient('No fee');
  const member = buildServer(process.env.DATABASE_URL, { clientAuthorizationResolver: async () => ({ clientId: client.id }) });
  try {
    const [profile, membership, forms, consents, unread] = await Promise.all([
      member.inject({ method: 'GET', url: '/api/me' }),
      member.inject({ method: 'GET', url: '/api/me/membership' }),
      member.inject({ method: 'GET', url: '/api/client-portal/form-assignments' }),
      member.inject({ method: 'GET', url: '/api/client-portal/consents' }),
      member.inject({ method: 'GET', url: '/api/me/notifications/unread-count' }),
    ]);
    assert.equal(profile.statusCode, 200); assert.equal(profile.json().profile.id, client.id);
    assert.equal(membership.statusCode, 200); assert.deepEqual(membership.json().assignments, []);
    assert.equal(forms.statusCode, 200); assert.deepEqual(forms.json(), []);
    assert.equal(consents.statusCode, 200); assert.deepEqual(consents.json(), []);
    assert.equal(unread.statusCode, 200); assert.deepEqual(unread.json(), { count: 0 });
  } finally { await member.close(); }
});

test('self-service waitlist and cancellation are owner-scoped and use the central booking engine', async () => {
  const joined = await appB.inject({ method: 'POST', url: `/api/me/sessions/${session.id}/waitlist`, headers: { origin: 'http://127.0.0.1:5173', 'idempotency-key': randomUUID() }, payload: {} });
  assert.equal(joined.statusCode, 201, joined.body);
  const row = await sql`SELECT client_id,status FROM calendar_waitlist_entries WHERE id=${joined.json().id}`;
  assert.equal(row[0].client_id, b.id); assert.equal(row[0].status, 'waiting');
  const spoof = await appB.inject({ method: 'POST', url: `/api/me/sessions/${session.id}/waitlist`, headers: { origin: 'http://127.0.0.1:5173' }, payload: { clientId: a.id } });
  assert.equal(spoof.statusCode, 400);
  const foreignLeave = await appA.inject({ method: 'PATCH', url: `/api/me/waitlist/${joined.json().id}/cancel`, headers: { origin: 'http://127.0.0.1:5173' }, payload: {} });
  assert.equal(foreignLeave.statusCode, 404);
  const left = await appB.inject({ method: 'PATCH', url: `/api/me/waitlist/${joined.json().id}/cancel`, headers: { origin: 'http://127.0.0.1:5173', 'idempotency-key': randomUUID() }, payload: {} });
  assert.equal(left.statusCode, 200, left.body); assert.equal(left.json().status, 'cancelled');

  const [ownSession] = await sql`INSERT INTO calendar_sessions(service_id,area_id,starts_at,duration_minutes,capacity,created_by) VALUES (${service.id},${area.id},${new Date(Date.now()+5*86_400_000).toISOString()},45,2,'client-app-test') RETURNING id`;
  const ownReservation = await appB.inject({ method: 'POST', url: `/api/me/sessions/${ownSession.id}/reservations`, headers: { origin: 'http://127.0.0.1:5173', 'idempotency-key': randomUUID() }, payload: {} });
  assert.equal(ownReservation.statusCode, 201, ownReservation.body);
  const preview = await appB.inject({ method: 'GET', url: `/api/me/bookings/${ownReservation.json().id}/cancellation-preview` });
  assert.equal(preview.statusCode, 200); assert.equal(preview.json().canCancel, true);
  const cancelled = await appB.inject({ method: 'PATCH', url: `/api/me/bookings/${ownReservation.json().id}/cancel`, headers: { origin: 'http://127.0.0.1:5173', 'idempotency-key': randomUUID() }, payload: {} });
  assert.equal(cancelled.statusCode, 200, cancelled.body);
  assert.equal((await sql`SELECT status FROM calendar_reservations WHERE id=${ownReservation.json().id}`)[0].status, 'cancelled');
});

test('booking cohort blocks all four direct mutations immediately after revocation while reads remain available', async () => {
  const starts = [new Date(Date.now()+9*86_400_000).toISOString(), new Date(Date.now()+10*86_400_000).toISOString()];
  const sessions = await Promise.all(starts.map(startsAt => sql`INSERT INTO calendar_sessions(service_id,area_id,starts_at,duration_minutes,capacity,created_by) VALUES (${service.id},${area.id},${startsAt},45,2,'cohort-gate-test') RETURNING id`));
  const reservationId = randomUUID(); const waitlistId = randomUUID();
  await sql`INSERT INTO calendar_reservations(id,session_id,client_id,entitlement_reference,created_by) VALUES (${reservationId},${sessions[0][0].id},${b.id},'synthetic-test','cohort-gate-test')`;
  await sql`INSERT INTO calendar_waitlist_entries(id,session_id,client_id,entitlement_reference,created_by) VALUES (${waitlistId},${sessions[1][0].id},${b.id},'synthetic-test','cohort-gate-test')`;
  const access = await appB.inject({ method: 'GET', url: '/api/me/booking-access' });
  assert.deepEqual(access.json(), { enabled: true });
  await sql`UPDATE platform_member_booking_pilot_cohort SET status='revoked',disabled_at=now(),disabled_by='cohort-test-admin' WHERE person_id=${memberPersons[b.id]}::uuid`;
  for (const request of [
    { method: 'POST', url: `/api/me/sessions/${sessions[0][0].id}/reservations`, payload: {} },
    { method: 'POST', url: `/api/me/sessions/${sessions[0][0].id}/waitlist`, payload: {} },
    { method: 'PATCH', url: `/api/me/bookings/${reservationId}/cancel`, payload: {} },
    { method: 'PATCH', url: `/api/me/waitlist/${waitlistId}/cancel`, payload: {} },
  ]) {
    const result = await appB.inject({ ...request, headers: { origin: 'http://127.0.0.1:5173', 'idempotency-key': randomUUID() } });
    assert.equal(result.statusCode, 403, result.body);
    assert.equal(result.json().error, 'member_pilot_action_not_enabled');
  }
  assert.equal((await appB.inject({ method: 'GET', url: '/api/me' })).statusCode, 200);
  assert.equal((await appB.inject({ method: 'GET', url: '/api/me/membership' })).statusCode, 200);
  assert.equal((await appB.inject({ method: 'GET', url: '/api/me/sessions?from=2026-10-12&to=2026-10-20' })).statusCode, 200);
  assert.equal((await appB.inject({ method: 'GET', url: '/api/me/bookings' })).statusCode, 200);
  assert.equal((await sql`SELECT status FROM calendar_reservations WHERE id=${reservationId}`)[0].status, 'reserved');
  assert.equal((await sql`SELECT status FROM calendar_waitlist_entries WHERE id=${waitlistId}`)[0].status, 'waiting');
  await sql`UPDATE platform_member_booking_pilot_cohort SET status='active',disabled_at=NULL,disabled_by=NULL WHERE person_id=${memberPersons[b.id]}::uuid`;
});

test('Admin can explicitly enable and revoke booking cohort membership; Trainer cannot manage it', async () => {
  await sql`UPDATE platform_member_booking_pilot_cohort SET status='revoked',disabled_at=now(),disabled_by='cohort-test' WHERE person_id=${memberPersons[b.id]}::uuid`;
  const denied = await cohortTrainer.inject({ method: 'PUT', url: `/api/admin/member-pilot/cohort/${b.id}`, payload: { enabled: true, reason: 'Test opt-in' } });
  assert.equal(denied.statusCode, 403);
  const enabled = await cohortAdmin.inject({ method: 'PUT', url: `/api/admin/member-pilot/cohort/${b.id}`, payload: { enabled: true, reason: 'Approved internal test cohort' } });
  assert.equal(enabled.statusCode, 200, enabled.body); assert.equal(enabled.json().status, 'active');
  const revoked = await cohortAdmin.inject({ method: 'PUT', url: `/api/admin/member-pilot/cohort/${b.id}`, payload: { enabled: false, reason: 'Pilot test complete' } });
  assert.equal(revoked.statusCode, 200, revoked.body); assert.equal(revoked.json().status, 'revoked');
  const events = await sql`SELECT action FROM platform_member_booking_pilot_cohort_events WHERE person_id=${memberPersons[b.id]}::uuid ORDER BY occurred_at,id`;
  assert.ok(events.some(row => row.action === 'booking_cohort.enabled'));
  assert.ok(events.some(row => row.action === 'booking_cohort.revoked'));
});

test('booking rollout flag defaults to read-only while authenticated Member reads remain available', async () => {
  assert.equal((await readOnlyMember.inject({ method: 'GET', url: '/api/me' })).statusCode, 200);
  assert.deepEqual((await readOnlyMember.inject({ method: 'GET', url: '/api/me/booking-access' })).json(), { enabled: false });
  const denied = await readOnlyMember.inject({ method: 'POST', url: `/api/me/sessions/${session.id}/reservations`, headers: { origin: 'http://127.0.0.1:5173' }, payload: {} });
  assert.equal(denied.statusCode, 403); assert.equal(denied.json().error, 'member_pilot_action_not_enabled');
});

test('client API fails closed when the host has no client identity resolver', async () => {
  const response = await anonymous.inject({ method: 'GET', url: '/api/me' });
  assert.equal(response.statusCode, 401); assert.equal(response.json().error, 'client_authentication_required');
  const mutation = await anonymous.inject({ method: 'POST', url: `/api/me/sessions/${session.id}/reservations`, payload: {} });
  assert.equal(mutation.statusCode, 401);
});
