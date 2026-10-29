import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import ExcelJS from 'exceljs';
import { parseCsvRows, parseXlsxRows, previewClientCsv, previewClientXlsx, validateXlsxContainer } from '../src/client-import.ts';

process.env.NODE_ENV ??= 'test';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: client import API tests cannot be skipped.');
const sql = postgres(process.env.DATABASE_URL, { max: 8, connect_timeout: 5 });
await migrateDatabase(sql);
const enabled = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'synthetic-import-admin', role: 'admin' }), clientImportPreviewEnabled: true });
const disabled = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'synthetic-import-admin', role: 'admin' }) });
const trainer = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'synthetic-import-trainer', role: 'trainer' }), clientImportPreviewEnabled: true });
const anon = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => null, clientImportPreviewEnabled: true });
after(async () => { await Promise.all([enabled.close(), disabled.close(), trainer.close(), anon.close()]); await sql.end(); });

function multipart(csv, filename = 'socios.csv') {
  const boundary = `----2j-import-${randomUUID()}`;
  const contentType = filename.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv';
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`);
  return { payload: Buffer.concat([head, Buffer.from(csv), Buffer.from(`\r\n--${boundary}--\r\n`)]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

test('CSV parser handles Excel semicolon export, UTF BOM, quoted delimiters and line breaks', () => {
  const rows = parseCsvRows(Buffer.from('\uFEFFNombre;Apellidos;Correo;Teléfono;Fecha de nacimiento\r\n"Ana; María";Pérez;ANA@example.test;600000001;03/05/1990\r\n"Luis\nJosé";Díaz;;;;'));
  assert.deepEqual(rows[0], ['Nombre', 'Apellidos', 'Correo', 'Teléfono', 'Fecha de nacimiento']);
  const preview = previewClientCsv(Buffer.from('Nombre;Apellidos;Correo;Teléfono;Fecha de nacimiento\r\n"Ana; María";Pérez;ANA@example.test;600000001;03/05/1990\r\n'));
  assert.equal(preview.validCount, 1);
  assert.deepEqual(preview.rows[0], { rowNumber: 2, firstName: 'Ana; María', lastName: 'Pérez', email: 'ana@example.test', phone: '600000001', birthDate: '1990-05-03', errors: [] });
});

test('XLSX parsing is bounded, rejects formulas and returns only the approved client columns', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Socios');
  sheet.addRow(['Nombre', 'Apellidos', 'Correo', 'Teléfono', 'Fecha de nacimiento']);
  sheet.addRow(['Ana', 'Ejemplo', 'ana@example.test', '600000001', new Date('1990-05-03T00:00:00.000Z')]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  validateXlsxContainer(buffer);
  const preview = await previewClientXlsx(buffer);
  assert.deepEqual([preview.sourceFormat, preview.rowCount, preview.validCount, preview.invalidCount], ['xlsx', 1, 1, 0]);
  assert.equal(preview.rows[0].birthDate, '1990-05-03');
  const apiPreview = await enabled.inject({ method: 'POST', url: '/api/clients/import/preview', ...multipart(buffer, 'socios.xlsx') });
  assert.equal(apiPreview.statusCode, 200);
  assert.equal(apiPreview.json().sourceFormat, 'xlsx');
  assert.equal(apiPreview.json().commitAvailable, false);
  const bad = new ExcelJS.Workbook();
  const badSheet = bad.addWorksheet('Socios');
  badSheet.addRow(['Nombre', 'Apellidos']); badSheet.addRow([{ formula: 'HYPERLINK("https://example.test")' }, 'Ejemplo']);
  const badBuffer = Buffer.from(await bad.xlsx.writeBuffer());
  await assert.rejects(() => parseXlsxRows(badBuffer), /formula_not_allowed/);
  const expanded = Buffer.from(buffer);
  const central = expanded.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.notEqual(central, -1);
  expanded.writeUInt32LE(21 * 1024 * 1024, central + 24);
  assert.throws(() => validateXlsxContainer(expanded), /excel_expanded_too_large/);
});

test('CSV preview validates rows without creating clients and appends only non-PII audit counts', async () => {
  const email = `existing-${randomUUID()}@example.test`;
  const [existing] = await sql`INSERT INTO clients(first_name,last_name,email,phone,status) VALUES('Cliente','Sintético',${email},'600000002','active') RETURNING id`;
  const beforeClients = Number((await sql`SELECT count(*)::int AS count FROM clients`)[0].count);
  const beforeAudit = Number((await sql`SELECT count(*)::int AS count FROM client_import_preview_audit`)[0].count);
  const csv = `Nombre;Apellidos;Correo\r\nAna;Ejemplo;${email}\r\nLuis;Prueba;new-${randomUUID()}@example.test\r\n;Sin nombre;bad@example.test\r\n`;
  const response = await enabled.inject({ method: 'POST', url: '/api/clients/import/preview', ...multipart(csv) });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().mode, 'dry_run');
  assert.equal(response.json().commitAvailable, false);
  assert.equal(response.json().approvalRequiredForRealImport, true);
  assert.deepEqual([response.json().rowCount, response.json().validCount, response.json().invalidCount], [3, 1, 2]);
  assert.ok(response.json().rows[0].errors.includes('email_duplicate_or_invalid'));
  assert.ok(response.json().rows[2].errors.includes('first_name_invalid'));
  assert.equal(Number((await sql`SELECT count(*)::int AS count FROM clients`)[0].count), beforeClients, 'preview must not write client records');
  const [audit] = await sql`SELECT actor_id AS "actorId",source_format AS "sourceFormat",row_count AS "rowCount",valid_count AS "validCount",invalid_count AS "invalidCount" FROM client_import_preview_audit ORDER BY created_at DESC,id DESC LIMIT 1`;
  assert.deepEqual(audit, { actorId: 'synthetic-import-admin', sourceFormat: 'csv', rowCount: 3, validCount: 1, invalidCount: 2 });
  assert.equal(Number((await sql`SELECT count(*)::int AS count FROM client_import_preview_audit`)[0].count), beforeAudit + 1);
  assert.equal(JSON.stringify(audit).includes(email), false, 'audit stores counts only, never source-row values');
  await sql`UPDATE clients SET status='archived',updated_at=now() WHERE id=${existing.id}::uuid`;
});

test('preview is permission-checked, disabled by default and accepts only CSV/XLSX spreadsheet formats', async () => {
  const body = multipart('Nombre,Apellidos\nAna,Ejemplo\n');
  assert.equal((await anon.inject({ method: 'POST', url: '/api/clients/import/preview', ...body })).statusCode, 401);
  assert.equal((await trainer.inject({ method: 'POST', url: '/api/clients/import/preview', ...body })).statusCode, 403);
  assert.equal((await disabled.inject({ method: 'POST', url: '/api/clients/import/preview', ...body })).statusCode, 404);
  const xlsx = await enabled.inject({ method: 'POST', url: '/api/clients/import/preview', ...multipart(Buffer.from([0x50, 0x4b, 0x03, 0x04]), 'socios.xlsx') });
  assert.equal(xlsx.statusCode, 400);
  assert.equal(xlsx.json().error, 'invalid_excel');
  const unsupported = await enabled.inject({ method: 'POST', url: '/api/clients/import/preview', ...multipart(Buffer.from('data'), 'socios.xls') });
  assert.equal(unsupported.statusCode, 415);
  assert.equal(unsupported.json().error, 'spreadsheet_format_unsupported');
});

test('malformed CSV errors are generic and do not echo row data', async () => {
  const secretLooking = 'PERSONA PRIVADA';
  const response = await enabled.inject({ method: 'POST', url: '/api/clients/import/preview', ...multipart(`Nombre,Apellidos\n"${secretLooking},Apellido\n`) });
  assert.equal(response.statusCode, 400);
  assert.equal(JSON.stringify(response.json()).includes(secretLooking), false);
  const healthColumn = await enabled.inject({ method: 'POST', url: '/api/clients/import/preview', ...multipart('Nombre,Apellidos,Notas de salud\nAna,Ejemplo,datos sensibles\n') });
  assert.equal(healthColumn.statusCode, 400);
  assert.equal(healthColumn.json().error, 'unsupported_columns');
  assert.equal(JSON.stringify(healthColumn.json()).includes('datos sensibles'), false);
});
