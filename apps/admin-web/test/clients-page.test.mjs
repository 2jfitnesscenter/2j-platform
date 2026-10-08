import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5173/#clients' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { ClientsPage } = await import('../src/clients-page.tsx');
afterEach(() => { cleanup(); globalThis.fetch = undefined; });
after(() => dom.window.close());

const client = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', firstName: 'Marta', lastName: 'Santos', email: 'marta@example.test', phone: '+34 600 000 000', status: 'active', createdAt: '2026-10-01T10:00:00Z' };
const sections = [
  ['summary', 'Resumen', 'clients', 'available', 'ready'], ['reservations', 'Reservas', 'scheduling', 'available', 'not_connected'], ['payments', 'Pagos', 'billing', 'available', 'not_connected'],
  ['training', 'Entrenamiento', '2jfitnessapp / Búnker', 'available', 'not_connected'], ['progress', 'Progreso', '2jfitnessapp / Progress', 'available', 'not_connected'], ['health', 'Salud', '2jfitnessapp / Health', 'available', 'not_connected'],
  ['documents', 'Documentos/Formularios', 'health-documents', 'available', 'not_connected'], ['messages', 'Mensajes', 'communications', 'available', 'not_connected'], ['history', 'Historial', 'client_events', 'available', 'ready'],
].map(([id, label, source, access, dataState]) => ({ id, label, source, access, dataState }));
const profile = { client, capabilities: { manage: true }, summary: {}, sections, history: [{ id: 'event-1', eventType: 'client.created', actorId: 'qa-admin', occurredAt: client.createdAt }] };
const response = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

test('shows real clients, searches the server, and opens a 360 profile with clearly unconnected sections', async () => {
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    if (String(url).includes('/api/clients?')) return response({ items: [client], capabilities: { manage: true } });
    if (String(url).endsWith(`/api/clients/${client.id}`)) return response(profile);
    throw new Error(`Unexpected request ${url}`);
  };
  render(React.createElement(ClientsPage));
  await screen.findByRole('button', { name: /Marta Santos/ });
  fireEvent.change(screen.getByLabelText('Buscar cliente'), { target: { value: 'marta' } });
  await waitFor(() => assert.ok(requests.some((url) => url.includes('q=marta'))));
  fireEvent.click(screen.getByRole('button', { name: /Marta Santos/ }));
  await screen.findByRole('heading', { name: 'Marta Santos' });
  for (const label of ['Resumen', 'Reservas', 'Pagos', 'Entrenamiento', 'Progreso', 'Salud', 'Documentos/Formularios', 'Mensajes', 'Historial']) assert.ok(screen.getByRole('tab', { name: label }));
  assert.equal(screen.getAllByText('marta@example.test').length, 2);
  fireEvent.click(screen.getByRole('tab', { name: 'Entrenamiento' }));
  assert.ok(screen.getByText(/sigue teniendo su fuente de verdad en 2J Fitness App y El Búnker/));
  assert.equal(screen.queryByText(/rutina asignada/), null);
});

test('creates a client only when the server grants manage capability and refreshes its profile', async () => {
  const created = { ...client, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', firstName: 'Ada', lastName: 'Lovelace' };
  let list = [];
  let submitted;
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.endsWith('/api/clients') && options.method === 'POST') { submitted = JSON.parse(options.body); list = [created]; return response(created, 201); }
    if (path.includes('/api/clients?')) return response({ items: list, capabilities: { manage: true } });
    if (path.endsWith(`/api/clients/${created.id}`)) return response({ ...profile, client: created });
    throw new Error(`Unexpected request ${options.method ?? 'GET'} ${path}`);
  };
  render(React.createElement(ClientsPage));
  await screen.findByText('Aún no hay clientes');
  fireEvent.click(screen.getByRole('button', { name: /crear primer cliente/i }));
  const dialog = await screen.findByRole('dialog', { name: 'Nuevo cliente' });
  fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Ada' } });
  fireEvent.change(within(dialog).getByLabelText('Apellidos'), { target: { value: 'Lovelace' } });
  fireEvent.change(within(dialog).getByLabelText('Email (opcional)'), { target: { value: 'ada@example.test' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Crear cliente' }));
  await screen.findByRole('heading', { name: 'Ada Lovelace' });
  assert.deepEqual(submitted, { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test', phone: '' });
});

test('fails closed when the server has no authorized session', async () => {
  globalThis.fetch = async () => response({ error: 'authentication_required' }, 401);
  render(React.createElement(ClientsPage));
  await screen.findByText('La API no ha establecido una sesión autorizada para consultar datos personales.');
  assert.equal(screen.queryByText(client.email), null);
  assert.equal(screen.queryByRole('button', { name: /nuevo cliente/i }), null);
});

test('create dialog focuses its first field, traps keyboard focus, and restores its opener', async () => {
  globalThis.fetch = async () => response({ items: [], capabilities: { manage: true } });
  render(React.createElement(ClientsPage));
  await screen.findByText('Aún no hay clientes');
  const opener = screen.getByRole('button', { name: /crear primer cliente/i });
  opener.focus();
  fireEvent.click(opener);
  const dialog = await screen.findByRole('dialog', { name: 'Nuevo cliente' });
  const firstName = within(dialog).getByLabelText('Nombre');
  assert.equal(document.activeElement, firstName);
  const close = within(dialog).getByRole('button', { name: 'Cerrar diálogo' });
  close.focus();
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
  assert.equal(document.activeElement, within(dialog).getByRole('button', { name: 'Crear cliente' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
  assert.equal(document.activeElement, opener);
});
