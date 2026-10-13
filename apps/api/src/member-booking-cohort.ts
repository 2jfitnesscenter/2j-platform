import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can, type AuthorizationContext } from '@2j/permissions';
import type { createDatabase } from './db.js';

type DB = ReturnType<typeof createDatabase>['client'];
const input = z.object({ enabled: z.boolean(), reason: z.string().trim().min(3).max(240) }).strict();
const uuid = z.string().uuid().transform(value => value.toLowerCase());

export function registerMemberBookingCohortRoutes(app: FastifyInstance, db: DB, resolve: (request: FastifyRequest) => Promise<AuthorizationContext | null>, enabled: boolean) {
  app.put('/api/admin/member-pilot/cohort/:clientId', async (request, reply) => {
    if (!enabled) return reply.code(404).send({ error: 'not_found' });
    const actor = await resolve(request);
    if (!actor) return reply.code(401).send({ error: 'authentication_required' });
    if (!can(actor, 'member.pilot.booking.manage')) return reply.code(403).send({ error: 'permission_denied' });
    const params = z.object({ clientId: uuid }).safeParse(request.params);
    const body = input.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    try {
      const result = await db.begin(async tx => {
        const [identity] = await tx`SELECT f.person_id AS "personId" FROM platform_person_clients f JOIN platform_persons p ON p.id=f.person_id AND p.status='active' JOIN clients c ON c.id=f.client_id AND c.status='active' WHERE f.client_id=${params.data.clientId}::uuid FOR UPDATE OF f`;
        if (!identity) return null;
        const [old] = await tx`SELECT status FROM platform_member_booking_pilot_cohort WHERE person_id=${identity.personId}::uuid FOR UPDATE`;
        const status = body.data.enabled ? 'active' : 'revoked';
        if (old?.status === status) return { status, changed: false };
        await tx`INSERT INTO platform_member_booking_pilot_cohort(person_id,status,enabled_by,disabled_at,disabled_by) VALUES (${identity.personId}::uuid,${status},${actor.actorId},CASE WHEN ${body.data.enabled} THEN NULL ELSE now() END,CASE WHEN ${body.data.enabled} THEN NULL ELSE ${actor.actorId} END) ON CONFLICT(person_id) DO UPDATE SET status=EXCLUDED.status,enabled_at=CASE WHEN EXCLUDED.status='active' THEN now() ELSE platform_member_booking_pilot_cohort.enabled_at END,enabled_by=CASE WHEN EXCLUDED.status='active' THEN EXCLUDED.enabled_by ELSE platform_member_booking_pilot_cohort.enabled_by END,disabled_at=CASE WHEN EXCLUDED.status='revoked' THEN now() ELSE NULL END,disabled_by=CASE WHEN EXCLUDED.status='revoked' THEN EXCLUDED.disabled_by ELSE NULL END`;
        await tx`INSERT INTO platform_member_booking_pilot_cohort_events(person_id,action,actor_id,reason) VALUES (${identity.personId}::uuid,${body.data.enabled ? 'booking_cohort.enabled' : 'booking_cohort.revoked'},${actor.actorId},${body.data.reason})`;
        return { status, changed: true };
      });
      if (!result) return reply.code(404).send({ error: 'client_not_found' });
      return { ...result };
    } catch (error) {
      request.log.error({ databaseCode: typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown' }, 'member pilot cohort update failed');
      return reply.code(500).send({ error: 'internal_error' });
    }
  });
}
