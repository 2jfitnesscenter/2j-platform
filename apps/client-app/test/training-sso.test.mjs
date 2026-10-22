import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

async function uiHarness() {
  const testing = await import('@testing-library/react');
  const app = await import('../src/client-app.tsx');
  return { ...testing, ...app };
}

function installDom(url) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url });
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator }, HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    sessionStorage: { configurable: true, value: dom.window.sessionStorage }, crypto: { configurable: true, value: { randomUUID: () => '00000000-0000-4000-8000-000000000001' } },
  });
  return dom;
}

test('Búnker SSO destination is accepted only for the configured Training origin with the code in the fragment', async () => {
  const { trainingSsoDestination, trainingSsoMessage } = await import('../src/client-app.tsx');
  const code = 'A'.repeat(43), training = 'https://app.2jfitnesscenter.com';
  assert.equal(trainingSsoDestination(`https://app.2jfitnesscenter.com/sso#code=${code}`, training), `https://app.2jfitnesscenter.com/sso#code=${code}`);
  assert.equal(trainingSsoDestination(`http://127.0.0.1:8080/sso#code=${code}`, 'http://127.0.0.1:8080'), `http://127.0.0.1:8080/sso#code=${code}`);
  for (const bad of [
    `https://evil.example/sso#code=${code}`, `https://app.2jfitnesscenter.com.evil.example/sso#code=${code}`, `http://app.2jfitnesscenter.com/sso#code=${code}`,
    `https://app.2jfitnesscenter.com/sso?code=${code}`, `https://app.2jfitnesscenter.com/sso?x=1#code=${code}`, 'https://app.2jfitnesscenter.com/sso',
    'https://app.2jfitnesscenter.com/sso#code=short', `https://user:pw@app.2jfitnesscenter.com/sso#code=${code}`, 'javascript:alert(1)', 42, null, undefined,
  ]) assert.equal(trainingSsoDestination(bad, training), null, String(bad));
  assert.equal(trainingSsoDestination(`https://app.2jfitnesscenter.com/sso#code=${code}`, ''), null, 'the synthetic demo has no Training origin');
  assert.match(trainingSsoMessage('training_access_suspended'), /suspendido/);
  assert.match(trainingSsoMessage('unknown'), /acceso habitual/);
});

async function mountLoggedIn(props, onRequest) {
  const dom = installDom('http://127.0.0.1:5173/');
  const requests = [], json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (url === '/api/pilot/member/login') return json({ expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    if (url === '/api/me') return json({ profile: { id: 'd0700000-0000-4000-8000-000000000001', firstName: 'María', lastName: 'González', email: null, status: 'active' } });
    if (url === '/api/me/preferences') return json({ preferences: { appearance: 'dark', language: 'es' } });
    if (url === '/api/me/membership') return json({ assignments: [] });
    if (url === '/api/me/booking-access') return json({ enabled: false });
    if (url === '/api/me/bookings') return json({ reservations: [], waitlist: [] });
    if (String(url).startsWith('/api/me/sessions?')) return json({ sessions: [] });
    if (url === '/api/client-portal/form-assignments' || url === '/api/client-portal/consents') return json([]);
    if (url === '/api/me/notifications/unread-count') return json({ count: 0 });
    if (url === '/api/me/training-summary') return json({ status: 'not_linked' });
    if (url === '/api/me/training/sso') return onRequest(init);
    return json({});
  };
  const { render, cleanup, fireEvent, ClientApp } = await uiHarness();
  const ui = render(React.createElement(ClientApp, { pilotLoginEnabledOverride: true, ...props }));
  assert.ok(await ui.findByRole('heading', { name: 'Hola, María' }));      // the client session already exists
  fireEvent.click(ui.getByRole('button', { name: 'Búnker', exact: true }));
  assert.ok(await ui.findByRole('heading', { name: 'Búnker' }));
  return { ui, fireEvent, requests, close: () => { cleanup(); dom.window.close(); } };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('connected Búnker entry is off by default: the current link stays and no SSO request is made', async () => {
  const { ui, requests, close } = await mountLoggedIn({}, () => { throw new Error('SSO must not be requested'); });
  assert.ok(ui.getByRole('link', { name: /Abrir Búnker/ }));
  assert.equal(ui.queryByText('Entrarás en Búnker con tu cuenta del centro.'), null);
  assert.equal(requests.some(item => item.url === '/api/me/training/sso'), false);
  close();
});

test('with the flag on, Home asks Platform for a one-time code and follows only the validated destination', async () => {
  const code = 'B'.repeat(43), navigations = [];
  const { ui, fireEvent, requests, close } = await mountLoggedIn(
    { trainingSsoEnabledOverride: true, trainingNavigate: url => navigations.push(url) },
    () => new Response(JSON.stringify({ v: 1, redirectUrl: `https://app.2jfitnesscenter.com/sso#code=${code}`, expiresAt: new Date().toISOString() }), { status: 201, headers: { 'content-type': 'application/json' } }),
  );
  assert.equal(ui.queryByRole('link', { name: /^Abrir Búnker/ }), null, 'the primary action is the SSO button');
  assert.ok(ui.getByRole('link', { name: /Abrir con tu acceso habitual/ }), 'the passkey login stays available');
  fireEvent.click(ui.getByRole('button', { name: 'Abrir Búnker' }));
  await sleep(50);
  const request = requests.find(item => item.url === '/api/me/training/sso');
  assert.equal(request.init.method, 'POST'); assert.equal(request.init.credentials, 'include');
  assert.equal(request.init.body, '{}', 'Home sends no identity: Platform derives the person from the session');
  assert.deepEqual(navigations, [`https://app.2jfitnesscenter.com/sso#code=${code}`]);
  close();
});

test('Home never follows a bad destination and explains suspension, missing link and outages without inventing rules', async () => {
  const cases = [
    [201, { v: 1, redirectUrl: `https://evil.example/sso#code=${'C'.repeat(43)}` }, /acceso habitual/],
    [201, { v: 1, redirectUrl: `https://app.2jfitnesscenter.com/sso?code=${'C'.repeat(43)}` }, /acceso habitual/],
    [403, { error: 'training_access_suspended', reasonCode: 'ADMIN_SUSPENDED' }, /suspendido/],
    [409, { error: 'training_link_required', reasonCode: 'TRAINING_LINK_MISSING' }, /no está vinculada/],
    [423, { error: 'training_sso_disabled' }, /acceso habitual/],
    [503, { error: 'training_sso_unavailable' }, /acceso habitual/],
    [401, { error: 'authentication_required' }, /sesión ha caducado/],
  ];
  for (const [status, body, expected] of cases) {
    const navigations = [];
    const { ui, fireEvent, close } = await mountLoggedIn({ trainingSsoEnabledOverride: true, trainingNavigate: url => navigations.push(url) },
      () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
    fireEvent.click(ui.getByRole('button', { name: 'Abrir Búnker' }));
    const alert = await ui.findByRole('alert');
    assert.match(alert.textContent, expected, `${status} ${JSON.stringify(body).slice(0, 60)}`);
    assert.deepEqual(navigations, [], 'nothing is followed');
    close();
  }
});

test('the synthetic demo can never use the connected Búnker entry', async () => {
  const dom = installDom('http://localhost/');
  let fetchCount = 0; globalThis.fetch = async () => { fetchCount++; return new Response('{}'); };
  const { render, cleanup, fireEvent, ClientApp } = await uiHarness();
  const ui = render(React.createElement(ClientApp, { previewModeOverride: true, trainingSsoEnabledOverride: true }));
  fireEvent.click(ui.getByRole('button', { name: 'Búnker', exact: true }));
  assert.equal(ui.getByRole('button', { name: 'Abrir Búnker' }).disabled, true);
  assert.equal(ui.queryByRole('link', { name: /acceso habitual/ }), null);
  assert.equal(fetchCount, 0);
  cleanup(); dom.window.close();
});

test('the Training URL can be overridden only with https or loopback; the demo never has one', async () => {
  const { resolveTrainingUrl } = await import('../src/client-app.tsx');
  const prod = 'https://app.2jfitnesscenter.com';
  assert.equal(resolveTrainingUrl(undefined, undefined), prod);
  assert.equal(resolveTrainingUrl('true', 'https://staging.example.com'), '', 'the synthetic demo has no Training origin');
  assert.equal(resolveTrainingUrl(undefined, 'https://staging.example.com/anything'), 'https://staging.example.com');
  assert.equal(resolveTrainingUrl(undefined, 'http://localhost:4300'), 'http://localhost:4300');
  for (const bad of ['http://staging.example.com', 'ftp://x', 'javascript:alert(1)', 'https://u:p@x.example', 'https://x.example/?q=1', 'https://x.example/#h', 'not a url', 42]) assert.equal(resolveTrainingUrl(undefined, bad), prod, String(bad));
});
