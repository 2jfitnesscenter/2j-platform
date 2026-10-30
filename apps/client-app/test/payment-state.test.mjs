import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { ClientApp } from '../src/client-app.tsx';

test('member profile presents server payment states and partial payments without recalculating them', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator }, HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    sessionStorage: { configurable: true, value: dom.window.sessionStorage }, crypto: { configurable: true, value: { randomUUID: () => '00000000-0000-4000-8000-000000000001' } },
  });
  const assignments = [
    { id: '11111111-1111-4111-8111-111111111111', planName: 'Cuota mensual', kind: 'monthly', status: 'active', startsOn: '2026-11-01', endsOn: null, lastEvent: 'activated', rights: [], modules: [], payment: { status: 'pending', accessStatus: 'provisional', amountCents: 5000, paidCents: 0, pendingAmountCents: 5000, dueOn: '2026-11-10', effectiveBlockAt: '2026-11-11T00:00:00+00:00', timezone: 'Atlantic/Canary', payments: [] } },
    { id: '22222222-2222-4222-8222-222222222222', planName: 'Fuerza', kind: 'monthly', status: 'active', startsOn: '2026-10-01', endsOn: null, lastEvent: 'activated', rights: [], modules: [], payment: { status: 'unpaid', accessStatus: 'blocked_unpaid', amountCents: 4500, paidCents: 0, pendingAmountCents: 4500, dueOn: '2026-10-10', effectiveBlockAt: '2026-10-11T00:00:00+01:00', timezone: 'Atlantic/Canary', payments: [] } },
    { id: '33333333-3333-4333-8333-333333333333', planName: 'Cuota con abonos', kind: 'monthly', status: 'active', startsOn: '2026-11-01', endsOn: null, lastEvent: 'activated', rights: [], modules: [], payment: { status: 'partially_paid', accessStatus: 'provisional', amountCents: 5000, paidCents: 2000, pendingAmountCents: 3000, dueOn: '2026-11-10', effectiveBlockAt: '2026-11-11T00:00:00+00:00', timezone: 'Atlantic/Canary', payments: [{ amountCents: 2000, occurredAt: '2026-11-05T10:00:00Z' }] } },
  ];
  globalThis.fetch = async input => {
    const url = String(input);
    if (url === '/api/me') return new Response(JSON.stringify({ profile: { id: '33333333-3333-4333-8333-333333333333', firstName: 'María', lastName: 'González', email: null, status: 'active' } }));
    if (url === '/api/me/membership') return new Response(JSON.stringify({ assignments, active: assignments, asOf: '2026-10-26', timezone: 'Atlantic/Canary' }));
    if (url === '/api/me/bookings') return new Response(JSON.stringify({ reservations: [], waitlist: [] }));
    if (url === '/api/client-portal/form-assignments' || url === '/api/client-portal/consents') return new Response('[]');
    if (url === '/api/me/booking-access') return new Response(JSON.stringify({ enabled: true }));
    if (url === '/api/me/preferences') return new Response(JSON.stringify({ preferences: { appearance: 'dark', language: 'es' } }));
    if (url === '/api/me/news') return new Response(JSON.stringify({ items: [], featured: null }));
    if (url === '/api/me/store/catalog' || url === '/api/me/store/purchases') return new Response(JSON.stringify({ items: [] }));
    if (url === '/api/me/notifications/unread-count') return new Response(JSON.stringify({ count: 0 }));
    if (url.startsWith('/api/me/sessions?')) return new Response(JSON.stringify({ sessions: [] }));
    throw new Error(`Unexpected request ${url}`);
  };
  const ui = render(React.createElement(ClientApp));
  assert.ok(await ui.findByRole('heading', { name: 'Hola, María' }));
  fireEvent.click(ui.getByRole('button', { name: 'Perfil', exact: true }));
  const paymentStates = ui.container.querySelectorAll('.membership-payment-state');
  assert.equal(paymentStates.length, 3);
  assert.match(paymentStates[0].textContent, /Pendiente de pago/);
  assert.match(paymentStates[0].textContent, /Vencimiento/);
  assert.match(paymentStates[0].textContent, /50,00/);
  assert.match(paymentStates[0].textContent, /11 nov 2026, 0:00 · hora de Canarias/);
  assert.match(paymentStates[1].textContent, /Acceso bloqueado por impago/);
  assert.match(paymentStates[1].textContent, /45,00/);
  assert.equal(paymentStates[1].getAttribute('aria-label'), 'Estado del pago: Impagada. Acceso bloqueado por impago');
  assert.match(paymentStates[2].textContent, /Pago parcial/);
  assert.match(paymentStates[2].textContent, /Abonos registrados/);
  assert.match(paymentStates[2].textContent, /5 nov 2026, 10:00/);
  assert.match(paymentStates[2].textContent, /20,00/);
  assert.match(paymentStates[2].textContent, /30,00/);
  cleanup(); dom.window.close();
});
