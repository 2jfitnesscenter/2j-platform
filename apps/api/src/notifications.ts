import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { TransactionSql } from 'postgres';
import { z } from 'zod';
import { can, type AuthorizationContext } from '@2j/permissions';
import type { createDatabase } from './db.js';
import type { ClientAuthorizationContext } from './communications.js';

type SqlClient = ReturnType<typeof createDatabase>['client'];
type Tx = TransactionSql<Record<string, unknown>>;
export const notificationEventTypes = ['booking.confirmed','booking.cancelled','waitlist.joined','waitlist.promoted','message.created','reminder.booking','entitlement.expiring','entitlement.low_balance','document.pending','staff.substitution','staff.transfer_pending','staff.timeclock_update','staff.cash_legacy_resolved'] as const;
export type NotificationEventType = typeof notificationEventTypes[number];

/** Call from the domain transaction. A rollback therefore removes the event as well. */
export async function appendNotificationEvent(tx: Tx, event: {
  type: NotificationEventType; aggregateType: string; aggregateId: string; dedupeKey: string;
  clientId?: string | null; staffActorId?: string | null; payload?: Record<string, string | number | boolean | null>; availableAt?: Date;
}) {
  const availableAt=(event.availableAt??new Date()).toISOString();
  await tx`INSERT INTO domain_events_outbox(event_type,aggregate_type,aggregate_id,recipient_client_id,recipient_staff_actor_id,payload,dedupe_key,available_at)
    VALUES (${event.type},${event.aggregateType},${event.aggregateId},${event.clientId ?? null},${event.staffActorId ?? null},${JSON.stringify(event.payload ?? {})}::text::jsonb,${event.dedupeKey},${availableAt}::timestamptz)
    ON CONFLICT(dedupe_key) DO NOTHING`;
}

const labels: Record<NotificationEventType, { type: string; title: string; body: string; deeplink: string | null }> = {
  'booking.confirmed': { type:'booking_confirmed', title:'Reserva confirmada', body:'Tu plaza está confirmada.', deeplink:'/bookings' },
  'booking.cancelled': { type:'booking_cancelled', title:'Reserva cancelada', body:'Tu reserva ha sido cancelada.', deeplink:'/bookings' },
  'waitlist.joined': { type:'waitlist_joined', title:'Lista de espera', body:'Te hemos añadido a la lista de espera.', deeplink:'/bookings' },
  'waitlist.promoted': { type:'waitlist_promoted', title:'¡Tienes plaza!', body:'Se ha confirmado tu plaza en la sesión.', deeplink:'/bookings' },
  'message.created': { type:'message_received', title:'Nuevo mensaje del centro', body:'El centro te ha enviado un mensaje.', deeplink:null },
  'reminder.booking': { type:'booking_reminder', title:'Tu próxima sesión', body:'Recuerda que tienes una sesión próximamente.', deeplink:'/bookings' },
  'entitlement.expiring': { type:'entitlement_expiring', title:'Tu plan está por terminar', body:'Revisa la vigencia de uno de tus planes.', deeplink:'/profile' },
  'entitlement.low_balance': { type:'entitlement_low_balance', title:'Te quedan pocas sesiones', body:'Consulta el saldo disponible de tu bono.', deeplink:'/profile' },
  'document.pending': { type:'document_pending', title:'Documento pendiente', body:'Tienes un documento del centro pendiente de completar.', deeplink:'/profile' },
  'staff.substitution': { type:'staff_substitution', title:'Cambio de cobertura', body:'Hay una actualización sobre una cobertura de equipo.', deeplink:'/agenda' },
  'staff.transfer_pending': { type:'staff_transfer_pending', title:'Validación pendiente', body:'Hay una operación pendiente de revisión en Gestión.', deeplink:'/economics' },
  'staff.timeclock_update': { type:'staff_timeclock_update', title:'Fichaje actualizado', body:'Se ha actualizado un registro de tu jornada.', deeplink:'/team' },
  'staff.cash_legacy_resolved': { type:'staff_cash_legacy_resolved', title:'Caja anterior resuelta', body:'El propietario ha resuelto una caja anterior pendiente.', deeplink:'/economics' },
};

/** Durable, replay-safe dispatcher. Delivery here means persisted in-app inbox, never provider push. */
export async function dispatchNotificationBatch(db: SqlClient, batchSize = 50, now = new Date()) {
  const nowIso = now.toISOString();
  const staleBeforeIso = new Date(now.getTime() - 5 * 60_000).toISOString();
  const rows = await db.begin(async (tx) => tx`WITH picked AS (
      SELECT id FROM domain_events_outbox WHERE (status='pending' AND available_at<=${nowIso}) OR (status='processing' AND locked_at<${staleBeforeIso})
      ORDER BY occurred_at,id FOR UPDATE SKIP LOCKED LIMIT ${Math.max(1,Math.min(batchSize,200))}
    ) UPDATE domain_events_outbox o SET status='processing',locked_at=${nowIso},attempts=o.attempts+1 FROM picked WHERE o.id=picked.id
      RETURNING o.id,o.event_type AS type,o.aggregate_type AS "aggregateType",o.aggregate_id AS "aggregateId",o.recipient_client_id AS "clientId",o.recipient_staff_actor_id AS "staffActorId",o.payload,o.dedupe_key AS "dedupeKey",o.attempts`);
  let delivered = 0;
  for (const row of rows) {
    try {
      await db.begin(async (tx) => {
        const label = labels[row.type as NotificationEventType];
        if (!label) throw new Error('unsupported_event');
        if (row.clientId) await tx`INSERT INTO notifications(recipient_kind,recipient_id,event_id,type,title,body,deeplink,dedupe_key)
          VALUES ('client',${row.clientId},${row.id},${label.type},${label.title},${label.body},${label.deeplink},${row.dedupeKey}) ON CONFLICT(recipient_kind,recipient_id,dedupe_key) DO NOTHING`;
        if (row.staffActorId) await tx`INSERT INTO notifications(recipient_kind,recipient_id,event_id,type,title,body,deeplink,dedupe_key)
          VALUES ('staff',${row.staffActorId},${row.id},${label.type},${label.title},${label.body},'/agenda',${row.dedupeKey}) ON CONFLICT(recipient_kind,recipient_id,dedupe_key) DO NOTHING`;
        if (row.type === 'message.created' && (row.payload as any)?.senderKind === 'client') {
          const staff = await tx`SELECT auth_actor_id AS actor_id,base_role AS role FROM staff_professionals WHERE status='active' AND auth_actor_id IS NOT NULL`;
          for (const person of staff) {
            const role = person.role as AuthorizationContext['role'];
            if (!['admin','trainer','reception-management','accountant'].includes(role)) continue;
            const context = { actorId: person.actor_id, role } as AuthorizationContext;
            if (can(context,'communication.read')) await tx`INSERT INTO notifications(recipient_kind,recipient_id,event_id,type,title,body,deeplink,dedupe_key)
              VALUES ('staff',${person.actor_id},${row.id},'message_received','Nuevo mensaje','Un cliente ha enviado un mensaje.','/messages',${row.dedupeKey}) ON CONFLICT(recipient_kind,recipient_id,dedupe_key) DO NOTHING`;
          }
        }
        await tx`UPDATE domain_events_outbox SET status='delivered',delivered_at=${nowIso},locked_at=NULL,last_error_code=NULL WHERE id=${row.id} AND status='processing'`;
      });
      delivered++;
    } catch {
      const attempts = Number(row.attempts);
      const delayMs = Math.min(60*60_000, 1_000 * 2 ** Math.min(attempts, 12));
      await db`UPDATE domain_events_outbox SET status=${attempts>=8?'dead_letter':'pending'},available_at=${new Date(now.getTime()+delayMs).toISOString()},locked_at=NULL,last_error_code='dispatch_failed' WHERE id=${row.id} AND status='processing'`;
    }
  }
  return { claimed: rows.length, delivered };
}

/** Minute-window scheduler; unique dedupe keys make overlapping/restarted schedulers safe. */
export async function enqueueDueBookingReminders(db: SqlClient, now = new Date()) {
  const nowIso = now.toISOString();
  const horizonIso = new Date(now.getTime() + 90 * 24 * 60 * 60_000).toISOString();
  return db.begin(async (tx) => {
    const [settings] = await tx`SELECT booking_reminders_enabled AS enabled,booking_reminder_minutes AS minutes,entitlement_expiry_enabled AS entitlement_expiry_enabled,entitlement_expiry_days AS entitlement_expiry_days,low_balance_enabled AS low_balance_enabled,low_balance_threshold AS low_balance_threshold,document_reminders_enabled AS document_reminders_enabled FROM notification_settings WHERE center_key='2j'`;
    if (!settings) return 0;
    let count = 0;
    const rows = settings.enabled ? await tx`SELECT r.id AS "reservationId",r.client_id AS "clientId",s.starts_at AS "startsAt"
      FROM calendar_reservations r JOIN calendar_sessions s ON s.id=r.session_id
      WHERE r.status='reserved' AND s.status='scheduled' AND s.starts_at>${nowIso} AND s.starts_at<=${horizonIso} ORDER BY s.starts_at,r.id LIMIT 1000` : [];
    for (const row of rows) { const dueAt=new Date(new Date(row.startsAt).getTime()-Number(settings.minutes)*60_000);await appendNotificationEvent(tx,{type:'reminder.booking',aggregateType:'calendar_reservation',aggregateId:row.reservationId,clientId:row.clientId,dedupeKey:`booking-reminder:${row.reservationId}:${new Date(row.startsAt).toISOString()}`,availableAt:dueAt>now?dueAt:now}); count++; }
    if (settings.entitlement_expiry_enabled) {
      const expiring = await tx`SELECT id,client_id AS "clientId",ends_on AS "endsOn" FROM client_plan_assignments WHERE status='active' AND ends_on BETWEEN (now() AT TIME ZONE 'Atlantic/Canary')::date AND (now() AT TIME ZONE 'Atlantic/Canary')::date+${Number(settings.entitlement_expiry_days)}::int ORDER BY ends_on,id`;
      for (const row of expiring) { await appendNotificationEvent(tx,{type:'entitlement.expiring',aggregateType:'client_plan_assignment',aggregateId:row.id,clientId:row.clientId,dedupeKey:`assignment-expiring:${row.id}:${row.endsOn}`}); count++; }
    }
    if (settings.low_balance_enabled) {
      const low = await tx`SELECT a.id,a.client_id AS "clientId",r.id AS "rightId",COALESCE(sum(l.quantity),0)::int AS balance FROM client_plan_assignments a JOIN plan_rights r ON r.plan_id=a.plan_id AND r.plan_version=a.plan_version AND r.right_type='sessions_quota' LEFT JOIN client_entitlement_ledger l ON l.assignment_id=a.id AND l.right_key=r.id::text WHERE a.status='active' GROUP BY a.id,a.client_id,r.id HAVING COALESCE(sum(l.quantity),0)<=${Number(settings.low_balance_threshold)} AND COALESCE(sum(l.quantity),0)>=0`;
      for (const row of low) { await appendNotificationEvent(tx,{type:'entitlement.low_balance',aggregateType:'client_plan_assignment',aggregateId:row.id,clientId:row.clientId,dedupeKey:`low-balance:${row.id}:${row.rightId}:${settings.low_balance_threshold}`}); count++; }
    }
    if (settings.document_reminders_enabled) {
      const docs = await tx`SELECT id,client_id AS "clientId" FROM client_form_assignments WHERE status IN ('assigned','rejected') AND (due_at IS NULL OR due_at>(now()-interval '1 day')) AND (due_at IS NULL OR due_at<=now()+interval '7 days') ORDER BY due_at NULLS LAST,id`;
      for (const row of docs) { await appendNotificationEvent(tx,{type:'document.pending',aggregateType:'client_form_assignment',aggregateId:row.id,clientId:row.clientId,dedupeKey:`document-pending:${row.id}`}); count++; }
    }
    return count;
  });
}

function notificationRoutes(app: FastifyInstance, db: SqlClient, kind: 'client'|'staff', resolve: (request: FastifyRequest) => Promise<string|null>) {
  app.get(`/api/${kind === 'client' ? 'me' : 'staff'}/notifications`, async (request, reply) => {
    reply.header('Cache-Control','no-store');
    const recipient = await resolve(request); if (!recipient) return reply.code(401).send({error:`${kind}_authentication_required`});
    const query = z.object({ before: z.string().datetime({offset:true}).optional(), beforeId:z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }).strict().superRefine((value,ctx)=>{if(Boolean(value.before)!==Boolean(value.beforeId))ctx.addIssue({code:'custom',message:'Cursor incompleto'});}).safeParse(request.query);
    if (!query.success) return reply.code(400).send({error:'validation_error'});
    const rows = await db`SELECT id,type,title,body,deeplink,created_at AS "createdAt",read_at AS "readAt" FROM notifications
      WHERE recipient_kind=${kind} AND recipient_id=${recipient} AND (${query.data.before ?? null}::timestamptz IS NULL OR (created_at,id)<(${query.data.before ?? null}::timestamptz,${query.data.beforeId ?? '00000000-0000-0000-0000-000000000000'}::uuid))
      ORDER BY created_at DESC,id DESC LIMIT ${query.data.limit+1}`;
    const last=rows.length>query.data.limit?rows[query.data.limit-1]:null;
    return { items: rows.slice(0,query.data.limit), nextBefore: last?.createdAt ?? null, nextBeforeId:last?.id ?? null };
  });
  app.get(`/api/${kind === 'client' ? 'me' : 'staff'}/notifications/unread-count`, async (request, reply) => {
    const recipient = await resolve(request); if (!recipient) return reply.code(401).send({error:`${kind}_authentication_required`});
    const [row] = await db`SELECT count(*)::int AS count FROM notifications WHERE recipient_kind=${kind} AND recipient_id=${recipient} AND read_at IS NULL`;
    return { count: row?.count ?? 0 };
  });
  app.patch(`/api/${kind === 'client' ? 'me' : 'staff'}/notifications/:notificationId/read`, async (request, reply) => {
    const recipient = await resolve(request); if (!recipient) return reply.code(401).send({error:`${kind}_authentication_required`});
    const params = z.object({notificationId:z.string().uuid()}).safeParse(request.params); if(!params.success)return reply.code(400).send({error:'validation_error'});
    const [row] = await db`UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE id=${params.data.notificationId} AND recipient_kind=${kind} AND recipient_id=${recipient} RETURNING id,read_at AS "readAt"`;
    if (!row) return reply.code(404).send({error:'notification_not_found'});
    return row;
  });
  app.post(`/api/${kind === 'client' ? 'me' : 'staff'}/notifications/read-all`, async (request, reply) => {
    const recipient = await resolve(request); if (!recipient) return reply.code(401).send({error:`${kind}_authentication_required`});
    const [row] = await db`WITH changed AS (UPDATE notifications SET read_at=now() WHERE recipient_kind=${kind} AND recipient_id=${recipient} AND read_at IS NULL RETURNING 1) SELECT count(*)::int AS count FROM changed`;
    return {updated:row?.count ?? 0};
  });
}

export function registerNotificationRoutes(app: FastifyInstance, db: SqlClient, auth: (request: FastifyRequest)=>Promise<AuthorizationContext|null>, clientAuth: (request: FastifyRequest)=>Promise<ClientAuthorizationContext|null>) {
  notificationRoutes(app,db,'client',async request=>(await clientAuth(request))?.clientId ?? null);
  notificationRoutes(app,db,'staff',async request=>(await auth(request))?.actorId ?? null);
  app.get('/api/settings/notifications',async(request,reply)=>{const actor=await auth(request);if(!actor)return reply.code(401).send({error:'authentication_required'});if(!can(actor,'settings.manage'))return reply.code(403).send({error:'permission_denied'});const [settings]=await db`SELECT booking_reminders_enabled AS "bookingRemindersEnabled",booking_reminder_minutes AS "bookingReminderMinutes",entitlement_expiry_enabled AS "entitlementExpiryEnabled",entitlement_expiry_days AS "entitlementExpiryDays",low_balance_enabled AS "lowBalanceEnabled",low_balance_threshold AS "lowBalanceThreshold",document_reminders_enabled AS "documentRemindersEnabled" FROM notification_settings WHERE center_key='2j'`;return settings;});
  app.patch('/api/settings/booking-reminders',async(request,reply)=>{const actor=await auth(request);if(!actor)return reply.code(401).send({error:'authentication_required'});if(!can(actor,'settings.manage'))return reply.code(403).send({error:'permission_denied'});const body=z.object({bookingRemindersEnabled:z.boolean(),bookingReminderMinutes:z.number().int().min(15).max(10080)}).strict().safeParse(request.body);if(!body.success)return reply.code(400).send({error:'validation_error'});const [settings]=await db`UPDATE notification_settings SET booking_reminders_enabled=${body.data.bookingRemindersEnabled},booking_reminder_minutes=${body.data.bookingReminderMinutes},updated_at=now() WHERE center_key='2j' RETURNING booking_reminders_enabled AS "bookingRemindersEnabled",booking_reminder_minutes AS "bookingReminderMinutes"`;return settings;});
  app.put('/api/settings/notifications',async(request,reply)=>{const actor=await auth(request);if(!actor)return reply.code(401).send({error:'authentication_required'});if(!can(actor,'settings.manage'))return reply.code(403).send({error:'permission_denied'});const body=z.object({bookingRemindersEnabled:z.boolean(),bookingReminderMinutes:z.number().int().min(15).max(10080),entitlementExpiryEnabled:z.boolean(),entitlementExpiryDays:z.number().int().min(1).max(90),lowBalanceEnabled:z.boolean(),lowBalanceThreshold:z.number().int().min(0).max(100),documentRemindersEnabled:z.boolean()}).strict().safeParse(request.body);if(!body.success)return reply.code(400).send({error:'validation_error'});const s=body.data;await db`UPDATE notification_settings SET booking_reminders_enabled=${s.bookingRemindersEnabled},booking_reminder_minutes=${s.bookingReminderMinutes},entitlement_expiry_enabled=${s.entitlementExpiryEnabled},entitlement_expiry_days=${s.entitlementExpiryDays},low_balance_enabled=${s.lowBalanceEnabled},low_balance_threshold=${s.lowBalanceThreshold},document_reminders_enabled=${s.documentRemindersEnabled},updated_at=now() WHERE center_key='2j'`;return {updated:true};});
}
