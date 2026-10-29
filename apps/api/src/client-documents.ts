import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can, type AuthorizationContext } from '@2j/permissions';
import type { createDatabase } from './db.js';
import type { ClientAuthorizationContext } from './communications.js';
import type { ObjectStorage } from './object-storage.js';

type DB = ReturnType<typeof createDatabase>['client'];
const uuid = z.string().uuid().transform((value) => value.toLowerCase());
const titleInput = z.string().max(320).transform((value) => value.normalize('NFKC').trim()).pipe(z.string().min(1).max(160));
const typeInput = z.enum(['contract', 'consent', 'identity', 'other']);
const visibilityInput = z.enum(['staff_only', 'client_visible']);
export const MAX_CLIENT_DOCUMENT_BYTES = 5 * 1024 * 1024;

type DocumentMime = { mime: 'application/pdf' | 'image/jpeg' | 'image/png'; extension: 'pdf' | 'jpg' | 'png' };
export function sniffClientDocument(data: Buffer): DocumentMime | null {
  if (data.length >= 5 && data.subarray(0, 5).toString('ascii') === '%PDF-') return { mime: 'application/pdf', extension: 'pdf' };
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { mime: 'image/jpeg', extension: 'jpg' };
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', extension: 'png' };
  return null;
}

type DocumentActor = { actorId: string; actorKind: 'staff' | 'client'; clientId: string };
type DocumentFileRow = { id: string; clientId: string; objectKey: string; mimeType: string; fileExtension: string };

export function registerClientDocumentRoutes(
  app: FastifyInstance,
  db: DB,
  resolveStaff: (request: FastifyRequest) => Promise<AuthorizationContext | null>,
  resolveClient: (request: FastifyRequest) => Promise<ClientAuthorizationContext | null>,
  storage: ObjectStorage,
) {
  async function staff(request: FastifyRequest, reply: any, permission: 'documents.read' | 'documents.manage') {
    reply.header('Cache-Control', 'no-store');
    const actor = await resolveStaff(request);
    if (!actor) { reply.code(401).send({ error: 'authentication_required' }); return null; }
    if (!can(actor, permission)) { reply.code(403).send({ error: 'permission_denied' }); return null; }
    return actor;
  }

  async function member(request: FastifyRequest, reply: any): Promise<string | null> {
    reply.header('Cache-Control', 'no-store');
    const actor = await resolveClient(request);
    const parsedId = actor && uuid.safeParse(actor.clientId);
    if (!actor || !parsedId?.success) { reply.code(401).send({ error: 'client_authentication_required' }); return null; }
    const clientId = parsedId.data;
    const [active] = await db`SELECT id FROM clients WHERE id=${clientId}::uuid AND status='active'`;
    if (!active) { reply.code(401).send({ error: 'client_authentication_required' }); return null; }
    return clientId;
  }

  async function writeAudit(tx: any, documentId: string, clientId: string, actorId: string, actorKind: 'staff' | 'client', action: 'uploaded' | 'visibility_changed' | 'downloaded', details: Record<string, unknown> = {}) {
    await tx`INSERT INTO client_document_audit_events(document_id,client_id,actor_id,actor_kind,action,details) VALUES (${documentId}::uuid,${clientId}::uuid,${actorId},${actorKind},${action},${JSON.stringify(details)}::jsonb)`;
  }

  async function sendDocument(reply: any, row: { id: string; clientId: string; objectKey: string; mimeType: string; fileExtension: string }, actor: DocumentActor) {
    let bytes: Buffer | null;
    try { bytes = await storage.get(row.objectKey); }
    catch (error) { app.log.error({ documentId: row.id }, 'private document storage read failed'); return reply.code(503).send({ error: 'storage_unavailable' }); }
    if (!bytes) { app.log.error({ documentId: row.id }, 'private document object missing'); return reply.code(404).send({ error: 'document_file_missing' }); }
    try { await db.begin((tx) => writeAudit(tx, row.id, row.clientId, actor.actorId, actor.actorKind, 'downloaded')); }
    catch { return reply.code(500).send({ error: 'internal_error' }); }
    return reply.header('Content-Type', row.mimeType).header('Content-Length', bytes.length)
      .header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', 'sandbox').header('Content-Disposition', `attachment; filename="documento.${row.fileExtension}"`).send(bytes);
  }

  // The bucket/key is private and is never returned. The server generates every object key.
  app.post('/api/clients/:clientId/documents', async (request, reply) => {
    const actor = await staff(request, reply, 'documents.manage'); if (!actor) return;
    const params = z.object({ clientId: uuid }).strict().safeParse(request.params);
    if (!params.success) { request.raw.resume(); return reply.code(400).send({ error: 'validation_error' }); }
    if (!request.isMultipart()) return reply.code(415).send({ error: 'multipart_required' });
    let file: any;
    let bytes: Buffer;
    try {
      file = await request.file();
      if (!file || file.fieldname !== 'file') return reply.code(400).send({ error: 'file_required' });
      bytes = await file.toBuffer();
      if (file.file.truncated || bytes.length > MAX_CLIENT_DOCUMENT_BYTES) return reply.code(413).send({ error: 'file_too_large', maxBytes: MAX_CLIENT_DOCUMENT_BYTES });
    } catch (error: any) {
      if (error?.code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: 'file_too_large', maxBytes: MAX_CLIENT_DOCUMENT_BYTES });
      return reply.code(400).send({ error: 'invalid_upload' });
    }
    if (bytes.length === 0) return reply.code(400).send({ error: 'file_required' });
    const kind = sniffClientDocument(bytes);
    if (!kind) return reply.code(415).send({ error: 'unsupported_document_type', allowed: ['application/pdf', 'image/jpeg', 'image/png'] });
    const fields = file.fields as Record<string, { value?: unknown } | undefined>;
    const title = titleInput.safeParse(fields.title?.value);
    const documentType = typeInput.safeParse(fields.documentType?.value);
    const visibility = visibilityInput.safeParse(fields.visibility?.value ?? 'staff_only');
    if (!title.success || !documentType.success || !visibility.success) return reply.code(400).send({ error: 'validation_error' });
    const clientId = params.data.clientId;
    const id = randomUUID();
    const objectKey = `client-documents/${clientId}/${id}.${kind.extension}`;
    try { await storage.put(objectKey, bytes, { contentType: kind.mime }); }
    catch { app.log.error({ documentId: id }, 'private document storage write failed'); return reply.code(503).send({ error: 'storage_unavailable' }); }
    try {
      const result = await db.begin(async (tx) => {
        const [client] = await tx`SELECT id FROM clients WHERE id=${clientId}::uuid AND status='active' FOR SHARE`;
        if (!client) return { error: 'client_not_found' } as const;
        const [row] = await tx`INSERT INTO client_documents(id,client_id,title,document_type,visibility,object_key,mime_type,file_extension,size_bytes,created_by)
          VALUES (${id}::uuid,${clientId}::uuid,${title.data},${documentType.data},${visibility.data},${objectKey},${kind.mime},${kind.extension},${bytes.length},${actor.actorId})
          RETURNING id,client_id AS "clientId",title,document_type AS "documentType",visibility,mime_type AS "mimeType",size_bytes AS "sizeBytes",created_at AS "createdAt"`;
        await writeAudit(tx, id, clientId, actor.actorId, 'staff', 'uploaded', { documentType: documentType.data, visibility: visibility.data, sizeBytes: bytes.length });
        return { row } as const;
      });
      if ('error' in result) { await storage.delete(objectKey).catch(() => undefined); return reply.code(404).send({ error: result.error }); }
      return reply.code(201).send(result.row);
    } catch {
      await storage.delete(objectKey).catch(() => undefined);
      app.log.error({ documentId: id }, 'private document metadata write failed');
      return reply.code(500).send({ error: 'internal_error' });
    }
  });

  app.get('/api/clients/:clientId/documents', async (request, reply) => {
    const actor = await staff(request, reply, 'documents.read'); if (!actor) return;
    const params = z.object({ clientId: uuid }).strict().safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'validation_error' });
    const items = await db`SELECT id,title,document_type AS "documentType",visibility,mime_type AS "mimeType",size_bytes AS "sizeBytes",created_at AS "createdAt"
      FROM client_documents WHERE client_id=${params.data.clientId}::uuid AND status='active' ORDER BY created_at DESC,id DESC LIMIT 100`;
    return { items };
  });

  app.patch('/api/clients/:clientId/documents/:documentId/visibility', async (request, reply) => {
    const actor = await staff(request, reply, 'documents.manage'); if (!actor) return;
    const params = z.object({ clientId: uuid, documentId: uuid }).strict().safeParse(request.params);
    const body = z.object({ visibility: visibilityInput }).strict().safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    const result = await db.begin(async (tx) => {
      const [row] = await tx`SELECT id,client_id AS "clientId",visibility FROM client_documents WHERE id=${params.data.documentId}::uuid AND client_id=${params.data.clientId}::uuid AND status='active' FOR UPDATE`;
      if (!row) return null;
      if (row.visibility === body.data.visibility) return { id: row.id, clientId: row.clientId, visibility: row.visibility };
      const [updated] = await tx`UPDATE client_documents SET visibility=${body.data.visibility},updated_at=now() WHERE id=${row.id}::uuid RETURNING id,client_id AS "clientId",visibility`;
      await writeAudit(tx, row.id, row.clientId, actor.actorId, 'staff', 'visibility_changed', { from: row.visibility, to: body.data.visibility });
      return updated;
    });
    if (!result) return reply.code(404).send({ error: 'document_not_found' });
    return result;
  });

  app.get('/api/clients/:clientId/documents/:documentId/download', async (request, reply) => {
    const actor = await staff(request, reply, 'documents.read'); if (!actor) return;
    const params = z.object({ clientId: uuid, documentId: uuid }).strict().safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'validation_error' });
    const [row] = await db`SELECT id,client_id AS "clientId",object_key AS "objectKey",mime_type AS "mimeType",file_extension AS "fileExtension" FROM client_documents WHERE id=${params.data.documentId}::uuid AND client_id=${params.data.clientId}::uuid AND status='active'`;
    if (!row) return reply.code(404).send({ error: 'document_not_found' });
    return sendDocument(reply, row as DocumentFileRow, { actorId: actor.actorId, actorKind: 'staff', clientId: row.clientId });
  });

  app.get('/api/client-portal/documents', async (request, reply) => {
    const clientId = await member(request, reply); if (!clientId) return;
    const items = await db`SELECT id,title,document_type AS "documentType",mime_type AS "mimeType",size_bytes AS "sizeBytes",created_at AS "createdAt"
      FROM client_documents WHERE client_id=${clientId}::uuid AND status='active' AND visibility='client_visible' ORDER BY created_at DESC,id DESC LIMIT 100`;
    return { items };
  });

  app.get('/api/client-portal/documents/:documentId/download', async (request, reply) => {
    const clientId = await member(request, reply); if (!clientId) return;
    const params = z.object({ documentId: uuid }).strict().safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'validation_error' });
    const [row] = await db`SELECT id,client_id AS "clientId",object_key AS "objectKey",mime_type AS "mimeType",file_extension AS "fileExtension" FROM client_documents WHERE id=${params.data.documentId}::uuid AND client_id=${clientId}::uuid AND visibility='client_visible' AND status='active'`;
    if (!row) return reply.code(404).send({ error: 'document_not_found' });
    return sendDocument(reply, row as DocumentFileRow, { actorId: clientId, actorKind: 'client', clientId });
  });
}
