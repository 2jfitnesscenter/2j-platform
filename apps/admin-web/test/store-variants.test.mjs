import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174/#store' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { StorePage } = await import('../src/store-page.tsx');
const logic = await import('../src/store-variants.ts');
afterEach(() => { cleanup(); globalThis.fetch = undefined; });
after(() => dom.window.close());

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const variant = (id, label, size, flavor, stock = 5, price = '1800', extra = {}) => ({ id, sku: null, label, size, flavor, priceCents: price, active: true, stockTracked: true, stock, ...extra });
const shirt = { id: 'p-shirt', category: 'merchandising', name: 'Camiseta 2J', description: '', active: true, variants: [variant('s-m', 'Talla M', 'M', null, 20)] };
const whey = { id: 'p-whey', category: 'nutrition', name: 'Proteína Whey', description: '', active: true, variants: [variant('w1', '500 g · Chocolate', '500 g', 'Chocolate', 4, '1990'), variant('w2', '500 g · Vainilla', '500 g', 'Vainilla', 2, '1990'), variant('w3', '1 kg · Chocolate', '1 kg', 'Chocolate', 8, '3490')] };
const store = { products: [shirt, whey], movements: [], sales: [] };

function serve({ data = store, failOn = null } = {}) {
  const posts = []; let counter = 0;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (init.method === 'POST') {
      const body = JSON.parse(init.body); posts.push({ target, body });
      if (failOn && failOn(target, body, posts.length)) return json({ error: 'sku_conflict' }, 409);
      counter += 1; return json({ id: target.endsWith('/products') ? 'p-new' : `new-${counter}` }, 201);
    }
    if (target.endsWith('/api/admin/store')) return json(data);
    if (target.includes('/api/clients?')) return json({ items: [{ id: 'c1', firstName: 'Eva', lastName: 'Demo', email: null, status: 'active' }] });
    return json({ id: 'ok' }, 201);
  };
  return posts;
}
const openProductDialog = async () => { render(React.createElement(StorePage)); await screen.findByRole('heading', { name: 'Camiseta 2J' }); fireEvent.click(screen.getByRole('button', { name: 'Añadir producto' })); return screen.findByRole('dialog', { name: 'Añadir producto' }); };
const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const variantPosts = (posts) => posts.filter((post) => /\/variants$/.test(post.target));
const movementPosts = (posts) => posts.filter((post) => /\/movements$/.test(post.target));

// ---------- pure logic ----------
test('A: apparel offers the standard sizes XS to 4XL, in order', () => {
  assert.deepEqual([...logic.APPAREL_SIZES], ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL']);
  assert.deepEqual(logic.sortSizes(['XL', 'S', '3XL', 'XS', 'M']), ['XS', 'S', 'M', 'XL', '3XL']);
});

test('B/C: selecting S, M and L builds three variants "Talla S/M/L" with the base price and no manual label', () => {
  const state = { ...logic.emptyBuilder(), kind: 'sizes', sizes: ['L', 'S', 'M'], basePrice: '18', overrides: { [logic.normalizeKey('Talla M')]: { stock: '10' } } };
  const planned = logic.planVariants('merchandising', state, []);
  assert.deepEqual(planned.map((item) => [item.label, item.size, item.flavor, item.priceCents, item.stock]), [['Talla S', 'S', null, 1800, 0], ['Talla M', 'M', null, 1800, 10], ['Talla L', 'L', null, 1800, 0]]);
  assert.equal(logic.plannedReady(planned), true);
  const overridden = logic.planVariants('merchandising', { ...state, overrides: { [logic.normalizeKey('Talla L')]: { price: '20,50' } } }, []);
  assert.equal(overridden.find((item) => item.size === 'L').priceCents, 2050, 'a variant can have its own price');
  assert.equal(overridden.find((item) => item.size === 'S').priceCents, 1800);
});

test('D: a size that already exists is never created again, however it is written', () => {
  const state = { ...logic.emptyBuilder(), sizes: ['M', 'L'], basePrice: '18' };
  const planned = logic.planVariants('merchandising', state, [{ label: 'Talla M', size: 'M', flavor: null }]);
  assert.deepEqual(planned.map((item) => [item.label, item.exists]), [['Talla M', true], ['Talla L', false]]);
  assert.equal(logic.creatable(planned).length, 1);
  assert.equal(logic.planVariants('merchandising', state, [{ label: ' talla  m ', size: null, flavor: null }])[0].exists, true, 'label comparison ignores case and spacing');
  assert.equal(logic.planVariants('merchandising', { ...state, sizes: ['M'] }, [{ label: 'M', size: 'M', flavor: null }])[0].exists, true, 'an older variant labelled just "M" counts too');
  assert.equal(logic.plannedReady(logic.planVariants('merchandising', { ...state, sizes: ['M'] }, [{ label: 'Talla M', size: 'M', flavor: null }])), false, 'nothing new to create');
});

test('E/F/G: nutrition builds formats, formats × flavors, and plain formats without flavors', () => {
  const base = { ...logic.emptyBuilder(), basePrice: '19,90' };
  assert.deepEqual(logic.planVariants('nutrition', { ...base, formats: ['500 g', '1 kg'] }, []).map((item) => item.label), ['500 g', '1 kg'], 'G: no flavors → only the format');
  const combos = logic.planVariants('nutrition', { ...base, formats: ['500 g', '1 kg'], flavors: ['Chocolate', 'Vainilla'] }, []);
  assert.deepEqual(combos.map((item) => item.label), ['500 g · Chocolate', '500 g · Vainilla', '1 kg · Chocolate', '1 kg · Vainilla'], 'F: every format × flavor');
  assert.deepEqual(combos.map((item) => [item.size, item.flavor]), [['500 g', 'Chocolate'], ['500 g', 'Vainilla'], ['1 kg', 'Chocolate'], ['1 kg', 'Vainilla']], 'format goes to size (talla o formato), flavor to flavor');
  assert.equal(combos[0].priceCents, 1990);
});

test('nutrition formats are not limited to grams, and the same combination is detected as duplicate', () => {
  assert.equal(logic.formatLabel('908', 'g'), '908 g'); assert.equal(logic.formatLabel('1.8', 'kg'), '1,8 kg'); assert.equal(logic.formatLabel('60', 'cápsulas'), '60 cápsulas'); assert.equal(logic.formatLabel('500', 'ml'), '500 ml');
  assert.deepEqual([...logic.FORMAT_UNITS], ['g', 'kg', 'ml', 'L', 'cápsulas', 'tabletas', 'sobres', 'unidades']);
  assert.deepEqual([...logic.NUTRITION_PRESETS], ['150 g', '250 g', '500 g', '750 g', '1 kg', '2 kg', '2,5 kg', '5 kg']);
  const planned = logic.planVariants('nutrition', { ...logic.emptyBuilder(), basePrice: '30', formats: ['1 kg'], flavors: ['chocolate', 'Fresa'] }, whey.variants);
  assert.deepEqual(planned.map((item) => [item.label, item.exists]), [['1 kg · chocolate', true], ['1 kg · Fresa', false]], 'Chocolate in a different case still exists');
});

test('without flavors a plain format works on its own (Creatina 500 g) and an empty selection builds nothing', () => {
  assert.deepEqual(logic.planVariants('nutrition', { ...logic.emptyBuilder(), basePrice: '25', formats: ['500 g'] }, []).map((item) => item.label), ['500 g']);
  assert.equal(logic.planVariants('nutrition', logic.emptyBuilder(), []).length, 0);
  assert.equal(logic.planVariants('merchandising', { ...logic.emptyBuilder(), kind: 'sizes' }, []).length, 0);
});

test('merchandising without sizes: a single "Estándar" variant or a custom list; prices and stock are validated', () => {
  assert.deepEqual(logic.planVariants('merchandising', { ...logic.emptyBuilder(), kind: 'none', basePrice: '12' }, []).map((item) => [item.label, item.size]), [['Estándar', null]]);
  assert.deepEqual(logic.planVariants('merchandising', { ...logic.emptyBuilder(), kind: 'custom', custom: ['Negro', 'Azul', 'negro'], basePrice: '9' }, []).map((item) => item.label), ['Negro', 'Azul', 'Negro'].filter((item, index, list) => list.findIndex((other) => logic.normalizeKey(other) === logic.normalizeKey(item)) === index));
  const bad = logic.planVariants('merchandising', { ...logic.emptyBuilder(), sizes: ['S'], basePrice: '', overrides: { [logic.normalizeKey('Talla S')]: { stock: '-1' } } }, []);
  assert.ok(bad[0].problems.some((text) => /precio válido/.test(text))); assert.ok(bad[0].problems.some((text) => /stock/.test(text)));
  assert.equal(logic.plannedReady(bad), false);
  assert.equal(logic.parsePriceCents('19,90'), 1990); assert.equal(logic.parsePriceCents('abc'), null); assert.equal(logic.parsePriceCents('-1'), null);
});

test('J/K: selling is progressive: product → talla; product → formato → sabor; single and custom variants resolve sensibly', () => {
  const sell = (items) => items.map((item) => ({ id: item.id, label: item.label, size: item.size, flavor: item.flavor, priceCents: item.priceCents, stockTracked: true, stock: item.stock }));
  const apparel = sell([variant('xl', 'Talla XL', 'XL', null), variant('s', 'Talla S', 'S', null), variant('m', 'Talla M', 'M', null)]);
  const step = logic.sellStep('merchandising', apparel, '');
  assert.deepEqual([step.sizeLabel, step.sizes, step.needsFlavor], ['Talla', ['S', 'M', 'XL'], false]);
  assert.equal(logic.resolveVariant('merchandising', apparel, { size: '', flavor: null, label: '' }), null, 'no talla chosen yet');
  assert.equal(logic.resolveVariant('merchandising', apparel, { size: 'M', flavor: null, label: '' }).id, 'm');
  const nutrition = sell(whey.variants);
  const first = logic.sellStep('nutrition', nutrition, '');
  assert.deepEqual([first.sizeLabel, first.sizes, first.needsFlavor], ['Formato', ['500 g', '1 kg'], false], 'the flavor depends on the format, so it is asked after it');
  assert.deepEqual(logic.sellStep('nutrition', nutrition, '500 g').flavors, ['Chocolate', 'Vainilla']);
  assert.equal(logic.resolveVariant('nutrition', nutrition, { size: '500 g', flavor: null, label: '' }), null, 'sabor still missing');
  assert.equal(logic.resolveVariant('nutrition', nutrition, { size: '500 g', flavor: 'Vainilla', label: '' }).id, 'w2');
  assert.equal(logic.resolveVariant('nutrition', nutrition, { size: '1 kg', flavor: 'Chocolate', label: '' }).id, 'w3');
  assert.equal(logic.resolveVariant('merchandising', sell([variant('only', 'Estándar', null, null)]), { size: '', flavor: null, label: '' }).id, 'only', 'a product with one variant needs no further choice');
  const custom = sell([variant('c1', 'Negro', null, null), variant('c2', 'Azul', null, null)]);
  assert.equal(logic.sellStep('merchandising', custom, '').byLabel, true);
  assert.equal(logic.resolveVariant('merchandising', custom, { size: '', flavor: null, label: 'c2' }).id, 'c2');
  assert.deepEqual(logic.productOptions('nutrition', whey.variants), { sizeTitle: 'Formatos', sizes: ['500 g', '1 kg'], flavors: ['Chocolate', 'Vainilla'] });
});

// ---------- screens ----------
test('A/B/C: Nuevo producto "Camiseta Test" with sizes XS..4XL creates all eight variants from one form, with the base price and per-size stock', async () => {
  const posts = serve();
  const dialog = await openProductDialog();
  fireEvent.change(within(dialog).getByLabelText('Categoría'), { target: { value: 'merchandising' } });
  fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Camiseta Test' } });
  assert.equal(within(dialog).getByRole('radio', { name: 'Tallas' }).checked, true, 'merchandising starts on Tallas');
  assert.deepEqual(within(dialog).getAllByRole('checkbox').filter((box) => /^(XS|S|M|L|XL|2XL|3XL|4XL)$/.test(box.parentElement.textContent)).map((box) => box.parentElement.textContent), ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL']);
  assert.equal(within(dialog).getByRole('button', { name: 'Crear producto' }).disabled, true, 'no size, no price yet');
  for (const size of ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL']) fireEvent.click(within(dialog).getByRole('checkbox', { name: size }));
  fireEvent.change(within(dialog).getByLabelText('Precio (€)'), { target: { value: '18' } });
  assert.equal(within(dialog).getByText('Se crearán 8 variantes').textContent, 'Se crearán 8 variantes');
  fireEvent.change(within(dialog).getByLabelText('Stock Talla S'), { target: { value: '5' } });
  fireEvent.change(within(dialog).getByLabelText('Stock Talla M'), { target: { value: '10' } });
  fireEvent.change(within(dialog).getByLabelText('Precio Talla 3XL'), { target: { value: '20' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Crear producto' }));
  await waitFor(() => assert.equal(variantPosts(posts).length, 8), { timeout: 4000 });
  assert.equal(posts[0].target.endsWith('/api/admin/store/products'), true); assert.deepEqual(posts[0].body, { category: 'merchandising', name: 'Camiseta Test', description: '' });
  assert.deepEqual(variantPosts(posts).map((post) => post.body.label), ['Talla XS', 'Talla S', 'Talla M', 'Talla L', 'Talla XL', 'Talla 2XL', 'Talla 3XL', 'Talla 4XL']);
  assert.deepEqual(variantPosts(posts).map((post) => post.body.priceCents), [1800, 1800, 1800, 1800, 1800, 1800, 2000, 1800], 'base price for all, 3XL overridden');
  assert.ok(variantPosts(posts).every((post) => post.body.sku === null && post.body.flavor === null && post.body.stockTracked === true), 'SKU stays optional');
  assert.equal(variantPosts(posts)[1].body.size, 'S');
  assert.deepEqual(movementPosts(posts).map((post) => [post.target.split('/variants/')[1].split('/')[0] !== '', post.body.type, post.body.quantity, post.body.reason]).map(([, type, quantity, reason]) => [type, quantity, reason]), [['opening', 5, 'Stock inicial'], ['opening', 10, 'Stock inicial']], 'stock goes through the real movements endpoint, only where > 0');
  await waitFor(() => assert.ok(document.querySelector('[role="dialog"]') === null));
  assert.ok(screen.getByText('Producto creado con 8 variantes.'));
});

test('B: three sizes create three variants; a stock-free product skips movements', async () => {
  const posts = serve();
  const dialog = await openProductDialog();
  fireEvent.change(within(dialog).getByLabelText('Categoría'), { target: { value: 'merchandising' } });
  fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Sudadera' } });
  for (const size of ['S', 'M', 'L']) fireEvent.click(within(dialog).getByRole('checkbox', { name: size }));
  fireEvent.change(within(dialog).getByLabelText('Precio (€)'), { target: { value: '35' } });
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Controlar unidades de stock' }));
  assert.equal(within(dialog).queryByLabelText('Stock Talla S'), null, 'no per-size stock when units are not controlled');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Crear producto' }));
  await waitFor(() => assert.equal(variantPosts(posts).length, 3), { timeout: 3000 });
  assert.ok(variantPosts(posts).every((post) => post.body.stockTracked === false));
  assert.equal(movementPosts(posts).length, 0);
});

test('merchandising without sizes: "Sin variantes" and "Variantes personalizadas" do not force sizes', async () => {
  const posts = serve();
  const dialog = await openProductDialog();
  fireEvent.change(within(dialog).getByLabelText('Categoría'), { target: { value: 'merchandising' } });
  assert.deepEqual(within(dialog).getAllByRole('radio').map((radio) => radio.parentElement.textContent), ['Sin variantes', 'Tallas', 'Variantes personalizadas']);
  fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Botella' } });
  fireEvent.click(within(dialog).getByRole('radio', { name: 'Variantes personalizadas' }));
  assert.equal(within(dialog).queryByRole('checkbox', { name: 'XS' }), null);
  for (const name of ['Negra', 'Azul']) { fireEvent.change(within(dialog).getByLabelText('Nombre de la variante'), { target: { value: name } }); fireEvent.click(within(dialog).getByRole('button', { name: 'Añadir variante' })); }
  fireEvent.change(within(dialog).getByLabelText('Precio (€)'), { target: { value: '9,50' } });
  assert.ok(within(dialog).getByText('Se crearán 2 variantes'));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Crear producto' }));
  await waitFor(() => assert.equal(variantPosts(posts).length, 2), { timeout: 3000 });
  assert.deepEqual(variantPosts(posts).map((post) => [post.body.label, post.body.size, post.body.priceCents]), [['Negra', null, 950], ['Azul', null, 950]]);
});

test('E/F: "Proteína Test" with 500 g + 1 kg and Chocolate + Vainilla previews and creates the four combinations', async () => {
  const posts = serve();
  const dialog = await openProductDialog();
  fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Proteína Test' } });
  assert.equal(within(dialog).queryByLabelText('Tipo de variante'), null, 'nutrition has no size/none choice');
  for (const format of ['500 g', '1 kg']) fireEvent.click(within(dialog).getByRole('checkbox', { name: format }));
  for (const flavor of ['Chocolate', 'Vainilla']) { fireEvent.change(within(dialog).getByLabelText('Nuevo sabor'), { target: { value: flavor } }); fireEvent.click(within(dialog).getByRole('button', { name: 'Añadir sabor' })); }
  fireEvent.change(within(dialog).getByLabelText('Precio (€)'), { target: { value: '19,90' } });
  assert.ok(within(dialog).getByText('Se crearán 4 variantes'));
  const labels = [...dialog.querySelectorAll('.vb-table tbody td[data-label="Variante"] strong')].map((node) => node.textContent);
  assert.deepEqual(labels, ['500 g · Chocolate', '500 g · Vainilla', '1 kg · Chocolate', '1 kg · Vainilla']);
  fireEvent.change(within(dialog).getByLabelText('Stock 1 kg · Vainilla'), { target: { value: '3' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Crear producto' }));
  await waitFor(() => assert.equal(variantPosts(posts).length, 4), { timeout: 3000 });
  assert.deepEqual(variantPosts(posts).map((post) => [post.body.label, post.body.size, post.body.flavor, post.body.priceCents]), [['500 g · Chocolate', '500 g', 'Chocolate', 1990], ['500 g · Vainilla', '500 g', 'Vainilla', 1990], ['1 kg · Chocolate', '1 kg', 'Chocolate', 1990], ['1 kg · Vainilla', '1 kg', 'Vainilla', 1990]]);
  assert.deepEqual(movementPosts(posts).map((post) => post.body.quantity), [3], 'each combination has independent stock');
});

test('E: custom formats such as 908 g, 1,8 kg, 60 cápsulas or 500 ml can be added next to the presets', async () => {
  const posts = serve();
  const dialog = await openProductDialog();
  fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Creatina' } });
  const add = (amount, unit) => { fireEvent.change(within(dialog).getByLabelText('Formato personalizado'), { target: { value: amount } }); fireEvent.change(within(dialog).getByLabelText('Unidad'), { target: { value: unit } }); fireEvent.click(within(dialog).getByRole('button', { name: 'Añadir formato' })); };
  add('908', 'g'); add('1,8', 'kg'); add('60', 'cápsulas'); add('500', 'ml');
  assert.deepEqual([...dialog.querySelectorAll('ul[aria-label="Formatos personalizados"] li span')].map((node) => node.textContent), ['908 g', '1,8 kg', '60 cápsulas', '500 ml']);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Quitar 500 ml' }));
  fireEvent.change(within(dialog).getByLabelText('Precio (€)'), { target: { value: '25' } });
  assert.ok(within(dialog).getByText('Se crearán 3 variantes'), 'no flavors: one variant per format');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Crear producto' }));
  await waitFor(() => assert.equal(variantPosts(posts).length, 3), { timeout: 3000 });
  assert.deepEqual(variantPosts(posts).map((post) => [post.body.label, post.body.flavor]), [['908 g', null], ['1,8 kg', null], ['60 cápsulas', null]]);
});

test('D: adding variants to an existing product skips what exists and says so', async () => {
  const posts = serve();
  render(React.createElement(StorePage)); await screen.findByRole('heading', { name: 'Camiseta 2J' });
  fireEvent.click(within(screen.getByRole('article', { name: 'Camiseta 2J' })).getByRole('button', { name: 'Añadir variantes' }));
  const dialog = await screen.findByRole('dialog', { name: 'Añadir variantes' });
  assert.equal(within(dialog).getByLabelText('Producto').value, 'p-shirt');
  const taken = within(dialog).getByRole('checkbox', { name: 'M' });
  assert.equal(taken.disabled, true, 'Talla M already exists');
  assert.equal(taken.parentElement.getAttribute('title'), 'Esta variante ya existe.');
  for (const size of ['S', 'L']) fireEvent.click(within(dialog).getByRole('checkbox', { name: size }));
  fireEvent.change(within(dialog).getByLabelText('Precio (€)'), { target: { value: '18' } });
  assert.ok(within(dialog).getByText('Se crearán 2 variantes'));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Crear variantes' }));
  await waitFor(() => assert.equal(variantPosts(posts).length, 2), { timeout: 3000 });
  assert.ok(variantPosts(posts).every((post) => post.target.includes('/products/p-shirt/variants')));
  assert.deepEqual(variantPosts(posts).map((post) => post.body.label), ['Talla S', 'Talla L']);
});

test('D: a nutrition combination that already exists is shown as such and is not posted', async () => {
  const posts = serve();
  render(React.createElement(StorePage)); await screen.findByRole('heading', { name: 'Proteína Whey' });
  fireEvent.click(within(screen.getByRole('article', { name: 'Proteína Whey' })).getByRole('button', { name: 'Añadir variantes' }));
  const dialog = await screen.findByRole('dialog', { name: 'Añadir variantes' });
  fireEvent.click(within(dialog).getByRole('checkbox', { name: '1 kg' }));
  for (const flavor of ['Chocolate', 'Fresa']) { fireEvent.change(within(dialog).getByLabelText('Nuevo sabor'), { target: { value: flavor } }); fireEvent.click(within(dialog).getByRole('button', { name: 'Añadir sabor' })); }
  fireEvent.change(within(dialog).getByLabelText('Precio (€)'), { target: { value: '34,90' } });
  assert.ok(within(dialog).getByText('Se creará 1 variante'));
  assert.ok(within(dialog).getByText('Esta variante ya existe.'));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Crear variantes' }));
  await waitFor(() => assert.equal(variantPosts(posts).length, 1), { timeout: 3000 });
  assert.equal(variantPosts(posts)[0].body.label, '1 kg · Fresa');
});

test('creation stops at the first error, reports what was created, and does not create the product twice on retry', async () => {
  let failing = true;
  const posts = serve({ failOn: (target, body) => failing && /\/variants$/.test(target) && body.label === 'Talla M' });
  const dialog = await openProductDialog();
  fireEvent.change(within(dialog).getByLabelText('Categoría'), { target: { value: 'merchandising' } });
  fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Polo' } });
  for (const size of ['S', 'M', 'L']) fireEvent.click(within(dialog).getByRole('checkbox', { name: size }));
  fireEvent.change(within(dialog).getByLabelText('Precio (€)'), { target: { value: '22' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Crear producto' }));
  const alert = await within(dialog).findByRole('alert', {}, { timeout: 3000 });
  assert.match(alert.textContent, /Se crearon 1 de 3 variantes \(Talla S\)\. No se pudo crear «Talla M»/);
  assert.equal(variantPosts(posts).length, 2, 'stopped: Talla L was not attempted');
  assert.equal(posts.filter((post) => post.target.endsWith('/products')).length, 1);
  failing = false;
  fireEvent.click(within(dialog).getByRole('button', { name: 'Crear producto' }));
  await waitFor(() => assert.ok(document.querySelector('[role="dialog"]') === null), { timeout: 3000 });
  assert.equal(posts.filter((post) => post.target.endsWith('/products')).length, 1, 'the product is not created again');
});

test('double clicking the create button never sends the batch twice', async () => {
  const posts = serve();
  const dialog = await openProductDialog();
  fireEvent.change(within(dialog).getByLabelText('Categoría'), { target: { value: 'merchandising' } });
  fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Gorra' } });
  fireEvent.click(within(dialog).getByRole('radio', { name: 'Sin variantes' }));
  fireEvent.change(within(dialog).getByLabelText('Precio (€)'), { target: { value: '12' } });
  const create = within(dialog).getByRole('button', { name: 'Crear producto' });
  fireEvent.click(create); fireEvent.click(create);
  await waitFor(() => assert.ok(document.querySelector('[role="dialog"]') === null), { timeout: 3000 });
  await tick(50);
  assert.equal(posts.filter((post) => post.target.endsWith('/products')).length, 1);
  assert.equal(variantPosts(posts).length, 1);
});

test('H/I: the catalogue shows ONE card per product with its sizes or formats; inventory groups the variants under the product', async () => {
  serve();
  render(React.createElement(StorePage)); await screen.findByRole('heading', { name: 'Camiseta 2J' });
  const cards = screen.getAllByRole('article');
  assert.deepEqual(cards.map((card) => card.getAttribute('aria-label')), ['Camiseta 2J', 'Proteína Whey'], 'no card per variant');
  const wheyCard = within(screen.getByRole('list', { name: 'Productos' })).getByRole('article', { name: 'Proteína Whey' });
  assert.match(wheyCard.querySelector('.product-options').textContent, /Formatos\s*500 g · 1 kg/); assert.match(wheyCard.querySelector('.product-options').textContent, /Sabores\s*Chocolate · Vainilla/);
  assert.match(wheyCard.textContent, /desde\s*19,90\s*€/);
  fireEvent.click(screen.getByRole('tab', { name: 'Inventario' }));
  const groups = [...document.querySelectorAll('tbody.store-group')];
  assert.equal(groups.length, 2);
  assert.match(groups[1].querySelector('.store-group-head').textContent, /Proteína Whey.*3 variantes.*14 uds\./);
  assert.deepEqual([...groups[1].querySelectorAll('tr:not(.store-group-head) td[data-label="Variante"]')].map((cell) => cell.textContent), ['500 g · Chocolate', '500 g · Vainilla', '1 kg · Chocolate']);
  assert.deepEqual([...groups[1].querySelectorAll('tr:not(.store-group-head) td[data-label="Stock"]')].map((cell) => cell.textContent), ['4 uds.', '2 uds.', '8 uds.'], 'stock stays independent per variant');
  assert.equal(document.querySelectorAll('.store-table th[scope="col"], .store-table thead th').length, 5);
});

test('J: selling clothing is Producto → Talla → Unidades, and the existing "Talla M" variant keeps working', async () => {
  const posts = serve({ data: { ...store, products: [{ ...shirt, variants: [variant('s-m', 'Talla M', 'M', null, 20), variant('s-l', 'Talla L', 'L', null, 7)] }, whey] } });
  render(React.createElement(StorePage)); await screen.findByRole('heading', { name: 'Camiseta 2J' });
  fireEvent.click(screen.getByRole('tab', { name: 'Ventas' })); fireEvent.click(screen.getAllByRole('button', { name: 'Nueva venta en el centro' })[0]);
  const dialog = await screen.findByRole('dialog', { name: 'Nueva venta en el centro' });
  assert.equal(within(dialog).queryByLabelText('Talla'), null, 'no size before the product');
  assert.deepEqual([...within(dialog).getByLabelText('Producto').options].map((option) => option.textContent.replace(/ /g, ' ')), ['Selecciona un producto', 'Camiseta 2J', 'Proteína Whey'], 'products, not a giant mix of variants');
  fireEvent.change(within(dialog).getByLabelText('Producto'), { target: { value: 'p-shirt' } });
  assert.deepEqual([...within(dialog).getByLabelText('Talla').options].map((option) => option.textContent.replace(/ /g, ' ')), ['Selecciona', 'M · 18,00 € · 20 uds.', 'L · 18,00 € · 7 uds.']);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Añadir al pedido' }));
  assert.ok(await within(dialog).findByText('Elige la talla antes de añadirlo al pedido.'));
  fireEvent.change(within(dialog).getByLabelText('Talla'), { target: { value: 'M' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Añadir al pedido' }));
  assert.match(within(dialog).getByRole('heading', { name: 'Pedido' }).closest('section').textContent, /Camiseta 2J.*Talla M.*× 1.*18,00/);
  assert.equal(within(dialog).getByLabelText('Producto').value, 'p-shirt', 'the product stays so another size is one step away');
  assert.equal(within(dialog).getByLabelText('Talla').value, '', 'the size resets');
  fireEvent.change(within(dialog).getByLabelText('Talla'), { target: { value: 'L' } }); fireEvent.change(within(dialog).getByLabelText('Unidades'), { target: { value: '8' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Añadir al pedido' }));
  assert.ok(await within(dialog).findByText('Solo quedan 7 uds. de Camiseta 2J · Talla L.'), 'stock is per variant');
  void posts;
});

test('K: selling nutrition is Producto → Formato → Sabor, and the chosen combination is the one added', async () => {
  serve();
  render(React.createElement(StorePage)); await screen.findByRole('heading', { name: 'Camiseta 2J' });
  fireEvent.click(screen.getByRole('tab', { name: 'Ventas' })); fireEvent.click(screen.getAllByRole('button', { name: 'Nueva venta en el centro' })[0]);
  const dialog = await screen.findByRole('dialog', { name: 'Nueva venta en el centro' });
  fireEvent.change(within(dialog).getByLabelText('Producto'), { target: { value: 'p-whey' } });
  assert.deepEqual([...within(dialog).getByLabelText('Formato').options].map((option) => option.textContent.replace(/ /g, ' ')), ['Selecciona', '500 g', '1 kg']);
  assert.equal(within(dialog).queryByLabelText('Sabor'), null, 'the flavor is asked only after the format');
  fireEvent.change(within(dialog).getByLabelText('Formato'), { target: { value: '500 g' } });
  assert.deepEqual([...within(dialog).getByLabelText('Sabor').options].map((option) => option.textContent.replace(/ /g, ' ')), ['Selecciona', 'Chocolate · 19,90 € · 4 uds.', 'Vainilla · 19,90 € · 2 uds.']);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Añadir al pedido' }));
  assert.ok(await within(dialog).findByText('Elige el sabor antes de añadirlo al pedido.'));
  fireEvent.change(within(dialog).getByLabelText('Sabor'), { target: { value: 'Vainilla' } });
  fireEvent.change(within(dialog).getByLabelText('Unidades'), { target: { value: '2' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Añadir al pedido' }));
  assert.match(within(dialog).getByRole('heading', { name: 'Pedido' }).closest('section').textContent, /Proteína Whey.*500 g · Vainilla.*× 2.*39,80/);
  fireEvent.change(within(dialog).getByLabelText('Formato'), { target: { value: '500 g' } }); fireEvent.change(within(dialog).getByLabelText('Sabor'), { target: { value: 'Vainilla' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Añadir al pedido' }));
  assert.ok(await within(dialog).findByText('Solo quedan 2 uds. de Proteína Whey · 500 g · Vainilla y ya has añadido 2 al pedido.'), 'stock is independent per combination');
  fireEvent.change(within(dialog).getByLabelText('Formato'), { target: { value: '1 kg' } });
  fireEvent.change(within(dialog).getByLabelText('Sabor'), { target: { value: 'Chocolate' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Añadir al pedido' }));
  assert.equal(within(dialog).getByRole('heading', { name: 'Pedido' }).closest('section').querySelectorAll('.store-order-line').length, 2);
});

test('L/22: historical sales keep showing the exact variant that was sold, untouched by the new model', async () => {
  const sale = { id: 's1', clientId: 'c1', firstName: 'Lucía', lastName: 'Díaz', status: 'completed', paymentState: 'pending', paymentMethod: 'transfer', totalCents: '1800', createdAt: '2026-10-16T10:00:00Z', lines: [{ productName: 'Camiseta 2J', variantLabel: 'Talla M', quantity: 1, lineTotalCents: 1800 }] };
  serve({ data: { ...store, sales: [sale] } });
  render(React.createElement(StorePage)); await screen.findByRole('heading', { name: 'Camiseta 2J' });
  fireEvent.click(screen.getByRole('tab', { name: 'Ventas' }));
  assert.match(screen.getByText(/Lucía Díaz/).closest('li').textContent, /Camiseta 2J Talla M × 1/);
});

test('variants appear in natural order: XS..4XL and 150 g < 500 g < 1 kg < 2,5 kg, not alphabetically', () => {
  const make = (size, flavor = null) => ({ size, flavor, label: flavor ? `${size} · ${flavor}` : `Talla ${size}` });
  assert.deepEqual(logic.sortVariants(['L', '2XL', 'XS', '4XL', 'M', 'XL', '3XL', 'S'].map((size) => make(size))).map((item) => item.size), ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL']);
  assert.deepEqual(logic.sortVariants([make('1 kg', 'Fresa'), make('500 g', 'Vainilla'), make('2,5 kg'), make('150 g'), make('500 g', 'Chocolate'), make('60 cápsulas')]).map((item) => item.label), ['Talla 60 cápsulas', 'Talla 150 g', '500 g · Chocolate', '500 g · Vainilla', '1 kg · Fresa', 'Talla 2,5 kg']);
  assert.deepEqual(logic.productOptions('nutrition', [make('1 kg'), make('500 g'), make('2 kg')]).sizes, ['500 g', '1 kg', '2 kg']);
});

test('the inventory and the catalogue list a product\'s variants in that natural order even when the API sends them alphabetically', async () => {
  const alphabetical = { ...shirt, variants: ['Talla 2XL', 'Talla L', 'Talla M', 'Talla S', 'Talla XL'].map((label, index) => variant(`v${index}`, label, label.replace('Talla ', ''), null, 1)) };
  serve({ data: { products: [alphabetical], movements: [], sales: [] } });
  render(React.createElement(StorePage)); await screen.findByRole('heading', { name: 'Camiseta 2J' });
  assert.match(document.querySelector('.product-options').textContent, /Tallas\s*S · M · L · XL · 2XL/);
  fireEvent.click(screen.getByRole('tab', { name: 'Inventario' }));
  assert.deepEqual([...document.querySelectorAll('tbody.store-group tr:not(.store-group-head) td[data-label="Variante"]')].map((cell) => cell.textContent), ['Talla S', 'Talla M', 'Talla L', 'Talla XL', 'Talla 2XL']);
});
