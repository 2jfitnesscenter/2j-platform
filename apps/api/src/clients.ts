import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can, type AuthorizationContext } from '../../../packages/permissions/src/index.js';
import type { createDatabase } from './db.js';

type SqlClient = ReturnType<typeof createDatabase>['client'];
type ClientStatus = 'active' | 'archived';

const uuid = z.string().uuid().transform((value) => value.toLowerCase());
export const createClientInput = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(100),
  email: z.union([z.string().trim().email().max(254), z.literal(''), z.null()]).optional(),
  phone: z.union([z.string().trim().min(1).max(40), z.literal(''), z.null()]).optional(),
}).strict();

const sectionDefinitions = [
  { id: 'summary', label: 'Resumen', permission: 'clients.read', source: 'clients' },
  { id: 'reservations', label: 'Reservas', permission: 'calendar.read', source: 'scheduling' },
  { id: 'payments', label: 'Pagos', permission: 'billing.read-basic', source: 'billing' },
  { id: 'training', label: 'Entrenamiento', permission: 'training.read', source: '2jfitnessapp / Búnker' },
  { id: 'progress', label: 'Progreso', permission: 'training.read', source: '2jfitnessapp / Progress' },
  { id: 'health', label: 'Salud', permission: 'health.read', source: '2jfitnessapp / Health' },
  { id: 'documents', label: 'Documentos/Formularios', permission: 'health.read', source: 'health-documents' },
  { id: 'messages', label: 'Mensajes', permission: 'communication.read', source: 'communications' },
  { id: 'history', label: 'Historial', permission: 'clients.read', source: 'client_events' },
] as const;

export function registerClientRoutes(
  app: FastifyInstance,
  database: SqlClient,
  resolveAuthorization: (request: FastifyRequest) => Promise<AuthorizationContext | null>,
) {
  async function authorized(request: FastifyRequest, reply: { code: (status: number) => { send: (body: unknown) => unknown } }, permission: string) {
    const context = await resolveAuthorization(request);
    if (!context) { reply.code(401).send({ error: 'authentication_required' }); return null; }
    if (!can(context, permission)) { reply.code(403).send({ error: 'permission_denied' }); return null; }
    return context;
  }

  app.get('/api/clients', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await authorized(request, reply, 'clients.read');
    if (!context) return;
    const query = z.object({ q: z.string().trim().max(100).optional(), status: z.enum(['active', 'archived']).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'validation_error', details: query.error.flatten() });
    const term = (query.data.q ?? '').normalize('NFKC').toLocaleLowerCase('es').trim();
    const status = query.data.status ?? 'active';
    try {
      const rows = await database`
        SELECT id,first_name AS "firstName",last_name AS "lastName",email,phone,status,created_at AS "createdAt"
        FROM clients
        WHERE status=${status}
          AND (${term}='' OR strpos(lower(concat_ws(' ',first_name,last_name,email,phone)),${term}) > 0)
        ORDER BY lower(last_name),lower(first_name),id
        LIMIT ${query.data.limit}`;
      return { items: rows, query: query.data.q?.trim() ?? '', limit: query.data.limit, capabilities: { manage: can(context, 'clients.manage') } };
    } catch (error) { app.log.error({ databaseCode: databaseErrorCode(error), route: 'GET /api/clients' }, 'client list failed'); return reply.code(500).send({ error: 'internal_error' }); }
  });

  app.post('/api/clients', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await authorized(request, reply, 'clients.manage');
    if (!context) return;
    const parsed = createClientInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() });
    const firstName = parsed.data.firstName.normalize('NFKC').trim();
    const lastName = parsed.data.lastName.normalize('NFKC').trim();
    const email = parsed.data.email?.trim().toLocaleLowerCase('en-US') || null;
    const phone = parsed.data.phone?.trim() || null;
    try {
      const client = await database.begin(async (tx) => {
        const [created] = await tx`INSERT INTO clients(first_name,last_name,email,phone) VALUES (${firstName},${lastName},${email},${phone}) RETURNING id,first_name AS "firstName",last_name AS "lastName",email,phone,status,created_at AS "createdAt"`;
        await tx`INSERT INTO client_events(client_id,event_type,actor_id) VALUES (${created.id},'client.created',${context.actorId})`;
        return created;
      });
      return reply.code(201).send(client);
    } catch (error) { app.log.error({ databaseCode: databaseErrorCode(error), route: 'POST /api/clients' }, 'client create failed'); return reply.code(500).send({ error: 'internal_error' }); }
  });

  app.get('/api/clients/:clientId', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await authorized(request, reply, 'clients.read');
    if (!context) return;
    const params = z.object({ clientId: uuid }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_client_id' });
    try {
      const [client] = await database`SELECT id,first_name AS "firstName",last_name AS "lastName",email,phone,status,created_at AS "createdAt",updated_at AS "updatedAt" FROM clients WHERE id=${params.data.clientId}`;
      if (!client) return reply.code(404).send({ error: 'client_not_found' });
      const events = await database`SELECT id,event_type AS "eventType",actor_id AS "actorId",occurred_at AS "occurredAt" FROM client_events WHERE client_id=${params.data.clientId} ORDER BY occurred_at DESC,id DESC LIMIT 100`;
      return {
        client,
        capabilities: { manage: can(context, 'clients.manage') },
        summary: { activePlan: null, availableSessions: null, lastActivityAt: null, adherence: null, unpaidBalance: null, nextReservationAt: null },
        sections: sectionDefinitions.map(({ permission, ...section }) => ({ ...section, access: can(context, permission) ? 'available' : 'forbidden', dataState: ['summary', 'history'].includes(section.id) ? 'ready' : 'not_connected' })),
        history: events,
      };
    } catch (error) { app.log.error({ databaseCode: databaseErrorCode(error), route: 'GET /api/clients/:clientId' }, 'client detail failed'); return reply.code(500).send({ error: 'internal_error' }); }
  });

  app.patch('/api/clients/:clientId/archive', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await authorized(request, reply, 'clients.manage');
    if (!context) return;
    const params = z.object({ clientId: uuid }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_client_id' });
    try {
      const result = await database.begin(async (tx) => {
        const [client] = await tx`UPDATE clients SET status='archived',updated_at=now() WHERE id=${params.data.clientId} AND status='active' RETURNING id,first_name AS "firstName",last_name AS "lastName",email,phone,status,created_at AS "createdAt"`;
        if (!client) return null;
        await tx`INSERT INTO client_events(client_id,event_type,actor_id) VALUES (${client.id},'client.archived',${context.actorId})`;
        return client;
      });
      if (!result) return reply.code(404).send({ error: 'client_not_found' });
      return result;
    } catch (error) { app.log.error({ databaseCode: databaseErrorCode(error), route: 'PATCH /api/clients/:clientId/archive' }, 'client archive failed'); return reply.code(500).send({ error: 'internal_error' }); }
  });
}

export type ClientModuleStatus = ClientStatus;

function databaseErrorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code).slice(0, 12) : 'unknown';
}
