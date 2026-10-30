import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5173/#invitations' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { InvitationsPage } = await import('../src/invitations-page.tsx');
afterEach(() => { cleanup(); globalThis.fetch = undefined; });
after(() => dom.window.close());
const item = { id: 'case-1', personId: 'ignored-by-ui', reason: 'lost_device', memberNote: 'Perdió su llave de acceso.', status: 'open', createdAt: '2026-10-30T09:00:00Z', person: { displayName: 'Cliente Sintético' } };
const response = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

test('muestra la cola H13 real y deja claro que aprobar no activa el vínculo Búnker', async () => {
  globalThis.fetch = async url => String(url).includes('/training-link-review?') ? response({ v: 1, cases: [item] }) : String(url).includes('/case-1') ? response({ v: 1, case: item, events: [{ action: 'opened', actor: 'person:private-id', occurredAt: item.createdAt }] }) : response({});
  render(React.createElement(InvitationsPage));
  assert.ok(await screen.findByText('Cliente Sintético'));
  assert.ok(screen.getByText('Esta bandeja registra revisiones H13. No envía invitaciones, no crea cuentas en Búnker y una aprobación no activa el vínculo ni el acceso.'));
  assert.equal(screen.queryByText('ignored-by-ui'), null);
  fireEvent.click(screen.getByRole('button', { name: /Cliente Sintético/ }));
  assert.ok(await screen.findByText('Perdió su llave de acceso.'));
  fireEvent.click(screen.getByRole('button', { name: 'Aprobar revisión' }));
  const dialog = await screen.findByRole('dialog', { name: 'Aprobar revisión' });
  assert.ok(within(dialog).getByText(/no enlaza ni activa la cuenta de Búnker/));
});

test('resolución aprobada envía los campos obligatorios a la API sin crear un vínculo desde la UI', async () => {
  const requests = [];
  let resolved = false;
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/training-link-review?')) return response({ v: 1, cases: [item] });
    if (String(url).endsWith('/case-1/resolve')) { resolved = true; return response({ v: 1, id: item.id, status: 'approved', replay: false, nextStep: 'admin_link' }); }
    if (String(url).endsWith('/case-1')) return response({ v: 1, case: { ...item, status: resolved ? 'approved' : 'open' }, events: [{ action: 'opened', actor: 'private', occurredAt: item.createdAt }, ...(resolved ? [{ action: 'approved', actor: 'private', occurredAt: item.createdAt }] : [])] });
    return response({});
  };
  render(React.createElement(InvitationsPage));
  fireEvent.click(await screen.findByRole('button', { name: /Cliente Sintético/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Aprobar revisión' }));
  const dialog = await screen.findByRole('dialog', { name: 'Aprobar revisión' });
  fireEvent.change(within(dialog).getByLabelText('Identificador de la cuenta Búnker verificada'), { target: { value: 'bunker-user-synthetic-17' } });
  fireEvent.change(within(dialog).getByLabelText(/Motivo de la decisión/), { target: { value: 'Verificada presencialmente con documento mostrado.' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar resolución' }));
  await screen.findByText('Revisión aprobada y auditada. Esto no crea la cuenta ni activa el acceso a Búnker.');
  const resolve = requests.find(request => request.url.endsWith('/case-1/resolve'));
  assert.deepEqual(JSON.parse(resolve.init.body), { action: 'approve', note: 'Verificada presencialmente con documento mostrado.', trainingUserId: 'bunker-user-synthetic-17', verification: { method: 'in_person' } });
  assert.equal(requests.some(request => request.url.endsWith('/training-link') || request.url.includes('/training-link-transactions')), false);
});

test('la bandeja presenta denegación y fallo con mensajes comprensibles y opción de reintento', async () => {
  globalThis.fetch = async () => response({ error: 'permission_denied' }, 403);
  const { unmount } = render(React.createElement(InvitationsPage));
  assert.ok(await screen.findByText('Tu perfil no puede revisar vinculaciones'));
  unmount();
  globalThis.fetch = async () => response({ error: 'internal_error' }, 500);
  render(React.createElement(InvitationsPage));
  assert.ok(await screen.findByText('No se pudo cargar la bandeja'));
  assert.ok(screen.getByRole('button', { name: 'Reintentar' }));
});
