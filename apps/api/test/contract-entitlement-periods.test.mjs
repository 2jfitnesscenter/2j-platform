import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { materializeContractEntitlementPeriods } from '../src/assignment-periods.ts';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: F1-B integration tests need disposable PostgreSQL.');

const sourceUrl = new URL(process.env.DATABASE_URL);
const databaseName = `f1b_periods_${randomUUID().replaceAll('-', '')}`;
const adminUrl = new URL(sourceUrl); adminUrl.pathname = '/postgres';
const admin = postgres(adminUrl.toString(), { max: 1, connect_timeout: 5 });
await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
const databaseUrl = new URL(sourceUrl); databaseUrl.pathname = `/${databaseName}`;
const dbUrl = databaseUrl.toString();
const sql = postgres(dbUrl, { max: 10, connect_timeout: 5 });
await migrateDatabase(sql);
const app = buildServer(dbUrl, { authorizationResolver: async () => ({ actorId: 'f1b-test-admin', role: 'admin' }) });
const checksum = 'b'.repeat(64);
const [area] = await sql`SELECT id FROM areas WHERE normalized_name='la sala'`;
if (!area) throw new Error('La Sala fixture area is missing.');
const serviceResponse = await app.inject({ method:'POST',url:'/api/services',payload:{name:`F1-B ${randomUUID()}`,areaId:area.id,status:'active'} });
assert.equal(serviceResponse.statusCode,201,serviceResponse.body);
const serviceId = serviceResponse.json().id;

after(async () => {
  await app.close();
  await sql.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  await admin.end();
});

async function createContract({termKind='rolling_months',termMonths=3,start='2026-10-15',end='2027-01-14',frequency=3,unlimited=false,pack=false,oneOff=false}={}) {
  const kind = pack || oneOff ? 'session_pack' : 'recurring';
  const actualTerm = pack ? 'pack' : oneOff ? 'one_off' : termKind;
  const quota = unlimited
    ? {rightType:'sessions_quota',quotaScope:'shared',quantityRule:'unlimited'}
    : pack || oneOff
      ? {rightType:'sessions_quota',quotaScope:'shared',quantity:8,quantityRule:'fixed_v1'}
      : {rightType:'sessions_quota',quotaScope:'shared',weeklyFrequency:frequency,quantityRule:'weekday_ratio_v1'};
  const response = await app.inject({method:'POST',url:'/api/plans',headers:{'idempotency-key':randomUUID()},payload:{
    name:`F1-B ${randomUUID()}`,serviceIds:[serviceId],kind,renewalCadence:kind==='recurring'?'monthly':null,
    termKind:actualTerm,termMonths:actualTerm==='rolling_months'?termMonths:null,
    rights:[{rightType:'service_access',serviceId},quota],
  }});
  assert.equal(response.statusCode,201,response.body);
  const planId=response.json().id;
  assert.equal((await app.inject({method:'POST',url:`/api/plans/${planId}/activate`})).statusCode,200);
  const clientId=randomUUID(),assignmentId=randomUUID(),chargeId=randomUUID();
  await sql`INSERT INTO clients(id,first_name,last_name) VALUES (${clientId},'F1-B','Synthetic')`;
  const dueOn=start??'2026-10-15';
  await sql.begin(async tx=>{
    await tx`INSERT INTO economic_charges(id,client_id,plan_id,concept,amount_cents,due_on,created_by,idempotency_key,request_hash)
      VALUES (${chargeId},${clientId},${planId},'Synthetic F1-B charge',1000,${dueOn},'f1b-test',${randomUUID()},${checksum})`;
    await tx`INSERT INTO client_plan_assignments(id,client_id,plan_id,plan_version,charge_id,starts_on,ends_on,idempotency_key,request_hash,created_by)
      VALUES (${assignmentId},${clientId},${planId},1,${chargeId},${start??'2026-10-15'},${end},${randomUUID()},${checksum},'f1b-test')`;
  });
  const rule=actualTerm==='natural_month'?'monthly_day10_v1':actualTerm==='pack'||actualTerm==='one_off'?'on_payment_v1':'grace_from_assignment_v1';
  const assigned=start??'2026-10-15';
  const deadline={rule,assignedLocalDate:assigned,inputs:{graceDays:5},dueOn};
  await sql`INSERT INTO assignment_contract_terms(assignment_id,term_kind,contract_start,contract_end,term_months,payment_rule,payment_block,deadline_computation,assigned_local_date)
    VALUES (${assignmentId},${actualTerm},${start},${end},${actualTerm==='rolling_months'?termMonths:null},${rule},${actualTerm==='pack'||actualTerm==='one_off'?'off':'enforce'},${sql.json(deadline)},${assigned})`;
  const [right]=await sql`SELECT id FROM plan_rights WHERE plan_id=${planId} AND right_type='sessions_quota'`;
  return {planId,clientId,assignmentId,chargeId,rightId:right.id,termKind:actualTerm};
}

async function materialize(assignmentId) {
  return sql.begin(tx=>materializeContractEntitlementPeriods(tx,assignmentId,'f1b-test-admin'));
}

async function createSiblingAssignment(source,{sameClient=false}={}) {
  const clientId=sameClient?source.clientId:randomUUID(),assignmentId=randomUUID(),chargeId=randomUUID();
  if(!sameClient)await sql`INSERT INTO clients(id,first_name,last_name) VALUES (${clientId},'F1-B sibling','Synthetic')`;
  await sql.begin(async tx=>{
    await tx`INSERT INTO economic_charges(id,client_id,plan_id,concept,amount_cents,due_on,created_by,idempotency_key,request_hash)
      SELECT ${chargeId},${clientId},plan_id,'Synthetic F1-B sibling charge',1000,due_on,'f1b-test',${randomUUID()},${checksum}
      FROM economic_charges WHERE id=${source.chargeId}`;
    await tx`INSERT INTO client_plan_assignments(id,client_id,plan_id,plan_version,charge_id,starts_on,ends_on,idempotency_key,request_hash,created_by)
      SELECT ${assignmentId},${clientId},plan_id,plan_version,${chargeId},starts_on,ends_on,${randomUUID()},${checksum},'f1b-test'
      FROM client_plan_assignments WHERE id=${source.assignmentId}`;
    await tx`INSERT INTO assignment_contract_terms(assignment_id,term_kind,contract_start,contract_end,term_months,payment_rule,payment_block,deadline_computation,assigned_local_date)
      SELECT ${assignmentId},term_kind,contract_start,contract_end,term_months,payment_rule,payment_block,deadline_computation,assigned_local_date
      FROM assignment_contract_terms WHERE assignment_id=${source.assignmentId}`;
  });
  return {...source,clientId,assignmentId,chargeId};
}

function hash(value){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}

async function insertDirectQuotaPeriod(tx,fixture,{periodId=randomUUID(),periodIndex=0,start='2026-10-15',end='2026-10-31',frequency=3,rightId=fixture.rightId,assignmentId=fixture.assignmentId,clientId=fixture.clientId}={}){
  return tx`INSERT INTO assignment_entitlement_periods(id,assignment_id,client_id,right_id,period_index,entitlement_mode,formula_id,period_start,period_end,weekdays_in_period,weekly_frequency,sessions_granted,sessions_snapshot,snapshot,idempotency_key,request_hash)
    VALUES (${periodId},${assignmentId},${clientId},${rightId},${periodIndex},'quota','weekday_ratio_v1',${start},${end},entitlement_weekdays(${start}::date,${end}::date),${frequency},
      entitlement_sessions_v1(entitlement_weekdays(${start}::date,${end}::date),${frequency}),NULL,'{}'::jsonb,${randomUUID()},${'a'.repeat(64)}) RETURNING id`;
}

function deterministicUuid(value){
  const bytes=createHash('sha256').update(value).digest().subarray(0,16);
  bytes[6]=(bytes[6]&0x0f)|0x40;bytes[8]=(bytes[8]&0x3f)|0x80;
  const hex=bytes.toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

test('natural month creates one frozen quota bag and one matching period-scoped grant', async()=>{
  const fixture=await createContract({termKind:'natural_month',termMonths:null,start:'2026-11-01',end:'2026-11-30'});
  const result=await materialize(fixture.assignmentId);
  assert.equal(result.periods.length,1);
  const [period]=await sql`SELECT period_start::text AS start,period_end::text AS end,period_index AS "periodIndex",entitlement_mode AS mode,formula_id AS formula,
    weekdays_in_period AS weekdays,weekly_frequency AS frequency,sessions_granted AS granted,sessions_snapshot AS "legacySnapshot",snapshot FROM assignment_entitlement_periods WHERE assignment_id=${fixture.assignmentId}`;
  assert.equal(period.start,'2026-11-01');assert.equal(period.end,'2026-11-30');assert.equal(period.periodIndex,0);
  assert.equal(period.mode,'quota');assert.equal(period.formula,'weekday_ratio_v1');assert.equal(period.weekdays,21);
  assert.equal(period.frequency,3);assert.equal(period.granted,13);assert.equal(period.legacySnapshot,null);
  assert.equal(period.snapshot.sessionsGranted,13);
  assert.equal(period.snapshot.contract.termKind,'natural_month');assert.equal(period.snapshot.contract.contractStart,'2026-11-01');
  assert.equal(period.snapshot.right.quantityRule,'weekday_ratio_v1');assert.equal(period.snapshot.right.weeklyFrequency,3);
  assert.equal((await sql`SELECT quantity FROM client_entitlement_ledger WHERE assignment_id=${fixture.assignmentId} AND entry_type='grant'`)[0].quantity,13);
});

test('custom cross-month range splits into two independent quota bags',async()=>{
  const fixture=await createContract({termKind:'custom_range',termMonths:null,start:'2026-10-15',end:'2026-11-14'});
  await materialize(fixture.assignmentId);
  const periods=await sql`SELECT period_index AS i,period_start::text AS start,period_end::text AS end,weekdays_in_period AS weekdays,sessions_granted AS granted FROM assignment_entitlement_periods WHERE assignment_id=${fixture.assignmentId} ORDER BY period_index`;
  assert.deepEqual(Array.from(periods,row=>({...row})),[{i:0,start:'2026-10-15',end:'2026-10-31',weekdays:12,granted:7},{i:1,start:'2026-11-01',end:'2026-11-14',weekdays:10,granted:6}]);
  assert.equal((await sql`SELECT count(DISTINCT entitlement_period_id)::int AS count FROM client_entitlement_ledger WHERE assignment_id=${fixture.assignmentId} AND entry_type='grant'`)[0].count,2);
});

test('rolling 3, 6 and 12 month terms split into monthly bags, never a shared contract balance',async()=>{
  const cases=[
    {months:3,end:'2027-01-14',expected:[7,13,14,6]},
    {months:6,end:'2027-04-14',expected:null},
    {months:12,end:'2027-10-14',expected:null},
  ];
  for(const item of cases){
    const fixture=await createContract({termKind:'rolling_months',termMonths:item.months,start:'2026-10-15',end:item.end});
    await materialize(fixture.assignmentId);
    const rows=await sql`SELECT period_index AS i,sessions_granted AS granted FROM assignment_entitlement_periods WHERE assignment_id=${fixture.assignmentId} ORDER BY period_index`;
    assert.equal(rows.length,item.months===3?4:item.months===6?7:13);
    if(item.expected)assert.deepEqual(rows.map(row=>row.granted),item.expected);
    assert.equal((await sql`SELECT count(DISTINCT entitlement_period_id)::int AS count FROM client_entitlement_ledger WHERE assignment_id=${fixture.assignmentId} AND entry_type='grant'`)[0].count,rows.length);
    if(item.months===3)assert.equal(rows.reduce((sum,row)=>sum+row.granted,0),40,'40 is only a display sum; each balance remains period-scoped');
  }
});

test('unlimited is one whole-contract period with no numerical bag and no grant',async()=>{
  const fixture=await createContract({termKind:'rolling_months',termMonths:3,start:'2026-10-15',end:'2027-01-14',unlimited:true});
  await materialize(fixture.assignmentId);
  const [period]=await sql`SELECT period_start::text AS start,period_end::text AS end,entitlement_mode AS mode,formula_id AS formula,weekdays_in_period AS weekdays,weekly_frequency AS frequency,sessions_granted AS granted,sessions_snapshot AS "legacySnapshot" FROM assignment_entitlement_periods WHERE assignment_id=${fixture.assignmentId}`;
  assert.equal(period.start,'2026-10-15');assert.equal(period.end,'2027-01-14');assert.equal(period.mode,'unlimited');
  assert.equal(period.formula,null);assert.equal(period.weekdays,null);assert.equal(period.frequency,null);assert.equal(period.granted,null);assert.equal(period.legacySnapshot,null);
  assert.equal((await sql`SELECT count(*)::int AS count FROM client_entitlement_ledger WHERE assignment_id=${fixture.assignmentId} AND entry_type='grant'`)[0].count,0);
});

test('zero weekday-ratio bag rejects atomically without periods or grants',async()=>{
  const fixture=await createContract({termKind:'custom_range',termMonths:null,start:'2026-10-17',end:'2026-10-18',frequency:1});
  await assert.rejects(materialize(fixture.assignmentId),error=>error.code==='bag_empty');
  assert.equal((await sql`SELECT count(*)::int AS count FROM assignment_entitlement_periods WHERE assignment_id=${fixture.assignmentId}`)[0].count,0);
  assert.equal((await sql`SELECT count(*)::int AS count FROM client_entitlement_ledger WHERE assignment_id=${fixture.assignmentId}`)[0].count,0);
});

test('materialization retry and concurrent retry preserve the same periods and grants',async()=>{
  const fixture=await createContract({termKind:'rolling_months',termMonths:3,start:'2026-10-15',end:'2027-01-14'});
  const [first,replay]=await Promise.all([materialize(fixture.assignmentId),materialize(fixture.assignmentId)]);
  assert.equal(first.periods.length,4);assert.equal(replay.periods.length,4);
  const retry=await materialize(fixture.assignmentId);assert.equal(retry.replay,true);
  assert.equal((await sql`SELECT count(*)::int AS count FROM assignment_entitlement_periods WHERE assignment_id=${fixture.assignmentId}`)[0].count,4);
  assert.equal((await sql`SELECT count(*)::int AS count FROM client_entitlement_ledger WHERE assignment_id=${fixture.assignmentId} AND entry_type='grant'`)[0].count,4);
});

test('same commercial facts on different assignments create isolated periods and grants concurrently',async()=>{
  const first=await createContract({termKind:'rolling_months',termMonths:3,start:'2026-10-15',end:'2027-01-14'});
  const second=await createSiblingAssignment(first);
  const [a,b]=await Promise.all([materialize(first.assignmentId),materialize(second.assignmentId)]);
  const rows=await sql`SELECT assignment_id AS assignment, id, idempotency_key AS key FROM assignment_entitlement_periods
    WHERE assignment_id IN (${first.assignmentId},${second.assignmentId}) ORDER BY assignment_id,period_index`;
  assert.equal(rows.length,8);
  assert.equal(new Set(rows.map(row=>row.id)).size,8);
  assert.equal(new Set(rows.map(row=>row.key)).size,8);
  assert.equal(a.replay,false);assert.equal(b.replay,false);
  const grants=await sql`SELECT assignment_id AS assignment,entitlement_period_id AS period FROM client_entitlement_ledger
    WHERE assignment_id IN (${first.assignmentId},${second.assignmentId}) AND entry_type='grant'`;
  assert.equal(grants.length,8);
  const periodOwners=new Map(rows.map(row=>[row.id,row.assignment]));
  assert.ok(grants.every(grant=>periodOwners.get(grant.period)===grant.assignment));
});

test('same-key adversarial period owned by another assignment is rejected without cross-assignment state',async()=>{
  const first=await createContract({termKind:'rolling_months',termMonths:3,start:'2026-10-15',end:'2027-01-14',unlimited:true});
  const second=await createSiblingAssignment(first);
  const [assignment]=await sql`SELECT a.id,a.client_id AS "clientId",a.plan_id AS "planId",a.plan_version AS "planVersion"
    FROM client_plan_assignments a WHERE a.id=${second.assignmentId}`;
  const [terms]=await sql`SELECT term_kind AS "termKind",contract_start::text AS "contractStart",contract_end::text AS "contractEnd",term_months AS "termMonths",payment_rule AS "paymentRule",payment_block AS "paymentBlock"
    FROM assignment_contract_terms WHERE assignment_id=${second.assignmentId}`;
  const [right]=await sql`SELECT id,right_type AS "rightType",service_id AS "serviceId",quota_scope AS "quotaScope",quantity,weekly_frequency AS "weeklyFrequency",quantity_rule AS "quantityRule",valid_days AS "validDays",valid_days_start_rule AS "validDaysStartRule"
    FROM plan_rights WHERE id=${first.rightId}`;
  const contract={termKind:terms.termKind,termMonths:terms.termMonths,contractStart:terms.contractStart,contractEnd:terms.contractEnd,paymentRule:terms.paymentRule,paymentBlock:terms.paymentBlock};
  const snapshot={version:1,planId:assignment.planId,planVersion:assignment.planVersion,contract,right:{id:right.id,rightType:right.rightType,quantityRule:'unlimited',quantity:right.quantity,weeklyFrequency:right.weeklyFrequency,quotaScope:right.quotaScope,serviceId:right.serviceId,validDays:right.validDays,validDaysStartRule:right.validDaysStartRule},entitlementMode:'unlimited',periodIndex:0,periodStart:terms.contractStart,periodEnd:terms.contractEnd};
  const requestHash=hash({assignmentId:second.assignmentId,clientId:second.clientId,planId:first.planId,planVersion:1,rightId:first.rightId,periodIndex:0,entitlementMode:'unlimited',formulaId:null,periodStart:terms.contractStart,periodEnd:terms.contractEnd,weekdaysInPeriod:null,weeklyFrequency:null,sessionsGranted:null,contract,snapshot});
  const key=deterministicUuid(`term-period:${second.assignmentId}:${first.rightId}:0`),periodId=randomUUID();
  await sql`INSERT INTO assignment_entitlement_periods(id,assignment_id,client_id,right_id,period_index,entitlement_mode,formula_id,period_start,period_end,weekdays_in_period,weekly_frequency,sessions_granted,sessions_snapshot,snapshot,idempotency_key,request_hash)
    VALUES (${periodId},${first.assignmentId},${first.clientId},${first.rightId},0,'unlimited',NULL,'2026-10-15','2027-01-14',NULL,NULL,NULL,NULL,${sql.json(snapshot)},${key},${requestHash})`;
  await assert.rejects(materialize(second.assignmentId),error=>error.code==='idempotency_conflict');
  assert.equal((await sql`SELECT count(*)::int AS count FROM assignment_entitlement_periods WHERE assignment_id=${second.assignmentId}`).at(0).count,0);
  assert.equal((await sql`SELECT count(*)::int AS count FROM client_entitlement_ledger WHERE assignment_id=${second.assignmentId}`).at(0).count,0);
  assert.equal((await sql`SELECT count(*)::int AS count FROM assignment_entitlement_periods WHERE id=${periodId} AND assignment_id=${first.assignmentId}`).at(0).count,1);
});

test('PostgreSQL rejects malformed direct quota period inserts for contract facts and plan ownership',async()=>{
  const invalid=[
    ['outside contract start',{start:'2026-10-14'}],
    ['outside contract end',{start:'2027-01-01',end:'2027-01-15',periodIndex:3}],
    ['wrong period index',{periodIndex:1}],
    ['wrong first-period start',{start:'2026-10-01'}],
    ['later period not starting on day one',{periodIndex:1,start:'2026-11-02',end:'2026-11-30'}],
    ['wrong period end',{end:'2026-10-30'}],
    ['wrong weekly frequency',{frequency:2}],
  ];
  for(const [label,overrides] of invalid){
    const fixture=await createContract();
    await assert.rejects(sql.begin(tx=>insertDirectQuotaPeriod(tx,fixture,overrides)),error=>error.code==='23514',label);
  }
  const owner=await createContract();const unrelated=await createContract();
  await assert.rejects(sql.begin(tx=>insertDirectQuotaPeriod(tx,owner,{rightId:unrelated.rightId})),error=>error.code==='23514','right from another plan/version is rejected');
});

test('grant idempotency collision with another assignment is rejected without accepting its grant',async()=>{
  const first=await createContract(),second=await createSiblingAssignment(first,{sameClient:true});
  const [assignment]=await sql`SELECT id,client_id AS "clientId",plan_id AS "planId",plan_version AS "planVersion" FROM client_plan_assignments WHERE id=${second.assignmentId}`;
  const [terms]=await sql`SELECT term_kind AS "termKind",contract_start::text AS "contractStart",contract_end::text AS "contractEnd",term_months AS "termMonths",payment_rule AS "paymentRule",payment_block AS "paymentBlock" FROM assignment_contract_terms WHERE assignment_id=${second.assignmentId}`;
  const [right]=await sql`SELECT id,right_type AS "rightType",service_id AS "serviceId",quota_scope AS "quotaScope",quantity,weekly_frequency AS "weeklyFrequency",quantity_rule AS "quantityRule",valid_days AS "validDays",valid_days_start_rule AS "validDaysStartRule" FROM plan_rights WHERE id=${first.rightId}`;
  const periodId=randomUUID(),periodKey=deterministicUuid(`term-period:${second.assignmentId}:${first.rightId}:0`);
  const contract={termKind:terms.termKind,termMonths:terms.termMonths,contractStart:terms.contractStart,contractEnd:terms.contractEnd,paymentRule:terms.paymentRule,paymentBlock:terms.paymentBlock};
  const candidate={version:1,planId:assignment.planId,planVersion:assignment.planVersion,contract,right:{id:right.id,rightType:right.rightType,quantityRule:'weekday_ratio_v1',quantity:right.quantity,weeklyFrequency:Number(right.weeklyFrequency),quotaScope:right.quotaScope,serviceId:right.serviceId,validDays:right.validDays,validDaysStartRule:right.validDaysStartRule},formulaId:'weekday_ratio_v1',entitlementMode:'quota',periodIndex:0,periodStart:'2026-10-15',periodEnd:'2026-10-31',weekdaysInPeriod:12,sessionsGranted:7};
  const periodHash=hash({assignmentId:second.assignmentId,clientId:second.clientId,planId:first.planId,planVersion:1,rightId:first.rightId,periodIndex:0,entitlementMode:'quota',formulaId:'weekday_ratio_v1',periodStart:'2026-10-15',periodEnd:'2026-10-31',weekdaysInPeriod:12,weeklyFrequency:3,sessionsGranted:7,contract,snapshot:candidate});
  const secondGrantKey=deterministicUuid(`term-grant:${second.assignmentId}:${periodId}:${first.rightId}`);
  const firstPeriodId=randomUUID();
  await sql.begin(async tx=>{
    await tx`INSERT INTO assignment_entitlement_periods(id,assignment_id,client_id,right_id,period_index,entitlement_mode,formula_id,period_start,period_end,weekdays_in_period,weekly_frequency,sessions_granted,sessions_snapshot,snapshot,idempotency_key,request_hash)
      VALUES (${periodId},${second.assignmentId},${second.clientId},${first.rightId},0,'quota','weekday_ratio_v1','2026-10-15','2026-10-31',12,3,7,NULL,${tx.json(candidate)},${periodKey},${periodHash})`;
    await insertDirectQuotaPeriod(tx,first,{periodId:firstPeriodId});
    await tx`INSERT INTO client_entitlement_ledger(client_id,assignment_id,right_key,entry_type,quantity,reason,actor_id,idempotency_key,request_hash,entitlement_period_id)
      VALUES (${first.clientId},${first.assignmentId},${first.rightId},'grant',7,'Grant with colliding sibling key','f1b-test',${secondGrantKey},${'8'.repeat(64)},${firstPeriodId}),
        (${second.clientId},${second.assignmentId},${second.rightId},'grant',7,'Pre-existing conflicting grant','f1b-test',${randomUUID()},${'9'.repeat(64)},${periodId})`;
  });
  await assert.rejects(materialize(second.assignmentId),error=>error.code==='idempotency_conflict');
  assert.equal((await sql`SELECT count(*)::int AS count FROM client_entitlement_ledger WHERE assignment_id=${second.assignmentId} AND entitlement_period_id=${periodId} AND entry_type='grant'`)[0].count,1,'the materializer must not accept or duplicate the pre-existing grant');
  assert.equal((await sql`SELECT count(*)::int AS count FROM client_entitlement_ledger WHERE assignment_id=${first.assignmentId} AND entitlement_period_id=${firstPeriodId} AND idempotency_key=${secondGrantKey}`)[0].count,1,'the colliding key remains owned by the original assignment');
});

test('deferred quota grant invariant rejects commit without a matching grant and rolls back period',async()=>{
  const fixture=await createContract();const periodId=randomUUID();
  await assert.rejects(sql.begin(async tx=>{await insertDirectQuotaPeriod(tx,fixture,{periodId});}),error=>error.code==='23514'&&/requires its frozen bag grant/.test(error.message));
  assert.equal((await sql`SELECT count(*)::int AS count FROM assignment_entitlement_periods WHERE id=${periodId}`)[0].count,0);
});

test('quota grant guards reject wrong amount, wrong right, duplicate and unlimited grants',async()=>{
  const amountFixture=await createContract();
  const amountPeriodId=randomUUID();
  await assert.rejects(sql.begin(async tx=>{
    await insertDirectQuotaPeriod(tx,amountFixture,{periodId:amountPeriodId});
    await tx`INSERT INTO client_entitlement_ledger(client_id,assignment_id,right_key,entry_type,quantity,reason,actor_id,idempotency_key,request_hash,entitlement_period_id)
      VALUES (${amountFixture.clientId},${amountFixture.assignmentId},${amountFixture.rightId},'grant',12,'Wrong frozen amount','f1b-test',${randomUUID()},${'b'.repeat(64)},${amountPeriodId})`;
  }),error=>error.code==='23514'&&/must equal its frozen quota bag/.test(error.message));
  assert.equal((await sql`SELECT count(*)::int AS count FROM assignment_entitlement_periods WHERE id=${amountPeriodId}`)[0].count,0);

  const rightFixture=await createContract();const rightPeriodId=randomUUID();
  await assert.rejects(sql.begin(async tx=>{
    await insertDirectQuotaPeriod(tx,rightFixture,{periodId:rightPeriodId});
    await tx`INSERT INTO client_entitlement_ledger(client_id,assignment_id,right_key,entry_type,quantity,reason,actor_id,idempotency_key,request_hash,entitlement_period_id)
      VALUES (${rightFixture.clientId},${rightFixture.assignmentId},'wrong-right','grant',7,'Wrong right','f1b-test',${randomUUID()},${'c'.repeat(64)},${rightPeriodId})`;
  }),error=>error.code==='23514'&&/ledger right does not match entitlement period/.test(error.message));

  const duplicateFixture=await createContract();const duplicatePeriodId=randomUUID();
  await assert.rejects(sql.begin(async tx=>{
    await insertDirectQuotaPeriod(tx,duplicateFixture,{periodId:duplicatePeriodId});
    for(const key of [randomUUID(),randomUUID()]) await tx`INSERT INTO client_entitlement_ledger(client_id,assignment_id,right_key,entry_type,quantity,reason,actor_id,idempotency_key,request_hash,entitlement_period_id)
      VALUES (${duplicateFixture.clientId},${duplicateFixture.assignmentId},${duplicateFixture.rightId},'grant',7,'Duplicate grant','f1b-test',${key},${'d'.repeat(64)},${duplicatePeriodId})`;
  }),error=>error.code==='23505'&&/client_entitlement_ledger_period_grant_unique/.test(error.message));

  const unlimitedFixture=await createContract({unlimited:true});const unlimitedPeriodId=randomUUID();
  await assert.rejects(sql.begin(async tx=>{
    const [assignment]=await tx`SELECT starts_on::text AS start,ends_on::text AS end FROM client_plan_assignments WHERE id=${unlimitedFixture.assignmentId}`;
    await tx`INSERT INTO assignment_entitlement_periods(id,assignment_id,client_id,right_id,period_index,entitlement_mode,formula_id,period_start,period_end,weekdays_in_period,weekly_frequency,sessions_granted,sessions_snapshot,snapshot,idempotency_key,request_hash)
      VALUES (${unlimitedPeriodId},${unlimitedFixture.assignmentId},${unlimitedFixture.clientId},${unlimitedFixture.rightId},0,'unlimited',NULL,${assignment.start},${assignment.end},NULL,NULL,NULL,NULL,'{}'::jsonb,${randomUUID()},${'e'.repeat(64)})`;
    await tx`INSERT INTO client_entitlement_ledger(client_id,assignment_id,right_key,entry_type,quantity,reason,actor_id,idempotency_key,request_hash,entitlement_period_id)
      VALUES (${unlimitedFixture.clientId},${unlimitedFixture.assignmentId},${unlimitedFixture.rightId},'grant',1,'Invalid unlimited grant','f1b-test',${randomUUID()},${'f'.repeat(64)},${unlimitedPeriodId})`;
  }),error=>error.code==='23514'&&/must equal its frozen quota bag/.test(error.message));
});

test('period overlap guard rejects same assignment/right and nullable fixed periods but allows distinct rights',async()=>{
  const serviceTwo=(await app.inject({method:'POST',url:'/api/services',payload:{name:`F1-B second ${randomUUID()}`,areaId:area.id,status:'active'}})).json();
  const multiResponse=await app.inject({method:'POST',url:'/api/plans',headers:{'idempotency-key':randomUUID()},payload:{
    name:`F1-B multi-right ${randomUUID()}`,serviceIds:[serviceId,serviceTwo.id],kind:'recurring',renewalCadence:'monthly',termKind:'rolling_months',termMonths:3,
    rights:[{rightType:'service_access',serviceId},{rightType:'service_access',serviceId:serviceTwo.id},
      {rightType:'sessions_quota',serviceId,quotaScope:'per_service',weeklyFrequency:3,quantityRule:'weekday_ratio_v1'},
      {rightType:'sessions_quota',serviceId:serviceTwo.id,quotaScope:'per_service',weeklyFrequency:3,quantityRule:'weekday_ratio_v1'}]}});
  assert.equal(multiResponse.statusCode,201,multiResponse.body);
  assert.equal((await app.inject({method:'POST',url:`/api/plans/${multiResponse.json().id}/activate`})).statusCode,200);
  const clientId=randomUUID(),assignmentId=randomUUID(),chargeId=randomUUID();
  await sql`INSERT INTO clients(id,first_name,last_name) VALUES (${clientId},'F1-B overlap','Synthetic')`;
  await sql`INSERT INTO economic_charges(id,client_id,plan_id,concept,amount_cents,due_on,created_by,idempotency_key,request_hash) VALUES (${chargeId},${clientId},${multiResponse.json().id},'Overlap fixture',1000,'2026-10-15','f1b-test',${randomUUID()},${checksum})`;
  await sql`INSERT INTO client_plan_assignments(id,client_id,plan_id,plan_version,charge_id,starts_on,ends_on,idempotency_key,request_hash,created_by) VALUES (${assignmentId},${clientId},${multiResponse.json().id},1,${chargeId},'2026-10-15','2027-01-14',${randomUUID()},${checksum},'f1b-test')`;
  await sql`INSERT INTO assignment_contract_terms(assignment_id,term_kind,contract_start,contract_end,term_months,payment_rule,payment_block,deadline_computation,assigned_local_date)
    VALUES (${assignmentId},'rolling_months','2026-10-15','2027-01-14',3,'grace_from_assignment_v1','enforce',${sql.json({rule:'grace_from_assignment_v1',assignedLocalDate:'2026-10-15',inputs:{graceDays:5},dueOn:'2026-10-15'})},'2026-10-15')`;
  const rights=await sql`SELECT id FROM plan_rights WHERE plan_id=${multiResponse.json().id} AND right_type='sessions_quota' ORDER BY service_id`;
  const fixture={assignmentId,clientId,rightId:rights[0].id};
  await sql.begin(async tx=>{
    const [first]=await insertDirectQuotaPeriod(tx,fixture,{periodId:randomUUID()});
    await tx`INSERT INTO client_entitlement_ledger(client_id,assignment_id,right_key,entry_type,quantity,reason,actor_id,idempotency_key,request_hash,entitlement_period_id)
      VALUES (${clientId},${assignmentId},${rights[0].id},'grant',7,'First bag','f1b-test',${randomUUID()},${'1'.repeat(64)},${first.id})`;
    const secondFixture={...fixture,rightId:rights[1].id};
    const [second]=await insertDirectQuotaPeriod(tx,secondFixture,{periodId:randomUUID()});
    await tx`INSERT INTO client_entitlement_ledger(client_id,assignment_id,right_key,entry_type,quantity,reason,actor_id,idempotency_key,request_hash,entitlement_period_id)
      VALUES (${clientId},${assignmentId},${rights[1].id},'grant',7,'Second bag','f1b-test',${randomUUID()},${'2'.repeat(64)},${second.id})`;
  });
  await assert.rejects(sql.begin(async tx=>{
    const [first]=await tx`SELECT id FROM assignment_entitlement_periods WHERE assignment_id=${assignmentId} AND right_id=${rights[0].id}`;
    await insertDirectQuotaPeriod(tx,fixture,{periodId:randomUUID()});
  }),error=>error.code==='23514'&&/cannot overlap/.test(error.message));

  const pack=await createContract({termKind:'pack',termMonths:null,start:null,end:null,pack:true});
  await assert.rejects(sql.begin(async tx=>{
    const [assignment]=await tx`SELECT starts_on::text AS start FROM client_plan_assignments WHERE id=${pack.assignmentId}`;
    const insert=async(index,id)=>tx`INSERT INTO assignment_entitlement_periods(id,assignment_id,client_id,right_id,period_index,entitlement_mode,formula_id,period_start,period_end,weekdays_in_period,weekly_frequency,sessions_granted,sessions_snapshot,snapshot,idempotency_key,request_hash)
      VALUES (${id},${pack.assignmentId},${pack.clientId},${pack.rightId},${index},'quota','fixed_v1',${assignment.start},NULL,NULL,NULL,8,NULL,'{}'::jsonb,${randomUUID()},${'3'.repeat(64)})`;
    await insert(0,randomUUID());
    await tx`INSERT INTO client_entitlement_ledger(client_id,assignment_id,right_key,entry_type,quantity,reason,actor_id,idempotency_key,request_hash,entitlement_period_id)
      SELECT ${pack.clientId},${pack.assignmentId},${pack.rightId},'grant',8,'Fixed bag','f1b-test',${randomUUID()},${'4'.repeat(64)},id FROM assignment_entitlement_periods WHERE assignment_id=${pack.assignmentId}`;
    await insert(1,randomUUID());
  }),error=>error.code==='23514'&&/cannot overlap/.test(error.message),'NULL period_end must still overlap as an unbounded range');
});

test('term-enabled public contract sale remains disabled and creates no financial or entitlement records',async()=>{
  const fixture=await createContract();
  const clientResponse=await app.inject({method:'POST',url:'/api/clients',headers:{'idempotency-key':randomUUID()},payload:{firstName:'F1-B guard',lastName:'Synthetic',email:null,phone:null}});
  assert.equal(clientResponse.statusCode,201,clientResponse.body);const client=clientResponse.json();
  const assignable=await app.inject({method:'GET',url:'/api/plans/assignable'});
  assert.equal(assignable.statusCode,200);assert.equal(assignable.json().some(plan=>plan.id===fixture.planId),false);
  const response=await app.inject({method:'POST',url:`/api/clients/${client.id}/plans`,headers:{'idempotency-key':randomUUID()},payload:{planId:fixture.planId,startsOn:'2026-10-15',endsOn:'2027-01-14',dueOn:'2026-10-15',amountCents:1000}});
  assert.equal(response.statusCode,409);assert.equal(response.json().error,'contract_terms_not_available');
  const [counts]=await sql`SELECT
    (SELECT count(*)::int FROM economic_charges WHERE client_id=${client.id}) charges,
    (SELECT count(*)::int FROM client_plan_assignments WHERE client_id=${client.id}) assignments,
    (SELECT count(*)::int FROM client_entitlement_ledger WHERE client_id=${client.id}) ledger,
    (SELECT count(*)::int FROM assignment_entitlement_periods WHERE client_id=${client.id}) periods`;
  assert.deepEqual(counts,{charges:0,assignments:0,ledger:0,periods:0});
});

test('outer transaction rollback removes all periods and grants',async()=>{
  const fixture=await createContract({termKind:'rolling_months',termMonths:3,start:'2026-10-15',end:'2027-01-14'});
  await assert.rejects(sql.begin(async tx=>{await materializeContractEntitlementPeriods(tx,fixture.assignmentId,'f1b-test-admin');throw new Error('forced rollback');}),/forced rollback/);
  assert.equal((await sql`SELECT count(*)::int AS count FROM assignment_entitlement_periods WHERE assignment_id=${fixture.assignmentId}`)[0].count,0);
  assert.equal((await sql`SELECT count(*)::int AS count FROM client_entitlement_ledger WHERE assignment_id=${fixture.assignmentId}`)[0].count,0);
});

test('conflicting pre-existing deterministic period key fails without adding partial bags',async()=>{
  const fixture=await createContract({termKind:'rolling_months',termMonths:3,start:'2026-10-15',end:'2027-01-14'});
  const periodId=randomUUID(),periodKey=deterministicUuid(`term-period:${fixture.assignmentId}:${fixture.rightId}:0`);
  await sql.begin(async tx=>{
    await tx`INSERT INTO assignment_entitlement_periods(id,assignment_id,client_id,right_id,period_index,entitlement_mode,formula_id,period_start,period_end,weekdays_in_period,weekly_frequency,sessions_granted,sessions_snapshot,snapshot,idempotency_key,request_hash)
      VALUES (${periodId},${fixture.assignmentId},${fixture.clientId},${fixture.rightId},0,'quota','weekday_ratio_v1','2026-10-15','2026-10-31',12,3,7,NULL,${tx.json({version:1,conflictingSnapshot:true})},${periodKey},${'c'.repeat(64)})`;
    await tx`INSERT INTO client_entitlement_ledger(client_id,assignment_id,right_key,entry_type,quantity,reason,actor_id,idempotency_key,request_hash,entitlement_period_id)
      VALUES (${fixture.clientId},${fixture.assignmentId},${fixture.rightId},'grant',7,'Conflicting fixture','f1b-test',${randomUUID()},${'d'.repeat(64)},${periodId})`;
  });
  await assert.rejects(materialize(fixture.assignmentId),error=>error.code==='idempotency_conflict');
  assert.equal((await sql`SELECT count(*)::int AS count FROM assignment_entitlement_periods WHERE assignment_id=${fixture.assignmentId}`)[0].count,1);
  assert.equal((await sql`SELECT count(*)::int AS count FROM client_entitlement_ledger WHERE assignment_id=${fixture.assignmentId} AND entry_type='grant'`)[0].count,1);
});

test('pack and one_off do not activate fixed bags before payment activation in F1-C',async()=>{
  for(const type of ['pack','one_off']){
    const fixture=await createContract({termKind:type,termMonths:null,start:null,end:null,pack:type==='pack',oneOff:type==='one_off'});
    await assert.rejects(materialize(fixture.assignmentId),error=>error.code==='payment_activation_required');
    assert.equal((await sql`SELECT count(*)::int AS count FROM assignment_entitlement_periods WHERE assignment_id=${fixture.assignmentId}`)[0].count,0);
    assert.equal(fixture.termKind,type);
  }
});
