import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { MemoryObjectStorage } from '../src/object-storage.ts';
import { ensureCashSessionForActor } from './cash-fixture.mjs';

process.env.NODE_ENV ??= 'test';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: member invoice tests cannot be skipped.');
const sql = postgres(process.env.DATABASE_URL, { max: 4, connect_timeout: 5 });
await migrateDatabase(sql);
const storage = new MemoryObjectStorage();
const sessions = new Map();
const staff = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'member-invoices-admin', role: 'admin' }), objectStorage: storage });
const member = buildServer(process.env.DATABASE_URL, { clientAuthorizationResolver: async (request) => sessions.get(String(request.headers['x-test-client'] ?? '')) ?? null, objectStorage: storage });
const staffOnly = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'member-invoices-admin', role: 'admin' }), objectStorage: storage });
after(async () => {
  await sql`UPDATE economic_invoice_settings SET issuer_name=NULL,issuer_tax_id=NULL,issuer_address=NULL,issuer_postal_code=NULL,issuer_locality=NULL,issuer_province=NULL,default_igic_basis_points=300,default_series_id=NULL,footer_text=NULL,legal_text=NULL,logo_key=NULL,logo_mime=NULL`;
  await Promise.all([staff.close(), member.close(), staffOnly.close()]); await sql.end();
});

const tag = randomUUID().slice(0, 6).toUpperCase();
const post = (url, payload) => staff.inject({ method: 'POST', url, headers: { 'idempotency-key': randomUUID() }, payload });
async function paidCharge(label, amountCents = 10_300) {
  const client = (await post('/api/clients', { firstName: 'Socio', lastName: `${label} ${tag}` })).json();
  assert.equal((await staff.inject({ method: 'PUT', url: `/api/clients/${client.id}/fiscal-profile`, payload: { legalName: `Cliente ${label} ${tag}`, taxId: '00000000T', billingAddress: 'Calle Ficticia 1', postalCode: '35000', locality: 'Las Palmas', province: 'Las Palmas', countryCode: 'ES' } })).statusCode, 200);
  const charge = await post('/api/economics/charges', { clientId: client.id, concept: `Cuota ${label} ${tag}`, amountCents, dueOn: '2099-12-10' });
  assert.equal(charge.statusCode, 201, charge.body);
  await ensureCashSessionForActor(sql, 'member-invoices-admin');
  assert.equal((await post('/api/economics/payments', { chargeId: charge.json().id, splits: [{ method: 'card', amountCents }] })).statusCode, 201);
  return { clientId: client.id, chargeId: charge.json().id };
}
const asMember = (clientId, key) => { sessions.set(key, { clientId }); return { 'x-test-client': key }; };

test('a member lists only their own documents, with no issuer, client or other-member data, and downloads their own PDF', async () => {
  const series = (await post('/api/economics/invoice-series', { name: `Serie ${tag}`, prefix: `M${tag}` })).json();
  assert.equal((await staff.inject({ method: 'PUT', url: '/api/economics/invoice-settings', payload: { issuerName: `Emisor Sintético ${tag}`, issuerTaxId: 'B00000000', issuerAddress: 'Calle del Emisor 1', defaultIgicBasisPoints: 300, defaultSeriesId: series.id } })).statusCode, 200);
  const a = await paidCharge('A'); const b = await paidCharge('B');
  const docA = (await post(`/api/economics/charges/${a.chargeId}/invoice`, { documentType: 'full_invoice' })).json();
  const docB = (await post(`/api/economics/charges/${b.chargeId}/invoice`, { documentType: 'full_invoice' })).json();
  const rect = await post(`/api/economics/documents/${docA.id}/rectify`, { reason: 'Importe mal cobrado' });
  assert.equal(rect.statusCode, 201, rect.body);
  const headersA = asMember(a.clientId, 'a'); const headersB = asMember(b.clientId, 'b');

  const listA = await member.inject({ method: 'GET', url: '/api/me/invoices', headers: headersA });
  assert.equal(listA.statusCode, 200, listA.body);
  assert.equal(listA.headers['cache-control'], 'private, no-store');
  const itemsA = listA.json().items;
  assert.deepEqual(itemsA.map((item) => [item.id, item.isRectification, item.isRectified]).sort(), [[docA.id, false, true], [rect.json().id, true, false]].sort());
  assert.deepEqual(Object.keys(itemsA[0]).sort(), ['documentDate', 'documentNumber', 'documentType', 'grossCents', 'id', 'isRectification', 'isRectified', 'status']);
  const raw = listA.body;
  for (const forbidden of [docB.id, docB.documentNumber, `Cliente B ${tag}`, 'B00000000', 'Emisor Sintético', b.clientId, a.clientId, 'Calle Ficticia']) assert.equal(raw.includes(forbidden), false, `the member list must not contain ${forbidden}`);
  const listB = (await member.inject({ method: 'GET', url: '/api/me/invoices', headers: headersB })).json().items;
  assert.deepEqual(listB.map((item) => item.id), [docB.id]);

  const pdf = await member.inject({ method: 'GET', url: `/api/me/invoices/${docA.id}/pdf`, headers: headersA });
  assert.equal(pdf.statusCode, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.equal(pdf.headers['cache-control'], 'private, no-store');
  assert.equal(pdf.rawPayload.subarray(0, 5).toString(), '%PDF-');
  const staffPdf = await staff.inject({ method: 'GET', url: `/api/economics/documents/${docA.id}/pdf` });
  assert.equal(staffPdf.statusCode, 200, 'the staff PDF route keeps working after the shared renderer refactor');
  assert.equal((await member.inject({ method: 'GET', url: `/api/me/invoices/${docA.id}/pdf?variant=ticket`, headers: headersA })).statusCode, 200);
  const rectPdf = await member.inject({ method: 'GET', url: `/api/me/invoices/${rect.json().id}/pdf`, headers: headersA });
  assert.equal(rectPdf.statusCode, 200); assert.match(rectPdf.headers['content-disposition'], /rectificativa-/);
});

test('ownership: another member\'s document, an unknown id and a bad id never leak anything', async () => {
  const a = await paidCharge('C'); const b = await paidCharge('D');
  const docB = (await post(`/api/economics/charges/${b.chargeId}/invoice`, { documentType: 'full_invoice' })).json();
  const headersA = asMember(a.clientId, 'c');
  const foreign = await member.inject({ method: 'GET', url: `/api/me/invoices/${docB.id}/pdf`, headers: headersA });
  assert.equal(foreign.statusCode, 404); assert.deepEqual(foreign.json(), { error: 'document_not_found' });
  const unknown = await member.inject({ method: 'GET', url: `/api/me/invoices/${randomUUID()}/pdf`, headers: headersA });
  assert.equal(unknown.statusCode, 404); assert.deepEqual(unknown.json(), foreign.json(), 'a foreign id is indistinguishable from an unknown one');
  assert.equal((await member.inject({ method: 'GET', url: '/api/me/invoices/not-a-uuid/pdf', headers: headersA })).statusCode, 400);
  assert.equal((await member.inject({ method: 'GET', url: `/api/me/invoices/${docB.id}/pdf?variant=huge`, headers: asMember(b.clientId, 'd') })).statusCode, 400);
  assert.deepEqual((await member.inject({ method: 'GET', url: '/api/me/invoices', headers: headersA })).json().items, [], 'a member without documents gets an empty list');
});

test('authentication: no session, an unknown client, an archived client and a staff-only server are all refused', async () => {
  const a = await paidCharge('E');
  const doc = (await post(`/api/economics/charges/${a.chargeId}/invoice`, { documentType: 'full_invoice' })).json();
  assert.equal((await member.inject({ method: 'GET', url: '/api/me/invoices' })).statusCode, 401);
  assert.equal((await member.inject({ method: 'GET', url: `/api/me/invoices/${doc.id}/pdf` })).statusCode, 401);
  assert.equal((await member.inject({ method: 'GET', url: '/api/me/invoices', headers: asMember(randomUUID(), 'ghost') })).statusCode, 401);
  const headers = asMember(a.clientId, 'e');
  assert.equal((await member.inject({ method: 'GET', url: '/api/me/invoices', headers })).statusCode, 200);
  await sql`UPDATE clients SET status='archived' WHERE id=${a.clientId}::uuid`;
  assert.equal((await member.inject({ method: 'GET', url: '/api/me/invoices', headers })).statusCode, 401);
  assert.equal((await member.inject({ method: 'GET', url: `/api/me/invoices/${doc.id}/pdf`, headers })).statusCode, 401);
  // A staff session is not a member session: the member routes need the client resolver, which a staff-only server does not have.
  assert.equal((await staffOnly.inject({ method: 'GET', url: '/api/me/invoices' })).statusCode, 401);
  // And a member session never opens the staff routes.
  assert.equal((await member.inject({ method: 'GET', url: `/api/economics/documents/${doc.id}/pdf`, headers })).statusCode, 401);
  assert.equal((await member.inject({ method: 'GET', url: `/api/economics/documents/${doc.id}`, headers })).statusCode, 401);
});
