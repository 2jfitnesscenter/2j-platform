import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5173/#calendar' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { CalendarPage } = await import('../src/calendar-page.tsx');
afterEach(() => { cleanup(); globalThis.fetch = undefined; });
after(() => dom.window.close());

const area = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'La Sala' };
const service = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Fuerza 2J', areaId: area.id };
const response = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const now = new Date(); const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate()); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
const key = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const baseData = { weekStart: key(monday), sessions: [], areas: [area], services: [service], templates: [], capabilities: { manage: true, overrideCapacity: false } };

test('renders weekly loading and empty states, then allows stepping weeks', async () => {
  const requested = [];
  globalThis.fetch = async (url) => { requested.push(String(url)); await new Promise((resolve) => setTimeout(resolve, 10)); return response(baseData); };
  render(React.createElement(CalendarPage));
  assert.ok(screen.getByRole('status'));
  await screen.findByText('Esta semana aún no tiene sesiones');
  fireEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }));
  await waitFor(() => assert.ok(requested.length >= 2));
  assert.equal((await screen.findAllByText('Sin sesiones')).length, 7);
});

test('creates a real staff session using the selected 2J service and capacity', async () => {
  let session = null; let posted = null;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('/api/calendar/week')) return response({ ...baseData, sessions: session ? [{ ...session, occupiedCount: 0, waitlistCount: 0 }] : [] });
    if (String(url).endsWith('/api/calendar/sessions') && options.method === 'POST') { posted = JSON.parse(options.body); session = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', serviceId: service.id, serviceName: service.name, areaId: area.id, areaName: area.name, templateId: null, source: 'manual', startsAt: posted.startsAt, durationMinutes: posted.durationMinutes, capacity: posted.capacity, status: 'scheduled', individualClientId: null }; return response(session, 201); }
    throw new Error(`Unexpected request: ${options.method ?? 'GET'} ${url}`);
  };
  render(React.createElement(CalendarPage));
  await screen.findByText('Esta semana aún no tiene sesiones');
  fireEvent.click(screen.getByRole('button', { name: 'Nueva sesión' }));
  const dialog = await screen.findByRole('dialog', { name: 'Nueva sesión' });
  fireEvent.change(within(dialog).getByLabelText('Servicio'), { target: { value: service.id } });
  fireEvent.change(within(dialog).getByLabelText('Capacidad'), { target: { value: '8' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Crear sesión' }));
  await screen.findByRole('button', { name: /Fuerza 2J/ });
  assert.equal(posted.serviceId, service.id);
  assert.equal(posted.areaId, area.id);
  assert.equal(posted.capacity, 8);
  assert.equal(session.source, 'manual');
});

test('keeps recurring templates separate and requires an explicit occurrence date to generate a session', async () => {
  let templateSaved = false; let generated = false;
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.includes('/api/calendar/week')) return response({ ...baseData, sessions: generated ? [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', serviceId: service.id, serviceName: service.name, areaId: area.id, areaName: area.name, templateId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', source: 'template', startsAt: `${baseData.weekStart}T09:30:00Z`, durationMinutes: 45, capacity: 8, status: 'scheduled', individualClientId: null, occupiedCount: 0, waitlistCount: 0 }] : [] });
    if (path.endsWith('/api/calendar/templates') && options.method === 'POST') { templateSaved = true; return response({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', status: 'active' }, 201); }
    if (path.endsWith('/api/calendar/templates/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/sessions') && options.method === 'POST') { generated = true; return response({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }, 201); }
    throw new Error(`Unexpected request: ${options.method ?? 'GET'} ${url}`);
  };
  render(React.createElement(CalendarPage));
  await screen.findByText('Esta semana aún no tiene sesiones');
  fireEvent.click(screen.getByRole('button', { name: 'Nueva plantilla' }));
  const dialog = await screen.findByRole('dialog', { name: 'Nueva plantilla recurrente' });
  fireEvent.change(within(dialog).getByLabelText('Servicio'), { target: { value: service.id } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar plantilla' }));
  await screen.findByRole('button', { name: 'Generar sesión' });
  assert.equal(templateSaved, true);
  assert.match(within(dialog).getByText(/Genera una sesión para una fecha concreta/).textContent, /fecha concreta/);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Generar sesión' }));
  await waitFor(() => assert.equal(generated, true));
  await screen.findByRole('button', { name: /Fuerza 2J/ });
});
