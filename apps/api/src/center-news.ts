import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can, type AuthorizationContext } from '@2j/permissions';
import type { createDatabase } from './db.js';
import type { ClientAuthorizationContext } from './communications.js';

type Database = ReturnType<typeof createDatabase>['client'];
const centerKey = '2j';
const newsIdSchema = z.string().uuid().transform((value) => value.toLowerCase());
const plainText = (max: number) => z.string().max(max * 2)
  .transform((value) => value.normalize('NFKC').trim())
  .pipe(z.string().min(1).max(max))
  .refine((value) => !/<\/?[a-z][^>]*>/i.test(value), 'El contenido debe ser texto sin etiquetas HTML.');
const createInput = z.object({ title: plainText(120), body: plainText(5000) }).strict();
const updateInput = z.object({ title: plainText(120).optional(), body: plainText(5000).optional() }).strict()
  .refine((value) => value.title !== undefined || value.body !== undefined);

async function authorizeStaff(
  request: FastifyRequest,
  reply: any,
  resolve: (request: FastifyRequest) => Promise<AuthorizationContext | null>,
  permission: 'news.read' | 'news.manage',
) {
  const actor = await resolve(request);
  if (!actor) { reply.code(401).send({ error: 'authentication_required' }); return null; }
  if (!can(actor, permission)) { reply.code(403).send({ error: 'permission_denied' }); return null; }
  return actor;
}

async function authorizeMember(
  request: FastifyRequest,
  reply: any,
  db: Database,
  resolve: (request: FastifyRequest) => Promise<ClientAuthorizationContext | null>,
) {
  reply.header('Cache-Control', 'no-store');
  const actor = await resolve(request);
  if (!actor || !newsIdSchema.safeParse(actor.clientId).success) {
    reply.code(401).send({ error: 'client_authentication_required' });
    return null;
  }
  const clientId = actor.clientId.toLowerCase();
  const [active] = await db`SELECT id FROM clients WHERE id=${clientId} AND status='active'`;
  if (!active) { reply.code(401).send({ error: 'client_authentication_required' }); return null; }
  return clientId;
}

export function registerCenterNewsRoutes(
  app: FastifyInstance,
  db: Database,
  resolveStaff: (request: FastifyRequest) => Promise<AuthorizationContext | null>,
  resolveMember: (request: FastifyRequest) => Promise<ClientAuthorizationContext | null>,
) {
  app.get('/api/admin/news', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!await authorizeStaff(request, reply, resolveStaff, 'news.read')) return;
    try {
      const items = await db`SELECT id,title,body,status,featured,published_at AS "publishedAt",created_at AS "createdAt",updated_at AS "updatedAt",created_by AS "createdBy",updated_by AS "updatedBy"
        FROM center_news WHERE center_key=${centerKey}
        ORDER BY CASE status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,featured DESC,published_at DESC NULLS LAST,updated_at DESC,id DESC LIMIT 500`;
      return { items };
    } catch {
      request.log.error({ route: 'GET /api/admin/news' }, 'center news query failed');
      return reply.code(500).send({ error: 'internal_error' });
    }
  });

  app.post('/api/admin/news', async (request, reply) => {
    const actor = await authorizeStaff(request, reply, resolveStaff, 'news.manage');
    if (!actor) return;
    const parsed = createInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' });
    try {
      const result = await db.begin(async (tx) => {
        const [item] = await tx`INSERT INTO center_news(center_key,title,body,status,featured,published_at,created_by,updated_by)
          VALUES (${centerKey},${parsed.data.title},${parsed.data.body},'draft',false,NULL,${actor.actorId},${actor.actorId})
          RETURNING id,title,body,status,featured,published_at AS "publishedAt",created_at AS "createdAt",updated_at AS "updatedAt",created_by AS "createdBy",updated_by AS "updatedBy"`;
        if (!item) throw new Error('center_news_insert_missing');
        await writeAudit(tx, item.id, actor.actorId, 'news.created', { status: 'draft' });
        return item;
      });
      return reply.code(201).send(result);
    } catch {
      request.log.error({ route: 'POST /api/admin/news' }, 'center news create failed');
      return reply.code(500).send({ error: 'internal_error' });
    }
  });

  app.patch('/api/admin/news/:newsId', async (request, reply) => {
    const actor = await authorizeStaff(request, reply, resolveStaff, 'news.manage');
    if (!actor) return;
    const params = z.object({ newsId: newsIdSchema }).safeParse(request.params);
    const parsed = updateInput.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: 'validation_error' });
    try {
      const outcome = await db.begin(async (tx) => {
        const [current] = await tx`SELECT id,status,title,body FROM center_news WHERE id=${params.data.newsId} AND center_key=${centerKey} FOR UPDATE`;
        if (!current) return { error: 'news_not_found' as const };
        if (current.status === 'withdrawn') return { error: 'news_not_editable' as const };
        const title = parsed.data.title ?? current.title;
        const body = parsed.data.body ?? current.body;
        const changedFields = [ ...(parsed.data.title !== undefined && parsed.data.title !== current.title ? ['title'] : []), ...(parsed.data.body !== undefined && parsed.data.body !== current.body ? ['body'] : []) ];
        if (changedFields.length === 0) return { error: 'news_unchanged' as const };
        const [item] = await tx`UPDATE center_news SET title=${title},body=${body},updated_by=${actor.actorId},updated_at=now()
          WHERE id=${current.id} RETURNING id,title,body,status,featured,published_at AS "publishedAt",created_at AS "createdAt",updated_at AS "updatedAt",created_by AS "createdBy",updated_by AS "updatedBy"`;
        await writeAudit(tx, current.id, actor.actorId, 'news.updated', { fields: changedFields });
        return { item };
      });
      if ('error' in outcome) return reply.code(outcome.error === 'news_not_found' ? 404 : 409).send({ error: outcome.error });
      return outcome.item;
    } catch {
      request.log.error({ route: 'PATCH /api/admin/news/:newsId' }, 'center news update failed');
      return reply.code(500).send({ error: 'internal_error' });
    }
  });

  app.post('/api/admin/news/:newsId/publish', async (request, reply) => {
    return updateState(request, reply, 'publish');
  });
  app.post('/api/admin/news/:newsId/withdraw', async (request, reply) => {
    return updateState(request, reply, 'withdraw');
  });
  app.post('/api/admin/news/:newsId/feature', async (request, reply) => {
    return updateState(request, reply, 'feature');
  });
  app.post('/api/admin/news/:newsId/unfeature', async (request, reply) => {
    return updateState(request, reply, 'unfeature');
  });

  app.get('/api/admin/news/:newsId/audit', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!await authorizeStaff(request, reply, resolveStaff, 'news.read')) return;
    const params = z.object({ newsId: newsIdSchema }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_news_id' });
    try {
      const [exists] = await db`SELECT 1 FROM center_news WHERE id=${params.data.newsId} AND center_key=${centerKey}`;
      if (!exists) return reply.code(404).send({ error: 'news_not_found' });
      const events = await db`SELECT id,action,actor_id AS "actorId",details,occurred_at AS "occurredAt" FROM center_news_audit_events WHERE center_key=${centerKey} AND news_id=${params.data.newsId} ORDER BY occurred_at DESC,id DESC LIMIT 100`;
      return { events };
    } catch {
      request.log.error({ route: 'GET /api/admin/news/:newsId/audit' }, 'center news audit query failed');
      return reply.code(500).send({ error: 'internal_error' });
    }
  });

  app.get('/api/me/news', async (request, reply) => {
    if (!await authorizeMember(request, reply, db, resolveMember)) return;
    try {
      const items = await db`SELECT id,title,body,featured,published_at AS "publishedAt" FROM center_news
        WHERE center_key=${centerKey} AND status='published' AND published_at<=now()
        ORDER BY published_at DESC,id DESC LIMIT 100`;
      const [featured] = await db`SELECT id,title,body,featured,published_at AS "publishedAt" FROM center_news
        WHERE center_key=${centerKey} AND status='published' AND published_at<=now() AND featured=true
        ORDER BY published_at DESC,id DESC LIMIT 1`;
      return { items, featured: featured ?? items[0] ?? null };
    } catch {
      request.log.error({ route: 'GET /api/me/news' }, 'member news query failed');
      return reply.code(500).send({ error: 'internal_error' });
    }
  });

  async function updateState(request: FastifyRequest, reply: any, operation: 'publish' | 'withdraw' | 'feature' | 'unfeature') {
    const actor = await authorizeStaff(request, reply, resolveStaff, 'news.manage');
    if (!actor) return;
    const params = z.object({ newsId: newsIdSchema }).safeParse(request.params);
    const body = z.object({}).strict().safeParse(request.body ?? {});
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    const action = ({ publish: 'news.published', withdraw: 'news.withdrawn', feature: 'news.featured', unfeature: 'news.unfeatured' } as const)[operation];
    try {
      const outcome = await db.begin(async (tx) => {
        const [item] = await tx`SELECT id,status,featured FROM center_news WHERE id=${params.data.newsId} AND center_key=${centerKey} FOR UPDATE`;
        if (!item) return { error: 'news_not_found' as const };
        if (operation === 'publish') {
          if (!['draft','withdrawn'].includes(item.status)) return { error: 'invalid_news_transition' as const };
          const [updated] = await tx`UPDATE center_news SET status='published',featured=false,published_at=now(),updated_at=now(),updated_by=${actor.actorId} WHERE id=${item.id}
            RETURNING id,title,body,status,featured,published_at AS "publishedAt",created_at AS "createdAt",updated_at AS "updatedAt",created_by AS "createdBy",updated_by AS "updatedBy"`;
          await writeAudit(tx, item.id, actor.actorId, action, { previousStatus: item.status, status: 'published' });
          return { item: updated };
        }
        if (operation === 'withdraw') {
          if (item.status !== 'published') return { error: 'invalid_news_transition' as const };
          const [updated] = await tx`UPDATE center_news SET status='withdrawn',featured=false,updated_at=now(),updated_by=${actor.actorId} WHERE id=${item.id}
            RETURNING id,title,body,status,featured,published_at AS "publishedAt",created_at AS "createdAt",updated_at AS "updatedAt",created_by AS "createdBy",updated_by AS "updatedBy"`;
          await writeAudit(tx, item.id, actor.actorId, action, { previousStatus: 'published', status: 'withdrawn', wasFeatured: item.featured });
          return { item: updated };
        }
        if (item.status !== 'published' || item.featured === (operation === 'feature')) return { error: 'invalid_news_transition' as const };
        const featured = operation === 'feature';
        const [updated] = await tx`UPDATE center_news SET featured=${featured},updated_at=now(),updated_by=${actor.actorId} WHERE id=${item.id}
          RETURNING id,title,body,status,featured,published_at AS "publishedAt",created_at AS "createdAt",updated_at AS "updatedAt",created_by AS "createdBy",updated_by AS "updatedBy"`;
        await writeAudit(tx, item.id, actor.actorId, action, { featured });
        return { item: updated };
      });
      if ('error' in outcome) return reply.code(outcome.error === 'news_not_found' ? 404 : 409).send({ error: outcome.error });
      return outcome.item;
    } catch {
      request.log.error({ route: `POST /api/admin/news/:newsId/${operation}` }, 'center news state change failed');
      return reply.code(500).send({ error: 'internal_error' });
    }
  }
}

async function writeAudit(tx: any, newsId: string, actorId: string, action: string, details: Record<string, unknown>) {
  await tx`INSERT INTO center_news_audit_events(center_key,news_id,actor_id,action,details)
    VALUES (${centerKey},${newsId},${actorId},${action},${JSON.stringify(details)}::jsonb)`;
}
