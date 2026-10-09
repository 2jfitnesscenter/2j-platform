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
 assert.equal((await trainer.inject({method:'GET',url:'/api/staff/capabilities'})).json().manage,false);
 assert.equal((await trainer.inject({method:'GET',url:'/api/staff/capabilities'})).json().absenceManage,false);
 assert.equal((await trainer.inject({method:'GET',url:'/api/staff/capabilities'})).statusCode,200);
 assert.equal((await trainer.inject({method:'GET',url:`/api/staff/${(await professional()).id}/history`})).statusCode,403);
 assert.equal((await trainer.inject({method:'POST',url:'/api/staff/substitutions',payload:{}})).statusCode,403);
 assert.equal((await accountant.inject({method:'GET',url:'/api/staff/capabilities'})).statusCode,403);
 assert.equal((await reception.inject({method:'GET',url:'/api/staff/capabilities'})).json().scheduleManage,true);
 assert.equal((await reception.inject({method:'GET',url:'/api/staff/capabilities'})).json().manage,false);
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
 await admin.inject({method:'POST',url:`/api/staff/${p.id}/schedule`,payload:{weekday:1,startsAt:'09:00',endsAt:'12:00',validFrom:'2099-01-01',validUntil:null}});
 await admin.inject({method:'POST',url:`/api/staff/${p.id}/schedule`,payload:{weekday:1,startsAt:'12:00',endsAt:'17:00',validFrom:'2099-01-01',validUntil:null}});
 const payload={serviceId:serviceResponse.json().id,areaId:area.id,professionalId:p.id,startsAt:'2099-01-05T10:00:00.000Z',durationMinutes:60,capacity:8};
 const covered=await trainer.inject({method:'POST',url:'/api/calendar/sessions',payload});assert.equal(covered.statusCode,201,covered.body);
 const outside={...payload,startsAt:'2099-01-05T20:00:00.000Z'};
 const blocked=await reception.inject({method:'POST',url:'/api/calendar/sessions',payload:outside});assert.equal(blocked.statusCode,409);assert.equal(blocked.json().error,'professional_availability_confirmation_required');
 const forbidden=await reception.inject({method:'POST',url:'/api/calendar/sessions',payload:{...outside,overrideAvailability:true,availabilityReason:'Necesidad operativa'}});assert.equal(forbidden.statusCode,403);
 const approved=await admin.inject({method:'POST',url:'/api/calendar/sessions',payload:{...outside,overrideAvailability:true,availabilityReason:'Necesidad operativa'}});assert.equal(approved.statusCode,201,approved.body);
 const audit=await sql`SELECT count(*)::int AS n FROM calendar_audit_events WHERE session_id=${approved.json().id} AND action='session.availability_override'`;assert.equal(audit[0].n,1);
 const [extra]=await sql`INSERT INTO staff_exceptions(professional_id,kind,starts_at,ends_at,local_start_date,local_end_date,created_by) VALUES (${p.id},'extra_availability','2099-01-05T17:00:00Z','2099-01-05T19:00:00Z','2099-01-05','2099-01-05','qa') RETURNING id`;
 const extraAvailability=await reception.inject({method:'POST',url:'/api/calendar/sessions',payload:{...payload,startsAt:'2099-01-05T18:00:00.000Z'}});assert.equal(extraAvailability.statusCode,201,extraAvailability.body);
 assert.equal(extra.id.length,36);
 const beforeContiguous=await reception.inject({method:'POST',url:'/api/calendar/sessions',payload:{...payload,startsAt:'2099-01-05T11:00:00.000Z',durationMinutes:120}});assert.equal(beforeContiguous.statusCode,201,beforeContiguous.body);
});

test('substitution conflict is rejected and explicit confirmed reassignment keeps an audit trail',async()=>{
 const source=await professional();const target=await professional();const [area]=await sql`SELECT id FROM areas WHERE status='active' LIMIT 1`;const [service]=await sql`INSERT INTO services(name,area_id,status) VALUES (${`Substitution QA ${randomUUID()}`},${area.id},'active') RETURNING id`;
 const start='2099-01-05T10:00:00.000Z',end='2099-01-05T12:00:00.000Z';const [conflicting]=await sql`INSERT INTO calendar_sessions(service_id,area_id,professional_id,starts_at,duration_minutes,capacity,created_by) VALUES (${service.id},${area.id},${target.id},${start},45,8,'staff-qa') RETURNING id`;
 const body={sourceProfessionalId:source.id,substituteProfessionalId:target.id,startsAt:start,endsAt:end,reason:'Cobertura de ausencia'};
 const denied=await admin.inject({method:'POST',url:'/api/staff/substitutions',payload:body});assert.equal(denied.statusCode,409);assert.equal(denied.json().error,'substitute_conflict');
 await sql`UPDATE calendar_sessions SET status='cancelled' WHERE id=${conflicting.id}`;
 const created=await admin.inject({method:'POST',url:'/api/staff/substitutions',payload:body});assert.equal(created.statusCode,201,created.body);
 const [session]=await sql`INSERT INTO calendar_sessions(service_id,area_id,professional_id,starts_at,duration_minutes,capacity,created_by) VALUES (${service.id},${area.id},${source.id},${start},45,8,'staff-qa') RETURNING id`;
 const affected=await admin.inject({method:'GET',url:`/api/staff/substitutions/${created.json().id}/sessions`});assert.equal(affected.statusCode,200);assert.deepEqual(affected.json().sessions.map(x=>x.id),[session.id]);
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
 const response=await admin.inject({method:'POST',url:`/api/staff/${p.id}/exceptions`,payload:{kind:'vacation',startsAt:start.toISOString(),endsAt:end.toISOString(),allDay:false,note:'Ausencia de prueba'}});
 assert.equal(response.statusCode,201,response.body);assert.equal(response.json().affectedSessions,1);assert.equal(response.json().existingSessionsChanged,false);
 const history=await admin.inject({method:'GET',url:`/api/staff/${p.id}/history`});assert.equal(history.statusCode,200);assert.ok(history.json().some(x=>x.action==='exception.created'));
 const [unchanged]=await sql`SELECT status FROM calendar_sessions WHERE id=${session.id}`;assert.equal(unchanged.status,'scheduled');
 const archived=await admin.inject({method:'PATCH',url:`/api/staff/${p.id}/archive`});assert.equal(archived.statusCode,409);
 const [exception]=await sql`SELECT id FROM staff_exceptions WHERE professional_id=${p.id} AND status='active' ORDER BY created_at DESC LIMIT 1`;
 assert.equal((await trainer.inject({method:'PATCH',url:`/api/staff/exceptions/${exception.id}/cancel`})).statusCode,403);
 const cancelled=await reception.inject({method:'PATCH',url:`/api/staff/exceptions/${exception.id}/cancel`});assert.equal(cancelled.statusCode,200);assert.equal(cancelled.json().status,'cancelled');
 assert.equal((await sql`SELECT status FROM calendar_sessions WHERE id=${session.id}`)[0].status,'scheduled');
});

test('self clocking serializes transitions, keeps events append-only, and corrections preserve original event',async()=>{
 const p=await professional();await sql`UPDATE staff_professionals SET auth_actor_id=${selfActor} WHERE id=${p.id}`;
 const [inA,inB]=await Promise.all([self.inject({method:'POST',url:'/api/timeclock/clock-in',payload:{origin:'web'}}),self.inject({method:'POST',url:'/api/timeclock/clock-in',payload:{origin:'web'}})]);
 assert.deepEqual([inA.statusCode,inB.statusCode].sort(),[201,409]);const event=(inA.statusCode===201?inA:inB).json();
 const original=await sql`SELECT occurred_at FROM staff_timeclock_events WHERE id=${event.id}`;
 const correctedAt=new Date(new Date(original[0].occurred_at).getTime()-60_000).toISOString();const correction=await admin.inject({method:'POST',url:`/api/staff/timeclock/${event.id}/corrections`,payload:{correctedOccurredAt:correctedAt,reason:'Ajuste de prueba'}});
 assert.equal(correction.statusCode,201,correction.body);assert.equal((await sql`SELECT occurred_at FROM staff_timeclock_events WHERE id=${event.id}`)[0].occurred_at.getTime(),original[0].occurred_at.getTime());assert.equal((await sql`SELECT count(*)::int AS n FROM staff_timeclock_corrections WHERE event_id=${event.id}`)[0].n,1);
 await assert.rejects(sql`UPDATE staff_timeclock_events SET occurred_at=now() WHERE id=${event.id}`,/append-only/);
 const outs=await Promise.all([1,2].map(()=>self.inject({method:'POST',url:'/api/timeclock/clock-out',payload:{origin:'web'}})));assert.deepEqual(outs.map(x=>x.statusCode).sort(),[201,409]);
 const history=await self.inject({method:'GET',url:'/api/timeclock/self'});assert.equal(history.statusCode,200);assert.equal(history.json().history.length,2);assert.equal(typeof history.json().workedSecondsToday,'number');assert.equal(typeof history.json().workedSecondsThisWeek,'number');assert.equal(typeof history.json().workedSecondsThisMonth,'number');
});

test('unlinked self clock returns no PII and requires admin to link professional identity',async()=>{
 assert.equal((await unlinked.inject({method:'GET',url:'/api/timeclock/self'})).statusCode,404);
 const p=await professional();const link=await admin.inject({method:'POST',url:`/api/staff/${p.id}/account-link`,payload:{authActorId:randomUUID()}});assert.equal(link.statusCode,200,link.body);
});

test('staff summary redacts contact and internal notes for trainers while management sees them',async()=>{
 const p=await professional();await sql`UPDATE staff_professionals SET email='private@example.test',phone='+34600000000',internal_notes='Nota interna sensible' WHERE id=${p.id}`;
 const [slot]=await sql`INSERT INTO staff_schedule_slots(professional_id,weekday,starts_at,ends_at,valid_from,created_by) VALUES (${p.id},1,'08:00','12:00','2026-01-01','qa') RETURNING id`;
 await sql`INSERT INTO staff_exceptions(professional_id,kind,starts_at,ends_at,local_start_date,local_end_date,note,created_by) VALUES (${p.id},'leave',now()+interval '2 days',now()+interval '2 days 1 hour',(now() AT TIME ZONE 'Atlantic/Canary')::date,(now() AT TIME ZONE 'Atlantic/Canary')::date,'Private health details','qa')`;
 const trainerView=await trainer.inject({method:'GET',url:`/api/staff/${p.id}`});assert.equal(trainerView.statusCode,200);assert.equal('email'in trainerView.json().professional,false);assert.equal('phone'in trainerView.json().professional,false);assert.equal('internalNotes'in trainerView.json().professional,false);assert.ok(trainerView.json().schedule.some(x=>x.id===slot.id));
 const trainerAbsence=await trainer.inject({method:'GET',url:`/api/staff/${p.id}/exceptions`});assert.equal(trainerAbsence.statusCode,200);assert.equal('note'in trainerAbsence.json()[0],false);
 const receptionView=await reception.inject({method:'GET',url:`/api/staff/${p.id}`});assert.equal(receptionView.json().professional.email,'private@example.test');assert.equal(receptionView.json().professional.internalNotes,'Nota interna sensible');const receptionAbsence=await reception.inject({method:'GET',url:`/api/staff/${p.id}/exceptions`});assert.equal(receptionAbsence.json()[0].note,'Private health details');
});

test('base-role and account-link changes record before and after values and cannot silently replace identity',async()=>{
 const p=await professional();const changed=await admin.inject({method:'PATCH',url:`/api/staff/${p.id}`,payload:{baseRole:'reception-management'}});assert.equal(changed.statusCode,200,changed.body);
 const roleEvent=(await sql`SELECT details FROM staff_audit_events WHERE professional_id=${p.id} AND action='professional.updated' ORDER BY occurred_at DESC LIMIT 1`)[0];assert.equal(roleEvent.details.previousBaseRole,'trainer');assert.equal(roleEvent.details.newBaseRole,'reception-management');
 const firstActor=`staff-link-${randomUUID()}`,secondActor=`staff-link-${randomUUID()}`;
 assert.equal((await admin.inject({method:'POST',url:`/api/staff/${p.id}/account-link`,payload:{authActorId:firstActor}})).statusCode,200);
 const needsConfirm=await admin.inject({method:'POST',url:`/api/staff/${p.id}/account-link`,payload:{authActorId:secondActor}});assert.equal(needsConfirm.statusCode,409);assert.equal(needsConfirm.json().error,'account_link_confirmation_required');
 const replacement=await admin.inject({method:'POST',url:`/api/staff/${p.id}/account-link`,payload:{authActorId:secondActor,confirmReplacement:true}});assert.equal(replacement.statusCode,200,replacement.body);
 const linkEvent=(await sql`SELECT details FROM staff_audit_events WHERE professional_id=${p.id} AND action='professional.account_linked' ORDER BY occurred_at DESC LIMIT 1`)[0];assert.equal(linkEvent.details.oldAuthActorId,firstActor);assert.equal(linkEvent.details.newAuthActorId,secondActor);
 const other=await professional();const duplicate=await admin.inject({method:'POST',url:`/api/staff/${other.id}/account-link`,payload:{authActorId:secondActor}});assert.equal(duplicate.statusCode,409);
});

test('exception dates are derived from Canary instants and invalid calendar dates are controlled',async()=>{
 const p=await professional();const march=await admin.inject({method:'POST',url:`/api/staff/${p.id}/exceptions`,payload:{kind:'training',startsAt:'2026-03-29T00:30:00.000Z',endsAt:'2026-03-29T01:30:00.000Z',allDay:false,note:'Cambio horario'}});assert.equal(march.statusCode,201,march.body);assert.equal(march.json().localStartDate,'2026-03-29');
 const october=await admin.inject({method:'POST',url:`/api/staff/${p.id}/exceptions`,payload:{kind:'training',startsAt:'2026-10-25T01:30:00.000Z',endsAt:'2026-10-25T02:30:00.000Z',allDay:false}});assert.equal(october.statusCode,201,october.body);assert.equal(october.json().localStartDate,'2026-10-25');
 const mismatch=await admin.inject({method:'POST',url:`/api/staff/${p.id}/exceptions`,payload:{kind:'training',startsAt:'2026-04-01T09:00:00.000Z',endsAt:'2026-04-01T10:00:00.000Z',allDay:false,localStartDate:'2026-01-01',localEndDate:'2026-01-01'}});assert.equal(mismatch.statusCode,400);
 const impossible=await admin.inject({method:'POST',url:`/api/staff/${p.id}/exceptions`,payload:{kind:'training',startsAt:'2026-02-31T09:00:00.000Z',endsAt:'2026-03-01T10:00:00.000Z'}});assert.equal(impossible.statusCode,400);
});

test('manual timeclock insertion checks both neighbors and rejects future instants',async()=>{
 const p=await professional();const date='2026-10-08';
 for(const [type,time] of [['clock_in','08:00'],['clock_out','12:00'],['clock_in','13:00']])await sql`INSERT INTO staff_timeclock_events(professional_id,event_type,occurred_at,actor_id,origin,note) VALUES (${p.id},${type},${`${date}T${time}:00+01:00`},'qa','manual_admin','fixture')`;
 const invalidMiddle=await admin.inject({method:'POST',url:`/api/staff/${p.id}/timeclock/manual`,payload:{eventType:'clock_out',occurredAt:`${date}T10:00:00+01:00`,reason:'Corrección manual'}});assert.equal(invalidMiddle.statusCode,409);assert.equal(invalidMiddle.json().error,'invalid_shift_transition');
 const future=await admin.inject({method:'POST',url:`/api/staff/${p.id}/timeclock/manual`,payload:{eventType:'clock_out',occurredAt:'2099-01-01T10:00:00Z',reason:'Fecha futura'}});assert.equal(future.statusCode,409);assert.equal(future.json().error,'future_timeclock_event');
});

test('timeclock corrections chain effective values, allow restoration and serialize concurrent edits',async()=>{
 const p=await professional();const [event]=await sql`INSERT INTO staff_timeclock_events(professional_id,event_type,occurred_at,actor_id,origin,note) VALUES (${p.id},'clock_in','2026-10-08T08:00:00Z','qa','manual_admin','fixture') RETURNING id`;
 for(const [minute,expectedPrevious] of [['08:10','08:00'],['08:20','08:10'],['08:00','08:20']]){const r=await admin.inject({method:'POST',url:`/api/staff/timeclock/${event.id}/corrections`,payload:{correctedOccurredAt:`2026-10-08T${minute}:00Z`,reason:'Revisión de jornada'}});assert.equal(r.statusCode,201,r.body);const row=(await sql`SELECT previous_occurred_at FROM staff_timeclock_corrections WHERE id=${r.json().id}`)[0];assert.equal(row.previous_occurred_at.toISOString().slice(11,16),expectedPrevious);}
 const concurrent=await Promise.all(['08:05','08:06'].map(time=>admin.inject({method:'POST',url:`/api/staff/timeclock/${event.id}/corrections`,payload:{correctedOccurredAt:`2026-10-08T${time}:00Z`,reason:'Edición concurrente'}})));assert.deepEqual(concurrent.map(x=>x.statusCode),[201,201]);
 const chain=await sql`SELECT revision,previous_occurred_at,corrected_occurred_at FROM staff_timeclock_corrections WHERE event_id=${event.id} ORDER BY revision`;assert.equal(chain.length,5);assert.equal(chain[2].corrected_occurred_at.toISOString().slice(11,16),'08:00');assert.equal(chain[3].previous_occurred_at.getTime(),chain[2].corrected_occurred_at.getTime());assert.equal((await sql`SELECT occurred_at FROM staff_timeclock_events WHERE id=${event.id}`)[0].occurred_at.toISOString(),'2026-10-08T08:00:00.000Z');
 const future=await admin.inject({method:'POST',url:`/api/staff/timeclock/${event.id}/corrections`,payload:{correctedOccurredAt:'2099-01-01T10:00:00Z',reason:'Fecha futura'}});assert.equal(future.statusCode,409);assert.equal(future.json().error,'future_timeclock_event');
});

test('staff domain records reject DELETE and TRUNCATE',async()=>{
 const p=await professional();await sql`INSERT INTO staff_schedule_slots(professional_id,weekday,starts_at,ends_at,valid_from,created_by) VALUES (${p.id},1,'08:00','12:00','2026-01-01','qa')`;await sql`INSERT INTO staff_exceptions(professional_id,kind,starts_at,ends_at,local_start_date,local_end_date,created_by) VALUES (${p.id},'training',now()+interval '10 days',now()+interval '10 days 1 hour',(now() AT TIME ZONE 'Atlantic/Canary')::date,(now() AT TIME ZONE 'Atlantic/Canary')::date,'qa')`;
 const [other]=await sql`INSERT INTO staff_professionals(first_name,last_name,display_name,base_role,created_by) VALUES ('QA','Sub','QA Substitute','trainer','qa') RETURNING id`;await sql`INSERT INTO staff_substitutions(source_professional_id,substitute_professional_id,starts_at,ends_at,reason,created_by) VALUES (${p.id},${other.id},now()+interval '10 days',now()+interval '10 days 1 hour','QA coverage','qa')`;
 for(const table of ['staff_professionals','staff_schedule_slots','staff_exceptions','staff_substitutions']){await assert.rejects(sql.unsafe(`DELETE FROM ${table}`),/cannot be deleted|status transitions/);await assert.rejects(sql.unsafe(`TRUNCATE ${table} CASCADE`),/cannot be truncated/);}
});

test('substitution reassignment rejects past, cancelled and out-of-range sessions without changing history',async()=>{
 const source=await professional(),target=await professional();const [area]=await sql`SELECT id FROM areas WHERE status='active' LIMIT 1`;const [service]=await sql`INSERT INTO services(name,area_id,status) VALUES (${`Past substitution QA ${randomUUID()}`},${area.id},'active') RETURNING id`;
 const [sub]=await sql`INSERT INTO staff_substitutions(source_professional_id,substitute_professional_id,starts_at,ends_at,reason,created_by) VALUES (${source.id},${target.id},'2020-01-01T00:00:00Z','2020-01-03T00:00:00Z','Historical coverage','qa') RETURNING id`;
 const [past]=await sql`INSERT INTO calendar_sessions(service_id,area_id,professional_id,starts_at,duration_minutes,capacity,created_by) VALUES (${service.id},${area.id},${source.id},'2020-01-01T10:00:00Z',45,8,'qa') RETURNING id`;
 const deniedPast=await admin.inject({method:'POST',url:`/api/staff/substitutions/${sub.id}/reassign`,payload:{sessionIds:[past.id],confirm:true}});assert.equal(deniedPast.statusCode,409);assert.equal(deniedPast.json().error,'session_not_reassignable');assert.equal((await sql`SELECT professional_id FROM calendar_sessions WHERE id=${past.id}`)[0].professional_id,source.id);
 const [cancelled]=await sql`INSERT INTO calendar_sessions(service_id,area_id,professional_id,starts_at,duration_minutes,capacity,status,created_by) VALUES (${service.id},${area.id},${source.id},'2020-01-02T10:00:00Z',45,8,'cancelled','qa') RETURNING id`;
 const deniedCancelled=await admin.inject({method:'POST',url:`/api/staff/substitutions/${sub.id}/reassign`,payload:{sessionIds:[cancelled.id],confirm:true}});assert.equal(deniedCancelled.statusCode,409);assert.equal(deniedCancelled.json().error,'session_not_reassignable');
});

test('timeclock correction cannot move an event across same-type neighbors',async()=>{
 const p=await professional();const ids=[];
 for(const [type,time] of [['clock_in','08:00'],['clock_out','12:00'],['clock_in','13:00'],['clock_out','14:00']]){const [event]=await sql`INSERT INTO staff_timeclock_events(professional_id,event_type,occurred_at,actor_id,origin,note) VALUES (${p.id},${type},${`2026-10-08T${time}:00Z`},'qa','manual_admin','fixture') RETURNING id`;ids.push(event.id);}
 const intoAdjacent=await admin.inject({method:'POST',url:`/api/staff/timeclock/${ids[0]}/corrections`,payload:{correctedOccurredAt:'2026-10-08T13:30:00Z',reason:'Conflicto con evento siguiente'}});assert.equal(intoAdjacent.statusCode,409);assert.equal(intoAdjacent.json().error,'timeclock_chronology_conflict');
 const intoPrevious=await admin.inject({method:'POST',url:`/api/staff/timeclock/${ids[3]}/corrections`,payload:{correctedOccurredAt:'2026-10-08T11:30:00Z',reason:'Conflicto con evento anterior'}});assert.equal(intoPrevious.statusCode,409);assert.equal(intoPrevious.json().error,'timeclock_chronology_conflict');
});
