import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:5174/#store' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, File: dom.window.File, FormData: dom.window.FormData, IS_REACT_ASSERT: true, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { StorePage } = await import('../src/store-page.tsx');
const media = await import('../src/store-media.ts');
afterEach(() => { cleanup(); globalThis.fetch = undefined; delete window.confirm; });
after(() => dom.window.close());

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const variant = (id, label, size, price = '1800', stock = 5) => ({ id, sku: null, label, size, flavor: null, priceCents: price, active: true, stockTracked: true, stock });
const photo = (id, position, extra = {}) => ({ id, position, isPrimary: position === 0, mimeType: 'image/png', sizeBytes: 1000, ...extra });
const file = (name, type = 'image/png', size = 2000) => { const item = new File([new Uint8Array(Math.min(size, 16))], name, { type }); Object.defineProperty(item, 'size', { value: size }); return item; };

/** A tiny in-memory photo backend so uploads, ordering and deletes behave like the real endpoints. */
function backend({ products }) {
  const state = structuredClone(products); const calls = []; let counter = 100; const fails = { upload: null };
  const find = (id) => state.find((item) => item.id === id);
  const normalise = (product) => { product.media.forEach((item, index) => { item.position = index; item.isPrimary = index === 0; }); };
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url); const method = init.method ?? 'GET';
    if (target.endsWith('/api/admin/store')) return json({ products: state, movements: [], sales: [] });
    const upload = /\/products\/([^/]+)\/media$/.exec(target);
    if (upload && method === 'POST') {
      const product = find(upload[1]); const body = init.body; calls.push(['upload', upload[1], body.get('file').name, init.headers?.['content-type'] ?? null, body instanceof dom.window.FormData]);
      if (fails.upload && fails.upload(body.get('file').name)) return json({ error: 'file_too_large' }, 413);
      if (product.media.length >= 6) return json({ error: 'media_limit_reached' }, 409);
      counter += 1; product.media.push(photo(`m${counter}`, product.media.length)); normalise(product); return json(product.media.at(-1), 201);
    }
    const order = /\/products\/([^/]+)\/media\/order$/.exec(target);
    if (order && method === 'PUT') { const product = find(order[1]); const ids = JSON.parse(init.body).mediaIds; calls.push(['order', ids]); product.media = ids.map((id) => product.media.find((item) => item.id === id)); normalise(product); return json({ media: product.media }); }
    const remove = /\/media\/([^/]+)$/.exec(target);
    if (remove && method === 'DELETE') { const product = state.find((item) => item.media.some((entry) => entry.id === remove[1])); product.media = product.media.filter((entry) => entry.id !== remove[1]); normalise(product); calls.push(['delete', remove[1]]); return json({ media: product.media, objectCleanup: 'done' }); }
    if (target.includes('/api/clients?')) return json({ items: [{ id: 'c1', firstName: 'Eva', lastName: 'Demo', email: null, status: 'active' }] });
    if (method === 'POST' && target.endsWith('/api/admin/store/products')) { const body = JSON.parse(init.body); const product = { id: 'p-new', category: body.category, name: body.name, description: '', active: true, variants: [], media: [] }; state.push(product); calls.push(['product', body.name]); return json(product, 201); }
    if (method === 'POST' && /\/products\/p-new\/variants$/.test(target)) { const body = JSON.parse(init.body); find('p-new').variants.push(variant(`nv${counter += 1}`, body.label, body.size, String(body.priceCents), 0)); calls.push(['variant', body.label]); return json({ id: `nv${counter}` }, 201); }
    return json({ id: 'ok' }, 201);
  };
  return { state, calls, fails };
}
const shirt = (media = []) => ({ id: 'p-shirt', category: 'merchandising', name: 'Camiseta 2J', description: 'Algodón', active: true, variants: [variant('s', 'Talla S', 'S'), variant('m', 'Talla M', 'M'), variant('l', 'Talla L', 'L')], media });
const whey = (media = []) => ({ id: 'p-whey', category: 'nutrition', name: 'Proteína Whey', description: '', active: true, variants: [variant('w1', '500 g', '500 g', '1990'), variant('w2', '1 kg', '1 kg', '3490')], media });
const open = async (products) => { const server = backend({ products }); render(React.createElement(StorePage)); await screen.findByRole('heading', { name: products[0].name }); return server; };
const manage = async (name) => { const card = within(screen.getByRole('list', { name: 'Productos' })).getByRole('article', { name }); fireEvent.click(within(card).getByRole('button', { name: 'Gestionar fotos' })); return screen.findByRole('dialog', { name: `Fotos de ${name}` }); };
const choose = (dialog, files) => { const input = dialog.querySelector('input[type=file]'); fireEvent.change(input, { target: { files } }); };

// ---------- pure rules ----------
test('limits: 6 photos, JPEG/PNG/WebP, 5 MB; the room left is explained before anything is uploaded', () => {
  assert.equal(media.MAX_PHOTOS_PER_PRODUCT, 6); assert.equal(media.MAX_PHOTO_BYTES, 5 * 1024 * 1024); assert.deepEqual([...media.ALLOWED_PHOTO_TYPES], ['image/jpeg', 'image/png', 'image/webp']);
  assert.equal(media.roomMessage(3), 'Puedes añadir 3 imágenes más.'); assert.equal(media.roomMessage(1), 'Puedes añadir 1 imagen más.'); assert.match(media.roomMessage(0), /ya tiene 6 fotos/);
  const five = Array.from({ length: 5 }, (_, index) => ({ name: `f${index}.jpg`, type: 'image/jpeg', size: 1000 }));
  assert.deepEqual(media.validatePhotoSelection(five, 3), { ok: false, errors: ['Puedes añadir 3 imágenes más.'] }, 'a selection that does not fit is refused as a whole');
  assert.equal(media.validatePhotoSelection(five.slice(0, 3), 3).ok, true);
  assert.equal(media.validatePhotoSelection(five.slice(0, 1), 6).errors[0], media.roomMessage(0));
  assert.equal(media.validatePhotoSelection([{ name: 'a.gif', type: 'image/gif', size: 10 }], 0).errors[0], '«a.gif» no es una imagen JPEG, PNG o WebP.');
  assert.equal(media.validatePhotoSelection([{ name: 'a.svg', type: 'image/svg+xml', size: 10 }], 0).ok, false);
  assert.equal(media.validatePhotoSelection([{ name: 'big.jpg', type: 'image/jpeg', size: 5 * 1024 * 1024 + 1 }], 0).errors[0], '«big.jpg» pesa más de 5 MB.');
  assert.equal(media.validatePhotoSelection([{ name: 'ok.webp', type: 'image/webp', size: 5 * 1024 * 1024 }], 0).ok, true, 'exactly 5 MB is allowed');
  assert.equal(media.validatePhotoSelection([{ name: 'IMG_1.JPG', type: '', size: 10 }], 0).ok, true, 'a missing browser type falls back to the extension');
  assert.equal(media.validatePhotoSelection([], 0).ok, false);
});

test('ordering helpers: making a photo primary moves it to the front; moving by one keeps the rest', () => {
  assert.deepEqual(media.withPrimary(['a', 'b', 'c'], 'c'), ['c', 'a', 'b']); assert.deepEqual(media.withPrimary(['a', 'b'], 'x'), ['a', 'b']);
  assert.deepEqual(media.moveBy(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c']); assert.deepEqual(media.moveBy(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c']); assert.deepEqual(media.moveBy(['a', 'b', 'c'], 'c', 1), ['a', 'b', 'c']);
});

test('M: the catalogue price is one amount when every variant costs the same, and "Desde" when they differ', () => {
  const eur = (cents) => `${cents / 100} €`;
  assert.equal(media.catalogPriceText([1800, 1800, 1800], eur), '18 €'); assert.equal(media.catalogPriceText([1800, 2000], eur), 'Desde 18 €'); assert.equal(media.catalogPriceText([], eur), 'Sin variantes activas');
});

// ---------- catalogue, detail, fallback ----------
test('I/J/K: the catalogue card shows the primary photo, falls back to icon + initials without one, and a product with variants has ONE gallery', async () => {
  await open([shirt([photo('m1', 0), photo('m2', 1), photo('m3', 2)]), whey([])]);
  const cards = screen.getAllByRole('article');
  assert.equal(cards.length, 2, 'one card per product, not per variant');
  const withPhoto = within(screen.getByRole('list', { name: 'Productos' })).getByRole('article', { name: 'Camiseta 2J' });
  const img = withPhoto.querySelector('.product-media img');
  assert.match(img.getAttribute('src'), /\/api\/admin\/store\/media\/m1\/file$/, 'the primary photo, not the second');
  assert.equal(withPhoto.querySelectorAll('.product-media img').length, 1);
  assert.match(withPhoto.querySelector('.product-media-count').textContent, /3 fotos/);
  assert.match(withPhoto.textContent, /Tallas\s*S · M · L/);
  const bare = within(screen.getByRole('list', { name: 'Productos' })).getByRole('article', { name: 'Proteína Whey' });
  assert.ok(bare.querySelector('.product-media img') === null); assert.ok(bare.querySelector('.product-media svg')); assert.equal(bare.querySelector('.product-media span').textContent, 'PW');
  assert.match(bare.textContent, /Formatos\s*500 g · 1 kg/); assert.match(bare.textContent, /Desde\s*19,90\s*€/, 'prices differ → Desde');
  assert.match(withPhoto.textContent, /18,00\s*€/); assert.doesNotMatch(withPhoto.textContent, /Desde/, 'same price → just the amount');
});

test('detail: the primary photo is large and the thumbnails swap the preview locally; variants are listed once', async () => {
  await open([shirt([photo('m1', 0), photo('m2', 1), photo('m3', 2)])]);
  fireEvent.click(screen.getByRole('button', { name: 'Ver detalle de Camiseta 2J' }));
  const dialog = await screen.findByRole('dialog', { name: 'Camiseta 2J' });
  assert.match(dialog.querySelector('.gallery-main img').getAttribute('src'), /m1\/file$/);
  const thumbs = within(dialog).getAllByRole('button', { name: /Ver foto \d de 3/ }); assert.equal(thumbs.length, 3);
  fireEvent.click(thumbs[2]);
  assert.match(dialog.querySelector('.gallery-main img').getAttribute('src'), /m3\/file$/); assert.equal(thumbs[2].getAttribute('aria-pressed'), 'true'); assert.equal(thumbs[0].getAttribute('aria-pressed'), 'false');
  assert.equal(within(dialog).getByRole('list', { name: 'Variantes' }).querySelectorAll('li').length, 3);
});

test('detail without photos shows the fallback, and a single photo has no thumbnail strip', async () => {
  await open([whey([]), shirt([photo('only', 0)])]);
  fireEvent.click(screen.getByRole('button', { name: 'Ver detalle de Proteína Whey' }));
  let dialog = await screen.findByRole('dialog', { name: 'Proteína Whey' });
  assert.ok(dialog.querySelector('.store-detail-fallback')); assert.equal(dialog.querySelector('.gallery'), null);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
  await waitFor(() => assert.ok(document.querySelector('.ui-modal') === null));
  fireEvent.click(screen.getByRole('button', { name: 'Ver detalle de Camiseta 2J' }));
  dialog = await screen.findByRole('dialog', { name: 'Camiseta 2J' });
  assert.ok(dialog.querySelector('.gallery-main img')); assert.equal(dialog.querySelector('.gallery-thumbs'), null);
});

// ---------- manager ----------
test('A/B: uploading several photos at once sends multipart requests in order, the first becomes primary and the manager updates', async () => {
  const server = await open([shirt([])]);
  const dialog = await manage('Camiseta 2J');
  assert.match(dialog.textContent, /aún no tiene fotos/); assert.match(dialog.textContent, /Puedes añadir 6 imágenes más\./);
  choose(dialog, [file('frente.jpg', 'image/jpeg'), file('espalda.png'), file('detalle.webp', 'image/webp')]);
  await waitFor(() => assert.equal(server.calls.filter((call) => call[0] === 'upload').length, 3), { timeout: 3000 });
  assert.deepEqual(server.calls.filter((call) => call[0] === 'upload').map((call) => call[2]), ['frente.jpg', 'espalda.png', 'detalle.webp'], 'sequential, in the chosen order');
  assert.ok(server.calls.filter((call) => call[0] === 'upload').every((call) => call[3] === null && call[4] === true), 'FormData without a JSON content-type (the browser sets the multipart boundary)');
  await waitFor(() => assert.equal(within(dialog).getAllByRole('img').length, 3));
  assert.equal(dialog.querySelectorAll('.photo-badge').length, 1, 'exactly one primary badge');
  assert.equal(within(dialog.querySelectorAll('.photo-tile')[0]).queryByText('Principal') !== null, true, 'the first photo is the primary one');
  assert.match(dialog.textContent, /3 de 6 fotos/); assert.match(dialog.textContent, /Puedes añadir 3 imágenes más\./);
});

test('B/C/D: a selection that does not fit is refused before uploading anything and says how many more fit', async () => {
  const server = await open([shirt([photo('m1', 0), photo('m2', 1), photo('m3', 2)])]);
  const dialog = await manage('Camiseta 2J');
  assert.match(dialog.textContent, /Puedes añadir 3 imágenes más\./);
  choose(dialog, Array.from({ length: 5 }, (_, index) => file(`f${index}.jpg`, 'image/jpeg')));
  const alert = await within(dialog).findByRole('alert');
  assert.equal(alert.textContent, 'Puedes añadir 3 imágenes más.');
  assert.equal(server.calls.length, 0, 'nothing was uploaded, so nothing can fail halfway');
});

test('D: with six photos the upload is closed and explains why; the seventh is never sent', async () => {
  const server = await open([shirt(Array.from({ length: 6 }, (_, index) => photo(`m${index}`, index)))]);
  const dialog = await manage('Camiseta 2J');
  assert.match(dialog.textContent, /ya tiene 6 fotos\. Elimina alguna/); assert.equal(within(dialog).getByRole('button', { name: 'Subir fotos' }).disabled, true);
  choose(dialog, [file('septima.jpg', 'image/jpeg')]);
  assert.match((await within(dialog).findByRole('alert')).textContent, /ya tiene 6 fotos/); assert.equal(server.calls.length, 0);
});

test('G/H: GIF, SVG and files over 5 MB are rejected up front with the reason; valid ones in the same selection are not uploaded either', async () => {
  const server = await open([shirt([])]);
  const dialog = await manage('Camiseta 2J');
  choose(dialog, [file('ok.jpg', 'image/jpeg'), file('anim.gif', 'image/gif'), file('logo.svg', 'image/svg+xml'), file('enorme.jpg', 'image/jpeg', 6 * 1024 * 1024)]);
  const alert = await within(dialog).findByRole('alert');
  for (const text of ['«anim.gif» no es una imagen JPEG, PNG o WebP.', '«logo.svg» no es una imagen JPEG, PNG o WebP.', '«enorme.jpg» pesa más de 5 MB.']) assert.ok(alert.textContent.includes(text), text);
  assert.equal(server.calls.length, 0);
});

test('a server failure mid-way stops the batch and reports exactly what was stored', async () => {
  const server = await open([shirt([])]); server.fails.upload = (name) => name === 'b.jpg';
  const dialog = await manage('Camiseta 2J');
  choose(dialog, [file('a.jpg', 'image/jpeg'), file('b.jpg', 'image/jpeg'), file('c.jpg', 'image/jpeg')]);
  const alert = await within(dialog).findByRole('alert', {}, { timeout: 3000 });
  assert.equal(alert.textContent, 'Se subieron 1 de 3. No se pudo subir «b.jpg»: La foto pesa más de 5 MB.');
  assert.equal(server.calls.filter((call) => call[0] === 'upload').length, 2, 'c.jpg was not attempted');
});

test('E/F: with several photos, changing the primary and deleting the primary keep exactly one primary; a single photo shows no primary controls', async () => {
  window.confirm = () => true;
  const server = await open([shirt([photo('a', 0), photo('b', 1), photo('c', 2)])]);
  const dialog = await manage('Camiseta 2J');
    assert.equal(within(dialog).getAllByRole('button', { name: 'Hacer principal' }).length, 2, 'not offered on the one that is already primary');
  fireEvent.click(within(dialog).getAllByRole('button', { name: 'Hacer principal' })[1]);
  await waitFor(() => assert.deepEqual(server.calls.at(-1), ['order', ['c', 'a', 'b']]));
  await waitFor(() => assert.match(dialog.querySelector('.photo-tile img').getAttribute('src'), /c\/file$/));
  assert.equal(dialog.querySelectorAll('.photo-badge').length, 1);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Mover foto 2 después' }));
  await waitFor(() => assert.deepEqual(server.calls.at(-1), ['order', ['c', 'b', 'a']]));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Eliminar foto 1' }));
  await waitFor(() => assert.deepEqual(server.calls.at(-1), ['delete', 'c']));
  await waitFor(() => assert.equal(dialog.querySelectorAll('.photo-tile').length, 2));
  assert.match(dialog.querySelector('.photo-tile img').getAttribute('src'), /b\/file$/, 'the next photo became the primary one');
  assert.equal(dialog.querySelectorAll('.photo-badge').length, 1);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Eliminar foto 2' }));
  await waitFor(() => assert.equal(dialog.querySelectorAll('.photo-tile').length, 1));
  assert.equal(within(dialog).queryByRole('button', { name: 'Hacer principal' }), null); assert.equal(dialog.querySelectorAll('.photo-badge').length, 0, 'one photo needs no "principal" controls');
  assert.equal(within(dialog).queryByRole('button', { name: /Mover foto/ }), null);
  assert.ok(within(dialog).getByRole('button', { name: 'Eliminar foto 1' }));
});

test('deleting asks first and does nothing when cancelled', async () => {
  window.confirm = () => false;
  const server = await open([shirt([photo('a', 0), photo('b', 1)])]);
  const dialog = await manage('Camiseta 2J');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Eliminar foto 2' }));
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(server.calls.length, 0); assert.equal(dialog.querySelectorAll('.photo-tile').length, 2);
});

test('Nutrition: the photos belong to the product; its formats and flavors share one gallery', async () => {
  await open([whey([photo('w-a', 0), photo('w-b', 1)])]);
  const dialog = await manage('Proteína Whey');
  assert.match(dialog.textContent, /Las variantes \(tallas, formatos, sabores\) comparten las fotos del producto/);
  assert.equal(dialog.querySelectorAll('.photo-tile').length, 2);
});

// ---------- creation, sale, inventory ----------
test('creating a product with photos: the product and variants are saved first, then the chosen photos are uploaded to the new product', async () => {
  const server = backend({ products: [shirt([])] });
  render(React.createElement(StorePage)); await screen.findByRole('heading', { name: 'Camiseta 2J' });
  fireEvent.click(screen.getByRole('button', { name: 'Añadir producto' }));
  const dialog = await screen.findByRole('dialog', { name: 'Añadir producto' });
  fireEvent.change(within(dialog).getByLabelText('Categoría'), { target: { value: 'merchandising' } });
  fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Sudadera 2J' } });
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'M' })); fireEvent.change(within(dialog).getByLabelText('Precio (€)'), { target: { value: '35' } });
  const input = dialog.querySelector('.photo-pending input[type=file]');
  fireEvent.change(input, { target: { files: [file('a.jpg', 'image/jpeg'), file('b.png')] } });
  assert.ok(within(dialog).getByText('La primera foto será la principal.'));
  assert.equal(dialog.querySelectorAll('.photo-pending .photo-tile').length, 2);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Quitar b.png' })); assert.equal(dialog.querySelectorAll('.photo-pending .photo-tile').length, 1);
  fireEvent.change(input, { target: { files: [file('b.png')] } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Crear producto' }));
  await waitFor(() => assert.equal(server.calls.filter((call) => call[0] === 'upload').length, 2), { timeout: 4000 });
  assert.deepEqual(server.calls.map((call) => call[0]), ['product', 'variant', 'upload', 'upload'], 'product → variants → photos');
  assert.ok(server.calls.filter((call) => call[0] === 'upload').every((call) => call[1] === 'p-new'));
  await waitFor(() => assert.ok(document.querySelector('.ui-modal') === null));
  assert.match(screen.getByRole('status').textContent, /Producto creado con 1 variante\. 2 fotos añadidas\./);
});

test('L/20: selling keeps Producto → Talla → Cantidad, and shows a small photo of the chosen product', async () => {
  await open([shirt([photo('m1', 0)]), whey([])]);
  fireEvent.click(screen.getByRole('tab', { name: 'Ventas' })); fireEvent.click(screen.getAllByRole('button', { name: 'Nueva venta en el centro' })[0]);
  const dialog = await screen.findByRole('dialog', { name: 'Nueva venta en el centro' });
  assert.equal(dialog.querySelector('.store-sale-product'), null, 'no photo before choosing');
  fireEvent.change(within(dialog).getByLabelText('Producto'), { target: { value: 'p-shirt' } });
  assert.match(dialog.querySelector('.store-sale-product img').getAttribute('src'), /m1\/file$/); assert.match(dialog.querySelector('.store-sale-product').textContent, /Camiseta 2J/);
  assert.ok(within(dialog).getByLabelText('Talla')); fireEvent.change(within(dialog).getByLabelText('Talla'), { target: { value: 'M' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Añadir al pedido' }));
  assert.match(within(dialog).getByRole('heading', { name: 'Pedido' }).closest('section').textContent, /Camiseta 2J.*Talla M.*× 1/);
  fireEvent.change(within(dialog).getByLabelText('Producto'), { target: { value: 'p-whey' } });
  assert.equal(dialog.querySelector('.store-sale-product'), null, 'a product without photo shows none');
  assert.ok(within(dialog).getByLabelText('Formato'));
});

test('19: inventory stays focused on variants and stock, with a small product photo in each group heading when there is one', async () => {
  await open([shirt([photo('m1', 0)]), whey([])]);
  fireEvent.click(screen.getByRole('tab', { name: 'Inventario' }));
  const groups = [...document.querySelectorAll('tbody.store-group')];
  assert.match(groups[0].querySelector('.store-group-thumb').getAttribute('src'), /m1\/file$/); assert.equal(groups[1].querySelector('.store-group-thumb'), null);
  assert.deepEqual([...groups[0].querySelectorAll('tr:not(.store-group-head) td[data-label="Variante"]')].map((cell) => cell.textContent), ['Talla S', 'Talla M', 'Talla L']);
});
