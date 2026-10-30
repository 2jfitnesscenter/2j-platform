import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174/#settings' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, File: dom.window.File, FormData: dom.window.FormData });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { InvoiceSettingsPanel, InvoiceDialog } = await import('../src/invoice-ui.tsx');
afterEach(() => { cleanup(); globalThis.fetch = undefined; });
after(() => dom.window.close());
const response = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const settings = (extra = {}) => ({ issuerName: null, issuerTaxId: null, issuerAddress: null, issuerPostalCode: null, issuerLocality: null, issuerProvince: null, defaultIgicBasisPoints: 300, defaultSeriesId: null, footerText: null, legalText: null, hasLogo: false, logoMime: null, series: [{ id: 's-1', name: 'Facturas', prefix: 'F', nextNumber: 1, active: true }], missing: ['nombre o razón social', 'NIF', 'dirección', 'serie de numeración'], canManage: true, ...extra });
const doc = (id, extra = {}) => ({ id, documentType: 'full_invoice', status: 'issued', documentNumber: `F-${id}`, documentDate: '2026-10-29', grossCents: 10300, isRectified: false, ...extra });

test('the settings start empty, say exactly what is missing, and nothing is pre-filled with business data', async () => {
  globalThis.fetch = async () => response(settings());
  render(React.createElement(InvoiceSettingsPanel));
  const missing = await screen.findByText(/Todavía no se pueden emitir facturas/);
  assert.match(missing.parentElement.textContent, /Falta: nombre o razón social, NIF, dirección, serie de numeración\./);
  for (const label of ['Nombre o razón social', 'NIF', 'Dirección', 'Pie de factura', 'Texto legal']) assert.equal(screen.getByLabelText(label).value, '');
  assert.equal(screen.getByLabelText('IGIC por defecto (%)').value, '3', 'the only default is the 3 % IGIC, editable');
  assert.ok(screen.getByText('Sin logo: las facturas llevarán el nombre del negocio.'));
});

test('saving sends the issuer data and the IGIC in basis points; a wrong percentage is caught before the request', async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => { calls.push({ url: String(url), options }); return options.method === 'PUT' ? response({ ok: true }) : response(settings()); };
  render(React.createElement(InvoiceSettingsPanel));
  await screen.findByLabelText('NIF');
  fireEvent.change(screen.getByLabelText('Nombre o razón social'), { target: { value: 'Emisor Sintético S.L.' } });
  fireEvent.change(screen.getByLabelText('NIF'), { target: { value: 'B00000000' } });
  fireEvent.change(screen.getByLabelText('Serie de facturas'), { target: { value: 's-1' } });
  fireEvent.change(screen.getByLabelText('IGIC por defecto (%)'), { target: { value: '7' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar datos' }));
  await screen.findByText('Datos de facturación guardados.');
  const put = calls.find((call) => call.options.method === 'PUT');
  const body = JSON.parse(put.options.body);
  assert.equal(body.defaultIgicBasisPoints, 700); assert.equal(body.issuerName, 'Emisor Sintético S.L.'); assert.equal(body.defaultSeriesId, 's-1');
  fireEvent.change(screen.getByLabelText('IGIC por defecto (%)'), { target: { value: 'siete' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar datos' }));
  assert.match((await screen.findByRole('alert')).textContent, /porcentaje entre 0 y 100/);
  assert.equal(calls.filter((call) => call.options.method === 'PUT').length, 1);
});

test('the logo upload checks the size in the browser, maps server refusals to plain Spanish and never shows a storage key', async () => {
  let refusal = null;
  globalThis.fetch = async (url, options = {}) => options.method === 'PUT' && String(url).endsWith('/logo') ? (refusal ? response({ error: refusal }, 422) : response({ hasLogo: true })) : response(settings({ hasLogo: true, logoMime: 'image/png', missing: [] }));
  render(React.createElement(InvoiceSettingsPanel));
  assert.ok(await screen.findByText('Listo para emitir'));
  assert.match(screen.getByAltText('Logo actual de las facturas').getAttribute('src'), /\/api\/economics\/invoice-settings\/logo\?v=/);
  const input = screen.getByLabelText('Subir logo');
  const big = new File(['x'], 'big.png'); Object.defineProperty(big, 'size', { value: 600 * 1024 });
  fireEvent.change(input, { target: { files: [big] } });
  assert.equal((await screen.findByRole('alert')).textContent, 'El logo supera los 512 KB.');
  refusal = 'unsafe_svg';
  fireEvent.change(input, { target: { files: [new File(['<svg/>'], 'logo.svg')] } });
  await waitFor(() => assert.match(screen.getByRole('alert').textContent, /elementos no permitidos/));
  assert.equal(/logoKey|invoice-logos\//.test(document.body.innerHTML), false);
});

test('a profile that can only read sees the data without edit controls', async () => {
  globalThis.fetch = async () => response(settings({ canManage: false, issuerName: 'Emisor', missing: [] }));
  render(React.createElement(InvoiceSettingsPanel));
  await screen.findByText(/puede consultar estos datos pero no cambiarlos/);
  assert.equal(screen.getByLabelText('Nombre o razón social').disabled, true);
  assert.equal(screen.queryByRole('button', { name: 'Guardar datos' }), null); assert.equal(screen.queryByLabelText('Subir logo'), null);
});

test('a charge without documents offers invoice and ticket; a missing issuer or client data is explained instead of failing silently', async () => {
  const calls = [];
  let issued = false;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method ?? 'GET', body: options.body });
    if (options.method === 'POST') return issued ? response(doc('1'), 201) : response({ error: 'issuer_incomplete', missing: ['NIF', 'serie de numeración'] }, 409);
    return response({ items: issued ? [doc('1')] : [], canIssue: true });
  };
  render(React.createElement(InvoiceDialog, { chargeId: 'c-1', title: 'María · Cuota octubre', onClose: () => {} }));
  const dialog = await screen.findByRole('dialog', { name: 'Factura y ticket' });
  assert.ok(within(dialog).getByText('María · Cuota octubre'));
  await within(dialog).findByText('Este cargo no tiene factura ni ticket.');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Emitir factura' }));
  assert.match((await within(dialog).findByRole('alert')).textContent, /Faltan datos del emisor.*Falta: NIF, serie de numeración\./);
  issued = true;
  fireEvent.click(within(dialog).getByRole('button', { name: 'Emitir ticket' }));
  assert.ok(await within(dialog).findByText('Factura F-1'));
  assert.deepEqual(JSON.parse(calls.filter((call) => call.method === 'POST').at(-1).body), { documentType: 'simplified_ticket' });
  assert.equal(within(dialog).queryByRole('button', { name: 'Emitir factura' }), null, 'a documented charge is not offered again');
});

test('issued documents download or print as PDF, and a rectification needs a reason and references the original', async () => {
  const calls = [];
  let rectified = false;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method ?? 'GET', body: options.body });
    if (options.method === 'POST') { rectified = true; return response({ id: '2', documentNumber: 'F-2', status: 'rectified' }, 201); }
    return response({ items: rectified ? [doc('1', { isRectified: true }), doc('2', { status: 'rectified', documentNumber: 'F-2', grossCents: -10300 })] : [doc('1')], canIssue: true });
  };
  render(React.createElement(InvoiceDialog, { chargeId: 'c-1', title: 'Cuota', onClose: () => {} }));
  const list = await screen.findByRole('list', { name: 'Documentos del cargo' });
  assert.equal(within(list).getByRole('link', { name: 'Descargar' }).getAttribute('href'), 'http://127.0.0.1:3100/api/economics/documents/1/pdf?variant=a4');
  assert.equal(within(list).getByRole('link', { name: 'Ticket' }).getAttribute('href'), 'http://127.0.0.1:3100/api/economics/documents/1/pdf?variant=ticket');
  let opened = null; dom.window.open = (target) => { opened = target; return {}; };
  fireEvent.click(within(list).getByRole('button', { name: 'Imprimir' }));
  assert.equal(opened, 'http://127.0.0.1:3100/api/economics/documents/1/pdf?variant=a4');
  fireEvent.click(within(list).getByRole('button', { name: 'Rectificar' }));
  const submit = screen.getByRole('button', { name: 'Emitir rectificativa' });
  assert.equal(submit.disabled, true, 'a reason is required');
  fireEvent.change(screen.getByLabelText('Motivo de la rectificación'), { target: { value: 'Importe mal cobrado' } });
  fireEvent.click(submit);
  await waitFor(() => assert.ok(screen.getByText('Rectificativa F-2')));
  const post = calls.find((call) => call.method === 'POST');
  assert.equal(post.url, 'http://127.0.0.1:3100/api/economics/documents/1/rectify'); assert.deepEqual(JSON.parse(post.body), { reason: 'Importe mal cobrado' });
  assert.equal(screen.queryByRole('button', { name: 'Rectificar' }), null, 'a rectified document and a rectification cannot be rectified again');
});

test('a profile without invoice permission only gets a calm message', async () => {
  globalThis.fetch = async () => response({}, 403);
  render(React.createElement(InvoiceDialog, { chargeId: 'c-1', title: 'Cuota', onClose: () => {} }));
  assert.ok(await screen.findByText('Tu perfil no puede consultar facturas.'));
  assert.equal(screen.queryByRole('button', { name: /Emitir/ }), null);
});
