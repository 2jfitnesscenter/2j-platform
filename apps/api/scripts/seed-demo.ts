import { createDatabase } from '../src/db.js';
import { createHash } from 'node:crypto';

const clients = [
  ['d0700000-0000-4000-8000-000000000001', 'María', 'González', 'maria.gonzalez@example.test'],
  ['d0700000-0000-4000-8000-000000000002', 'Álvaro', 'Martín', 'alvaro.martin@example.test'],
  ['d0700000-0000-4000-8000-000000000003', 'Lucía', 'Díaz', 'lucia.diaz@example.test'],
  ['d0700000-0000-4000-8000-000000000004', 'Diego', 'Suárez', 'diego.suarez@example.test'],
  ['d0700000-0000-4000-8000-000000000005', 'Paula', 'Navarro', 'paula.navarro@example.test'],
  ['d0700000-0000-4000-8000-000000000006', 'Hugo', 'Vega', 'hugo.vega@example.test'],
  ['d0700000-0000-4000-8000-000000000007', 'Carla', 'Romero', 'carla.romero@example.test'],
  ['d0700000-0000-4000-8000-000000000008', 'Mateo', 'Cruz', 'mateo.cruz@example.test'],
  ['d0700000-0000-4000-8000-000000000009', 'Elena', 'León', 'elena.leon@example.test'],
  ['d0700000-0000-4000-8000-000000000010', 'Pablo', 'Molina', 'pablo.molina@example.test'],
  ['d0700000-0000-4000-8000-000000000011', 'Sara', 'Gil', 'sara.gil@example.test'],
  ['d0700000-0000-4000-8000-000000000012', 'Nico', 'Herrera', 'nico.herrera@example.test'],
].map(([id, first, last, email]) => ({ id, first, last, email }));

export async function seedDemoData(client: ReturnType<typeof createDatabase>['client']) {
  await client.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(2079079)`;
    const demoProfessionalId = 'd0700000-0000-4000-8000-000000000101';
    const trainerActorId = 'local-demo:trainer';
    const [existingTrainerLink] = await tx`SELECT id FROM staff_professionals
      WHERE auth_actor_id=${trainerActorId} AND id<>${demoProfessionalId}::uuid FOR UPDATE`;
    if (existingTrainerLink) {
      throw new Error(`Demo trainer actor is already linked to another professional (${existingTrainerLink.id}); refusing to replace that link.`);
    }
    for (const person of clients) {
      await tx`INSERT INTO clients(id,first_name,last_name,email,status)
        VALUES (${person.id}::uuid,${person.first},${person.last},${person.email},'active') ON CONFLICT(id) DO NOTHING`;
      await tx`INSERT INTO client_events(client_id,event_type,actor_id)
        SELECT ${person.id}::uuid,'client.created','2j-demo-seed'
        WHERE NOT EXISTS (SELECT 1 FROM client_events WHERE client_id=${person.id}::uuid AND event_type='client.created' AND actor_id='2j-demo-seed')`;
    }

    for (const [areaName, serviceName, serviceId] of [
      ['La Sala','Fuerza funcional','d0700000-0000-4000-8000-000000000801'],
      ['El Búnker','Acondicionamiento','d0700000-0000-4000-8000-000000000802'],
      ['El Estudio','Pilates','d0700000-0000-4000-8000-000000000803'],
      ['Entrenamiento personal','Sesión individual','d0700000-0000-4000-8000-000000000804'],
    ] as const) {
      await tx`INSERT INTO services(id,area_id,name,status)
        SELECT ${serviceId}::uuid,a.id,${serviceName},'active' FROM areas a
        WHERE a.name=${areaName} AND a.status='active'
          AND NOT EXISTS (SELECT 1 FROM services s WHERE s.area_id=a.id AND lower(s.name)=lower(${serviceName}) AND s.status<>'archived')
        ON CONFLICT(id) DO NOTHING`;
    }
    const services = await tx`SELECT s.id AS service_id,s.area_id
      FROM services s JOIN areas a ON a.id=s.area_id
      WHERE s.status='active' AND a.status='active' ORDER BY a.name,s.name LIMIT 2`;
    if (services.length === 0) throw new Error('No active 2J services are available in this demo database.');

    await tx`INSERT INTO staff_professionals(id,first_name,last_name,display_name,email,status,base_role,created_by,auth_actor_id)
      VALUES (${demoProfessionalId}::uuid,'Alex','Rivera','Alex Rivera','alex.rivera@example.test','active','trainer','2j-demo-seed',${trainerActorId})
      ON CONFLICT(id) DO NOTHING`;
    const [demoProfessional] = await tx`SELECT auth_actor_id FROM staff_professionals WHERE id=${demoProfessionalId}::uuid FOR UPDATE`;
    if (demoProfessional.auth_actor_id != null && demoProfessional.auth_actor_id !== trainerActorId) {
      throw new Error(`Synthetic demo professional ${demoProfessionalId} is already linked to another actor; refusing to replace that link.`);
    }
    if (demoProfessional.auth_actor_id == null) {
      await tx`UPDATE staff_professionals SET auth_actor_id=${trainerActorId},updated_at=now() WHERE id=${demoProfessionalId}::uuid AND auth_actor_id IS NULL`;
    }

    const mainService = services[0];
    await seedMemberPilot(tx, mainService.service_id);
    const sessionId = 'd0700000-0000-4000-8000-000000000201';
    await tx`INSERT INTO calendar_sessions(id,service_id,area_id,source,starts_at,duration_minutes,capacity,status,created_by,professional_id)
      VALUES (${sessionId}::uuid,${mainService.service_id},${mainService.area_id},'manual',
        (date_trunc('day',now() AT TIME ZONE 'Atlantic/Canary') AT TIME ZONE 'Atlantic/Canary') + interval '17 hours',60,8,'scheduled','2j-demo-seed','d0700000-0000-4000-8000-000000000101')
      ON CONFLICT(id) DO NOTHING`;
    await tx`INSERT INTO calendar_reservations(id,session_id,client_id,entitlement_reference,status,created_by)
      VALUES ('d0700000-0000-4000-8000-000000000301'::uuid,${sessionId}::uuid,'d0700000-0000-4000-8000-000000000001'::uuid,'demo-entitlement-1','reserved','2j-demo-seed'),
             ('d0700000-0000-4000-8000-000000000302'::uuid,${sessionId}::uuid,'d0700000-0000-4000-8000-000000000002'::uuid,'demo-entitlement-2','reserved','2j-demo-seed'),
             ('d0700000-0000-4000-8000-000000000303'::uuid,${sessionId}::uuid,'d0700000-0000-4000-8000-000000000003'::uuid,'demo-entitlement-3','reserved','2j-demo-seed')
      ON CONFLICT(id) DO NOTHING`;
    await tx`INSERT INTO calendar_waitlist_entries(id,session_id,client_id,entitlement_reference,status,created_by)
      VALUES ('d0700000-0000-4000-8000-000000000401'::uuid,${sessionId}::uuid,'d0700000-0000-4000-8000-000000000004'::uuid,'demo-entitlement-4','waiting','2j-demo-seed')
      ON CONFLICT(id) DO NOTHING`;

    await tx`INSERT INTO economic_charges(id,client_id,concept,amount_cents,due_on,state,created_by,idempotency_key,request_hash)
      VALUES ('d0700000-0000-4000-8000-000000000501'::uuid,'d0700000-0000-4000-8000-000000000005'::uuid,'Cuota mensual · demo',4900,
        (now() AT TIME ZONE 'Atlantic/Canary')::date - 3,'pending','2j-demo-seed',
        'd0700000-0000-4000-8000-000000000601'::uuid,repeat('7',64))
      ON CONFLICT(id) DO NOTHING`;

    await tx`INSERT INTO communication_conversations(id,center_key,client_id,status,last_message_at)
      VALUES ('d0700000-0000-4000-8000-000000000701'::uuid,'2j','d0700000-0000-4000-8000-000000000006'::uuid,'active',now())
      ON CONFLICT(id) DO NOTHING`;
    await tx`INSERT INTO communication_messages(id,conversation_id,sender_kind,sender_actor_id,body,idempotency_key)
      VALUES ('d0700000-0000-4000-8000-000000000702'::uuid,'d0700000-0000-4000-8000-000000000701'::uuid,'client','demo-client','¡Hola! ¿Podemos confirmar mi próxima sesión?','d0700000-0000-4000-8000-000000000703'::uuid)
      ON CONFLICT(id) DO NOTHING`;
  });
}

const memberPilot = [
  { clientId: 'd0700000-0000-4000-8000-000000000001', personId: 'd0840000-0000-4000-8000-000000000001', subject: 'member-a', code: '2j-member-a-local' },
  { clientId: 'd0700000-0000-4000-8000-000000000002', personId: 'd0840000-0000-4000-8000-000000000002', subject: 'member-b', code: '2j-member-b-local' },
] as const;
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

async function seedMemberPilot(tx: Parameters<Parameters<ReturnType<typeof createDatabase>['client']['begin']>[0]>[0], serviceId: string) {
  const actor = '2j-demo-seed';
  for (const member of memberPilot) {
    const clientId = member.clientId;
    const personId = member.personId;
    await tx`INSERT INTO platform_persons(id,status,created_by) VALUES (${personId}::uuid,'active',${actor}) ON CONFLICT(id) DO NOTHING`;
    const [person] = await tx`SELECT status FROM platform_persons WHERE id=${personId}::uuid`;
    if (person?.status !== 'active') throw new Error(`Synthetic member identity ${personId} is not active; refusing to repair it.`);
    await tx`INSERT INTO platform_identity_audit_events(person_id,actor_id,action,resource_id)
      SELECT ${personId}::uuid,${actor},'person.created',${personId}::uuid WHERE NOT EXISTS
      (SELECT 1 FROM platform_identity_audit_events WHERE person_id=${personId}::uuid AND action='person.created' AND resource_id=${personId}::uuid)`;
    await tx`INSERT INTO platform_person_clients(person_id,client_id,linked_by) VALUES (${personId}::uuid,${clientId}::uuid,${actor}) ON CONFLICT(person_id,client_id) DO NOTHING`;
    const [facet] = await tx`SELECT client_id FROM platform_person_clients WHERE person_id=${personId}::uuid`;
    if (facet?.client_id !== clientId) throw new Error(`Synthetic member identity ${personId} is linked to a different client; refusing to change it.`);
    await tx`INSERT INTO platform_identity_audit_events(person_id,actor_id,action,resource_id)
      SELECT ${personId}::uuid,${actor},'person.client_linked',${clientId}::uuid WHERE NOT EXISTS
      (SELECT 1 FROM platform_identity_audit_events WHERE person_id=${personId}::uuid AND action='person.client_linked' AND resource_id=${clientId}::uuid)`;
    await tx`INSERT INTO platform_person_auth_subjects(person_id,auth_subject,provider,provider_version,status,created_by)
      VALUES (${personId}::uuid,${member.subject},'platform-pilot',1,'active',${actor}) ON CONFLICT(provider,auth_subject) DO NOTHING`;
    const [subject] = await tx`SELECT id,person_id,status FROM platform_person_auth_subjects WHERE provider='platform-pilot' AND auth_subject=${member.subject}`;
    if (!subject || subject.person_id !== personId || subject.status !== 'active') throw new Error(`Synthetic member login subject ${member.subject} is not safely bound to its expected active person.`);
    await tx`INSERT INTO platform_identity_audit_events(person_id,actor_id,action,resource_id)
      SELECT ${personId}::uuid,${actor},'person.auth_subject_linked',${subject.id} WHERE NOT EXISTS
      (SELECT 1 FROM platform_identity_audit_events WHERE person_id=${personId}::uuid AND action='person.auth_subject_linked' AND resource_id=${subject.id})`;
    const codeHash = sha256(member.code);
    await tx`INSERT INTO platform_member_pilot_credentials(auth_subject_link_id,code_hash,status)
      VALUES (${subject.id},${codeHash},'active') ON CONFLICT(auth_subject_link_id) DO NOTHING`;
    const [credential] = await tx`SELECT code_hash,status FROM platform_member_pilot_credentials WHERE auth_subject_link_id=${subject.id}`;
    if (credential?.code_hash.trim() !== codeHash || credential.status !== 'active') throw new Error(`Synthetic member credential ${member.subject} differs from the fixed pilot credential; refusing to overwrite it.`);
    if (member.subject === 'member-a') {
      const [cohort] = await tx`INSERT INTO platform_member_booking_pilot_cohort(person_id,status,enabled_by) VALUES (${personId}::uuid,'active','2j-demo-seed') ON CONFLICT(person_id) DO NOTHING RETURNING person_id`;
      if (cohort) await tx`INSERT INTO platform_member_booking_pilot_cohort_events(person_id,action,actor_id,reason) VALUES (${personId}::uuid,'booking_cohort.enabled','2j-demo-seed','Synthetic local Member A pilot cohort')`;
    }
  }

  const planId = 'd0840000-0000-4000-8000-000000000101';
  const rightAccessId = 'd0840000-0000-4000-8000-000000000102';
  const rightQuotaId = 'd0840000-0000-4000-8000-000000000103';
  const chargeId = 'd0840000-0000-4000-8000-000000000104';
  const assignmentId = 'd0840000-0000-4000-8000-000000000105';
  const ledgerIdempotency = 'd0840000-0000-4000-8000-000000000106';
  await tx`INSERT INTO plans(id,name,status,current_version,idempotency_key,request_hash)
    VALUES (${planId}::uuid,'Bono piloto · 12 sesiones','draft',1,'d0840000-0000-4000-8000-000000000107'::uuid,${sha256('2j-084-member-pilot-plan')}) ON CONFLICT(id) DO NOTHING`;
  const [pilotPlan] = await tx`SELECT status FROM plans WHERE id=${planId}::uuid FOR UPDATE`;
  const [pilotVersion] = await tx`SELECT frozen_at AS "frozenAt" FROM plan_versions WHERE plan_id=${planId}::uuid AND version=1`;
  if (pilotPlan?.status === 'draft') {
    if (pilotVersion?.frozenAt) throw new Error('Synthetic member pilot plan is frozen but not active; refusing to mutate its definition.');
    await tx`INSERT INTO plan_versions(plan_id,version,kind,timezone,base_price_cents)
      VALUES (${planId}::uuid,1,'session_pack','Atlantic/Canary',0) ON CONFLICT(plan_id,version) DO NOTHING`;
    await tx`INSERT INTO plan_services(plan_id,plan_version,service_id) VALUES (${planId}::uuid,1,${serviceId}::uuid) ON CONFLICT DO NOTHING`;
    await tx`INSERT INTO plan_rights(id,plan_id,plan_version,right_type,service_id) VALUES (${rightAccessId}::uuid,${planId}::uuid,1,'service_access',${serviceId}::uuid) ON CONFLICT(id) DO NOTHING`;
    await tx`INSERT INTO plan_rights(id,plan_id,plan_version,right_type,service_id,quota_scope,quantity) VALUES (${rightQuotaId}::uuid,${planId}::uuid,1,'sessions_quota',${serviceId}::uuid,'per_service',12) ON CONFLICT(id) DO NOTHING`;
    await tx`UPDATE plan_versions SET frozen_at=now() WHERE plan_id=${planId}::uuid AND version=1 AND frozen_at IS NULL`;
    await tx`UPDATE plans SET status='active' WHERE id=${planId}::uuid AND status='draft'`;
  } else if (pilotPlan?.status === 'active') {
    const [definition] = await tx`SELECT
      EXISTS (SELECT 1 FROM plan_services WHERE plan_id=${planId}::uuid AND plan_version=1 AND service_id=${serviceId}::uuid) AS service,
      EXISTS (SELECT 1 FROM plan_rights WHERE id=${rightAccessId}::uuid AND plan_id=${planId}::uuid AND plan_version=1 AND right_type='service_access' AND service_id=${serviceId}::uuid) AS access,
      EXISTS (SELECT 1 FROM plan_rights WHERE id=${rightQuotaId}::uuid AND plan_id=${planId}::uuid AND plan_version=1 AND right_type='sessions_quota' AND service_id=${serviceId}::uuid AND quantity=12) AS quota`;
    if (!pilotVersion?.frozenAt || !definition?.service || !definition.access || !definition.quota) throw new Error('Synthetic member pilot plan differs from its fixed active definition; refusing to modify it.');
  } else throw new Error('Synthetic member pilot plan is missing or archived; refusing to reactivate it.');
  await tx`INSERT INTO economic_charges(id,client_id,plan_id,concept,amount_cents,due_on,state,exempt_reason,created_by,idempotency_key,request_hash)
    VALUES ('d0840000-0000-4000-8000-000000000108'::uuid,${memberPilot[0].clientId}::uuid,${planId}::uuid,'Acceso sintético del piloto · sin cobro',1,(now() AT TIME ZONE 'Atlantic/Canary')::date,'exempt','Acceso local sintético del piloto; no requiere pago.',${actor},'d0840000-0000-4000-8000-000000000109'::uuid,${sha256('2j-084-member-pilot-charge')}) ON CONFLICT(id) DO NOTHING`;
  await tx`INSERT INTO client_plan_assignments(id,client_id,plan_id,plan_version,charge_id,starts_on,status,idempotency_key,request_hash,created_by,sale_price_cents,snapshot)
    VALUES (${assignmentId}::uuid,${memberPilot[0].clientId}::uuid,${planId}::uuid,1,'d0840000-0000-4000-8000-000000000108'::uuid,(now() AT TIME ZONE 'Atlantic/Canary')::date,'active','d0840000-0000-4000-8000-000000000110'::uuid,${sha256('2j-084-member-pilot-assignment')},${actor},0,
      jsonb_build_object('planId',${planId}::uuid,'planVersion',1,'name','Bono piloto · 12 sesiones','kind','session_pack','salePriceCents',0,'startsOn',(now() AT TIME ZONE 'Atlantic/Canary')::date,'services',jsonb_build_array(${serviceId}::uuid),'rights',jsonb_build_array(jsonb_build_object('id',${rightAccessId}::uuid,'rightType','service_access','serviceId',${serviceId}::uuid),jsonb_build_object('id',${rightQuotaId}::uuid,'rightType','sessions_quota','serviceId',${serviceId}::uuid,'quotaScope','per_service','quantity',12)))) ON CONFLICT(id) DO NOTHING`;
  await tx`INSERT INTO client_plan_assignment_events(assignment_id,event_type,effective_on,actor_id,idempotency_key,request_hash)
    VALUES (${assignmentId}::uuid,'activated',(now() AT TIME ZONE 'Atlantic/Canary')::date,${actor},'d0840000-0000-4000-8000-000000000111'::uuid,${sha256('2j-084-member-pilot-activation')}) ON CONFLICT(idempotency_key) DO NOTHING`;
  await tx`INSERT INTO client_entitlement_ledger(client_id,assignment_id,right_key,entry_type,quantity,reason,actor_id,idempotency_key,request_hash)
    VALUES (${memberPilot[0].clientId}::uuid,${assignmentId}::uuid,${rightQuotaId},'grant',12,'Saldo sintético para probar reservas locales',${actor},${ledgerIdempotency}::uuid,${sha256('2j-084-member-pilot-entitlement')}) ON CONFLICT(idempotency_key) DO NOTHING`;
  const individualSessionId = 'd0840000-0000-4000-8000-000000000112';
  await tx`INSERT INTO calendar_sessions(id,service_id,area_id,source,starts_at,duration_minutes,capacity,status,created_by)
    SELECT ${individualSessionId}::uuid,s.id,s.area_id,'manual',(((now() AT TIME ZONE 'Atlantic/Canary')::date + interval '3 days 17 hours') AT TIME ZONE 'Atlantic/Canary'),60,8,'scheduled',${actor}
    FROM services s WHERE s.id=${serviceId}::uuid AND s.status='active'
    ON CONFLICT(id) DO NOTHING`;
  const fullSessionId = 'd0840000-0000-4000-8000-000000000113';
  await tx`INSERT INTO calendar_sessions(id,service_id,area_id,source,starts_at,duration_minutes,capacity,status,created_by)
    SELECT ${fullSessionId}::uuid,s.id,s.area_id,'manual',(((now() AT TIME ZONE 'Atlantic/Canary')::date + interval '4 days 19 hours') AT TIME ZONE 'Atlantic/Canary'),45,1,'scheduled',${actor}
    FROM services s WHERE s.id=${serviceId}::uuid AND s.status='active' ON CONFLICT(id) DO NOTHING`;
  await tx`INSERT INTO calendar_reservations(id,session_id,client_id,entitlement_reference,created_by)
    SELECT 'd0840000-0000-4000-8000-000000000114'::uuid,${fullSessionId}::uuid,${memberPilot[1].clientId}::uuid,'synthetic-local-pilot',${actor}
    WHERE EXISTS(SELECT 1 FROM calendar_sessions WHERE id=${fullSessionId}::uuid AND status='scheduled') ON CONFLICT(id) DO NOTHING`;
}

async function runDemoSeed() {
  const databaseUrl = process.env.DATABASE_URL;
  if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
    throw new Error('Demo seed is restricted to development/test environments.');
  }
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const target = new URL(databaseUrl);
  const host = target.hostname.toLowerCase();
  const databaseName = decodeURIComponent(target.pathname.replace(/^\//, ''));
  if (!['localhost', '127.0.0.1', '::1'].includes(host) || databaseName !== '2j_demo') {
    throw new Error('Demo seed only accepts a loopback PostgreSQL host and the database named 2j_demo.');
  }

  const { client } = createDatabase(databaseUrl);
  try {
    await seedDemoData(client);
    console.log('Synthetic 2J-070 demo data is ready. Existing real rows were not changed; the fixed synthetic trainer link was repaired if needed.');
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith('seed-demo.ts')) {
  await runDemoSeed();
}
