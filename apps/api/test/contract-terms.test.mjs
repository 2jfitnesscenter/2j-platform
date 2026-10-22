import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import postgres from 'postgres';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { calculateContractEnd } from '@2j/domain';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { coordinateContractAssignment, ContractAssignmentError } from '../src/contract-assignment-coordinator.ts';
import { assignmentContractTerms, assignmentEntitlementPeriods, clientEntitlementLedger, planRights } from '../src/schema.ts';

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
  const termKind = overrides.termKind ?? null;
  const sessionRight = termKind == null
    ? { rightType: 'sessions_quota', quotaScope: 'shared', quantity: 10 }
    : ['pack','one_off'].includes(termKind)
      ? { rightType: 'sessions_quota', quotaScope: 'shared', quantity: 10, quantityRule: 'fixed_v1' }
      : { rightType: 'sessions_quota', quotaScope: 'shared', weeklyFrequency: 3, quantityRule: 'weekday_ratio_v1' };
  return app.inject({ method: 'POST', url: '/api/plans', headers: { 'idempotency-key': randomUUID() }, payload: {
    name: `F1-A ${randomUUID()}`, serviceIds: [serviceId], kind: 'recurring', renewalCadence: 'monthly',
    rights: [{ rightType: 'service_access', serviceId }, sessionRight], ...overrides,
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
  for (const [start, months, expected] of [['9998-10-15',12,'9999-10-14'],['9999-09-30',3,'9999-12-31']]) {
    const [row] = await sql`SELECT contract_end_v1(${start}::date,${months})::text AS end`;
    assert.equal(row.end, expected);
    assert.equal(row.end, calculateContractEnd(start, months));
  }
  for (const [start, months] of [['9999-10-15',3],['9999-12-31',12]]) {
    assert.throws(() => calculateContractEnd(start, months), RangeError);
    await assert.rejects(sql`SELECT contract_end_v1(${start}::date,${months})`, error => error.code === '22008');
  }
});

test('PostgreSQL plan-version coherence rejects NULL and incompatible fields for every term branch', async () => {
  const service = await createService();
  const cases = [
    { label:'rolling duration NULL', kind:'recurring', cadence:'monthly', termKind:'rolling_months', termMonths:null, maxSpanDays:null, paymentRule:'grace_from_assignment_v1', paymentBlock:'enforce' },
    { label:'rolling payment block NULL', kind:'recurring', cadence:'monthly', termKind:'rolling_months', termMonths:3, maxSpanDays:null, paymentRule:'grace_from_assignment_v1', paymentBlock:null },
    { label:'natural-month payment rule NULL', kind:'recurring', cadence:'monthly', termKind:'natural_month', termMonths:null, maxSpanDays:null, paymentRule:null, paymentBlock:'enforce' },
    { label:'pack incompatible duration', kind:'session_pack', cadence:null, termKind:'pack', termMonths:3, maxSpanDays:null, paymentRule:'on_payment_v1', paymentBlock:'off' },
    { label:'one-off incompatible duration', kind:'session_pack', cadence:null, termKind:'one_off', termMonths:3, maxSpanDays:null, paymentRule:'on_payment_v1', paymentBlock:'off' },
  ];
  for (const item of cases) {
    const plan = await createPlan(service.id);
    assert.equal(plan.statusCode, 201, plan.body);
    const planId = plan.json().id;
    await assert.rejects(sql`INSERT INTO plan_versions(plan_id,version,kind,renewal_cadence,timezone,term_kind,term_months,max_span_days,payment_rule,payment_block)
      VALUES (${planId},2,${item.kind},${item.cadence},'Atlantic/Canary',${item.termKind},${item.termMonths},${item.maxSpanDays},${item.paymentRule},${item.paymentBlock})`,
      error => error.code === '23514' && error.constraint_name === 'plan_versions_contract_metadata_coherent', item.label);
  }
});

test('PostgreSQL assignment-term coherence rejects missing dates and duration across all branches', async () => {
  const service = await createService();
  const plan = await createPlan(service.id, { termKind:'rolling_months', termMonths:3 });
  assert.equal(plan.statusCode, 201, plan.body);
  const clientId = randomUUID(), planId = plan.json().id;
  await sql`INSERT INTO clients(id,first_name,last_name) VALUES (${clientId},'F1A','CHECK fixture')`;
  const cases = [
    { label:'rolling duration NULL', termKind:'rolling_months', start:'2026-10-15', end:'2027-01-14', months:null, rule:'grace_from_assignment_v1', block:'enforce' },
    { label:'rolling start NULL', termKind:'rolling_months', start:null, end:'2027-01-14', months:3, rule:'grace_from_assignment_v1', block:'enforce' },
    { label:'natural-month end NULL', termKind:'natural_month', start:'2026-11-01', end:null, months:null, rule:'monthly_day10_v1', block:'enforce' },
    { label:'custom-range start NULL', termKind:'custom_range', start:null, end:'2026-11-14', months:null, rule:'grace_from_assignment_v1', block:'enforce' },
    { label:'custom-range end NULL', termKind:'custom_range', start:'2026-10-15', end:null, months:null, rule:'grace_from_assignment_v1', block:'enforce' },
    { label:'pack has contract date', termKind:'pack', start:'2026-10-15', end:null, months:null, rule:'on_payment_v1', block:'off' },
    { label:'one-off has contract date', termKind:'one_off', start:'2026-10-15', end:null, months:null, rule:'on_payment_v1', block:'off' },
  ];
  for (const item of cases) {
    const assignmentId = randomUUID(), chargeId = randomUUID(), assigned = '2026-10-15', dueOn = '2026-10-20';
    await sql`INSERT INTO economic_charges(id,client_id,plan_id,concept,amount_cents,due_on,created_by,idempotency_key,request_hash)
      VALUES (${chargeId},${clientId},${planId},'Constraint fixture',1000,${dueOn},'f1a-test',${randomUUID()},${hash})`;
    await sql`INSERT INTO client_plan_assignments(id,client_id,plan_id,plan_version,charge_id,starts_on,ends_on,idempotency_key,request_hash,created_by)
      VALUES (${assignmentId},${clientId},${planId},1,${chargeId},'2026-10-15','2027-01-14',${randomUUID()},${hash},'f1a-test')`;
    const deadline = { rule:item.rule, assignedLocalDate:assigned, inputs:{graceDays:5}, dueOn };
    await assert.rejects(sql.begin(async tx => {
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`INSERT INTO assignment_contract_terms(assignment_id,term_kind,contract_start,contract_end,term_months,payment_rule,payment_block,deadline_computation,assigned_local_date)
        VALUES (${assignmentId},${item.termKind},${item.start},${item.end},${item.months},${item.rule},${item.block},${tx.json(deadline)},${assigned})`;
    }), error => error.code === '23514' && error.constraint_name === 'assignment_contract_terms_dates_coherent', item.label);
  }
});

test('Drizzle and migration share the natural-month calendar shape constraint', async () => {
  const migration = await readFile(new URL('../migrations/0036_contract_terms_dates.sql', import.meta.url), 'utf8');
  const drizzleCheck = getTableConfig(assignmentContractTerms).checks.find(item => item.name === 'assignment_contract_terms_dates_coherent');
  assert.ok(drizzleCheck, 'Drizzle assignment terms must define the coherence check');
  const schemaCheck = new PgDialect().sqlToQuery(drizzleCheck.value).sql.replaceAll('"assignment_contract_terms".', '');
  const migrationStart = migration.indexOf('CONSTRAINT assignment_contract_terms_dates_coherent CHECK (');
  const migrationEnd = migration.indexOf('CONSTRAINT assignment_contract_terms_deadline_assignment CHECK', migrationStart);
  const migrationCheck = migration.slice(migrationStart, migrationEnd);

  assert.notEqual(migrationStart, -1);
  assert.notEqual(migrationEnd, -1);
  const naturalMonthBranch = value => {
    const normalized = value.replaceAll('"', '').replaceAll(/\s+/g, '');
    const start = normalized.indexOf("(term_kind='natural_month'");
    const end = normalized.indexOf("OR(term_kind='custom_range'", start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    return normalized.slice(start, end);
  };
  assert.equal(naturalMonthBranch(schemaCheck), naturalMonthBranch(migrationCheck), 'Drizzle natural_month branch must match migration 0036');
});

test('F1-B quantity and entitlement-period CHECK constraints stay in Drizzle/migration parity',async()=>{
  const migration=await readFile(new URL('../migrations/0037_contract_entitlement_periods_v1.sql',import.meta.url),'utf8');
  const normalize=value=>value.replaceAll(/"[a-z_]+"\./g,'').replaceAll('"','').replaceAll(/\s+/g,'').toLowerCase();
  const expression=(source,name)=>{
    const marker=new RegExp(`(?:ADD\\s+CONSTRAINT|CONSTRAINT)\\s+${name}\\s+CHECK\\s*\\(`,'i').exec(source);
    assert.ok(marker,`migration contains ${name}`);
    const open=source.indexOf('(',marker.index),start=open+1;let depth=1;
    for(let index=start;index<source.length;index++){
      if(source[index]==='(')depth++;
      else if(source[index]===')'&&--depth===0)return source.slice(start,index);
    }
    throw new Error(`unterminated ${name}`);
  };
  const compare=(table,name)=>{
    const check=getTableConfig(table).checks.find(item=>item.name===name);
    assert.ok(check,`Drizzle contains ${name}`);
    const drizzle=new PgDialect().sqlToQuery(check.value).sql;
    assert.equal(normalize(drizzle),normalize(expression(migration,name)),`${name} Drizzle expression matches migration`);
  };
  compare(planRights,'plan_rights_quantity_rule_allowed');
  compare(planRights,'plan_rights_type_fields');
  compare(assignmentEntitlementPeriods,'assignment_entitlement_periods_model');
  assert.ok(getTableConfig(assignmentEntitlementPeriods).indexes.some(item=>item.config.name==='assignment_entitlement_periods_assignment_right_index_unique'));
  assert.ok(getTableConfig(clientEntitlementLedger).indexes.some(item=>item.config.name==='client_entitlement_ledger_period_grant_unique'));
  assert.match(migration,/CREATE UNIQUE INDEX assignment_entitlement_periods_assignment_right_index_unique/);
  assert.match(migration,/CREATE UNIQUE INDEX client_entitlement_ledger_period_grant_unique/);
});

test('natural-month PostgreSQL check accepts real month ends and rejects malformed dates', async () => {
  const service = await createService();
  const plan = await createPlan(service.id);
  assert.equal(plan.statusCode, 201, plan.body);
  const planId = plan.json().id;
  const clientId = randomUUID();
  await sql`INSERT INTO clients(id,first_name,last_name) VALUES (${clientId},'F1A','Natural month fixture')`;
  const cases = [
    { label:'start is not first day', start:'2026-11-02', end:'2026-11-30', valid:false },
    { label:'end crosses month', start:'2026-11-01', end:'2026-12-31', valid:false },
    { label:'end is not final calendar day', start:'2026-11-01', end:'2026-11-29', valid:false },
    { label:'leap February is missing its 29th day', start:'2028-02-01', end:'2028-02-28', valid:false },
    { label:'non-leap February ends on the 28th', start:'2027-02-01', end:'2027-02-28', valid:true },
    { label:'year 2100 February ends on the 28th', start:'2100-02-01', end:'2100-02-28', valid:true },
    { label:'leap February ends on the 29th', start:'2028-02-01', end:'2028-02-29', valid:true },
    { label:'century year 2100 is not leap', start:'2100-02-01', end:'2100-02-29', valid:false },
    { label:'century year 2000 is leap', start:'2000-02-01', end:'2000-02-29', valid:true },
    { label:'year differs despite same month and day', start:'2026-11-01', end:'2027-11-30', valid:false },
  ];

  for (const item of cases) {
    const assignmentId = randomUUID(), chargeId = randomUUID();
    await sql`INSERT INTO economic_charges(id,client_id,plan_id,concept,amount_cents,due_on,created_by,idempotency_key,request_hash)
      VALUES (${chargeId},${clientId},${planId},'Natural month fixture',1000,${item.start},'f1a-test',${randomUUID()},${hash})`;
    await sql`INSERT INTO client_plan_assignments(id,client_id,plan_id,plan_version,charge_id,starts_on,ends_on,idempotency_key,request_hash,created_by)
      VALUES (${assignmentId},${clientId},${planId},1,${chargeId},${item.start},${item.end},${randomUUID()},${hash},'f1a-test')`;
    const deadline = { rule:'monthly_day10_v1', assignedLocalDate:item.start, inputs:{ day:10 }, dueOn:item.start };
    const insert = () => sql.begin(async tx => {
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`INSERT INTO assignment_contract_terms(assignment_id,term_kind,contract_start,contract_end,term_months,payment_rule,payment_block,deadline_computation,assigned_local_date)
        VALUES (${assignmentId},'natural_month',${item.start},${item.end},NULL,'monthly_day10_v1','enforce',${tx.json(deadline)},${item.start})`;
    });
    if (item.valid) await insert();
    else await assert.rejects(insert(), error => error.code === '23514' && error.constraint_name === 'assignment_contract_terms_dates_coherent', item.label);
  }
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

test('term-plan API requires an explicit compatible session quantity modality while legacy payload stays accepted',async()=>{
  const service=await createService();
  const invalidRights=[
    [{rightType:'service_access',serviceId:service.id},{rightType:'sessions_quota',quotaScope:'shared',quantity:12,weeklyFrequency:3}],
    [{rightType:'service_access',serviceId:service.id},{rightType:'sessions_quota',quotaScope:'shared',quantity:12,weeklyFrequency:3,quantityRule:'weekday_ratio_v1'}],
    [{rightType:'service_access',serviceId:service.id},{rightType:'sessions_quota',quotaScope:'shared',quantityRule:'unlimited',weeklyFrequency:1}],
  ];
  for(const rights of invalidRights){
    const rejected=await createPlan(service.id,{termKind:'rolling_months',termMonths:3,rights});
    assert.equal(rejected.statusCode,400,rejected.body);
  }
  const valid=await createPlan(service.id,{termKind:'rolling_months',termMonths:3,rights:[
    {rightType:'service_access',serviceId:service.id},{rightType:'sessions_quota',quotaScope:'shared',weeklyFrequency:3,quantityRule:'weekday_ratio_v1'},
  ]});
  assert.equal(valid.statusCode,201,valid.body);
  assert.equal(valid.json().rights.find(right=>right.rightType==='sessions_quota').quantityRule,'weekday_ratio_v1');
  const legacy=await createPlan(service.id);
  assert.equal(legacy.statusCode,201,legacy.body);
  assert.equal(legacy.json().rights.find(right=>right.rightType==='sessions_quota').quantityRule,null);
});

test('F1-C coordinator atomically creates one charge, frozen terms, and initial bags for supported contract types',async()=>{
  const service=await createService();
  const clientId=randomUUID();
  await sql`INSERT INTO clients(id,first_name,last_name) VALUES (${clientId},'F1-C','Coordinator fixture')`;
  const actor={actorId:'f1c-test-admin',role:'admin'};
  const clock=new Date('2026-10-15T12:00:00Z');
  const cases=[
    {termKind:'natural_month',termMonths:null,maxSpanDays:null,contractStart:'2026-11-01',customRangeEnd:undefined,dueOn:'2026-11-10',contractEnd:'2026-11-30',periods:1},
    {termKind:'custom_range',termMonths:null,maxSpanDays:20,contractStart:'2026-10-15',customRangeEnd:'2026-10-31',dueOn:'2026-10-20',contractEnd:'2026-10-31',periods:1},
    {termKind:'rolling_months',termMonths:3,maxSpanDays:null,contractStart:'2026-10-15',customRangeEnd:undefined,dueOn:'2026-10-20',contractEnd:'2027-01-14',periods:4},
  ];
  for(const item of cases){
    const plan=await createPlan(service.id,{termKind:item.termKind,termMonths:item.termMonths,maxSpanDays:item.maxSpanDays,basePriceCents:5000});
    assert.equal(plan.statusCode,201,plan.body);
    const planId=plan.json().id;
    assert.equal((await app.inject({method:'POST',url:`/api/plans/${planId}/activate`})).statusCode,200);
    const result=await coordinateContractAssignment(sql,{clientId,planId,idempotencyKey:randomUUID(),contractStart:item.contractStart,...(item.customRangeEnd?{customRangeEnd:item.customRangeEnd}:{}),amountCents:5000},actor,clock);
    assert.equal(result.dueOn,item.dueOn);
    assert.equal(result.paymentBlockEffectiveOn,item.termKind==='natural_month'?'2026-11-11':'2026-10-21');
    assert.equal(result.endsOn,item.contractEnd);
    assert.equal(result.periods.length,item.periods);
    const [charge]=await sql`SELECT due_on::text AS due_on,plan_id,amount_cents FROM economic_charges WHERE id=${result.chargeId}`;
    assert.deepEqual({...charge,amount_cents:Number(charge.amount_cents)},{due_on:item.dueOn,plan_id:planId,amount_cents:5000});
    const [terms]=await sql`SELECT term_kind,contract_start::text AS contract_start,contract_end::text AS contract_end,term_months,payment_rule,payment_block,deadline_computation
      FROM assignment_contract_terms WHERE assignment_id=${result.assignmentId}`;
    assert.equal(terms.term_kind,item.termKind);assert.equal(terms.contract_start,item.contractStart);assert.equal(terms.contract_end,item.contractEnd);
    assert.equal(terms.term_months,item.termMonths);assert.equal(terms.payment_rule,item.termKind==='natural_month'?'monthly_day10_v1':'grace_from_assignment_v1');
    assert.equal(terms.deadline_computation.dueOn,item.dueOn);
    assert.equal(terms.deadline_computation.paymentBlockEffectiveOn,result.paymentBlockEffectiveOn);
    const [counts]=await sql`SELECT count(*)::int AS assignment_count,(SELECT count(*)::int FROM economic_charges WHERE id=${result.chargeId}) AS charge_count,
      (SELECT count(*)::int FROM assignment_entitlement_periods WHERE assignment_id=${result.assignmentId}) AS period_count,
      (SELECT count(*)::int FROM client_entitlement_ledger WHERE assignment_id=${result.assignmentId} AND entry_type='grant') AS grant_count
      FROM client_plan_assignments WHERE id=${result.assignmentId}`;
    assert.deepEqual(counts,{assignment_count:1,charge_count:1,period_count:item.periods,grant_count:item.periods});
  }
  const legacySale=await createPlan(service.id);
  assert.equal(legacySale.statusCode,201);
  assert.equal((await app.inject({method:'POST',url:`/api/plans/${legacySale.json().id}/activate`})).statusCode,200);
  const legacyAssignment=await app.inject({method:'POST',url:`/api/clients/${clientId}/plans`,headers:{'idempotency-key':randomUUID()},payload:{planId:legacySale.json().id,startsOn:'2026-10-15',dueOn:'2026-10-20',amountCents:1000}});
  assert.equal(legacyAssignment.statusCode,201,legacyAssignment.body,'existing 098E legacy sale remains unchanged');
});

test('F1-C coordinator serializes same-key retries and rejects changed payload without duplicate ledger facts',async()=>{
  const service=await createService();const plan=await createPlan(service.id,{termKind:'rolling_months',termMonths:3,basePriceCents:5000});
  assert.equal(plan.statusCode,201,plan.body);const planId=plan.json().id;
  assert.equal((await app.inject({method:'POST',url:`/api/plans/${planId}/activate`})).statusCode,200);
  const clientId=randomUUID(),key=randomUUID(),actor={actorId:'f1c-race-admin',role:'admin'},now=new Date('2026-10-15T12:00:00Z');
  await sql`INSERT INTO clients(id,first_name,last_name) VALUES (${clientId},'F1-C','Race fixture')`;
  const input={clientId,planId,idempotencyKey:key,contractStart:'2026-10-15',amountCents:5000};
  await assert.rejects(coordinateContractAssignment(sql,{...input,dueOn:'2026-10-22'},actor,now),
    error=>error instanceof ContractAssignmentError&&error.code==='validation_error','caller-supplied dueOn is rejected; the coordinator is authoritative');
  const results=await Promise.all([coordinateContractAssignment(sql,input,actor,now),coordinateContractAssignment(sql,input,actor,now)]);
  assert.deepEqual(results.map(row=>row.replay).sort(),[false,true]);
  assert.equal(results[0].assignmentId,results[1].assignmentId);assert.equal(results[0].chargeId,results[1].chargeId);
  await assert.rejects(coordinateContractAssignment(sql,{...input,amountCents:5100},actor,now),error=>error instanceof ContractAssignmentError&&error.code==='idempotency_conflict');
  const [counts]=await sql`SELECT count(*)::int AS assignments,(SELECT count(*)::int FROM economic_charges WHERE client_id=${clientId}) AS charges,
    (SELECT count(*)::int FROM assignment_entitlement_periods WHERE assignment_id=${results[0].assignmentId}) AS periods,
    (SELECT count(*)::int FROM client_entitlement_ledger WHERE assignment_id=${results[0].assignmentId} AND entry_type='grant') AS grants
    FROM client_plan_assignments WHERE client_id=${clientId}`;
  assert.deepEqual(counts,{assignments:1,charges:1,periods:4,grants:4});
});

test('F1-C coordinator rolls back the charge and assignment when initial bag materialization fails',async()=>{
  const service=await createService();const plan=await createPlan(service.id,{termKind:'custom_range',maxSpanDays:10,basePriceCents:5000});
  assert.equal(plan.statusCode,201,plan.body);const planId=plan.json().id;
  assert.equal((await app.inject({method:'POST',url:`/api/plans/${planId}/activate`})).statusCode,200);
  const clientId=randomUUID();await sql`INSERT INTO clients(id,first_name,last_name) VALUES (${clientId},'F1-C','Rollback fixture')`;
  const termsBefore=(await sql`SELECT count(*)::int AS count FROM assignment_contract_terms`)[0].count;
  await assert.rejects(coordinateContractAssignment(sql,{clientId,planId,idempotencyKey:randomUUID(),contractStart:'2026-10-17',customRangeEnd:'2026-10-18',amountCents:5000},
    {actorId:'f1c-rollback-admin',role:'admin'},new Date('2026-10-17T12:00:00Z')),
  error=>error instanceof ContractAssignmentError&&error.code==='bag_empty');
  const [counts]=await sql`SELECT (SELECT count(*)::int FROM client_plan_assignments WHERE client_id=${clientId}) AS assignments,
    (SELECT count(*)::int FROM economic_charges WHERE client_id=${clientId}) AS charges,
    (SELECT count(*)::int FROM assignment_contract_terms) AS all_terms,
    (SELECT count(*)::int FROM client_entitlement_ledger WHERE client_id=${clientId}) AS grants`;
  assert.deepEqual(counts,{assignments:0,charges:0,all_terms:termsBefore,grants:0});
});

test('F1-C coordinator enforces entitlement permission server-side',async()=>{
  await assert.rejects(coordinateContractAssignment(sql,{}, {actorId:'trainer-without-sale',role:'trainer'},new Date('2026-10-15T12:00:00Z')),
    error=>error instanceof ContractAssignmentError&&error.code==='permission_denied');
});
