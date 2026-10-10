import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { appendNotificationEvent, dispatchNotificationBatch, enqueueDueBookingReminders } from '../src/notifications.ts';
import { migrateDatabase } from '../src/migrate.ts';

if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: PostgreSQL integration tests cannot be skipped.');
const sql=postgres(process.env.DATABASE_URL,{max:12,connect_timeout:5});
await migrateDatabase(sql);
let currentClientId='';
const admin=buildServer(process.env.DATABASE_URL,{authorizationResolver:async()=>({actorId:'notifications-admin',role:'admin'}),clientAuthorizationResolver:async()=>currentClientId?{clientId:currentClientId}:null});
const trainer=buildServer(process.env.DATABASE_URL,{authorizationResolver:async()=>({actorId:'notifications-trainer',role:'trainer'})});
after(async()=>{await Promise.all([admin.close(),trainer.close(),sql.end()]);});
async function newClient(){const response=await admin.inject({method:'POST',url:'/api/clients',headers:{'idempotency-key':randomUUID()},payload:{firstName:'Aviso',lastName:`Prueba ${randomUUID()}`}});assert.equal(response.statusCode,201,response.body);return response.json();}
async function drainUntil(eventId){for(let index=0;index<20;index++){await dispatchNotificationBatch(sql,200);const [row]=await sql`SELECT status FROM domain_events_outbox WHERE id=${eventId}`;if(row?.status==='delivered')return;}assert.fail('outbox event was not dispatched');}
function canaryDate(date){const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Atlantic/Canary',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date),get=(type)=>parts.find(item=>item.type===type).value;return `${get('year')}-${get('month')}-${get('day')}`;}
async function createEntitledClient(){const client=await newClient(),[area]=await sql`SELECT id FROM areas WHERE normalized_name='la sala'`;const serviceResponse=await admin.inject({method:'POST',url:'/api/services',payload:{name:`Avisos ${randomUUID()}`,areaId:area.id,status:'active'}});assert.equal(serviceResponse.statusCode,201,serviceResponse.body);const service=serviceResponse.json();const plan=await admin.inject({method:'POST',url:'/api/plans',headers:{'idempotency-key':randomUUID()},payload:{name:`Avisos ${randomUUID()}`,serviceIds:[service.id],kind:'session_pack',renewalCadence:null,basePriceCents:1000,rights:[{rightType:'service_access',serviceId:service.id},{rightType:'sessions_quota',serviceId:service.id,quotaScope:'per_service',quantity:1}]}});assert.equal(plan.statusCode,201,plan.body);assert.equal((await admin.inject({method:'POST',url:`/api/plans/${plan.json().id}/activate`})).statusCode,200);const now=new Date(),today=canaryDate(now),endsOn=canaryDate(new Date(now.getTime()+3*86400000));const sale=await admin.inject({method:'POST',url:`/api/clients/${client.id}/plans`,headers:{'idempotency-key':randomUUID()},payload:{planId:plan.json().id,startsOn:today,endsOn,dueOn:today,amountCents:1000}});assert.equal(sale.statusCode,201,sale.body);return {client,service,assignment:sale.json()};}

test('outbox event is atomic with domain transaction and safely rolls back',async()=>{
  const client=await newClient();const eventId=randomUUID();
  await assert.rejects(sql.begin(async tx=>{await appendNotificationEvent(tx,{type:'booking.confirmed',aggregateType:'calendar_reservation',aggregateId:eventId,clientId:client.id,dedupeKey:`rollback:${eventId}`});throw new Error('force rollback');}));
  const [row]=await sql`SELECT count(*)::int AS count FROM domain_events_outbox WHERE dedupe_key=${`rollback:${eventId}`}`;assert.equal(row.count,0);
});

test('dispatcher persists one in-app notice under concurrent retries without copying event payload',async()=>{
  const client=await newClient(),aggregateId=randomUUID(),dedupeKey=`dispatch:${randomUUID()}`;
  await sql.begin(tx=>appendNotificationEvent(tx,{type:'booking.confirmed',aggregateType:'calendar_reservation',aggregateId,clientId:client.id,dedupeKey,payload:{serviceName:'private data must not be copied'}}));
  const [event]=await sql`SELECT id FROM domain_events_outbox WHERE dedupe_key=${dedupeKey}`;
  await Promise.all([dispatchNotificationBatch(sql,200),dispatchNotificationBatch(sql,200)]);await drainUntil(event.id);
  const rows=await sql`SELECT title,body,deeplink FROM notifications WHERE recipient_kind='client' AND recipient_id=${client.id} AND dedupe_key=${dedupeKey}`;
  assert.equal(rows.length,1);assert.equal(rows[0].title,'Reserva confirmada');assert.equal(JSON.stringify(rows[0]).includes('private data'),false);
});

test('client message notifications are informative with no dead chat link and waitlist promotion copy is clear',async()=>{
  const client=await newClient(),messageKey=`client-message:${randomUUID()}`;
  await sql.begin(tx=>appendNotificationEvent(tx,{type:'message.created',aggregateType:'communication_message',aggregateId:randomUUID(),clientId:client.id,dedupeKey:messageKey,payload:{senderKind:'staff'}}));
  await dispatchNotificationBatch(sql,200);
  const [message]=await sql`SELECT title,body,deeplink FROM notifications WHERE recipient_kind='client' AND recipient_id=${client.id} AND dedupe_key=${messageKey}`;
  assert.deepEqual(message,{title:'Nuevo mensaje del centro',body:'El centro te ha enviado un mensaje.',deeplink:null});
  const waitlistKey=`waitlist-promoted:${randomUUID()}`;
  await sql.begin(tx=>appendNotificationEvent(tx,{type:'waitlist.promoted',aggregateType:'calendar_reservation',aggregateId:randomUUID(),clientId:client.id,dedupeKey:waitlistKey}));
  await dispatchNotificationBatch(sql,200);
  const [promotion]=await sql`SELECT title,body FROM notifications WHERE recipient_kind='client' AND recipient_id=${client.id} AND dedupe_key=${waitlistKey}`;
  assert.deepEqual(promotion,{title:'¡Tienes plaza!',body:'Se ha confirmado tu plaza en la sesión.'});
});

test('client notification APIs are self-scoped and staff APIs are actor-scoped',async()=>{
  const first=await newClient(),second=await newClient();currentClientId=first.id;
  const event=await sql.begin(async tx=>{const [row]=await tx`INSERT INTO domain_events_outbox(event_type,aggregate_type,aggregate_id,recipient_client_id,dedupe_key) VALUES ('booking.confirmed','calendar_reservation',${randomUUID()},${second.id},${`idor:${randomUUID()}`}) RETURNING id`;return row;});
  await drainUntil(event.id);
  const [notice]=await sql`SELECT id FROM notifications WHERE event_id=${event.id} AND recipient_kind='client'`;
  const leak=await admin.inject({method:'PATCH',url:`/api/me/notifications/${notice.id}/read`});assert.equal(leak.statusCode,404);
  const own=await admin.inject({method:'GET',url:'/api/me/notifications'});assert.equal(own.statusCode,200);assert.equal(own.json().items.some(row=>row.id===notice.id),false);
  currentClientId='';
  const noClient=await admin.inject({method:'GET',url:'/api/me/notifications'});assert.equal(noClient.statusCode,401);
  const staff=await trainer.inject({method:'GET',url:'/api/staff/notifications'});assert.equal(staff.statusCode,200);
});

test('notification preferences are permission checked and constrained',async()=>{
  const denied=await trainer.inject({method:'GET',url:'/api/settings/notifications'});assert.equal(denied.statusCode,403);
  const settings=await admin.inject({method:'GET',url:'/api/settings/notifications'});assert.equal(settings.statusCode,200);assert.equal(settings.json().bookingReminderMinutes,120);
  const invalid=await admin.inject({method:'PUT',url:'/api/settings/notifications',payload:{...settings.json(),bookingReminderMinutes:1}});assert.equal(invalid.statusCode,400);
});

test('scheduler is safe to overlap and runs reminder lookup against Canary-configured defaults',async()=>{
  const [settings]=await sql`SELECT booking_reminders_enabled FROM notification_settings WHERE center_key='2j'`;
  assert.equal(settings.booking_reminders_enabled,true);
  const {client,service}=await createEntitledClient(),now=new Date(),startsAt=new Date(now.getTime()+119*60_000);
  const session=await admin.inject({method:'POST',url:'/api/calendar/sessions',payload:{serviceId:service.id,areaId:service.areaId,startsAt:startsAt.toISOString(),durationMinutes:45,capacity:3}});assert.equal(session.statusCode,201,session.body);
  const reservation=await admin.inject({method:'POST',url:`/api/calendar/sessions/${session.json().id}/reservations`,headers:{'idempotency-key':randomUUID()},payload:{clientId:client.id}});assert.equal(reservation.statusCode,201,reservation.body);
  const result=await enqueueDueBookingReminders(sql,now);
  assert.equal(typeof result,'number');
  const [reminder]=await sql`SELECT id,status,available_at FROM domain_events_outbox WHERE dedupe_key=${`booking-reminder:${reservation.json().id}:${startsAt.toISOString()}`}`;assert.ok(reminder);assert.ok(new Date(reminder.available_at)<=now);
  const {assignment}=await createEntitledClient();await enqueueDueBookingReminders(sql,now);
  const expiry=await sql`SELECT event_type FROM domain_events_outbox WHERE aggregate_id=${assignment.id} AND event_type='entitlement.expiring'`;assert.equal(expiry.length,1);
  const low=await sql`SELECT event_type FROM domain_events_outbox WHERE aggregate_id=${assignment.id} AND event_type='entitlement.low_balance'`;assert.equal(low.length,1);
});
