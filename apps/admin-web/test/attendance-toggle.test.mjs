import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen } = await import('@testing-library/react');
const { AttendanceToggle } = await import('../src/attendance-toggle.tsx');
afterEach(() => cleanup());
after(() => dom.window.close());

const mount = (status, busy = false) => {
  const calls = [];
  render(React.createElement(AttendanceToggle, { status, name: 'Lucía Martín', busy, onSet: (value) => calls.push(value) }));
  return calls;
};

test('an unmarked reservation offers ✓ asistió and ✗ no asistió, and no reopen button', () => {
  const calls = mount('reserved');
  assert.ok(screen.getByRole('group', { name: 'Asistencia de Lucía Martín' }));
  assert.equal(screen.getByRole('button', { name: 'Asistió' }).getAttribute('aria-pressed'), 'false');
  assert.equal(screen.getByRole('button', { name: 'No asistió' }).getAttribute('aria-pressed'), 'false');
  assert.equal(screen.queryByRole('button', { name: 'Reabrir reserva' }), null);
  fireEvent.click(screen.getByRole('button', { name: 'Asistió' }));
  fireEvent.click(screen.getByRole('button', { name: 'No asistió' }));
  assert.deepEqual(calls, ['attended', 'no_show']);
});

test('the chosen state is shown pressed and pressing it again does nothing (D224)', () => {
  const calls = mount('attended');
  const present = screen.getByRole('button', { name: 'Asistió' });
  assert.equal(present.getAttribute('aria-pressed'), 'true');
  assert.equal(present.disabled, true);
  fireEvent.click(present);
  assert.deepEqual(calls, []);
  fireEvent.click(screen.getByRole('button', { name: 'No asistió' }));
  assert.deepEqual(calls, ['no_show']);
});

test('a marked reservation can be reopened and every control is disabled while saving', () => {
  const calls = mount('no_show');
  assert.equal(screen.getByRole('button', { name: 'No asistió' }).getAttribute('aria-pressed'), 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Reabrir reserva' }));
  assert.deepEqual(calls, ['reserved']);
  cleanup();
  mount('attended', true);
  for (const button of screen.getAllByRole('button')) assert.equal(button.disabled, true);
});

test('icons are decorative: the controls are named by their label, not by a glyph', () => {
  mount('reserved');
  for (const button of screen.getAllByRole('button')) {
    assert.ok(button.getAttribute('aria-label'));
    assert.equal(button.textContent, '');
    assert.equal(button.querySelector('svg')?.getAttribute('aria-hidden'), 'true');
  }
});
