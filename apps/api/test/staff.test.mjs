import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: PostgreSQL integration tests cannot be skipped.');
const sql=postgres(process.env.DATABASE_URL,{max:8,connect_timeout:5});
await migrateDatabase(sql);
const selfActor=`staff-qa-self-${randomUUID()}`;
const admin=buildServer(process.env.DATABASE_URL,{authorizationResolver:async()=>({actorId:'staff-qa-admin',role:'admin'})});
const trainer=buildServer(process.env.DATABASE_URL,{authorizationResolver:async()=>({actorId:'staff-qa-trainer',role:'trainer'})});
const reception=buildServer(process.env.DATABASE_URL,{authorizationResolver:async()=>({actorId:'staff-qa-reception',role:'reception-management'})});
const accountant=buildServer(process.env.DATABASE_URL,{authorizationResolver:async()=>({actorId:'staff-qa-accountant',role:'accountant'})});
const self=buildServer(process.env.DATABASE_URL,{authorizationResolver:async()=>({actorId:selfActor,role:'trainer'})});
const unlinked=buildServer(process.env.DATABASE_URL,{authorizationResolver:async()=>({actorId:'staff-qa-unlinked',role:'trainer'})});
after(async()=>{await Promise.all([admin.close(),trainer.close(),reception.close(),accountant.close(),self.close(),unlinked.close(),sql.end()]);});
async function professional(app=admin){const response=await app.inject({method:'POST',url:'/api/staff',payload:{firstName:'Ana',lastName:`Prueba ${randomUUID().slice(0,8)}`,displayName:`Ana QA ${randomUUID().slice(0,6)}`,email:null,phone:null,baseRole:'trainer'}});assert.equal(response.statusCode,201,response.body);return response.json();}

test('staff permissions are capability based and accounting role cannot access operations',async()=>{
 assert.equal((await accountant.inject({method:'GET',url:'/api/staff'})).statusCode,403);
 assert.equal((await reception.inject({method:'POST',url:'/api/staff',payload:{}})).statusCode,403);
 assert.equal((await trainer.inject({method:'POST',url:'/api/staff',payload:{}})).statusCode,403);
 assert.equal((await trainer.inject({method:'GET',url:'/api/staff'})).statusCode,200);
 assert.equal((await accountant.inject({method:'POST',url:'/api/timeclock/clock-in',payload:{}})).statusCode,403);
 const p=await professional();const escalation=await trainer.inject({method:'PATCH',url:`/api/staff/${p.id}`,payload:{baseRole:'admin'}});assert.equal(escalation.statusCode,403);assert.equal((await sql`SELECT base_role FROM staff_professionals WHERE id=${p.id}`)[0].base_role,'trainer');assert.equal((await trainer.inject({method:'PATCH',url:`/api/staff/${p.id}/status`,payload:{status:'inactive'}})).statusCode,403);assert.equal((await admin.inject({method:'PATCH',url:`/api/staff/${p.id}/status`,payload:{status:'inactive'}})).statusCode,200);assert.equal((await admin.inject({method:'PATCH',url:`/api/staff/${p.id}/status`,payload:{status:'active'}})).statusCode,200);
});

test('professional schedule supports multiple Canary weekly slots and rejects overlaps',async()=>{
 const p=await professional();
 const a=await admin.inject({method:'POST',url:`/api/staff/${p.id}/schedule`,payload:{weekday:1,startsAt:'08:00',endsAt:'13:00',validFrom:'2026-10-01',validUntil:null}});
 const b=await admin.inject({method:'POST',url:`/api/staff/${p.id}/schedule`,payload:{weekday:1,startsAt:'16:00',endsAt:'20:00',validFrom:'2026-10-01'}});
 const overlap=await admin.inject({method:'POST',url:`/api/staff/${p.id}/schedule`,payload:{weekday:1,startsAt:'12:00',endsAt:'17:00',validFrom:'2026-10-01'}});
 assert.equal(a.statusCode,201,a.body);assert.equal(b.statusCode,201,b.body);assert.equal(overlap.statusCode,409);assert.equal(overlap.json().error,'schedule_overlap');
 const slots=await sql`SELECT starts_at,ends_at FROM staff_schedule_slots WHERE professional_id=${p.id} AND status='active' ORDER BY starts_at`;
 assert.deepEqual(slots.map(x=>[String(x.starts_at).slice(0,5),String(x.ends_at).slice(0,5)]),[['08:00','13:00'],['16:00','20:00']]);
 const concurrent=await Promise.all([1,2].map(()=>admin.inject({method:'POST',url:`/api/staff/${p.id}/schedule`,payload:{weekday:2,startsAt:'09:00',endsAt:'12:00',validFrom:'2026-10-01'}})));
 assert.deepEqual(concurrent.map(x=>x.statusCode).sort(),[201,409]);
});

test('calendar checks assigned professional availability and audits authorized override',async()=>{
 const p=await professional();const [area]=await sql`SELECT id FROM areas WHERE status='active' LIMIT 1`;
 const serviceResponse=await admin.inject({method:'POST',url:'/api/services',payload:{name:`Staff calendar ${randomUUID()}`,areaId:area.id,status:'active'}});assert.equal(serviceResponse.statusCode,201,serviceResponse.body);
 await admin.inject({method:'POST',url:`/api/staff/${p.id}/schedule`,payload:{weekday:1,startsAt:'09:00',endsAt:'17:00',validFrom:'2099-01-01',validUntil:null}});
 const payload={serviceId:serviceResponse.json().id,areaId:area.id,professionalId:p.id,startsAt:'2099-01-05T10:00:00.000Z',durationMinutes:60,capacity:8};
 const covered=await trainer.inject({method:'POST',url:'/api/calendar/sessions',payload});assert.equal(covered.statusCode,201,covered.body);
 const outside={...payload,startsAt:'2099-01-05T20:00:00.000Z'};
 const blocked=await reception.inject({method:'POST',url:'/api/calendar/sessions',payload:outside});assert.equal(blocked.statusCode,409);assert.equal(blocked.json().error,'professional_availability_confirmation_required');
 const forbidden=await reception.inject({method:'POST',url:'/api/calendar/sessions',payload:{...outside,overrideAvailability:true,availabilityReason:'Necesidad operativa'}});assert.equal(forbidden.statusCode,403);
 const approved=await admin.inject({method:'POST',url:'/api/calendar/sessions',payload:{...outside,overrideAvailability:true,availabilityReason:'Necesidad operativa'}});assert.equal(approved.statusCode,201,approved.body);
 const audit=await sql`SELECT count(*)::int AS n FROM calendar_audit_events WHERE session_id=${approved.json().id} AND action='session.availability_override'`;assert.equal(audit[0].n,1);
});

test('substitution conflict is rejected and explicit confirmed reassignment keeps an audit trail',async()=>{
 const source=await professional();const target=await professional();const [area]=await sql`SELECT id FROM areas WHERE status='active' LIMIT 1`;const [service]=await sql`INSERT INTO services(name,area_id,status) VALUES (${`Substitution QA ${randomUUID()}`},${area.id},'active') RETURNING id`;
 const start='2099-01-05T10:00:00.000Z',end='2099-01-05T12:00:00.000Z';const [conflicting]=await sql`INSERT INTO calendar_sessions(service_id,area_id,professional_id,starts_at,duration_minutes,capacity,created_by) VALUES (${service.id},${area.id},${target.id},${start},45,8,'staff-qa') RETURNING id`;
 const body={sourceProfessionalId:source.id,substituteProfessionalId:target.id,startsAt:start,endsAt:end,reason:'Cobertura de ausencia'};
 const denied=await admin.inject({method:'POST',url:'/api/staff/substitutions',payload:body});assert.equal(denied.statusCode,409);assert.equal(denied.json().error,'substitute_conflict');
 await sql`UPDATE calendar_sessions SET status='cancelled' WHERE id=${conflicting.id}`;
 const created=await admin.inject({method:'POST',url:'/api/staff/substitutions',payload:body});assert.equal(created.statusCode,201,created.body);
 const [session]=await sql`INSERT INTO calendar_sessions(service_id,area_id,professional_id,starts_at,duration_minutes,capacity,created_by) VALUES (${service.id},${area.id},${source.id},${start},45,8,'staff-qa') RETURNING id`;
 const missing=await admin.inject({method:'POST',url:`/api/staff/substitutions/${created.json().id}/reassign`,payload:{sessionIds:[session.id],confirm:false}});assert.equal(missing.statusCode,400);
 const moved=await admin.inject({method:'POST',url:`/api/staff/substitutions/${created.json().id}/reassign`,payload:{sessionIds:[session.id],confirm:true}});assert.equal(moved.statusCode,200,moved.body);assert.equal((await sql`SELECT professional_id FROM calendar_sessions WHERE id=${session.id}`)[0].professional_id,target.id);
 const audit=await sql`SELECT details FROM calendar_audit_events WHERE session_id=${session.id} AND action='session.reassigned'`;assert.equal(audit.length,1);assert.equal(audit[0].details.previousProfessionalId,source.id);assert.equal(audit[0].details.newProfessionalId,target.id);
});

test('team dashboard returns collection fields as arrays and filters active absence context',async()=>{
 const response=await admin.inject({method:'GET',url:'/api/staff/dashboard'});assert.equal(response.statusCode,200,response.body);const result=response.json();
 assert.ok(Array.isArray(result.workingNow));assert.ok(Array.isArray(result.activeAbsences));assert.ok(Array.isArray(result.upcomingSubstitutions));assert.equal(result.timezone,'Atlantic/Canary');
});

test('absence reports affected sessions without changing them and account cannot archive history',async()=>{
 const p=await professional();const [area]=await sql`SELECT id FROM areas WHERE status='active' LIMIT 1`;const [service]=await sql`INSERT INTO services(name,area_id,status) VALUES (${`Staff QA ${randomUUID()}`},${area.id},'active') RETURNING id`;
 const [session]=await sql`INSERT INTO calendar_sessions(service_id,area_id,professional_id,starts_at,duration_minutes,capacity,created_by) VALUES (${service.id},${area.id},${p.id},now()+interval '2 days',45,8,'staff-qa') RETURNING id,starts_at`;
 const start=new Date(session.starts_at),end=new Date(start.getTime()+60*60*1000);const d=(v)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Atlantic/Canary',year:'numeric',month:'2-digit',day:'2-digit'}).format(v);
 const response=await admin.inject({method:'POST',url:`/api/staff/${p.id}/exceptions`,payload:{kind:'vacation',startsAt:start.toISOString(),endsAt:end.toISOString(),allDay:false,localStartDate:d(start),localEndDate:d(start),note:'Ausencia de prueba'}});
 assert.equal(response.statusCode,201,response.body);assert.equal(response.json().affectedSessions,1);assert.equal(response.json().existingSessionsChanged,false);
 const history=await admin.inject({method:'GET',url:`/api/staff/${p.id}/history`});assert.equal(history.statusCode,200);assert.ok(history.json().some(x=>x.action==='exception.created'));
 const [unchanged]=await sql`SELECT status FROM calendar_sessions WHERE id=${session.id}`;assert.equal(unchanged.status,'scheduled');
 const archived=await admin.inject({method:'PATCH',url:`/api/staff/${p.id}/archive`});assert.equal(archived.statusCode,409);
});

test('self clocking serializes transitions, keeps events append-only, and corrections preserve original event',async()=>{
 const p=await professional();await sql`UPDATE staff_professionals SET auth_actor_id=${selfActor} WHERE id=${p.id}`;
 const [inA,inB]=await Promise.all([self.inject({method:'POST',url:'/api/timeclock/clock-in',payload:{origin:'web'}}),self.inject({method:'POST',url:'/api/timeclock/clock-in',payload:{origin:'web'}})]);
 assert.deepEqual([inA.statusCode,inB.statusCode].sort(),[201,409]);const event=(inA.statusCode===201?inA:inB).json();
 const original=await sql`SELECT occurred_at FROM staff_timeclock_events WHERE id=${event.id}`;
 const correctedAt=new Date(new Date(original[0].occurred_at).getTime()-60_000).toISOString();const correction=await admin.inject({method:'POST',url:`/api/staff/timeclock/${event.id}/corrections`,payload:{correctedOccurredAt:correctedAt,reason:'Ajuste de prueba'}});
 assert.equal(correction.statusCode,201,correction.body);assert.equal((await sql`SELECT occurred_at FROM staff_timeclock_events WHERE id=${event.id}`)[0].occurred_at.getTime(),original[0].occurred_at.getTime());assert.equal((await sql`SELECT count(*)::int AS n FROM staff_timeclock_corrections WHERE event_id=${event.id}`)[0].n,1);
 await assert.rejects(sql`UPDATE staff_timeclock_events SET occurred_at=now() WHERE id=${event.id}`,/append-only/);
 const out=await self.inject({method:'POST',url:'/api/timeclock/clock-out',payload:{origin:'web'}});assert.equal(out.statusCode,201,out.body);
 const history=await self.inject({method:'GET',url:'/api/timeclock/self'});assert.equal(history.statusCode,200);assert.equal(history.json().history.length,2);assert.equal(typeof history.json().workedSecondsToday,'number');assert.equal(typeof history.json().workedSecondsThisWeek,'number');assert.equal(typeof history.json().workedSecondsThisMonth,'number');
});

test('unlinked self clock returns no PII and requires admin to link professional identity',async()=>{
 assert.equal((await unlinked.inject({method:'GET',url:'/api/timeclock/self'})).statusCode,404);
 const p=await professional();const link=await admin.inject({method:'POST',url:`/api/staff/${p.id}/account-link`,payload:{authActorId:randomUUID()}});assert.equal(link.statusCode,200,link.body);
});
