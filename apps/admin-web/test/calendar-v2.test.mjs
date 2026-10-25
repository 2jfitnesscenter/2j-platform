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

const area = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'La Sala' };
const response = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const now = new Date(); const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate()); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
const key = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const capabilities = { manage: true, attendance: true, overrideCapacity: false, overrideAvailability: true, overrideDocuments: false };
const baseData = { weekStart: key(monday), timezone: 'Atlantic/Canary', sessions: [], areas: [area], services: [], templates: [], professionals: [], capabilities };
const startsAt = `${baseData.weekStart}T17:00:00.000Z`;
const session = (n, overrides = {}) => ({ id: `s-${n}`, serviceId: `service-${n}`, serviceName: `Servicio ${n}`, areaId: area.id, areaName: area.name, templateId: null, source: 'manual', startsAt, durationMinutes: 60, capacity: 8, status: 'scheduled', isIndividual: false, occupiedCount: 3, overbookCount: 0, waitlistCount: 0, professionalId: `staff-${n}`, professionalName: `Profesional ${n}`, ...overrides });
const serve = (sessions, caps = capabilities) => {
  const services = [...new Map(sessions.map(item => [item.serviceId, { id: item.serviceId, name: item.serviceName, areaId: item.areaId }])).values()];
  const professionals = [...new Map(sessions.filter(item => item.professionalId).map(item => [item.professionalId, { id: item.professionalId, displayName: item.professionalName, calendarColor: null }])).values()];
  globalThis.fetch = async (url) => String(url).includes('/api/calendar/week') ? response({ ...baseData, sessions, services, professionals, capabilities: caps }) : String(url).includes('/attendees') ? response({ reservations: [], waitlist: [] }) : response({});
};
const wide = () => { window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} }); };
const narrow = () => { window.matchMedia = (query) => ({ matches: /1120/.test(query), addEventListener() {}, removeEventListener() {} }); };
const mount = async () => { render(React.createElement(CalendarPage)); await screen.findByRole('group', { name: 'Vista de agenda' }); await waitFor(() => assert.ok(document.querySelector('.session-card, .day-empty'))); };
const cardsIn = (selector) => document.querySelectorAll(`${selector} .session-card`).length;

test('SessionCard is minimal: time, service, load and a fill bar, with no participants, notes, rules or action buttons', async () => {
  wide(); serve([session(1, { occupiedCount: 6, capacity: 10, waitlistCount: 4 })]);
  await mount();
  const card = document.querySelector('.week-view .session-card');
  assert.deepEqual([...card.children].map((node) => node.className), ['session-time', '', 'seat-count', 'session-fill']);
  assert.equal(card.querySelector('.seat-count').textContent, '6/10');
  assert.equal(card.querySelector('.session-fill > span').style.width, '60%');
  assert.doesNotMatch(card.textContent, /espera|nota|regla|derecho|Reservar|Cancelar/i, 'no waitlist, notes, rules, rights or buttons on the card');
  assert.equal(card.querySelectorAll('button').length, 0);
  assert.ok(card.querySelector('.session-pro') === null, 'week cards are too narrow for the professional');
  fireEvent.click(screen.getByRole('button', { name: 'Día' }));
  assert.equal(document.querySelector('.day-view .session-pro').textContent, 'Profesional 1', 'the day card shows the professional when there is room');
});

test('a full session says "Lleno" in text and fills the bar; cancelled stays distinct without a fill', async () => {
  wide(); serve([session(1, { occupiedCount: 8, capacity: 8 }), session(2, { status: 'cancelled', occupiedCount: 0 })]);
  await mount();
  const full = screen.getByRole('button', { name: /Servicio 1/ });
  assert.match(full.textContent, /8\/8Lleno/);
  assert.equal(full.querySelector('.session-fill > span').style.width, '100%');
  const cancelled = screen.getByRole('button', { name: /Servicio 2.*cancelada/ });
  assert.ok(cancelled.classList.contains('cancelled'));
  assert.doesNotMatch(cancelled.textContent, /Lleno/);
});

test('2, 3 and 5 simultaneous sessions are real cards; the extra ones go to a separate list, never a +N pill', async () => {
  wide();
  for (const total of [2, 3, 5]) {
    serve(Array.from({ length: total }, (_, index) => session(index + 1)));
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Día' }));
    const shownDay = cardsIn('.day-view');
    assert.equal(shownDay, Math.min(total, 4), `day view shows up to 4 parallel cards (${total} simultaneous)`);
    fireEvent.click(screen.getByRole('button', { name: 'Semana' }));
    const shownWeek = cardsIn('.week-view');
    assert.equal(shownWeek, Math.min(total, 2), `week view shows up to 2 parallel cards (${total} simultaneous)`);
    const extra = total - shownWeek;
    const overflow = document.querySelector('.calendar-overflow');
    if (extra === 0) assert.equal(overflow, null);
    else assert.match(overflow.querySelector('summary').textContent, new RegExp(`Ver ${extra} ${extra === 1 ? 'sesión simultánea adicional' : 'sesiones simultáneas adicionales'}`));
    assert.ok(screen.queryByText(/\+\d+ sesión/) === null, 'no +N pill glued to a card');
    cleanup();
  }
});

test('overflowing simultaneous sessions stay reachable and open the same detail', async () => {
  wide(); serve(Array.from({ length: 5 }, (_, index) => session(index + 1)));
  await mount();
  const overflow = document.querySelector('.calendar-overflow');
  overflow.open = true;
  fireEvent.click(within(overflow).getByRole('button', { name: /Servicio 5/ }));
  assert.ok(await screen.findByRole('dialog', { name: 'Servicio 5' }));
});

test('opening a session shows its detail as a dialog (side drawer on desktop) and Cerrar returns to the agenda', async () => {
  wide(); serve([session(1)]);
  await mount();
  fireEvent.click(screen.getByRole('button', { name: /Servicio 1/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Servicio 1' });
  assert.ok(dialog.classList.contains('session-dialog'));
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar detalle' }));
  await waitFor(() => assert.ok(screen.queryByRole('dialog') === null));
});

test('narrow screens default to Día, disable Semana with a reason, and show the day strip', async () => {
  narrow(); serve([session(1)]);
  await mount();
  const week = screen.getByRole('button', { name: 'Semana' });
  assert.equal(week.disabled, true);
  assert.match(week.getAttribute('title'), /selector de días/);
  assert.equal(screen.getByRole('button', { name: 'Día' }).getAttribute('aria-pressed'), 'true');
  assert.ok(document.querySelector('.week-strip.is-visible'));
  assert.ok(screen.getByRole('tablist', { name: 'Días de la semana' }));
});

test('service, professional and status filters combine; clearing them restores the full agenda', async () => {
  wide();
  serve([
    session(1, { serviceId: 'service-yoga', serviceName: 'Yoga', professionalId: 'staff-ana', professionalName: 'Ana', waitlistCount: 2 }),
    session(2, { serviceId: 'service-yoga', serviceName: 'Yoga', professionalId: 'staff-luis', professionalName: 'Luis', startsAt: new Date(Date.parse(startsAt) + 60 * 60_000).toISOString(), occupiedCount: 8, capacity: 8 }),
    session(3, { serviceId: 'service-fuerza', serviceName: 'Fuerza', professionalId: 'staff-ana', professionalName: 'Ana', startsAt: new Date(Date.parse(startsAt) + 120 * 60_000).toISOString(), status: 'cancelled' }),
  ]);
  await mount();
  assert.equal(cardsIn('.week-view'), 3);
  fireEvent.change(screen.getByLabelText('Servicio'), { target: { value: 'service-yoga' } });
  assert.equal(cardsIn('.week-view'), 2, 'service narrows the agenda');
  fireEvent.change(screen.getByLabelText('Profesional'), { target: { value: 'staff-ana' } });
  assert.equal(cardsIn('.week-view'), 1, 'professional combines with service');
  assert.ok(screen.getByRole('button', { name: /Yoga/ }));
  fireEvent.change(screen.getByLabelText('Filtrar sesiones'), { target: { value: 'waitlist' } });
  assert.equal(cardsIn('.week-view'), 1, 'status combines with both catalog filters');
  fireEvent.change(screen.getByLabelText('Filtrar sesiones'), { target: { value: 'cancelled' } });
  assert.equal(cardsIn('.week-view'), 0, 'cancelled sessions outside the selected service/professional stay hidden');
  assert.ok(screen.getAllByText('Sin sesiones para este filtro').length > 0);
  fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
  assert.equal(cardsIn('.week-view'), 3, 'reset restores all sessions');
  assert.equal(screen.getByLabelText('Servicio').value, '');
  assert.equal(screen.getByLabelText('Profesional').value, '');
  assert.equal(screen.getByLabelText('Filtrar sesiones').value, 'all');
});

test('permissions: without manage the agenda offers no creation, editing or template actions', async () => {
  wide(); serve([session(1)], { ...capabilities, manage: false, attendance: false });
  await mount();
  for (const name of ['Nueva sesión', 'Nueva plantilla', 'Configurar horarios']) assert.ok(screen.queryByRole('button', { name }) === null, `${name} is absent`);
  fireEvent.click(screen.getByRole('button', { name: /Servicio 1/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Servicio 1' });
  assert.ok(within(dialog).queryByRole('button', { name: 'Editar esta sesión' }) === null);
  assert.ok(within(dialog).queryByRole('button', { name: /Cancelar sesión/ }) === null);
});

test('manage: exactly one primary action in the header and the toolbar keeps keyboard-labelled week navigation', async () => {
  wide(); serve([]);
  render(React.createElement(CalendarPage));
  await screen.findByRole('group', { name: 'Vista de agenda' });
  assert.equal(document.querySelectorAll('.ui-page-header .ui-button--primary').length, 1);
  assert.match(screen.getByRole('button', { name: 'Nueva sesión' }).className, /ui-button--primary/);
  assert.ok(screen.getByRole('button', { name: 'Semana anterior' }));
  assert.ok(screen.getByRole('button', { name: 'Semana siguiente' }));
  assert.ok(screen.getByRole('button', { name: 'Hoy' }));
});

test('Sala filter lists every area, narrows the agenda, combines with the others and the filters follow the Base44 order (Servicio, Sala, Profesional, estado)', async () => {
  const studio = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'El Estudio' };
  wide();
  const later = (hours) => new Date(Date.parse(startsAt) + hours * 60 * 60_000).toISOString();
  const sessions = [session(1), session(2, { areaId: studio.id, areaName: studio.name, startsAt: later(2) }), session(3, { areaId: studio.id, areaName: studio.name, serviceId: 'service-1', serviceName: 'Servicio 1', startsAt: later(4) })];
  const services = [{ id: 'service-1', name: 'Servicio 1', areaId: area.id }, { id: 'service-2', name: 'Servicio 2', areaId: studio.id }];
  globalThis.fetch = async (url) => String(url).includes('/api/calendar/week') ? response({ ...baseData, areas: [area, studio], sessions, services }) : response({});
  await mount();
  const labels = [...document.querySelectorAll('.calendar-filter-bar label')].map((label) => label.textContent);
  assert.deepEqual(labels.slice(0, 4), ['Servicio', 'Sala', 'Profesional', 'Filtrar sesiones']);
  const select = screen.getByLabelText('Sala');
  assert.deepEqual([...select.options].map((option) => option.textContent), ['Todas las salas', 'La Sala', 'El Estudio']);
  assert.equal(cardsIn('.week-view'), 3);
  fireEvent.change(select, { target: { value: studio.id } });
  assert.equal(cardsIn('.week-view'), 2, 'only the sessions of that room');
  fireEvent.change(screen.getByLabelText('Servicio'), { target: { value: 'service-1' } });
  assert.equal(cardsIn('.week-view'), 1, 'room combines with service');
  fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
  assert.equal(cardsIn('.week-view'), 3);
  assert.equal(screen.getByLabelText('Sala').value, '');
});
