import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { MemoryObjectStorage, LocalObjectStorage } from '../src/object-storage.ts';
import { MAX_CLIENT_DOCUMENT_BYTES, sniffClientDocument } from '../src/client-documents.ts';

process.env.NODE_ENV ??= 'test';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: client document integration tests cannot be skipped.');
const sql = postgres(process.env.DATABASE_URL, { max: 8, connect_timeout: 5 });
await migrateDatabase(sql);
const storage = new MemoryObjectStorage();
let memberClientId = '';
const admin = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'documents-admin', role: 'admin' }), objectStorage: storage });
const trainer = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'documents-trainer', role: 'trainer' }), objectStorage: storage });
const accountant = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'documents-accountant', role: 'accountant' }), objectStorage: storage });
const portal = buildServer(process.env.DATABASE_URL, { clientAuthorizationResolver: async () => memberClientId ? ({ clientId: memberClientId }) : null, objectStorage: storage });
after(async () => { await Promise.all([admin.close(), trainer.close(), accountant.close(), portal.close(), sql.end()]); });

const pdf = () => Buffer.from('%PDF-1.7\nsynthetic document bytes\n%%EOF');
function multipart(data, { title = 'Contrato de prueba', documentType = 'contract', visibility = 'staff_only', filename = 'ignored.pdf', declaredType = 'application/pdf' } = {}) {
  const boundary = `----2jdocs${randomUUID().replaceAll('-', '')}`;
  const fields = [['title', title], ['documentType', documentType], ['visibility', visibility]].map(([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`).join('');
  const fileHead = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${declaredType}\r\n\r\n`;
  return { payload: Buffer.concat([Buffer.from(fields + fileHead), data, Buffer.from(`\r\n--${boundary}--\r\n`)]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
async function newClient() {
  const response = await admin.inject({ method: 'POST', url: '/api/clients', headers: { 'idempotency-key': randomUUID() }, payload: { firstName: 'Cliente', lastName: `Documentos ${randomUUID()}` } });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().id;
}
const upload = (clientId, options = {}, server = admin) => server.inject({ method: 'POST', url: `/api/clients/${clientId}/documents`, ...multipart(pdf(), options) });

test('file bytes, not declared MIME or filename, decide supported private document type', () => {
  assert.deepEqual(sniffClientDocument(pdf()), { mime: 'application/pdf', extension: 'pdf' });
  assert.equal(sniffClientDocument(Buffer.from('<html>no</html>')), null);
  assert.equal(sniffClientDocument(Buffer.from('MZ executable')), null);
  assert.equal(MAX_CLIENT_DOCUMENT_BYTES, 5 * 1024 * 1024);
});

test('documents require permission, stay private by default, and only the same active client can download explicitly visible files', async () => {
  const clientA = await newClient(); const clientB = await newClient();
  assert.equal((await upload(clientA, {}, accountant)).statusCode, 403);
  assert.equal((await upload(clientA, {}, trainer)).statusCode, 403, 'read-only trainer cannot upload');
  const staffOnly = await upload(clientA); assert.equal(staffOnly.statusCode, 201, staffOnly.body);
  const visible = await upload(clientA, { title: 'Autorización', documentType: 'consent', visibility: 'client_visible' }); assert.equal(visible.statusCode, 201, visible.body);
  assert.ok(!JSON.stringify(staffOnly.json()).includes('objectKey'));
  assert.ok(!JSON.stringify(staffOnly.json()).includes('client-documents/'));
  const staffList = await trainer.inject({ method: 'GET', url: `/api/clients/${clientA}/documents` });
  assert.equal(staffList.statusCode, 200); assert.equal(staffList.json().items.length, 2);
  assert.equal((await accountant.inject({ method: 'GET', url: `/api/clients/${clientA}/documents` })).statusCode, 403);
  memberClientId = clientA;
  const deniedStaffOnly = await portal.inject({ method: 'GET', url: `/api/client-portal/documents/${staffOnly.json().id}/download` });
  assert.equal(deniedStaffOnly.statusCode, 404);
  const clientList = await portal.inject({ method: 'GET', url: '/api/client-portal/documents' });
  assert.equal(clientList.statusCode, 200); assert.deepEqual(clientList.json().items.map((item) => item.id), [visible.json().id]);
  const ownFile = await portal.inject({ method: 'GET', url: `/api/client-portal/documents/${visible.json().id}/download` });
  assert.equal(ownFile.statusCode, 200); assert.deepEqual(ownFile.rawPayload, pdf());
  assert.equal(ownFile.headers['content-type'], 'application/pdf'); assert.equal(ownFile.headers['x-content-type-options'], 'nosniff');
  assert.equal(ownFile.headers['content-disposition'], 'attachment; filename="documento.pdf"');
  assert.match(ownFile.headers['cache-control'], /no-store/);
  memberClientId = clientB;
  assert.equal((await portal.inject({ method: 'GET', url: `/api/client-portal/documents/${visible.json().id}/download` })).statusCode, 404, 'another client cannot guess an id');
  assert.equal((await trainer.inject({ method: 'GET', url: `/api/clients/${clientB}/documents/${visible.json().id}/download` })).statusCode, 404, 'staff URL is scoped to both path ids');
  const audit = await sql`SELECT action,actor_kind AS "actorKind" FROM client_document_audit_events WHERE document_id=${staffOnly.json().id}::uuid OR document_id=${visible.json().id}::uuid ORDER BY occurred_at,id`;
  assert.ok(audit.some((row) => row.action === 'uploaded' && row.actorKind === 'staff'));
  assert.ok(audit.some((row) => row.action === 'downloaded' && row.actorKind === 'client'));
  assert.ok(storage.objects.size >= 2);
});

test('visibility changes are permission-checked and audited; unsupported content and invalid metadata never persist', async () => {
  const clientId = await newClient();
  const created = await upload(clientId); assert.equal(created.statusCode, 201);
  assert.equal((await trainer.inject({ method: 'PATCH', url: `/api/clients/${clientId}/documents/${created.json().id}/visibility`, payload: { visibility: 'client_visible' } })).statusCode, 403);
  const changed = await admin.inject({ method: 'PATCH', url: `/api/clients/${clientId}/documents/${created.json().id}/visibility`, payload: { visibility: 'client_visible' } });
  assert.equal(changed.statusCode, 200); assert.equal(changed.json().visibility, 'client_visible');
  const event = await sql`SELECT details FROM client_document_audit_events WHERE document_id=${created.json().id}::uuid AND action='visibility_changed'`;
  assert.deepEqual(event[0].details, { from: 'staff_only', to: 'client_visible' });
  const unsupported = await admin.inject({ method: 'POST', url: `/api/clients/${clientId}/documents`, ...multipart(Buffer.from('<html>payload</html>'), { filename: 'fake.pdf', declaredType: 'application/pdf' }) });
  assert.equal(unsupported.statusCode, 415); assert.equal(unsupported.json().error, 'unsupported_document_type');
  const badType = await admin.inject({ method: 'POST', url: `/api/clients/${clientId}/documents`, ...multipart(pdf(), { documentType: 'health_record' }) });
  assert.equal(badType.statusCode, 400);
  const otherClient = await newClient();
  assert.equal((await admin.inject({ method: 'GET', url: `/api/clients/${otherClient}/documents/${created.json().id}/download` })).statusCode, 404);
});

test('object keys remain server-generated and local storage rejects path traversal', async () => {
  const clientId = await newClient(); const uploaded = await upload(clientId, { filename: '../../private.pdf' });
  assert.equal(uploaded.statusCode, 201);
  const rows = await sql`SELECT object_key AS "objectKey" FROM client_documents WHERE id=${uploaded.json().id}::uuid`;
  assert.match(rows[0].objectKey, new RegExp(`^client-documents/${clientId}/[0-9a-f-]{36}\\.pdf$`));
  assert.ok(!rows[0].objectKey.includes('private.pdf'));
  const local = new LocalObjectStorage('.local-object-storage');
  await assert.rejects(() => local.get('../escape.pdf'), /Invalid object key/);
});
