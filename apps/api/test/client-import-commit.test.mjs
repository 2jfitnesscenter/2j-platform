import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';

process.env.NODE_ENV ??= 'test';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: client import commit tests cannot be skipped.');
const sql = postgres(process.env.DATABASE_URL, { max: 8, connect_timeout: 5 });
await migrateDatabase(sql);
const as = (role, flags = { clientImportPreviewEnabled: true, clientImportCommitEnabled: true }) => buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: `synthetic-import-${role}`, role }), ...flags });
const admin = as('admin');
const adminPreviewOnly = as('admin', { clientImportPreviewEnabled: true });
const reception = as('reception-management');
const trainer = as('trainer');
const anonymous = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => null, clientImportPreviewEnabled: true, clientImportCommitEnabled: true });
after(async () => { await Promise.all([admin.close(), adminPreviewOnly.close(), reception.close(), trainer.close(), anonymous.close()]); await sql.end(); });

const header = ['ID', 'Nombre', 'Apellidos', 'Fecha de alta', 'Código de cliente', 'Correo electrónico', 'Teléfono', 'Género', 'Fecha de nacimiento', 'Fecha última reserva', 'Procedencias', 'Etiquetas', 'Deuda total'];
const canaryDay = (offset = 0) => { const base = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary' }).format(new Date()) + 'T00:00:00Z'); base.setUTCDate(base.getUTCDate() + offset); const [y, m, d] = base.toISOString().slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
const tag = randomUUID().slice(0, 8);
const ref = (n) => `T${tag}-${n}`;
function csvFile(rows) { return Buffer.from(['﻿' + header.join(';'), ...rows.map((row) => row.join(';'))].join('\r\n'), 'utf8'); }
function multipart(data, filename = 'socios.csv') {
  const boundary = `----2j-commit-${randomUUID()}`;
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/csv\r\n\r\n`);
  return { payload: Buffer.concat([head, data, Buffer.from(`\r\n--${boundary}--\r\n`)]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
const digest = (data) => createHash('sha256').update(data).digest('hex');
const rowsFor = () => [
  [ref(1), 'Ana', `Activa${tag}`, '01/01/2024', 'S1', `ana.${tag}@example.test`, '600 111 001', 'F', '15/05/1990', canaryDay(-30), 'Web', 'Piloto', '120,00'],
  [ref(2), 'Beto', `Inactivo${tag}`, '01/01/2023', 'S2', `beto.${tag}@example.test`, '600 111 002', 'M', '01/02/1985', canaryDay(-400), 'Web', '', '35,00'],
  [ref(3), 'Cira', `Incompleta${tag}`, '01/01/2024', 'S3', '', '', '', '', canaryDay(-10), '', '', ''],
  [ref(4), 'Dani', `Duplicado${tag}`, '01/01/2024', 'S4', `ana.${tag}@example.test`, '600 111 004', 'M', '03/03/1992', canaryDay(-5), '', '', ''],
  [ref(5), '', `SinNombre${tag}`, '01/01/2024', 'S5', '', '', '', '', canaryDay(-5), '', '', ''],
];
const post = (app, url, file, headers = {}) => { const m = multipart(file); return app.inject({ method: 'POST', url, headers: { ...m.headers, ...headers }, payload: m.payload }); };
const confirmHeaders = (file, rows = 5) => ({ 'x-import-confirm': 'IMPORTAR', 'x-import-digest': digest(file), 'x-import-expected-rows': String(rows) });
const mine = () => sql`SELECT * FROM clients WHERE import_source='timp' AND external_ref LIKE ${`T${tag}-%`} ORDER BY external_ref`;

test('the preview returns the file digest and says whether the real import is available for this profile', async () => {
  const file = csvFile(rowsFor());
  const preview = await post(admin, '/api/clients/import/preview', file);
  assert.equal(preview.statusCode, 200, preview.body);
  assert.equal(preview.json().fileDigest, digest(file));
  assert.equal(preview.json().commitAvailable, true);
  assert.equal((await post(adminPreviewOnly, '/api/clients/import/preview', file)).json().commitAvailable, false, 'commit flag off by default');
  assert.notEqual((await post(reception, '/api/clients/import/preview', file)).json().commitAvailable, true, 'reception lacks settings.manage');
});

test('the real import needs authentication, the admin profile, the activation flag and the on-screen confirmation of the previewed file', async () => {
  const file = csvFile(rowsFor());
  assert.equal((await post(anonymous, '/api/clients/import/commit', file, confirmHeaders(file))).statusCode, 401);
  for (const app of [reception, trainer]) assert.equal((await post(app, '/api/clients/import/commit', file, confirmHeaders(file))).statusCode, 403, 'clients.manage + settings.manage are both required');
  assert.equal((await post(adminPreviewOnly, '/api/clients/import/commit', file, confirmHeaders(file))).statusCode, 404, 'disabled unless the owner activates it');
  assert.equal((await post(admin, '/api/clients/import/commit', file)).statusCode, 400, 'no confirmation headers');
  assert.equal((await post(admin, '/api/clients/import/commit', file, { ...confirmHeaders(file), 'x-import-confirm': 'si' })).statusCode, 400);
  assert.equal((await post(admin, '/api/clients/import/commit', file, { ...confirmHeaders(file), 'x-import-digest': digest(Buffer.from('otro')) })).statusCode, 409, 'a different file than the one previewed');
  assert.equal((await post(admin, '/api/clients/import/commit', file, confirmHeaders(file, 4))).statusCode, 409, 'row count differs from the preview');
  assert.equal((await mine()).length, 0, 'nothing is created by a refused request');
});

test('confirming imports every valid row: active within 365 days, archived otherwise, incomplete and duplicate flagged, no debt, and a replay does nothing', async () => {
  const file = csvFile(rowsFor());
  const response = await post(admin, '/api/clients/import/commit', file, confirmHeaders(file));
  assert.equal(response.statusCode, 201, response.body);
  const body = response.json();
  assert.deepEqual([body.rowCount, body.created, body.skipped, body.active, body.inactive, body.incomplete, body.emailNotStored], [5, 4, 1, 3, 1, 2, 1]);
  assert.deepEqual(body.skippedRows, [{ rowNumber: 6, errors: ['first_name_invalid'] }], 'only row numbers and codes, never names');
  const clients = await mine();
  const byRef = Object.fromEntries(clients.map((client) => [client.external_ref, client]));
  assert.equal(byRef[ref(1)].status, 'active'); assert.equal(byRef[ref(1)].email, `ana.${tag}@example.test`);
  assert.equal(byRef[ref(2)].status, 'archived', 'inactive = last reservation older than 365 days');
  assert.equal(byRef[ref(3)].status, 'active'); assert.deepEqual(byRef[ref(3)].import_incomplete_fields.sort(), ['birthDate', 'email', 'gender', 'phone']); assert.ok(byRef[ref(3)].import_review_flags.includes('minor_review'));
  assert.equal(byRef[ref(4)].email, null, 'two active clients cannot share an email: the later one is stored without it and flagged');
  assert.ok(byRef[ref(4)].import_review_flags.includes('email_not_stored_duplicate')); assert.ok(byRef[ref(4)].import_incomplete_fields.includes('email'));
  assert.equal(byRef[ref(1)].joined_on.toISOString().slice(0, 10), '2024-01-01'); assert.equal(byRef[ref(1)].gender, 'F'); assert.equal(byRef[ref(1)].member_number, 'S1');
  const ids = clients.map((client) => client.id);
  assert.equal((await sql`SELECT count(*)::int AS n FROM client_events WHERE client_id=ANY(${ids}::uuid[]) AND event_type='client.imported'`)[0].n, 4);
  assert.equal((await sql`SELECT count(*)::int AS n FROM economic_charges WHERE client_id=ANY(${ids}::uuid[])`)[0].n, 0, 'no debt, charge or payment is imported');
  const [run] = await sql`SELECT * FROM client_import_runs WHERE file_digest=${digest(file)}`;
  assert.deepEqual([run.row_count, run.created_count, run.skipped_count, run.actor_id], [5, 4, 1, 'synthetic-import-admin']);
  assert.equal(JSON.stringify(run).includes(`Activa${tag}`), false, 'the audit keeps counts and a file digest, never names or contacts');
  const replay = await post(admin, '/api/clients/import/commit', file, confirmHeaders(file));
  assert.equal(replay.statusCode, 200); assert.equal(replay.json().replayed, true); assert.equal(replay.json().created, 4);
  assert.equal((await mine()).length, 4, 'the same file never imports twice');
  await assert.rejects(sql`DELETE FROM client_import_runs WHERE id=${run.id}`, { code: '55000' }, 'the audit is append-only');
});

test('a changed file that repeats earlier TIMP ids only adds the new people; the earlier ones are reported as already imported', async () => {
  const more = [...rowsFor().slice(0, 2), [ref(6), 'Eva', `Nueva${tag}`, '01/01/2025', 'S6', `eva.${tag}@example.test`, '600 111 006', 'F', '10/10/1995', canaryDay(-2), '', '', '']];
  const file = csvFile(more);
  const response = await post(admin, '/api/clients/import/commit', file, confirmHeaders(file, 3));
  assert.equal(response.statusCode, 201, response.body);
  assert.deepEqual([response.json().created, response.json().skipped], [1, 2]);
  assert.deepEqual(response.json().skippedRows.map((row) => row.errors[0]), ['already_imported', 'already_imported']);
  assert.equal((await mine()).length, 5);
});
