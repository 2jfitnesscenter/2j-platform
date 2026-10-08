import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can, type AuthorizationContext } from '@2j/permissions';
import type { createDatabase } from './db.js';

type SqlClient = ReturnType<typeof createDatabase>['client'];
type ClientStatus = 'active' | 'archived';

const uuid = z.string().uuid().transform((value) => value.toLowerCase());
const normalizedName = (max: number) => z.string().max(512).transform((value) => value.normalize('NFKC').trim()).pipe(z.string().min(1).max(max));
const optionalEmail = z.string().max(2048).nullable().optional()
  .transform((value) => value == null || value.trim() === '' ? null : value.normalize('NFKC').trim().toLocaleLowerCase('en-US'))
  .pipe(z.string().email().max(254).nullable());
const optionalPhone = z.string().max(512).nullable().optional()
  .transform((value) => value == null || value.normalize('NFKC').trim() === '' ? null : value.normalize('NFKC').trim())
  .pipe(z.string().min(1).max(40).nullable());

export const createClientInput = z.object({
  firstName: normalizedName(80),
  lastName: normalizedName(100),
  email: optionalEmail,
  phone: optionalPhone,
}).strict();

const sectionDefinitions = [
  { id: 'summary', label: 'Resumen', permission: 'clients.read', sourceLabel: 'Datos del perfil' },
  { id: 'reservations', label: 'Reservas', permission: 'calendar.read', sourceLabel: 'Calendario' },
  { id: 'payments', label: 'Pagos', permission: 'billing.read-basic', sourceLabel: 'Pagos' },
  { id: 'training', label: 'Entrenamiento', permission: 'training.read', sourceLabel: 'Entrenamiento en 2J Fitness App' },
  { id: 'progress', label: 'Progreso', permission: 'training.read', sourceLabel: 'Progreso en 2J Fitness App' },
  { id: 'health', label: 'Salud', permission: 'health.read', sourceLabel: 'Salud en 2J Fitness App' },
  { id: 'documents', label: 'Documentos/Formularios', permission: 'documents.read', sourceLabel: 'Documentos y formularios' },
  { id: 'messages', label: 'Mensajes', permission: 'communication.read', sourceLabel: 'Comunicación' },
  { id: 'history', label: 'Historial', permission: 'clients.read', sourceLabel: 'Historial del perfil' },
] as const;

const summaryDomains = [
  { id: 'profile', permission: 'clients.read' },
  { id: 'plans', permission: 'entitlements.read' },
  { id: 'reservations', permission: 'calendar.read' },
  { id: 'payments', permission: 'billing.read-basic' },
  { id: 'training', permission: 'training.read' },
  { id: 'progress', permission: 'training.read' },
  { id: 'health', permission: 'health.read' },
  { id: 'documents', permission: 'documents.read' },
  { id: 'messages', permission: 'communication.read' },
] as const;

const listQuery = z.object({
  q: z.string().max(512).optional(),
  status: z.enum(['active', 'archived']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(512).optional(),
}).strict();

type ClientCursor = { lastName: string; firstName: string; id: string };
function parseCursor(value: string | undefined): ClientCursor | null | false {
  if (!value) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const parsed = z.object({ lastName: z.string().max(100), firstName: z.string().max(80), id: uuid }).strict().safeParse(decoded);
    return parsed.success ? { ...parsed.data, id: parsed.data.id } : false;
  } catch { return false; }
}

function encodeCursor(cursor: ClientCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function actorLabel(role: AuthorizationContext['role'] | null) {
  if (role === 'admin') return 'Administración';
  if (role === 'trainer') return 'Entrenador';
  if (role === 'reception-management') return 'Recepción y gestión';
  if (role === 'accountant') return 'Contabilidad';
  return 'Equipo 2J';
}

export function registerClientRoutes(
  app: FastifyInstance<any, any, any, any, any>,
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
    const query = listQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'validation_error' });
    const cursor = parseCursor(query.data.cursor);
    if (cursor === false) return reply.code(400).send({ error: 'invalid_cursor' });
    const term = (query.data.q ?? '').normalize('NFKC').toLocaleLowerCase('es').trim();
    const status = query.data.status ?? 'active';
    const pageCursor = cursor || null;
    try {
      const rows = await database`
        SELECT id,first_name AS "firstName",last_name AS "lastName",email,phone,status,created_at AS "createdAt",
          lower(last_name) AS "cursorLastName",lower(first_name) AS "cursorFirstName"
        FROM clients
        WHERE status=${status}
          AND (${term}='' OR strpos(lower(concat_ws(' ',first_name,last_name,email,phone)),${term}) > 0)
          AND (${pageCursor === null} OR (lower(last_name),lower(first_name),id) > (${pageCursor?.lastName ?? ''},${pageCursor?.firstName ?? ''},${pageCursor?.id ?? '00000000-0000-0000-0000-000000000000'}::uuid))
        ORDER BY lower(last_name),lower(first_name),id
        LIMIT ${query.data.limit + 1}`;
      const hasMore = rows.length > query.data.limit;
      const items = rows.slice(0, query.data.limit).map(({ cursorLastName: _last, cursorFirstName: _first, ...row }) => row);
      const last = rows[Math.min(rows.length, query.data.limit) - 1];
      const nextCursor = hasMore && last ? encodeCursor({ lastName: last.cursorLastName, firstName: last.cursorFirstName, id: last.id }) : null;
      return { items, limit: query.data.limit, nextCursor, hasMore, capabilities: { manage: can(context, 'clients.manage') } };
    } catch (error) { app.log.error({ databaseCode: databaseErrorCode(error), route: 'GET /api/clients' }, 'client list failed'); return reply.code(500).send({ error: 'internal_error' }); }
  });

  app.post('/api/clients', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const context = await authorized(request, reply, 'clients.manage');
    if (!context) return;
    const key = z.string().uuid().safeParse(request.headers['idempotency-key']);
    if (!key.success) return reply.code(400).send({ error: 'idempotency_key_required' });
    const parsed = createClientInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() });
    const { firstName, lastName, email, phone } = parsed.data;
    const requestHash = createHash('sha256').update(JSON.stringify({ firstName, lastName, email, phone })).digest('hex');
    try {
      const result = await database.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key.data.toLowerCase()},0))`;
        const [prior] = await tx`SELECT ci.request_hash AS "requestHash",c.id,c.first_name AS "firstName",c.last_name AS "lastName",c.email,c.phone,c.status,c.created_at AS "createdAt" FROM client_creation_idempotency ci JOIN clients c ON c.id=ci.client_id WHERE ci.idempotency_key=${key.data.toLowerCase()}`;
        if (prior) return prior.requestHash.trim() === requestHash ? { client: prior, replay: true as const } : { error: 'idempotency_conflict' as const };
        const [created] = await tx`INSERT INTO clients(first_name,last_name,email,phone) VALUES (${firstName},${lastName},${email},${phone}) RETURNING id,first_name AS "firstName",last_name AS "lastName",email,phone,status,created_at AS "createdAt"`;
        if (!created) throw new Error('Client insert returned no row.');
        await tx`INSERT INTO client_events(client_id,event_type,actor_id,actor_role) VALUES (${created.id},'client.created',${context.actorId},${context.role})`;
        await tx`INSERT INTO client_creation_idempotency(idempotency_key,request_hash,client_id) VALUES (${key.data.toLowerCase()},${requestHash},${created.id})`;
        return { client: created, replay: false as const };
      });
      if ('error' in result) return reply.code(409).send({ error: result.error, message: 'Esta solicitud ya se usó con datos diferentes. Vuelve a intentarlo.' });
      return reply.code(result.replay ? 200 : 201).send(result.client);
    } catch (error) {
      if (databaseErrorCode(error) === '23505' && databaseErrorConstraint(error) === 'clients_active_email_unique') return reply.code(409).send({ error: 'email_conflict', message: 'Ya existe un cliente activo con ese email.' });
      app.log.error({ databaseCode: databaseErrorCode(error), route: 'POST /api/clients' }, 'client create failed');
      return reply.code(500).send({ error: 'internal_error' });
    }
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
      const events = await database`SELECT id,event_type AS "eventType",actor_role AS "actorRole",occurred_at AS "occurredAt" FROM client_events WHERE client_id=${params.data.clientId} ORDER BY occurred_at DESC,id DESC LIMIT 100`;
      const summary: Record<string, { access: 'available' | 'forbidden'; dataState: string; data: unknown }> = Object.fromEntries(summaryDomains.map(({ id, permission }) => {
        const access: 'available' | 'forbidden' = can(context, permission) ? 'available' : 'forbidden';
        return [id, { access, dataState: 'not_connected', data: null }] as const;
      }));
      const reservations = can(context, 'calendar.read') ? await database`
        SELECT r.id,r.status,s.starts_at AS "startsAt",s.duration_minutes AS "durationMinutes",s.status AS "sessionStatus",svc.name AS "serviceName",a.name AS "areaName"
        FROM calendar_reservations r JOIN calendar_sessions s ON s.id=r.session_id JOIN services svc ON svc.id=s.service_id JOIN areas a ON a.id=s.area_id
        WHERE r.client_id=${params.data.clientId} ORDER BY s.starts_at DESC,r.created_at DESC,r.id DESC LIMIT 100` : [];
      summary.profile = { access: 'available', dataState: 'ready', data: { status: client.status } };
      return {
        client,
        capabilities: { manage: can(context, 'clients.manage') },
        summary,
        reservations,
        sections: sectionDefinitions.map(({ permission, ...section }) => ({ ...section, access: can(context, permission) ? 'available' : 'forbidden', dataState: ['summary', 'history'].includes(section.id) || (section.id === 'reservations' && can(context, 'calendar.read')) ? 'ready' : 'not_connected' })),
        history: events.map((event) => ({ id: event.id, eventType: event.eventType, actorLabel: actorLabel(event.actorRole), occurredAt: event.occurredAt })),
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
        await tx`INSERT INTO client_events(client_id,event_type,actor_id,actor_role) VALUES (${client.id},'client.archived',${context.actorId},${context.role})`;
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

function databaseErrorConstraint(error: unknown) {
  return typeof error === 'object' && error !== null && 'constraint_name' in error ? String(error.constraint_name) : '';
}
