import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

async function uiHarness() {
  const testing = await import('@testing-library/react');
  const app = await import('../src/client-app.tsx');
  return { ...testing, ...app };
}

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:5173/' });
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator }, HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    HTMLInputElement: { configurable: true, value: dom.window.HTMLInputElement }, HTMLTextAreaElement: { configurable: true, value: dom.window.HTMLTextAreaElement }, HTMLSelectElement: { configurable: true, value: dom.window.HTMLSelectElement }, Event: { configurable: true, value: dom.window.Event },
    sessionStorage: { configurable: true, value: dom.window.sessionStorage }, crypto: { configurable: true, value: { randomUUID: () => '11111111-1111-4111-8111-111111111111' } },
  });
  return dom;
}

test('integration gates fail closed in demo and session eligibility labels follow the additive V1 contract', async () => {
  const { isMemberIntegrationEnabled, sessionAvailabilityLabel } = await import('../src/member-integrations.ts');
  assert.equal(isMemberIntegrationEnabled('true', true), false);
  assert.equal(isMemberIntegrationEnabled(true, true), false);
  assert.equal(isMemberIntegrationEnabled('true', false), true);
  assert.equal(isMemberIntegrationEnabled('false', false), false);
  assert.deepEqual(['available','full','booked','not_allowed_by_plan','waitlisted','waitlist_suspended'].map(sessionAvailabilityLabel), ['Disponible','Completa','Reservada','No disponible con tu cuota','En espera','Lista de espera suspendida']);
  assert.equal(sessionAvailabilityLabel('unknown'), null);
});

test('member account link screen uses the #67/#81 session contracts and can request/revoke without ever handling a passkey', async () => {
  const dom = installDom();
  let loggedIn = false, summary = { status: 'not_linked' }, review = null;
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input), method = init.method ?? 'GET';
    requests.push({ url, method, init });
    if (url === '/api/pilot/member/login') { loggedIn = true; return new Response('{}'); }
    if (url === '/api/me' && loggedIn) return new Response(JSON.stringify({ profile: { id: 'd0700000-0000-4000-8000-000000000001', firstName: 'María', lastName: 'González', email: null, status: 'active' } }));
    if (url === '/api/me' && !loggedIn) return new Response(JSON.stringify({ error: 'client_authentication_required' }), { status: 401 });
    if (url === '/api/me/membership') return new Response(JSON.stringify({ assignments: [], active: [], asOf: '2026-10-24', timezone: 'Atlantic/Canary' }));
    if (url === '/api/client-portal/form-assignments' || url === '/api/client-portal/consents') return new Response('[]');
    if (url === '/api/me/preferences') return new Response(JSON.stringify({ preferences: { appearance: 'dark', language: 'es' } }));
    if (url === '/api/me/news') return new Response(JSON.stringify({ items: [], featured: null }));
    if (url === '/api/me/store/catalog' || url === '/api/me/store/purchases') return new Response(JSON.stringify({ items: [] }));
    if (url === '/api/me/notifications/unread-count') return new Response(JSON.stringify({ count: 0 }));
    if (url === '/api/me/training-summary') return new Response(JSON.stringify(summary));
    if (url === '/api/me/training/link-review' && method === 'GET') return new Response(JSON.stringify({ v: 1, case: review }));
    if (url === '/api/me/training/link-review' && method === 'POST') { review = { id: 'f0700000-0000-4000-8000-000000000001', status: 'open', reason: JSON.parse(init.body).reason, createdAt: '2026-10-24T10:00:00.000Z' }; return new Response(JSON.stringify({ v: 1, id: review.id, status: 'open', created: true }), { status: 201 }); }
    if (url === '/api/platform/v1/training-link-transactions' && method === 'POST') return new Response(JSON.stringify({ v: 1, status: 'created', transaction: { transactionId: 'e0700000-0000-4000-8000-000000000001', expiresAt: '2026-10-24T10:05:00.000Z' }, challenge: 'x'.repeat(43), audience: '2j-training-account-link', purpose: 'training-account-link' }), { status: 201 });
    if (url === '/api/me/training/link' && method === 'POST') { assert.equal(JSON.parse(init.body).code, 'y'.repeat(43)); summary = { status: 'linked', summaryStatus: 'available', summary: { trainingStatus: 'active', asOf: '2026-10-24T10:00:00.000Z' } }; return new Response(JSON.stringify({ v: 1, status: 'active', linkId: 'e1700000-0000-4000-8000-000000000001' })); }
    if (url === '/api/me/training/link' && method === 'DELETE') { summary = { status: 'not_linked' }; return new Response(JSON.stringify({ v: 1, status: 'revoked', waived: false })); }
    return new Response('{}');
  };
  const { render, cleanup, fireEvent, ClientApp } = await uiHarness();
  const ui = render(React.createElement(ClientApp, { pilotLoginEnabledOverride: true, trainingLinkEnabledOverride: true, trainingLinkReviewEnabledOverride: true }));
  fireEvent.change(await ui.findByLabelText('Código de acceso'), { target: { value: 'pilot-code' } });
  fireEvent.click(ui.getByRole('button', { name: 'Iniciar sesión' }));
  await ui.findByRole('heading', { name: 'Hola, María' });
  fireEvent.click(ui.getByRole('button', { name: 'Búnker', exact: true }));
  fireEvent.click(await ui.findByRole('button', { name: /Gestionar vinculación/ }));
  await ui.findByRole('heading', { name: 'Cuenta de Búnker' });
  fireEvent.click(ui.getByRole('button', { name: 'Iniciar prueba de passkey en Búnker' }));
  await ui.findByText('Transacción creada. Continúa en Búnker con tu cuenta actual y passkey.');
  fireEvent.change(ui.getByLabelText('Código de un solo uso de Búnker'), { target: { value: 'y'.repeat(43) } });
  fireEvent.click(ui.getByRole('button', { name: 'Completar vinculación' }));
  await ui.findByText('Cuenta de Búnker vinculada.');
  // The button appears when the refreshed summary says linked; that can land after the success message, so wait for it.
  fireEvent.click(await ui.findByRole('button', { name: 'Revocar vinculación' }));
  fireEvent.click(await ui.findByRole('button', { name: 'Confirmar revocación' }));
  await ui.findByText('Vinculación revocada.');

  const create = requests.find(row => row.url === '/api/platform/v1/training-link-transactions');
  assert.equal(create.method, 'POST');
  assert.deepEqual(JSON.parse(create.init.body), { requestId: '11111111-1111-4111-8111-111111111111' });
  const finish = requests.find(row => row.url === '/api/me/training/link' && row.method === 'POST');
  assert.deepEqual(JSON.parse(finish.init.body), { transactionId: 'e0700000-0000-4000-8000-000000000001', challenge: 'x'.repeat(43), code: 'y'.repeat(43) });
  assert.equal(finish.init.credentials, 'include');
  assert.equal(requests.some(row => row.url.includes('link-proofs')), false, 'Home must never call Búnker proof issuance or emulate a passkey');
  assert.equal(requests.some(row => row.url === '/api/me/training/link' && row.method === 'DELETE'), true);
  cleanup(); dom.window.close();
});

test('manual link review sends only an approved reason and optional note to the member endpoint', async () => {
  const dom = installDom();
  let loggedIn = false, review = null;
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input), method = init.method ?? 'GET'; requests.push({ url, method, init });
    if (url === '/api/pilot/member/login') { loggedIn = true; return new Response('{}'); }
    if (url === '/api/me' && loggedIn) return new Response(JSON.stringify({ profile: { id: 'd0700000-0000-4000-8000-000000000001', firstName: 'María', lastName: 'González', email: null, status: 'active' } }));
    if (url === '/api/me' && !loggedIn) return new Response(JSON.stringify({ error: 'client_authentication_required' }), { status: 401 });
    if (url === '/api/me/membership') return new Response(JSON.stringify({ assignments: [], active: [], asOf: '2026-10-24', timezone: 'Atlantic/Canary' }));
    if (url === '/api/client-portal/form-assignments' || url === '/api/client-portal/consents') return new Response('[]');
    if (url === '/api/me/preferences') return new Response(JSON.stringify({ preferences: { appearance: 'dark', language: 'es' } }));
    if (url === '/api/me/news') return new Response(JSON.stringify({ items: [], featured: null }));
    if (url === '/api/me/store/catalog' || url === '/api/me/store/purchases') return new Response(JSON.stringify({ items: [] }));
    if (url === '/api/me/notifications/unread-count') return new Response(JSON.stringify({ count: 0 }));
    if (url === '/api/me/training-summary') return new Response(JSON.stringify({ status: 'not_linked' }));
    if (url === '/api/me/training/link-review' && method === 'GET') return new Response(JSON.stringify({ v: 1, case: review }));
    if (url === '/api/me/training/link-review' && method === 'POST') { const body = JSON.parse(init.body); review = { id: 'f0700000-0000-4000-8000-000000000001', status: 'open', reason: body.reason, createdAt: '2026-10-24T10:00:00.000Z' }; return new Response(JSON.stringify({ v: 1, id: review.id, status: 'open', created: true }), { status: 201 }); }
    return new Response('{}');
  };
  const { render, cleanup, fireEvent, ClientApp } = await uiHarness();
  const ui = render(React.createElement(ClientApp, { pilotLoginEnabledOverride: true, trainingLinkEnabledOverride: true, trainingLinkReviewEnabledOverride: true }));
  fireEvent.change(await ui.findByLabelText('Código de acceso'), { target: { value: 'pilot-code' } });
  fireEvent.click(ui.getByRole('button', { name: 'Iniciar sesión' }));
  await ui.findByRole('heading', { name: 'Hola, María' });
  fireEvent.click(ui.getByRole('button', { name: 'Búnker', exact: true }));
  fireEvent.click(await ui.findByRole('button', { name: /Gestionar vinculación/ }));
  fireEvent.change(await ui.findByLabelText('Motivo'), { target: { value: 'proof_failed' } });
  fireEvent.change(ui.getByLabelText('Nota para el equipo (opcional)'), { target: { value: 'El código no aparece en mi cuenta.' } });
  fireEvent.click(ui.getByRole('button', { name: 'Solicitar revisión' }));
  await ui.findByText(/Solicitud en revisión/);
  const post = requests.find(row => row.url === '/api/me/training/link-review' && row.method === 'POST');
  assert.deepEqual(JSON.parse(post.init.body), { reason: 'proof_failed', note: 'El código no aparece en mi cuenta.' });
  assert.equal(post.init.credentials, 'include');
  assert.equal(JSON.stringify(JSON.parse(post.init.body)).match(/trainingUserId|email|phone|name/gi), null);
  cleanup(); dom.window.close();
});
