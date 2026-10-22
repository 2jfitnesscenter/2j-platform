import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import postgres from 'postgres';
import { calculateContractEnd } from '@2j/domain';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: contract term integration tests need PostgreSQL.');

const sourceUrl = new URL(process.env.DATABASE_URL);
const databaseName = `f1a_contract_${randomUUID().replaceAll('-', '')}`;
const adminUrl = new URL(sourceUrl); adminUrl.pathname = '/postgres';
const admin = postgres(adminUrl.toString(), { max: 1, connect_timeout: 5 });
await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
const databaseUrl = new URL(sourceUrl); databaseUrl.pathname = `/${databaseName}`;
const dbUrl = databaseUrl.toString();
const sql = postgres(dbUrl, { max: 5, connect_timeout: 5 });
await migrateDatabase(sql);
const app = buildServer(dbUrl, { authorizationResolver: async () => ({ actorId: 'f1a-test-admin', role: 'admin' }) });
const hash = 'a'.repeat(64);
let defaultArea;

async function createService() {
  const response = await app.inject({ method: 'POST', url: '/api/services', payload: { name: `F1-A ${randomUUID()}`, areaId: defaultArea.id, status: 'active' } });
  assert.equal(response.statusCode, 201, response.body);
  return response.json();
}

async function createPlan(serviceId, overrides = {}) {
  return app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': randomUUID() }, payload: {
    name: `F1-A ${randomUUID()}`, serviceIds: [serviceId], kind: 'recurring', renewalCadence: 'monthly',
    rights: [{ rightType: 'service_access', serviceId }], ...overrides,
  } });
}

after(async () => {
  await app.close();
  await sql.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  await admin.end();
});

const [area] = await sql`SELECT id FROM areas WHERE normalized_name='la sala'`;
if (!area) throw new Error('Expected the standard La Sala area in the fresh schema.');
defaultArea = area;

test('SQL contract_end_v1 matches all required examples and domain results for each date in 2026–2031', async () => {
  const examples = [
    ['2026-10-15',3,'2027-01-14'], ['2026-10-01',3,'2026-12-31'], ['2027-01-31',3,'2027-04-30'],
    ['2026-11-30',3,'2027-02-28'], ['2027-11-30',3,'2028-02-29'], ['2026-08-31',6,'2027-02-28'],
    ['2027-08-31',6,'2028-02-29'], ['2026-10-15',6,'2027-04-14'], ['2026-10-15',12,'2027-10-14'],
    ['2027-02-28',12,'2028-02-29'], ['2026-11-29',3,'2027-02-27'],
  ];
  for (const [start, months, end] of examples) {
    const [row] = await sql`SELECT contract_end_v1(${start}::date,${months})::text AS end`;
    assert.equal(row.end, end);
  }
  const results = await sql`SELECT starts.start_date::text AS start,terms.months,contract_end_v1(starts.start_date,terms.months)::text AS end
    FROM generate_series(0,DATE '2031-12-31'-DATE '2026-01-01') AS day_offset
    CROSS JOIN LATERAL (SELECT DATE '2026-01-01'+day_offset AS start_date) starts
    CROSS JOIN unnest(ARRAY[3,6,12]::integer[]) AS terms(months)
    ORDER BY starts.start_date,terms.months`;
  assert.equal(results.length, 2191 * 3);
  for (const row of results) assert.equal(row.end, calculateContractEnd(row.start, row.months), `${row.start} + ${row.months} months`);
});

test('plan contract metadata is additive and assignment terms are immutable, verified snapshots', async () => {
  const service = await createService();
  const legacy = await createPlan(service.id);
  assert.equal(legacy.statusCode, 201, legacy.body);
  const [legacyVersion] = await sql`SELECT term_kind AS "termKind",term_months AS "termMonths",max_span_days AS "maxSpanDays",payment_rule AS "paymentRule",payment_block AS "paymentBlock" FROM plan_versions WHERE plan_id=${legacy.json().id} AND version=1`;
  assert.deepEqual(legacyVersion, { termKind:null, termMonths:null, maxSpanDays:null, paymentRule:null, paymentBlock:null });

  const contract = await createPlan(service.id, { termKind:'rolling_months', termMonths:3 });
  assert.equal(contract.statusCode, 201, contract.body);
  const planId = contract.json().id;
  const [version] = await sql`SELECT term_kind AS "termKind",term_months AS "termMonths",max_span_days AS "maxSpanDays",payment_rule AS "paymentRule",payment_block AS "paymentBlock" FROM plan_versions WHERE plan_id=${planId} AND version=1`;
  assert.deepEqual(version, { termKind:'rolling_months', termMonths:3, maxSpanDays:null, paymentRule:'grace_from_assignment_v1', paymentBlock:'enforce' });
  const invalid = await createPlan(service.id, { termKind:'rolling_months', termMonths:4 });
  assert.equal(invalid.statusCode, 400);
  assert.equal((await app.inject({ method:'POST', url:`/api/plans/${planId}/activate` })).statusCode, 200);
  const assignable = (await app.inject({ method:'GET', url:'/api/plans/assignable' })).json();
  assert.equal(assignable.some(plan => plan.id === planId), false, 'F1-A contract plans remain unavailable to assignment until a later phase');

  const clientId = randomUUID();
  await sql`INSERT INTO clients(id,first_name,last_name) VALUES (${clientId},'F1A','Synthetic fixture')`;
  const blockedSale = await app.inject({ method:'POST', url:`/api/clients/${clientId}/plans`, headers:{'idempotency-key':randomUUID()}, payload:{planId,startsOn:'2026-10-15',endsOn:'2027-01-14',dueOn:'2026-10-20',amountCents:1000} });
  assert.equal(blockedSale.statusCode, 409);
  assert.equal(blockedSale.json().error, 'contract_terms_not_available');
  assert.equal((await sql`SELECT count(*)::int AS count FROM economic_charges WHERE client_id=${clientId}`)[0].count, 0);

  const chargeId = randomUUID(), assignmentId = randomUUID();
  await sql.begin(async tx => {
    await tx`INSERT INTO economic_charges(id,client_id,plan_id,concept,amount_cents,due_on,created_by,idempotency_key,request_hash) VALUES (${chargeId},${clientId},${planId},'Contract test',1000,'2026-10-20','f1a-test',${randomUUID()},${hash})`;
    await tx`INSERT INTO client_plan_assignments(id,client_id,plan_id,plan_version,charge_id,starts_on,ends_on,idempotency_key,request_hash,created_by) VALUES (${assignmentId},${clientId},${planId},1,${chargeId},'2026-10-15','2027-01-14',${randomUUID()},${hash},'f1a-test')`;
  });
  const deadline = { rule:'grace_from_assignment_v1', assignedLocalDate:'2026-10-15', inputs:{graceDays:5}, dueOn:'2026-10-20' };
  await sql`INSERT INTO assignment_contract_terms(assignment_id,term_kind,contract_start,contract_end,term_months,payment_rule,payment_block,deadline_computation,assigned_local_date)
    VALUES (${assignmentId},'rolling_months','2026-10-15','2027-01-14',3,'grace_from_assignment_v1','enforce',${sql.json(deadline)},'2026-10-15')`;
  assert.equal((await sql`SELECT count(*)::int AS count FROM assignment_contract_terms WHERE assignment_id=${assignmentId}`)[0].count, 1);
  await assert.rejects(sql`UPDATE assignment_contract_terms SET contract_end='2027-02-27' WHERE assignment_id=${assignmentId}`, { code:'55000' });
  await assert.rejects(sql`DELETE FROM assignment_contract_terms WHERE assignment_id=${assignmentId}`, { code:'55000' });
  await assert.rejects(sql`TRUNCATE assignment_contract_terms`, { code:'55000' });

  const custom = await createPlan(service.id, { termKind:'custom_range', maxSpanDays:30 });
  assert.equal(custom.statusCode, 201, custom.body);
  const customPlanId = custom.json().id;
  assert.equal((await app.inject({ method:'POST', url:`/api/plans/${customPlanId}/activate` })).statusCode, 200);
  const customChargeId = randomUUID(), customAssignmentId = randomUUID();
  await sql.begin(async tx => {
    await tx`INSERT INTO economic_charges(id,client_id,plan_id,concept,amount_cents,due_on,created_by,idempotency_key,request_hash) VALUES (${customChargeId},${clientId},${customPlanId},'Custom range test',1000,'2026-10-20','f1a-test',${randomUUID()},${hash})`;
    await tx`INSERT INTO client_plan_assignments(id,client_id,plan_id,plan_version,charge_id,starts_on,ends_on,idempotency_key,request_hash,created_by) VALUES (${customAssignmentId},${clientId},${customPlanId},1,${customChargeId},'2026-10-15','2026-11-14',${randomUUID()},${hash},'f1a-test')`;
  });
  await assert.rejects(sql`INSERT INTO assignment_contract_terms(assignment_id,term_kind,contract_start,contract_end,term_months,payment_rule,payment_block,deadline_computation,assigned_local_date)
    VALUES (${customAssignmentId},'custom_range','2026-10-15','2026-11-14',NULL,'grace_from_assignment_v1','enforce',${sql.json(deadline)},'2026-10-15')`, { code:'23514' }, '31 inclusive days exceeds max_span_days=30');

  const badChargeId = randomUUID(), badAssignmentId = randomUUID();
  await sql.begin(async tx => {
    await tx`INSERT INTO economic_charges(id,client_id,plan_id,concept,amount_cents,due_on,created_by,idempotency_key,request_hash) VALUES (${badChargeId},${clientId},${planId},'Invalid contract test',1000,'2026-10-20','f1a-test',${randomUUID()},${hash})`;
    await tx`INSERT INTO client_plan_assignments(id,client_id,plan_id,plan_version,charge_id,starts_on,ends_on,idempotency_key,request_hash,created_by) VALUES (${badAssignmentId},${clientId},${planId},1,${badChargeId},'2026-10-15','2027-01-14',${randomUUID()},${hash},'f1a-test')`;
  });
  await assert.rejects(sql`INSERT INTO assignment_contract_terms(assignment_id,term_kind,contract_start,contract_end,term_months,payment_rule,payment_block,deadline_computation,assigned_local_date)
    VALUES (${badAssignmentId},'rolling_months','2026-10-15','2027-01-15',3,'grace_from_assignment_v1','enforce',${sql.json(deadline)},'2026-10-15')`, { code:'23514' });
});
