import { afterEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';
import { Search } from 'lucide-react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, within } = await import('@testing-library/react');
const { Button, IconButton, Card, CardHeader, StatusChip, PageHeader, Icon, Tabs, SearchField, SegmentedControl, EmptyState } = await import('../src/index.ts');
afterEach(cleanup);
after(() => dom.window.close());
const h = React.createElement;

test('Button renders the three variants and defaults to type="button"', () => {
  render(h('div', null, h(Button, { variant: 'primary' }, 'Guardar'), h(Button, null, 'Cancelar'), h(Button, { variant: 'ghost' }, 'Ver')));
  assert.match(screen.getByRole('button', { name: 'Guardar' }).className, /ui-button--primary/);
  assert.match(screen.getByRole('button', { name: 'Cancelar' }).className, /ui-button--secondary/);
  assert.match(screen.getByRole('button', { name: 'Ver' }).className, /ui-button--ghost/);
  assert.equal(screen.getByRole('button', { name: 'Guardar' }).getAttribute('type'), 'button');
});

test('Button forwards clicks, blocks them when disabled or loading, and announces busy', () => {
  let clicks = 0;
  const { rerender } = render(h(Button, { onClick: () => { clicks += 1; } }, 'Actualizar'));
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
  assert.equal(clicks, 1);
  rerender(h(Button, { onClick: () => { clicks += 1; }, disabled: true }, 'Actualizar'));
  assert.equal(screen.getByRole('button', { name: 'Actualizar' }).disabled, true);
  rerender(h(Button, { onClick: () => { clicks += 1; }, loading: true }, 'Actualizar'));
  const busy = screen.getByRole('button', { name: 'Actualizar' });
  assert.equal(busy.disabled, true);
  assert.equal(busy.getAttribute('aria-busy'), 'true');
  fireEvent.click(busy);
  assert.equal(clicks, 1);
  assert.ok(busy.querySelector('.ui-button-label'), 'label stays rendered while loading so the width does not jump');
});

test('Button with href renders a link with the same look', () => {
  render(h(Button, { href: '#calendar', variant: 'secondary', icon: Search }, 'Abrir agenda'));
  const link = screen.getByRole('link', { name: 'Abrir agenda' });
  assert.equal(link.getAttribute('href'), '#calendar');
  assert.match(link.className, /ui-button/);
  assert.equal(link.querySelector('svg')?.getAttribute('aria-hidden'), 'true');
});

test('IconButton exposes its accessible name and decorative icon', () => {
  render(h(IconButton, { icon: Search, label: 'Buscar en 2J' }));
  const button = screen.getByRole('button', { name: 'Buscar en 2J' });
  assert.equal(button.getAttribute('title'), 'Buscar en 2J');
  assert.equal(button.querySelector('svg')?.getAttribute('aria-hidden'), 'true');
});

test('Icon uses the V2 stroke and the requested size', () => {
  const { container } = render(h(Icon, { icon: Search, size: 24 }));
  const svg = container.querySelector('svg');
  assert.equal(svg?.getAttribute('width'), '24');
  assert.equal(svg?.getAttribute('stroke-width'), '1.75');
});

test('StatusChip always pairs text with an icon and maps the tone class', () => {
  render(h('div', null, ['success', 'warning', 'danger', 'info', 'neutral'].map((tone) => h(StatusChip, { key: tone, tone }, `Estado ${tone}`))));
  for (const tone of ['success', 'warning', 'danger', 'info', 'neutral']) {
    const chip = screen.getByText(`Estado ${tone}`).closest('.ui-chip');
    assert.ok(chip?.classList.contains(`ui-chip--${tone}`));
    assert.ok(chip?.querySelector('svg'), `${tone} chip has an icon`);
  }
  render(h(StatusChip, { tone: 'info', icon: null }, 'Solo texto'));
  assert.equal(screen.getByText('Solo texto').closest('.ui-chip')?.querySelector('svg'), null);
});

test('Card and CardHeader render a labelled section with title level and actions', () => {
  render(h(Card, { as: 'section', 'aria-labelledby': 'c1' }, h(CardHeader, { title: 'Próximas sesiones', titleId: 'c1', description: 'Hoy', actions: h('span', null, '3') })));
  const section = screen.getByRole('region', { name: 'Próximas sesiones' });
  assert.match(section.className, /ui-card/);
  assert.equal(screen.getByRole('heading', { level: 2, name: 'Próximas sesiones' }).id, 'c1');
  assert.ok(screen.getByText('Hoy'));
});

test('PageHeader renders one h1 with optional description, meta and actions', () => {
  render(h(PageHeader, { title: 'Resumen', description: 'jueves 16 de octubre', meta: 'Actualizado 10:42', actions: h(Button, null, 'Actualizar') }));
  assert.equal(screen.getAllByRole('heading', { level: 1 }).length, 1);
  assert.ok(screen.getByText('jueves 16 de octubre'));
  assert.ok(screen.getByText('Actualizado 10:42'));
  assert.ok(screen.getByRole('button', { name: 'Actualizar' }));
});

test('Button danger variants: outlined by default, filled only when asked', () => {
  render(h('div', null, h(Button, { variant: 'danger' }, 'Archivar'), h(Button, { variant: 'danger-solid' }, 'Confirmar')));
  assert.match(screen.getByRole('button', { name: 'Archivar' }).className, /ui-button--danger(s|$)/);
  assert.match(screen.getByRole('button', { name: 'Confirmar' }).className, /ui-button--danger-solid/);
});

test('Tabs expose tablist semantics, roving tabindex and Arrow/Home/End navigation', () => {
  let value = 'a';
  const items = [{ id: 'a', label: 'Uno' }, { id: 'b', label: 'Dos' }, { id: 'c', label: 'Tres' }];
  const view = () => h(Tabs, { label: 'Secciones', items, value, onChange: (id) => { value = id; }, panelId: 'panel', idPrefix: 't' });
  const { rerender } = render(view());
  assert.ok(screen.getByRole('tablist', { name: 'Secciones' }));
  const [one, two, three] = screen.getAllByRole('tab');
  assert.deepEqual([one.tabIndex, two.tabIndex, three.tabIndex], [0, -1, -1]);
  assert.equal(one.getAttribute('aria-controls'), 'panel');
  assert.equal(two.id, 't-b');
  one.focus();
  fireEvent.keyDown(one, { key: 'ArrowRight' }); rerender(view());
  assert.equal(value, 'b'); assert.equal(document.activeElement, two);
  fireEvent.keyDown(two, { key: 'End' }); rerender(view());
  assert.equal(value, 'c');
  fireEvent.keyDown(three, { key: 'ArrowRight' }); rerender(view());
  assert.equal(value, 'a', 'wraps around');
});

test('SearchField is labelled, controlled, and clears with a named button', () => {
  let text = 'ana';
  const view = () => h(SearchField, { label: 'Buscar cliente', placeholder: 'Buscar por nombre', value: text, onChange: (next) => { text = next; } });
  const { rerender } = render(view());
  const input = screen.getByLabelText('Buscar cliente');
  assert.equal(input.value, 'ana');
  fireEvent.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }));
  assert.equal(text, '');
  rerender(view());
  assert.equal(screen.queryByRole('button', { name: 'Limpiar búsqueda' }), null);
});

test('SegmentedControl is a labelled group whose buttons expose aria-pressed', () => {
  let value = 'active';
  const options = [{ value: 'active', label: 'Activos' }, { value: 'archived', label: 'Archivados' }];
  const view = () => h(SegmentedControl, { label: 'Estado', options, value, onChange: (next) => { value = next; } });
  const { rerender } = render(view());
  assert.equal(screen.getByRole('button', { name: 'Activos' }).getAttribute('aria-pressed'), 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Archivados' }));
  rerender(view());
  assert.equal(screen.getByRole('button', { name: 'Archivados' }).getAttribute('aria-pressed'), 'true');
  assert.equal(screen.getByRole('button', { name: 'Activos' }).getAttribute('aria-pressed'), 'false');
});

test('EmptyState says what is missing, forwards role for errors and renders only the action it is given', () => {
  render(h(EmptyState, { role: 'alert', tone: 'danger', icon: Search, title: 'No se pudo cargar', action: h(Button, null, 'Reintentar') }, 'Inténtalo de nuevo'));
  const alert = screen.getByRole('alert');
  assert.match(alert.className, /is-danger/);
  assert.ok(within(alert).getByText('No se pudo cargar'));
  assert.ok(within(alert).getByRole('button', { name: 'Reintentar' }));
  cleanup();
  render(h(EmptyState, { title: 'Aún no hay clientes' }));
  assert.equal(screen.queryByRole('button'), null);
});

const { ConfirmDialog, SaveState } = await import('../src/index.ts');

test('ConfirmDialog is an alertdialog: focus starts on Cancel, Tab stays inside, Escape cancels and focus returns to the opener', () => {
  let cancelled = 0;
  const Host = () => {
    const [open, setOpen] = React.useState(false);
    return h('div', null,
      h('button', { onClick: () => setOpen(true) }, 'Abrir'),
      h(ConfirmDialog, { open, title: 'Retirar noticia', description: 'Se conservará en el historial.', confirmLabel: 'Retirar', onConfirm: () => {}, onCancel: () => { cancelled += 1; setOpen(false); } }));
  };
  render(h(Host));
  const opener = screen.getByRole('button', { name: 'Abrir' });
  opener.focus();
  fireEvent.click(opener);
  const dialog = screen.getByRole('alertdialog', { name: 'Retirar noticia' });
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  assert.ok(dialog.getAttribute('aria-describedby'), 'consequence is the accessible description');
  const cancel = within(dialog).getByRole('button', { name: 'Cancelar' });
  const confirm = within(dialog).getByRole('button', { name: 'Retirar' });
  assert.ok(document.activeElement === cancel, 'focus starts on the safe choice');
  confirm.focus();
  fireEvent.keyDown(confirm, { key: 'Tab' });
  assert.ok(document.activeElement === cancel, 'Tab from the last control wraps to the first');
  fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
  assert.ok(document.activeElement === confirm, 'Shift+Tab from the first control wraps to the last');
  fireEvent.keyDown(dialog, { key: 'Escape' });
  assert.equal(cancelled, 1);
  assert.equal(screen.queryByRole('alertdialog'), null);
  assert.ok(document.activeElement === opener, 'focus returns to the element that opened it');
});

test('ConfirmDialog requires a reason when configured, trims it and sends it on confirm', () => {
  const reasons = [];
  render(h(ConfirmDialog, { open: true, title: 'Anular venta', description: 'Se devolverá el stock.', confirmLabel: 'Anular', reason: { label: 'Motivo', required: true, minLength: 3 }, onConfirm: (reason) => reasons.push(reason), onCancel: () => {} }));
  const confirm = screen.getByRole('button', { name: 'Anular' });
  assert.equal(confirm.disabled, true, 'blocked until the reason is long enough');
  const field = screen.getByLabelText(/Motivo/);
  assert.equal(field.getAttribute('aria-required'), 'true');
  fireEvent.change(field, { target: { value: ' ab ' } });
  assert.equal(confirm.disabled, true, 'two characters are not enough');
  fireEvent.change(field, { target: { value: '  Error de venta  ' } });
  assert.equal(confirm.disabled, false);
  fireEvent.click(confirm);
  assert.deepEqual(reasons, ['Error de venta']);
});

test('ConfirmDialog optional reason does not block, busy blocks everything, and an error is announced', () => {
  let cancelled = 0;
  const { rerender } = render(h(ConfirmDialog, { open: true, title: 'Archivar', description: 'x', confirmLabel: 'Archivar', reason: { label: 'Motivo' }, onConfirm: () => {}, onCancel: () => { cancelled += 1; } }));
  assert.equal(screen.getByRole('button', { name: 'Archivar' }).disabled, false, 'optional reason never blocks');
  rerender(h(ConfirmDialog, { open: true, title: 'Archivar', description: 'x', confirmLabel: 'Archivar', busy: true, error: 'No se pudo archivar.', onConfirm: () => {}, onCancel: () => { cancelled += 1; } }));
  assert.equal(screen.getByRole('button', { name: 'Cancelar' }).disabled, true);
  fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
  fireEvent.mouseDown(document.querySelector('.ui-modal-backdrop'));
  assert.equal(cancelled, 0, 'Escape and the backdrop do nothing while busy');
  assert.equal(screen.getByRole('alert').textContent, 'No se pudo archivar.');
});

test('ConfirmDialog backdrop click cancels and a click inside the dialog does not', () => {
  let cancelled = 0;
  render(h(ConfirmDialog, { open: true, title: 'Archivar', description: 'x', confirmLabel: 'Archivar', onConfirm: () => {}, onCancel: () => { cancelled += 1; } }));
  fireEvent.mouseDown(screen.getByRole('alertdialog'));
  assert.equal(cancelled, 0);
  fireEvent.mouseDown(document.querySelector('.ui-modal-backdrop'));
  assert.equal(cancelled, 1);
});

test('SaveState keeps a live region mounted and says saving, saved or the error with an icon and text', () => {
  const { rerender } = render(h(SaveState, { status: 'idle' }));
  const region = document.querySelector('.ui-save-state');
  assert.equal(region.getAttribute('role'), 'status');
  assert.equal(region.textContent, '');
  rerender(h(SaveState, { status: 'saving' }));
  assert.equal(document.querySelector('.ui-save-state').textContent, 'Guardando…');
  rerender(h(SaveState, { status: 'saved', savedLabel: 'Cambios guardados.' }));
  assert.equal(document.querySelector('.ui-save-state').textContent, 'Cambios guardados.');
  assert.ok(document.querySelector('.ui-save-state svg'), 'never color alone');
  rerender(h(SaveState, { status: 'error', errorLabel: 'No se pudo guardar.' }));
  const error = screen.getByRole('alert');
  assert.equal(error.textContent, 'No se pudo guardar.');
  assert.equal(error.getAttribute('aria-live'), 'assertive');
});
