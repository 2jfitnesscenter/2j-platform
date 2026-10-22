import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { can, type AuthorizationContext } from '@2j/permissions';
import { z } from 'zod';
import type { createDatabase } from './db.js';

type DB = ReturnType<typeof createDatabase>['client'];
const personIdSchema = z.string().uuid().transform(value => value.toLowerCase());
const reasonSchema = z.string().max(1000).transform(value => value.normalize('NFKC').trim()).pipe(z.string().min(10).max(500));
const bodySchema = z.object({ reason: reasonSchema }).strict();
const idempotencySchema = z.string().uuid().transform(value => value.toLowerCase());

type SuspensionRow = { id: string; action: 'suspended'|'lifted'; reason: string; actorId: string; occurredAt: Date|string };
type IdempotentSuspensionRow = SuspensionRow & { requestHash: string; personId: string };

async function latestEvent(db: any, personId: string): Promise<SuspensionRow|null> {
  const [row] = await db<SuspensionRow[]>`SELECT id,action,reason,actor_id AS "actorId",occurred_at AS "occurredAt"
    FROM platform_training_access_events WHERE person_id=${personId}::uuid
    ORDER BY occurred_at DESC,id DESC LIMIT 1`;
  return row ?? null;
}

function stateOf(event: SuspensionRow|null) {
  return !event ? 'none' : event.action === 'suspended' ? 'suspended' : 'lifted';
}

async function authorize(request: FastifyRequest, reply: any, resolve: (request: FastifyRequest)=>Promise<AuthorizationContext|null>) {
  reply.header('Cache-Control','no-store');
  const actor = await resolve(request);
  if (!actor) { reply.code(401).send({error:'authentication_required'}); return null; }
  if (!can(actor,'training.suspension.manage')) { reply.code(403).send({error:'permission_denied'}); return null; }
  return actor;
}

export function registerTrainingSuspensionRoutes(
  app: FastifyInstance,
  db: DB,
  resolveAuthorization: (request: FastifyRequest)=>Promise<AuthorizationContext|null>,
) {
  app.get('/api/platform/v1/persons/:personId/training-suspension', async (request, reply) => {
    const actor = await authorize(request,reply,resolveAuthorization); if (!actor) return;
    const params = z.object({personId:personIdSchema}).strict().safeParse(request.params);
    if (!params.success) return reply.code(400).send({error:'validation_error'});
    try {
      const [person] = await db`SELECT id FROM platform_persons WHERE id=${params.data.personId}::uuid`;
      if (!person) return reply.code(404).send({error:'person_not_found'});
      const event = await latestEvent(db,params.data.personId);
      return {personId:params.data.personId,status:stateOf(event),...(event?{reason:event.reason,actorId:event.actorId,occurredAt:new Date(event.occurredAt).toISOString()}:{})};
    } catch {
      request.log.error({route:'GET /api/platform/v1/persons/:personId/training-suspension'},'training suspension query failed');
      return reply.code(500).send({error:'internal_error'});
    }
  });

  const mutate = (action: 'suspended'|'lifted') => async (request: FastifyRequest, reply: any) => {
    const actor = await authorize(request,reply,resolveAuthorization); if (!actor) return;
    const params = z.object({personId:personIdSchema}).strict().safeParse(request.params);
    if (!params.success) return reply.code(400).send({error:'validation_error'});
    const body = bodySchema.safeParse(request.body);
    const key = idempotencySchema.safeParse(request.headers['idempotency-key']);
    if (!body.success || !key.success) return reply.code(400).send({error:'validation_error'});
    const requestHash = createHash('sha256').update(JSON.stringify({personId:params.data.personId,action,reason:body.data.reason,actorId:actor.actorId})).digest('hex');
    try {
      const result = await db.begin(async tx => {
        const [previous] = await tx<IdempotentSuspensionRow[]>`SELECT id,person_id AS "personId",action,reason,actor_id AS "actorId",request_hash AS "requestHash",occurred_at AS "occurredAt"
          FROM platform_training_access_events WHERE idempotency_key=${key.data}::uuid`;
        if (previous) return previous.requestHash === requestHash
          ? {event:previous,replayed:true as const}
          : {error:'idempotency_conflict' as const};
        const [person] = await tx`SELECT id FROM platform_persons WHERE id=${params.data.personId}::uuid FOR UPDATE`;
        if (!person) return {error:'person_not_found' as const};
        const [concurrent] = await tx<IdempotentSuspensionRow[]>`SELECT id,person_id AS "personId",action,reason,actor_id AS "actorId",request_hash AS "requestHash",occurred_at AS "occurredAt"
          FROM platform_training_access_events WHERE idempotency_key=${key.data}::uuid`;
        if (concurrent) return concurrent.requestHash === requestHash
          ? {event:concurrent,replayed:true as const}
          : {error:'idempotency_conflict' as const};
        const current = await latestEvent(tx,params.data.personId);
        const suspended = stateOf(current) === 'suspended';
        if (action === 'suspended' && suspended) return {error:'already_suspended' as const};
        if (action === 'lifted' && !suspended) return {error:'not_suspended' as const};
        const [event] = await tx`INSERT INTO platform_training_access_events(person_id,action,reason,actor_id,idempotency_key,request_hash)
          VALUES (${params.data.personId}::uuid,${action},${body.data.reason},${actor.actorId},${key.data}::uuid,${requestHash})
          RETURNING id,action,reason,actor_id AS "actorId",occurred_at AS "occurredAt"`;
        if (!event) throw new Error('training_suspension_event_missing');
        const auditAction = action === 'suspended' ? 'training.suspended' : 'training.suspension_lifted';
        await tx`INSERT INTO platform_identity_audit_events(person_id,actor_id,action,resource_id,details)
          VALUES (${params.data.personId}::uuid,${actor.actorId},${auditAction},${event.id},${JSON.stringify({reason:body.data.reason})}::jsonb)`;
        return {event,replayed:false as const};
      });
      if ('error' in result) {
        const status = result.error === 'person_not_found' ? 404 : result.error === 'idempotency_conflict' ? 409 : 409;
        return reply.code(status).send({error:result.error});
      }
      return reply.code(result.replayed?200:201).send({personId:params.data.personId,status:action==='suspended'?'suspended':'lifted',eventId:result.event.id,reason:result.event.reason,actorId:result.event.actorId,occurredAt:new Date(result.event.occurredAt).toISOString(),replayed:result.replayed});
    } catch (error) {
      if ((error as {code?:string})?.code === '23505') return reply.code(409).send({error:'idempotency_conflict'});
      request.log.error({route:`POST /api/platform/v1/persons/:personId/training-suspension/${action}`},'training suspension update failed');
      return reply.code(500).send({error:'internal_error'});
    }
  };

  app.post('/api/platform/v1/persons/:personId/training-suspension/suspend',mutate('suspended'));
  app.post('/api/platform/v1/persons/:personId/training-suspension/lift',mutate('lifted'));
}
