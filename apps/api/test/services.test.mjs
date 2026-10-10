import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Writable } from 'node:stream';
import { buildServer, mapDatabaseError, planInput, serviceInput } from '../src/server.ts';
import { createClientInput } from '../src/clients.ts';
import { migrateDatabase } from '../src/migrate.ts';
import * as schema from '../src/schema.ts';
import { getEffectiveEntitlements } from '../src/entitlements.ts';
import { getTableConfig } from 'drizzle-orm/pg-core';
import postgres from 'postgres';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: PostgreSQL integration tests cannot be skipped.');

const sql = postgres(process.env.DATABASE_URL, { max: 10, connect_timeout: 5 });
await migrateDatabase(sql);
const app = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'qa-admin', role: 'admin' }) });
const anonymousApp = buildServer(process.env.DATABASE_URL);
const clientsAdminApp = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'qa-admin', role: 'admin' }) });
const clientsTrainerApp = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'qa-trainer', role: 'trainer' }) });
const clientsReceptionApp = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'qa-reception', role: 'reception-management' }) });
const clientsAccountantApp = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'qa-accountant', role: 'accountant' }) });
const [defaultArea] = await sql`SELECT id,name FROM areas WHERE normalized_name='la sala'`;
after(async () => { await Promise.all([app.close(), anonymousApp.close(), clientsAdminApp.close(), clientsTrainerApp.close(), clientsReceptionApp.close(), clientsAccountantApp.close()]); await sql.end(); });

function createClientRequest(server, payload, key = randomUUID()) {
  return server.inject({ method: 'POST', url: '/api/clients', headers: { 'idempotency-key': key }, payload });
}

async function createService(name = `Servicio ${randomUUID()}`, status = 'active') {
  const response = await app.inject({ method: 'POST', url: '/api/services', payload: { name, areaId: defaultArea.id, status } });
  assert.equal(response.statusCode, 201, response.body);
  return response.json();
}

function planPayload(serviceIds, overrides = {}) {
  return {
    name: `Plan ${randomUUID()}`, serviceIds, kind: 'recurring', renewalCadence: 'monthly',
    rights: [{ rightType: 'service_access', serviceId: serviceIds[0] }], ...overrides,
  };
}

async function createPlan(serviceIds, overrides = {}, idempotencyKey = randomUUID()) {
  const body = planPayload(serviceIds, overrides);
  const response = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': idempotencyKey }, payload: body });
  return { body, response };
}

test('domain input separates product kind from renewal and defines quota periods explicitly', () => {
      const valid = planPayload([randomUUID()], { rights: [{ rightType: 'period_quota', serviceId: null, quotaScope: 'shared', quantity: 8, period: 'month', periodMode: 'calendar', timezone: 'Atlantic/Canary' }] });
  assert.equal(planInput.safeParse(valid).success, true);
  assert.equal(planInput.safeParse({ ...valid, kind: 'session_pack', renewalCadence: 'monthly' }).success, false);
  assert.equal(planInput.safeParse({ ...valid, kind: 'session_pack', renewalCadence: null, rights: [{ rightType: 'service_access' }] }).success, false);
  assert.equal(planInput.safeParse({ ...valid, kind: 'session_pack', renewalCadence: null, rights: [{ rightType: 'period_quota', quantity: 8, quotaScope: 'shared', period: 'month', periodMode: 'calendar' }] }).success, false);
  assert.equal(planInput.safeParse({ ...valid, rights: [{ rightType: 'period_quota', quantity: 8, quotaScope: 'shared', period: 'month' }] }).success, false);
  assert.equal(planInput.safeParse({ ...valid, serviceIds: [valid.serviceIds[0], valid.serviceIds[0]] }).success, false);
  assert.equal(planInput.safeParse({ ...valid, rights: [{ rightType: 'service_access', serviceId: randomUUID() }] }).success, false);
  assert.equal(planInput.safeParse({ ...valid, rights: [{ rightType: 'service_access', serviceId: valid.serviceIds[0] }] }).success, true, 'a direct service grant requires and accepts a listed target');
  assert.equal(planInput.safeParse({ ...valid, rights: [{ rightType: 'service_access' }] }).success, false, 'a direct grant without target is invalid');
  assert.equal(planInput.safeParse({ ...valid, rights: [{ rightType: 'service_access', serviceId: null }] }).success, false, 'null cannot mean wildcard access');
  assert.equal(planInput.safeParse({ ...valid, rights: [
    { rightType: 'sessions_quota', serviceId: null, quotaScope: 'shared', quantity: 10 },
    { rightType: 'sessions_quota', serviceId: randomUUID(), quotaScope: 'per_service', quantity: 4 },
  ] }).success, false, 'global and targeted quotas of the same type cannot overlap');
  assert.equal(planInput.safeParse({ ...valid, rights: [
    { rightType: 'sessions_quota', quotaScope: 'shared', quantity: 10 },
    { rightType: 'sessions_quota', serviceId: randomUUID(), quotaScope: 'per_service', quantity: 4, period: null },
  ] }).success, false, 'omitted and null periods have the same database meaning');
  assert.equal(planInput.safeParse({ ...valid, rights: [{ rightType: 'sessions_quota', serviceId: randomUUID(), quotaScope: 'shared', quantity: 4 }] }).success, false, 'shared quotas are global');
  assert.equal(serviceInput.safeParse({ name: ' Sala ', areaId: randomUUID(), status: 'draft' }).success, true);
  assert.equal(serviceInput.safeParse({ name: 'Sala', area: 'Sala', status: 'draft' }).success, false);
});

test('client input keeps its personal-data surface intentionally small and validates email/contact lengths', () => {
  const normalized = createClientInput.safeParse({ firstName: ' Ada ', lastName: ' Lovelace ', email: ' ADA@example.test ', phone: '+34 600 000 000' });
  assert.equal(normalized.success, true);
  assert.deepEqual(normalized.data, { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test', phone: '+34 600 000 000' });
  assert.equal(createClientInput.safeParse({ firstName: 'Ada', lastName: 'Lovelace', dateOfBirth: '1990-01-01' }).success, false);
  assert.equal(createClientInput.safeParse({ firstName: 'Ada', lastName: 'Lovelace', email: 'not-an-email' }).success, false);
  assert.equal(createClientInput.safeParse({ firstName: 'Ada', lastName: 'Lovelace', phone: 'x'.repeat(41) }).success, false);
  assert.equal(createClientInput.safeParse({ firstName: '\ufb01'.repeat(41), lastName: 'Test' }).success, false, 'post-NFKC length must be validated');
  assert.equal(createClientInput.safeParse({ firstName: 'Ada', lastName: 'Test', email: null, phone: '' }).success, true);
});

test('DB migration is checksummed, repeatable and unchanged on re-application', async () => {
  const directory = new URL('../migrations/', import.meta.url);
  const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  const first = await migrateDatabase(sql);
  const second = await migrateDatabase(sql);
  assert.deepEqual(second.map((item) => [item.name, item.checksum.trim()]), first.map((item) => [item.name, item.checksum.trim()]));
  assert.deepEqual(first.map((item) => item.name), names);
  for (const name of names) {
    const contents = await readFile(new URL(name, directory), 'utf8');
    assert.equal(first.find((item) => item.name === name)?.checksum.trim(), createHash('sha256').update(contents).digest('hex'));
  }
  const migration = names[0];
  const originalChecksum = first.find((item) => item.name === migration).checksum.trim();
  await sql`UPDATE schema_migrations SET checksum=${'0'.repeat(64)} WHERE name=${migration}`;
  await assert.rejects(migrateDatabase(sql), /Migration checksum mismatch/);
  await sql`UPDATE schema_migrations SET checksum=${originalChecksum} WHERE name=${migration}`;
});

test('Drizzle table columns, checks and indexes match the SQL baseline', async () => {
  const tables = [schema.areas, schema.services, schema.plans, schema.planServices, schema.planVersions, schema.planRights, schema.planModuleAccesses, schema.planModuleCapabilities, schema.planVersionChanges, schema.clients, schema.clientEvents, schema.clientCreationIdempotency, schema.clientPlanAssignments, schema.clientPlanAssignmentEvents, schema.clientEntitlementLedger, schema.dashboardPreferences, schema.recurringSessionTemplates, schema.calendarSessions, schema.calendarReservations, schema.calendarWaitlistEntries, schema.calendarReservationRights, schema.calendarBookingOperations, schema.calendarAuditEvents, schema.staffProfessionals, schema.staffScheduleSlots, schema.staffExceptions, schema.staffSubstitutions, schema.staffTimeclockEvents, schema.staffTimeclockCorrections, schema.staffAuditEvents];
  const databaseTables = await sql`SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name IN ${sql(tables.map((table) => getTableConfig(table).name))} ORDER BY table_name,column_name`;
  const dbColumns = Map.groupBy(databaseTables, (row) => row.table_name);
  const checks = new Set((await sql`SELECT conname FROM pg_constraint WHERE contype='c'`).map((row) => row.conname));
  const indexes = new Set((await sql`SELECT indexname FROM pg_indexes WHERE schemaname='public'`).map((row) => row.indexname));
  for (const table of tables) {
    const config = getTableConfig(table);
    assert.deepEqual((dbColumns.get(config.name) ?? []).map((row) => row.column_name).sort(), config.columns.map((column) => column.name).sort(), `${config.name} columns drifted`);
    for (const column of config.columns) {
      const databaseColumn = dbColumns.get(config.name).find((row) => row.column_name === column.name);
      assert.equal(databaseColumn.is_nullable === 'YES', !column.notNull, `${config.name}.${column.name} nullability drifted`);
      const rawType = column.getSQLType();
      const expectedType = rawType.replace(/^char\(/, 'character(').replace(/^time$/, 'time without time zone');
      assert.ok(databaseColumn.data_type === expectedType || (expectedType.startsWith('character(') && databaseColumn.data_type === 'character'), `${config.name}.${column.name} type drifted: ${databaseColumn.data_type} != ${expectedType}`);
      assert.equal(databaseColumn.column_default != null, column.hasDefault, `${config.name}.${column.name} default presence drifted`);
    }
    for (const check of config.checks) assert.ok(checks.has(check.name), `missing SQL check ${check.name}`);
    for (const index of config.indexes) assert.ok(indexes.has(index.config.name), `missing SQL index ${index.config.name}`);
  }
  const configuredForeignKeys = tables.flatMap((table) => getTableConfig(table).foreignKeys.map((foreignKey) => foreignKey.getName()));
  const databaseForeignKeys = await sql`SELECT conname,confdeltype FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace`;
  const foreignKeyAliases = (name) => [name, name.slice(0, 63), name.replace(/_(?:staff_professionals|staff_timeclock_events)_id_fk$/, '_fkey')];
  for (const name of configuredForeignKeys) assert.ok(databaseForeignKeys.some((key) => foreignKeyAliases(name).includes(key.conname)), `missing SQL foreign key ${name}`);
  for (const key of databaseForeignKeys.filter((item) => configuredForeignKeys.some((name) => foreignKeyAliases(name).includes(item.conname)))) assert.equal(key.confdeltype, 'r', `${key.conname} must restrict historical deletes`);
  assert.ok((await sql`SELECT 1 FROM pg_constraint WHERE conname='plans_current_version_fk'`).length, 'SQL must retain the deferred active-version foreign key');
  const planIndexes = await sql`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('plans','services')`;
  assert.match(planIndexes.find((row) => row.indexname === 'plans_active_name_unique').indexdef, /lower\(name\)/);
  assert.match(planIndexes.find((row) => row.indexname === 'services_updated_idx').indexdef, /updated_at DESC/);
  const rightIndexes = await sql`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND indexname IN ('plan_rights_global_unique','plan_rights_service_unique')`;
  assert.equal(rightIndexes.length, 2);
  for (const index of rightIndexes) assert.match(index.indexdef, /COALESCE\(period, ''(?:::text)?\)/, `${index.indexname} must distinguish quota periods`);
});

test('client PII endpoints deny by default and ignore caller-supplied role headers', async () => {
  const denied = await anonymousApp.inject({ method: 'GET', url: '/api/clients', headers: { 'x-2j-role': 'admin' } });
  assert.equal(denied.statusCode, 401);
  assert.equal(denied.headers['cache-control'], 'no-store');
  assert.deepEqual(denied.json(), { error: 'authentication_required' });
  const testEmail = ` ADA-${randomUUID()}@example.test `;
  const created = await createClientRequest(clientsAdminApp, { firstName: 'Ada', lastName: `Lovelace ${randomUUID()}`, email: testEmail, phone: ' 555 0100 ' });
  assert.equal(created.statusCode, 201, created.body);
  const clientId = created.json().id;
  const trainer = await clientsTrainerApp.inject({ method: 'GET', url: `/api/clients/${clientId}` });
  assert.equal(trainer.statusCode, 200, trainer.body);
  assert.equal(trainer.json().client.email, testEmail.trim().toLowerCase());
  assert.equal(trainer.json().sections.find((section) => section.id === 'training').access, 'available');
  assert.equal(trainer.json().sections.find((section) => section.id === 'health').access, 'available');
  assert.equal(trainer.json().summary.payments.access, 'forbidden');
  assert.equal(trainer.json().summary.payments.data, null);
  assert.equal(trainer.json().summary.training.access, 'available');
  assert.equal(trainer.json().summary.health.access, 'available');
  assert.equal(trainer.json().summary.plans.access, 'available', 'Trainer has operational read access to entitlements');
  assert.equal(trainer.json().summary.documents.access, 'available');
  assert.deepEqual(trainer.json().summary.messages.data, { unreadCount: 0, lastMessageAt: null });
  assert.equal(trainer.json().sections.find((section) => section.id === 'payments').sourceLabel, 'Pagos');
  assert.equal(JSON.stringify(trainer.json()).includes('qa-admin'), false);
  const forbiddenCreate = await createClientRequest(clientsTrainerApp, { firstName: 'No', lastName: 'Write' });
  assert.equal(forbiddenCreate.statusCode, 403);
  const accountant = await clientsAccountantApp.inject({ method: 'GET', url: `/api/clients/${clientId}` });
  assert.equal(accountant.statusCode, 403);
  assert.equal(accountant.json().client, undefined);
});

test('client list searches normalized name/contact, and archive retains profile history', async () => {
  const created = await createClientRequest(clientsAdminApp, { firstName: '  Marta  ', lastName: `Prueba ${randomUUID()}`, email: 'marta-search@example.test' });
  assert.equal(created.statusCode, 201, created.body);
  const clientId = created.json().id;
  const search = await clientsTrainerApp.inject({ method: 'GET', url: '/api/clients?q=MARTA-SEARCH@EXAMPLE.TEST' });
  assert.equal(search.statusCode, 200, search.body);
  assert.equal(search.json().items.some((item) => item.id === clientId), true);
  const profile = await clientsTrainerApp.inject({ method: 'GET', url: `/api/clients/${clientId}` });
  assert.equal(profile.statusCode, 200);
  assert.deepEqual(profile.json().history.map((event) => event.eventType), ['client.created']);
  const archive = await clientsAdminApp.inject({ method: 'PATCH', url: `/api/clients/${clientId}/archive` });
  assert.equal(archive.statusCode, 200);
  assert.equal(archive.json().status, 'archived');
  const activeList = await clientsAdminApp.inject({ method: 'GET', url: `/api/clients?q=${encodeURIComponent(created.json().email)}` });
  assert.equal(activeList.json().items.some((item) => item.id === clientId), false);
  const history = await clientsAdminApp.inject({ method: 'GET', url: `/api/clients/${clientId}` });
  assert.deepEqual(history.json().history.map((event) => event.eventType), ['client.archived', 'client.created']);
  const archivedList = await clientsAdminApp.inject({ method: 'GET', url: '/api/clients?status=archived' });
  assert.equal(archivedList.json().items.some((item) => item.id === clientId), true);
  await assert.rejects(sql`DELETE FROM clients WHERE id=${clientId}`, (error) => error.code === '55000');
});

test('every client PII route fails closed without a server-resolved session', async () => {
  const routes = [
    ['GET', '/api/clients'], ['HEAD', '/api/clients'], ['POST', '/api/clients'],
    ['GET', `/api/clients/${randomUUID()}`], ['HEAD', `/api/clients/${randomUUID()}`],
    ['GET', `/api/clients/${randomUUID()}/plans`], ['POST', `/api/clients/${randomUUID()}/plans`],
    ['PATCH', `/api/clients/${randomUUID()}/archive`],
  ];
  for (const [method, url] of routes) {
    const response = await anonymousApp.inject({ method, url, headers: { 'x-2j-role': 'admin', 'idempotency-key': randomUUID() }, payload: method === 'POST' ? { firstName: 'No', lastName: 'Session', email: 'private@example.test' } : undefined });
    assert.equal(response.statusCode, 401, `${method} ${url}`);
    assert.equal(response.headers['cache-control'], 'no-store', `${method} ${url}`);
    assert.equal(response.body.includes('private@example.test'), false);
  }
  const catalog = await anonymousApp.inject({ method:'GET',url:'/api/plans/assignable',headers:{'x-2j-role':'admin'} });
  assert.equal(catalog.statusCode,401);
  assert.equal(catalog.headers['cache-control'],'no-store');
});

test('catalog price and plan lifecycle mutations fail closed for anonymous and non-catalog roles', async () => {
  const body=planPayload([defaultArea.id],{basePriceCents:4500});
  const anon=await anonymousApp.inject({method:'POST',url:'/api/plans',headers:{'idempotency-key':randomUUID()},payload:body});assert.equal(anon.statusCode,401);
  const trainer=await clientsTrainerApp.inject({method:'POST',url:'/api/plans',headers:{'idempotency-key':randomUUID()},payload:body});assert.equal(trainer.statusCode,403);
  const accountant=await clientsAccountantApp.inject({method:'POST',url:'/api/plans',headers:{'idempotency-key':randomUUID()},payload:body});assert.equal(accountant.statusCode,403);
});

test('sale price override requires catalog pricing permission and a reason', async () => {
  const service=await createService(`Precio protegido ${randomUUID()}`);const created=await createPlan([service.id],{basePriceCents:4500});const planId=created.response.json().id;assert.equal((await app.inject({method:'POST',url:`/api/plans/${planId}/activate`})).statusCode,200);
  const client=(await createClientRequest(clientsAdminApp,{firstName:'Precio',lastName:`Protegido ${randomUUID()}`})).json();const limited=buildServer(process.env.DATABASE_URL,{authorizationResolver:async()=>({actorId:'qa-admin-price-denied',role:'admin',deniedPermissions:['catalog.pricing.manage']})});
  try{const payload={planId,startsOn:'2026-10-09',dueOn:'2026-10-09',amountCents:4600};const noReason=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans`,headers:{'idempotency-key':randomUUID()},payload});assert.equal(noReason.statusCode,409);assert.equal(noReason.json().error,'adjustment_reason_required');const denied=await limited.inject({method:'POST',url:`/api/clients/${client.id}/plans`,headers:{'idempotency-key':randomUUID()},payload:{...payload,adjustmentReason:'Descuento excepcional'}});assert.equal(denied.statusCode,403);assert.equal(denied.json().error,'price_override_forbidden');}
  finally{await limited.close();}
});

test('malformed JSON returns a fixed error and never echoes or logs personal data', async () => {
  const logLines = [];
  const stream = new Writable({ write(chunk, _encoding, callback) { logLines.push(String(chunk)); callback(); } });
  const capturedApp = buildServer(process.env.DATABASE_URL, {
    authorizationResolver: async () => ({ actorId: 'qa-admin', role: 'admin' }),
    logger: { level: 'info', stream, serializers: { req(request) { return { method: request.method, url: String(request.url).split('?')[0] }; } } },
  });
  try {
    const secret = 'pii-fragment@example.test';
    const response = await capturedApp.inject({ method: 'POST', url: '/api/clients', headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() }, payload: `{"firstName":"${secret}",` });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), { error: 'invalid_json', message: 'El cuerpo de la solicitud no es JSON válido.' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(response.body.includes(secret), false);
    assert.equal(logLines.join('').includes(secret), false);
    assert.equal(logLines.join('').includes('firstName'), false);
  } finally { await capturedApp.close(); }
});

test('client creation requires idempotency and replays safely across concurrent retries', async () => {
  const key = randomUUID();
  const payload = { firstName: 'Reintento', lastName: `Seguro ${randomUUID()}`, email: `retry-${randomUUID()}@example.test`, phone: '600 000 000' };
  const [first, retry] = await Promise.all([createClientRequest(clientsAdminApp, payload, key), createClientRequest(clientsAdminApp, payload, key)]);
  assert.deepEqual([first.statusCode, retry.statusCode].sort(), [200, 201]);
  assert.equal(first.json().id, retry.json().id);
  const mismatch = await createClientRequest(clientsAdminApp, { ...payload, firstName: 'Otro' }, key);
  assert.equal(mismatch.statusCode, 409);
  assert.equal(mismatch.json().error, 'idempotency_conflict');
  const rows = await sql`SELECT count(*)::int AS count FROM clients WHERE id=${first.json().id}`;
  assert.equal(rows[0].count, 1);
  const missingKey = await clientsAdminApp.inject({ method: 'POST', url: '/api/clients', payload });
  assert.equal(missingKey.statusCode, 400);
  assert.equal(missingKey.json().error, 'idempotency_key_required');
});

test('active normalized email is unique while phone can be shared and archived email can be reused', async () => {
  const email = `unique-${randomUUID()}@example.test`;
  const phone = 'shared-family-number';
  const original = await createClientRequest(clientsAdminApp, { firstName: 'Uno', lastName: `Email ${randomUUID()}`, email: ` ${email.toUpperCase()} `, phone });
  assert.equal(original.statusCode, 201, original.body);
  const duplicate = await createClientRequest(clientsAdminApp, { firstName: 'Dos', lastName: `Email ${randomUUID()}`, email, phone });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().error, 'email_conflict');
  const samePhone = await createClientRequest(clientsAdminApp, { firstName: 'Dos', lastName: `Teléfono ${randomUUID()}`, phone });
  assert.equal(samePhone.statusCode, 201, samePhone.body);
  const archived = await clientsAdminApp.inject({ method: 'PATCH', url: `/api/clients/${original.json().id}/archive` });
  assert.equal(archived.statusCode, 200);
  const reused = await createClientRequest(clientsAdminApp, { firstName: 'Nuevo', lastName: `Titular ${randomUUID()}`, email });
  assert.equal(reused.statusCode, 201, reused.body);
});

test('concurrent client creates with the same normalized active email cannot create duplicates', async () => {
  const email = `race-${randomUUID()}@example.test`;
  const submit = (firstName) => createClientRequest(clientsAdminApp, { firstName, lastName: `Duplicado ${randomUUID()}`, email: email.toUpperCase() });
  const results = await Promise.all([submit('Uno'), submit('Dos')]);
  assert.deepEqual(results.map((response) => response.statusCode).sort(), [201, 409]);
  assert.equal(results.find((response) => response.statusCode === 409).json().error, 'email_conflict');
  assert.equal((await sql`SELECT count(*)::int AS count FROM clients WHERE lower(email)=${email}`).at(0).count, 1);
});

test('client listing paginates past 100 rows using a stable cursor', async () => {
  const marker = randomUUID();
  await sql`INSERT INTO clients(first_name,last_name) SELECT 'Page-' || lpad(n::text,3,'0'),${marker} FROM generate_series(1,125) AS n`;
  const collected = [];
  let cursor;
  let pages = 0;
  do {
    const params = new URLSearchParams({ q: marker, limit: '40' });
    if (cursor) params.set('cursor', cursor);
    const response = await clientsAdminApp.inject({ method: 'GET', url: `/api/clients?${params}` });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    collected.push(...body.items);
    cursor = body.nextCursor;
    assert.equal(body.hasMore, Boolean(cursor));
    pages += 1;
    assert.ok(pages <= 4, 'pagination must make progress');
  } while (cursor);
  assert.equal(collected.length, 125);
  assert.equal(new Set(collected.map((item) => item.id)).size, 125);
  assert.deepEqual(collected.map((item) => `${item.lastName.toLowerCase()}\u0000${item.firstName.toLowerCase()}\u0000${item.id}`), [...collected].map((item) => `${item.lastName.toLowerCase()}\u0000${item.firstName.toLowerCase()}\u0000${item.id}`).sort());
  const badCursor = await clientsAdminApp.inject({ method: 'GET', url: '/api/clients?cursor=not-a-cursor' });
  assert.equal(badCursor.statusCode, 400);
  assert.equal(badCursor.json().error, 'invalid_cursor');
});

test('concurrent and repeated archive writes one event and keeps history append-only', async () => {
  const created = await createClientRequest(clientsAdminApp, { firstName: 'Archivo', lastName: randomUUID() });
  assert.equal(created.statusCode, 201);
  const url = `/api/clients/${created.json().id}/archive`;
  const results = await Promise.all([clientsAdminApp.inject({ method: 'PATCH', url }), clientsAdminApp.inject({ method: 'PATCH', url })]);
  assert.deepEqual(results.map((response) => response.statusCode).sort(), [200, 404]);
  assert.equal((await clientsAdminApp.inject({ method: 'PATCH', url })).statusCode, 404);
  const detail = await clientsAdminApp.inject({ method: 'GET', url: `/api/clients/${created.json().id}` });
  assert.deepEqual(detail.json().history.map((event) => event.eventType).sort(), ['client.archived', 'client.created']);
  assert.ok(detail.json().history.every((event) => !('actorId' in event) && typeof event.actorLabel === 'string'));
});

test('areas can be configured and service records reference their normalized IDs', async () => {
  const label = `Área QA ${randomUUID()}`;
  const created = await app.inject({ method: 'POST', url: '/api/areas', payload: { name: `  ${label}  ` } });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().name, label);
  const duplicate = await app.inject({ method: 'POST', url: '/api/areas', payload: { name: label.toLocaleUpperCase('es') } });
  assert.equal(duplicate.statusCode, 409);
  const service = await app.inject({ method: 'POST', url: '/api/services', payload: { name: `Servicio ${randomUUID()}`, areaId: created.json().id, status: 'draft' } });
  assert.equal(service.statusCode, 201);
  assert.equal(service.json().areaId, created.json().id);
});

test('areas are normalized entities and service listing is stable by area then name', async () => {
  const areas = await app.inject({ method: 'GET', url: '/api/areas' });
  assert.equal(areas.statusCode, 200);
  const seedAreas = areas.json().map((item) => item.name).filter((name) => ['El Búnker', 'El Estudio', 'Entrenamiento personal', 'La Sala'].includes(name));
  assert.deepEqual(seedAreas, ['El Búnker', 'El Estudio', 'Entrenamiento personal', 'La Sala']);
  const marker = randomUUID();
  await createService(`ZZ stable ${marker}`);
  await createService(`AA stable ${marker}`);
  const response = await app.inject({ method: 'GET', url: '/api/services' });
  assert.equal(response.statusCode, 200);
  const names = response.json().filter((item) => item.name.includes(marker)).map((item) => item.name);
  assert.deepEqual(names, [`AA stable ${marker}`, `ZZ stable ${marker}`]);
});

test('database CHECK constraints reject malformed rights when bypassing HTTP validation', async () => {
  const service = await createService();
  const created = await createPlan([service.id]);
  assert.equal(created.response.statusCode, 201, created.response.body);
  await assert.rejects(sql`INSERT INTO plan_rights(plan_id,plan_version,right_type,service_id,quantity,quota_scope) VALUES (${created.response.json().id},1,'sessions_quota',${service.id},NULL,'shared')`, (error) => error.code === '23514');
  await assert.rejects(sql`INSERT INTO plan_rights(plan_id,plan_version,right_type,service_id,quantity,quota_scope,period,period_mode,timezone) VALUES (${created.response.json().id},1,'period_quota',NULL,8,'shared','fortnight','calendar','Atlantic/Canary')`, (error) => error.code === '23514');
});

test('multi-service plans allow disjoint service quotas and distinct periods but reject global overlap', async () => {
  const [first, second] = await Promise.all([createService(), createService()]);
  const { response } = await createPlan([first.id, second.id], { rights: [
    { rightType: 'service_access', serviceId: first.id },
    { rightType: 'sessions_quota', serviceId: first.id, quotaScope: 'per_service', quantity: 4 },
    { rightType: 'sessions_quota', serviceId: second.id, quotaScope: 'per_service', quantity: 6 },
    { rightType: 'period_quota', serviceId: null, quotaScope: 'shared', quantity: 8, period: 'month', periodMode: 'calendar', timezone: 'Atlantic/Canary', validDays: 30, validDaysStartRule: 'first_use' },
    { rightType: 'period_quota', serviceId: null, quotaScope: 'shared', quantity: 3, period: 'week', periodMode: 'calendar', timezone: 'Atlantic/Canary' },
  ] });
  assert.equal(response.statusCode, 201, response.body);
  const plan = response.json();
  assert.equal(plan.services.length, 2);
  const quotas = plan.rights.filter((right) => right.rightType === 'sessions_quota').map((right) => [right.serviceId, right.quotaScope, right.quantity]);
  assert.deepEqual(quotas.sort((a, b) => a[0].localeCompare(b[0])), [[first.id, 'per_service', 4], [second.id, 'per_service', 6]].sort((a, b) => a[0].localeCompare(b[0])));
  assert.equal(plan.rights.find((right) => right.rightType === 'period_quota' && right.period === 'month').timezone, 'Atlantic/Canary');
  assert.equal(plan.rights.filter((right) => right.rightType === 'period_quota').length, 2, 'different quota periods remain independently configurable');
  assert.equal(plan.rights.find((right) => right.rightType === 'period_quota' && right.period === 'month').validDaysStartRule, 'first_use');
  const listed = await app.inject({ method: 'GET', url: `/api/services/${second.id}/plans` });
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.json()[0].services.map((item) => item.id).sort(), [first.id, second.id].sort());
  await assert.rejects(sql`INSERT INTO plan_rights(plan_id,plan_version,right_type,quantity,quota_scope) VALUES (${plan.id},1,'sessions_quota',10,'shared')`, (error) => error.code === '23514');
});

test('PostgreSQL rejects same-period global quota overlaps and allows distinct services and periods', async () => {
  const [first, second] = await Promise.all([createService(), createService()]);
  const firstPlan = await createPlan([first.id, second.id]);
  const planId = firstPlan.response.json().id;
  const targeted = (serviceId, period) => sql`INSERT INTO plan_rights(plan_id,plan_version,right_type,service_id,quota_scope,quantity,period,period_mode,timezone) VALUES (${planId},1,'period_quota',${serviceId},'per_service',3,${period},'calendar','Atlantic/Canary')`;
  await targeted(first.id, 'month');
  await targeted(second.id, 'month');
  await sql`INSERT INTO plan_rights(plan_id,plan_version,right_type,quota_scope,quantity,period,period_mode,timezone) VALUES (${planId},1,'period_quota','shared',8,'week','calendar','Atlantic/Canary')`;
  await assert.rejects(targeted(first.id, 'month'), (error) => error.code === '23514');

  const globalPlan = await createPlan([first.id]);
  const globalId = globalPlan.response.json().id;
  await sql`INSERT INTO plan_rights(plan_id,plan_version,right_type,quota_scope,quantity,period,period_mode,timezone) VALUES (${globalId},1,'period_quota','shared',8,'month','calendar','Atlantic/Canary')`;
  await assert.rejects(sql`INSERT INTO plan_rights(plan_id,plan_version,right_type,service_id,quota_scope,quantity,period,period_mode,timezone) VALUES (${globalId},1,'period_quota',${first.id},'per_service',3,'month','calendar','Atlantic/Canary')`, (error) => error.code === '23514');
});

test('session packs require a finite session quota and cannot use periodic quotas', async () => {
  const service = await createService();
  const { response } = await createPlan([service.id], { kind: 'session_pack', renewalCadence: null, rights: [
    { rightType: 'sessions_quota', serviceId: service.id, quotaScope: 'per_service', quantity: 8 },
  ] });
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().kind, 'session_pack');
  assert.equal(response.json().renewalCadence, null);

  const planId = randomUUID();
  const key = randomUUID();
  const name = `Invalid session pack ${randomUUID()}`;
  await assert.rejects(sql.begin(async (tx) => {
    await tx`INSERT INTO plans(id,name,status,current_version,idempotency_key,request_hash) VALUES (${planId},${name},'draft',1,${key},${'0'.repeat(64)})`;
    await tx`INSERT INTO plan_versions(plan_id,version,kind,renewal_cadence,period_days) VALUES (${planId},1,'session_pack',NULL,NULL)`;
  }), (error) => error.code === '23514');
  assert.equal((await sql`SELECT count(*)::int AS count FROM plans WHERE id=${planId}`).at(0).count, 0);
});

test('invalid duplicate rights are rejected before a plan transaction persists', async () => {
  const service = await createService();
  const name = `Rollback ${randomUUID()}`;
  const payload = planPayload([service.id], { name, rights: [
    { rightType: 'service_access', serviceId: service.id },
    { rightType: 'service_access', serviceId: service.id },
  ] });
  const response = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': randomUUID() }, payload });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, 'validation_error');
  assert.equal((await sql`SELECT count(*)::int AS count FROM plans WHERE name=${name}`).at(0).count, 0);
});

test('plan creation idempotency replays identical requests and rejects changed payloads', async () => {
  const service = await createService();
  const key = randomUUID();
  const body = planPayload([service.id]);
  const first = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': key }, payload: body });
  const replay = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': key }, payload: body });
  const mismatch = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': key }, payload: { ...body, name: `${body.name} cambiado` } });
  assert.equal(first.statusCode, 201);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().id, first.json().id);
  assert.equal(mismatch.statusCode, 409);
  assert.equal(mismatch.json().error, 'idempotency_conflict');
});

test('service_access needs a valid service target in new plans and plan versions', async () => {
  const service = await createService();
  const planKey = randomUUID();
  const invalid = planPayload([service.id], { rights: [{ rightType: 'service_access', serviceId: null }] });
  const rejected = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': planKey }, payload: invalid });
  assert.equal(rejected.statusCode, 400, rejected.body);
  assert.equal((await sql`SELECT count(*)::int AS count FROM plans WHERE idempotency_key=${planKey}`).at(0).count, 0, 'invalid plan was not persisted');

  const valid = await createPlan([service.id]);
  assert.equal(valid.response.statusCode, 201, valid.response.body);
  const planId = valid.response.json().id;
  assert.equal((await app.inject({ method: 'POST', url: `/api/plans/${planId}/activate` })).statusCode, 200);
  const versionKey = randomUUID();
  const version = await app.inject({ method: 'POST', url: `/api/plans/${planId}/versions`, headers: { 'idempotency-key': versionKey }, payload: { ...valid.body, rights: [{ rightType: 'service_access' }] } });
  assert.equal(version.statusCode, 400, version.body);
  assert.equal((await sql`SELECT current_version AS version FROM plans WHERE id=${planId}`).at(0).version, 1, 'invalid version was not persisted or selected');
  assert.equal((await sql`SELECT count(*)::int AS count FROM plan_version_changes WHERE idempotency_key=${versionKey}`).at(0).count, 0);

  const draft = await createPlan([service.id]);
  assert.equal(draft.response.statusCode, 201, draft.response.body);
  await assert.rejects(sql`INSERT INTO plan_rights(plan_id,plan_version,right_type,service_id) VALUES (${draft.response.json().id},1,'service_access',NULL)`, error => error.code === '23514');
});

test('approved entitlement roles are enforced server-side for reads, sales, lifecycle, payment and adjustments', async () => {
  const service = await createService();
  const created = await createPlan([service.id], { basePriceCents: 3200 });
  assert.equal(created.response.statusCode, 201, created.response.body);
  const planId = created.response.json().id;
  assert.equal((await app.inject({ method: 'POST', url: `/api/plans/${planId}/activate` })).statusCode, 200);
  const client = (await createClientRequest(clientsAdminApp, { firstName: 'Mostrador', lastName: randomUUID() })).json();
  const clientList = await clientsReceptionApp.inject({ method: 'GET', url: '/api/clients?limit=1' });
  assert.equal(clientList.statusCode, 200); assert.equal(clientList.json().capabilities.assignPlans, true); assert.equal(clientList.json().capabilities.collectPayments, false);
  assert.equal((await clientsReceptionApp.inject({ method: 'GET', url: `/api/clients/${client.id}` })).statusCode, 200);
  assert.equal((await clientsReceptionApp.inject({ method: 'GET', url: '/api/plans/assignable' })).statusCode, 200);
  assert.equal((await clientsTrainerApp.inject({ method: 'GET', url: `/api/clients/${client.id}/entitlements/effective?date=2026-10-09` })).statusCode, 200);
  assert.equal((await clientsAccountantApp.inject({ method: 'GET', url: `/api/clients/${client.id}/entitlements/effective?date=2026-10-09` })).statusCode, 403);

  const salePayload = { planId, startsOn: '2026-10-09', endsOn: '2026-10-31', dueOn: '2026-10-09', amountCents: 3200 };
  const sale = await clientsReceptionApp.inject({ method: 'POST', url: `/api/clients/${client.id}/plans`, headers: { 'idempotency-key': randomUUID() }, payload: salePayload });
  assert.equal(sale.statusCode, 201, sale.body);
  assert.equal((await sql`SELECT count(*)::int AS count FROM economic_transactions WHERE charge_id=${sale.json().chargeId}`).at(0).count, 0, 'an unpaid counter sale does not require payment permission');
  const deniedOverride = await clientsReceptionApp.inject({ method: 'POST', url: `/api/clients/${client.id}/plans`, headers: { 'idempotency-key': randomUUID() }, payload: { ...salePayload, amountCents: 3300, adjustmentReason: 'Precio excepcional' } });
  assert.equal(deniedOverride.statusCode, 403); assert.equal(deniedOverride.json().error, 'price_override_forbidden');
  const deniedCharge = await clientsReceptionApp.inject({ method: 'POST', url: `/api/clients/${client.id}/plans`, headers: { 'idempotency-key': randomUUID() }, payload: { ...salePayload, paymentAmountCents: 3200, paymentMethod: 'card' } });
  assert.equal(deniedCharge.statusCode, 403);
  const noCatalogPrice = await createPlan([service.id], { basePriceCents: null });
  assert.equal(noCatalogPrice.response.statusCode, 201, noCatalogPrice.response.body);
  assert.equal((await app.inject({ method: 'POST', url: `/api/plans/${noCatalogPrice.response.json().id}/activate` })).statusCode, 200);
  const noPriceSale = await clientsReceptionApp.inject({ method: 'POST', url: `/api/clients/${client.id}/plans`, headers: { 'idempotency-key': randomUUID() }, payload: { ...salePayload, planId: noCatalogPrice.response.json().id } });
  assert.equal(noPriceSale.statusCode, 409); assert.equal(noPriceSale.json().error, 'catalog_price_required');
  const adjustUrl = `/api/clients/${client.id}/plans/${sale.json().id}/adjustments`;
  for (const actor of [clientsReceptionApp, clientsTrainerApp, clientsAccountantApp]) {
    assert.equal((await actor.inject({ method: 'POST', url: adjustUrl, headers: { 'idempotency-key': randomUUID() }, payload: { rightId: randomUUID(), quantity: 1, reason: 'Ajuste no autorizado' } })).statusCode, 403);
  }
  assert.equal((await clientsTrainerApp.inject({ method: 'POST', url: `/api/clients/${client.id}/plans`, headers: { 'idempotency-key': randomUUID() }, payload: salePayload })).statusCode, 403);
  assert.equal((await clientsTrainerApp.inject({ method: 'POST', url: `/api/clients/${client.id}/plans`, headers: { 'idempotency-key': randomUUID() }, payload: { ...salePayload, sourceAssignmentId: sale.json().id, operationKind: 'renewal', startsOn: '2026-11-01', endsOn: '2026-11-30' } })).statusCode, 403);
  assert.equal((await clientsAccountantApp.inject({ method: 'POST', url: `/api/clients/${client.id}/plans`, headers: { 'idempotency-key': randomUUID() }, payload: salePayload })).statusCode, 403);

  assert.equal((await clientsReceptionApp.inject({ method: 'POST', url: `/api/clients/${client.id}/plans/${sale.json().id}/pause`, headers: { 'idempotency-key': randomUUID() }, payload: { reason: 'Pausa de cliente' } })).statusCode, 201);
  assert.equal((await clientsReceptionApp.inject({ method: 'POST', url: `/api/clients/${client.id}/plans/${sale.json().id}/resume`, headers: { 'idempotency-key': randomUUID() }, payload: {} })).statusCode, 201);
  assert.equal((await clientsReceptionApp.inject({ method: 'POST', url: `/api/clients/${client.id}/plans/${sale.json().id}/cancel`, headers: { 'idempotency-key': randomUUID() }, payload: { reason: 'Baja solicitada' } })).statusCode, 201);

  for (const operationKind of ['renewal','change']) {
    const operationClient = (await createClientRequest(clientsAdminApp, { firstName: 'Operación', lastName: `${operationKind} ${randomUUID()}` })).json();
    const source = await clientsAdminApp.inject({ method: 'POST', url: `/api/clients/${operationClient.id}/plans`, headers: { 'idempotency-key': randomUUID() }, payload: { planId, startsOn: '2026-10-09', endsOn: '2026-10-09', dueOn: '2026-10-09', amountCents: 3200 } });
    assert.equal(source.statusCode, 201, source.body);
    const operation = await clientsReceptionApp.inject({ method: 'POST', url: `/api/clients/${operationClient.id}/plans`, headers: { 'idempotency-key': randomUUID() }, payload: { planId, sourceAssignmentId: source.json().id, operationKind, startsOn: '2026-10-10', endsOn: '2026-10-31', dueOn: '2026-10-10', amountCents: 3200 } });
    assert.equal(operation.statusCode, 201, `${operationKind}: ${operation.body}`);
  }
  for (const actor of [clientsTrainerApp, clientsAccountantApp]) {
    assert.equal((await actor.inject({ method: 'POST', url: `/api/clients/${client.id}/plans/${sale.json().id}/pause`, headers: { 'idempotency-key': randomUUID() }, payload: { reason: 'No autorizado' } })).statusCode, 403);
    assert.equal((await actor.inject({ method: 'POST', url: `/api/clients/${client.id}/plans/${sale.json().id}/cancel`, headers: { 'idempotency-key': randomUUID() }, payload: { reason: 'No autorizado' } })).statusCode, 403);
  }
});

test('idempotency canonicalizes unordered service and rights lists and replays after service archival', async () => {
  const firstService = await createService();
  const secondService = await createService();
  const key = randomUUID();
  const body = planPayload([firstService.id, secondService.id], { rights: [
    { rightType: 'service_access', serviceId: firstService.id },
    { rightType: 'service_access', serviceId: secondService.id },
  ] });
  const first = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': key }, payload: body });
  const reordered = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': key }, payload: { ...body, serviceIds: [...body.serviceIds].reverse(), rights: [...body.rights].reverse() } });
  assert.equal(first.statusCode, 201);
  assert.equal(reordered.statusCode, 200);
  await app.inject({ method: 'POST', url: `/api/plans/${first.json().id}/archive` });
  await app.inject({ method: 'PATCH', url: `/api/services/${firstService.id}/archive` });
  const archivedReplay = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': key }, payload: body });
  assert.equal(archivedReplay.statusCode, 200);
  assert.equal(archivedReplay.json().id, first.json().id);
});

test('idempotency treats an omitted default timezone and its explicit value as the same request', async () => {
  const service = await createService();
  const key = randomUUID();
  const body = planPayload([service.id], { rights: [
    { rightType: 'service_access', serviceId: service.id },
    { rightType: 'period_quota', serviceId: null, quotaScope: 'shared', quantity: 4, period: 'month', periodMode: 'calendar' },
  ] });
  const first = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': key }, payload: body });
  const replay = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': key }, payload: { ...body, rights: body.rights.map((right) => right.rightType === 'period_quota' ? { ...right, timezone: 'Atlantic/Canary' } : right) } });
  assert.equal(first.statusCode, 201, first.body);
  assert.equal(replay.statusCode, 200, replay.body);
});

test('idempotency canonicalization is independent of omitted/null fields, array order, locale and UUID casing', async () => {
  const service = await createService();
  const key = randomUUID();
  const body = planPayload([service.id], { rights: [
    { rightType: 'period_quota', quotaScope: 'shared', quantity: 4, period: 'month', periodMode: 'calendar' },
    { rightType: 'period_quota', serviceId: null, quotaScope: 'shared', quantity: 4, period: 'week', periodMode: 'calendar' },
  ] });
  const first = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': key }, payload: body });
  const alternate = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': key }, payload: {
    ...body, serviceIds: [service.id.toUpperCase()], rights: [
      { rightType: 'period_quota', serviceId: null, quotaScope: 'shared', quantity: 4, period: 'week', periodMode: 'calendar' },
      { rightType: 'period_quota', quotaScope: 'shared', quantity: 4, period: 'month', periodMode: 'calendar' },
    ],
  } });
  assert.equal(first.statusCode, 201, first.body);
  assert.equal(alternate.statusCode, 200, alternate.body);
  assert.equal(alternate.json().id, first.json().id);
  assert.equal(planInput.safeParse({ ...body, serviceIds: [service.id, service.id.toUpperCase()] }).success, false, 'case variants of the same UUID are duplicate services');
});

test('concurrent duplicate plan names serialize to one creation and one conflict', async () => {
  const service = await createService();
  const name = `Concurrent ${randomUUID()}`;
  const submit = () => app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': randomUUID() }, payload: planPayload([service.id], { name }) });
  const responses = await Promise.all([submit(), submit()]);
  assert.deepEqual(responses.map((item) => item.statusCode).sort(), [201, 409]);
  assert.equal((await sql`SELECT count(*)::int AS count FROM plans WHERE name=${name}`).at(0).count, 1);
});

test('concurrent requests with one idempotency key create and return one plan', async () => {
  const service = await createService();
  const key = randomUUID();
  const body = planPayload([service.id]);
  const submit = () => app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': key }, payload: body });
  const responses = await Promise.all([submit(), submit()]);
  assert.deepEqual(responses.map((item) => item.statusCode).sort(), [200, 201]);
  assert.equal(responses[0].json().id, responses[1].json().id);
  assert.equal((await sql`SELECT count(*)::int AS count FROM plans WHERE idempotency_key=${key}`).at(0).count, 1);
});

test('concurrent global and service-specific quota inserts cannot create an overlap', async () => {
  const service = await createService();
  const { response } = await createPlan([service.id]);
  const planId = response.json().id;
  const inserts = [
    sql.begin((tx) => tx`INSERT INTO plan_rights(plan_id,plan_version,right_type,quota_scope,quantity,period) VALUES (${planId},1,'sessions_quota','shared',8,NULL)`),
    sql.begin((tx) => tx`INSERT INTO plan_rights(plan_id,plan_version,right_type,service_id,quota_scope,quantity,period) VALUES (${planId},1,'sessions_quota',${service.id},'per_service',4,NULL)`),
  ];
  const results = await Promise.allSettled(inserts);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected' && result.reason.code === '23514').length, 1);
  assert.equal((await sql`SELECT count(*)::int AS count FROM plan_rights WHERE plan_id=${planId} AND right_type='sessions_quota'`).at(0).count, 1);
});

test('concurrent migration calls serialize safely against the existing migration ledger', async () => {
  const results = await Promise.all([migrateDatabase(sql), migrateDatabase(sql)]);
  assert.deepEqual(results[0].map((row) => [row.name, row.checksum.trim()]), results[1].map((row) => [row.name, row.checksum.trim()]));
});

test('concurrent first-run migrators safely initialize a fresh database', async () => {
  const databaseName = `migration_race_${randomUUID().replaceAll('-', '')}`;
  const admin = postgres(process.env.DATABASE_URL, { max: 2, connect_timeout: 5 });
  const databaseUrl = new URL(process.env.DATABASE_URL);
  databaseUrl.pathname = `/${databaseName}`;
  let first;
  let second;
  try {
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    first = postgres(databaseUrl.toString(), { max: 2, connect_timeout: 5 });
    second = postgres(databaseUrl.toString(), { max: 2, connect_timeout: 5 });
    const results = await Promise.all([migrateDatabase(first), migrateDatabase(second)]);
    assert.deepEqual(results[0].map((row) => [row.name, row.checksum.trim()]), results[1].map((row) => [row.name, row.checksum.trim()]));
    assert.ok(results[0].length > 0);
  } finally {
    await Promise.all([first?.end(), second?.end()]);
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }
});

test('service archival racing plan activation preserves active-plan service integrity', async () => {
  const service = await createService();
  const { response } = await createPlan([service.id]);
  const planId = response.json().id;
  const [activated, archived] = await Promise.all([
    app.inject({ method: 'POST', url: `/api/plans/${planId}/activate` }),
    app.inject({ method: 'PATCH', url: `/api/services/${service.id}/archive` }),
  ]);
  const [planRow] = await sql`SELECT status FROM plans WHERE id=${planId}`;
  const [serviceRow] = await sql`SELECT status FROM services WHERE id=${service.id}`;
  assert.ok((planRow.status === 'active' && serviceRow.status === 'active') || (planRow.status === 'draft' && serviceRow.status === 'archived'));
  assert.equal(activated.statusCode === 200 && archived.statusCode === 200, false, 'both mutually exclusive state transitions must not succeed');
});

test('service archival racing plan creation can leave only a non-activatable draft', async () => {
  const service = await createService();
  const key = randomUUID();
  const body = planPayload([service.id]);
  const [created, archived] = await Promise.all([
    app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': key }, payload: body }),
    app.inject({ method: 'PATCH', url: `/api/services/${service.id}/archive` }),
  ]);
  assert.ok(created.statusCode === 201 || created.statusCode === 404 || created.statusCode === 409);
  assert.ok(archived.statusCode === 200 || archived.statusCode === 409);
  if (created.statusCode === 201) {
    const planId = created.json().id;
    const [state] = await sql`SELECT p.status AS plan_status,s.status AS service_status FROM plans p JOIN plan_services ps ON ps.plan_id=p.id AND ps.plan_version=p.current_version JOIN services s ON s.id=ps.service_id WHERE p.id=${planId}`;
    assert.ok(state.plan_status === 'draft' || (state.plan_status === 'active' && state.service_status === 'active'));
    if (state.service_status === 'archived') assert.equal((await app.inject({ method: 'POST', url: `/api/plans/${planId}/activate` })).statusCode, 409);
  }
});

test('service creation racing area archival never creates an available service in an archived area', async () => {
  const area = await app.inject({ method: 'POST', url: '/api/areas', payload: { name: `Race area ${randomUUID()}` } });
  assert.equal(area.statusCode, 201);
  const [created, archived] = await Promise.all([
    app.inject({ method: 'POST', url: '/api/services', payload: { name: `Race service ${randomUUID()}`, areaId: area.json().id, status: 'active' } }),
    app.inject({ method: 'PATCH', url: `/api/areas/${area.json().id}/archive` }),
  ]);
  const [areaRow] = await sql`SELECT status FROM areas WHERE id=${area.json().id}`;
  const available = await sql`SELECT count(*)::int AS count FROM services WHERE area_id=${area.json().id} AND status <> 'archived'`;
  assert.equal(areaRow.status === 'archived' ? available[0].count : 0, 0);
  assert.ok(created.statusCode === 201 || created.statusCode === 404);
  assert.ok(archived.statusCode === 200 || archived.statusCode === 409);
});

test('active plan version and rights are immutable while archival preserves the definition', async () => {
  const service = await createService();
  const { response } = await createPlan([service.id], { rights: [{ rightType: 'sessions_quota', serviceId: service.id, quotaScope: 'per_service', quantity: 8 }] });
  const plan = response.json();
  const activated = await app.inject({ method: 'POST', url: `/api/plans/${plan.id}/activate` });
  assert.equal(activated.statusCode, 200);
  assert.equal(activated.json().status, 'active');
  assert.ok((await sql`SELECT frozen_at FROM plan_versions WHERE plan_id=${plan.id} AND version=1`).at(0).frozen_at);
  await assert.rejects(sql`UPDATE plan_rights SET quantity=9 WHERE plan_id=${plan.id}`, (error) => error.code === '55000');
  await assert.rejects(sql`INSERT INTO plan_rights(plan_id,plan_version,right_type,service_id,quota_scope,quantity) VALUES (${plan.id},1,'sessions_quota',${service.id},'per_service',2)`, (error) => error.code === '55000');
  await assert.rejects(sql`INSERT INTO plan_services(plan_id,plan_version,service_id) VALUES (${plan.id},1,${service.id})`, (error) => error.code === '55000');
  await assert.rejects(sql`UPDATE plans SET current_version=2 WHERE id=${plan.id}`, (error) => error.code === '55000');
  await assert.rejects(sql`UPDATE plan_versions SET frozen_at=NULL WHERE plan_id=${plan.id} AND version=1`, (error) => error.code === '55000');
  await assert.rejects(sql`UPDATE plan_versions SET kind='session_pack' WHERE plan_id=${plan.id} AND version=1`, (error) => error.code === '55000');
  await assert.rejects(sql`DELETE FROM plans WHERE id=${plan.id}`, (error) => error.code === '55000');
  const blockedArchive = await app.inject({ method: 'PATCH', url: `/api/services/${service.id}/archive` });
  assert.equal(blockedArchive.statusCode, 409);
  assert.equal((await sql`SELECT status FROM services WHERE id=${service.id}`).at(0).status, 'active');
  await app.inject({ method: 'POST', url: `/api/plans/${plan.id}/archive` });
  await assert.rejects(sql`UPDATE plan_rights SET quantity=9 WHERE plan_id=${plan.id}`, (error) => error.code === '55000');
  const archived = await app.inject({ method: 'PATCH', url: `/api/services/${service.id}/archive` });
  assert.equal(archived.statusCode, 200);
  assert.equal((await sql`SELECT count(*)::int AS count FROM plan_services WHERE service_id=${service.id}`).at(0).count, 1);
});

test('IANA timezone validation rejects malformed zones and area archival preserves available services', async () => {
  const service = await createService();
  const { response: plan } = await createPlan([service.id]);
  await assert.rejects(sql`INSERT INTO plan_versions(plan_id,version,kind,renewal_cadence,timezone) VALUES (${plan.json().id},2,'recurring','monthly','Mars/Olympus')`, (error) => error.code === '23514');
  await assert.rejects(sql`INSERT INTO plan_rights(plan_id,plan_version,right_type,quantity,quota_scope,period,period_mode,timezone) VALUES (${plan.json().id},1,'period_quota',2,'shared','month','calendar','Mars/Olympus')`, (error) => error.code === '23514');
  await assert.rejects(sql`INSERT INTO plan_rights(plan_id,plan_version,right_type,quantity,quota_scope,period,period_mode,timezone) VALUES (${plan.json().id},1,'period_quota',2,'shared','month','calendar','Europe/Canary')`, (error) => error.code === '23514');
  const blocked = await app.inject({ method: 'PATCH', url: `/api/areas/${service.areaId}/archive` });
  assert.equal(blocked.statusCode, 409);
});

test('database constraints protect complete versions and catalog tables from truncate bypass', async () => {
  const service = await createService();
  const { response: plan } = await createPlan([service.id]);
  await assert.rejects(sql.begin(async (tx) => {
    await tx`INSERT INTO plan_versions(plan_id,version,kind,renewal_cadence) VALUES (${plan.json().id},2,'recurring','monthly')`;
  }), (error) => error.code === '23514');
  await assert.rejects(sql`TRUNCATE plan_rights`, (error) => ['55000','0A000'].includes(error.code), 'catalog truncate stays blocked by the catalog guard or booking-history foreign key');
  await assert.rejects(sql`TRUNCATE plan_versions CASCADE`, (error) => error.code === '55000');
  for (const table of ['areas', 'services', 'plans', 'plan_services']) {
    await assert.rejects(sql.unsafe(`TRUNCATE ${table} CASCADE`), (error) => error.code === '55000', `${table} must reject TRUNCATE CASCADE`);
  }
});

test('archiving a draft freezes its definition and preserves its current version pointer', async () => {
  const service = await createService();
  const { response: plan } = await createPlan([service.id], { rights: [{ rightType: 'sessions_quota', serviceId: service.id, quotaScope: 'per_service', quantity: 4 }] });
  const archived = await app.inject({ method: 'POST', url: `/api/plans/${plan.json().id}/archive` });
  assert.equal(archived.statusCode, 200);
  assert.ok((await sql`SELECT frozen_at FROM plan_versions WHERE plan_id=${plan.json().id} AND version=1`).at(0).frozen_at);
  await assert.rejects(sql`UPDATE plan_rights SET quantity=5 WHERE plan_id=${plan.json().id}`, (error) => error.code === '55000');
  await assert.rejects(sql`UPDATE plans SET current_version=2 WHERE id=${plan.json().id}`, (error) => error.code === '55000');
});

test('service right counts include only global or service-targeted rights', async () => {
  const first = await createService();
  const second = await createService();
  const created = await createPlan([first.id, second.id], { rights: [
    { rightType: 'service_access', serviceId: first.id },
    { rightType: 'sessions_quota', serviceId: first.id, quotaScope: 'per_service', quantity: 3 },
    { rightType: 'service_access', serviceId: second.id },
  ] });
  assert.equal(created.response.statusCode, 201, created.response.body);
  const rows = await app.inject({ method: 'GET', url: '/api/services' });
  const byId = new Map(rows.json().map((row) => [row.id, row]));
  assert.equal(byId.get(first.id).rightCount, 2);
  assert.equal(byId.get(second.id).rightCount, 1);
});

test('archived services cannot be linked to new plans and plan reads report UUID and 404 errors', async () => {
  const service = await createService();
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/services/${service.id}/archive` })).statusCode, 200);
  const invalidId = await app.inject({ method: 'GET', url: '/api/services/not-a-uuid/plans' });
  const missing = await app.inject({ method: 'GET', url: `/api/services/${randomUUID()}/plans` });
  const archivedRead = await app.inject({ method: 'GET', url: `/api/services/${service.id}/plans` });
  const createArchived = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': randomUUID() }, payload: planPayload([service.id]) });
  assert.equal(invalidId.statusCode, 400);
  assert.deepEqual(invalidId.json(), { error: 'invalid_service_id' });
  assert.equal(missing.statusCode, 404);
  assert.equal(archivedRead.statusCode, 409);
  assert.equal(createArchived.statusCode, 409);
});

test('database violations map to conflict/validation and availability statuses consistently', () => {
  assert.equal(mapDatabaseError({ code: '23505' }).status, 409);
  assert.equal(mapDatabaseError({ code: '23514' }).status, 422);
  assert.equal(mapDatabaseError({ code: '23502' }).status, 422);
  assert.equal(mapDatabaseError({ code: '22023' }).status, 422);
  assert.equal(mapDatabaseError({ code: '08006' }).status, 503);
  assert.equal(mapDatabaseError({ code: 'XX000' }).status, 500);
});

test('economic charges and split payments are permissioned, idempotent, partial and auditable', async () => {
  const clientResponse = await createClientRequest(clientsAdminApp, { firstName: 'Economics', lastName: `QA ${randomUUID()}`, email: null, phone: null });
  assert.equal(clientResponse.statusCode, 201, clientResponse.body);
  const client = clientResponse.json();
  const chargeKey = randomUUID();
  const chargePayload = { clientId: client.id, concept: 'Cuota de prueba', amountCents: 10000, dueOn: '2099-12-10' };
  const chargeResponse = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/charges', headers: { 'idempotency-key': chargeKey }, payload: chargePayload });
  assert.equal(chargeResponse.statusCode, 201, chargeResponse.body);
  const replayCharge = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/charges', headers: { 'idempotency-key': chargeKey }, payload: chargePayload });
  assert.equal(replayCharge.statusCode, 200);
  assert.equal(replayCharge.json().id, chargeResponse.json().id);
  const denied = await clientsTrainerApp.inject({ method: 'POST', url: '/api/economics/payments', headers: { 'idempotency-key': randomUUID() }, payload: { chargeId: chargeResponse.json().id, splits: [{ method: 'card', amountCents: 100 }] } });
  assert.equal(denied.statusCode, 403);

  const paymentKey = randomUUID();
  const paymentPayload = { chargeId: chargeResponse.json().id, splits: [{ method: 'cash', amountCents: 2000 }, { method: 'card', amountCents: 3000 }] };
  const cashSession = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/cash/open', payload: { openingCents: 0 } });
  assert.equal(cashSession.statusCode, 201, cashSession.body);
  const payment = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/payments', headers: { 'idempotency-key': paymentKey }, payload: paymentPayload });
  assert.equal(payment.statusCode, 201, payment.body);
  const paymentReplay = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/payments', headers: { 'idempotency-key': paymentKey }, payload: paymentPayload });
  assert.equal(paymentReplay.statusCode, 200);
  assert.equal(paymentReplay.json().id, payment.json().id);
  const balanceAfterPartPayment = await clientsAdminApp.inject({ method: 'GET', url: `/api/economics/charges?clientId=${client.id}` });
  assert.equal(Number(balanceAfterPartPayment.json().items[0].balanceCents), 5000);
  const client360 = await clientsAdminApp.inject({ method: 'GET', url: `/api/clients/${client.id}` });
  assert.equal(client360.json().summary.payments.dataState, 'ready');
  assert.equal(Number(client360.json().summary.payments.data.balanceCents), 5000);
  const settings = await clientsAdminApp.inject({ method: 'GET', url: '/api/economics/settings' });
  assert.equal(settings.json().timezone, 'Atlantic/Canary');
  assert.equal(settings.json().debtBlocksNewReservations, false);

  const refund = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/refunds', headers: { 'idempotency-key': randomUUID() }, payload: { transactionId: payment.json().id, amountCents: 1000, method: 'card', note: 'Ajuste QA' } });
  assert.equal(refund.statusCode, 201, refund.body);
  const balanceAfterRefund = await clientsAdminApp.inject({ method: 'GET', url: `/api/economics/charges?clientId=${client.id}` });
  assert.equal(Number(balanceAfterRefund.json().items[0].balanceCents), 6000);
  const [audit] = await sql`SELECT count(*)::int AS count FROM economic_audit_events WHERE client_id=${client.id}`;
  assert.equal(audit.count, 3);
  const cashSnapshot = await clientsAdminApp.inject({ method: 'GET', url: '/api/economics/cash/today' });
  const closedCash = await clientsAdminApp.inject({ method: 'POST', url: `/api/economics/cash/${cashSession.json().id}/close`, payload: { countedCents: cashSnapshot.json().session.expectedCents } });
  assert.equal(closedCash.statusCode, 200, closedCash.body);
});

test('concurrent partial payments serialize at the charge and cannot over-collect', async () => {
  const clientResponse = await createClientRequest(clientsAdminApp, { firstName: 'Race', lastName: `QA ${randomUUID()}`, email: null, phone: null });
  const client = clientResponse.json();
  const charge = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/charges', headers: { 'idempotency-key': randomUUID() }, payload: { clientId: client.id, concept: 'Concurrency test', amountCents: 5000, dueOn: '2099-12-10' } });
  assert.equal(charge.statusCode, 201, charge.body);
  const requests = [4000, 4000].map(amountCents => clientsAdminApp.inject({ method: 'POST', url: '/api/economics/payments', headers: { 'idempotency-key': randomUUID() }, payload: { chargeId: charge.json().id, splits: [{ method: 'card', amountCents }] } }));
  const results = await Promise.all(requests);
  assert.deepEqual(results.map(r => r.statusCode).sort(), [201, 409]);
  const balance = await clientsAdminApp.inject({ method: 'GET', url: `/api/economics/charges?clientId=${client.id}` });
  assert.equal(Number(balance.json().items[0].balanceCents), 1000);
});

test('fully refunded charges are final, excluded from debt, and retain immutable payment history', async () => {
  const eligibleAdmin = buildServer(process.env.DATABASE_URL, {
    authorizationResolver: async () => ({ actorId: 'qa-refund-booking', role: 'admin' }),
    bookingEligibilityResolver: async () => ({ eligible: true, entitlementId: 'qa-entitlement' }),
  });
  try {
    const client = (await createClientRequest(clientsAdminApp, { firstName: 'Refund', lastName: `QA ${randomUUID()}`, email: null, phone: null })).json();
    const beforeOverview = await clientsAdminApp.inject({ method: 'GET', url: '/api/economics/overview' });
    assert.equal(beforeOverview.statusCode, 200, beforeOverview.body);
    const charge = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/charges', headers: { 'idempotency-key': randomUUID() }, payload: { clientId: client.id, concept: 'Cargo devuelto', amountCents: 5000, dueOn: '2000-01-01' } });
    assert.equal(charge.statusCode, 201, charge.body);
    const payment = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/payments', headers: { 'idempotency-key': randomUUID() }, payload: { chargeId: charge.json().id, splits: [{ method: 'card', amountCents: 5000 }] } });
    assert.equal(payment.statusCode, 201, payment.body);
    const paid = await clientsAdminApp.inject({ method: 'GET', url: `/api/economics/charges?clientId=${client.id}` });
    assert.equal(paid.json().items[0].status, 'paid');

    const refunds = await Promise.all([1, 2].map(() => clientsAdminApp.inject({ method: 'POST', url: '/api/economics/refunds', headers: { 'idempotency-key': randomUUID() }, payload: { transactionId: payment.json().id, amountCents: 5000, method: 'card', note: 'Devolución total QA' } })));
    assert.deepEqual(refunds.map(response => response.statusCode).sort(), [201, 409]);

    const charges = await clientsAdminApp.inject({ method: 'GET', url: `/api/economics/charges?clientId=${client.id}` });
    assert.equal(charges.statusCode, 200);
    assert.equal(charges.json().items[0].status, 'refunded');
    assert.equal(Number(charges.json().items[0].balanceCents), 0);
    const due = await clientsAdminApp.inject({ method: 'GET', url: `/api/economics/charges?clientId=${client.id}&status=due` });
    assert.equal(due.json().total, 0);
    const clientEconomics = await clientsAdminApp.inject({ method: 'GET', url: `/api/clients/${client.id}/economics` });
    assert.equal(Number(clientEconomics.json().balanceCents), 0);
    assert.equal(Number(clientEconomics.json().overdueCount), 0);
    assert.equal(clientEconomics.json().items[0].status, 'refunded');
    assert.equal(Number(clientEconomics.json().items[0].balanceCents), 0);
    const overview = await clientsAdminApp.inject({ method: 'GET', url: '/api/economics/overview' });
    assert.equal(overview.statusCode, 200, overview.body);
    assert.equal(overview.json().overdueCount, beforeOverview.json().overdueCount);
    assert.equal(Number(overview.json().overdueCents), Number(beforeOverview.json().overdueCents));
    const exportAfterRefund = await clientsAdminApp.inject({ method: 'GET', url: '/api/economics/export' });
    const exportedRefund = exportAfterRefund.json().items.find(item => item.id === charge.json().id);
    assert.equal(exportedRefund.status, 'refunded');
    assert.equal(Number(exportedRefund.balanceCents), 0);

    const latePayment = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/payments', headers: { 'idempotency-key': randomUUID() }, payload: { chargeId: charge.json().id, splits: [{ method: 'card', amountCents: 100 }] } });
    assert.equal(latePayment.statusCode, 409);
    assert.equal(latePayment.json().error, 'charge_refunded');

    const service = await createService();
    const session = await eligibleAdmin.inject({ method: 'POST', url: '/api/calendar/sessions', payload: { serviceId: service.id, areaId: defaultArea.id, startsAt: '2099-12-10T10:00:00Z', durationMinutes: 45, capacity: 2 } });
    assert.equal(session.statusCode, 201, session.body);
    await clientsAdminApp.inject({ method: 'PATCH', url: '/api/economics/settings', payload: { dueDay: 10, debtBlocksNewReservations: true } });
    const reservation = await eligibleAdmin.inject({ method: 'POST', url: `/api/calendar/sessions/${session.json().id}/reservations`, payload: { clientId: client.id } });
    assert.equal(reservation.statusCode, 201, reservation.body);

    const partialCharge = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/charges', headers: { 'idempotency-key': randomUUID() }, payload: { clientId: client.id, concept: 'Cargo parcialmente devuelto', amountCents: 5000, dueOn: '2099-12-10' } });
    const partialPayment = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/payments', headers: { 'idempotency-key': randomUUID() }, payload: { chargeId: partialCharge.json().id, splits: [{ method: 'card', amountCents: 5000 }] } });
    const partialRefund = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/refunds', headers: { 'idempotency-key': randomUUID() }, payload: { transactionId: partialPayment.json().id, amountCents: 2000, method: 'card', note: 'Devolución parcial QA' } });
    assert.equal(partialRefund.statusCode, 201, partialRefund.body);
    const partialRead = await clientsAdminApp.inject({ method: 'GET', url: `/api/economics/charges?clientId=${client.id}` });
    const partial = partialRead.json().items.find(item => item.id === partialCharge.json().id);
    assert.equal(partial.status, 'pending');
    assert.equal(Number(partial.balanceCents), 2000);
    const exportAfterPartial = await clientsAdminApp.inject({ method: 'GET', url: '/api/economics/export' });
    const exportedPartial = exportAfterPartial.json().items.find(item => item.id === partialCharge.json().id);
    assert.equal(exportedPartial.status, 'pending');
    assert.equal(Number(exportedPartial.balanceCents), 2000);

    const [ledger] = await sql`SELECT count(*)::int AS count, sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END)::bigint AS net FROM economic_transactions WHERE charge_id=${charge.json().id}`;
    assert.equal(ledger.count, 2);
    assert.equal(Number(ledger.net), 0);
    const [audit] = await sql`SELECT count(*)::int AS count FROM economic_audit_events WHERE client_id=${client.id} AND action IN ('payment.recorded','payment.refunded')`;
    assert.equal(audit.count, 4);
  } finally {
    await clientsAdminApp.inject({ method: 'PATCH', url: '/api/economics/settings', payload: { dueDay: 10, debtBlocksNewReservations: false } });
    await eligibleAdmin.close();
  }
});

test('transfer proof cannot collect a fully refunded charge and can still be rejected with intact audit', async () => {
  const client = (await createClientRequest(clientsAdminApp, { firstName: 'Proof', lastName: `QA ${randomUUID()}`, email: null, phone: null })).json();
  const charge = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/charges', headers: { 'idempotency-key': randomUUID() }, payload: { clientId: client.id, concept: 'Cargo con justificante', amountCents: 5000, dueOn: '2099-12-10' } });
  assert.equal(charge.statusCode, 201, charge.body);
  const pdf = Buffer.from('%PDF-1.7\nJustificante QA').toString('base64');
  const proofPayload = { chargeId: charge.json().id, amountCents: 5000, contentType: 'application/pdf', fileName: 'justificante-previo.pdf', base64: pdf };
  const proof = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/transfer-proofs', payload: proofPayload });
  assert.equal(proof.statusCode, 201, proof.body);
  const payment = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/payments', headers: { 'idempotency-key': randomUUID() }, payload: { chargeId: charge.json().id, splits: [{ method: 'card', amountCents: 5000 }] } });
  assert.equal(payment.statusCode, 201, payment.body);
  const refund = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/refunds', headers: { 'idempotency-key': randomUUID() }, payload: { transactionId: payment.json().id, amountCents: 5000, method: 'card', note: 'Devolución total QA' } });
  assert.equal(refund.statusCode, 201, refund.body);

  const newProof = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/transfer-proofs', payload: { ...proofPayload, fileName: 'justificante-nuevo.pdf', base64: Buffer.from('%PDF-1.7\nJustificante posterior').toString('base64') } });
  assert.equal(newProof.statusCode, 409);
  assert.equal(newProof.json().error, 'charge_refunded');
  const validate = await clientsTrainerApp.inject({ method: 'POST', url: `/api/economics/transfer-proofs/${proof.json().id}/review`, payload: { decision: 'validated', note: 'Intento posterior a devolución' } });
  assert.equal(validate.statusCode, 409);
  assert.equal(validate.json().error, 'charge_refunded');
  const [beforeReject] = await sql`SELECT count(*)::int AS count FROM economic_transactions WHERE charge_id=${charge.json().id}`;
  assert.equal(beforeReject.count, 2);
  const [pending] = await sql`SELECT status,transaction_id AS "transactionId" FROM economic_transfer_proofs WHERE id=${proof.json().id}`;
  assert.equal(pending.status, 'pending_validation');
  assert.equal(pending.transactionId, null);

  const reject = await clientsTrainerApp.inject({ method: 'POST', url: `/api/economics/transfer-proofs/${proof.json().id}/review`, payload: { decision: 'rejected', note: 'El cargo ya fue devuelto completamente' } });
  assert.equal(reject.statusCode, 200, reject.body);
  assert.equal(reject.json().status, 'rejected');
  const [afterReject] = await sql`SELECT count(*)::int AS count, sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END)::bigint AS net FROM economic_transactions WHERE charge_id=${charge.json().id}`;
  assert.equal(afterReject.count, 2);
  assert.equal(Number(afterReject.net), 0);
  const [proofAudit] = await sql`SELECT count(*) FILTER(WHERE action='transfer_proof.submitted')::int AS submitted,count(*) FILTER(WHERE action='transfer_proof.rejected')::int AS rejected,count(*) FILTER(WHERE action='payment.transfer_validated')::int AS validated FROM economic_audit_events WHERE resource_id=${proof.json().id} OR (action IN ('payment.recorded','payment.refunded') AND client_id=${client.id})`;
  assert.equal(proofAudit.submitted, 1);
  assert.equal(proofAudit.rejected, 1);
  assert.equal(proofAudit.validated, 0);
});

test('optional debt restriction affects new reservations only when explicitly enabled', async () => {
  const eligibleAdmin = buildServer(process.env.DATABASE_URL, {
    authorizationResolver: async () => ({ actorId: 'qa-economics-admin', role: 'admin' }),
    bookingEligibilityResolver: async () => ({ eligible: true, entitlementId: 'qa-entitlement' }),
  });
  try {
    const clientResponse = await createClientRequest(clientsAdminApp, { firstName: 'Debt', lastName: `QA ${randomUUID()}`, email: null, phone: null });
    const client = clientResponse.json();
    const charge = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/charges', headers: { 'idempotency-key': randomUUID() }, payload: { clientId: client.id, concept: 'Vencido de prueba', amountCents: 1000, dueOn: '2000-01-01' } });
    assert.equal(charge.statusCode, 201);
    const service = await createService();
    const session = await eligibleAdmin.inject({ method: 'POST', url: '/api/calendar/sessions', payload: { serviceId: service.id, areaId: defaultArea.id, startsAt: '2099-12-10T10:00:00Z', durationMinutes: 45, capacity: 4 } });
    assert.equal(session.statusCode, 201, session.body);
    await clientsAdminApp.inject({ method: 'PATCH', url: '/api/economics/settings', payload: { dueDay: 10, debtBlocksNewReservations: true } });
    const blocked = await eligibleAdmin.inject({ method: 'POST', url: `/api/calendar/sessions/${session.json().id}/reservations`, payload: { clientId: client.id } });
    assert.equal(blocked.statusCode, 409);
    assert.equal(blocked.json().error, 'overdue_balance_blocks_booking');
    await clientsAdminApp.inject({ method: 'PATCH', url: '/api/economics/settings', payload: { dueDay: 10, debtBlocksNewReservations: false } });
    const allowed = await eligibleAdmin.inject({ method: 'POST', url: `/api/calendar/sessions/${session.json().id}/reservations`, payload: { clientId: client.id } });
    assert.equal(allowed.statusCode, 201, allowed.body);
  } finally { await eligibleAdmin.close(); }
});

test('debt restriction permits waitlist and Trainer can make a reasoned audited booking exception', async () => {
  const eligibleTrainer=buildServer(process.env.DATABASE_URL,{authorizationResolver:async()=>({actorId:'qa-trainer-debt-override',role:'trainer'}),bookingEligibilityResolver:async()=>({eligible:true,entitlementId:'qa-entitlement'})});
  const eligibleAdmin=buildServer(process.env.DATABASE_URL,{authorizationResolver:async()=>({actorId:'qa-admin-debt-override',role:'admin'}),bookingEligibilityResolver:async()=>({eligible:true,entitlementId:'qa-entitlement'})});
  try {
    const debtClient=(await createClientRequest(clientsAdminApp,{firstName:'Debt',lastName:`QA ${randomUUID()}`,email:null,phone:null})).json();
    const first=(await createClientRequest(clientsAdminApp,{firstName:'Seat',lastName:`QA ${randomUUID()}`,email:null,phone:null})).json();
    await clientsAdminApp.inject({method:'POST',url:'/api/economics/charges',headers:{'idempotency-key':randomUUID()},payload:{clientId:debtClient.id,concept:'Deuda vencida',amountCents:1000,dueOn:'2000-01-01'}});
    const service=await createService();
    const session=await eligibleAdmin.inject({method:'POST',url:'/api/calendar/sessions',payload:{serviceId:service.id,areaId:defaultArea.id,startsAt:'2099-12-10T10:00:00Z',durationMinutes:45,capacity:1}});
    assert.equal(session.statusCode,201,session.body);
    await clientsAdminApp.inject({method:'PATCH',url:'/api/economics/settings',payload:{dueDay:10,debtBlocksNewReservations:true}});
    const firstBooking=await eligibleAdmin.inject({method:'POST',url:`/api/calendar/sessions/${session.json().id}/reservations`,payload:{clientId:first.id}});
    assert.equal(firstBooking.statusCode,201,firstBooking.body);
    const blocked=await eligibleAdmin.inject({method:'POST',url:`/api/calendar/sessions/${session.json().id}/reservations`,payload:{clientId:debtClient.id}});
    assert.equal(blocked.statusCode,409);
    assert.equal(blocked.json().error,'overdue_balance_blocks_booking');
    const waitlist=await eligibleAdmin.inject({method:'POST',url:`/api/calendar/sessions/${session.json().id}/waitlist`,payload:{clientId:debtClient.id}});
    assert.equal(waitlist.statusCode,201,waitlist.body);
    await eligibleAdmin.inject({method:'PATCH',url:`/api/calendar/waitlist/${waitlist.json().id}/cancel`,payload:{}});
    const exception=await eligibleTrainer.inject({method:'POST',url:`/api/calendar/sessions/${session.json().id}/reservations`,payload:{clientId:debtClient.id,overbook:true,overrideDebt:true,overrideReason:'Excepción aprobada por dirección'}});
    assert.equal(exception.statusCode,201,exception.body);
    const [overrideAudit]=await sql`SELECT details->>'reason' AS reason FROM calendar_audit_events WHERE action='reservation.debt_override' AND client_id=${debtClient.id} ORDER BY occurred_at DESC LIMIT 1`;
    assert.equal(overrideAudit.reason,'Excepción aprobada por dirección');
  } finally {
    await clientsAdminApp.inject({method:'PATCH',url:'/api/economics/settings',payload:{dueDay:10,debtBlocksNewReservations:false}});
    await eligibleTrainer.close();await eligibleAdmin.close();
  }
});

test('cash close, human transfer validation, and tax-explicit invoice drafts have guarded transitions', async () => {
  const clientResponse = await createClientRequest(clientsAdminApp, { firstName: 'Fiscal', lastName: `QA ${randomUUID()}`, email: null, phone: null });
  assert.equal(clientResponse.statusCode, 201);
  const client = clientResponse.json();
  const charge = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/charges', headers: { 'idempotency-key': randomUUID() }, payload: { clientId: client.id, concept: 'Transferencia QA', amountCents: 8000, dueOn: '2099-12-10' } });
  assert.equal(charge.statusCode, 201, charge.body);
  const pdf = Buffer.from('%PDF-1.7\nQA document').toString('base64');
  const proofPayload = { chargeId: charge.json().id, amountCents: 8000, contentType: 'application/pdf', fileName: 'justificante.pdf', base64: pdf };
  const proof = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/transfer-proofs', payload: proofPayload });
  assert.equal(proof.statusCode, 201, proof.body);
  const duplicateProof = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/transfer-proofs', payload: proofPayload });
  assert.equal(duplicateProof.statusCode, 409);
  const selfReview = await clientsAdminApp.inject({ method: 'POST', url: `/api/economics/transfer-proofs/${proof.json().id}/review`, payload: { decision: 'validated', note: 'Revisado por QA' } });
  assert.equal(selfReview.statusCode, 403);
  const reviewed = await clientsTrainerApp.inject({ method: 'POST', url: `/api/economics/transfer-proofs/${proof.json().id}/review`, payload: { decision: 'validated', note: 'Revisado por otro miembro del equipo' } });
  assert.equal(reviewed.statusCode, 200, reviewed.body);
  const chargeRows = await clientsAdminApp.inject({ method: 'GET', url: `/api/economics/charges?clientId=${client.id}` });
  assert.equal(chargeRows.json().items[0].status, 'paid');

  const accountantWrite = await clientsAccountantApp.inject({ method: 'PUT', url: `/api/clients/${client.id}/fiscal-profile`, payload: { legalName: 'Cliente de prueba', countryCode: 'ES' } });
  assert.equal(accountantWrite.statusCode, 403);
  const invalidTaxId=await clientsAdminApp.inject({method:'PUT',url:`/api/clients/${client.id}/fiscal-profile`,payload:{legalName:'Cliente de prueba',taxId:'no-es-un-nif',countryCode:'ES'}});
  assert.equal(invalidTaxId.statusCode,400);
  const profile = await clientsAdminApp.inject({ method: 'PUT', url: `/api/clients/${client.id}/fiscal-profile`, payload: { legalName: 'Cliente de prueba', countryCode: 'ES' } });
  assert.equal(profile.statusCode, 200, profile.body);
  const accountantRead = await clientsAccountantApp.inject({ method: 'GET', url: `/api/clients/${client.id}/fiscal-profile` });
  assert.equal(accountantRead.statusCode, 200);
  assert.equal(accountantRead.json().legalName, 'Cliente de prueba');
  const series = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/invoice-series', payload: { name: `QA ${randomUUID()}`, prefix: 'BORR' } });
  assert.equal(series.statusCode, 201, series.body);
  const draft = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/invoice-drafts', headers: { 'idempotency-key': randomUUID() }, payload: { clientId: client.id, seriesId: series.json().id, sourceChargeId: charge.json().id, concept: 'Servicio de prueba', netCents: 8000, taxTreatment: 'taxable', taxBasisPoints: 0 } });
  assert.equal(draft.statusCode, 201, draft.body);
  assert.equal(draft.json().officiallyIssued, false);
  assert.equal(draft.json().officialNumber, null);
  const seriesAfterDraft = await sql`SELECT next_number FROM economic_invoice_series WHERE id=${series.json().id}`;
  assert.equal(Number(seriesAfterDraft[0].next_number), 1, 'drafts must not consume official numbering');
  const issueBlocked = await clientsAdminApp.inject({ method: 'POST', url: `/api/economics/invoice-drafts/${draft.json().id}/issue`, payload: {} });
  assert.equal(issueBlocked.statusCode, 423);
  const nonSubject = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/invoice-drafts', headers: { 'idempotency-key': randomUUID() }, payload: { clientId: client.id, seriesId: series.json().id, sourceChargeId: charge.json().id, concept: 'Línea no sujeta QA', netCents: 8000, taxTreatment: 'non_subject', taxDescription: 'Tratamiento pendiente de revisión legal' } });
  assert.equal(nonSubject.statusCode, 201, nonSubject.body);
  const [taxDraft] = await sql`SELECT tax_treatment,tax_rate_basis_points,tax_cents FROM economic_invoice_drafts WHERE id=${nonSubject.json().id}`;
  assert.equal(taxDraft.tax_treatment, 'non_subject');
  assert.equal(taxDraft.tax_rate_basis_points, null);
  assert.equal(Number(taxDraft.tax_cents), 0);
  const exemptDraft = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/invoice-drafts', headers: { 'idempotency-key': randomUUID() }, payload: { clientId: client.id, seriesId: series.json().id, sourceChargeId: charge.json().id, concept: 'Línea exenta QA', netCents: 8000, taxTreatment: 'exempt', taxDescription: 'Exención sin base legal determinada por el test' } });
  assert.equal(exemptDraft.statusCode, 201, exemptDraft.body);
  const [exemptTaxDraft] = await sql`SELECT tax_treatment,tax_rate_basis_points,tax_cents FROM economic_invoice_drafts WHERE id=${exemptDraft.json().id}`;
  assert.equal(exemptTaxDraft.tax_treatment, 'exempt');
  assert.equal(exemptTaxDraft.tax_rate_basis_points, null);
  assert.equal(Number(exemptTaxDraft.tax_cents), 0);
  const multiLineDraft=await clientsAdminApp.inject({method:'POST',url:'/api/economics/invoice-drafts',headers:{'idempotency-key':randomUUID()},payload:{clientId:client.id,seriesId:series.json().id,sourceChargeId:charge.json().id,lines:[{description:'Línea 0%',netCents:2000,taxTreatment:'taxable',taxBasisPoints:0},{description:'Línea exenta',netCents:3000,taxTreatment:'exempt',taxDescription:'Revisión legal pendiente'},{description:'Línea no sujeta',netCents:3000,taxTreatment:'non_subject',taxDescription:'Revisión legal pendiente'}]}});
  assert.equal(multiLineDraft.statusCode,201,multiLineDraft.body);
  const [lineData]=await sql`SELECT tax_treatment,line_items FROM economic_invoice_drafts WHERE id=${multiLineDraft.json().id}`;
  assert.equal(lineData.tax_treatment,'mixed');
  assert.equal(lineData.line_items.length,3);

  const opened = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/cash/open', payload: { openingCents: 20000 } });
  assert.equal(opened.statusCode, 201, opened.body);
  const secondOpen = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/cash/open', payload: { openingCents: 1000 } });
  assert.equal(secondOpen.statusCode, 409);
  const cashCharge = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/charges', headers: { 'idempotency-key': randomUUID() }, payload: { clientId: client.id, concept: 'Pago en caja QA', amountCents: 8000, dueOn: '2099-12-10' } });
  const cashPayment = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/payments', headers: { 'idempotency-key': randomUUID() }, payload: { chargeId: cashCharge.json().id, splits: [{ method: 'cash', amountCents: 3000 }, { method: 'card', amountCents: 2000 }] } });
  assert.equal(cashPayment.statusCode, 201, cashPayment.body);
  const cashRefund = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/refunds', headers: { 'idempotency-key': randomUUID() }, payload: { transactionId: cashPayment.json().id, amountCents: 500, method: 'cash', note: 'Devolución parcial QA' } });
  assert.equal(cashRefund.statusCode, 201, cashRefund.body);
  const [cashLinks] = await sql`SELECT count(*)::int AS count FROM economic_transactions WHERE id IN (${cashPayment.json().id}::uuid,${cashRefund.json().id}::uuid) AND cash_session_id=${opened.json().id}`;
  assert.equal(cashLinks.count, 2);
  const adjustment = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/cash/adjustments', payload: { amountCents: 300, reason: 'Cambio de apertura QA' } });
  assert.equal(adjustment.statusCode, 201, adjustment.body);
  const liveCash = await clientsAdminApp.inject({ method: 'GET', url: '/api/economics/cash/today' });
  assert.equal(Number(liveCash.json().session.expectedCents), 22800);
  assert.equal(Number(liveCash.json().session.cashPaymentsCents), 3000);
  assert.equal(Number(liveCash.json().session.cashRefundsCents), 500);
  const closed = await clientsAdminApp.inject({ method: 'POST', url: `/api/economics/cash/${opened.json().id}/close`, payload: { countedCents: 23000 } });
  assert.equal(closed.statusCode, 200, closed.body);
  assert.equal(closed.json().status, 'closed');
  assert.equal(Number(closed.json().expectedCents), 22800);
  assert.equal(Number(closed.json().differenceCents), 200);
  const duplicateClose = await clientsAdminApp.inject({ method: 'POST', url: '/api/economics/cash/close', payload: { countedCents: 27000 } });
  assert.equal(duplicateClose.statusCode, 409);
  const [immutableCash] = await sql`SELECT expected_cents,difference_cents FROM economic_cash_sessions WHERE id=${opened.json().id}`;
  await assert.rejects(sql`UPDATE economic_cash_sessions SET counted_cents=1 WHERE id=${opened.json().id}`, { code: '55000' });
  assert.equal(Number(immutableCash.expected_cents), 22800);
  assert.equal(Number(immutableCash.difference_cents), 200);
});

test('late close preserves the operational date and records the actual closer and timestamp', async () => {
  const [session] = await sql`INSERT INTO economic_cash_sessions(local_date,opening_cents,opened_by) VALUES ('1900-01-01',5000,'qa-late-open') RETURNING id,local_date`;
  const response = await clientsAdminApp.inject({ method:'POST',url:`/api/economics/cash/${session.id}/close`,payload:{countedCents:5000} });
  assert.equal(response.statusCode,200,response.body);
  assert.equal(response.json().status,'late_close');
  assert.equal(String(response.json().localDate),session.local_date instanceof Date ? session.local_date.toISOString().slice(0,10) : String(session.local_date));
  assert.equal(response.json().closedBy,'qa-admin');
  assert.ok(response.json().closedAt);
});

test('pending charges can be voided once with an audited reason, while charges with money require compensation', async () => {
  const created = await createClientRequest(clientsAdminApp,{firstName:'Void',lastName:`QA ${randomUUID()}`,email:null,phone:null});
  const client=created.json();
  const charge=await clientsAdminApp.inject({method:'POST',url:'/api/economics/charges',headers:{'idempotency-key':randomUUID()},payload:{clientId:client.id,concept:'Cargo incorrecto',amountCents:5000,dueOn:'2099-12-10'}});
  assert.equal(charge.statusCode,201,charge.body);
  const missingReason=await clientsAdminApp.inject({method:'POST',url:`/api/economics/charges/${charge.json().id}/void`,payload:{reason:'  '}});
  assert.equal(missingReason.statusCode,400);
  const voided=await clientsAdminApp.inject({method:'POST',url:`/api/economics/charges/${charge.json().id}/void`,payload:{reason:'Alta duplicada por error'}});
  assert.equal(voided.statusCode,200,voided.body);
  assert.equal(voided.json().state,'void');
  const [voidAudit]=await sql`SELECT count(*)::int count FROM economic_audit_events WHERE resource_id=${charge.json().id} AND action='charge.voided'`;
  assert.equal(voidAudit.count,1);

  const paidCharge=await clientsAdminApp.inject({method:'POST',url:'/api/economics/charges',headers:{'idempotency-key':randomUUID()},payload:{clientId:client.id,concept:'Cargo con movimiento',amountCents:5000,dueOn:'2099-12-10'}});
  const paid=await clientsAdminApp.inject({method:'POST',url:'/api/economics/payments',headers:{'idempotency-key':randomUUID()},payload:{chargeId:paidCharge.json().id,splits:[{method:'card',amountCents:1000}]}});
  assert.equal(paid.statusCode,201,paid.body);
  const blocked=await clientsAdminApp.inject({method:'POST',url:`/api/economics/charges/${paidCharge.json().id}/void`,payload:{reason:'Intento de anular con dinero'}});
  assert.equal(blocked.statusCode,409);
  assert.equal(blocked.json().error,'refund_required');
  const history=await sql`SELECT id,kind,amount_cents FROM economic_transactions WHERE charge_id=${paidCharge.json().id}`;
  assert.equal(history.length,1);
  assert.equal(history[0].id,paid.json().id);
});

test('economic history rejects truncate and destructive row changes', async () => {
  const created=await createClientRequest(clientsAdminApp,{firstName:'Guards',lastName:`QA ${randomUUID()}`,email:null,phone:null});
  const client=created.json();
  const charge=await clientsAdminApp.inject({method:'POST',url:'/api/economics/charges',headers:{'idempotency-key':randomUUID()},payload:{clientId:client.id,concept:'Histórico protegido',amountCents:2000,dueOn:'2099-12-10'}});
  const series=await clientsAdminApp.inject({method:'POST',url:'/api/economics/invoice-series',payload:{name:`SER-${randomUUID()}`,prefix:'QA'}});
  const [session]=await sql`INSERT INTO economic_cash_sessions(local_date,opening_cents,expected_cents,counted_cents,difference_cents,status,close_kind,opened_by,closed_by,closed_at) VALUES ((now() AT TIME ZONE 'Atlantic/Canary')::date-10,0,0,0,0,'closed','closed','qa-guard','qa-guard',now()) RETURNING id`;
  await sql`INSERT INTO economic_cash_adjustments(cash_session_id,amount_cents,reason,actor_id) VALUES (${session.id},100,'Movimiento de fixture','qa-guard')`;
  const [proof]=await sql`INSERT INTO economic_transfer_proofs(charge_id,amount_cents,content_type,file_name,file_bytes,sha256,submitted_by) VALUES (${charge.json().id},100,'application/pdf','fixture.pdf',${Buffer.from('%PDF-1.7')},${createHash('sha256').update('fixture').digest('hex')},'qa-uploader') RETURNING id`;
  const payment=await clientsAdminApp.inject({method:'POST',url:'/api/economics/payments',headers:{'idempotency-key':randomUUID()},payload:{chargeId:charge.json().id,splits:[{method:'card',amountCents:2000}]}});
  assert.equal(payment.statusCode,201,payment.body);
  const draft=await clientsAdminApp.inject({method:'POST',url:'/api/economics/invoice-drafts',headers:{'idempotency-key':randomUUID()},payload:{clientId:client.id,seriesId:series.json().id,sourceChargeId:charge.json().id,concept:'Borrador guardado',netCents:2000,taxTreatment:'taxable',taxBasisPoints:0}});
  assert.equal(draft.statusCode,201,draft.body);
  const [document]=await sql`INSERT INTO economic_fiscal_documents(draft_id,document_type,status,series_id,series_name,document_number,source_charge_id,client_id,issuer_snapshot,client_snapshot,lines_snapshot,payment_methods,totals_snapshot,issued_by) VALUES (${draft.json().id},'simplified_ticket','issued',${series.json().id},'QA','QA-001',${charge.json().id},${client.id},'{}'::jsonb,'{}'::jsonb,'[]'::jsonb,'[]'::jsonb,'{}'::jsonb,'qa-issuer') RETURNING id`;
  const protectedTables=['economic_transactions','economic_payment_splits','economic_audit_events','economic_charges','economic_cash_adjustments','economic_cash_sessions','economic_transfer_proofs','economic_invoice_series','economic_invoice_drafts','economic_fiscal_documents'];
  for(const table of protectedTables) await assert.rejects(sql.unsafe(`TRUNCATE ${table} CASCADE`),{code:'55000'},`${table} must reject TRUNCATE`);
  await assert.rejects(sql`DELETE FROM economic_charges WHERE id=${charge.json().id}`,{code:'55000'});
  await assert.rejects(sql`DELETE FROM economic_invoice_series WHERE id=${series.json().id}`,{code:'55000'});
  await assert.rejects(sql`DELETE FROM economic_transfer_proofs WHERE id=${proof.id}`,{code:'55000'});
  await assert.rejects(sql`DELETE FROM economic_cash_adjustments WHERE cash_session_id=${session.id}`,{code:'55000'});
  await assert.rejects(sql`UPDATE economic_fiscal_documents SET document_number='EDITED' WHERE id=${document.id}`,{code:'55000'});
  await assert.rejects(sql`DELETE FROM economic_fiscal_documents WHERE id=${document.id}`,{code:'55000'});
});

test('accountant is economic/fiscal read-only and upload limits stay route-specific', async () => {
  const created=await createClientRequest(clientsAdminApp,{firstName:'Read',lastName:`QA ${randomUUID()}`,email:null,phone:null});
  const client=created.json();
  const charge=await clientsAdminApp.inject({method:'POST',url:'/api/economics/charges',headers:{'idempotency-key':randomUUID()},payload:{clientId:client.id,concept:'Lectura contable',amountCents:1000,dueOn:'2099-12-10'}});
  const economicRead=await clientsAccountantApp.inject({method:'GET',url:`/api/clients/${client.id}/economics`});
  assert.equal(economicRead.statusCode,200,economicRead.body);
  assert.equal(economicRead.json().items[0].id,charge.json().id);
  assert.equal((await clientsAccountantApp.inject({method:'GET',url:'/api/economics/export'})).statusCode,200);
  assert.equal((await clientsAccountantApp.inject({method:'GET',url:'/api/economics/fiscal-export'})).statusCode,200);
  assert.equal((await clientsAccountantApp.inject({method:'POST',url:'/api/economics/payments',headers:{'idempotency-key':randomUUID()},payload:{chargeId:charge.json().id,splits:[{method:'card',amountCents:100}]}})).statusCode,403);
  assert.equal((await clientsAccountantApp.inject({method:'POST',url:'/api/economics/cash/open',payload:{openingCents:100}})).statusCode,403);
  const tooLargeNormal=await clientsAdminApp.inject({method:'POST',url:'/api/economics/cash/open',headers:{'content-type':'application/json'},payload:{openingCents:1,padding:'x'.repeat(20000)}});
  assert.equal(tooLargeNormal.statusCode,413);
  const proofBytes=Buffer.concat([Buffer.from('%PDF-1.7\n'),Buffer.alloc(20000,65)]);
  const acceptedLargeProof=await clientsAdminApp.inject({method:'POST',url:'/api/economics/transfer-proofs',payload:{chargeId:charge.json().id,amountCents:100,contentType:'application/pdf',fileName:'large-fixture.pdf',base64:proofBytes.toString('base64')}});
  assert.equal(acceptedLargeProof.statusCode,201,acceptedLargeProof.body);
});

test('local Host handling rejects unexpected hosts while health reports database readiness', async () => {
  const allowed = await app.inject({ method: 'GET', url: '/health' });
  const rejected = await app.inject({ method: 'GET', url: '/health', headers: { host: 'unsafe.example' } });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.json().database, 'ready');
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.json().error, 'invalid_host');
});

test('GET plan database connectivity failures return a structured 503', async () => {
  const unavailable = buildServer('postgres://local:local@127.0.0.1:1/unavailable');
  try {
    const response = await unavailable.inject({ method: 'GET', url: `/api/services/${randomUUID()}/plans` });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error, 'database_unavailable');
  } finally { await unavailable.close(); }
});

test('client plan sale atomically assigns the frozen catalog version, charge and optional payment with server permissions', async () => {
  const service=await createService(`Plan venta ${randomUUID()}`);
  const createdPlan=await createPlan([service.id]);
  assert.equal(createdPlan.response.statusCode,201,createdPlan.response.body);
  const planId=createdPlan.response.json().id;
  const activated=await app.inject({method:'POST',url:`/api/plans/${planId}/activate`});
  assert.equal(activated.statusCode,200,activated.body);
  const assignable=await clientsAdminApp.inject({method:'GET',url:'/api/plans/assignable'});
  assert.ok(assignable.json().some(item=>item.id===planId));
  assert.equal((await clientsTrainerApp.inject({method:'GET',url:'/api/plans/assignable'})).statusCode,200);
  const created=await createClientRequest(clientsAdminApp,{firstName:'Venta',lastName:`Integración ${randomUUID()}`,email:null,phone:null});
  assert.equal(created.statusCode,201,created.body);
  const clientId=created.json().id;
  const key=randomUUID();
  const payload={planId,startsOn:'2026-10-09',endsOn:null,dueOn:'2026-10-09',amountCents:5900,paymentAmountCents:5900,paymentMethod:'card'};
  const response=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${clientId}/plans`,headers:{'idempotency-key':key},payload});
  assert.equal(response.statusCode,201,response.body);
  const replay=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${clientId}/plans`,headers:{'idempotency-key':key},payload});
  assert.equal(replay.statusCode,200,replay.body);
  assert.equal(replay.json().id,response.json().id);
  const conflict=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${clientId}/plans`,headers:{'idempotency-key':key},payload:{...payload,amountCents:6000}});
  assert.equal(conflict.statusCode,409,conflict.body);
  assert.equal(conflict.json().error,'idempotency_conflict');
  const [counts]=await sql`SELECT (SELECT count(*)::int FROM client_plan_assignments WHERE client_id=${clientId}) assignments,(SELECT count(*)::int FROM economic_charges WHERE client_id=${clientId} AND plan_id=${planId}) charges,(SELECT count(*)::int FROM economic_transactions WHERE client_id=${clientId} AND kind='payment') payments,(SELECT count(*)::int FROM economic_audit_events WHERE client_id=${clientId} AND action IN ('client_plan.assigned','charge.created','payment.recorded')) audit_events,(SELECT count(*)::int FROM client_events WHERE client_id=${clientId} AND event_type='client.plan_assigned') AS client_events`;
  assert.deepEqual(counts,{assignments:1,charges:1,payments:1,audit_events:3,client_events:1});
  const profile=await clientsAdminApp.inject({method:'GET',url:`/api/clients/${clientId}`});
  assert.equal(profile.statusCode,200,profile.body);
  assert.equal(profile.json().summary.plans.data[0].planName,createdPlan.body.name);
  assert.equal(profile.json().summary.plans.data[0].derivedStatus,'active');
  assert.equal((await clientsTrainerApp.inject({method:'GET',url:`/api/clients/${clientId}/plans`})).statusCode,200);
  const forbidden=await clientsTrainerApp.inject({method:'POST',url:`/api/clients/${clientId}/plans`,headers:{'idempotency-key':randomUUID()},payload});
  assert.equal(forbidden.statusCode,403);
});

test('client plan sale leaves only an unpaid charge when no money is collected and rolls back if cash cannot be recorded', async () => {
  const service=await createService(`Plan pendiente ${randomUUID()}`);
  const createdPlan=await createPlan([service.id]);
  const planId=createdPlan.response.json().id;
  assert.equal((await app.inject({method:'POST',url:`/api/plans/${planId}/activate`})).statusCode,200);
  const create=async()=>{const response=await createClientRequest(clientsAdminApp,{firstName:'Cargo',lastName:`Pendiente ${randomUUID()}`,email:null,phone:null});assert.equal(response.statusCode,201);return response.json().id;};
  const clientId=await create();
  const key=randomUUID();
  const payload={planId,startsOn:'2026-10-09',dueOn:'2026-10-09',amountCents:2500};
  const response=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${clientId}/plans`,headers:{'idempotency-key':key},payload});
  assert.equal(response.statusCode,201,response.body);
  const [charge]=await sql`SELECT state,amount_cents::int AS "amountCents",plan_id AS "planId" FROM economic_charges WHERE client_id=${clientId}`;
  assert.deepEqual(charge,{state:'pending',amountCents:2500,planId});
  const clientId2=await create();
  const before=await sql`SELECT count(*)::int AS count FROM economic_charges WHERE client_id=${clientId2}`;
  const failed=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${clientId2}/plans`,headers:{'idempotency-key':randomUUID()},payload:{...payload,paymentAmountCents:2500,paymentMethod:'cash'}});
  assert.equal(failed.statusCode,409,failed.body);
  const after=await sql`SELECT count(*)::int AS count FROM economic_charges WHERE client_id=${clientId2}`;
  assert.equal(after[0].count,before[0].count,'cash validation happens before sale writes; no partial charge or assignment');
  const assignments=await sql`SELECT count(*)::int AS count FROM client_plan_assignments WHERE client_id=${clientId2}`;
  assert.equal(assignments[0].count,0);
});

test('2J-073 freezes catalog revisions and the purchased client snapshot remains unchanged', async () => {
  const service=await createService(`Entitlement ${randomUUID()}`);
  const created=await createPlan([service.id],{name:`Producto ${randomUUID()}`,basePriceCents:4900,modules:[{module:'training',accessLevel:'limited',capabilities:['training.routines.read']} ]});
  assert.equal(created.response.statusCode,201,created.response.body);
  const planId=created.response.json().id;
  assert.equal((await app.inject({method:'POST',url:`/api/plans/${planId}/activate`})).statusCode,200);
  const client=(await createClientRequest(clientsAdminApp,{firstName:'Derechos',lastName:`Cliente ${randomUUID()}`})).json();
  const assignment=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans`,headers:{'idempotency-key':randomUUID()},payload:{planId,startsOn:'2026-10-09',endsOn:'2026-10-31',dueOn:'2026-10-09',amountCents:4900}});
  assert.equal(assignment.statusCode,201,assignment.body);
  const snapshotBefore=(await sql`SELECT snapshot FROM client_plan_assignments WHERE id=${assignment.json().id}`)[0].snapshot;
  assert.equal(snapshotBefore.name,created.body.name);
  assert.equal(snapshotBefore.salePriceCents,4900);
  assert.equal(snapshotBefore.listPriceCents,4900);
  assert.equal(snapshotBefore.modules[0].accessLevel,'limited');
  assert.equal(snapshotBefore.rights.find(right=>right.rightType==='service_access').serviceId,service.id,'the sale snapshot retains the exact service target');
  const revised=await clientsAdminApp.inject({method:'POST',url:`/api/plans/${planId}/versions`,headers:{'idempotency-key':randomUUID()},payload:{...created.body,currentVersion:undefined,status:undefined,basePriceCents:5500,modules:[{module:'training',accessLevel:'full',capabilities:['training.routines.read','training.workouts.log']} ]}});
  assert.equal(revised.statusCode,201,revised.body);
  assert.equal(revised.json().currentVersion,2);
  assert.equal(Number(revised.json().basePriceCents),5500);
  const profile=await clientsAdminApp.inject({method:'GET',url:`/api/clients/${client.id}`});
  const purchased=profile.json().summary.plans.data.find(row=>row.id===assignment.json().id);
  assert.equal(purchased.planName,created.body.name);
  assert.equal(purchased.planVersion,1);
  assert.equal(purchased.snapshot.modules[0].accessLevel,'limited');
  const effective=await clientsAdminApp.inject({method:'GET',url:`/api/clients/${client.id}/entitlements/effective?date=2026-10-09`});
  assert.equal(effective.statusCode,200,effective.body);
  assert.equal(effective.json().modules[0].accessLevel,'limited');
  assert.equal((await clientsAdminApp.inject({method:'GET',url:`/api/clients/${randomUUID()}/entitlements/effective?date=2026-10-09`})).statusCode,404);
  assert.equal((await clientsTrainerApp.inject({method:'GET',url:`/api/clients/${client.id}/entitlements/effective?date=2026-10-09`})).statusCode,200);
});

test('bonus balance is an append-only idempotent ledger; pause, resume and cancel are effective and audited', async () => {
  const service=await createService(`Bono ${randomUUID()}`);
  const created=await createPlan([service.id],{kind:'session_pack',renewalCadence:null,basePriceCents:9000,rights:[{rightType:'sessions_quota',serviceId:null,quotaScope:'shared',quantity:10}],modules:[{module:'reservations',accessLevel:'full',capabilities:[]}]});
  assert.equal(created.response.statusCode,201,created.response.body);
  const planId=created.response.json().id;
  assert.equal((await app.inject({method:'POST',url:`/api/plans/${planId}/activate`})).statusCode,200);
  const client=(await createClientRequest(clientsAdminApp,{firstName:'Bono',lastName:`Cliente ${randomUUID()}`})).json();
  const sale=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans`,headers:{'idempotency-key':randomUUID()},payload:{planId,startsOn:'2026-10-09',endsOn:'2027-01-06',dueOn:'2026-10-09',amountCents:9000}});
  assert.equal(sale.statusCode,201,sale.body);
  const [right]=await sql`SELECT id FROM plan_rights WHERE plan_id=${planId} AND right_type='sessions_quota'`;
  const adjustKey=randomUUID();const adjustment={rightId:right.id,quantity:-3,reason:'Corrección de saldo solicitada'};
  const adjusted=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans/${sale.json().id}/adjustments`,headers:{'idempotency-key':adjustKey},payload:adjustment});
  assert.equal(adjusted.statusCode,201,adjusted.body);
  const replay=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans/${sale.json().id}/adjustments`,headers:{'idempotency-key':adjustKey},payload:adjustment});
  assert.equal(replay.statusCode,200,replay.body);assert.equal(replay.json().id,adjusted.json().id);
  const negative=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans/${sale.json().id}/adjustments`,headers:{'idempotency-key':randomUUID()},payload:{...adjustment,quantity:-8}});
  assert.equal(negative.statusCode,409);assert.equal(negative.json().error,'balance_cannot_be_negative');
  const pauseKey=randomUUID();
  const paused=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans/${sale.json().id}/pause`,headers:{'idempotency-key':pauseKey},payload:{effectiveOn:'2026-10-09',expectedResumeOn:'2026-10-16',reason:'Pausa solicitada por el cliente'}});
  assert.equal(paused.statusCode,201,paused.body);
  const pausedReplay=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans/${sale.json().id}/pause`,headers:{'idempotency-key':pauseKey},payload:{effectiveOn:'2026-10-09',expectedResumeOn:'2026-10-16',reason:'Pausa solicitada por el cliente'}});
  assert.equal(pausedReplay.statusCode,200);
  const pausedEffective=await clientsAdminApp.inject({method:'GET',url:`/api/clients/${client.id}/entitlements/effective?date=2026-10-09`});
  assert.equal(pausedEffective.json().assignments[0].status,'paused');assert.equal(pausedEffective.json().assignments[0].usable,false);
  const resumed=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans/${sale.json().id}/resume`,headers:{'idempotency-key':randomUUID()},payload:{effectiveOn:'2026-10-10'}});
  assert.equal(resumed.statusCode,201,resumed.body);
  const active=await clientsAdminApp.inject({method:'GET',url:`/api/clients/${client.id}/entitlements/effective?date=2026-10-10`});
  assert.equal(active.json().assignments[0].status,'active');assert.equal(active.json().rights[0].balance,7);
  const cancelled=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans/${sale.json().id}/cancel`,headers:{'idempotency-key':randomUUID()},payload:{effectiveOn:'2026-10-11',reason:'Baja solicitada por el cliente'}});
  assert.equal(cancelled.statusCode,201,cancelled.body);
  const cancelledEffective=await clientsAdminApp.inject({method:'GET',url:`/api/clients/${client.id}/entitlements/effective?date=2026-10-11`});
  assert.equal(cancelledEffective.json().assignments[0].status,'cancelled');assert.equal(cancelledEffective.json().assignments[0].usable,false);
  const movements=await clientsAdminApp.inject({method:'GET',url:`/api/clients/${client.id}/plans/${sale.json().id}/movements`});
  assert.equal(movements.statusCode,200);assert.deepEqual(movements.json().movements.map(row=>row.entryType).sort(),['adjustment','grant']);
  assert.ok(movements.json().events.some(row=>row.eventType==='paused'));
  const [counts]=await sql`SELECT (SELECT count(*)::int FROM client_entitlement_ledger WHERE assignment_id=${sale.json().id}) AS ledger,(SELECT count(*)::int FROM economic_audit_events WHERE client_id=${client.id} AND action IN ('client_plan.assigned','client_plan.balance_adjusted','client_plan.paused','client_plan.resumed','client_plan.cancelled')) AS audit`;
  assert.deepEqual(counts,{ledger:2,audit:5});
});

test('renew and change append new assignments and preserve the former assignment history', async () => {
  const service=await createService(`Cambio ${randomUUID()}`);const created=await createPlan([service.id],{basePriceCents:2500});
  const planId=created.response.json().id;assert.equal((await app.inject({method:'POST',url:`/api/plans/${planId}/activate`})).statusCode,200);
  const client=(await createClientRequest(clientsAdminApp,{firstName:'Cambio',lastName:`Cliente ${randomUUID()}`})).json();
  const sale=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans`,headers:{'idempotency-key':randomUUID()},payload:{planId,startsOn:'2026-10-01',endsOn:'2026-10-31',dueOn:'2026-10-01',amountCents:2500}});assert.equal(sale.statusCode,201,sale.body);
  const renewalKey=randomUUID();const renewal={planId,startsOn:'2026-11-01',endsOn:'2026-11-30',dueOn:'2026-11-01',amountCents:2500,sourceAssignmentId:sale.json().id,operationKind:'renewal'};
  const renewed=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans`,headers:{'idempotency-key':renewalKey},payload:renewal});assert.equal(renewed.statusCode,201,renewed.body);
  const renewalReplay=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans`,headers:{'idempotency-key':renewalKey},payload:renewal});assert.equal(renewalReplay.statusCode,200);assert.equal(renewalReplay.json().id,renewed.json().id);
  const [count]=await sql`SELECT count(*)::int AS total FROM client_plan_assignments WHERE client_id=${client.id}`;assert.equal(count.total,2);
  const movements=await clientsAdminApp.inject({method:'GET',url:`/api/clients/${client.id}/plans/${sale.json().id}/movements`});assert.ok(movements.json().events.some(event=>event.eventType==='renewed'));
});

test('canonical effective resolver keeps scheduled, expired and paused rights out and merges module levels explicitly', async () => {
  const assignments=[
    {id:'a',status:'active',startsOn:'2026-01-01',endsOn:null,snapshot:{services:[{id:'s1'}],areas:[{id:'ar1'}]},rights:[{rightType:'service_access',serviceId:null}],modules:[{module:'training',accessLevel:'limited',capabilities:['training.routines.read']}]},
    {id:'b',status:'active',startsOn:'2026-01-01',endsOn:null,snapshot:{services:[{id:'s1'},{id:'s2'}],areas:[{id:'ar1'},{id:'ar2'}]},rights:[{rightType:'sessions_quota',quantity:2}],modules:[{module:'training',accessLevel:'full',capabilities:['training.workouts.log']}]},
    {id:'c',status:'scheduled',startsOn:'2026-10-10',endsOn:null,snapshot:{},rights:[],modules:[]},
    {id:'d',status:'active',startsOn:'2026-01-01',endsOn:null,snapshot:{services:[{id:'s3'}]},rights:[{rightType:'sessions_quota',quantity:1,balance:0}],modules:[{module:'nutrition',accessLevel:'full',capabilities:[]}]},
  ];
  const effective=getEffectiveEntitlements(assignments,'2026-10-09');
  assert.equal(effective.assignments.find(item=>item.id==='c').usable,false);
  assert.equal(effective.assignments.find(item=>item.id==='d').status,'exhausted');assert.equal(effective.assignments.find(item=>item.id==='d').usable,false);
  assert.equal(effective.services.length,2);assert.equal(effective.modules.find(item=>item.module==='training').accessLevel,'full');assert.equal(effective.modules.some(item=>item.module==='nutrition'),false);
  assert.deepEqual(effective.modules.find(item=>item.module==='training').capabilities,['training.routines.read','training.workouts.log']);
  assert.equal(effective.rights.some(right=>right.rightType==='service_access'&&right.serviceId==null),false,'a legacy missing destination is never returned as effective access');
  assert.ok(effective.assignments.find(item=>item.id==='a').blockingReasons.includes('service_access_target_missing'));
});

test('2J-073 concurrent identical renewal retries create one assignment and charge', async () => {
  const service=await createService(`Renovación concurrente ${randomUUID()}`);const created=await createPlan([service.id],{basePriceCents:2500});const planId=created.response.json().id;assert.equal((await app.inject({method:'POST',url:`/api/plans/${planId}/activate`})).statusCode,200);
  const client=(await createClientRequest(clientsAdminApp,{firstName:'Retry',lastName:`Renovación ${randomUUID()}`})).json();
  const original=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans`,headers:{'idempotency-key':randomUUID()},payload:{planId,startsOn:'2026-10-01',endsOn:'2026-10-31',dueOn:'2026-10-01',amountCents:2500}});assert.equal(original.statusCode,201,original.body);
  const key=randomUUID();const payload={planId,startsOn:'2026-11-01',endsOn:'2026-11-30',dueOn:'2026-11-01',amountCents:2500,sourceAssignmentId:original.json().id,operationKind:'renewal'};
  const results=await Promise.all([clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans`,headers:{'idempotency-key':key},payload}),clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans`,headers:{'idempotency-key':key},payload})]);
  assert.deepEqual(results.map(row=>row.statusCode).sort(),[200,201]);assert.equal(results[0].json().id,results[1].json().id);
  const [counts]=await sql`SELECT count(*)::int AS assignments,(SELECT count(*)::int FROM economic_charges WHERE client_id=${client.id}) AS charges FROM client_plan_assignments WHERE client_id=${client.id}`;assert.deepEqual(counts,{assignments:2,charges:2});
});

test('2J-073 concurrent bonus adjustments serialize and never overspend the ledger', async () => {
  const service=await createService(`Saldo concurrente ${randomUUID()}`);const created=await createPlan([service.id],{kind:'session_pack',renewalCadence:null,rights:[{rightType:'sessions_quota',serviceId:null,quotaScope:'shared',quantity:2}]});const planId=created.response.json().id;assert.equal((await app.inject({method:'POST',url:`/api/plans/${planId}/activate`})).statusCode,200);
  const client=(await createClientRequest(clientsAdminApp,{firstName:'Saldo',lastName:`Concurrente ${randomUUID()}`})).json();const sale=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans`,headers:{'idempotency-key':randomUUID()},payload:{planId,startsOn:'2026-10-09',endsOn:'2027-01-06',dueOn:'2026-10-09',amountCents:3000}});assert.equal(sale.statusCode,201,sale.body);
  const [right]=await sql`SELECT id FROM plan_rights WHERE plan_id=${planId} AND right_type='sessions_quota'`;const route=`/api/clients/${client.id}/plans/${sale.json().id}/adjustments`;
  const results=await Promise.all([1,2].map(()=>clientsAdminApp.inject({method:'POST',url:route,headers:{'idempotency-key':randomUUID()},payload:{rightId:right.id,quantity:-2,reason:'Ajuste concurrente aprobado'}})));
  assert.deepEqual(results.map(row=>row.statusCode).sort(),[201,409]);const [balance]=await sql`SELECT sum(quantity)::int AS remaining FROM client_entitlement_ledger WHERE assignment_id=${sale.json().id}`;assert.equal(balance.remaining,0);
});

test('session pack reaches the derived exhausted state when its append-only ledger reaches zero', async () => {
  const service=await createService(`Bono agotado ${randomUUID()}`);const created=await createPlan([service.id],{kind:'session_pack',renewalCadence:null,rights:[{rightType:'sessions_quota',serviceId:null,quotaScope:'shared',quantity:1}]});const planId=created.response.json().id;assert.equal((await app.inject({method:'POST',url:`/api/plans/${planId}/activate`})).statusCode,200);
  const client=(await createClientRequest(clientsAdminApp,{firstName:'Agotado',lastName:`Bono ${randomUUID()}`})).json();const sale=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans`,headers:{'idempotency-key':randomUUID()},payload:{planId,startsOn:'2026-10-09',endsOn:'2027-01-06',dueOn:'2026-10-09',amountCents:3000}});assert.equal(sale.statusCode,201,sale.body);const [right]=await sql`SELECT id FROM plan_rights WHERE plan_id=${planId} AND right_type='sessions_quota'`;
  const adjusted=await clientsAdminApp.inject({method:'POST',url:`/api/clients/${client.id}/plans/${sale.json().id}/adjustments`,headers:{'idempotency-key':randomUUID()},payload:{rightId:right.id,quantity:-1,reason:'Corrección total del saldo'}});assert.equal(adjusted.statusCode,201,adjusted.body);
  const effective=await clientsAdminApp.inject({method:'GET',url:`/api/clients/${client.id}/entitlements/effective?date=2026-10-09`});assert.equal(effective.json().assignments[0].status,'exhausted');assert.equal(effective.json().assignments[0].usable,false);assert.equal(effective.json().rights.length,0);
  const profile=await clientsAdminApp.inject({method:'GET',url:`/api/clients/${client.id}`});assert.equal(profile.json().summary.plans.data[0].derivedStatus,'exhausted');assert.equal(profile.json().summary.plans.data[0].rights[0].balance,0);
});
