import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { countLabel } from '../src/text.ts';
import { sortAttentionItems } from '../src/dashboard.ts';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: PostgreSQL integration tests cannot be skipped.');
const sql = postgres(process.env.DATABASE_URL, { max: 8, connect_timeout: 5 });
await migrateDatabase(sql);
const make = (role, actor = `dashboard-${role}-${randomUUID()}`) => buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: actor, role }) });
const admin = make('admin');
const trainer = make('trainer');
const reception = make('reception-management');
const accountant = make('accountant');
const anonymous = buildServer(process.env.DATABASE_URL);
after(async () => { await Promise.all([admin.close(), trainer.close(), reception.close(), accountant.close(), anonymous.close(), sql.end()]); });

test('Command Center denies anonymous access and filters each domain on the server by role capabilities', async () => {
  const denied = await anonymous.inject({ method: 'GET', url: '/api/dashboard/command-center' });
  assert.equal(denied.statusCode, 401);
  const [adminData, trainerData, receptionData, accountantData] = await Promise.all([
    admin.inject({ method: 'GET', url: '/api/dashboard/command-center' }),
    trainer.inject({ method: 'GET', url: '/api/dashboard/command-center' }),
    reception.inject({ method: 'GET', url: '/api/dashboard/command-center' }),
    accountant.inject({ method: 'GET', url: '/api/dashboard/command-center' }),
  ]);
  for (const response of [adminData, trainerData, receptionData, accountantData]) assert.equal(response.statusCode, 200, response.body);
  assert.equal(adminData.json().permissions.billing, true);
  assert.equal(trainerData.json().permissions.billing, false);
  assert.equal(trainerData.json().economics, null);
  assert.equal(trainerData.json().quickActions.some((item) => item.id === 'collect-payment'), false);
  assert.equal(receptionData.json().permissions.billing, true);
  assert.equal(accountantData.json().clients, null);
  assert.equal(accountantData.json().team, null);
  assert.equal(accountantData.json().unread, 0);
  assert.equal(accountantData.json().quickActions.some((item) => item.id === 'send-message'), false);
  assert.equal(adminData.json().timezone, 'Atlantic/Canary');
  assert.equal(adminData.headers['cache-control'], 'no-store');
});

test('Home layout preferences persist per authenticated actor and reject duplicate or unknown blocks',async()=>{
  const actor=`dashboard-layout-${randomUUID()}`;const owner=make('admin',actor);const stranger=make('admin',`dashboard-layout-other-${randomUUID()}`);
  try{
    const anonymousRead=await anonymous.inject({method:'GET',url:'/api/dashboard/preferences'});assert.equal(anonymousRead.statusCode,401);
    const initial=await owner.inject({method:'GET',url:'/api/dashboard/preferences'});assert.equal(initial.statusCode,200);assert.equal(initial.json().order[0],'agenda');
    const layout={order:['clients','agenda','shortcuts'],hidden:['communication']};
    const saved=await owner.inject({method:'PUT',url:'/api/dashboard/preferences',payload:layout});assert.equal(saved.statusCode,200,saved.body);assert.deepEqual(saved.json(),layout);
    const reread=await owner.inject({method:'GET',url:'/api/dashboard/preferences'});assert.deepEqual(reread.json(),layout);
    const isolated=await stranger.inject({method:'GET',url:'/api/dashboard/preferences'});assert.equal(isolated.json().order[0],'agenda');
    const duplicate=await owner.inject({method:'PUT',url:'/api/dashboard/preferences',payload:{order:['agenda','agenda'],hidden:[]}});assert.equal(duplicate.statusCode,400);
    const unknown=await owner.inject({method:'PUT',url:'/api/dashboard/preferences',payload:{order:['agenda','billing'],hidden:[]}});assert.equal(unknown.statusCode,400);
  }finally{await Promise.all([owner.close(),stranger.close()]);}
});

test('Command Center aggregates today occupancy and waitlist from calendar source tables', async () => {
  const [area] = await sql`SELECT id FROM areas WHERE status='active' ORDER BY id LIMIT 1`;
  const [client] = await sql`INSERT INTO clients(first_name,last_name) VALUES ('Demo','Dashboard QA') RETURNING id`;
  const [service] = await sql`INSERT INTO services(name,area_id,status) VALUES (${`Dashboard ${randomUUID()}`},${area.id},'active') RETURNING id,name`;
  const [professional] = await sql`INSERT INTO staff_professionals(first_name,last_name,display_name,base_role,created_by) VALUES ('Equipo','QA',${`Profesional ${randomUUID()}`},'trainer','2J-070-test') RETURNING id`;
  const [session] = await sql`INSERT INTO calendar_sessions(service_id,area_id,professional_id,starts_at,duration_minutes,capacity,created_by) VALUES (${service.id},${area.id},${professional.id},date_trunc('day',now() AT TIME ZONE 'Atlantic/Canary') AT TIME ZONE 'Atlantic/Canary'+interval '23 hours',45,4,'2J-070-test') RETURNING id`;
  await sql`INSERT INTO calendar_reservations(session_id,client_id,entitlement_reference,created_by) VALUES (${session.id},${client.id},'qa-entitlement','2J-070-test')`;
  const [waitingClient] = await sql`INSERT INTO clients(first_name,last_name) VALUES ('Espera','Dashboard QA') RETURNING id`;
  await sql`INSERT INTO calendar_waitlist_entries(session_id,client_id,entitlement_reference,created_by) VALUES (${session.id},${waitingClient.id},'qa-entitlement','2J-070-test')`;
  const response = await admin.inject({ method: 'GET', url: '/api/dashboard/command-center' });
  assert.equal(response.statusCode, 200, response.body);
  assert.ok(response.json().today.sessionCount >= 1, JSON.stringify(response.json().today));
  assert.ok(response.json().today.capacity >= 4);
  assert.ok(response.json().today.occupied >= 1);
  assert.ok(response.json().today.waitlistCount >= 1);
  const agenda = response.json().today.sessions;
  assert.ok(Array.isArray(agenda));
  const todayRow = agenda.find((item) => item.id === session.id);
  assert.equal(todayRow.serviceName, service.name);
  assert.equal(todayRow.professionalName.startsWith('Profesional '), true);
  assert.equal(todayRow.occupied, 1);
  assert.equal(todayRow.capacity, 4);
  assert.equal(todayRow.free, 3);
  assert.equal(todayRow.waitlistCount, 1);
  assert.equal(agenda.some((item, index) => index > 0 && new Date(agenda[index - 1].startsAt) > new Date(item.startsAt)), false);
});

test('global search groups only entities the role can read and rejects anonymous access', async () => {
  const [area] = await sql`SELECT id FROM areas WHERE status='active' ORDER BY id LIMIT 1`;
  const name = `Findable ${randomUUID()}`;
  const [client] = await sql`INSERT INTO clients(first_name,last_name) VALUES (${name},'Synthetic Search') RETURNING id`;
  await sql`INSERT INTO staff_professionals(first_name,last_name,display_name,base_role,created_by) VALUES (${name},'Synthetic',${name},'trainer','2J-070-test')`;
  await sql`INSERT INTO services(name,area_id,status) VALUES (${name},${area.id},'active')`;
  assert.equal((await anonymous.inject({ method: 'GET', url: `/api/search?q=${encodeURIComponent(name)}` })).statusCode, 401);
  const staffResults = (await trainer.inject({ method: 'GET', url: `/api/search?q=${encodeURIComponent(name)}` })).json();
  assert.equal(staffResults.groups.find((group) => group.type === 'clients').items.some((item) => item.id === client.id), true);
  assert.equal(staffResults.groups.find((group) => group.type === 'team').items.length, 1);
  assert.equal(staffResults.groups.find((group) => group.type === 'services').items.length, 1);
  assert.deepEqual((await accountant.inject({ method: 'GET', url: `/api/search?q=${encodeURIComponent(name)}` })).json().groups, []);
  assert.equal((await admin.inject({ method: 'GET', url: '/api/search?q=x' })).statusCode, 400);
});

test('navigation capabilities remain authorized and independent of Command Center content', async () => {
  const denied = await anonymous.inject({method:'GET',url:'/api/session/capabilities'});
  assert.equal(denied.statusCode,401);
  const [adminCaps,trainerCaps,receptionCaps,accountantCaps] = await Promise.all([
    admin.inject({method:'GET',url:'/api/session/capabilities'}),
    trainer.inject({method:'GET',url:'/api/session/capabilities'}),
    reception.inject({method:'GET',url:'/api/session/capabilities'}),
    accountant.inject({method:'GET',url:'/api/session/capabilities'}),
  ]);
  assert.deepEqual(adminCaps.json(),{calendar:true,clients:true,communications:true,billing:true,staff:true,reservationManage:true,attendanceManage:true,entitlementsRead:true,entitlementsManage:true,paymentsManage:true,communicationSend:true,documentsRead:true,timeclockSelf:true,capacityOverride:true});
  assert.deepEqual(trainerCaps.json(),{calendar:true,clients:true,communications:true,billing:false,staff:true,reservationManage:true,attendanceManage:true,entitlementsRead:true,entitlementsManage:false,paymentsManage:false,communicationSend:true,documentsRead:true,timeclockSelf:true,capacityOverride:true});
  assert.deepEqual(receptionCaps.json(),{calendar:true,clients:true,communications:true,billing:true,staff:true,reservationManage:true,attendanceManage:false,entitlementsRead:true,entitlementsManage:true,paymentsManage:false,communicationSend:true,documentsRead:true,timeclockSelf:true,capacityOverride:false});
  assert.deepEqual(accountantCaps.json(),{calendar:false,clients:false,communications:false,billing:true,staff:false,reservationManage:false,attendanceManage:false,entitlementsRead:false,entitlementsManage:false,paymentsManage:false,communicationSend:false,documentsRead:false,timeclockSelf:false,capacityOverride:false});
  assert.equal(adminCaps.headers['cache-control'],'no-store');
});

test('cash summary follows 2J-040 selection semantics and never fails with multiple sessions per day', async () => {
  const today = await sql`SELECT (now() AT TIME ZONE 'Atlantic/Canary')::date AS day`;
  const [only] = await sql`INSERT INTO economic_cash_sessions(local_date,opening_cents,expected_cents,counted_cents,difference_cents,status,close_kind,opened_by,closed_by,opened_at,closed_at)
    VALUES (${today[0].day},1100,1100,1100,0,'closed','closed','qa','qa',now()+interval '10 seconds',now()+interval '11 seconds') RETURNING id`;
  let response = await admin.inject({method:'GET',url:'/api/dashboard/command-center'});
  assert.equal(response.statusCode,200,response.body);
  assert.equal(response.json().economics.cashSession.openingCents,1100);
  const [newer] = await sql`INSERT INTO economic_cash_sessions(local_date,opening_cents,expected_cents,counted_cents,difference_cents,status,close_kind,opened_by,closed_by,opened_at,closed_at)
    VALUES (${today[0].day},2200,2200,2200,0,'closed','closed','qa','qa',now()+interval '20 seconds',now()+interval '21 seconds') RETURNING id`;
  response = await admin.inject({method:'GET',url:'/api/dashboard/command-center'});
  assert.equal(response.statusCode,200,response.body);
  assert.equal(response.json().economics.cashSession.openingCents,2200);
  const [openToday] = await sql`INSERT INTO economic_cash_sessions(local_date,opening_cents,opened_by,opened_at)
    VALUES (${today[0].day},3300,'qa',now()+interval '30 seconds') RETURNING id`;
  response = await admin.inject({method:'GET',url:'/api/dashboard/command-center'});
  assert.equal(response.statusCode,200,response.body);
  assert.equal(response.json().economics.cashSession.status,'open');
  assert.equal(Number(response.json().economics.cashSession.openingCents),3300);
  await sql`UPDATE economic_cash_sessions SET status='closed',close_kind='closed',expected_cents=opening_cents,counted_cents=opening_cents,difference_cents=0,closed_by='qa',closed_at=now() WHERE id=${openToday.id}`;
  const [staleOpen] = await sql`INSERT INTO economic_cash_sessions(local_date,opening_cents,opened_by,opened_at)
    VALUES (${today[0].day}::date-1,4400,'qa',now()+interval '40 seconds') RETURNING id`;
  response = await admin.inject({method:'GET',url:'/api/dashboard/command-center'});
  assert.equal(response.statusCode,200,response.body);
  assert.equal(response.json().economics.cashSession.status,'open');
  assert.equal(Number(response.json().economics.cashSession.openingCents),4400);
  assert.ok(only.id && newer.id && staleOpen.id);
  await sql`UPDATE economic_cash_sessions SET status='late_close',close_kind='late_close',expected_cents=opening_cents,counted_cents=opening_cents,difference_cents=0,closed_by='qa',closed_at=now() WHERE id=${staleOpen.id}`;
});

test('open timeclock attention uses effective timestamps and only flags an open shift from a prior local day', async () => {
  const timeclockOnly = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({
    actorId: `dashboard-timeclock-${randomUUID()}`,
    role: 'admin',
    deniedPermissions: ['calendar.read','clients.read','communication.read','documents.read','health.read','forms.responses.sensitive.read','followup.read','billing.read-basic','billing.cash.manage','billing.payments.manage','billing.validate_transfer','staff.read'],
  }) });
  try {
  const [personToday] = await sql`INSERT INTO staff_professionals(first_name,last_name,display_name,base_role,created_by) VALUES ('Turno','Hoy',${`Hoy ${randomUUID()}`},'trainer','2J-070-test') RETURNING id`;
  const [personYesterday] = await sql`INSERT INTO staff_professionals(first_name,last_name,display_name,base_role,created_by) VALUES ('Turno','Ayer',${`Ayer ${randomUUID()}`},'trainer','2J-070-test') RETURNING id`;
  const [personCorrected] = await sql`INSERT INTO staff_professionals(first_name,last_name,display_name,base_role,created_by) VALUES ('Turno','Corregido',${`Corregido ${randomUUID()}`},'trainer','2J-070-test') RETURNING id`;
  const [times] = await sql`SELECT
    (((now() AT TIME ZONE 'Atlantic/Canary')::date::timestamp + time '11:00') AT TIME ZONE 'Atlantic/Canary') AS today_at,
    ((((now() AT TIME ZONE 'Atlantic/Canary')::date-1)::timestamp + time '11:00') AT TIME ZONE 'Atlantic/Canary') AS yesterday_at`;
  const [todayEvent] = await sql`INSERT INTO staff_timeclock_events(professional_id,event_type,occurred_at,local_date,local_time,actor_id,origin)
    VALUES (${personToday.id},'clock_in',${times.today_at},(${times.today_at} AT TIME ZONE 'Atlantic/Canary')::date,(${times.today_at} AT TIME ZONE 'Atlantic/Canary')::time,'qa','manual_admin') RETURNING id`;
  const [yesterdayEvent] = await sql`INSERT INTO staff_timeclock_events(professional_id,event_type,occurred_at,local_date,local_time,actor_id,origin)
    VALUES (${personYesterday.id},'clock_in',${times.yesterday_at},(${times.yesterday_at} AT TIME ZONE 'Atlantic/Canary')::date,(${times.yesterday_at} AT TIME ZONE 'Atlantic/Canary')::time,'qa','manual_admin') RETURNING id`;
  const [correctedEvent] = await sql`INSERT INTO staff_timeclock_events(professional_id,event_type,occurred_at,local_date,local_time,actor_id,origin)
    VALUES (${personCorrected.id},'clock_in',${times.yesterday_at},(${times.yesterday_at} AT TIME ZONE 'Atlantic/Canary')::date,(${times.yesterday_at} AT TIME ZONE 'Atlantic/Canary')::time,'qa','manual_admin') RETURNING id`;
  await sql`INSERT INTO staff_timeclock_corrections(event_id,professional_id,revision,previous_occurred_at,corrected_occurred_at,reason,actor_id)
    VALUES (${correctedEvent.id},${personCorrected.id},1,${times.yesterday_at},${times.today_at},'Correction moves shift to today','qa')`;
  let response = await timeclockOnly.inject({method:'GET',url:'/api/dashboard/command-center'});
  assert.equal(response.statusCode,200,response.body);
  let ids = response.json().attention.map(item=>item.id);
  assert.equal(ids.includes(`timeclock-${personToday.id}`),false);
  assert.equal(ids.includes(`timeclock-${personYesterday.id}`),true);
  assert.equal(ids.includes(`timeclock-${personCorrected.id}`),false);
  await sql`INSERT INTO staff_timeclock_corrections(event_id,professional_id,revision,previous_occurred_at,corrected_occurred_at,reason,actor_id)
    VALUES (${correctedEvent.id},${personCorrected.id},2,${times.today_at},${times.yesterday_at},'Correction restores prior-day effective time','qa')`;
  response = await timeclockOnly.inject({method:'GET',url:'/api/dashboard/command-center'});
  ids = response.json().attention.map(item=>item.id);
  assert.equal(ids.includes(`timeclock-${personCorrected.id}`),true);
  assert.ok(todayEvent.id && yesterdayEvent.id);
  } finally {
    await timeclockOnly.close();
  }
});

test('working now excludes inactive and archived professionals', async () => {
  const baselineResponse = await admin.inject({method:'GET',url:'/api/dashboard/command-center'});
  const baseline = baselineResponse.json().team.workingNow;
  let expected = baseline;
  for (const [status,name] of [['active','Active'],['inactive','Inactive'],['archived','Archived']]) {
    const [professional] = await sql`INSERT INTO staff_professionals(first_name,last_name,display_name,status,base_role,created_by)
      VALUES ('Estado',${status},${`${name} ${randomUUID()}`},${status},'trainer','2J-070-test') RETURNING id`;
    const [instant] = await sql`SELECT now()-interval '30 minutes' AS at`;
    await sql`INSERT INTO staff_timeclock_events(professional_id,event_type,occurred_at,local_date,local_time,actor_id,origin)
      VALUES (${professional.id},'clock_in',${instant.at},(${instant.at} AT TIME ZONE 'Atlantic/Canary')::date,(${instant.at} AT TIME ZONE 'Atlantic/Canary')::time,'qa','manual_admin')`;
    if (status==='active') expected += 1;
    const after = (await admin.inject({method:'GET',url:'/api/dashboard/command-center'})).json().team.workingNow;
    assert.equal(after,expected);
  }
});

test('extra_availability does not count as absence or create absence attention', async () => {
  const baseResponse = await admin.inject({method:'GET',url:'/api/dashboard/command-center'});
  const base = baseResponse.json();
  const [area] = await sql`SELECT id FROM areas WHERE status='active' ORDER BY id LIMIT 1`;
  const [service] = await sql`INSERT INTO services(name,area_id,status) VALUES (${`Availability ${randomUUID()}`},${area.id},'active') RETURNING id`;
  const [person] = await sql`INSERT INTO staff_professionals(first_name,last_name,display_name,base_role,created_by) VALUES ('Disponibilidad','QA',${`Availability ${randomUUID()}`},'trainer','2J-070-test') RETURNING id`;
  const [window] = await sql`SELECT now()+interval '2 hours' AS starts_at,now()+interval '3 hours' AS ends_at,(now() AT TIME ZONE 'Atlantic/Canary')::date AS today`;
  const [exception] = await sql`INSERT INTO staff_exceptions(professional_id,kind,starts_at,ends_at,local_start_date,local_end_date,created_by)
    VALUES (${person.id},'extra_availability',${window.starts_at},${window.ends_at},${window.today},${window.today},'2J-070-test') RETURNING id`;
  await sql`INSERT INTO calendar_sessions(service_id,area_id,professional_id,starts_at,duration_minutes,capacity,created_by)
    VALUES (${service.id},${area.id},${person.id},${window.starts_at},45,4,'2J-070-test')`;
  const response = await admin.inject({method:'GET',url:'/api/dashboard/command-center'});
  assert.equal(response.statusCode,200,response.body);
  assert.equal(response.json().team.activeAbsences,base.team.activeAbsences);
  assert.equal(response.json().attention.some(item=>item.id===`absence-${exception.id}`),false);
});

test('attention dates sort by chronological instant with stable ID ties', () => {
  const items = [
    {id:'later',kind:'document_pending',ageAt:'2026-10-09T08:30:00Z'},
    {id:'earlier',kind:'document_pending',ageAt:'2026-10-09T09:00:00+02:00'},
    {id:'tie-b',kind:'waitlist',ageAt:'2026-10-09T12:00:00Z'},
    {id:'tie-a',kind:'waitlist',ageAt:'2026-10-09T12:00:00Z'},
  ];
  assert.deepEqual(sortAttentionItems(items).map(item=>item.id),['earlier','later','tie-a','tie-b']);
});

test('count labels use Spanish singular and plural forms', () => {
  assert.equal(countLabel(1,'cargo vencido','cargos vencidos'),'1 cargo vencido');
  assert.equal(countLabel(2,'cargo vencido','cargos vencidos'),'2 cargos vencidos');
  assert.equal(countLabel(1,'transferencia por validar','transferencias por validar'),'1 transferencia por validar');
  assert.equal(countLabel(2,'transferencia por validar','transferencias por validar'),'2 transferencias por validar');
});

test('global search ignores Spanish diacritics for clients, professionals and services', async () => {
  const [area] = await sql`SELECT id FROM areas WHERE status='active' ORDER BY id LIMIT 1`;
  const [client] = await sql`INSERT INTO clients(first_name,last_name) VALUES ('María',${`Search ${randomUUID()}`}) RETURNING id`;
  const [professional] = await sql`INSERT INTO staff_professionals(first_name,last_name,display_name,base_role,created_by) VALUES ('Álvaro','Martín',${`Álvaro Martín ${randomUUID()}`},'trainer','2J-070-test') RETURNING id`;
  const [service] = await sql`INSERT INTO services(name,area_id,status) VALUES (${`Sala Martín ${randomUUID()}`},${area.id},'active') RETURNING id`;
  const maria = (await trainer.inject({method:'GET',url:'/api/search?q=maria'})).json();
  const martin = (await trainer.inject({method:'GET',url:'/api/search?q=martin'})).json();
  const alvaro = (await trainer.inject({method:'GET',url:'/api/search?q=alvaro'})).json();
  assert.ok(maria.groups.find(group=>group.type==='clients').items.some(item=>item.id===client.id));
  assert.ok(martin.groups.find(group=>group.type==='team').items.some(item=>item.id===professional.id));
  assert.ok(martin.groups.find(group=>group.type==='services').items.some(item=>item.id===service.id));
  assert.ok(alvaro.groups.find(group=>group.type==='team').items.some(item=>item.id===professional.id));
});

test('Atlantic/Canary local day bounds span 23 hours in March and 25 hours in October', async () => {
  const [march] = await sql`SELECT EXTRACT(epoch FROM (((DATE '2026-03-30')::timestamp AT TIME ZONE 'Atlantic/Canary')-((DATE '2026-03-29')::timestamp AT TIME ZONE 'Atlantic/Canary')))::int AS seconds`;
  const [october] = await sql`SELECT EXTRACT(epoch FROM (((DATE '2026-10-26')::timestamp AT TIME ZONE 'Atlantic/Canary')-((DATE '2026-10-25')::timestamp AT TIME ZONE 'Atlantic/Canary')))::int AS seconds`;
  assert.equal(march.seconds,23*60*60);
  assert.equal(october.seconds,25*60*60);
});
