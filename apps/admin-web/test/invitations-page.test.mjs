import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5173/#invitations' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { InvitationsPage } = await import('../src/invitations-page.tsx');
const { ProfessionalCapabilitiesProvider } = await import('../src/app-shell.tsx');
afterEach(() => { cleanup(); globalThis.fetch = undefined; });
after(() => dom.window.close());
const item = { id: 'case-1', personId: 'ignored-by-ui', reason: 'lost_device', memberNote: 'Perdió su llave de acceso.', status: 'open', createdAt: '2026-10-30T09:00:00Z', person: { displayName: 'Cliente Sintético' } };
const response = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const caps = (values = {}) => ({ linkReviewManage: true, memberInvitationManage: true, ...values });
const renderPage = (capabilities = caps()) => render(React.createElement(ProfessionalCapabilitiesProvider, { capabilities, children: React.createElement(InvitationsPage) }));

test('muestra la cola H13 real y deja claro que aprobar no activa el vínculo Búnker', async () => {
  globalThis.fetch = async url => String(url).includes('/member-invitations') ? response({ v: 1, invitations: [] }) : String(url).includes('/training-link-review?') ? response({ v: 1, cases: [item] }) : String(url).includes('/case-1') ? response({ v: 1, case: item, events: [{ action: 'opened', actor: 'person:private-id', occurredAt: item.createdAt }] }) : response({});
  renderPage();
  assert.ok(await screen.findByText('Cliente Sintético'));
  assert.ok(screen.getByText(/La invitación no crea una identidad ni una cuenta Búnker/));
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
    if (String(url).includes('/member-invitations')) return response({ v: 1, invitations: [] });
    if (String(url).includes('/training-link-review?')) return response({ v: 1, cases: [item] });
    if (String(url).endsWith('/case-1/resolve')) { resolved = true; return response({ v: 1, id: item.id, status: 'approved', replay: false, nextStep: 'admin_link' }); }
    if (String(url).endsWith('/case-1')) return response({ v: 1, case: { ...item, status: resolved ? 'approved' : 'open' }, events: [{ action: 'opened', actor: 'private', occurredAt: item.createdAt }, ...(resolved ? [{ action: 'approved', actor: 'private', occurredAt: item.createdAt }] : [])] });
    return response({});
  };
  renderPage();
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
  const { unmount } = renderPage();
  assert.ok(await screen.findByText('Tu perfil no puede revisar vinculaciones'));
  unmount();
  globalThis.fetch = async () => response({ error: 'internal_error' }, 500);
  renderPage({ linkReviewManage: true, memberInvitationManage: false });
  assert.ok(await screen.findByText('No se pudo cargar la bandeja'));
  assert.ok(screen.getByRole('button', { name: 'Reintentar' }));
});

test('solo crea invitación con permiso propio y revela el código recibido una vez sin persistirlo en UI', async () => {
  const secret = 'synthetic-once-only-token-not-a-real-credential';
  const invitation = { id: 'invite-1', createdBy: 'synthetic-admin', createdAt: '2026-10-30T09:00:00Z', expiresAt: '2026-10-31T09:00:00Z', status: 'pending' };
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/member-invitations')) {
      if (init.method === 'POST') return response({ v: 1, invitation, secret }, 201);
      return response({ v: 1, invitations: [invitation] });
    }
    return response({ error: 'not_used' }, 404);
  };
  renderPage({ linkReviewManage: false, memberInvitationManage: true });
  fireEvent.click(await screen.findByRole('button', { name: 'Crear invitación' }));
  assert.ok(await screen.findByText('synthetic-once-only-token-not-a-real-credential'));
  assert.ok(screen.getByText(/El canje autenticado, la entrega al socio y la activación bilateral/));
  const creation = requests.find(request => request.init.method === 'POST');
  assert.deepEqual(JSON.parse(creation.init.body), {});
  assert.equal(creation.url.includes('email'), false);
  assert.equal(requests.some(request => request.url.includes('/training-provision') || request.url.endsWith('/training-link')), false);
  fireEvent.click(screen.getByRole('button', { name: 'Ocultar código' }));
  assert.equal(screen.queryByText(secret), null);
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
  await waitFor(() => assert.ok(requests.filter(request => request.url.includes('/member-invitations')).length >= 3));
  assert.equal(screen.queryByText(secret), null, 'list and refresh never recover the one-time secret');
});

test('la revocación pide motivo, usa el endpoint y elimina de la vista el secreto de esa invitación', async () => {
  const invitation = { id: 'invite-2', createdBy: 'synthetic-admin', createdAt: '2026-10-30T09:00:00Z', expiresAt: '2026-10-31T09:00:00Z', status: 'pending' };
  const requests = [];
  let status = 'pending';
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith('/revoke')) { status = 'revoked'; return response({ v: 1, invitation: { id: invitation.id, status } }); }
    if (String(url).includes('/member-invitations')) return response({ v: 1, invitations: [{ ...invitation, status }] });
    return response({ v: 1, cases: [] });
  };
  renderPage({ linkReviewManage: false, memberInvitationManage: true });
  fireEvent.click(await screen.findByRole('button', { name: 'Revocar' }));
  const dialog = await screen.findByRole('dialog', { name: 'Revocar invitación' });
  fireEvent.change(within(dialog).getByLabelText(/Motivo/), { target: { value: 'La persona confirma que no debe utilizarse.' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Revocar' }));
  await waitFor(() => assert.equal(requests.some(request => request.url.endsWith('/invite-2/revoke')), true));
  const call = requests.find(request => request.url.endsWith('/invite-2/revoke'));
  assert.deepEqual(JSON.parse(call.init.body), { reason: 'La persona confirma que no debe utilizarse.' });
  assert.ok(await screen.findByText('Revocada'));
});

test('sin member.invitations.manage no aparecen acciones de emisión ni revocación', async () => {
  globalThis.fetch = async () => response({ v: 1, cases: [] });
  renderPage({ linkReviewManage: false, memberInvitationManage: false });
  await waitFor(() => assert.equal(screen.queryByRole('button', { name: 'Crear invitación' }), null));
  assert.equal(screen.queryByRole('button', { name: 'Revocar' }), null);
  assert.equal(screen.queryByText('Invitaciones emitidas'), null);
});
