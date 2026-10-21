import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { canaryBusinessDate, resolveTrainingCapabilities, type CapabilityAccessState, type EffectiveMembershipForCapabilities, type TrainingLinkStatus } from '@2j/domain';
import type { createDatabase } from './db.js';
import { verifyInternalServiceRequest, type InternalServiceKeys } from './internal-service-auth.js';
import { resolveEffectiveClientAssignments } from './entitlements.js';

type DB = ReturnType<typeof createDatabase>['client'];
const personIdSchema = z.string().uuid().transform(value => value.toLowerCase());
const responseSchema = z.object({
  contract: z.literal('2J-CAPABILITIES-V1'), version: z.literal(1), personId: z.string().uuid(),
  trainingSubject: z.object({ linkStatus: z.enum(['active','not_linked','revoked']), trainingUserId: z.string().min(1).max(200).optional() }).strict(),
  capabilityLevel: z.enum(['full','autonomous','blocked']), accessState: z.enum(['active','provisional','blocked_unpaid','ended']),
  capabilities: z.object({ autonomousTraining:z.boolean(),routineCreation:z.boolean(),guidedTraining:z.boolean(),premiumPrograms:z.boolean(),aiCoach:z.boolean(),professionalFollowUp:z.boolean() }).strict(),
  reasonCode: z.enum(['ACTIVE_FULL','ACTIVE_AUTONOMOUS','PROVISIONAL_FULL','PROVISIONAL_AUTONOMOUS','UNPAID_BLOCK','NO_ACTIVE_MEMBERSHIP','PERIOD_ENDED','TRAINING_LINK_REVOKED','TRAINING_LINK_MISSING']),
  effectiveFrom: z.string().date().nullable(), expiresAt: z.string().datetime(), generatedAt: z.string().datetime(), source: z.object({platform:z.literal(true)}).strict(),
}).strict();

/** Read-only, server-authenticated Platform capability endpoint. */
export function registerTrainingCapabilitiesRoute(app: FastifyInstance<any,any,any,any,any>, db: DB, keys: InternalServiceKeys) {
  app.get('/api/internal/platform/v1/persons/:personId/training-capabilities', async (request, reply) => {
    reply.header('Cache-Control','no-store');
    const params = z.object({personId:personIdSchema}).strict().safeParse(request.params);
    if (!params.success) return reply.code(400).send({error:'invalid_person_id'});
    if (Object.keys(keys).length === 0) return reply.code(503).send({error:'service_auth_unavailable'});
    const verified = await verifyInternalServiceRequest(request, db, keys, { expectedMethod:'GET', expectedPath:`/api/internal/platform/v1/persons/${params.data.personId}/training-capabilities` });
    if (verified && 'unavailable' in verified) return reply.code(503).send({error:'service_auth_unavailable'});
    if (!verified) return reply.code(401).send({error:'service_auth_rejected'});

    const [person] = await db`SELECT p.status,pc.client_id AS "clientId",c.status AS "clientStatus"
      FROM platform_persons p LEFT JOIN platform_person_clients pc ON pc.person_id=p.id
      LEFT JOIN clients c ON c.id=pc.client_id WHERE p.id=${params.data.personId}::uuid`;
    if (!person || person.status !== 'active') return reply.code(404).send({error:'person_not_found'});

    const [link] = await db`SELECT status,training_user_id AS "trainingUserId" FROM training_account_links
      WHERE person_id=${params.data.personId}::uuid ORDER BY updated_at DESC,created_at DESC,link_id DESC LIMIT 1`;
    const linkStatus: TrainingLinkStatus = link?.status === 'active' ? 'active' : link?.status === 'revoked' ? 'revoked' : 'not_linked';
    const activeLink = linkStatus === 'active' && link ? {status:'active' as const,trainingUserId:String(link.trainingUserId)} : {status:linkStatus};
    const now = new Date();
    const localDate = canaryBusinessDate(now);
    const effective = person.clientId && person.clientStatus === 'active'
      ? await resolveEffectiveClientAssignments(db, String(person.clientId), now)
      : { localDate, effective:{assignments:[]}, nextKnownAccessTransition:null };
    const memberships: EffectiveMembershipForCapabilities[] = [];
    for (const assignment of effective.effective.assignments) {
      const rights = assignment.rights.filter(right => right.rightType === 'training_access' && (right.trainingAccessLevel === 'full' || right.trainingAccessLevel === 'autonomous'));
      if (!rights.length) continue;
      const status = assignment.operationalAccess;
      let accessState: CapabilityAccessState;
      if (assignment.status === 'paused' || assignment.status === 'cancelled' || assignment.status === 'expired') accessState = 'ended';
      else if (assignment.status === 'scheduled') accessState = 'blocked_unpaid';
      else if (status === 'active' || status === 'provisional' || status === 'blocked_unpaid' || status === 'ended') accessState = status;
      else accessState = 'blocked_unpaid';
      for (const right of rights) memberships.push({trainingAccessLevel:right.trainingAccessLevel as 'full'|'autonomous',accessState,effectiveFrom:assignment.startsOn});
    }
    const payload = resolveTrainingCapabilities({
      personId:params.data.personId,
      link:activeLink,
      memberships,
      generatedAt:now.toISOString(),
      nextKnownAccessTransition:effective.nextKnownAccessTransition,
    });
    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) {
      request.log.error({errorCode:'training_capability_contract_invalid'},'capability response failed contract validation');
      return reply.code(500).send({error:'capability_contract_invalid'});
    }
    return reply.code(200).send(parsed.data);
  });
}
