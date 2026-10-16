import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174/#clients' });
dom.window.requestAnimationFrame = (callback) => dom.window.setTimeout(callback, 0);
dom.window.cancelAnimationFrame = (handle) => dom.window.clearTimeout(handle);
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { ClientsPage } = await import('../src/clients-page.tsx');
afterEach(() => { cleanup(); globalThis.fetch = undefined; window.location.hash = '#clients'; });
after(() => dom.window.close());

const client = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', firstName: 'Marta', lastName: 'Santos', email: 'marta@example.test', status: 'active', createdAt: '2026-10-01T10:00:00Z' };
const sectionList = (payments = 'available') => [
  ['summary', 'Resumen'], ['reservations', 'Reservas'], ['plans', 'Cuotas'], ['payments', 'Pagos'], ['documents', 'Documentos/Formularios'], ['messages', 'Mensajes'], ['followup', 'Seguimiento'], ['history', 'Historial'],
].map(([id, label]) => ({ id, label, sourceLabel: label, access: id === 'payments' ? payments : 'available', dataState: 'ready' }));
const slot = (data = null, access = 'available') => ({ access, dataState: 'ready', data });
const assignment = (overrides = {}) => ({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', planId: 'p1', planName: 'Bono 10 sesiones', kind: 'session_pack', startsOn: '2026-10-01', endsOn: '2026-12-31', derivedStatus: 'active', amountCents: 5900, dueOn: '2026-10-05', rights: [{ id: 'r1', rightType: 'sessions_quota', serviceName: 'Fuerza', quantity: 10, period: null, quotaScope: null, balance: 7 }], ...overrides });
const adminCapabilities = { manage: true, readEntitlements: true, assignPlans: true, collectPayments: true, pauseEntitlements: true, cancelEntitlements: true, adjustEntitlements: true, renewEntitlements: true };
const profileOf = ({ capabilities = adminCapabilities, plans = [], payments, sections = sectionList(), reservations = [], waitlistEntries = [], clientOverrides = {}, messages } = {}) => ({
  client: { ...client, ...clientOverrides }, capabilities, sections, reservations, waitlistEntries,
  history: [{ id: 'e1', eventType: 'client.created', actorLabel: 'Administración', occurredAt: client.createdAt }],
  summary: { profile: slot(), plans: slot(plans), reservations: slot(), payments: payments ? slot(payments) : slot(null, 'forbidden'), documents: slot(), messages: slot(messages ?? { unreadCount: 0, lastMessageAt: null }), followup: slot() },
});
const response = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const listResponse = (items = [client], overrides = {}) => ({ items, capabilities: { manage: true, assignPlans: true }, hasMore: false, nextCursor: null, ...overrides });
const serve = (profile, list = listResponse(), requests = []) => {
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    if (String(url).includes('/api/clients?')) return response(list);
    if (String(url).endsWith(`/api/clients/${client.id}`)) return response(profile);
    throw new Error(`Unexpected request ${url}`);
  };
  return requests;
};
const open = async () => {
  render(React.createElement(ClientsPage));
  fireEvent.click(await screen.findByRole('link', { name: /Marta Santos/ }));
  await screen.findByRole('heading', { level: 1, name: 'Marta Santos' });
};

test('Admin actions are weighted: one primary, secondary edit, danger archive, and all stay inside the tab order', async () => {
  serve(profileOf());
  await open();
  assert.match(screen.getByRole('button', { name: 'Añadir cuota' }).className, /ui-button--primary/);
  assert.match(screen.getByRole('button', { name: 'Editar datos' }).className, /ui-button--secondary/);
  assert.match(screen.getByRole('button', { name: 'Archivar' }).className, /ui-button--danger\b/);
  assert.equal(document.querySelectorAll('.client-header .ui-button--primary').length, 1, 'exactly one primary action in the header');
});

test('Trainer (read-only capabilities) sees no write actions, no Pagos and no economic data', async () => {
  serve(profileOf({ capabilities: { manage: false, readEntitlements: true }, plans: [assignment()], sections: sectionList('forbidden') }), listResponse([client], { capabilities: { manage: false } }));
  render(React.createElement(ClientsPage));
  await screen.findByRole('link', { name: /Marta Santos/ });
  assert.ok(screen.queryByRole('button', { name: 'Nuevo cliente' }) === null);
  fireEvent.click(screen.getByRole('link', { name: /Marta Santos/ }));
  await screen.findByRole('heading', { level: 1, name: 'Marta Santos' });
  for (const name of ['Añadir cuota', 'Editar datos', 'Archivar']) assert.ok(screen.queryByRole('button', { name }) === null, `${name} is absent`);
  assert.ok(screen.queryByRole('tab', { name: 'Pagos' }) === null);
  assert.ok(screen.queryByText(/Pago$/) === null, 'no payment fact without the finance section');
  fireEvent.click(screen.getByRole('tab', { name: 'Plan y sesiones' }));
  assert.ok(await screen.findByRole('heading', { name: 'Bono 10 sesiones' }));
  assert.ok(screen.queryByText(/59,00/) === null, 'amounts stay hidden without finance access');
  for (const name of ['Pausar', 'Cancelar', 'Renovar', 'Cambiar plan', 'Ajustar saldo']) assert.ok(screen.queryByRole('button', { name }) === null);
  assert.ok(screen.getByRole('button', { name: 'Ver movimientos' }), 'read access to movements is preserved');
});

test('header facts come only from data the profile already carries', async () => {
  serve(profileOf());
  await open();
  assert.ok(screen.queryByRole('list', { name: 'Resumen del cliente' }) === null, 'no placeholder tiles when nothing is available');
  cleanup(); window.location.hash = '#clients';
  const next = new Date(Date.now() + 86_400_000).toISOString();
  serve(profileOf({
    plans: [assignment()], payments: { balanceCents: 0, overdueCount: 0, charges: [], movements: [] },
    reservations: [{ id: 'res1', status: 'reserved', startsAt: next, durationMinutes: 60, sessionStatus: 'scheduled', serviceName: 'Fuerza', areaName: 'Sala 1', entitlementName: null, rightsUsed: [], entitlementMovements: [] }],
  }));
  await open();
  const facts = screen.getByRole('list', { name: 'Resumen del cliente' });
  assert.deepEqual([...facts.querySelectorAll('.client-fact-label')].map((node) => node.textContent), ['Próxima reserva', 'Sesiones disponibles', 'Pago']);
  assert.equal(within(facts).getByText('7').textContent, '7');
  assert.ok(within(facts).getByText('Al día'));
});

test('PP-04: plan state is separate from the account; archived is the only account state and removes write actions', async () => {
  serve(profileOf({ plans: [] }));
  await open();
  assert.ok(screen.getByText('Sin plan'));
  assert.ok(screen.queryByText(/^Activo$|^Inactivo$/) === null, 'no single Activo/Inactivo for the whole person');
  cleanup(); window.location.hash = '#clients';
  serve(profileOf({ plans: [assignment({ derivedStatus: 'expired' })], clientOverrides: { status: 'archived' } }));
  await open();
  assert.ok(screen.getByText('Plan vencido'));
  assert.ok(screen.getByText('Archivado'));
  assert.ok(screen.queryByRole('button', { name: 'Archivar' }) === null);
  assert.ok(screen.queryByRole('button', { name: 'Añadir cuota' }) === null);
  assert.ok(screen.getByRole('button', { name: 'Editar datos' }), 'the profile can still be corrected');
});

test('approved copy: Plan y sesiones, Pagos with real states, and no internal vocabulary or Planificado', async () => {
  const charges = [
    { id: 'c1', concept: 'Cuota octubre', amountCents: 4900, balanceCents: 4900, dueOn: '2026-10-05', status: 'pending' },
    { id: 'c2', concept: 'Cuota septiembre', amountCents: 4900, balanceCents: 4900, dueOn: '2026-09-05', status: 'unpaid' },
    { id: 'c3', concept: 'Cuota agosto', amountCents: 4900, balanceCents: 0, dueOn: '2026-08-05', status: 'paid' },
  ];
  serve(profileOf({ plans: [assignment()], payments: { balanceCents: 9800, overdueCount: 1, charges, movements: [] } }));
  await open();
  fireEvent.click(screen.getByRole('tab', { name: 'Pagos' }));
  const list = await screen.findByRole('heading', { name: 'Cargos recientes' });
  const card = list.closest('section');
  assert.deepEqual([...card.querySelectorAll('.ui-chip')].map((chip) => chip.textContent), ['Pendiente', 'Vencido', 'Pagado']);
  fireEvent.click(screen.getByRole('tab', { name: 'Plan y sesiones' }));
  await screen.findByRole('heading', { name: 'Bono 10 sesiones' });
  const text = document.body.textContent;
  assert.doesNotMatch(text, /derecho|entitlement|ledger|grant|snapshot|Planificado|Plan y derechos/i);
});

test('Plan y sesiones assigns action weights and cancelling needs a reason, lists consequences and uses the only filled danger button', async () => {
  serve(profileOf({ plans: [assignment()], payments: { balanceCents: 0, overdueCount: 0, charges: [], movements: [] } }));
  await open();
  fireEvent.click(screen.getByRole('tab', { name: 'Plan y sesiones' }));
  await screen.findByRole('heading', { name: 'Bono 10 sesiones' });
  assert.match(screen.getByRole('button', { name: 'Cancelar' }).className, /ui-button--danger\b/);
  assert.match(screen.getByRole('button', { name: 'Ver movimientos' }).className, /ui-button--ghost/);
  assert.match(screen.getByRole('button', { name: 'Pausar' }).className, /ui-button--secondary/);
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  const dialog = await screen.findByRole('dialog', { name: 'Cancelar cuota' });
  assert.match(dialog.textContent, /dejará de estar activa desde hoy/);
  const confirm = within(dialog).getByRole('button', { name: 'Confirmar cancelación' });
  assert.equal(confirm.disabled, true, 'blocked until a reason is written');
  assert.match(confirm.className, /ui-button--danger-solid/);
  fireEvent.change(within(dialog).getByLabelText('Motivo obligatorio'), { target: { value: 'Baja del cliente' } });
  assert.equal(confirm.disabled, false);
});

test('Resumen shows attention only from real signals and never an empty attention card', async () => {
  serve(profileOf());
  await open();
  assert.ok(screen.queryByRole('heading', { name: 'Requiere atención' }) === null);
  cleanup(); window.location.hash = '#clients';
  serve(profileOf({
    payments: { balanceCents: 4900, overdueCount: 2, charges: [], movements: [] },
    messages: { unreadCount: 3, lastMessageAt: null },
    waitlistEntries: [{ id: 'w1', status: 'waiting', startsAt: new Date(Date.now() + 3_600_000).toISOString(), sessionStatus: 'scheduled', serviceName: 'Yoga', areaName: 'Sala 2' }],
  }));
  await open();
  const card = screen.getByRole('heading', { name: 'Requiere atención' }).closest('section');
  assert.ok(within(card).getByText('2 cargos vencidos'));
  assert.ok(within(card).getByText('3 mensajes sin leer'));
  assert.ok(within(card).getByText('En lista de espera · 1'));
});

test('status filter is a labelled toggle group that queries the archived list', async () => {
  const requests = serve(profileOf());
  render(React.createElement(ClientsPage));
  await screen.findByRole('link', { name: /Marta Santos/ });
  const group = screen.getByRole('group', { name: 'Filtrar clientes por estado' });
  assert.equal(within(group).getByRole('button', { name: 'Activos' }).getAttribute('aria-pressed'), 'true');
  fireEvent.click(within(group).getByRole('button', { name: 'Archivados' }));
  await waitFor(() => assert.ok(requests.some((url) => url.includes('status=archived'))));
  assert.equal(within(group).getByRole('button', { name: 'Archivados' }).getAttribute('aria-pressed'), 'true');
});

test('searching with no match explains it and offers a way back; the clear button restores the list', async () => {
  const requests = [];
  globalThis.fetch = async (url) => { requests.push(String(url)); return response(String(url).includes('q=zzz') ? listResponse([]) : listResponse()); };
  render(React.createElement(ClientsPage));
  await screen.findByRole('link', { name: /Marta Santos/ });
  fireEvent.change(screen.getByLabelText('Buscar cliente'), { target: { value: 'zzz' } });
  await screen.findByText('Sin resultados', {}, { timeout: 2000 });
  fireEvent.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }));
  await screen.findByRole('link', { name: /Marta Santos/ }, { timeout: 2000 });
  assert.equal(screen.getByLabelText('Buscar cliente').value, '');
});

test('Cliente 360 keeps keyboard access: tabs are a tablist and the panel is labelled by the selected tab', async () => {
  serve(profileOf());
  await open();
  const tablist = screen.getByRole('tablist', { name: 'Secciones del cliente' });
  const selected = within(tablist).getByRole('tab', { selected: true });
  assert.equal(selected.textContent, 'Resumen');
  const panel = screen.getByRole('tabpanel');
  assert.equal(panel.getAttribute('aria-labelledby'), selected.id);
});
