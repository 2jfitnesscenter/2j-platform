import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';

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

test('Command Center aggregates today occupancy and waitlist from calendar source tables', async () => {
  const [area] = await sql`SELECT id FROM areas WHERE status='active' ORDER BY id LIMIT 1`;
  const [client] = await sql`INSERT INTO clients(first_name,last_name) VALUES ('Demo','Dashboard QA') RETURNING id`;
  const [service] = await sql`INSERT INTO services(name,area_id,status) VALUES (${`Dashboard ${randomUUID()}`},${area.id},'active') RETURNING id`;
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
