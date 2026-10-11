import { createDatabase } from '../src/db.js';

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
