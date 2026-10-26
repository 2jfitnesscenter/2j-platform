import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';
import { LocalObjectStorage, MemoryObjectStorage } from '../src/object-storage.ts';
import { MAX_IMAGES_PER_PRODUCT, MAX_IMAGE_BYTES, sniffImage } from '../src/store-media.ts';

process.env.NODE_ENV ??= 'test';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: Store media integration tests cannot be skipped.');
const sql = postgres(process.env.DATABASE_URL, { max: 8, connect_timeout: 5 }); await migrateDatabase(sql);

// ---------- fixtures ----------
const png = (extra = 0) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32 + extra, 7)]);
const jpeg = (extra = 0) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32 + extra, 9)]);
const webp = () => Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x20, 0, 0, 0]), Buffer.from('WEBP'), Buffer.from('VP8 '), Buffer.alloc(24, 1)]);
const multipart = (data, { filename = 'foto.png', type = 'image/png', field = 'file' } = {}) => {
  const boundary = `----2jtest${randomUUID().replaceAll('-', '')}`;
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`);
  return { payload: Buffer.concat([head, data, Buffer.from(`\r\n--${boundary}--\r\n`)]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
};

class HookedStorage extends MemoryObjectStorage { afterPut = null; failDelete = false;
  async put(key, data, options) { await super.put(key, data, options); if (this.afterPut) await this.afterPut(key); }
  async delete(key) { if (this.failDelete) throw new Error('storage delete failed'); await super.delete(key); } }
const storage = new HookedStorage();
const admin = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'media-test-admin', role: 'admin' }), objectStorage: storage });
const trainer = buildServer(process.env.DATABASE_URL, { authorizationResolver: async () => ({ actorId: 'media-test-trainer', role: 'trainer' }), objectStorage: storage });
after(async () => { await Promise.all([admin.close(), trainer.close()]); await sql.end(); });

async function newProduct() { const response = await admin.inject({ method: 'POST', url: '/api/admin/store/products', payload: { category: 'merchandising', name: `Camiseta ${randomUUID()}`, description: '' } }); assert.equal(response.statusCode, 201); return response.json().id; }
const upload = (productId, data, options, server = admin) => server.inject({ method: 'POST', url: `/api/admin/store/products/${productId}/media`, ...multipart(data, options) });
const dbMedia = (productId) => sql`SELECT id,position,is_primary AS "isPrimary",object_key AS "objectKey" FROM store_product_media WHERE product_id=${productId}::uuid ORDER BY position`;
const adminStore = async () => (await admin.inject({ method: 'GET', url: '/api/admin/store' })).json();

// ---------- pure units ----------
test('image type is decided from the bytes: JPEG, PNG and WebP pass; SVG, HTML, GIF, executables and empty files do not, whatever they are called', () => {
  assert.equal(sniffImage(jpeg()).mime, 'image/jpeg'); assert.equal(sniffImage(png()).mime, 'image/png'); assert.equal(sniffImage(webp()).mime, 'image/webp');
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(sniffImage(Buffer.from('<!doctype html><script>alert(1)</script>')), null);
  assert.equal(sniffImage(Buffer.from('GIF89a......')), null);
  assert.equal(sniffImage(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03])), null, 'Windows executable');
  assert.equal(sniffImage(Buffer.from('RIFF....WAVEfmt ')), null, 'RIFF container that is not WebP');
  assert.equal(sniffImage(Buffer.alloc(0)), null);
  assert.equal(MAX_IMAGES_PER_PRODUCT, 6); assert.equal(MAX_IMAGE_BYTES, 5 * 1024 * 1024);
});

test('LocalObjectStorage writes atomically, reads back, deletes idempotently and refuses keys that could leave its folder', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), '2j-storage-'));
  try {
    const local = new LocalObjectStorage(root);
    await local.put('store/products/abc/one.png', png(), { contentType: 'image/png' });
    assert.deepEqual(await local.get('store/products/abc/one.png'), png());
    assert.deepEqual((await readdir(path.join(root, 'store/products/abc'))), ['one.png'], 'no temporary file is left behind');
    await local.delete('store/products/abc/one.png'); await local.delete('store/products/abc/one.png');
    assert.equal(await local.get('store/products/abc/one.png'), null);
    for (const bad of ['../escape.png', '/etc/passwd', 'a/../../b', 'C:\\windows\\x', 'a//b', 'UPPER/Case.png', '', 'a/b/']) await assert.rejects(() => local.put(bad, png(), { contentType: 'image/png' }), /Invalid object key/, bad);
    await assert.rejects(() => local.get('../x'), /Invalid object key/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// ---------- API ----------
test('only roles that manage the catalogue can upload, reorder or delete photos; reading needs catalogue read access', async () => {
  const productId = await newProduct();
  assert.equal((await upload(productId, png(), {}, trainer)).statusCode, 403);
  const first = await upload(productId, png()); assert.equal(first.statusCode, 201);
  assert.equal((await trainer.inject({ method: 'GET', url: `/api/admin/store/media/${first.json().id}/file` })).statusCode, 403);
  assert.equal((await trainer.inject({ method: 'DELETE', url: `/api/admin/store/media/${first.json().id}` })).statusCode, 403);
  assert.equal((await trainer.inject({ method: 'PUT', url: `/api/admin/store/products/${productId}/media/order`, payload: { mediaIds: [first.json().id] } })).statusCode, 403);
});

test('the first photo becomes the primary one automatically, the rest follow in order, and the file is served with safe headers', async () => {
  const productId = await newProduct();
  const a = (await upload(productId, png())).json(); const b = (await upload(productId, jpeg(), { filename: 'b.jpg', type: 'image/jpeg' })).json(); const c = (await upload(productId, webp(), { filename: 'c.webp', type: 'image/webp' })).json();
  assert.deepEqual([a.position, a.isPrimary, b.position, b.isPrimary, c.position, c.isPrimary], [0, true, 1, false, 2, false]);
  assert.deepEqual([a.mimeType, b.mimeType, c.mimeType], ['image/png', 'image/jpeg', 'image/webp']);
  const file = await admin.inject({ method: 'GET', url: `/api/admin/store/media/${a.id}/file` });
  assert.equal(file.statusCode, 200); assert.equal(file.headers['content-type'], 'image/png'); assert.equal(file.headers['x-content-type-options'], 'nosniff'); assert.match(file.headers['cache-control'], /private/);
  assert.deepEqual(file.rawPayload, png());
  const listed = (await adminStore()).products.find((product) => product.id === productId);
  assert.deepEqual(listed.media.map((item) => [item.position, item.isPrimary]), [[0, true], [1, false], [2, false]]);
  assert.ok(!JSON.stringify(listed.media).includes('store/products'), 'object keys and paths never reach the browser');
});

test('the object key is chosen by the backend, ignoring the uploaded file name, and the real type wins over the declared one', async () => {
  const productId = await newProduct();
  const response = await upload(productId, jpeg(), { filename: '../../evil.html', type: 'text/html' });
  assert.equal(response.statusCode, 201, 'a real JPEG is accepted even if mislabelled');
  assert.equal(response.json().mimeType, 'image/jpeg');
  const [row] = await dbMedia(productId);
  assert.match(row.objectKey, new RegExp(`^store/products/${productId}/[0-9a-f-]{36}\\.jpg$`));
  assert.ok(!row.objectKey.includes('evil'));
});

test('a seventh photo is refused with 409 and nothing is stored for it', async () => {
  const productId = await newProduct();
  for (let index = 0; index < MAX_IMAGES_PER_PRODUCT; index += 1) assert.equal((await upload(productId, png(index))).statusCode, 201);
  const before = storage.objects.size;
  const seventh = await upload(productId, png(99));
  assert.equal(seventh.statusCode, 409); assert.equal(seventh.json().error, 'media_limit_reached'); assert.equal(seventh.json().limit, 6);
  assert.equal(storage.objects.size, before, 'the rejected photo never reached storage');
  assert.equal((await dbMedia(productId)).length, 6);
});

test('SVG, HTML, GIF and executables are rejected with 415, even when declared as images', async () => {
  const productId = await newProduct(); const before = storage.objects.size;
  for (const [name, data, type] of [['x.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/svg+xml'], ['x.jpg', Buffer.from('<html><body>hi</body></html>'), 'image/jpeg'], ['x.png', Buffer.from('GIF89a' + 'x'.repeat(20)), 'image/png'], ['x.exe', Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0, 0, 0]), 'application/octet-stream']]) {
    const response = await upload(productId, data, { filename: name, type });
    assert.equal(response.statusCode, 415, name); assert.equal(response.json().error, 'unsupported_media_type');
  }
  assert.equal(storage.objects.size, before); assert.equal((await dbMedia(productId)).length, 0);
});

test('a photo over 5 MB is rejected with 413 and nothing is stored; exactly 5 MB is accepted', async () => {
  const productId = await newProduct(); const before = storage.objects.size;
  const tooBig = await upload(productId, jpeg(MAX_IMAGE_BYTES), { filename: 'big.jpg', type: 'image/jpeg' });
  assert.equal(tooBig.statusCode, 413); assert.equal(tooBig.json().error, 'file_too_large'); assert.equal(tooBig.json().maxBytes, MAX_IMAGE_BYTES);
  assert.equal(storage.objects.size, before);
  const exact = await upload(productId, jpeg(MAX_IMAGE_BYTES - 36), { filename: 'ok.jpg', type: 'image/jpeg' });
  assert.equal(exact.statusCode, 201); assert.equal(exact.json().sizeBytes, MAX_IMAGE_BYTES);
});

test('bad requests: unknown product 404, missing file 400, not multipart 415, wrong field name 400', async () => {
  assert.equal((await upload(randomUUID(), png())).statusCode, 404);
  const productId = await newProduct();
  assert.equal((await admin.inject({ method: 'POST', url: `/api/admin/store/products/${productId}/media`, payload: { base64: 'abc' } })).statusCode, 415, 'JSON/base64 is not accepted');
  assert.equal((await upload(productId, png(), { field: 'photo' })).statusCode, 400);
  assert.equal((await admin.inject({ method: 'POST', url: '/api/admin/store/products/not-a-uuid/media', ...multipart(png()) })).statusCode, 400);
});

test('deleting the primary photo promotes the next one; positions stay contiguous and exactly one photo is primary', async () => {
  const productId = await newProduct();
  const ids = []; for (let index = 0; index < 3; index += 1) ids.push((await upload(productId, png(index))).json().id);
  const removed = await admin.inject({ method: 'DELETE', url: `/api/admin/store/media/${ids[0]}` });
  assert.equal(removed.statusCode, 200); assert.equal(removed.json().objectCleanup, 'done');
  assert.deepEqual(removed.json().media.map((item) => [item.id, item.position, item.isPrimary]), [[ids[1], 0, true], [ids[2], 1, false]]);
  const rows = await dbMedia(productId); assert.equal(rows.filter((row) => row.isPrimary).length, 1); assert.deepEqual(rows.map((row) => row.position), [0, 1]);
  assert.equal(await storage.get(rows[0].objectKey) !== null, true);
  assert.equal((await admin.inject({ method: 'GET', url: `/api/admin/store/media/${ids[0]}/file` })).statusCode, 404);
  await admin.inject({ method: 'DELETE', url: `/api/admin/store/media/${ids[1]}` }); const last = await admin.inject({ method: 'DELETE', url: `/api/admin/store/media/${ids[2]}` });
  assert.deepEqual(last.json().media, [], 'a product can end with no photos');
  assert.equal((await admin.inject({ method: 'DELETE', url: `/api/admin/store/media/${ids[2]}` })).statusCode, 404);
});

test('reordering moves the chosen photo to the front as the new primary, and rejects lists that are not exactly the gallery', async () => {
  const productId = await newProduct();
  const ids = []; for (let index = 0; index < 4; index += 1) ids.push((await upload(productId, png(index))).json().id);
  const put = (mediaIds) => admin.inject({ method: 'PUT', url: `/api/admin/store/products/${productId}/media/order`, payload: { mediaIds } });
  const swapped = await put([ids[2], ids[0], ids[1], ids[3]]);
  assert.equal(swapped.statusCode, 200);
  assert.deepEqual(swapped.json().media.map((item) => [item.id, item.position, item.isPrimary]), [[ids[2], 0, true], [ids[0], 1, false], [ids[1], 2, false], [ids[3], 3, false]]);
  assert.equal((await dbMedia(productId)).filter((row) => row.isPrimary).length, 1, 'only one primary');
  assert.equal((await put([ids[0], ids[1]])).statusCode, 409, 'missing photos');
  assert.equal((await put([ids[0], ids[0], ids[1], ids[2]])).statusCode, 409, 'duplicates');
  assert.equal((await put([randomUUID(), ids[1], ids[2], ids[3]])).statusCode, 409, 'foreign photo');
  assert.equal((await admin.inject({ method: 'PUT', url: `/api/admin/store/products/${productId}/media/order`, payload: { mediaIds: [], extra: 1 } })).statusCode, 400);
  assert.equal((await dbMedia(productId))[0].id, ids[2], 'a rejected order changes nothing');
});

test('the database enforces one primary photo and at most six positions', async () => {
  const productId = await newProduct(); await upload(productId, png());
  await assert.rejects(() => sql`INSERT INTO store_product_media(product_id,object_key,mime_type,size_bytes,position,is_primary,created_by) VALUES (${productId}::uuid,${`store/products/${productId}/x.png`},'image/png',10,1,true,'t')`, /store_product_media_primary_is_first/);
  await assert.rejects(() => sql`INSERT INTO store_product_media(product_id,object_key,mime_type,size_bytes,position,is_primary,created_by) VALUES (${productId}::uuid,${`store/products/${productId}/y.png`},'image/png',10,6,false,'t')`, /position/);
  await assert.rejects(() => sql`INSERT INTO store_product_media(product_id,object_key,mime_type,size_bytes,position,is_primary,created_by) VALUES (${productId}::uuid,${`store/products/${productId}/z.gif`},'image/gif',10,1,false,'t')`, /mime_type/);
});

test('if the database refuses the row after the file was stored (a concurrent upload filled the gallery), the stored object is removed again', async () => {
  const productId = await newProduct();
  for (let index = 0; index < 5; index += 1) assert.equal((await upload(productId, png(index))).statusCode, 201);
  storage.afterPut = async () => { await sql`INSERT INTO store_product_media(product_id,object_key,mime_type,size_bytes,position,is_primary,created_by) VALUES (${productId}::uuid,${`store/products/${productId}/${randomUUID()}.png`},'image/png',10,5,false,'race')`; };
  const before = storage.objects.size;
  try {
    const response = await upload(productId, png(123));
    assert.equal(response.statusCode, 409); assert.equal(response.json().error, 'media_limit_reached');
  } finally { storage.afterPut = null; }
  assert.equal(storage.objects.size, before, 'the object stored for the rejected photo was cleaned up');
});

test('if removing the object fails after a photo was deleted, the response says so instead of hiding it', async () => {
  const productId = await newProduct(); const id = (await upload(productId, png())).json().id;
  storage.failDelete = true;
  try {
    const removed = await admin.inject({ method: 'DELETE', url: `/api/admin/store/media/${id}` });
    assert.equal(removed.statusCode, 200); assert.equal(removed.json().objectCleanup, 'failed'); assert.deepEqual(removed.json().media, []);
  } finally { storage.failDelete = false; }
  assert.equal((await dbMedia(productId)).length, 0, 'the photo is gone for the user; only an orphaned object remains (logged)');
});

test('all variants of a product share its single gallery; images belong to the product, not to variants', async () => {
  const productId = await newProduct();
  for (const label of ['Talla S', 'Talla M']) assert.equal((await admin.inject({ method: 'POST', url: `/api/admin/store/products/${productId}/variants`, payload: { label, size: label.slice(-1), priceCents: 1800 } })).statusCode, 201);
  await upload(productId, png()); await upload(productId, jpeg(), { filename: 'b.jpg', type: 'image/jpeg' });
  const product = (await adminStore()).products.find((item) => item.id === productId);
  assert.equal(product.variants.length, 2); assert.equal(product.media.length, 2);
  assert.ok(product.variants.every((variant) => !('media' in variant) && !('imageId' in variant)));
});
