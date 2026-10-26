import { randomUUID } from 'node:crypto';
import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthorizationContext } from '@2j/permissions';
import type { createDatabase } from './db.js';
import type { ObjectStorage } from './object-storage.js';
import { audit, staffContext } from './store.js';

type DB = ReturnType<typeof createDatabase>['client'];
const uuid = z.string().uuid().transform((value) => value.toLowerCase());
const centerKey = '2j';

export const MAX_IMAGES_PER_PRODUCT = 6;
/** 5 MB per photo: phone cameras export 2-4 MB JPEGs, and it keeps a 6-photo product under ~30 MB. Larger files are rejected, never silently shrunk. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
export type ImageMime = keyof typeof extensions;

/** The type comes from the file's own bytes. The client-declared type and the file name are ignored (so SVG, HTML or executables renamed to .jpg are refused). */
export function sniffImage(data: Buffer): { mime: ImageMime; extension: string } | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { mime: 'image/jpeg', extension: 'jpg' };
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', extension: 'png' };
  if (data.length >= 12 && data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', extension: 'webp' };
  return null;
}

type MediaRow = { id: string; position: number; isPrimary: boolean; mimeType: string; sizeBytes: number };
const mediaColumns = (tx: any, productId: string) => tx`SELECT id,position,is_primary AS "isPrimary",mime_type AS "mimeType",size_bytes AS "sizeBytes" FROM store_product_media WHERE product_id=${productId}::uuid ORDER BY position`;

export function registerStoreMediaRoutes(app: FastifyInstance, db: DB, resolveStaff: (request: FastifyRequest) => Promise<AuthorizationContext | null>, storage: ObjectStorage) {
  void app.register(multipart, { limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 4, parts: 6 } });
  const bestEffortDelete = async (key: string, reason: string) => { try { await storage.delete(key); return true; } catch (error) { app.log.error({ err: error, objectKey: key, reason }, 'object storage cleanup failed; the object is orphaned'); return false; } };

  // One photo per request (multipart/form-data, field "file"). The UI uploads several in sequence and checks the remaining room first.
  app.post('/api/admin/store/products/:productId/media', async (request, reply) => {
    const actor = await staffContext(request, reply, resolveStaff, 'store.catalog.manage'); if (!actor) return;
    const params = z.object({ productId: uuid }).safeParse(request.params); if (!params.success) return reply.code(400).send({ error: 'validation_error' });
    if (!request.isMultipart()) return reply.code(415).send({ error: 'multipart_required' });
    const productId = params.data.productId;
    const [product] = await db`SELECT id FROM store_products WHERE id=${productId}::uuid AND center_key=${centerKey}`;
    if (!product) { request.raw.resume(); return reply.code(404).send({ error: 'product_not_found' }); }
    const [{ count }] = await db`SELECT count(*)::int AS count FROM store_product_media WHERE product_id=${productId}::uuid` as [{ count: number }];
    if (count >= MAX_IMAGES_PER_PRODUCT) { request.raw.resume(); return reply.code(409).send({ error: 'media_limit_reached', limit: MAX_IMAGES_PER_PRODUCT }); }
    let data: Buffer;
    try {
      const file = await request.file();
      if (!file || file.fieldname !== 'file') return reply.code(400).send({ error: 'file_required' });
      data = await file.toBuffer();
      if (file.file.truncated) return reply.code(413).send({ error: 'file_too_large', maxBytes: MAX_IMAGE_BYTES });
    } catch (error: any) {
      if (error?.code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: 'file_too_large', maxBytes: MAX_IMAGE_BYTES });
      return reply.code(400).send({ error: 'invalid_upload' });
    }
    if (data.length === 0) return reply.code(400).send({ error: 'file_required' });
    if (data.length > MAX_IMAGE_BYTES) return reply.code(413).send({ error: 'file_too_large', maxBytes: MAX_IMAGE_BYTES });
    const kind = sniffImage(data);
    if (!kind) return reply.code(415).send({ error: 'unsupported_media_type', allowed: ['image/jpeg', 'image/png', 'image/webp'] });
    // The backend alone decides the key. Strategy: store the object first, then the row; if the row cannot be written the object is removed again.
    const objectKey = `store/products/${productId}/${randomUUID()}.${kind.extension}`;
    try { await storage.put(objectKey, data, { contentType: kind.mime }); }
    catch (error) { app.log.error({ err: error, route: 'POST store media' }, 'object storage write failed'); return reply.code(503).send({ error: 'storage_unavailable' }); }
    try {
      const created = await db.begin(async (tx) => {
        const [locked] = await tx`SELECT id FROM store_products WHERE id=${productId}::uuid AND center_key=${centerKey} FOR UPDATE`;
        if (!locked) return { error: 'product_not_found' } as const;
        const [{ total }] = await tx`SELECT count(*)::int AS total FROM store_product_media WHERE product_id=${productId}::uuid` as [{ total: number }];
        if (total >= MAX_IMAGES_PER_PRODUCT) return { error: 'media_limit_reached' } as const;
        const [row] = await tx`INSERT INTO store_product_media(product_id,object_key,mime_type,size_bytes,position,is_primary,created_by) VALUES (${productId}::uuid,${objectKey},${kind.mime},${data.length},${total},${total === 0},${actor.actorId}) RETURNING id,position,is_primary AS "isPrimary",mime_type AS "mimeType",size_bytes AS "sizeBytes"`;
        if (!row) throw new Error('store_media_insert_missing');
        await audit(tx, actor.actorId, 'product.media_added', 'product', productId, { mediaId: row.id, position: total, sizeBytes: data.length });
        return { row } as const;
      });
      if ('error' in created) { await bestEffortDelete(objectKey, created.error); return reply.code(created.error === 'product_not_found' ? 404 : 409).send({ error: created.error, limit: MAX_IMAGES_PER_PRODUCT }); }
      return reply.code(201).send(created.row);
    } catch (error) {
      await bestEffortDelete(objectKey, 'database write failed');
      app.log.error({ err: error, route: 'POST store media' }, 'product media insert failed');
      return reply.code(500).send({ error: 'internal_error' });
    }
  });

  app.get('/api/admin/store/media/:mediaId/file', async (request, reply) => {
    const actor = await staffContext(request, reply, resolveStaff, 'store.catalog.read'); if (!actor) return;
    const params = z.object({ mediaId: uuid }).safeParse(request.params); if (!params.success) return reply.code(400).send({ error: 'validation_error' });
    const [media] = await db`SELECT m.object_key AS "objectKey",m.mime_type AS "mimeType" FROM store_product_media m JOIN store_products p ON p.id=m.product_id WHERE m.id=${params.data.mediaId}::uuid AND p.center_key=${centerKey}`;
    if (!media) return reply.code(404).send({ error: 'media_not_found' });
    let data: Buffer | null;
    try { data = await storage.get(media.objectKey); } catch (error) { app.log.error({ err: error }, 'object storage read failed'); return reply.code(503).send({ error: 'storage_unavailable' }); }
    if (!data) { app.log.error({ mediaId: params.data.mediaId }, 'media row without object'); return reply.code(404).send({ error: 'media_missing' }); }
    return reply.header('Content-Type', media.mimeType).header('Content-Length', data.length).header('Cache-Control', 'private, max-age=3600').header('X-Content-Type-Options', 'nosniff').header('Content-Disposition', 'inline').send(data);
  });

  // Reorders the whole gallery. The first id becomes the primary image, so "make primary" is just moving a photo to the front.
  app.put('/api/admin/store/products/:productId/media/order', async (request, reply) => {
    const actor = await staffContext(request, reply, resolveStaff, 'store.catalog.manage'); if (!actor) return;
    const params = z.object({ productId: uuid }).safeParse(request.params);
    const body = z.object({ mediaIds: z.array(uuid).min(1).max(MAX_IMAGES_PER_PRODUCT) }).strict().safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    const productId = params.data.productId; const ids = body.data.mediaIds;
    try {
      const result = await db.begin(async (tx) => {
        const [locked] = await tx`SELECT id FROM store_products WHERE id=${productId}::uuid AND center_key=${centerKey} FOR UPDATE`;
        if (!locked) return { error: 'product_not_found' } as const;
        const current = await mediaColumns(tx, productId) as MediaRow[];
        if (current.length !== ids.length || new Set(ids).size !== ids.length || !current.every((item) => ids.includes(item.id))) return { error: 'media_set_mismatch' } as const;
        await tx`UPDATE store_product_media m SET position=u.pos,is_primary=(u.pos=0) FROM unnest(${ids}::uuid[],${ids.map((_, index) => index)}::int[]) AS u(id,pos) WHERE m.id=u.id AND m.product_id=${productId}::uuid`;
        await audit(tx, actor.actorId, 'product.media_reordered', 'product', productId, { primaryMediaId: ids[0] });
        return { media: await mediaColumns(tx, productId) } as const;
      });
      if ('error' in result) return reply.code(result.error === 'product_not_found' ? 404 : 409).send({ error: result.error });
      return { media: result.media };
    } catch (error) { app.log.error({ err: error, route: 'PUT store media order' }, 'product media reorder failed'); return reply.code(500).send({ error: 'internal_error' }); }
  });

  // The row is the source of truth and goes first (the next photo becomes the primary one, positions stay contiguous); the object is removed afterwards.
  // If that removal fails the photo is already gone for the user: the orphaned object is logged and reported as objectCleanup "failed", never hidden.
  app.delete('/api/admin/store/media/:mediaId', async (request, reply) => {
    const actor = await staffContext(request, reply, resolveStaff, 'store.catalog.manage'); if (!actor) return;
    const params = z.object({ mediaId: uuid }).safeParse(request.params); if (!params.success) return reply.code(400).send({ error: 'validation_error' });
    try {
      const result = await db.begin(async (tx) => {
        const [target] = await tx`SELECT m.id,m.product_id AS "productId",m.object_key AS "objectKey" FROM store_product_media m JOIN store_products p ON p.id=m.product_id WHERE m.id=${params.data.mediaId}::uuid AND p.center_key=${centerKey}`;
        if (!target) return { error: 'media_not_found' } as const;
        await tx`SELECT id FROM store_products WHERE id=${target.productId}::uuid FOR UPDATE`;
        const deleted = await tx`DELETE FROM store_product_media WHERE id=${target.id}::uuid RETURNING id`;
        if (!deleted[0]) return { error: 'media_not_found' } as const;
        await tx`UPDATE store_product_media m SET position=r.next,is_primary=(r.next=0) FROM (SELECT id,(row_number() OVER (ORDER BY position)-1)::int AS next FROM store_product_media WHERE product_id=${target.productId}::uuid) r WHERE m.id=r.id`;
        await audit(tx, actor.actorId, 'product.media_deleted', 'product', target.productId, { mediaId: target.id });
        return { objectKey: target.objectKey as string, media: await mediaColumns(tx, target.productId) } as const;
      });
      if ('error' in result) return reply.code(404).send({ error: result.error });
      const cleaned = await bestEffortDelete(result.objectKey, 'photo deleted');
      return { media: result.media, objectCleanup: cleaned ? 'done' : 'failed' };
    } catch (error) { app.log.error({ err: error, route: 'DELETE store media' }, 'product media delete failed'); return reply.code(500).send({ error: 'internal_error' }); }
  });
}
