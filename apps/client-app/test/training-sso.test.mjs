import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

async function uiHarness() {
  const testing = await import('@testing-library/react');
  const app = await import('../src/client-app.tsx');
  return { ...testing, ...app };
}

function installDom(url, extra = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url });
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator }, HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    sessionStorage: { configurable: true, value: dom.window.sessionStorage }, crypto: { configurable: true, value: { randomUUID: () => '00000000-0000-4000-8000-000000000001' } },
  });
  Object.assign(dom.window, extra);
  return dom;
}

test('Búnker SSO destination is accepted only for the configured Training origin, the /sso page and the code in the fragment', async () => {
  const { trainingSsoDestination, trainingSsoMessage } = await import('../src/client-app.tsx');
  const code = 'A'.repeat(43), training = 'https://app.2jfitnesscenter.com';
  assert.equal(trainingSsoDestination(`https://app.2jfitnesscenter.com/sso#code=${code}`, training), `https://app.2jfitnesscenter.com/sso#code=${code}`);
  assert.equal(trainingSsoDestination(`http://127.0.0.1:8080/sso#code=${code}`, 'http://127.0.0.1:8080'), `http://127.0.0.1:8080/sso#code=${code}`);
  for (const bad of [
    `https://evil.example/sso#code=${code}`, `https://app.2jfitnesscenter.com.evil.example/sso#code=${code}`, `http://app.2jfitnesscenter.com/sso#code=${code}`,
    `https://app.2jfitnesscenter.com/sso?code=${code}`, `https://app.2jfitnesscenter.com/sso?x=1#code=${code}`, 'https://app.2jfitnesscenter.com/sso',
    'https://app.2jfitnesscenter.com/sso#code=short', `https://user:pw@app.2jfitnesscenter.com/sso#code=${code}`, 'javascript:alert(1)', 42, null, undefined,
    `https://app.2jfitnesscenter.com/other#code=${code}`, `https://app.2jfitnesscenter.com/#code=${code}`, `https://app.2jfitnesscenter.com/sso/#code=${code}`, `https://app.2jfitnesscenter.com/sso/../admin#code=${code}`,
  ]) assert.equal(trainingSsoDestination(bad, training), null, String(bad));
  assert.equal(trainingSsoDestination(`https://app.2jfitnesscenter.com/sso#code=${code}`, ''), null, 'the synthetic demo has no Training origin');
  assert.match(trainingSsoMessage('training_access_suspended'), /suspendido/);
  assert.match(trainingSsoMessage('unknown'), /acceso habitual/);
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

const CHALLENGE = 'Z'.repeat(43), START = 'https://app.2jfitnesscenter.com/api/platform/v1/sso/start';

test('the flow starts at Training: its start URL is the Training origin plus one fixed path, and only https or loopback', async () => {
  const { trainingSsoStartUrl, TRAINING_SSO_START_PATH } = await import('../src/client-app.tsx');
  assert.equal(TRAINING_SSO_START_PATH, '/api/platform/v1/sso/start');
  assert.equal(trainingSsoStartUrl('https://app.2jfitnesscenter.com'), START);
  assert.equal(trainingSsoStartUrl('http://127.0.0.1:8080'), 'http://127.0.0.1:8080/api/platform/v1/sso/start');
  for (const bad of ['', 'http://app.2jfitnesscenter.com', 'javascript:alert(1)', 'https://u:p@app.2jfitnesscenter.com', 'not a url', 42, null, undefined]) assert.equal(trainingSsoStartUrl(bad), null, String(bad));
});

test('only `#sso_challenge=<43 url-safe characters>` is read from the address bar, nothing else in the fragment', async () => {
  const { ssoChallengeFromHash } = await import('../src/client-app.tsx');
  assert.equal(ssoChallengeFromHash(`#sso_challenge=${CHALLENGE}`), CHALLENGE);
  for (const bad of ['', '#', '#sso_challenge=', '#sso_challenge=short', `#sso_challenge=${CHALLENGE}x`, `#sso_challenge=${CHALLENGE}&x=1`, `#sso_challenge=${'!'.repeat(43)}`, `sso_challenge=${CHALLENGE}`, `#code=${CHALLENGE}`, `#/sso_challenge=${CHALLENGE}`, null, undefined, 42]) assert.equal(ssoChallengeFromHash(bad), null, String(bad));
});

test('a waiting challenge is remembered for a few minutes only, and only if it still has the right shape', async () => {
  const dom = installDom('http://127.0.0.1:5173/');
  const { rememberSsoChallenge, recallSsoChallenge, forgetSsoChallenge } = await import('../src/client-app.tsx');
  const t0 = 1_000_000;
  rememberSsoChallenge(CHALLENGE, t0);
  assert.equal(recallSsoChallenge(t0 + 9 * 60_000), CHALLENGE);
  assert.equal(recallSsoChallenge(t0 + 10 * 60_000 + 1), null, 'expired');
  assert.equal(recallSsoChallenge(t0 - 1), null, 'a timestamp from the future is not trusted');
  forgetSsoChallenge(); assert.equal(recallSsoChallenge(t0), null);
  for (const raw of ['not json', '{}', JSON.stringify({ challenge: 'short', at: t0 }), JSON.stringify({ challenge: CHALLENGE }), JSON.stringify({ challenge: 42, at: t0 })]) {
    dom.window.sessionStorage.setItem('2j.training-sso.challenge', raw);
    assert.equal(recallSsoChallenge(t0), null, raw);
  }
  dom.window.close();
});

async function mountLoggedIn(props, onRequest, { summary = { status: 'linked', summaryStatus: 'unavailable' }, dom: domExtra = {}, url = 'http://127.0.0.1:5173/', signedIn = true } = {}) {
  const dom = installDom(url, domExtra);
  const requests = [], state = { signedIn }, json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = async (target, init = {}) => {
    requests.push({ url: String(target), init });
    if (target === '/api/pilot/member/login') { state.signedIn = true; return json({ expiresAt: new Date(Date.now() + 3_600_000).toISOString() }); }
    if (target === '/api/me') return state.signedIn ? json({ profile: { id: 'd0700000-0000-4000-8000-000000000001', firstName: 'María', lastName: 'González', email: null, status: 'active' } }) : json({ error: 'client_authentication_required' }, 401);
    if (target === '/api/me/preferences') return json({ preferences: { appearance: 'dark', language: 'es' } });
    if (target === '/api/me/membership') return json({ assignments: [] });
    if (target === '/api/me/booking-access') return json({ enabled: false });
    if (target === '/api/me/bookings') return json({ reservations: [], waitlist: [] });
    if (String(target).startsWith('/api/me/sessions?')) return json({ sessions: [] });
    if (target === '/api/client-portal/form-assignments' || target === '/api/client-portal/consents') return json([]);
    if (target === '/api/me/notifications/unread-count') return json({ count: 0 });
    if (target === '/api/me/training-summary') return json(summary);
    if (target === '/api/me/training/sso') return onRequest(init);
    return json({});
  };
  const { render, cleanup, fireEvent, waitFor, ClientApp, trainingSsoRuntime } = await uiHarness();
  const navigations = [];
  trainingSsoRuntime.navigate = target => { navigations.push(target); };
  const ui = render(React.createElement(ClientApp, { pilotLoginEnabledOverride: true, ...props }));
  if (signedIn) {
    assert.ok(await ui.findByRole('heading', { name: 'Hola, María' }));      // the client session already exists
    fireEvent.click(ui.getByRole('button', { name: 'Búnker', exact: true }));
    assert.ok(await ui.findByRole('heading', { name: 'Búnker' }));
  }
  return { ui, fireEvent, waitFor, requests, navigations, dom, close: () => { cleanup(); dom.window.close(); } };
}
const ssoRequests = requests => requests.filter(item => item.url === '/api/me/training/sso');
const issued = code => () => new Response(JSON.stringify({ v: 1, redirectUrl: `https://app.2jfitnesscenter.com/sso#code=${code}`, expiresAt: new Date().toISOString() }), { status: 201, headers: { 'content-type': 'application/json' } });

test('connected Búnker entry is off by default: the current link stays and no SSO request is made', async () => {
  const { ui, requests, close } = await mountLoggedIn({}, () => { throw new Error('SSO must not be requested'); }, { url: `http://127.0.0.1:5173/#sso_challenge=${CHALLENGE}` });
  assert.ok(ui.getByRole('link', { name: /Abrir Búnker/ }));
  assert.equal(ui.queryByText('Entrarás en Búnker con tu cuenta del centro.'), null);
  assert.equal(ssoRequests(requests).length, 0, 'even a challenge in the address bar does nothing while the flag is off');
  close();
});

test('with the flag on, "Abrir Búnker" only leaves for Training\'s start page: nothing is minted at the tap, and a second tap does nothing', async () => {
  const { ui, fireEvent, requests, navigations, close } = await mountLoggedIn({ trainingSsoEnabledOverride: true }, () => { throw new Error('no code may be requested at the tap'); });
  assert.equal(ui.queryByRole('link', { name: /^Abrir Búnker/ }), null, 'the primary action is the SSO button');
  assert.ok(ui.getByRole('link', { name: /Abrir con tu acceso habitual/ }), 'the passkey login stays available');
  fireEvent.click(ui.getByRole('button', { name: 'Abrir Búnker' }));
  assert.deepEqual(navigations, [START], 'the browser goes to Training\'s start page: no code, no secret, no identity in the URL');
  assert.equal(ssoRequests(requests).length, 0);
  assert.equal(ui.getByRole('button', { name: /Abriendo Búnker/ }).disabled, true, 'the button stays disabled while the page unloads');
  fireEvent.click(ui.getByRole('button', { name: /Abriendo Búnker/ }));
  assert.equal(navigations.length, 1);
  close();
});

test('when Training sends the browser back with its challenge, Home asks Platform for a code bound to that challenge, scrubs the address bar and follows only the validated destination', async () => {
  const code = 'B'.repeat(43);
  const { requests, navigations, dom, waitFor, close } = await mountLoggedIn({ trainingSsoEnabledOverride: true }, issued(code), { url: `http://127.0.0.1:5173/#sso_challenge=${CHALLENGE}` });
  await waitFor(() => assert.equal(navigations.length, 1));
  const [request] = ssoRequests(requests);
  assert.equal(request.init.method, 'POST'); assert.equal(request.init.credentials, 'include');
  assert.deepEqual(JSON.parse(request.init.body), { challenge: CHALLENGE }, 'Home sends the challenge only: no identity, no verifier');
  assert.deepEqual(navigations, [`https://app.2jfitnesscenter.com/sso#code=${code}`]);
  assert.equal(dom.window.location.hash, '', 'the challenge is scrubbed from the address bar');
  assert.equal(dom.window.sessionStorage.getItem('2j.training-sso.challenge'), null, 'and from storage: a reload cannot mint a second code');
  assert.equal(ssoRequests(requests).length, 1);
  close();
});

test('a challenge that arrives before the person has signed in to Home waits for the sign-in, then continues once', async () => {
  const code = 'D'.repeat(43);
  const { ui, fireEvent, requests, navigations, dom, waitFor, close } = await mountLoggedIn({ trainingSsoEnabledOverride: true }, issued(code), { url: `http://127.0.0.1:5173/#sso_challenge=${CHALLENGE}`, signedIn: false });
  assert.ok(await ui.findByLabelText('Código de acceso'), 'Home asks the person to sign in first');
  assert.equal(ssoRequests(requests).length, 0, 'no code is requested for an anonymous visitor');
  assert.equal(dom.window.location.hash, '', 'scrubbed right away');
  assert.ok(dom.window.sessionStorage.getItem('2j.training-sso.challenge'), 'kept for the sign-in');
  fireEvent.change(ui.getByLabelText('Código de acceso'), { target: { value: 'pilot-code' } });
  fireEvent.click(ui.getByRole('button', { name: 'Iniciar sesión' }));
  await waitFor(() => assert.equal(navigations.length, 1));
  assert.deepEqual(JSON.parse(ssoRequests(requests)[0].init.body), { challenge: CHALLENGE });
  assert.equal(ssoRequests(requests).length, 1);
  close();
});

test('malformed or foreign fragments never start anything', async () => {
  for (const hash of ['#sso_challenge=short', `#sso_challenge=${CHALLENGE}&x=1`, `#code=${CHALLENGE}`, `#/sso_challenge=${CHALLENGE}`, '#home']) {
    const { requests, navigations, close } = await mountLoggedIn({ trainingSsoEnabledOverride: true }, () => { throw new Error('SSO must not be requested'); }, { url: `http://127.0.0.1:5173/${hash}` });
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(ssoRequests(requests).length, 0, hash); assert.deepEqual(navigations, [], hash);
    close();
  }
});

test('Home never follows a bad destination and explains suspension, missing link and outages without inventing rules', async () => {
  const cases = [
    [201, { v: 1, redirectUrl: `https://evil.example/sso#code=${'C'.repeat(43)}` }, /acceso habitual/],
    [201, { v: 1, redirectUrl: `https://app.2jfitnesscenter.com/sso?code=${'C'.repeat(43)}` }, /acceso habitual/],
    [201, { v: 1, redirectUrl: `https://app.2jfitnesscenter.com/other#code=${'C'.repeat(43)}` }, /acceso habitual/],
    [400, { error: 'binding_challenge_required' }, /acceso habitual/],
    [403, { error: 'training_access_suspended', reasonCode: 'ADMIN_SUSPENDED' }, /suspendido/],
    [409, { error: 'training_link_required', reasonCode: 'TRAINING_LINK_MISSING' }, /no está vinculada/],
    [423, { error: 'training_sso_disabled' }, /acceso habitual/],
    [503, { error: 'training_sso_unavailable' }, /acceso habitual/],
    [401, { error: 'authentication_required' }, /sesión ha caducado/],
  ];
  for (const [status, body, expected] of cases) {
    const { ui, navigations, close } = await mountLoggedIn({ trainingSsoEnabledOverride: true },
      () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }), { url: `http://127.0.0.1:5173/#sso_challenge=${CHALLENGE}` });
    const alert = await ui.findByRole('alert');
    assert.match(alert.textContent, expected, `${status} ${JSON.stringify(body).slice(0, 60)}`);
    assert.deepEqual(navigations, [], 'nothing is followed');
    assert.equal(ui.getByRole('button', { name: 'Abrir Búnker' }).disabled, false, 'after a failure the person can retry');
    close();
  }
});

test('an account Platform already reports as not linked is not offered a button that must fail', async () => {
  const { ui, requests, close } = await mountLoggedIn({ trainingSsoEnabledOverride: true }, () => { throw new Error('SSO must not be requested'); }, { summary: { status: 'not_linked' } });
  assert.ok(await ui.findByText('Búnker aún no vinculado.'));
  assert.equal(ui.queryByRole('button', { name: 'Abrir Búnker' }), null);
  assert.ok(ui.getByRole('link', { name: /Abrir Búnker/ }), 'the usual access remains');
  assert.equal(ssoRequests(requests).length, 0);
  close();
});

test('inside the native shell the same-tab SSO navigation is never offered, whatever the address bar says', async () => {
  const { ui, requests, close } = await mountLoggedIn({ trainingSsoEnabledOverride: true }, () => { throw new Error('SSO must not be requested'); }, { dom: { Capacitor: { isNativePlatform: () => true } }, url: `http://127.0.0.1:5173/#sso_challenge=${CHALLENGE}` });
  assert.ok(ui.getByRole('link', { name: /Abrir Búnker/ }));
  assert.equal(ui.queryByText('Entrarás en Búnker con tu cuenta del centro.'), null);
  assert.equal(ssoRequests(requests).length, 0);
  close();
});

test('the synthetic demo can never use the connected Búnker entry', async () => {
  const dom = installDom(`http://localhost/#sso_challenge=${CHALLENGE}`);
  let fetchCount = 0; globalThis.fetch = async () => { fetchCount++; return new Response('{}'); };
  const { render, cleanup, fireEvent, ClientApp } = await uiHarness();
  const ui = render(React.createElement(ClientApp, { previewModeOverride: true, trainingSsoEnabledOverride: true }));
  fireEvent.click(ui.getByRole('button', { name: 'Búnker', exact: true }));
  assert.equal(ui.getByRole('button', { name: 'Abrir Búnker' }).disabled, true);
  assert.equal(ui.queryByRole('link', { name: /acceso habitual/ }), null);
  assert.equal(fetchCount, 0);
  cleanup(); dom.window.close();
});
