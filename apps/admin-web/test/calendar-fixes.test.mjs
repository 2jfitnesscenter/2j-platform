import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174/#calendar' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { CalendarPage } = await import('../src/calendar-page.tsx');
afterEach(() => { cleanup(); globalThis.fetch = undefined; delete window.matchMedia; });
after(() => dom.window.close());

const area = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'El Búnker' };
const service = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Acondicionamiento', areaId: area.id };
const irene = { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', displayName: 'Irene Díaz', calendarColor: null };
const response = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const now = new Date(); const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate()); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
const key = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const caps = (overrides = {}) => ({ manage: true, attendance: true, overrideCapacity: false, overrideAvailability: true, overrideDocuments: false, ...overrides });
const week = (sessions = [], capabilities = caps()) => ({ weekStart: key(monday), timezone: 'Atlantic/Canary', sessions, areas: [area], services: [service], professionals: [irene], templates: [], capabilities });
const wide = () => { window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} }); };

async function openCreate({ capabilities, onPost }) {
  wide();
  const posts = [];
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.includes('/api/calendar/week')) return response(week([], capabilities));
    if (path.endsWith('/api/calendar/sessions') && options.method === 'POST') { const body = JSON.parse(options.body); posts.push(body); return onPost(body, posts.length); }
    throw new Error(`Unexpected ${options.method ?? 'GET'} ${path}`);
  };
  render(React.createElement(CalendarPage));
  fireEvent.click(await screen.findByRole('button', { name: 'Nueva sesión' }));
  const dialog = await screen.findByRole('dialog', { name: 'Nueva sesión' });
  fireEvent.change(within(dialog).getByLabelText('Servicio'), { target: { value: service.id } });
  fireEvent.change(within(dialog).getByLabelText('Profesional'), { target: { value: irene.id } });
  return { dialog, posts };
}
const needsException = () => response({ error: 'professional_availability_confirmation_required', warnings: ['outside_working_hours'] }, 409);

test('the create-session form no longer shows an availability checkbox or exception reason by default', async () => {
  const { dialog } = await openCreate({ onPost: () => response({ id: 's' }, 201) });
  assert.ok(within(dialog).queryByLabelText(/Confirmación de disponibilidad/) === null);
  assert.ok(within(dialog).queryByLabelText(/Motivo de (la )?excepción/) === null);
});

test('a session inside availability is created with overrideAvailability=false and no reason', async () => {
  const { dialog, posts } = await openCreate({ onPost: () => response({ id: 's1' }, 201) });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Crear sesión' }));
  await waitFor(() => assert.equal(posts.length, 1));
  assert.equal(posts[0].overrideAvailability, false);
  assert.ok(!Object.hasOwn(posts[0], 'availabilityReason'));
  assert.equal(posts[0].professionalId, irene.id);
});

test('outside availability: the server prevalidates (409 + warnings), the reason appears, and an empty reason never reaches the server', async () => {
  const { dialog, posts } = await openCreate({ onPost: (body) => body.overrideAvailability ? response({ id: 's2' }, 201) : needsException() });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Crear sesión' }));
  const alert = await within(dialog).findByText('Esta sesión queda fuera de la disponibilidad del profesional.');
  assert.ok(alert);
  assert.ok(within(dialog).getByText('Fuera del horario habitual'));
  assert.equal(posts.length, 1, 'only the prevalidating request so far');
  assert.equal(posts[0].overrideAvailability, false);
  const reason = within(dialog).getByLabelText(/Motivo de la excepción/);
  assert.equal(reason.required, true);
  assert.match(within(dialog).getByText(/Solo se usa para confirmar esta excepción de disponibilidad/).textContent, /queda registrado/);
  const submit = within(dialog).getByRole('button', { name: 'Crear sesión con excepción' });
  assert.equal(submit.disabled, true, 'blocked until a reason of at least 3 characters exists');
  fireEvent.submit(dialog.querySelector('form'));
  fireEvent.change(reason, { target: { value: 'ab' } });
  assert.equal(submit.disabled, true);
  fireEvent.submit(dialog.querySelector('form'));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(posts.length, 1, 'no override request is sent with an empty or too short reason');
});

test('outside availability with a valid reason sends overrideAvailability=true and the trimmed reason', async () => {
  const { dialog, posts } = await openCreate({ onPost: (body) => body.overrideAvailability ? response({ id: 's3' }, 201) : needsException() });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Crear sesión' }));
  await within(dialog).findByText('Esta sesión queda fuera de la disponibilidad del profesional.');
  fireEvent.change(within(dialog).getByLabelText(/Motivo de la excepción/), { target: { value: '  Sábado solicitado por la dirección  ' } });
  const submit = within(dialog).getByRole('button', { name: 'Crear sesión con excepción' });
  assert.equal(submit.disabled, false);
  fireEvent.click(submit);
  await waitFor(() => assert.equal(posts.length, 2));
  assert.equal(posts[1].overrideAvailability, true);
  assert.equal(posts[1].availabilityReason, 'Sábado solicitado por la dirección');
  await waitFor(() => assert.ok(screen.queryByRole('dialog') === null));
});

test('changing the session data discards a stale exception request', async () => {
  const { dialog } = await openCreate({ onPost: () => needsException() });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Crear sesión' }));
  await within(dialog).findByText('Esta sesión queda fuera de la disponibilidad del profesional.');
  fireEvent.change(within(dialog).getByLabelText('Profesional'), { target: { value: '' } });
  assert.ok(within(dialog).queryByText('Esta sesión queda fuera de la disponibilidad del profesional.') === null);
});

test('without permission to override availability the exception cannot be confirmed', async () => {
  const { dialog, posts } = await openCreate({ capabilities: caps({ overrideAvailability: false }), onPost: () => needsException() });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Crear sesión' }));
  await within(dialog).findByText(/Tu perfil no puede confirmar excepciones de disponibilidad/);
  assert.ok(within(dialog).queryByLabelText(/Motivo de la excepción/) === null);
  assert.equal(within(dialog).getByRole('button', { name: 'Crear sesión con excepción' }).disabled, true);
  assert.equal(posts.length, 1);
});

test('real server error codes show specific copy instead of the generic failure', async () => {
  const cases = [
    [{ error: 'professional_session_conflict' }, 409, 'Ese profesional ya tiene otra sesión en ese horario.'],
    [{ error: 'internal_error' }, 500, 'El servicio ha tenido un fallo. Inténtalo de nuevo en unos minutos.'],
    [{ error: 'validation_error', details: { formErrors: [], fieldErrors: { availabilityReason: ['String must contain at least 3 character(s)', 'Indica el motivo de la excepción.'] } } }, 400, 'Indica el motivo de la excepción.'],
    [{ error: 'validation_error', details: { formErrors: [], fieldErrors: { durationMinutes: ['Number must be greater than or equal to 5'] } } }, 400, 'Revisa los datos del formulario: alguno falta o no es válido.'],
    [{ error: 'service_archived' }, 409, 'El servicio ya no está disponible para reservas.'],
  ];
  for (const [body, status, copy] of cases) {
    const { dialog } = await openCreate({ onPost: () => response(body, status) });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear sesión' }));
    const alert = await within(dialog).findByRole('alert');
    assert.equal(alert.textContent, copy);
    assert.doesNotMatch(alert.textContent, /No se pudo completar la operación/);
    cleanup();
  }
});

test('capacity consistency: an empty 0/8 session whose booking preview reports session_started says so and never "completa"', async () => {
  wide();
  const session = { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', serviceId: service.id, serviceName: service.name, areaId: area.id, areaName: area.name, templateId: null, source: 'template', startsAt: `${key(monday)}T07:00:00.000Z`, durationMinutes: 45, capacity: 8, status: 'scheduled', isIndividual: false, occupiedCount: 0, overbookCount: 0, waitlistCount: 0, professionalId: irene.id, professionalName: 'Nora Vega' };
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.includes('/api/calendar/week')) return response(week([session]));
    if (path.endsWith(`/api/calendar/sessions/${session.id}/attendees`)) return response({ reservations: [], waitlist: [] });
    if (path.includes('/api/clients?')) return response({ items: [{ id: 'c1', firstName: 'María', lastName: 'González' }] });
    if (path.includes('/booking-eligibility')) return response({ allowed: false, decision: 'blocked', blockingReasons: ['session_started'], selectedEntitlement: null, availableAlternatives: [], capacity: null, waitlistAllowed: false, overridePossible: { debt: false, documents: false, capacity: false }, requiredDocuments: [] });
    throw new Error(`Unexpected ${path}`);
  };
  render(React.createElement(CalendarPage));
  fireEvent.click(await screen.findByRole('button', { name: /Acondicionamiento/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Acondicionamiento' });
  assert.equal(dialog.querySelector('.session-capacity-summary').textContent.replace(/\s+/g, ' ').trim(), '0Ocupadas8Disponibles0En espera');
  const picker = within(dialog).getByRole('combobox', { name: 'Buscar cliente' });
  fireEvent.change(picker, { target: { value: 'María' } });
  await within(dialog).findByRole('option', { name: 'María González' });
  fireEvent.keyDown(picker, { key: 'ArrowDown' }); fireEvent.keyDown(picker, { key: 'Enter' });
  assert.ok(await within(dialog).findByText('La sesión ya ha empezado y no admite nuevas reservas.'));
  assert.ok(within(dialog).queryByText('La sesión está completa.') === null, 'the contradiction is gone because the source no longer reports session_full');
});

test('a contradictory preview (0/8 on the agenda, session_full with capacity 0/8 available) would surface both facts instead of hiding either', async () => {
  wide();
  const session = { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', serviceId: service.id, serviceName: service.name, areaId: area.id, areaName: area.name, templateId: null, source: 'manual', startsAt: `${key(monday)}T07:00:00.000Z`, durationMinutes: 45, capacity: 8, status: 'scheduled', isIndividual: false, occupiedCount: 0, overbookCount: 0, waitlistCount: 0 };
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.includes('/api/calendar/week')) return response(week([session]));
    if (path.endsWith('/attendees')) return response({ reservations: [], waitlist: [] });
    if (path.includes('/api/clients?')) return response({ items: [{ id: 'c1', firstName: 'María', lastName: 'González' }] });
    if (path.includes('/booking-eligibility')) return response({ allowed: false, decision: 'blocked', blockingReasons: ['session_full'], selectedEntitlement: null, availableAlternatives: [], capacity: { occupied: 8, limit: 8, available: 0 }, waitlistAllowed: false, overridePossible: { debt: false, documents: false, capacity: true }, requiredDocuments: [] });
    throw new Error(`Unexpected ${path}`);
  };
  render(React.createElement(CalendarPage));
  fireEvent.click(await screen.findByRole('button', { name: /Acondicionamiento/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Acondicionamiento' });
  const picker = within(dialog).getByRole('combobox', { name: 'Buscar cliente' });
  fireEvent.change(picker, { target: { value: 'María' } });
  await within(dialog).findByRole('option', { name: 'María González' });
  fireEvent.keyDown(picker, { key: 'ArrowDown' }); fireEvent.keyDown(picker, { key: 'Enter' });
  await within(dialog).findByText('La sesión está completa.');
  assert.match(dialog.querySelector('.session-capacity-summary').textContent, /0Ocupadas8Disponibles/, 'the agenda counts stay visible; the contradiction is not painted over');
});
