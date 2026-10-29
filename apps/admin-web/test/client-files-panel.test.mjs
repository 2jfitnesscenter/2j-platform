import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174/#clients' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, File: dom.window.File, FormData: dom.window.FormData });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { ClientFilesPanel } = await import('../src/client-files-panel.tsx');
afterEach(() => { cleanup(); globalThis.fetch = undefined; });
after(() => dom.window.close());
const CLIENT = '11111111-1111-4111-8111-111111111111';
const response = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const file = (id, overrides = {}) => ({ id, title: `Contrato ${id}`, documentType: 'contract', visibility: 'staff_only', mimeType: 'application/pdf', sizeBytes: 2048, createdAt: '2026-10-28T10:00:00Z', ...overrides });

test('lists the files with type, size and visibility, and links the download without exposing any storage key', async () => {
  globalThis.fetch = async () => response({ items: [file('a'), file('b', { visibility: 'client_visible', sizeBytes: 3 * 1024 * 1024 })] });
  render(React.createElement(ClientFilesPanel, { clientId: CLIENT }));
  const list = await screen.findByRole('list', { name: 'Archivos del cliente' });
  assert.match(list.textContent, /Solo personal/); assert.match(list.textContent, /Visible para el cliente/); assert.match(list.textContent, /3,0 MB/); assert.match(list.textContent, /2 KB/);
  const links = within(list).getAllByRole('link', { name: 'Descargar' });
  assert.equal(links[0].getAttribute('href'), `http://127.0.0.1:3100/api/clients/${CLIENT}/documents/a/download`);
  assert.equal(/object|key|bucket/i.test(document.body.innerHTML), false);
});

test('uploading sends title, type and visibility before the file as multipart, starts staff-only and refreshes the list', async () => {
  const calls = [];
  let items = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method ?? 'GET', body: options.body });
    if ((options.method ?? 'GET') === 'POST') { items = [file('new', { title: 'Contrato firmado' })]; return response({ id: 'new' }, 201); }
    return response({ items });
  };
  render(React.createElement(ClientFilesPanel, { clientId: CLIENT }));
  await screen.findByText('Este cliente no tiene archivos.');
  assert.equal(screen.getByLabelText('Visible para el cliente').checked, false, 'private by default');
  fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Contrato firmado' } });
  fireEvent.change(screen.getByLabelText('Archivo'), { target: { files: [new File(['%PDF-1.4'], 'x.pdf', { type: 'application/pdf' })] } });
  fireEvent.click(screen.getByRole('button', { name: 'Subir archivo' }));
  await screen.findByText('Archivo guardado.');
  const post = calls.find((call) => call.method === 'POST');
  assert.equal(post.url, `http://127.0.0.1:3100/api/clients/${CLIENT}/documents`);
  assert.deepEqual([...post.body.keys()], ['title', 'documentType', 'visibility', 'file'], 'text fields precede the file');
  assert.equal(post.body.get('visibility'), 'staff_only');
  assert.ok(await screen.findByText('Contrato firmado'));
});

test('upload problems are explained: oversized files never leave the browser, server refusals map to plain Spanish', async () => {
  let posts = 0;
  globalThis.fetch = async (url, options = {}) => { if ((options.method ?? 'GET') === 'POST') { posts += 1; return response({ error: 'unsupported_document_type' }, 415); } return response({ items: [] }); };
  render(React.createElement(ClientFilesPanel, { clientId: CLIENT }));
  await screen.findByText('Este cliente no tiene archivos.');
  fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Grande' } });
  const big = new File(['x'], 'big.pdf', { type: 'application/pdf' });
  Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 });
  fireEvent.change(screen.getByLabelText('Archivo'), { target: { files: [big] } });
  fireEvent.click(screen.getByRole('button', { name: 'Subir archivo' }));
  assert.equal((await screen.findByRole('alert')).textContent, 'El archivo supera los 5 MB.');
  assert.equal(posts, 0);
  fireEvent.change(screen.getByLabelText('Archivo'), { target: { files: [new File(['MZ'], 'virus.exe')] } });
  fireEvent.click(screen.getByRole('button', { name: 'Subir archivo' }));
  await waitFor(() => assert.equal(screen.getByRole('alert').textContent, 'Solo se admiten PDF, JPG o PNG.'));
  assert.equal(posts, 1);
});

test('visibility changes are explicit, confirmed in words and reflected after reloading', async () => {
  let visibility = 'staff_only';
  const patches = [];
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'PATCH') { patches.push(JSON.parse(options.body)); visibility = patches.at(-1).visibility; return response({ id: 'a', visibility }); }
    return response({ items: [file('a', { visibility })] });
  };
  render(React.createElement(ClientFilesPanel, { clientId: CLIENT }));
  fireEvent.click(await screen.findByRole('button', { name: 'Hacer visible al cliente' }));
  await screen.findByText('El cliente ya puede ver este archivo.');
  assert.deepEqual(patches, [{ visibility: 'client_visible' }]);
  fireEvent.click(await screen.findByRole('button', { name: 'Volver a solo personal' }));
  await screen.findByText('El archivo vuelve a ser solo del personal.');
});

test('a profile without document access, or an API without the feature, only gets a calm explanation and no upload form', async () => {
  globalThis.fetch = async () => response({}, 403);
  render(React.createElement(ClientFilesPanel, { clientId: CLIENT }));
  assert.ok(await screen.findByText('Tu perfil no puede ver los archivos de este cliente.'));
  assert.equal(screen.queryByRole('form', { name: 'Subir archivo' }), null);
  cleanup();
  globalThis.fetch = async () => response({}, 404);
  render(React.createElement(ClientFilesPanel, { clientId: CLIENT }));
  assert.ok(await screen.findByText('Los archivos de cliente todavía no están disponibles en este entorno.'));
});
