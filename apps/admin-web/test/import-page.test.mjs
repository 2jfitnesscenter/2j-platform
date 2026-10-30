import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174/#import' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, File: dom.window.File, FormData: dom.window.FormData });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react');
const { ImportPage } = await import('../src/import-page.tsx');
const { getProfessionalNavigation } = await import('../src/app-shell.tsx');
afterEach(() => { cleanup(); globalThis.fetch = undefined; });
after(() => dom.window.close());
const DIGEST = 'a'.repeat(64);
const response = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const preview = (extra = {}) => ({
  commitAvailable: true, previewId: '11111111-1111-4111-8111-111111111111', fileDigest: DIGEST, rowCount: 5, validCount: 4, invalidCount: 1, sourceFormat: 'xls',
  rows: [{ rowNumber: 2, errors: [] }, { rowNumber: 6, errors: ['first_name_invalid'] }],
  timpSummary: { total: 5, asOfDate: '2026-10-30', active: 3, inactive: 1, incomplete: 2, incompleteByField: { email: 1, phone: 1, gender: 1, birthDate: 1 }, duplicateEmailRows: 2, duplicatePhoneRows: 0, minorsReview: 1 },
  ...extra,
});
const choose = (name = 'socios.xls') => fireEvent.change(screen.getByLabelText('Archivo de TIMP'), { target: { files: [new File(['x'], name)] } });

test('the owner previews the file, sees counts and problem rows, and nothing is imported until the explicit confirmation', async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => { calls.push({ url: String(url), options }); return response(preview()); };
  render(React.createElement(ImportPage));
  assert.ok(screen.getByText(/no se guarda en el servidor ni en ningún registro/));
  assert.equal(screen.getByRole('button', { name: 'Ver vista previa' }).disabled, true, 'no file yet');
  choose();
  fireEvent.click(screen.getByRole('button', { name: 'Ver vista previa' }));
  const facts = await screen.findByRole('list', { name: 'Vista previa de la importación' });
  assert.match(facts.textContent, /5 registros en el archivo/); assert.match(facts.textContent, /Activos 3 con reserva en los últimos 365 días/); assert.match(facts.textContent, /Inactivos 1 sin reserva reciente/);
  assert.match(facts.textContent, /Actividad calculada a 2026-10-30 \(Atlantic\/Canary\)/);
  assert.match(facts.textContent, /2 con la ficha incompleta \(1 sin correo, 1 sin teléfono, 1 sin género, 1 sin fecha de nacimiento\)/);
  assert.match(facts.textContent, /2 filas con correo repetido/); assert.match(facts.textContent, /1 sin fecha de nacimiento: se marcan por si son menores/);
  fireEvent.click(screen.getByText('Ver filas con error'));
  assert.ok(screen.getByText('Fila 6: nombre vacío o demasiado largo'));
  assert.deepEqual(calls.map((call) => call.url.split('/api')[1]), ['/clients/import/preview'], 'only the preview was requested');
  const button = screen.getByRole('button', { name: 'Importar 4 clientes' });
  assert.equal(button.disabled, true, 'the checkbox must be ticked first');
  fireEvent.click(screen.getByLabelText(/Entiendo que se crearán 4 clientes/));
  assert.equal(button.disabled, false);
  assert.equal(calls.length, 1, 'ticking is not importing');
});

test('confirming sends the previewed digest and row count with the typed confirmation and then reports what was created', async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return String(url).endsWith('/preview') ? response(preview()) : response({ replayed: false, rowCount: 5, created: 4, skipped: 1, active: 3, inactive: 1, incomplete: 2, emailNotStored: 1, skippedRows: [{ rowNumber: 6, errors: ['first_name_invalid'] }] }, 201);
  };
  render(React.createElement(ImportPage));
  choose(); fireEvent.click(screen.getByRole('button', { name: 'Ver vista previa' }));
  fireEvent.click(await screen.findByLabelText(/Entiendo que se crearán 4 clientes/));
  fireEvent.click(screen.getByRole('button', { name: 'Importar 4 clientes' }));
  const result = await screen.findByRole('list', { name: 'Resultado de la importación' });
  const commit = calls.find((call) => call.url.endsWith('/commit'));
  assert.deepEqual({ ...commit.options.headers }, { 'x-import-confirm': 'IMPORTAR', 'x-import-preview-id': '11111111-1111-4111-8111-111111111111', 'x-import-digest': DIGEST, 'x-import-expected-rows': '5' });
  assert.match(result.textContent, /4 clientes creados de 5/); assert.match(result.textContent, /3 activos · 1 inactivos/); assert.match(result.textContent, /2 con la ficha incompleta/); assert.match(result.textContent, /1 sin correo guardado por estar repetido/); assert.match(result.textContent, /1 filas no importadas/);
  assert.ok(screen.getByRole('link', { name: 'Ver clientes' }));
});

test('without commit permission or activation the preview is read-only and says why; refusals and problems are explained in Spanish', async () => {
  globalThis.fetch = async () => response(preview({ commitAvailable: false }));
  render(React.createElement(ImportPage));
  choose(); fireEvent.click(screen.getByRole('button', { name: 'Ver vista previa' }));
  assert.ok(await screen.findByText('La importación real no está disponible'));
  assert.equal(screen.queryByRole('button', { name: /^Importar/ }), null);
  cleanup();
  globalThis.fetch = async () => response({ error: 'unsupported_columns' }, 400);
  render(React.createElement(ImportPage));
  choose(); fireEvent.click(screen.getByRole('button', { name: 'Ver vista previa' }));
  assert.match((await screen.findByRole('alert')).textContent, /columnas con datos que no se importan/);
  cleanup();
  render(React.createElement(ImportPage));
  const big = new File(['x'], 'big.xls'); Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 });
  fireEvent.change(screen.getByLabelText('Archivo de TIMP'), { target: { files: [big] } });
  globalThis.fetch = async () => { throw new Error('must not upload'); };
  fireEvent.click(screen.getByRole('button', { name: 'Ver vista previa' }));
  assert.equal((await screen.findByRole('alert')).textContent, 'El archivo supera los 5 MB.');
});

test('a changed file after the preview is refused by the server and the owner is sent back to the preview', async () => {
  globalThis.fetch = async (url) => String(url).endsWith('/preview') ? response(preview()) : response({ error: 'file_changed_since_preview' }, 409);
  render(React.createElement(ImportPage));
  choose(); fireEvent.click(screen.getByRole('button', { name: 'Ver vista previa' }));
  fireEvent.click(await screen.findByLabelText(/Entiendo que se crearán 4 clientes/));
  fireEvent.click(screen.getByRole('button', { name: 'Importar 4 clientes' }));
  await waitFor(() => assert.match(screen.getByRole('alert').textContent, /no es el mismo que se revisó/));
  assert.ok(screen.getByRole('button', { name: 'Importar 4 clientes' }), 'still on the preview, nothing was imported');
});

test('a preview from the previous Canary date asks the owner to regenerate and review it', async () => {
  globalThis.fetch = async (url) => String(url).endsWith('/preview') ? response(preview()) : response({ error: 'preview_date_changed' }, 409);
  render(React.createElement(ImportPage));
  choose(); fireEvent.click(screen.getByRole('button', { name: 'Ver vista previa' }));
  fireEvent.click(await screen.findByLabelText(/Entiendo que se crearán 4 clientes/));
  fireEvent.click(screen.getByRole('button', { name: 'Importar 4 clientes' }));
  await waitFor(() => assert.match(screen.getByRole('alert').textContent, /Ha cambiado el día en Canarias/));
  assert.ok(screen.getByRole('button', { name: 'Importar 4 clientes' }), 'no success state is shown');
});

test('Importar clientes is offered only to profiles that manage settings', () => {
  const labels = (caps) => getProfessionalNavigation(caps).flatMap((section) => section.children ?? []).map((route) => route.label);
  const base = { calendar: true, clients: true, communications: true, billing: true, staff: true };
  assert.equal(labels(base).includes('Importar clientes'), false);
  assert.equal(labels({ ...base, notificationSettings: true }).includes('Importar clientes'), true);
});
