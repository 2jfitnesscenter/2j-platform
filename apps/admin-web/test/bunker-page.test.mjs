import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5173/#bunker' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react');
const { BunkerPage, bunkerAdminRuntime, bunkerAdminConfig, bunkerChallengeFromHash, bunkerDestination, resolveBunkerAdminUrl, BUNKER_ADMIN_START_PATH } = await import('../src/bunker-page.tsx');
bunkerAdminConfig.url = 'http://127.0.0.1:8081';
afterEach(() => { cleanup(); window.location.hash = '#bunker'; });

test('the configured Bunker address must be https or loopback http and carries no credentials', () => {
  assert.equal(resolveBunkerAdminUrl('https://bunker.example.com/admin'), 'https://bunker.example.com');
  assert.equal(resolveBunkerAdminUrl('http://127.0.0.1:8081'), 'http://127.0.0.1:8081');
  for (const bad of ['', undefined, 'http://bunker.example.com', 'javascript:alert(1)', 'https://user:pw@bunker.example.com', 'not a url']) assert.equal(resolveBunkerAdminUrl(bad), '', String(bad));
});

test('the challenge is read only from the exact return address, and only the fixed Bunker origin is followed', () => {
  const challenge = 'A'.repeat(43);
  assert.equal(bunkerChallengeFromHash(`#bunker?sso_challenge=${challenge}`), challenge);
  for (const bad of ['#bunker', '#bunker?sso_challenge=short', `#clients?sso_challenge=${challenge}`, `#bunker?sso_challenge=${challenge}&x=1`]) assert.equal(bunkerChallengeFromHash(bad), null, bad);
  const code = 'B'.repeat(43);
  assert.equal(bunkerDestination(`http://127.0.0.1:8081/admin/sso#code=${code}`, 'http://127.0.0.1:8081'), `http://127.0.0.1:8081/admin/sso#code=${code}`);
  for (const bad of [`https://evil.example/sso#code=${code}`, `http://127.0.0.1:8081/sso?x=1#code=${code}`, 'http://127.0.0.1:8081/sso#nope', null, 42]) assert.equal(bunkerDestination(bad, 'http://127.0.0.1:8081'), null, String(bad));
  assert.equal(bunkerDestination(`http://127.0.0.1:8081/sso#code=${code}`, ''), null);
});

test('step 1: the button leaves for Bunker\'s start page without minting anything', () => {
  const calls = []; const original = bunkerAdminRuntime.navigate; bunkerAdminRuntime.navigate = url => calls.push(url);
  let fetched = 0; globalThis.fetch = async () => { fetched++; return { ok: true, json: async () => ({}) }; };
  try {
    render(React.createElement(BunkerPage));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Búnker' }));
    assert.deepEqual(calls, [`http://127.0.0.1:8081${BUNKER_ADMIN_START_PATH}`]);
    assert.equal(fetched, 0);
  } finally { bunkerAdminRuntime.navigate = original; }
});

test('step 2: with the challenge Platform issues the handoff and only the validated Bunker address is followed', async () => {
  const challenge = 'C'.repeat(43), code = 'D'.repeat(43);
  const calls = []; const original = bunkerAdminRuntime.navigate; bunkerAdminRuntime.navigate = url => calls.push(url);
  const requests = [];
  globalThis.fetch = async (url, init) => { requests.push([String(url), init]); return { ok: true, status: 201, json: async () => ({ v: 1, redirectUrl: `http://127.0.0.1:8081/admin/sso#code=${code}` }) }; };
  window.location.hash = `#bunker?sso_challenge=${challenge}`;
  try {
    render(React.createElement(BunkerPage));
    await waitFor(() => assert.deepEqual(calls, [`http://127.0.0.1:8081/admin/sso#code=${code}`]));
    assert.match(requests[0][0], /\/api\/staff\/bunker\/sso$/);
    assert.equal(requests[0][1].method, 'POST'); assert.equal(requests[0][1].credentials, 'include');
    assert.deepEqual(JSON.parse(requests[0][1].body), { challenge });
  } finally { bunkerAdminRuntime.navigate = original; }
});

test('a refused or foreign handoff shows a message and never navigates', async () => {
  const calls = []; const original = bunkerAdminRuntime.navigate; bunkerAdminRuntime.navigate = url => calls.push(url);
  globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: 'permission_denied' }) });
  window.location.hash = `#bunker?sso_challenge=${'E'.repeat(43)}`;
  try {
    render(React.createElement(BunkerPage));
    assert.ok(await screen.findByText('Tu perfil no tiene acceso a Búnker.'));
    assert.deepEqual(calls, []);
    cleanup();
    globalThis.fetch = async () => ({ ok: true, status: 201, json: async () => ({ v: 1, redirectUrl: `https://evil.example/sso#code=${'F'.repeat(43)}` }) });
    window.location.hash = `#bunker?sso_challenge=${'G'.repeat(43)}`;
    render(React.createElement(BunkerPage));
    assert.ok(await screen.findByText('No se pudo abrir Búnker. Inténtalo de nuevo.'));
    assert.deepEqual(calls, []);
  } finally { bunkerAdminRuntime.navigate = original; }
});
