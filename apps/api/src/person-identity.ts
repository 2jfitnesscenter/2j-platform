import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { can, type AuthorizationContext } from '@2j/permissions';
import type { createDatabase } from './db.js';

type SqlClient = ReturnType<typeof createDatabase>['client'];
const uuid = z.string().uuid().transform((value) => value.toLowerCase());
const facetInput = z.object({ clientId: uuid.optional(), staffId: uuid.optional() }).strict().refine((value) => value.clientId || value.staffId, 'At least one Platform facet is required');
const trainingLinkInput = z.object({ requestId: uuid, trainingUserId: z.string().trim().min(1).max(200) }).strict();

export function registerPersonIdentityRoutes(app: FastifyInstance<any, any, any, any, any>, database: SqlClient, resolveAuthorization: (request: FastifyRequest) => Promise<AuthorizationContext | null>) {
  async function authorized(request: FastifyRequest, reply: any) {
    reply.header('Cache-Control', 'no-store');
    const actor = await resolveAuthorization(request);
    if (!actor) { reply.code(401).send({ error: 'authentication_required' }); return null; }
    if (!can(actor, 'identity.people.manage')) { reply.code(403).send({ error: 'permission_denied' }); return null; }
    return actor;
  }
  app.post('/api/platform/v1/persons', async (request, reply) => {
    const actor = await authorized(request, reply); if (!actor) return;
    const parsed = facetInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' });
    const personId = randomUUID();
    try {
      const subject = await database.begin(async (tx) => {
        await tx`INSERT INTO platform_persons(id,created_by) VALUES (${personId},${actor.actorId})`;
        if (parsed.data.clientId) await tx`INSERT INTO platform_person_clients(person_id,client_id,linked_by) SELECT ${personId},id,${actor.actorId} FROM clients WHERE id=${parsed.data.clientId} AND status='active'`;
        if (parsed.data.staffId) await tx`INSERT INTO platform_person_staff(person_id,professional_id,linked_by) SELECT ${personId},id,${actor.actorId} FROM staff_professionals WHERE id=${parsed.data.staffId} AND status='active'`;
        const counts = await tx`SELECT (SELECT count(*) FROM platform_person_clients WHERE person_id=${personId})::int AS clients,(SELECT count(*) FROM platform_person_staff WHERE person_id=${personId})::int AS staff`;
        if (!counts[0] || counts[0].clients !== (parsed.data.clientId ? 1 : 0) || counts[0].staff !== (parsed.data.staffId ? 1 : 0)) throw Object.assign(new Error('Facet unavailable'), { code: 'FACET_UNAVAILABLE' });
        await tx`INSERT INTO platform_identity_audit_events(person_id,actor_id,action,resource_id,details) VALUES (${personId},${actor.actorId},'person.created',${personId},${JSON.stringify({ hasClient: !!parsed.data.clientId, hasStaff: !!parsed.data.staffId })}::jsonb)`;
        return { v: 1, personId, ...(parsed.data.clientId ? { clientId: parsed.data.clientId } : {}), ...(parsed.data.staffId ? { staffId: parsed.data.staffId } : {}), capabilities: [ ...(parsed.data.clientId ? ['client'] : []), ...(parsed.data.staffId ? ['staff'] : []) ], status: 'active' };
      });
      return reply.code(201).send(subject);
    } catch (error) {
      const code = (error as { code?: string }).code;
      return reply.code(code === '23505' ? 409 : code === 'FACET_UNAVAILABLE' ? 404 : 500).send({ error: code === '23505' ? 'facet_already_linked' : code === 'FACET_UNAVAILABLE' ? 'facet_unavailable' : 'internal_error' });
    }
  });
  app.get('/api/platform/v1/persons/:personId', async (request, reply) => {
    const actor = await authorized(request, reply); if (!actor) return;
    const params = z.object({ personId: uuid }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'validation_error' });
    try {
      const rows = await database`SELECT p.id AS "personId",p.status,cl.client_id AS "clientId",sf.professional_id AS "staffId" FROM platform_persons p LEFT JOIN platform_person_clients cl ON cl.person_id=p.id LEFT JOIN platform_person_staff sf ON sf.person_id=p.id WHERE p.id=${params.data.personId}`;
      const row = rows[0]; if (!row) return reply.code(404).send({ error: 'person_not_found' });
      return { v: 1, personId: row.personId, ...(row.clientId ? { clientId: row.clientId } : {}), ...(row.staffId ? { staffId: row.staffId } : {}), capabilities: [ ...(row.clientId ? ['client'] : []), ...(row.staffId ? ['staff'] : []) ], status: row.status };
    } catch { return reply.code(500).send({ error: 'internal_error' }); }
  });
  app.post('/api/platform/v1/persons/:personId/facets', async (request, reply) => {
    const actor = await authorized(request, reply); if (!actor) return;
    const params = z.object({ personId: uuid }).safeParse(request.params); const body = facetInput.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    try {
      const subject = await database.begin(async (tx) => {
        const people = await tx`SELECT id,status FROM platform_persons WHERE id=${params.data.personId} FOR UPDATE`;
        if (!people[0] || people[0].status !== 'active') throw Object.assign(new Error('Person unavailable'), { code: 'PERSON_UNAVAILABLE' });
        if (body.data.clientId) {
          const inserted = await tx`INSERT INTO platform_person_clients(person_id,client_id,linked_by) SELECT ${params.data.personId},id,${actor.actorId} FROM clients WHERE id=${body.data.clientId} AND status='active' RETURNING client_id`;
          if (!inserted.length) throw Object.assign(new Error('Client unavailable'), { code: 'FACET_UNAVAILABLE' });
          await tx`INSERT INTO platform_identity_audit_events(person_id,actor_id,action,resource_id) VALUES (${params.data.personId},${actor.actorId},'person.client_linked',${body.data.clientId})`;
        }
        if (body.data.staffId) {
          const inserted = await tx`INSERT INTO platform_person_staff(person_id,professional_id,linked_by) SELECT ${params.data.personId},id,${actor.actorId} FROM staff_professionals WHERE id=${body.data.staffId} AND status='active' RETURNING professional_id`;
          if (!inserted.length) throw Object.assign(new Error('Staff unavailable'), { code: 'FACET_UNAVAILABLE' });
          await tx`INSERT INTO platform_identity_audit_events(person_id,actor_id,action,resource_id) VALUES (${params.data.personId},${actor.actorId},'person.staff_linked',${body.data.staffId})`;
        }
        const rows = await tx`SELECT p.id AS "personId",p.status,cl.client_id AS "clientId",sf.professional_id AS "staffId" FROM platform_persons p LEFT JOIN platform_person_clients cl ON cl.person_id=p.id LEFT JOIN platform_person_staff sf ON sf.person_id=p.id WHERE p.id=${params.data.personId}`;
        const row = rows[0];
        if (!row) throw Object.assign(new Error('Person unavailable'), { code: 'PERSON_UNAVAILABLE' });
        return { v: 1, personId: row.personId, ...(row.clientId ? { clientId: row.clientId } : {}), ...(row.staffId ? { staffId: row.staffId } : {}), capabilities: [ ...(row.clientId ? ['client'] : []), ...(row.staffId ? ['staff'] : []) ], status: row.status };
      });
      return subject;
    } catch (error) {
      const code = (error as { code?: string }).code;
      return reply.code(code === '23505' ? 409 : code === 'PERSON_UNAVAILABLE' ? 404 : code === 'FACET_UNAVAILABLE' ? 404 : 500).send({ error: code === '23505' ? 'facet_already_linked' : code === 'PERSON_UNAVAILABLE' ? 'person_unavailable' : code === 'FACET_UNAVAILABLE' ? 'facet_unavailable' : 'internal_error' });
    }
  });
  app.post('/api/platform/v1/persons/:personId/training-link', async (request, reply) => {
    const actor = await authorized(request, reply); if (!actor) return;
    const parsed = z.object({ personId: uuid }).safeParse(request.params); const body = trainingLinkInput.safeParse(request.body);
    if (!parsed.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    const linkId = randomUUID();
    try {
      const linked = await database.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${body.data.requestId}::text,0))`;
        const replay = await tx`SELECT link_id AS "linkId",person_id AS "personId",training_user_id AS "trainingUserId",status,link_version AS "linkVersion",method,created_by AS "createdBy" FROM training_account_links WHERE request_id=${body.data.requestId} FOR UPDATE`;
        if (replay[0]) {
          const previous = replay[0];
          if (previous.personId !== parsed.data.personId || previous.trainingUserId !== body.data.trainingUserId || previous.method !== 'explicit_admin' || previous.createdBy !== actor.actorId) throw Object.assign(new Error('Idempotency conflict'), { code: 'IDEMPOTENCY_CONFLICT' });
          return previous;
        }
        const person = await tx`SELECT id FROM platform_persons WHERE id=${parsed.data.personId} AND status='active' FOR UPDATE`;
        if (!person.length) throw Object.assign(new Error('Person unavailable'), { code: 'PERSON_UNAVAILABLE' });
        await tx`INSERT INTO training_account_links(link_id,request_id,person_id,training_user_id,method,created_by,updated_by) VALUES (${linkId},${body.data.requestId},${parsed.data.personId},${body.data.trainingUserId},'explicit_admin',${actor.actorId},${actor.actorId})`;
        await tx`INSERT INTO platform_identity_audit_events(person_id,actor_id,action,resource_id,details) VALUES (${parsed.data.personId},${actor.actorId},'training.linked',${linkId},'{}'::jsonb)`;
        return { linkId, personId: parsed.data.personId, trainingUserId: body.data.trainingUserId, status: 'active', linkVersion: 1 };
      });
      return reply.code(linked.linkId === linkId ? 201 : 200).send(linked);
    } catch (error) {
      const code = (error as { code?: string }).code;
      return reply.code(code === '23505' || code === 'IDEMPOTENCY_CONFLICT' ? 409 : code === 'PERSON_UNAVAILABLE' ? 404 : 500).send({ error: code === 'IDEMPOTENCY_CONFLICT' ? 'idempotency_conflict' : code === '23505' ? 'training_identity_already_linked' : code === 'PERSON_UNAVAILABLE' ? 'person_unavailable' : 'internal_error' });
    }
  });
  app.delete('/api/platform/v1/persons/:personId/training-link', async (request, reply) => {
    const actor = await authorized(request, reply); if (!actor) return;
    const parsed = z.object({ personId: uuid }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' });
    try {
      const result = await database.begin(async (tx) => {
        const rows = await tx`UPDATE training_account_links SET status='revoked',revoked_at=now(),updated_at=now(),updated_by=${actor.actorId} WHERE person_id=${parsed.data.personId} AND status='active' RETURNING link_id AS "linkId",link_version AS "linkVersion"`;
        if (!rows[0]) return null;
        await tx`INSERT INTO platform_identity_audit_events(person_id,actor_id,action,resource_id,details) VALUES (${parsed.data.personId},${actor.actorId},'training.link_revoked',${rows[0].linkId},${JSON.stringify({ linkVersion: rows[0].linkVersion })}::jsonb)`;
        return rows[0];
      });
      return result ? { personId: parsed.data.personId, linkId: result.linkId, status: 'revoked', linkVersion: result.linkVersion } : reply.code(404).send({ error: 'active_training_link_not_found' });
    } catch { return reply.code(500).send({ error: 'internal_error' }); }
  });
}
