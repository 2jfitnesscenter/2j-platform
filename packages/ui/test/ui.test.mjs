import { afterEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';
import { Search } from 'lucide-react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen } = await import('@testing-library/react');
const { Button, IconButton, Card, CardHeader, StatusChip, PageHeader, Icon } = await import('../src/index.ts');
afterEach(cleanup);
after(() => dom.window.close());
const h = React.createElement;

test('Button renders the three variants and defaults to type="button"', () => {
  render(h('div', null, h(Button, { variant: 'primary' }, 'Guardar'), h(Button, null, 'Cancelar'), h(Button, { variant: 'ghost' }, 'Ver')));
  assert.match(screen.getByRole('button', { name: 'Guardar' }).className, /ui-button--primary/);
  assert.match(screen.getByRole('button', { name: 'Cancelar' }).className, /ui-button--secondary/);
  assert.match(screen.getByRole('button', { name: 'Ver' }).className, /ui-button--ghost/);
  assert.equal(screen.getByRole('button', { name: 'Guardar' }).getAttribute('type'), 'button');
});

test('Button forwards clicks, blocks them when disabled or loading, and announces busy', () => {
  let clicks = 0;
  const { rerender } = render(h(Button, { onClick: () => { clicks += 1; } }, 'Actualizar'));
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
  assert.equal(clicks, 1);
  rerender(h(Button, { onClick: () => { clicks += 1; }, disabled: true }, 'Actualizar'));
  assert.equal(screen.getByRole('button', { name: 'Actualizar' }).disabled, true);
  rerender(h(Button, { onClick: () => { clicks += 1; }, loading: true }, 'Actualizar'));
  const busy = screen.getByRole('button', { name: 'Actualizar' });
  assert.equal(busy.disabled, true);
  assert.equal(busy.getAttribute('aria-busy'), 'true');
  fireEvent.click(busy);
  assert.equal(clicks, 1);
  assert.ok(busy.querySelector('.ui-button-label'), 'label stays rendered while loading so the width does not jump');
});

test('Button with href renders a link with the same look', () => {
  render(h(Button, { href: '#calendar', variant: 'secondary', icon: Search }, 'Abrir agenda'));
  const link = screen.getByRole('link', { name: 'Abrir agenda' });
  assert.equal(link.getAttribute('href'), '#calendar');
  assert.match(link.className, /ui-button/);
  assert.equal(link.querySelector('svg')?.getAttribute('aria-hidden'), 'true');
});

test('IconButton exposes its accessible name and decorative icon', () => {
  render(h(IconButton, { icon: Search, label: 'Buscar en 2J' }));
  const button = screen.getByRole('button', { name: 'Buscar en 2J' });
  assert.equal(button.getAttribute('title'), 'Buscar en 2J');
  assert.equal(button.querySelector('svg')?.getAttribute('aria-hidden'), 'true');
});

test('Icon uses the V2 stroke and the requested size', () => {
  const { container } = render(h(Icon, { icon: Search, size: 24 }));
  const svg = container.querySelector('svg');
  assert.equal(svg?.getAttribute('width'), '24');
  assert.equal(svg?.getAttribute('stroke-width'), '1.75');
});

test('StatusChip always pairs text with an icon and maps the tone class', () => {
  render(h('div', null, ['success', 'warning', 'danger', 'info', 'neutral'].map((tone) => h(StatusChip, { key: tone, tone }, `Estado ${tone}`))));
  for (const tone of ['success', 'warning', 'danger', 'info', 'neutral']) {
    const chip = screen.getByText(`Estado ${tone}`).closest('.ui-chip');
    assert.ok(chip?.classList.contains(`ui-chip--${tone}`));
    assert.ok(chip?.querySelector('svg'), `${tone} chip has an icon`);
  }
  render(h(StatusChip, { tone: 'info', icon: null }, 'Solo texto'));
  assert.equal(screen.getByText('Solo texto').closest('.ui-chip')?.querySelector('svg'), null);
});

test('Card and CardHeader render a labelled section with title level and actions', () => {
  render(h(Card, { as: 'section', 'aria-labelledby': 'c1' }, h(CardHeader, { title: 'Próximas sesiones', titleId: 'c1', description: 'Hoy', actions: h('span', null, '3') })));
  const section = screen.getByRole('region', { name: 'Próximas sesiones' });
  assert.match(section.className, /ui-card/);
  assert.equal(screen.getByRole('heading', { level: 2, name: 'Próximas sesiones' }).id, 'c1');
  assert.ok(screen.getByText('Hoy'));
});

test('PageHeader renders one h1 with optional description, meta and actions', () => {
  render(h(PageHeader, { title: 'Resumen', description: 'jueves 16 de octubre', meta: 'Actualizado 10:42', actions: h(Button, null, 'Actualizar') }));
  assert.equal(screen.getAllByRole('heading', { level: 1 }).length, 1);
  assert.ok(screen.getByText('jueves 16 de octubre'));
  assert.ok(screen.getByText('Actualizado 10:42'));
  assert.ok(screen.getByRole('button', { name: 'Actualizar' }));
});
