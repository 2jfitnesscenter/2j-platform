import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';

process.env.NODE_ENV ??= 'test';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: cash shift reason tests cannot be skipped.');
const sql = postgres(process.env.DATABASE_URL, { max: 4, connect_timeout: 5 });
await migrateDatabase(sql);
const actorId = `shift-reason-${randomUUID().slice(0, 8)}`;
const logs = [];
const stream = new Writable({ write(chunk, _encoding, done) { logs.push(chunk.toString()); done(); } });
const app = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId, role: 'admin' }), logger: { level: 'info', stream } });
after(async () => { await app.close(); await sql.end(); });

const keys = ['coin_0_01', 'coin_0_02', 'coin_0_05', 'coin_0_10', 'coin_0_20', 'coin_0_50', 'coin_1', 'coin_2', 'bill_5', 'bill_10', 'bill_20', 'bill_50', 'bill_100', 'bill_200', 'bill_500'];
const zero = Object.fromEntries(keys.map((key) => [key, 0]));
const open = (registerCode) => app.inject({ method: 'POST', url: '/api/economics/cash/open', payload: { registerCode, openingDenominations: zero } });

test('opening and closing a register without an active clock-in answer 409 with a specific reason, the exact guidance text, and a server log without personal data', async () => {
  const [person] = await sql`INSERT INTO staff_professionals(first_name,last_name,display_name,base_role,auth_actor_id,created_by) VALUES ('QA','Turno',${`QA turno ${randomUUID()}`},'admin',${actorId},'test') RETURNING id`;
  // No clock-in yet: the rule holds, but the answer names it.
  const refused = await open('bunker');
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.json().error, 'clock_in_required');
  assert.equal(refused.json().message, 'Para abrir la caja primero tienes que fichar la entrada');
  const logged = logs.map((line) => JSON.parse(line)).find((entry) => entry.reason === 'clock_in_required');
  assert.ok(logged, 'the refusal is logged on the server with its reason');
  assert.equal(logged.route, 'POST /api/economics/cash/open');
  assert.equal(JSON.stringify(logged).includes(actorId), false, 'the log carries no actor identity');
  assert.equal(JSON.stringify(logged).includes(person.id), false);

  // Clocking in through the public API (what the guided button does) unblocks the same request.
  const clockIn = await app.inject({ method: 'POST', url: '/api/timeclock/clock-in', payload: { origin: 'web' } });
  assert.equal(clockIn.statusCode, 201, clockIn.body);
  const opened = await open('bunker').then(async (first) => first.statusCode === 201 ? first : open('sala'));
  assert.equal(opened.statusCode, 201, opened.body);

  // A custodian whose shift is no longer active cannot close: same idea, close wording. (The trigger that normally forbids
  // clocking out while holding a register is lifted only inside this synthetic setup.)
  await sql`ALTER TABLE staff_timeclock_events DISABLE TRIGGER staff_timeclock_cash_custody_guard`;
  try { await sql`INSERT INTO staff_timeclock_events(professional_id,event_type,origin,actor_id) VALUES (${person.id},'clock_out','web',${actorId})`; }
  finally { await sql`ALTER TABLE staff_timeclock_events ENABLE TRIGGER staff_timeclock_cash_custody_guard`; }
  const closed = await app.inject({ method: 'POST', url: `/api/economics/cash/${opened.json().id}/close`, payload: { countedDenominations: zero } });
  assert.equal(closed.statusCode, 409);
  assert.equal(closed.json().error, 'cash_custodian_not_clocked_in');
  assert.equal(closed.json().message, 'Para cerrar la caja primero tienes que fichar la entrada');
  assert.ok(logs.map((line) => JSON.parse(line)).some((entry) => entry.reason === 'cash_custodian_not_clocked_in' && entry.route === 'POST /api/economics/cash/close'));

  // Other refusals keep their own code and never borrow the shift text.
  const other = await app.inject({ method: 'POST', url: `/api/economics/cash/${randomUUID()}/close`, payload: { countedDenominations: zero } });
  assert.equal(other.statusCode, 404); assert.equal(other.json().message, undefined);
});
