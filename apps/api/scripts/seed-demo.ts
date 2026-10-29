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
    const demoAdminProfessionalId = 'd0700000-0000-4000-8000-000000000105';
    const adminActorId = 'local-demo:admin';
    const [existingTrainerLink] = await tx`SELECT id FROM staff_professionals
      WHERE auth_actor_id=${trainerActorId} AND id<>${demoProfessionalId}::uuid FOR UPDATE`;
    if (existingTrainerLink) {
      throw new Error(`Demo trainer actor is already linked to another professional (${existingTrainerLink.id}); refusing to replace that link.`);
    }
    const [existingAdminLink] = await tx`SELECT id FROM staff_professionals
      WHERE auth_actor_id=${adminActorId} AND id<>${demoAdminProfessionalId}::uuid FOR UPDATE`;
    if (existingAdminLink) {
      throw new Error(`Demo admin actor is already linked to another professional (${existingAdminLink.id}); refusing to replace that link.`);
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

    // The local demo admin is also attached to one synthetic professional record so the same
    // server-resolved subject can use professional-only screens without an identity override.
    await tx`INSERT INTO staff_professionals(id,first_name,last_name,display_name,status,base_role,created_by,auth_actor_id)
      VALUES (${demoAdminProfessionalId}::uuid,'Sofía','Demo','Sofía Demo','active','admin','2j-demo-seed',${adminActorId})
      ON CONFLICT(id) DO NOTHING`;
    const [demoAdminProfessional] = await tx`SELECT auth_actor_id,display_name,base_role FROM staff_professionals WHERE id=${demoAdminProfessionalId}::uuid FOR UPDATE`;
    if (demoAdminProfessional.display_name !== 'Sofía Demo' || demoAdminProfessional.base_role !== 'admin') {
      throw new Error(`Synthetic demo admin professional ${demoAdminProfessionalId} is occupied by another record; refusing to replace it.`);
    }
    if (demoAdminProfessional.auth_actor_id != null && demoAdminProfessional.auth_actor_id !== adminActorId) {
      throw new Error(`Synthetic demo admin professional ${demoAdminProfessionalId} is already linked to another actor; refusing to replace that link.`);
    }
    if (demoAdminProfessional.auth_actor_id == null) {
      await tx`UPDATE staff_professionals SET auth_actor_id=${adminActorId},updated_at=now() WHERE id=${demoAdminProfessionalId}::uuid AND auth_actor_id IS NULL`;
    }

    const parallelProfessionals = [
      { id:'d0700000-0000-4000-8000-000000000102', first:'Nora', last:'Vega' },
      { id:'d0700000-0000-4000-8000-000000000103', first:'Leo', last:'Suárez' },
      { id:'d0700000-0000-4000-8000-000000000104', first:'Irene', last:'Díaz' },
    ];
    for (const person of parallelProfessionals) {
      await tx`INSERT INTO staff_professionals(id,first_name,last_name,display_name,status,base_role,created_by)
        VALUES (${person.id}::uuid,${person.first},${person.last},${`${person.first} ${person.last}`},'active','trainer','2j-demo-seed') ON CONFLICT(id) DO NOTHING`;
      const [record] = await tx`SELECT display_name FROM staff_professionals WHERE id=${person.id}::uuid`;
      if (record?.display_name !== `${person.first} ${person.last}`) throw new Error(`Synthetic demo professional ${person.id} is occupied by another record.`);
    }

    const mainService = services[0];
    await seedMemberPilot(tx, mainService.service_id);
    const sessionId = 'd0700000-0000-4000-8000-000000000201';
    await tx`INSERT INTO calendar_sessions(id,service_id,area_id,source,starts_at,duration_minutes,capacity,status,created_by,professional_id)
      VALUES (${sessionId}::uuid,${mainService.service_id},${mainService.area_id},'manual',
        (date_trunc('day',now() AT TIME ZONE 'Atlantic/Canary') AT TIME ZONE 'Atlantic/Canary') + interval '17 hours',60,8,'scheduled','2j-demo-seed','d0700000-0000-4000-8000-000000000101')
      ON CONFLICT(id) DO UPDATE SET starts_at=excluded.starts_at`;
    await tx`INSERT INTO calendar_reservations(id,session_id,client_id,entitlement_reference,status,created_by)
      VALUES ('d0700000-0000-4000-8000-000000000301'::uuid,${sessionId}::uuid,'d0700000-0000-4000-8000-000000000001'::uuid,'demo-entitlement-1','reserved','2j-demo-seed'),
             ('d0700000-0000-4000-8000-000000000302'::uuid,${sessionId}::uuid,'d0700000-0000-4000-8000-000000000002'::uuid,'demo-entitlement-2','reserved','2j-demo-seed'),
             ('d0700000-0000-4000-8000-000000000303'::uuid,${sessionId}::uuid,'d0700000-0000-4000-8000-000000000003'::uuid,'demo-entitlement-3','reserved','2j-demo-seed')
      ON CONFLICT(id) DO NOTHING`;
    await tx`INSERT INTO calendar_waitlist_entries(id,session_id,client_id,entitlement_reference,status,created_by)
      VALUES ('d0700000-0000-4000-8000-000000000401'::uuid,${sessionId}::uuid,'d0700000-0000-4000-8000-000000000004'::uuid,'demo-entitlement-4','waiting','2j-demo-seed')
      ON CONFLICT(id) DO NOTHING`;

    const secondService = services[1] ?? mainService;
    const secondSessionId = 'd0700000-0000-4000-8000-000000000202';
    await tx`INSERT INTO calendar_sessions(id,service_id,area_id,source,starts_at,duration_minutes,capacity,status,created_by,professional_id)
      VALUES (${secondSessionId}::uuid,${secondService.service_id},${secondService.area_id},'manual',
        ((now() AT TIME ZONE 'Atlantic/Canary')::date + interval '18 hours 30 minutes') AT TIME ZONE 'Atlantic/Canary',60,6,'scheduled','2j-demo-seed',${demoProfessionalId}::uuid)
      ON CONFLICT(id) DO UPDATE SET starts_at=excluded.starts_at`;
    await tx`INSERT INTO calendar_reservations(id,session_id,client_id,entitlement_reference,status,created_by)
      VALUES ('d0700000-0000-4000-8000-000000000304'::uuid,${secondSessionId}::uuid,'d0700000-0000-4000-8000-000000000005'::uuid,'demo-entitlement-5','reserved','2j-demo-seed'),
             ('d0700000-0000-4000-8000-000000000305'::uuid,${secondSessionId}::uuid,'d0700000-0000-4000-8000-000000000006'::uuid,'demo-entitlement-6','reserved','2j-demo-seed')
      ON CONFLICT(id) DO NOTHING`;

    const fullSessionId = 'd0700000-0000-4000-8000-000000000203';
    await tx`INSERT INTO calendar_sessions(id,service_id,area_id,source,starts_at,duration_minutes,capacity,status,created_by,professional_id)
      VALUES (${fullSessionId}::uuid,${mainService.service_id},${mainService.area_id},'manual',
        ((now() AT TIME ZONE 'Atlantic/Canary')::date + interval '20 hours 15 minutes') AT TIME ZONE 'Atlantic/Canary',45,2,'scheduled','2j-demo-seed',${demoProfessionalId}::uuid)
      ON CONFLICT(id) DO UPDATE SET starts_at=excluded.starts_at`;
    await tx`INSERT INTO calendar_reservations(id,session_id,client_id,entitlement_reference,status,created_by)
      VALUES ('d0700000-0000-4000-8000-000000000306'::uuid,${fullSessionId}::uuid,'d0700000-0000-4000-8000-000000000007'::uuid,'demo-entitlement-7','reserved','2j-demo-seed'),
             ('d0700000-0000-4000-8000-000000000307'::uuid,${fullSessionId}::uuid,'d0700000-0000-4000-8000-000000000008'::uuid,'demo-entitlement-8','reserved','2j-demo-seed')
      ON CONFLICT(id) DO NOTHING`;

    const pilotServices = await tx`SELECT s.id,s.area_id FROM services s JOIN areas a ON a.id=s.area_id WHERE s.id IN (
      'd0700000-0000-4000-8000-000000000801'::uuid,'d0700000-0000-4000-8000-000000000802'::uuid,
      'd0700000-0000-4000-8000-000000000803'::uuid,'d0700000-0000-4000-8000-000000000804'::uuid
    ) AND s.status='active' AND a.status='active' ORDER BY s.id`;
    if (pilotServices.length < 3) throw new Error('The owner-review pilot requires at least three active demo services in separate configured areas.');
    const staffIds = [demoProfessionalId,...parallelProfessionals.map(person=>person.id)];
    for (let index=0;index<16;index++) {
      const service=pilotServices[index%pilotServices.length]!;
      const hour=8+Math.floor(index/2);
      const startsAt=`${String(hour).padStart(2,'0')}:00`;
      const id=`d0700000-0000-4000-8000-${String(510+index).padStart(12,'0')}`;
      await tx`INSERT INTO calendar_sessions(id,service_id,area_id,source,starts_at,duration_minutes,capacity,status,created_by,professional_id)
        VALUES (${id}::uuid,${service.id},${service.area_id},'manual',((now() AT TIME ZONE 'Atlantic/Canary')::date + ${startsAt}::time) AT TIME ZONE 'Atlantic/Canary',45,8,'scheduled','2j-demo-seed',${staffIds[index%staffIds.length]}::uuid)
        ON CONFLICT(id) DO UPDATE SET starts_at=excluded.starts_at`;
    }

    await tx`INSERT INTO store_products(id,center_key,category,name,description,active,created_by,updated_by)
      VALUES ('d0700000-0000-4000-8000-000000001001'::uuid,'2j','nutrition','Proteína 2J','Formato 900 g · chocolate',true,'2j-demo-seed','2j-demo-seed'),
             ('d0700000-0000-4000-8000-000000001002'::uuid,'2j','merchandising','Camiseta 2J','Colección del centro',true,'2j-demo-seed','2j-demo-seed') ON CONFLICT(id) DO NOTHING`;
    await tx`INSERT INTO store_product_variants(id,product_id,sku,label,size,flavor,price_cents,active,stock_tracked,created_by,updated_by)
      VALUES ('d0700000-0000-4000-8000-000000001101'::uuid,'d0700000-0000-4000-8000-000000001001'::uuid,'DEMO-PROT-900','Chocolate · 900 g','900 g','Chocolate',3290,true,true,'2j-demo-seed','2j-demo-seed'),
             ('d0700000-0000-4000-8000-000000001102'::uuid,'d0700000-0000-4000-8000-000000001002'::uuid,'DEMO-TEE-M','Talla M','M',NULL,1800,true,true,'2j-demo-seed','2j-demo-seed') ON CONFLICT(id) DO NOTHING`;
    await tx`INSERT INTO store_inventory_movements(variant_id,quantity_delta,movement_type,reason,actor_id)
      SELECT id, CASE WHEN id='d0700000-0000-4000-8000-000000001101'::uuid THEN 12 ELSE 5 END,'opening','Stock inicial sintético para owner review','2j-demo-seed'
      FROM store_product_variants WHERE id IN ('d0700000-0000-4000-8000-000000001101'::uuid,'d0700000-0000-4000-8000-000000001102'::uuid)
      AND NOT EXISTS(SELECT 1 FROM store_inventory_movements WHERE variant_id=store_product_variants.id AND movement_type='opening')`;

    await tx`INSERT INTO economic_charges(id,client_id,concept,amount_cents,due_on,state,created_by,idempotency_key,request_hash)
      VALUES ('d0700000-0000-4000-8000-000000000501'::uuid,'d0700000-0000-4000-8000-000000000001'::uuid,'Cuota mensual · demo',4900,
        (now() AT TIME ZONE 'Atlantic/Canary')::date - 3,'pending','2j-demo-seed',
        'd0700000-0000-4000-8000-000000000601'::uuid,repeat('7',64))
      ON CONFLICT(id) DO NOTHING`;

    await tx`INSERT INTO communication_conversations(id,center_key,client_id,status,last_message_at)
      VALUES ('d0700000-0000-4000-8000-000000000701'::uuid,'2j','d0700000-0000-4000-8000-000000000001'::uuid,'active',now())
      ON CONFLICT(id) DO NOTHING`;
    await tx`INSERT INTO communication_messages(id,conversation_id,sender_kind,sender_actor_id,body,idempotency_key)
      VALUES ('d0700000-0000-4000-8000-000000000702'::uuid,'d0700000-0000-4000-8000-000000000701'::uuid,'client','demo-client','¡Hola! ¿Podemos confirmar mi próxima sesión?','d0700000-0000-4000-8000-000000000703'::uuid)
      ON CONFLICT(id) DO NOTHING`;

    const checkInFormId = 'd0700000-0000-4000-8000-000000000901';
    const checkInVersionId = 'd0700000-0000-4000-8000-000000000902';
    await tx`INSERT INTO client_forms(id,name,category,sensitivity,status,active_version_id,created_by)
      VALUES (${checkInFormId}::uuid,'Seguimiento semanal · demo','check_in','operational','active',${checkInVersionId}::uuid,'2j-demo-seed')
      ON CONFLICT(id) DO NOTHING`;
    await tx`INSERT INTO client_form_versions(id,form_id,version,description,fields,status,created_by)
      VALUES (${checkInVersionId}::uuid,${checkInFormId}::uuid,1,'Formulario sintético para revisar el flujo de seguimiento.',
        '[{"key":"energy","label":"¿Cómo ha ido tu semana?","type":"short_text","required":true},{"key":"sessions","label":"Sesiones realizadas","type":"number","required":true}]'::jsonb,
        'active','2j-demo-seed') ON CONFLICT(id) DO NOTHING`;
    await tx`INSERT INTO client_form_assignments(id,client_id,form_version_id,required,due_at,status,idempotency_key,assigned_by)
      VALUES ('d0700000-0000-4000-8000-000000000903'::uuid,'d0700000-0000-4000-8000-000000000001'::uuid,${checkInVersionId}::uuid,true,now()-interval '3 days','assigned','d0700000-0000-4000-8000-000000000904'::uuid,'2j-demo-seed'),
             ('d0700000-0000-4000-8000-000000000905'::uuid,'d0700000-0000-4000-8000-000000000008'::uuid,${checkInVersionId}::uuid,true,now()+interval '3 days','review_required','d0700000-0000-4000-8000-000000000906'::uuid,'2j-demo-seed')
      ON CONFLICT(id) DO NOTHING`;
    await tx`INSERT INTO client_form_responses(id,assignment_id,client_id,form_version_id,answers,idempotency_key,request_hash)
      VALUES ('d0700000-0000-4000-8000-000000000907'::uuid,'d0700000-0000-4000-8000-000000000905'::uuid,'d0700000-0000-4000-8000-000000000008'::uuid,${checkInVersionId}::uuid,
        '{"energy":"Buena, he mantenido el ritmo","sessions":2}'::jsonb,'d0700000-0000-4000-8000-000000000908'::uuid,${sha256('2j-owner-review-checkin-response')})
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

export function validateDemoSeedTarget(environment: NodeJS.ProcessEnv = process.env): 'local' | 'staging' {
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const target = new URL(databaseUrl);
  const host = target.hostname.toLowerCase();
  const databaseName = decodeURIComponent(target.pathname.replace(/^\//, ''));
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(host);

  if (environment.STAGING_SEED !== undefined && environment.STAGING_SEED !== '1') {
    throw new Error('STAGING_SEED must be exactly 1 when specified.');
  }
  if (environment.STAGING_SEED === '1') {
    if (environment.NODE_ENV !== 'development') throw new Error('STAGING_SEED is allowed only from the 2j-staging development runner.');
    if (environment.STAGING_SEED_HOST !== '2jfit.com') throw new Error('Staging seed target must be exactly 2jfit.com.');
    if (!loopback || databaseName !== '2j_demo') throw new Error('Staging seed only accepts the isolated local 2j_demo database.');
    return 'staging';
  }

  if (environment.NODE_ENV !== 'development' && environment.NODE_ENV !== 'test') {
    throw new Error('Demo seed is restricted to development/test environments.');
  }
  if (!loopback || databaseName !== '2j_demo') {
    throw new Error('Demo seed only accepts a loopback PostgreSQL host and the database named 2j_demo.');
  }
  return 'local';
}

async function runDemoSeed() {
  const databaseUrl = process.env.DATABASE_URL;
  const mode = validateDemoSeedTarget();

  const { client } = createDatabase(databaseUrl);
  try {
    await seedDemoData(client);
    console.log(`Synthetic ${mode} 2J-070 demo data is ready. The fixed synthetic admin/professional and trainer links were repaired if needed; existing non-demo rows were not changed.`);
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith('seed-demo.ts')) {
  await runDemoSeed();
}
