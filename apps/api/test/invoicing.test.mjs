import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import zlib from 'node:zlib';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { MemoryObjectStorage } from '../src/object-storage.ts';
import { renderInvoicePdf, rateBreakdown } from '../src/invoice-pdf.ts';
import { sniffLogo, svgIsSafe } from '../src/invoicing.ts';
import { ensureCashSessionForActor } from './cash-fixture.mjs';

process.env.NODE_ENV ??= 'test';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: invoicing tests cannot be skipped.');
const sql = postgres(process.env.DATABASE_URL, { max: 6, connect_timeout: 5 });
await migrateDatabase(sql);
const storage = new MemoryObjectStorage();
const as = (role) => buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: `invoicing-${role}`, role }), objectStorage: storage });
const admin = as('admin');
const accountant = as('accountant');
const trainer = as('trainer');
const anonymous = buildServer(process.env.DATABASE_URL, { objectStorage: storage });
after(async () => {
  await sql`UPDATE economic_invoice_settings SET issuer_name=NULL,issuer_tax_id=NULL,issuer_address=NULL,issuer_postal_code=NULL,issuer_locality=NULL,issuer_province=NULL,default_igic_basis_points=300,default_series_id=NULL,footer_text=NULL,legal_text=NULL,logo_key=NULL,logo_mime=NULL`;
  await Promise.all([admin.close(), accountant.close(), trainer.close(), anonymous.close()]); await sql.end();
});

const tag = randomUUID().slice(0, 6).toUpperCase();
function makePng() {
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]); const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body)); return Buffer.concat([length, body, crc]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(2, 0); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.concat([0, 1].map(() => Buffer.concat([Buffer.from([0]), Buffer.from([164, 214, 94, 35, 39, 43, 35, 39, 43, 164, 214, 94])])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
const PNG = makePng();
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#a4d65e"/></svg>');
function multipart(data, filename) {
  const boundary = `----2j-logo-${randomUUID()}`;
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
  return { payload: Buffer.concat([head, data, Buffer.from(`\r\n--${boundary}--\r\n`)]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
const putLogo = (app, data, filename = 'logo.png') => { const m = multipart(data, filename); return app.inject({ method: 'PUT', url: '/api/economics/invoice-settings/logo', headers: m.headers, payload: m.payload }); };
const post = (url, payload, app = admin, headers = {}) => app.inject({ method: 'POST', url, headers: { 'idempotency-key': randomUUID(), ...headers }, payload });
async function paidCharge(label, amountCents = 10_300, { fiscal = true } = {}) {
  const client = (await post('/api/clients', { firstName: 'Factura', lastName: `${label} ${tag}` })).json();
  if (fiscal) assert.equal((await admin.inject({ method: 'PUT', url: `/api/clients/${client.id}/fiscal-profile`, payload: { legalName: `Cliente ${label} ${tag}`, taxId: '00000000T', billingAddress: 'Calle Ficticia 1', postalCode: '35000', locality: 'Las Palmas', province: 'Las Palmas', countryCode: 'ES' } })).statusCode, 200);
  const charge = await post('/api/economics/charges', { clientId: client.id, concept: `Cuota ${label} ${tag}`, amountCents, dueOn: '2099-12-10' });
  assert.equal(charge.statusCode, 201, charge.body);
  await ensureCashSessionForActor(sql, 'invoicing-admin');
  assert.equal((await post('/api/economics/payments', { chargeId: charge.json().id, splits: [{ method: 'card', amountCents }] })).statusCode, 201);
  return { clientId: client.id, chargeId: charge.json().id };
}
const document = async (id) => (await admin.inject({ method: 'GET', url: `/api/economics/documents/${id}` })).json();

test('unit: logos are identified by their bytes, unsafe SVG is refused and the IGIC breakdown groups by rate', () => {
  assert.equal(sniffLogo(PNG).mime, 'image/png');
  assert.equal(sniffLogo(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])).mime, 'image/jpeg');
  assert.equal(sniffLogo(SVG).mime, 'image/svg+xml');
  assert.equal(sniffLogo(Buffer.from('MZ\x90\x00 not an image')), null);
  assert.equal(sniffLogo(Buffer.from('<html><svg></svg></html>')), null);
  assert.equal(svgIsSafe(SVG.toString()), true);
  for (const bad of ['<svg><script>alert(1)</script></svg>', '<svg onload="x()"></svg>', '<svg><foreignObject/></svg>', '<svg><image href="https://x.test/a.png"/></svg>', '<svg><use href="http://x.test/a.svg#b"/></svg>', '<!DOCTYPE svg [<!ENTITY a "b">]><svg/>']) assert.equal(svgIsSafe(bad), false, bad);
  const rows = rateBreakdown([
    { description: 'a', netCents: 1000, taxTreatment: 'taxable', taxRateBasisPoints: 300, taxCents: 30 }, { description: 'b', netCents: 2000, taxTreatment: 'taxable', taxRateBasisPoints: 700, taxCents: 140 },
    { description: 'c', netCents: 500, taxTreatment: 'taxable', taxRateBasisPoints: 300, taxCents: 15 }, { description: 'd', netCents: 100, taxTreatment: 'exempt', taxRateBasisPoints: null, taxCents: 0 },
  ]);
  assert.deepEqual(rows.map((row) => [row.taxTreatment, row.rateBasisPoints, row.baseCents, row.taxCents]), [['exempt', null, 100, 0], ['taxable', 300, 1500, 45], ['taxable', 700, 2000, 140]]);
});

test('unit: the PDF renderer returns a valid A4 PDF with the right title, repeats the table over pages and makes a short roll for tickets', async () => {
  const line = (n) => ({ description: `Cuota ${n}`, netCents: 1000, taxTreatment: 'taxable', taxRateBasisPoints: 300, taxCents: 30 });
  const data = (lines, extra = {}) => ({ documentType: 'full_invoice', documentNumber: 'F-1', documentDate: '2026-10-29', issuer: { name: 'Emisor Sintético', taxId: 'B00000000' }, client: { name: 'Cliente Sintético' }, lines, totals: { netCents: lines.length * 1000, taxCents: lines.length * 30, grossCents: lines.length * 1030 }, paymentMethods: [{ method: 'cash', amountCents: lines.length * 1030 }], paymentStatus: 'paid', ...extra });
  const one = await renderInvoicePdf(data([line(1)]));
  assert.equal(one.subarray(0, 5).toString(), '%PDF-');
  assert.match(one.toString('latin1'), /\/Title \(\\376\\377|\/Title/);
  const pageCount = (buffer) => (buffer.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
  assert.equal(pageCount(one), 1);
  assert.match(one.toString('latin1'), /\/MediaBox \[0 0 595\.28 841\.89\]/);
  assert.ok(pageCount(await renderInvoicePdf(data(Array.from({ length: 45 }, (_, i) => line(i))))) >= 2, 'long invoices continue on more pages');
  const ticket = await renderInvoicePdf(data([line(1)], { documentType: 'simplified_ticket' }), { variant: 'ticket' });
  assert.match(ticket.toString('latin1'), /\/MediaBox \[0 0 226\.77 /);
  const noLogoNoFields = await renderInvoicePdf(data([line(1)], { issuer: {}, client: {} }));
  assert.equal(noLogoNoFields.subarray(0, 5).toString(), '%PDF-', 'empty fields never break the document');
});

test('invoicing needs authentication and the billing profiles: the trainer sees nothing, the accountant reads but cannot configure', async () => {
  assert.equal((await anonymous.inject({ method: 'GET', url: '/api/economics/invoice-settings' })).statusCode, 401);
  assert.equal((await trainer.inject({ method: 'GET', url: '/api/economics/invoice-settings' })).statusCode, 403);
  assert.equal((await accountant.inject({ method: 'GET', url: '/api/economics/invoice-settings' })).statusCode, 200);
  assert.equal((await accountant.inject({ method: 'PUT', url: '/api/economics/invoice-settings', payload: { issuerName: 'X' } })).statusCode, 403);
  assert.equal((await putLogo(accountant, PNG)).statusCode, 403);
  assert.equal((await trainer.inject({ method: 'GET', url: '/api/economics/documents/00000000-0000-4000-8000-000000000000/pdf' })).statusCode, 403);
});

test('with the settings empty nothing can be issued and the answer says exactly what is missing (A65)', async () => {
  await sql`UPDATE economic_invoice_settings SET issuer_name=NULL,issuer_tax_id=NULL,issuer_address=NULL,default_series_id=NULL`;
  const settings = (await admin.inject({ method: 'GET', url: '/api/economics/invoice-settings' })).json();
  assert.deepEqual(settings.missing, ['nombre o razón social', 'NIF', 'dirección', 'serie de numeración']);
  assert.equal(settings.defaultIgicBasisPoints, 300);
  const { chargeId } = await paidCharge('Vacía');
  const refused = await post(`/api/economics/charges/${chargeId}/invoice`, { documentType: 'full_invoice' });
  assert.equal(refused.statusCode, 409); assert.equal(refused.json().error, 'issuer_incomplete'); assert.deepEqual(refused.json().missing, ['nombre o razón social', 'NIF', 'dirección', 'serie de numeración']);
});

test('the owner fills the settings and logo; invalid, oversized and unsafe logos are refused; the logo is stored privately by content', async () => {
  const series = (await post('/api/economics/invoice-series', { name: `Serie ${tag}`, prefix: `F${tag}` })).json();
  assert.equal((await admin.inject({ method: 'PUT', url: '/api/economics/invoice-settings', payload: { issuerName: `Emisor Sintético ${tag}`, issuerTaxId: 'B00000000', issuerAddress: 'Calle del Emisor 1', issuerPostalCode: '35000', issuerLocality: 'Las Palmas', issuerProvince: 'Las Palmas', defaultIgicBasisPoints: 300, defaultSeriesId: series.id, footerText: 'Pie sintético', legalText: 'Texto legal sintético' } })).statusCode, 200);
  assert.equal((await admin.inject({ method: 'PUT', url: '/api/economics/invoice-settings', payload: { issuerName: 'x', unknownField: 1 } })).statusCode, 400);
  assert.equal((await putLogo(admin, Buffer.from('MZ not an image'), 'logo.png')).statusCode, 415, 'a file named .png is judged by its bytes');
  assert.equal((await putLogo(admin, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>'), 'logo.svg')).statusCode, 422);
  assert.equal((await putLogo(admin, Buffer.concat([PNG, Buffer.alloc(600 * 1024)]), 'big.png')).statusCode, 413);
  const stored = await putLogo(admin, PNG);
  assert.equal(stored.statusCode, 200, stored.body); assert.equal(stored.json().logoMime, 'image/png');
  const settings = (await admin.inject({ method: 'GET', url: '/api/economics/invoice-settings' })).json();
  assert.deepEqual(settings.missing, []); assert.equal(settings.hasLogo, true);
  assert.equal(Object.hasOwn(settings, 'logoKey'), false, 'the storage key is never sent to the browser');
  assert.ok([...storage.objects.keys()].some((key) => /^invoice-logos\/[0-9a-f]{64}\.png$/.test(key)));
  const logo = await admin.inject({ method: 'GET', url: '/api/economics/invoice-settings/logo' });
  assert.equal(logo.statusCode, 200); assert.equal(logo.headers['content-type'], 'image/png');
});

test('issuing numbers documents consecutively with no gaps, splits IGIC per rate, and a refused issue does not burn a number', async () => {
  const a = await paidCharge('Uno');
  const first = await post(`/api/economics/charges/${a.chargeId}/invoice`, { documentType: 'full_invoice' });
  assert.equal(first.statusCode, 201, first.body);
  assert.equal(first.json().documentNumber, `F${tag}-1`);
  const docA = await document(first.json().id);
  assert.deepEqual([docA.totals.netCents, docA.totals.taxCents, docA.totals.grossCents], [10_000, 300, 10_300]);
  assert.deepEqual(docA.totals.byRate, [{ taxTreatment: 'taxable', rateBasisPoints: 300, baseCents: 10_000, taxCents: 300 }]);
  assert.equal(docA.client.taxId, '00000000T'); assert.equal(docA.issuer.name, `Emisor Sintético ${tag}`);
  // Refused before numbering: a client without fiscal data cannot get a full invoice, and the next number is still 2.
  const bare = await paidCharge('Sin NIF', 5_000, { fiscal: false });
  const refused = await post(`/api/economics/charges/${bare.chargeId}/invoice`, { documentType: 'full_invoice' });
  assert.equal(refused.statusCode, 409); assert.equal(refused.json().error, 'client_fiscal_data_missing');
  const b = await paidCharge('Dos', 10_700);
  const second = await post(`/api/economics/charges/${b.chargeId}/invoice`, { documentType: 'full_invoice', igicBasisPoints: 700 });
  assert.equal(second.statusCode, 201, second.body);
  assert.equal(second.json().documentNumber, `F${tag}-2`, 'no gap after the refused attempt');
  const docB = await document(second.json().id);
  assert.deepEqual([docB.totals.netCents, docB.totals.taxCents, docB.totals.grossCents], [10_000, 700, 10_700]);
  assert.deepEqual(docB.totals.byRate.map((row) => row.rateBasisPoints), [700]);
  const ticket = await post(`/api/economics/charges/${bare.chargeId}/invoice`, { documentType: 'simplified_ticket' });
  assert.equal(ticket.statusCode, 201, ticket.body); assert.equal(ticket.json().documentNumber, `F${tag}-3`);
  assert.equal((await post(`/api/economics/charges/${a.chargeId}/invoice`, { documentType: 'full_invoice' })).statusCode, 409, 'a charge is documented once');
  const list = (await admin.inject({ method: 'GET', url: `/api/economics/charges/${a.chargeId}/documents` })).json();
  assert.deepEqual(list.items.map((item) => [item.documentNumber, item.status, item.isRectified, item.grossCents]), [[`F${tag}-1`, 'issued', false, 10_300]]);
  assert.equal(list.canIssue, true);
  assert.equal((await accountant.inject({ method: 'GET', url: `/api/economics/charges/${a.chargeId}/documents` })).json().canIssue, false);
  const [unused] = await sql`SELECT next_number FROM economic_invoice_series WHERE prefix=${`F${tag}`}`;
  assert.equal(Number(unused.next_number), 4);
});

test('issued documents are immutable, keep the data and logo they were issued with, and download as a valid PDF in both variants', async () => {
  const c = await paidCharge('Inmutable');
  const issued = (await post(`/api/economics/charges/${c.chargeId}/invoice`, { documentType: 'full_invoice' })).json();
  const before = await document(issued.id);
  await assert.rejects(sql`UPDATE economic_fiscal_documents SET document_number='X' WHERE id=${issued.id}::uuid`, { code: '55000' });
  await assert.rejects(sql`DELETE FROM economic_fiscal_documents WHERE id=${issued.id}::uuid`, { code: '55000' });
  await admin.inject({ method: 'PUT', url: '/api/economics/invoice-settings', payload: { issuerName: 'Otro Nombre Posterior', footerText: 'Otro pie' } });
  assert.equal((await putLogo(admin, SVG, 'otro.svg')).statusCode, 200);
  const after = await document(issued.id);
  assert.deepEqual(after.issuer, before.issuer, 'later edits never touch an issued document');
  assert.match(before.issuer.logo.key, /\.png$/);
  const pdf = await admin.inject({ method: 'GET', url: `/api/economics/documents/${issued.id}/pdf` });
  assert.equal(pdf.statusCode, 200); assert.equal(pdf.headers['content-type'], 'application/pdf'); assert.match(pdf.headers['content-disposition'], /^inline; filename="factura-F[A-Z0-9]+-\d+\.pdf"$/);
  assert.equal(pdf.rawPayload.subarray(0, 5).toString(), '%PDF-');
  assert.match(pdf.rawPayload.toString('latin1'), /%%EOF\s*$/, 'a complete PDF file');
  const ticket = await admin.inject({ method: 'GET', url: `/api/economics/documents/${issued.id}/pdf?variant=ticket` });
  assert.equal(ticket.statusCode, 200); assert.match(ticket.rawPayload.toString('latin1'), /\/MediaBox \[0 0 226\.77 /);
  assert.equal((await accountant.inject({ method: 'GET', url: `/api/economics/documents/${issued.id}/pdf` })).statusCode, 200, 'the accountant profile may download');
  assert.equal((await admin.inject({ method: 'GET', url: `/api/economics/documents/${issued.id}/pdf?variant=nope` })).statusCode, 400);
  assert.equal((await admin.inject({ method: 'GET', url: `/api/economics/documents/${randomUUID()}/pdf` })).statusCode, 404);
});

test('a rectifying invoice references the original, reverses its amounts with a new consecutive number and can only be issued once', async () => {
  const c = await paidCharge('Rectificar', 10_300);
  const original = (await post(`/api/economics/charges/${c.chargeId}/invoice`, { documentType: 'full_invoice' })).json();
  assert.equal((await post(`/api/economics/documents/${original.id}/rectify`, { reason: 'ok' })).statusCode, 400, 'a reason of at least three characters is required');
  assert.equal((await post(`/api/economics/documents/${original.id}/rectify`, { reason: 'Error en el importe' }, accountant)).statusCode, 403);
  const rectified = await post(`/api/economics/documents/${original.id}/rectify`, { reason: 'Error en el importe' });
  assert.equal(rectified.statusCode, 201, rectified.body);
  const originalSeq = Number(original.documentNumber.split('-').at(-1));
  assert.equal(rectified.json().documentNumber, `F${tag}-${originalSeq + 1}`); assert.equal(rectified.json().status, 'rectified');
  const doc = await document(rectified.json().id);
  assert.equal(doc.rectifiesDocumentId, original.id); assert.equal(doc.rectificationReason, 'Error en el importe');
  assert.deepEqual([doc.totals.netCents, doc.totals.taxCents, doc.totals.grossCents], [-10_000, -300, -10_300]);
  assert.equal(doc.lines[0].netCents, -10_000);
  assert.equal((await post(`/api/economics/documents/${original.id}/rectify`, { reason: 'Otra vez' })).statusCode, 409, 'only once');
  assert.equal((await post(`/api/economics/documents/${rectified.json().id}/rectify`, { reason: 'Rectificar la rectificativa' })).statusCode, 409);
  const list = (await admin.inject({ method: 'GET', url: `/api/economics/charges/${c.chargeId}/documents` })).json();
  assert.deepEqual(list.items.map((item) => [item.status, item.isRectified]), [['issued', true], ['rectified', false]]);
  const pdf = await admin.inject({ method: 'GET', url: `/api/economics/documents/${rectified.json().id}/pdf` });
  assert.equal(pdf.statusCode, 200); assert.match(pdf.headers['content-disposition'], /rectificativa-/);
});
