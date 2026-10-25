import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can, type AuthorizationContext } from '@2j/permissions';
import type { createDatabase } from './db.js';

type SqlClient = ReturnType<typeof createDatabase>['client'];

const auditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(40),
  beforeAt: z.string().datetime({ offset: true }).optional(),
  beforeId: z.string().uuid().optional(),
}).strict().refine((value) => (value.beforeAt === undefined) === (value.beforeId === undefined), { message: 'cursor_incomplete' });

/**
 * Read-only activity feed for the "Actividad" screen. It lists WHO did WHAT and WHEN across the append-only audit tables of the
 * operational domains. It deliberately returns no `details` payload, no client names and no document or health data: only the
 * action code, the kind of resource, the actor id and the instant. Reading it needs `staff.audit.read` (Admin only today).
 */
export function registerActivityRoutes(app: FastifyInstance<any, any, any, any, any>, db: SqlClient, resolveAuthorization: (request: FastifyRequest) => Promise<AuthorizationContext | null>) {
  app.get('/api/activity/audit', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await resolveAuthorization(request);
    if (!context) return reply.code(401).send({ error: 'authentication_required' });
    if (!can(context, 'staff.audit.read')) return reply.code(403).send({ error: 'permission_denied' });
    const parsed = auditQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' });
    const { limit, beforeAt, beforeId } = parsed.data;
    const rows = await db`
      SELECT id, area, occurred_at AS "occurredAt", actor_id AS "actorId", action, resource_type AS "resourceType" FROM (
        SELECT id, 'economy' AS area, occurred_at, actor_id, action, resource_type FROM economic_audit_events
        UNION ALL SELECT id, 'staff', occurred_at, actor_id, action, resource_type FROM staff_audit_events
        UNION ALL SELECT id, 'calendar', occurred_at, actor_id, action, resource_type FROM calendar_audit_events
        UNION ALL SELECT id, 'communication', occurred_at, actor_id, action, resource_type FROM communication_audit_events
        UNION ALL SELECT id, 'store', occurred_at, actor_id, action, resource_type FROM store_audit_events
      ) e
      WHERE (${beforeAt ?? null}::timestamptz IS NULL OR (e.occurred_at, e.id) < (${beforeAt ?? null}::timestamptz, ${beforeId ?? null}::uuid))
      ORDER BY e.occurred_at DESC, e.id DESC
      LIMIT ${limit + 1}`;
    const items = rows.slice(0, limit).map((row) => ({ id: row.id, area: row.area, occurredAt: new Date(row.occurredAt).toISOString(), actorId: row.actorId, action: row.action, resourceType: row.resourceType }));
    const last = items[items.length - 1];
    return { items, nextCursor: rows.length > limit && last ? { beforeAt: last.occurredAt, beforeId: last.id } : null };
  });
}
