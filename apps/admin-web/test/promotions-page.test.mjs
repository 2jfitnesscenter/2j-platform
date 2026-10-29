import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174/#promotions' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, render, screen } = await import('@testing-library/react');
const { PromotionsPage } = await import('../src/promotions-page.tsx');
const { getProfessionalNavigation, getProfessionalPageContext } = await import('../src/app-shell.tsx');
afterEach(() => { cleanup(); globalThis.fetch = undefined; });
after(() => dom.window.close());

test('Promociones is visible, says it is not connected, offers no way to create or change anything and calls no API', () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('Promociones must not call the API'); };
  render(React.createElement(PromotionsPage));
  assert.ok(screen.getByRole('heading', { level: 1, name: 'Promociones' }));
  assert.ok(screen.getByText('No conectado'));
  assert.ok(screen.getByText('Las promociones todavía no se aplican a ningún precio'));
  assert.equal(screen.queryAllByRole('button').length, 0, 'no create, edit or delete controls');
  assert.equal(document.querySelectorAll('input, select, textarea, form').length, 0);
  assert.equal(calls, 0);
});

test('Promociones appears in the navigation only for profiles that manage pricing', () => {
  const none = { calendar: true, clients: true, communications: true, billing: true, staff: true };
  const labels = (caps) => getProfessionalNavigation(caps).flatMap((section) => section.children ?? [section.route]).filter(Boolean).map((route) => route.label);
  assert.equal(labels(none).includes('Promociones'), false);
  assert.equal(labels({ ...none, catalogPricingManage: true }).includes('Promociones'), true);
  assert.equal(getProfessionalPageContext('promotions').page, 'Promociones');
});
