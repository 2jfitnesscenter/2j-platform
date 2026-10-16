import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174/#calendar' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { CalendarPage } = await import('../src/calendar-page.tsx');
afterEach(() => { cleanup(); globalThis.fetch = undefined; delete window.matchMedia; });
after(() => dom.window.close());

const area = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'La Sala' };
const funcional = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Funcional', areaId: area.id };
const pilates = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Pilates', areaId: area.id };
const irene = { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', displayName: 'Irene Díaz', calendarColor: null };
const response = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
const now = new Date(); const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate()); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
const key = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const capabilities = { manage: true, attendance: true, overrideCapacity: false, overrideAvailability: true, overrideDocuments: false, overrideDebt: false };
const baseData = { weekStart: key(monday), timezone: 'Atlantic/Canary', sessions: [], areas: [area], services: [funcional, pilates], professionals: [irene], templates: [], capabilities };
const existing = (id, weekday, start, extra = {}) => ({ id, serviceId: funcional.id, serviceName: 'Funcional', areaId: area.id, areaName: area.name, professionalId: irene.id, professionalName: irene.displayName, weekday, localStartTime: `${start}:00`, durationMinutes: 60, capacity: 12, startsOn: baseData.weekStart, endsOn: null, ...extra });

function serve({ templates = [], onBatch, onArchive } = {}) {
  const posts = []; const archived = [];
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.includes('/api/calendar/week')) return response({ ...baseData, templates });
    if (path.endsWith('/api/calendar/templates/batch') && options.method === 'POST') {
      const body = JSON.parse(options.body); posts.push(body);
      if (onBatch) { const custom = onBatch(body, posts.length); if (custom) return custom; }
      return response({ templates: body.weekdays.map((weekday) => ({ id: `new-${posts.length}-${weekday}`, status: 'active' })), materializedCount: 4 }, 201);
    }
    const archive = /\/api\/calendar\/templates\/([^/]+)\/archive$/.exec(path);
    if (archive && options.method === 'PATCH') { archived.push(archive[1]); onArchive?.(archive[1]); return response({ status: 'archived' }); }
    throw new Error(`Unexpected request: ${options.method ?? 'GET'} ${path}`);
  };
  return { posts, archived };
}
const openEditor = async () => {
  render(React.createElement(CalendarPage));
  fireEvent.click(await screen.findByRole('button', { name: 'Configurar horarios' }));
  return screen.findByRole('dialog', { name: 'Configurar horarios' });
};
const formOf = (dialog) => within(dialog).getByRole('group', { name: /Añadir horario|Editar horario|Duplicar horario/ });
// Fills the "Añadir horario" form through the real controls and adds the draft to the list.
async function addDraft(dialog, { service = 'Funcional', days = ['Lunes'], time = '08:00', duration = '60', capacity = '12', professional = '', startsOn, endsOn } = {}) {
  fireEvent.click(within(dialog).getByRole('button', { name: 'Añadir horario' }));
  const form = formOf(dialog);
  const serviceId = [funcional, pilates].find((item) => item.name === service).id;
  fireEvent.change(within(form).getByLabelText('Servicio *'), { target: { value: serviceId } });
  for (const day of days) fireEvent.click(within(form).getByRole('button', { name: day }));
  fireEvent.change(within(form).getByLabelText('Hora de inicio *'), { target: { value: time } });
  if (['30', '45', '60', '75', '90'].includes(String(duration))) fireEvent.change(within(form).getByLabelText('Duración *'), { target: { value: String(duration) } });
  else { fireEvent.change(within(form).getByLabelText('Duración *'), { target: { value: 'custom' } }); fireEvent.change(within(form).getByLabelText('Duración personalizada (minutos)'), { target: { value: String(duration) } }); }
  fireEvent.change(within(form).getByLabelText('Plazas *'), { target: { value: String(capacity) } });
  if (professional) fireEvent.change(within(form).getByLabelText('Profesional'), { target: { value: professional } });
  if (startsOn) fireEvent.change(within(form).getByLabelText('Desde *'), { target: { value: startsOn } });
  if (endsOn) fireEvent.change(within(form).getByLabelText('Hasta (opcional)'), { target: { value: endsOn } });
  fireEvent.click(within(form).getByRole('button', { name: 'Añadir a la lista' }));
}
const blocks = (selector = '') => [...document.querySelectorAll(`.sched-block${selector}`)];
const counter = () => document.querySelector('[data-testid="schedule-counter"]').textContent;

test('the editor is list + form + read-only preview: no clickable grid cells, and the old controls are gone', async () => {
  serve();
  const dialog = await openEditor();
  assert.ok(within(dialog).getByRole('button', { name: 'Añadir horario' }));
  assert.equal(document.querySelectorAll('.schedule-grid-cell, .schedule-editor-grid').length, 0, 'direct grid creation removed');
  assert.equal(within(dialog).getAllByRole('button', { name: /añadir horario/i }).length, 1, 'the only way to add is the explicit button');
  assert.match(within(dialog).getByText(/Todavía no has añadido ningún horario nuevo/).textContent, /Añadir horario/);
  assert.equal(counter(), '0 / 50');
  assert.ok(within(dialog).getByRole('button', { name: 'Crear horarios' }).disabled, 'nothing to create yet');
  assert.ok(within(dialog).getByText('Todavía no hay nada que crear'));
  assert.ok(within(dialog).getByText('Vista previa semanal'));
  // clicking an empty part of the preview does nothing
  const body = document.querySelector('.sched-day[data-weekday="1"] .sched-col-body');
  fireEvent.click(body);
  assert.equal(document.querySelector('.sched-form'), null);
  assert.equal(blocks().length, 0);
});

test('the form groups HORARIO / SESIÓN / VIGENCIA and offers day chips, 30 minute starts and duration presets', async () => {
  serve();
  const dialog = await openEditor();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Añadir horario' }));
  const form = formOf(dialog);
  assert.deepEqual([...form.querySelectorAll('legend')].map((node) => node.textContent), ['Horario', 'Sesión', 'Vigencia']);
  const chips = within(form).getAllByRole('button', { pressed: false });
  assert.deepEqual(chips.map((node) => node.textContent).slice(0, 7), ['L', 'M', 'X', 'J', 'V', 'S', 'D']);
  assert.deepEqual(chips.slice(0, 7).map((node) => node.getAttribute('aria-label')), ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']);
  const time = within(form).getByLabelText('Hora de inicio *');
  const options = [...time.options].map((node) => node.value);
  assert.ok(options.includes('08:00') && options.includes('08:30'));
  assert.match([...time.options].find((node) => node.value === '08:00').textContent, /en punto/);
  assert.match([...time.options].find((node) => node.value === '08:30').textContent, /y media/);
  const duration = within(form).getByLabelText('Duración *');
  assert.deepEqual([...duration.options].map((node) => node.value), ['30', '45', '60', '75', '90', 'custom']);
  fireEvent.change(time, { target: { value: '08:30' } });
  assert.match(within(form).getByText(/Ocupará/).textContent, /08:30–09:30 \(60 min\)/);
  fireEvent.change(duration, { target: { value: '90' } });
  assert.match(within(form).getByText(/Ocupará/).textContent, /08:30–10:00 \(90 min\)/);
  fireEvent.change(duration, { target: { value: 'custom' } });
  fireEvent.change(within(form).getByLabelText('Duración personalizada (minutos)'), { target: { value: '50' } });
  assert.match(within(form).getByText(/Ocupará/).textContent, /08:30–09:20 \(50 min\)/);
  assert.ok(within(form).getByLabelText('Profesional')); assert.ok(within(form).getByLabelText('Plazas *')); assert.ok(within(form).getByLabelText('Desde *')); assert.ok(within(form).getByLabelText('Hasta (opcional)'));
});

test('adding validates before it reaches the list: service, days and the 50 limit explain themselves', async () => {
  serve();
  const dialog = await openEditor();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Añadir horario' }));
  const form = formOf(dialog);
  fireEvent.click(within(form).getByRole('button', { name: 'Añadir a la lista' }));
  const alert = within(form).getByRole('alert');
  assert.match(alert.textContent, /Elige un servicio/); assert.match(alert.textContent, /al menos un día/);
  assert.equal(document.querySelectorAll('.sched-card--draft').length, 0);
  fireEvent.click(within(form).getByRole('button', { name: 'Cancelar' }));
  assert.equal(document.querySelector('.sched-form'), null, 'cancel closes the form without adding anything');
});

test('creates "Funcional L-X-V 06:30 60 min" and "Funcional M-J 07:00 60 min": cards, counter, exact preview rows and batch payloads', async () => {
  const { posts } = serve();
  const dialog = await openEditor();
  await addDraft(dialog, { days: ['Lunes', 'Miércoles', 'Viernes'], time: '06:30', professional: irene.id, startsOn: baseData.weekStart });
  await addDraft(dialog, { days: ['Martes', 'Jueves'], time: '07:00', professional: irene.id, startsOn: baseData.weekStart });

  const cards = [...document.querySelectorAll('.sched-card--draft')];
  assert.equal(cards.length, 2);
  assert.match(cards[0].textContent, /Funcional/); assert.match(cards[0].textContent, /Lunes · Miércoles · Viernes/); assert.match(cards[0].textContent, /06:30–07:30 · 12 plazas/); assert.match(cards[0].textContent, /Irene Díaz/);
  assert.match(cards[1].textContent, /Martes · Jueves/); assert.match(cards[1].textContent, /07:00–08:00 · 12 plazas/);
  assert.equal(counter(), '5 / 50');
  assert.ok(within(dialog).getByText('5 horarios a crear'));
  assert.ok(within(dialog).getByText('Se crearán 5 horarios recurrentes'));
  const summaryList = [...document.querySelectorAll('.sched-summary li')].map((node) => node.textContent);
  assert.deepEqual(summaryList, ['Funcional · L-X-V · 06:30–07:30 · 12 plazas · Irene Díaz', 'Funcional · M-J · 07:00–08:00 · 12 plazas · Irene Díaz']);

  // Preview: exact rows, in the right column, 0630 starts one slot after 0600 and 0700 two slots after.
  const at = (weekday) => blocks().filter((node) => node.getAttribute('data-weekday') === String(weekday));
  for (const weekday of [1, 3, 5]) { const [node] = at(weekday); assert.equal(node.getAttribute('data-top'), '1'); assert.equal(node.getAttribute('data-height'), '2'); assert.equal(node.getAttribute('data-start'), String(6 * 60 + 30)); assert.equal(node.getAttribute('data-end'), String(7 * 60 + 30)); }
  for (const weekday of [2, 4]) { const [node] = at(weekday); assert.equal(node.getAttribute('data-top'), '2'); assert.equal(node.getAttribute('data-height'), '2'); assert.equal(node.getAttribute('data-end'), String(8 * 60)); }
  assert.equal(at(6).length + at(0).length, 0, 'weekend stays empty');
  // each block is a child of its own day column (Monday never lands in Tuesday)
  for (const node of blocks()) assert.equal(node.closest('.sched-day').getAttribute('data-weekday'), node.getAttribute('data-weekday'));
  assert.ok(blocks().every((node) => node.getAttribute('data-lanes') === '1'), 'no overlaps: every block uses the full column');
  assert.ok(blocks().every((node) => node.getAttribute('data-kind') === 'draft'));

  fireEvent.click(within(dialog).getByRole('button', { name: 'Crear horarios' }));
  await screen.findByText(/5 horarios creados; 8 sesiones próximas generadas automáticamente\./);
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0], { serviceId: funcional.id, areaId: area.id, professionalId: irene.id, weekdays: [1, 3, 5], blocks: [{ localStartTime: '06:30', durationMinutes: 60, capacity: 12 }], startsOn: baseData.weekStart, endsOn: null });
  assert.deepEqual(posts[1], { serviceId: funcional.id, areaId: area.id, professionalId: irene.id, weekdays: [2, 4], blocks: [{ localStartTime: '07:00', durationMinutes: 60, capacity: 12 }], startsOn: baseData.weekStart, endsOn: null });
  assert.equal(screen.queryByRole('dialog', { name: 'Configurar horarios' }), null, 'the screen closes after everything was created');
});

test('the button says "Crear horarios" and the phrases the owner asked for are never used', async () => {
  serve();
  const dialog = await openEditor();
  assert.ok(within(dialog).getByRole('button', { name: 'Crear horarios' }));
  for (const forbidden of ['Guardar configuración', 'Confirmar', 'Aplicar']) assert.equal(within(dialog).queryByRole('button', { name: forbidden }), null);
});

test('a half-hour and a full-hour block are placed on different lines in the preview (08:00 vs 08:30)', async () => {
  serve();
  const dialog = await openEditor();
  await addDraft(dialog, { days: ['Lunes'], time: '08:00', duration: '30' });
  await addDraft(dialog, { service: 'Pilates', days: ['Lunes'], time: '08:30', duration: '30' });
  const [a, b] = blocks().sort((x, y) => Number(x.getAttribute('data-top')) - Number(y.getAttribute('data-top')));
  assert.equal(a.getAttribute('data-top'), '4'); assert.equal(b.getAttribute('data-top'), '5');
  assert.equal(a.getAttribute('data-height'), '1'); assert.equal(b.getAttribute('data-height'), '1');
  assert.equal(a.getAttribute('data-lanes'), '1'); assert.equal(b.getAttribute('data-lanes'), '1');
  // axis shows both labels: 08:00 (hour) and 08:30 (half)
  const labels = [...document.querySelectorAll('.sched-col--axis span')].map((node) => [node.textContent, node.className]);
  assert.ok(labels.some(([text, cls]) => text === '08:00' && cls === 'sched-hour'));
  assert.ok(labels.some(([text, cls]) => text === '08:30' && cls === 'sched-half'));
  assert.equal(labels.length, 32, 'every 30-minute row has a reference');
});

test('overlapping drafts of different services in the same day sit side by side, never on top of each other', async () => {
  serve();
  const dialog = await openEditor();
  await addDraft(dialog, { service: 'Funcional', days: ['Lunes'], time: '08:00', duration: '60' });
  await addDraft(dialog, { service: 'Pilates', days: ['Lunes'], time: '08:30', duration: '60' });
  const [a, b] = blocks();
  assert.equal(a.getAttribute('data-lanes'), '2'); assert.equal(b.getAttribute('data-lanes'), '2');
  assert.notEqual(a.getAttribute('data-lane'), b.getAttribute('data-lane'));
  assert.deepEqual([a.getAttribute('data-left'), a.getAttribute('data-width')].map(Number).map((n) => n >= 0), [true, true]);
  assert.ok(Number(a.getAttribute('data-left')) + Number(a.getAttribute('data-width')) <= Number(b.getAttribute('data-left')) + 1e-9 || Number(b.getAttribute('data-left')) + Number(b.getAttribute('data-width')) <= Number(a.getAttribute('data-left')) + 1e-9);
  assert.equal(a.closest('.sched-day'), b.closest('.sched-day'), 'both stay inside Monday');
});

test('the same service cannot overlap itself: the form explains it and nothing is added', async () => {
  serve();
  const dialog = await openEditor();
  await addDraft(dialog, { days: ['Lunes'], time: '08:00' });
  await addDraft(dialog, { days: ['Lunes'], time: '08:30' });
  const form = formOf(dialog);
  assert.match(within(form).getByRole('alert').textContent, /Lunes: se solapa con otro horario del mismo servicio o profesional/);
  assert.equal(document.querySelectorAll('.sched-card--draft').length, 1);
  assert.equal(counter(), '1 / 50');
  fireEvent.change(within(form).getByLabelText('Hora de inicio *'), { target: { value: '09:00' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Añadir a la lista' }));
  assert.equal(document.querySelectorAll('.sched-card--draft').length, 2, 'touching blocks (08:00–09:00 and 09:00–10:00) are allowed');
});

test('a draft that overlaps an existing template is refused with the existing one named', async () => {
  serve({ templates: [existing('t1', 1, '08:30')] });
  const dialog = await openEditor();
  await addDraft(dialog, { days: ['Lunes'], time: '08:00' });
  assert.match(within(formOf(dialog)).getByRole('alert').textContent, /Funcional 08:30/);
  assert.equal(document.querySelectorAll('.sched-card--draft').length, 0);
});

test('G: duplicate copies service, professional, duration and capacity; only days and time change', async () => {
  const { posts } = serve();
  const dialog = await openEditor();
  await addDraft(dialog, { days: ['Lunes', 'Miércoles', 'Viernes'], time: '08:00', duration: '75', capacity: '9', professional: irene.id, startsOn: baseData.weekStart, endsOn: '2027-12-31' });
  fireEvent.click(within(dialog).getByRole('button', { name: /^Duplicar Funcional L-X-V 08:00$/ }));
  const form = formOf(dialog);
  assert.equal(within(form).getByRole('heading', { name: 'Duplicar horario' }).textContent, 'Duplicar horario');
  assert.equal(within(form).getByLabelText('Servicio *').value, funcional.id);
  assert.equal(within(form).getByLabelText('Profesional').value, irene.id);
  assert.equal(within(form).getByLabelText('Duración *').value, '75');
  assert.equal(within(form).getByLabelText('Plazas *').value, '9');
  assert.equal(within(form).getByLabelText('Desde *').value, baseData.weekStart);
  assert.equal(within(form).getByLabelText('Hasta (opcional)').value, '2027-12-31');
  fireEvent.change(within(form).getByLabelText('Hora de inicio *'), { target: { value: '10:00' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Añadir a la lista' }));
  const cards = [...document.querySelectorAll('.sched-card--draft')];
  assert.equal(cards.length, 2);
  assert.match(cards[1].textContent, /Lunes · Miércoles · Viernes/); assert.match(cards[1].textContent, /10:00–11:15 · 9 plazas/); assert.match(cards[0].textContent, /08:00–09:15/, 'the original is untouched');
  assert.equal(counter(), '6 / 50');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Crear horarios' }));
  await screen.findByText(/6 horarios creados/);
  assert.deepEqual(posts.map((post) => [post.blocks[0].localStartTime, post.blocks[0].durationMinutes, post.blocks[0].capacity, post.professionalId, post.endsOn]), [['08:00', 75, 9, irene.id, '2027-12-31'], ['10:00', 75, 9, irene.id, '2027-12-31']]);
});

test('edit changes a draft in place; delete removes it and frees the counter', async () => {
  serve();
  const dialog = await openEditor();
  await addDraft(dialog, { days: ['Lunes', 'Martes'], time: '08:00' });
  fireEvent.click(within(dialog).getByRole('button', { name: /^Editar Funcional L-M 08:00$/ }));
  let form = formOf(dialog);
  assert.equal(within(form).getByRole('heading', { name: 'Editar horario' }).textContent, 'Editar horario');
  fireEvent.click(within(form).getByRole('button', { name: 'Martes' }));
  fireEvent.click(within(form).getByRole('button', { name: 'Jueves' }));
  fireEvent.change(within(form).getByLabelText('Hora de inicio *'), { target: { value: '10:30' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Actualizar horario' }));
  const card = document.querySelector('.sched-card--draft');
  assert.match(card.textContent, /Lunes · Jueves/); assert.match(card.textContent, /10:30–11:30/);
  assert.equal(document.querySelectorAll('.sched-card--draft').length, 1, 'edited, not duplicated');
  assert.equal(counter(), '2 / 50');
  fireEvent.click(within(dialog).getByRole('button', { name: /^Eliminar Funcional L-J 10:30$/ }));
  assert.equal(document.querySelectorAll('.sched-card--draft').length, 0);
  assert.equal(counter(), '0 / 50');
  assert.equal(blocks().length, 0, 'the preview follows');
});

test('clicking a draft block in the preview opens its edit form; clicking an existing block only highlights its card', async () => {
  serve({ templates: [existing('t1', 3, '10:00')] });
  const dialog = await openEditor();
  await addDraft(dialog, { days: ['Lunes'], time: '08:00' });
  fireEvent.click(blocks('[data-kind="draft"]')[0]);
  assert.equal(within(formOf(dialog)).getByRole('heading', { name: 'Editar horario' }).textContent, 'Editar horario');
  fireEvent.click(within(formOf(dialog)).getByRole('button', { name: 'Cancelar' }));
  assert.equal(document.querySelector('.sched-form'), null);
  fireEvent.click(blocks('[data-kind="existing"]')[0]);
  assert.equal(document.querySelector('.sched-form'), null, 'existing templates have no edit form');
  assert.ok(document.querySelector('.sched-card--existing[data-selected="true"]'), 'its card is highlighted');
});

test('E/F: the counter stops at 50, day chips lock, "Añadir horario" disables and the limit message appears', async () => {
  serve();
  const dialog = await openEditor();
  const allDays = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  for (let hour = 6; hour < 13; hour += 1) await addDraft(dialog, { days: allDays, time: `${String(hour).padStart(2, '0')}:00` });
  assert.equal(counter(), '49 / 50');
  assert.ok(within(dialog).getByText('49 horarios a crear'));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Añadir horario' }));
  let form = formOf(dialog);
  fireEvent.click(within(form).getByRole('button', { name: 'Lunes' }));
  for (const day of allDays.slice(1)) assert.ok(within(form).getByRole('button', { name: day }).disabled, `${day} is locked once the single remaining slot is taken`);
  assert.ok(within(form).getByRole('button', { name: 'Lunes' }).disabled === false, 'the chosen day can still be unticked');
  fireEvent.change(within(form).getByLabelText('Servicio *'), { target: { value: pilates.id } });
  fireEvent.change(within(form).getByLabelText('Hora de inicio *'), { target: { value: '15:00' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Añadir a la lista' }));
  assert.equal(counter(), '50 / 50');
  assert.ok(within(dialog).getByText('Has alcanzado el máximo de 50 horarios por operación.'));
  assert.ok(within(dialog).getByRole('button', { name: 'Añadir horario' }).disabled, 'no more combinations can be added');
  assert.equal(totalOnScreen(), 50);
  // duplicating is blocked as well, and the counter never passes 50
  for (const button of within(dialog).getAllByRole('button', { name: /^Duplicar Funcional/ })) assert.ok(button.disabled);
});
const totalOnScreen = () => Number(counter().split(' / ')[0]);

test('existing templates are listed apart (neutral), grouped by days, duplicable and archivable; they cannot be edited', async () => {
  const templates = [existing('t1', 1, '08:00'), existing('t2', 3, '08:00'), existing('t3', 5, '08:00'), existing('t4', 2, '18:00', { serviceId: pilates.id, serviceName: 'Pilates', professionalId: null, professionalName: null, capacity: 8 })];
  const { archived } = serve({ templates });
  const dialog = await openEditor();
  const details = document.querySelector('.sched-existing');
  fireEvent.click(details.querySelector('summary'));
  details.open = true; fireEvent(details, new dom.window.Event('toggle'));
  const cards = [...document.querySelectorAll('.sched-card--existing')];
  assert.equal(cards.length, 2, '4 templates → 2 cards (the three Funcional share their details)');
  assert.match(cards[0].textContent, /Funcional/); assert.match(cards[0].textContent, /Lunes · Miércoles · Viernes/); assert.match(cards[0].textContent, /08:00–09:00 · 12 plazas/);
  assert.ok(cards.every((card) => !card.classList.contains('sched-card--draft')), 'existing and new never share the same look');
  assert.equal(within(cards[0]).queryByRole('button', { name: /^Editar/ }), null, 'there is no PATCH for templates, so no Editar');
  assert.match(details.textContent, /no se edita: duplícalo/);
  // existing blocks in the preview have the existing kind and are not drafts
  assert.equal(blocks('[data-kind="existing"]').length, 4); assert.equal(blocks('[data-kind="draft"]').length, 0);
  assert.equal(counter(), '0 / 50', 'existing templates do not count towards the limit of new ones');
  // archive the group → confirmation → one PATCH per template
  fireEvent.click(within(cards[0]).getByRole('button', { name: /^Archivar horario: Funcional L-X-V 08:00$/ }));
  const confirmation = await screen.findByRole('alertdialog', { name: 'Archivar horario recurrente' });
  assert.match(confirmation.textContent, /3 horarios/);
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Archivar horario' }));
  await waitFor(() => assert.deepEqual(archived, ['t1', 't2', 't3']));
  // duplicate an existing group → prefilled form
  fireEvent.click(within(document.querySelector('.sched-card--existing')).getByRole('button', { name: /^Duplicar horario existente Funcional L-X-V 08:00$/ }));
  const form = formOf(dialog);
  assert.equal(within(form).getByLabelText('Servicio *').value, funcional.id);
  assert.equal(within(form).getByLabelText('Plazas *').value, '12');
  for (const day of ['Lunes', 'Miércoles', 'Viernes']) assert.equal(within(form).getByRole('button', { name: day }).getAttribute('aria-pressed'), 'true');
});

test('partial failure: the first batch is created, the second fails, and the screen keeps only what is still pending', async () => {
  const { posts } = serve({ onBatch: (body, call) => call === 2 ? response({ error: 'schedule_conflict' }, 409) : undefined });
  const dialog = await openEditor();
  await addDraft(dialog, { days: ['Lunes', 'Miércoles'], time: '06:30' });
  await addDraft(dialog, { service: 'Pilates', days: ['Martes'], time: '07:00' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Crear horarios' }));
  await waitFor(() => assert.equal(posts.length, 2));
  const alert = await within(dialog).findByText(/se solapan entre sí o con otro horario existente/);
  assert.match(alert.textContent, /Ya se crearon 2 horarios; los demás siguen en la lista\./);
  await waitFor(() => assert.equal(document.querySelectorAll('.sched-card--draft').length, 1));
  assert.match(document.querySelector('.sched-card--draft').textContent, /Pilates/);
  assert.equal(counter(), '1 / 50');
  assert.ok(screen.getByRole('dialog', { name: 'Configurar horarios' }), 'stays open so the owner can fix it');
});

test('closing with unsent drafts asks first; without drafts it just closes; Escape behaves the same', async () => {
  serve();
  let dialog = await openEditor();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
  assert.equal(screen.queryByRole('dialog', { name: 'Configurar horarios' }), null, 'nothing to lose → closes at once');
  dialog = await (async () => { fireEvent.click(screen.getByRole('button', { name: 'Configurar horarios' })); return screen.findByRole('dialog', { name: 'Configurar horarios' }); })();
  await addDraft(dialog, { days: ['Lunes'], time: '08:00' });
  fireEvent.keyDown(document, { key: 'Escape' });
  const confirmation = await screen.findByRole('alertdialog', { name: 'Descartar los horarios nuevos' });
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Volver' }));
  assert.ok(screen.getByRole('dialog', { name: 'Configurar horarios' }), 'still open after "Volver"');
  assert.equal(document.querySelectorAll('.sched-card--draft').length, 1, 'draft kept');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar configuración de horarios' }));
  fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Descartar los horarios nuevos' })).getByRole('button', { name: 'Descartar y salir' }));
  await waitFor(() => assert.equal(screen.queryByRole('dialog', { name: 'Configurar horarios' }), null));
});

test('API errors are explained with the real code (schedule_conflict) and the draft stays', async () => {
  serve({ onBatch: () => response({ error: 'schedule_conflict' }, 409) });
  const dialog = await openEditor();
  await addDraft(dialog, { days: ['Lunes'], time: '08:00' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Crear horarios' }));
  assert.match((await within(dialog).findByRole('alert', {}, { timeout: 3000 })).textContent, /solapan/);
  assert.equal(document.querySelectorAll('.sched-card--draft').length, 1);
});

test('mobile: the preview shows one day through the day tabs, and the list stays the main interface', async () => {
  serve();
  const dialog = await openEditor();
  const tabs = within(dialog).getAllByRole('tab');
  assert.deepEqual(tabs.map((node) => node.textContent), ['L', 'M', 'X', 'J', 'V', 'S', 'D']);
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
  fireEvent.click(within(dialog).getByRole('tab', { name: 'Viernes' }));
  assert.deepEqual([...document.querySelectorAll('.sched-day')].filter((node) => node.getAttribute('data-selected') === 'true').map((node) => node.getAttribute('data-weekday')), ['5']);
});

test('CSS contract: rows are 30 minutes, columns clip their blocks, hour and half-hour lines differ, and blocks never wrap into a neighbour', () => {
  const css = readFileSync(new URL('../src/agenda-v2.css', import.meta.url), 'utf8');
  const rule = (selector) => { const match = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)); assert.ok(match, `${selector} exists`); return match[1]; };
  assert.match(rule('.sched-col-body'), /position:\s*relative/); assert.match(rule('.sched-col-body'), /overflow:\s*hidden/, 'a day column clips its blocks: Monday cannot show in Tuesday');
  assert.match(rule('.sched-col-body'), /height:\s*calc\(var\(--slot-h\) \* var\(--slots\)\)/);
  assert.match(rule('.sched-col-body'), /background-size:\s*100% calc\(var\(--slot-h\) \* 2\),\s*100% var\(--slot-h\)/, 'strong line every 2 rows, soft line every row');
  assert.match(rule('.sched-col-body'), /border-strong[\s\S]*border\)/, 'two different line colours');
  const block = css.match(/\.sched-block, \.sched-more \{([^}]*)\}/)[1];
  assert.match(block, /position:\s*absolute/); assert.match(block, /box-sizing:\s*border-box/);
  assert.match(block, /top:\s*calc\(var\(--slot-h\) \* var\(--top\)/); assert.match(block, /height:\s*calc\(var\(--slot-h\) \* var\(--span\)/);
  assert.match(block, /left:\s*calc\(100% \/ var\(--lanes\) \* var\(--lane\)/); assert.match(block, /width:\s*calc\(100% \/ var\(--lanes\) - 2px\)/);
  assert.match(block, /overflow:\s*hidden/);
  assert.match(rule('.sched-block--draft'), /dashed/, 'drafts are visibly different from existing blocks');
  assert.match(css, /\.sched-day:not\(\[data-selected="true"\]\)\s*\{\s*display:\s*none/, 'mobile shows one day');
});
