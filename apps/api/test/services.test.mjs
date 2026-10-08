import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Writable } from 'node:stream';
import { buildServer, mapDatabaseError, planInput, serviceInput } from '../src/server.ts';
import { createClientInput } from '../src/clients.ts';
import { migrateDatabase } from '../src/migrate.ts';
import * as schema from '../src/schema.ts';
import { getTableConfig } from 'drizzle-orm/pg-core';
import postgres from 'postgres';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: PostgreSQL integration tests cannot be skipped.');

const sql = postgres(process.env.DATABASE_URL, { max: 10, connect_timeout: 5 });
await migrateDatabase(sql);
const app = buildServer(process.env.DATABASE_URL);
const clientsAdminApp = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'qa-admin', role: 'admin' }) });
const clientsTrainerApp = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'qa-trainer', role: 'trainer' }) });
const clientsAccountantApp = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'qa-accountant', role: 'accountant' }) });
const [defaultArea] = await sql`SELECT id,name FROM areas WHERE normalized_name='la sala'`;
after(async () => { await Promise.all([app.close(), clientsAdminApp.close(), clientsTrainerApp.close(), clientsAccountantApp.close()]); await sql.end(); });

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
  const tables = [schema.areas, schema.services, schema.plans, schema.planServices, schema.planVersions, schema.planRights, schema.clients, schema.clientEvents, schema.clientCreationIdempotency, schema.recurringSessionTemplates, schema.calendarSessions, schema.calendarReservations, schema.calendarWaitlistEntries, schema.calendarAuditEvents];
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
  for (const name of configuredForeignKeys) assert.ok(databaseForeignKeys.some((key) => key.conname === name), `missing SQL foreign key ${name}`);
  for (const key of databaseForeignKeys.filter((item) => configuredForeignKeys.includes(item.conname))) assert.equal(key.confdeltype, 'r', `${key.conname} must restrict historical deletes`);
  assert.ok((await sql`SELECT 1 FROM pg_constraint WHERE conname='plans_current_version_fk'`).length, 'SQL must retain the deferred active-version foreign key');
  const planIndexes = await sql`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('plans','services')`;
  assert.match(planIndexes.find((row) => row.indexname === 'plans_active_name_unique').indexdef, /lower\(name\)/);
  assert.match(planIndexes.find((row) => row.indexname === 'services_updated_idx').indexdef, /updated_at DESC/);
  const rightIndexes = await sql`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND indexname IN ('plan_rights_global_unique','plan_rights_service_unique')`;
  assert.equal(rightIndexes.length, 2);
  for (const index of rightIndexes) assert.match(index.indexdef, /COALESCE\(period, ''(?:::text)?\)/, `${index.indexname} must distinguish quota periods`);
});

test('client PII endpoints deny by default and ignore caller-supplied role headers', async () => {
  const denied = await app.inject({ method: 'GET', url: '/api/clients', headers: { 'x-2j-role': 'admin' } });
  assert.equal(denied.statusCode, 401);
  assert.equal(denied.headers['cache-control'], 'no-store');
  assert.deepEqual(denied.json(), { error: 'authentication_required' });
  const created = await createClientRequest(clientsAdminApp, { firstName: 'Ada', lastName: `Lovelace ${randomUUID()}`, email: ' ADA@example.test ', phone: ' 555 0100 ' });
  assert.equal(created.statusCode, 201, created.body);
  const clientId = created.json().id;
  const trainer = await clientsTrainerApp.inject({ method: 'GET', url: `/api/clients/${clientId}` });
  assert.equal(trainer.statusCode, 200, trainer.body);
  assert.equal(trainer.json().client.email, 'ada@example.test');
  assert.equal(trainer.json().sections.find((section) => section.id === 'training').access, 'available');
  assert.equal(trainer.json().sections.find((section) => section.id === 'health').access, 'available');
  assert.equal(trainer.json().summary.payments.access, 'forbidden');
  assert.equal(trainer.json().summary.payments.data, null);
  assert.equal(trainer.json().summary.training.access, 'available');
  assert.equal(trainer.json().summary.health.access, 'available');
  assert.equal(trainer.json().summary.plans.access, 'forbidden', 'unknown future domain permissions deny by default');
  assert.equal(trainer.json().summary.documents.access, 'forbidden');
  assert.equal(trainer.json().summary.messages.data, null);
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
    ['PATCH', `/api/clients/${randomUUID()}/archive`],
  ];
  for (const [method, url] of routes) {
    const response = await app.inject({ method, url, headers: { 'x-2j-role': 'admin', 'idempotency-key': randomUUID() }, payload: method === 'POST' ? { firstName: 'No', lastName: 'Session', email: 'private@example.test' } : undefined });
    assert.equal(response.statusCode, 401, `${method} ${url}`);
    assert.equal(response.headers['cache-control'], 'no-store', `${method} ${url}`);
    assert.equal(response.body.includes('private@example.test'), false);
  }
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
  await assert.rejects(sql`TRUNCATE plan_rights`, (error) => error.code === '55000');
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
