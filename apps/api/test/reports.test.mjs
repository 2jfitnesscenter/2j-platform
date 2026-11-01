import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import zlib from 'node:zlib';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { ensureCashSessionForActor } from './cash-fixture.mjs';

process.env.NODE_ENV ??= 'test';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: report integration tests cannot be skipped.');
const sql = postgres(process.env.DATABASE_URL, { max: 6, connect_timeout: 5 });
await migrateDatabase(sql);
await ensureCashSessionForActor(sql, 'reports-test-admin');
const as = (role) => buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: `reports-test-${role}`, role }) });
const admin = as('admin');
const accountant = as('accountant');
const trainer = as('trainer');
const reception = as('reception-management');
const anonymous = buildServer(process.env.DATABASE_URL);
const billingOnly = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'reports-billing-only', role: 'owner', explicitPermissions: ['billing.export'] }) });
const ownerPanel = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'reports-owner', role: 'admin', explicitPermissions: ['owner.panel.read'] }) });
after(async () => { await Promise.all([admin.close(), accountant.close(), trainer.close(), reception.close(), anonymous.close(), billingOnly.close(), ownerPanel.close()]); await sql.end(); });

const tag = randomUUID().slice(0, 8);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const range = `from=${today}&to=${today}`;
const post = (url, payload, headers = {}) => admin.inject({ method: 'POST', url, headers: { 'idempotency-key': randomUUID(), ...headers }, payload });
async function client(lastName, firstName = 'Informe') {
  const response = await post('/api/clients', { firstName, lastName: `${lastName} ${tag}` });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().id;
}
async function charge(clientId, concept, amountCents) {
  const response = await post('/api/economics/charges', { clientId, concept, amountCents, dueOn: '2099-12-10' });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().id;
}
async function pay(chargeId, method, amountCents) {
  const response = await post('/api/economics/payments', { chargeId, splits: [{ method, amountCents }] });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().id;
}
const rows = async (extra = '', app = admin) => { const response = await app.inject({ method: 'GET', url: `/api/reports/sales?${range}&limit=500${extra}` }); assert.equal(response.statusCode, 200, response.body); return response.json(); };
const mine = (body) => body.items.filter((item) => item.clientName.endsWith(tag));

test('reports need authentication and billing.read-basic; only billing.export roles can download the CSV', async () => {
  assert.equal((await anonymous.inject({ method: 'GET', url: `/api/reports/sales?${range}` })).statusCode, 401);
  assert.equal((await trainer.inject({ method: 'GET', url: `/api/reports/sales?${range}` })).statusCode, 403);
  const receptionList = await reception.inject({ method: 'GET', url: `/api/reports/sales?${range}` });
  assert.equal(receptionList.statusCode, 200, 'reception already reads charges (billing.read-basic)');
  assert.equal(receptionList.json().capabilities.export, false, 'but cannot export');
  assert.equal((await accountant.inject({ method: 'GET', url: `/api/reports/sales?${range}` })).statusCode, 200);
  assert.equal((await accountant.inject({ method: 'GET', url: `/api/reports/sales.csv?${range}` })).statusCode, 200);
  assert.equal((await reception.inject({ method: 'GET', url: `/api/reports/sales.csv?${range}` })).statusCode, 403);
  assert.equal((await trainer.inject({ method: 'GET', url: `/api/reports/sales.csv?${range}` })).statusCode, 403);
  assert.equal((await anonymous.inject({ method: 'GET', url: `/api/reports/sales.csv?${range}` })).statusCode, 401);
  assert.equal((await admin.inject({ method: 'GET', url: `/api/reports/sales?${range}` })).json().capabilities.export, true);
});

test('sold versus collected: paid, partial, pending and voided charges and store sales appear with the right state and totals', async () => {
  const [paidId, partialId, pendingId, voidedId, storeId] = await Promise.all([client('Pagada'), client('Parcial'), client('Pendiente'), client('Anulada'), client('Tienda')]);
  await pay(await charge(paidId, `Cuota completa ${tag}`, 5000), 'card', 5000);
  await pay(await charge(partialId, `Cuota parcial ${tag}`, 6000), 'transfer', 2000);
  await charge(pendingId, `Cuota pendiente ${tag}`, 4000);
  const toVoid = await charge(voidedId, `Cuota anulada ${tag}`, 3000);
  const voidResponse = await admin.inject({ method: 'POST', url: `/api/economics/charges/${toVoid}/void`, headers: { 'idempotency-key': randomUUID() }, payload: { reason: 'Prueba de informe' } });
  assert.ok([200, 201].includes(voidResponse.statusCode), voidResponse.body);
  const product = (await post('/api/admin/store/products', { category: 'nutrition', name: `Producto ${tag}`, description: 'Prueba' })).json();
  const variant = (await post(`/api/admin/store/products/${product.id}/variants`, { label: 'Bote', priceCents: 1500, stockTracked: true, active: true, sku: null })).json();
  assert.equal((await post(`/api/admin/store/variants/${variant.id}/movements`, { type: 'opening', quantity: 5, reason: 'Apertura sintética' })).statusCode, 201);
  const sale = await post('/api/admin/store/sales', { clientId: storeId, lines: [{ variantId: variant.id, quantity: 2 }], paymentState: 'pending', paymentMethod: null, note: '' });
  assert.equal(sale.statusCode, 201, sale.body);

  const body = await rows();
  const byClient = Object.fromEntries(mine(body).map((item) => [item.clientName.split(' ')[1], item]));
  assert.deepEqual([byClient.Pagada.status, byClient.Pagada.soldCents, byClient.Pagada.collectedCents, byClient.Pagada.methods, byClient.Pagada.kind], ['paid', 5000, 5000, ['card'], 'charge']);
  assert.deepEqual([byClient.Parcial.status, byClient.Parcial.soldCents, byClient.Parcial.collectedCents, byClient.Parcial.methods], ['partial', 6000, 2000, ['transfer']]);
  assert.deepEqual([byClient.Pendiente.status, byClient.Pendiente.collectedCents], ['pending', 0]);
  assert.equal(byClient.Anulada.status, 'void');
  assert.equal(byClient.Tienda.kind, 'store');
  assert.deepEqual([byClient.Tienda.soldCents, byClient.Tienda.collectedCents, byClient.Tienda.status], [3000, 0, 'pending']);
  assert.match(byClient.Tienda.concept, /2 × Producto/);

  const only = { ...body, items: mine(body) };
  const totals = (await admin.inject({ method: 'GET', url: `/api/reports/sales?${range}&limit=500&q=${encodeURIComponent(tag)}` })).json().totals;
  assert.equal(totals.soldCents, 5000 + 6000 + 4000 + 3000, 'voided charges are not sold');
  assert.equal(totals.collectedCents, 5000 + 2000);
  assert.equal(totals.pendingCents, totals.soldCents - totals.collectedCents);
  assert.equal(totals.voidedCount, 1);
  assert.equal(totals.voidedCents, 3000);
  assert.equal(only.items.length, 5);
});

test('filters: kind, payment method, invoice and free text (accent-insensitive) narrow the list; the date range is respected', async () => {
  const filtered = async (extra) => mine(await rows(`&q=${encodeURIComponent(tag)}${extra}`)).map((item) => item.clientName.split(' ')[1]).sort();
  assert.deepEqual(await filtered('&kind=store'), ['Tienda']);
  assert.deepEqual(await filtered('&kind=charge'), ['Anulada', 'Pagada', 'Parcial', 'Pendiente']);
  assert.deepEqual(await filtered('&method=transfer'), ['Parcial']);
  assert.deepEqual(await filtered('&method=card'), ['Pagada']);
  assert.deepEqual(await filtered('&invoice=with'), []);
  assert.equal((await filtered('&invoice=without')).length, 5);
  const accented = (await admin.inject({ method: 'GET', url: `/api/reports/sales?${range}&q=${encodeURIComponent(`informe pagada ${tag}`.toUpperCase())}` })).json();
  assert.equal(accented.items.length, 1);
  const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary' }).format(new Date(Date.now() - 2 * 86_400_000));
  const past = (await admin.inject({ method: 'GET', url: `/api/reports/sales?from=${yesterday}&to=${yesterday}&q=${encodeURIComponent(tag)}` })).json();
  assert.deepEqual(past.items, [], 'nothing was created on that earlier day');
});

test('invalid queries are rejected: inverted or very long ranges, unknown keys, bad enums and limits', async () => {
  for (const query of ['from=2026-02-01&to=2026-01-01', 'from=2024-01-01&to=2026-01-01', `${range}&x=1`, `${range}&kind=nope`, `${range}&method=bitcoin`, `${range}&limit=501`, 'from=2026-13-40&to=2026-13-41', `from=${today}`]) {
    assert.equal((await admin.inject({ method: 'GET', url: `/api/reports/sales?${query}` })).statusCode, 400, query);
  }
});

test('the CSV has a BOM, semicolons, Spanish decimals, the same rows as the list, and neutralises formula-looking text', async () => {
  const evil = await client('Fórmula', '=HYPERLINK("x")');
  await charge(evil, `+Cuota ${tag}`, 1234);
  const response = await admin.inject({ method: 'GET', url: `/api/reports/sales.csv?${range}&q=${encodeURIComponent(tag)}` });
  assert.equal(response.statusCode, 200, response.body);
  assert.match(response.headers['content-type'], /text\/csv/);
  assert.match(response.headers['content-disposition'], /ventas-.*\.csv/);
  const text = response.body;
  assert.equal(text.charCodeAt(0), 0xFEFF, 'UTF-8 BOM so Excel reads accents');
  const lines = text.trim().split('\r\n');
  assert.equal(lines[0], '"Fecha";"Cliente";"Concepto";"Tipo";"Vendido (EUR)";"Cobrado (EUR)";"Pendiente (EUR)";"Estado";"Métodos";"Factura"');
  assert.equal(lines.length - 1, (await rows(`&q=${encodeURIComponent(tag)}`)).items.length, 'same number of rows as the list');
  assert.ok(lines.some((line) => line.includes('"12,34"')), 'euros use a decimal comma');
  assert.ok(lines.some((line) => line.includes(`"'+Cuota ${tag}"`)), 'a concept starting with + is neutralised');
  assert.ok(lines.some((line) => line.includes('"\'=HYPERLINK')), 'a client name starting with = is neutralised');
});

// ---- A59: pestaña Resumen (KPIs) y exportación Excel multi-hoja (D109) ----
const summaryUrl = `/api/reports/summary?${range}`;
const summary = async (app = admin) => { const response = await app.inject({ method: 'GET', url: summaryUrl }); assert.equal(response.statusCode, 200, response.body); return response.json(); };

test('summary needs billing.read-basic, validates the range (max 366 days) and exposes no personal data', async () => {
  assert.equal((await anonymous.inject({ method: 'GET', url: summaryUrl })).statusCode, 401);
  assert.equal((await trainer.inject({ method: 'GET', url: summaryUrl })).statusCode, 403);
  assert.equal((await reception.inject({ method: 'GET', url: summaryUrl })).statusCode, 200);
  assert.equal((await reception.inject({ method: 'GET', url: summaryUrl })).json().capabilities.export, false);
  assert.equal((await admin.inject({ method: 'GET', url: '/api/reports/summary?from=2026-10-10&to=2026-10-01' })).statusCode, 400);
  assert.equal((await admin.inject({ method: 'GET', url: '/api/reports/summary?from=2025-01-01&to=2026-10-01' })).statusCode, 400, 'more than 366 days');
  assert.equal((await admin.inject({ method: 'GET', url: `${summaryUrl}&x=1` })).statusCode, 400, 'unknown parameters are rejected');
  assert.equal((await admin.inject({ method: 'GET', url: '/api/reports/summary?from=2026-02-31&to=2026-03-01' })).statusCode, 400);
  const body = JSON.stringify(await summary());
  assert.ok(!body.includes(tag) && !/clientName|email|phone|health/i.test(body), 'only aggregates');
});

test('summary computes monthly income, overdue-unpaid, average fee and collected by method from the same entries as the list', async () => {
  const before = await summary();
  const [a, b] = await Promise.all([client('KpiA'), client('KpiB')]);
  await pay(await charge(a, `Cuota kpi ${tag}`, 7000), 'transfer', 7000);
  const overdueCharge = await post('/api/economics/charges', { clientId: b, concept: `Vencida kpi ${tag}`, amountCents: 3000, dueOn: '2020-01-15' });
  assert.equal(overdueCharge.statusCode, 201, overdueCharge.body);
  const after = await summary();
  assert.equal(after.overdue.cents - before.overdue.cents, 3000);
  assert.equal(after.overdue.count - before.overdue.count, 1);
  const month = today.slice(0, 7);
  const monthOf = (body) => body.monthly.find((row) => row.month === month);
  assert.equal(monthOf(after).soldCents - monthOf(before).soldCents, 10000);
  assert.equal(monthOf(after).collectedCents - monthOf(before).collectedCents, 7000);
  const transfer = (body) => body.collectedByMethod.find((row) => row.method === 'transfer')?.cents ?? 0;
  assert.equal(transfer(after) - transfer(before), 7000);
  assert.ok(Number.isInteger(after.averageFee.cents) && after.occupancy.rate === null || after.occupancy.rate >= 0);
  const wide = await admin.inject({ method: 'GET', url: `/api/reports/summary?from=${Number(today.slice(0, 4)) - 1}-${today.slice(5, 7)}-${today.slice(8, 10)}&to=${today}` });
  assert.equal(wide.statusCode, 200);
  assert.ok(wide.json().monthly.length >= 12, 'one point per month, empty months included');
});

function unzip(buffer) {
  const entries = {}; let end = buffer.length - 22; while (buffer.readUInt32LE(end) !== 0x06054b50) end -= 1;
  const count = buffer.readUInt16LE(end + 10); let offset = buffer.readUInt32LE(end + 16);
  for (let i = 0; i < count; i += 1) {
    const size = buffer.readUInt32LE(offset + 20); const nameLength = buffer.readUInt16LE(offset + 28); const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    entries[name] = zlib.inflateRawSync(buffer.subarray(start, start + size)).toString('utf8');
    offset += 46 + nameLength;
  }
  return entries;
}

test('detailed exports need economy.read, and selected XLSX sections neutralise formula-like free text', async () => {
  const url = `/api/reports/export.xlsx?${range}`;
  assert.equal((await anonymous.inject({ method: 'GET', url })).statusCode, 401);
  assert.equal((await reception.inject({ method: 'GET', url })).statusCode, 403);
  assert.equal((await trainer.inject({ method: 'GET', url })).statusCode, 403);
  assert.equal((await billingOnly.inject({ method: 'GET', url })).statusCode, 403, 'legacy billing.export does not silently grant the new economy.read permission');
  assert.equal((await admin.inject({ method: 'GET', url: '/api/reports/export.xlsx?from=2026-10-10&to=2026-10-01' })).statusCode, 400);
  for (const section of ['sales','payments','pending','defaults','cash','expenses','igic','staffHours']) {
    const sectionResponse = await accountant.inject({ method: 'GET', url: `${url}&sections=${section}` });
    assert.equal(sectionResponse.statusCode, 200, `${section}: ${sectionResponse.body}`);
  }
  const defaultExport = await accountant.inject({ method: 'GET', url });
  assert.equal(defaultExport.statusCode, 200, `accountant receives economy.read: ${defaultExport.body}`);
  assert.equal((await accountant.inject({ method: 'GET', url: `${url}&sections=unknown` })).statusCode, 400);
  const remaining = await accountant.inject({ method: 'GET', url: `${url}&sections=pending,defaults,cash,expenses,igic,staffHours` });
  assert.equal(remaining.statusCode, 200, remaining.body);
  const remainingWorkbook = unzip(remaining.rawPayload)['xl/workbook.xml'];
  for (const name of ['Totales', 'Pendientes y programados', 'Impagos y cancelaciones', 'Caja', 'Traspasos de caja', 'Gastos y retiradas', 'IGIC por tipo', 'Horas de personal']) assert.ok(remainingWorkbook.includes(`name="${name}"`), name);
  const evil = await client('Formula', '=HYPERLINK("http://x")');
  await pay(await charge(evil, `=1+1 ${tag}`, 1234), 'cash', 1234);
  const response = await accountant.inject({ method: 'GET', url: `${url}&sections=sales,payments` });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /spreadsheetml\.sheet/);
  assert.match(response.headers['content-disposition'], /economia-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.xlsx/);
  const files = unzip(response.rawPayload);
  const workbook = files['xl/workbook.xml'];
  for (const name of ['Totales', 'Ventas', 'Cobros por método']) assert.ok(workbook.includes(`name="${name}"`), name);
  for (const name of ['Pendientes y programados', 'Impagos y cancelaciones', 'Caja', 'IGIC por tipo', 'Horas de personal']) assert.ok(!workbook.includes(`name="${name}"`), `${name} omitted when not selected`);
  const sales = files['xl/worksheets/sheet2.xml'];
  assert.ok(sales.includes(`'=1+1 ${tag}`) && sales.includes(`'=HYPERLINK`), 'formula-looking text is prefixed');
  assert.ok(!/<t[^>]*>=/.test(sales) && !sales.includes('<f>'), 'no cell starts with = and there are no formulas');
  assert.ok(sales.includes('<v>12.34</v>'), 'amounts are numeric euros');
});

test('XLSX totals match the Reports dashboard summary and cash differences appear only for owner.panel.read', async () => {
  const customer = await client('ExportTotal');
  await pay(await charge(customer, `Cobro export total ${tag}`, 4321), 'card', 4321);
  const dashboard = await summary();
  const expectedSold = dashboard.monthly.reduce((sum, item) => sum + item.soldCents, 0) / 100;
  const expectedCollected = dashboard.monthly.reduce((sum, item) => sum + item.collectedCents, 0) / 100;
  const [cashSession] = await sql`SELECT id FROM economic_cash_sessions WHERE opened_by='reports-test-admin' AND status='open' AND local_date=(now() AT TIME ZONE 'Atlantic/Canary')::date`;
  assert.ok(cashSession, 'the synthetic report actor has an open register');
  const denominations = Object.fromEntries(['coin_0_01','coin_0_02','coin_0_05','coin_0_10','coin_0_20','coin_0_50','coin_1','coin_2','bill_5','bill_10','bill_20','bill_50','bill_100','bill_200','bill_500'].map(key => [key,0]));
  const closed = await admin.inject({ method: 'POST', url: `/api/economics/cash/${cashSession.id}/close`, payload: { countedDenominations: denominations } });
  assert.equal(closed.statusCode, 200, closed.body);
  const exportUrl = `/api/reports/export.xlsx?${range}&sections=cash`;
  const cashierResponse = await accountant.inject({ method: 'GET', url: exportUrl });
  const ownerResponse = await ownerPanel.inject({ method: 'GET', url: exportUrl });
  assert.equal(cashierResponse.statusCode, 200, cashierResponse.body); assert.equal(ownerResponse.statusCode, 200, ownerResponse.body);
  const cashierFile = unzip(cashierResponse.rawPayload);
  const ownerFile = unzip(ownerResponse.rawPayload);
  const cashSheet = cashierFile['xl/worksheets/sheet2.xml'];
  const ownerCashSheet = ownerFile['xl/worksheets/sheet2.xml'];
  assert.ok(!/<c r="(?:F|G|H|I|J|K|L)2"/.test(cashSheet), 'non-owner gets no cash float, denomination, expected, count or difference cells');
  assert.match(ownerCashSheet, /<c r="K2"[^>]*><v>-?\d+(?:\.\d+)?<\/v><\/c>/, 'owner export includes the register difference');

  const totalsFile = unzip((await accountant.inject({ method: 'GET', url: `/api/reports/export.xlsx?${range}&sections=payments` })).rawPayload);
  const totals = totalsFile['xl/worksheets/sheet1.xml'];
  const cellValue = (ref) => Number(totals.match(new RegExp(`<c r="${ref}"[^>]*><v>([^<]+)<\\/v><\\/c>`))?.[1]);
  assert.equal(cellValue('B5'), expectedSold);
  assert.equal(cellValue('B6'), expectedCollected);
  assert.equal((await billingOnly.inject({ method: 'GET', url: `/api/reports/export.pdf?${range}` })).statusCode, 403);
  const pdf = await accountant.inject({ method: 'GET', url: `/api/reports/export.pdf?${range}` });
  assert.equal(pdf.statusCode, 200, pdf.body);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.equal(pdf.rawPayload.subarray(0, 5).toString(), '%PDF-');
  const reopened = await ownerPanel.inject({ method: 'POST', url: `/api/economics/cash/${cashSession.id}/owner-reopen`, payload: { custodianActorId: 'reports-test-admin', openingDenominations: denominations } });
  assert.equal(reopened.statusCode, 200, reopened.body);
});

test('CSV and XLSX exports fail closed instead of returning silently truncated financial data', async () => {
  const marker = `reports-export-limit-${tag}`;
  const [fixtureClient] = await sql`INSERT INTO clients(first_name,last_name,status) VALUES ('Informe',${`Límite sintético ${tag}`},'active') RETURNING id`;
  const clientId = fixtureClient.id;
  try {
    await sql`INSERT INTO economic_charges(client_id,concept,amount_cents,due_on,created_by,idempotency_key,request_hash)
      SELECT ${clientId}, 'Informe sintético ' || ${tag} || ' ' || n::text, 100, ${today}::date, ${marker}, gen_random_uuid(), repeat('a',64)
      FROM generate_series(1,5001) AS n`;

    const csv = await admin.inject({ method: 'GET', url: `/api/reports/sales.csv?${range}` });
    assert.equal(csv.statusCode, 413);
    assert.deepEqual(csv.json(), { error: 'export_result_limit_exceeded', limit: 500 });

    const xlsx = await admin.inject({ method: 'GET', url: `/api/reports/export.xlsx?${range}` });
    assert.equal(xlsx.statusCode, 413);
    assert.deepEqual(xlsx.json(), { error: 'export_result_limit_exceeded', limit: 5000 });
  } finally {
    // Economic rows are immutable by design. This API test runs against a disposable
    // synthetic database, so disable only the immutability trigger while removing
    // the uniquely marked fixtures; always restore it even if cleanup fails.
    await sql`ALTER TABLE economic_charges DISABLE TRIGGER economic_charge_guard`;
    try {
      await sql`DELETE FROM economic_charges WHERE created_by=${marker}`;
    } finally {
      await sql`ALTER TABLE economic_charges ENABLE TRIGGER economic_charge_guard`;
    }
    // Client identities are also immutable in this schema; remove only this
    // synthetic, now-unreferenced fixture using its dedicated delete guard.
    await sql`ALTER TABLE clients DISABLE TRIGGER clients_no_delete`;
    try {
      await sql`DELETE FROM clients WHERE id=${clientId}`;
    } finally {
      await sql`ALTER TABLE clients ENABLE TRIGGER clients_no_delete`;
    }
  }
});

test('summary counts occupancy, attendance, reservations by service and fees by plan from the source tables', async () => {
  const before = await summary();
  const [area] = await sql`SELECT id FROM areas WHERE status='active' ORDER BY id LIMIT 1`;
  const [service] = await sql`INSERT INTO services(name,area_id,status) VALUES (${`Servicio KPI ${tag}`},${area.id},'active') RETURNING id`;
  const [session] = await sql`INSERT INTO calendar_sessions(service_id,area_id,starts_at,duration_minutes,capacity,created_by) VALUES (${service.id},${area.id},date_trunc('day',now() AT TIME ZONE 'Atlantic/Canary') AT TIME ZONE 'Atlantic/Canary' + interval '1 minute',45,4,'reports-test') RETURNING id`;
  for (const [index, status] of ['attended', 'no_show', 'reserved'].entries()) {
    const clientId = await client(`Reserva${index}`);
    await sql`INSERT INTO calendar_reservations(session_id,client_id,entitlement_reference,status,created_by) VALUES (${session.id},${clientId},'qa-entitlement',${status},'reports-test')`;
  }
  const planResponse = await post('/api/plans', { name: `Plan KPI ${tag}`, serviceIds: [service.id], kind: 'session_pack', renewalCadence: null, basePriceCents: 5000, modules: [{ module: 'reservations', accessLevel: 'full', capabilities: [] }], rights: [{ rightType: 'service_access', serviceId: service.id }, { rightType: 'sessions_quota', serviceId: service.id, quotaScope: 'per_service', quantity: 10 }] });
  assert.equal(planResponse.statusCode, 201, planResponse.body);
  assert.equal((await admin.inject({ method: 'POST', url: `/api/plans/${planResponse.json().id}/activate`, payload: {} })).statusCode, 200);
  for (let n = 0; n < 2; n += 1) {
    const sale = await post(`/api/clients/${await client('PlanKpi')}/plans`, { planId: planResponse.json().id, startsOn: today, dueOn: today, amountCents: 5000 });
    assert.equal(sale.statusCode, 201, sale.body);
  }
  const after = await summary();
  assert.equal(after.occupancy.sessions - before.occupancy.sessions, 1);
  assert.equal(after.occupancy.capacity - before.occupancy.capacity, 4);
  assert.equal(after.occupancy.occupied - before.occupancy.occupied, 3, 'reserved, attended and no-show hold a place');
  assert.equal(after.attendance.attended - before.attendance.attended, 1);
  assert.equal(after.attendance.noShow - before.attendance.noShow, 1);
  assert.deepEqual(after.reservationsByService.find((row) => row.name === `Servicio KPI ${tag}`), { name: `Servicio KPI ${tag}`, count: 3 });
  assert.deepEqual(after.feesByPlan.find((row) => row.name === `Plan KPI ${tag}`), { name: `Plan KPI ${tag}`, count: 2, soldCents: 10000 });
  assert.ok(after.occupancy.rate > 0 && after.occupancy.rate <= 1 && after.attendance.rate > 0 && after.attendance.rate <= 1);
});
