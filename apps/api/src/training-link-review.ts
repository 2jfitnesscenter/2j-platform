import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can, type AuthorizationContext } from '@2j/permissions';
import type { createDatabase } from './db.js';
import type { ResolvedPersonAuth } from './training-link-protocol.js';

type DB = ReturnType<typeof createDatabase>['client'];
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const legacyReasonToContract = {
  lost_passkey: 'lost_device',
  no_access_to_training_account: 'no_home_access',
  proof_failed: 'support_request',
  other: 'other',
} as const;
const contractReasonToLegacy = {
  lost_device: 'lost_passkey',
  no_home_access: 'no_access_to_training_account',
  support_request: 'proof_failed',
  other: 'other',
} as const;
const toContractReason = (reason: keyof typeof legacyReasonToContract) => legacyReasonToContract[reason];

/**
 * Manual review queue for Training links that cannot be completed with the owner's own passkey proof (A26, D143).
 *   member  opens ONE case (reason + optional short note); cannot name a Training account, cannot resolve anything.
 *   authorized issuer lists, reads and resolves with the dedicated `platform_link_issue` permission (A29); the Admin wildcard alone does not grant it.
 * Resolving never links by itself: `approved` records the decision, the verified Training user and who checked what; the link still goes through the audited admin
 * link path (flag `trainingLinkingEnabled`). Off unless `enabled`.
 */
export function registerTrainingLinkReviewRoutes(app: FastifyInstance<any, any, any, any, any>, db: DB, options: {
  enabled: boolean;
  resolvePersonAuth: (request: FastifyRequest) => Promise<ResolvedPersonAuth | null>;
  resolveAuthorization: (request: FastifyRequest) => Promise<AuthorizationContext | null>;
  allowedOrigin: string | null;
}) {
  const originOk = (request: FastifyRequest) => options.allowedOrigin !== null && request.headers.origin === options.allowedOrigin && request.headers['sec-fetch-site'] !== 'cross-site';
  const admin = async (request: FastifyRequest, reply: any) => {
    reply.header('Cache-Control', 'no-store');
    if (!options.enabled) { reply.code(423).send({ error: 'training_link_review_disabled' }); return null; }
    const actor = await options.resolveAuthorization(request);
    if (!actor) { reply.code(401).send({ error: 'authentication_required' }); return null; }
    if (!can(actor, 'platform_link_issue')) { reply.code(403).send({ error: 'permission_denied' }); return null; }
    return actor;
  };
  const view = (row: any) => ({
    id: row.id, personId: row.personId, reason: toContractReason(row.reason), memberNote: row.memberNote ?? null, status: row.status, createdAt: row.createdAt,
    ...(row.displayName ? { person: { displayName: row.displayName } } : {}),
    ...(row.status !== 'open' ? { resolution: { trainingUserId: row.trainingUserId ?? null, verificationMethod: row.verificationMethod ?? null, note: row.resolutionNote, resolvedAt: row.resolvedAt, resolvedBy: row.resolvedBy } } : {}),
  });

  // Member: ask for a manual review when the passkey proof cannot be completed.
  app.post('/api/me/training/link-review', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!options.enabled) return reply.code(423).send({ error: 'training_link_review_disabled' });
    if (!originOk(request)) return reply.code(403).send({ error: 'origin_rejected' });
    const body = z.object({ reason: z.enum(['lost_device', 'no_home_access', 'support_request', 'other', 'lost_passkey', 'no_access_to_training_account', 'proof_failed']), note: z.string().trim().max(500).optional() }).strict().safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'validation_error' });
    const auth = await options.resolvePersonAuth(request);
    if (!auth) return reply.code(401).send({ error: 'authentication_required' });
    const personId = String(auth.personId).toLowerCase();
    const outcome = await db.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`link-review:${personId}`}))`;
      const [person] = await tx`SELECT id FROM platform_persons WHERE id=${personId}::uuid AND status='active'`;
      if (!person) return { code: 403, body: { error: 'identity_unavailable' } };
      const [linked] = await tx`SELECT 1 AS yes FROM training_account_links WHERE person_id=${personId}::uuid AND status IN ('pending','active','revocation_pending')`;
      if (linked) return { code: 409, body: { error: 'link_already_in_progress_or_active' } };
      const [open] = await tx`SELECT id,status,reason,created_at AS "createdAt" FROM training_link_review_cases WHERE person_id=${personId}::uuid AND status='open'`;
      if (open) return { code: 200, body: { v: 1, id: open.id, status: 'open', created: false } };
      const storedReason = body.data.reason in contractReasonToLegacy ? contractReasonToLegacy[body.data.reason as keyof typeof contractReasonToLegacy] : body.data.reason as keyof typeof legacyReasonToContract;
      const [row] = await tx`INSERT INTO training_link_review_cases(person_id,reason,member_note) VALUES (${personId}::uuid,${storedReason},${body.data.note || null}) RETURNING id`;
      await tx`INSERT INTO training_link_review_events(case_id,action,actor) VALUES (${row!.id}::uuid,'opened',${`person:${personId}`})`;
      return { code: 201, body: { v: 1, id: row!.id, status: 'open', created: true } };
    });
    return reply.code(outcome.code).send(outcome.body);       // sent only after the transaction committed
  });

  // Member: my own case, if any (so Home can say "an administrator is reviewing it").
  app.get('/api/me/training/link-review', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!options.enabled) return reply.code(423).send({ error: 'training_link_review_disabled' });
    const auth = await options.resolvePersonAuth(request);
    if (!auth) return reply.code(401).send({ error: 'authentication_required' });
    const [row] = await db`SELECT id,status,reason,created_at AS "createdAt",resolved_at AS "resolvedAt" FROM training_link_review_cases WHERE person_id=${String(auth.personId).toLowerCase()}::uuid ORDER BY created_at DESC LIMIT 1`;
    return { v: 1, case: row ? { id: row.id, status: row.status, reason: toContractReason(row.reason), createdAt: row.createdAt, resolvedAt: row.resolvedAt ?? null } : null };   // no resolution notes: those are internal
  });

  // Admin: the queue.
  app.get('/api/platform/v1/training-link-review', async (request, reply) => {
    const actor = await admin(request, reply); if (!actor) return;
    const query = z.object({ status: z.enum(['open', 'approved', 'rejected', 'dismissed', 'all']).default('open'), limit: z.coerce.number().int().min(1).max(200).default(50) }).strict().safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'validation_error' });
    const rows = await db`
      SELECT c.id,c.person_id AS "personId",c.reason,c.member_note AS "memberNote",c.status,c.created_at AS "createdAt",c.training_user_id AS "trainingUserId",c.verification_method AS "verificationMethod",
        c.resolution_note AS "resolutionNote",c.resolved_at AS "resolvedAt",c.resolved_by AS "resolvedBy",
        (SELECT btrim(cl.first_name || ' ' || cl.last_name) FROM platform_person_clients pc JOIN clients cl ON cl.id=pc.client_id WHERE pc.person_id=c.person_id LIMIT 1) AS "displayName"
      FROM training_link_review_cases c WHERE (${query.data.status}='all' OR c.status=${query.data.status}) ORDER BY c.created_at,c.id LIMIT ${query.data.limit}`;
    return { v: 1, cases: rows.map(view) };
  });

  app.get('/api/platform/v1/training-link-review/:caseId', async (request, reply) => {
    const actor = await admin(request, reply); if (!actor) return;
    const params = z.object({ caseId: uuid }).strict().safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'validation_error' });
    const [row] = await db`
      SELECT c.id,c.person_id AS "personId",c.reason,c.member_note AS "memberNote",c.status,c.created_at AS "createdAt",c.training_user_id AS "trainingUserId",c.verification_method AS "verificationMethod",
        c.resolution_note AS "resolutionNote",c.resolved_at AS "resolvedAt",c.resolved_by AS "resolvedBy",
        (SELECT btrim(cl.first_name || ' ' || cl.last_name) FROM platform_person_clients pc JOIN clients cl ON cl.id=pc.client_id WHERE pc.person_id=c.person_id LIMIT 1) AS "displayName"
      FROM training_link_review_cases c WHERE c.id=${params.data.caseId}::uuid`;
    if (!row) return reply.code(404).send({ error: 'case_not_found' });
    const events = await db`SELECT action,actor,occurred_at AS "occurredAt" FROM training_link_review_events WHERE case_id=${params.data.caseId}::uuid ORDER BY occurred_at,id`;
    return { v: 1, case: view(row), events };
  });

  // Admin: resolve. Identity check and note are mandatory; the same decision twice is idempotent; a different one is refused (a resolved case is final).
  app.post('/api/platform/v1/training-link-review/:caseId/resolve', async (request, reply) => {
    const actor = await admin(request, reply); if (!actor) return;
    const params = z.object({ caseId: uuid }).strict().safeParse(request.params);
    const body = z.object({
      action: z.enum(['approve', 'reject', 'dismiss']),
      note: z.string().trim().min(10).max(500),
      verification: z.object({ method: z.enum(['in_person', 'other_verified']) }).strict().optional(),
      trainingUserId: z.string().trim().min(1).max(200).refine(value => !/[\u0000-\u001f\u007f]/.test(value)).optional(),
    }).strict().superRefine((value, context) => {
      if (value.action === 'approve' && (!value.verification || !value.trainingUserId)) context.addIssue({ code: 'custom', message: 'approve needs verification.method and trainingUserId' });
      if (value.action !== 'approve' && (value.verification || value.trainingUserId)) context.addIssue({ code: 'custom', message: 'only an approval carries a verification and a Training user' });
    }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    const status = body.data.action === 'approve' ? 'approved' : body.data.action === 'reject' ? 'rejected' : 'dismissed';
    const outcome = await db.begin(async tx => {
      const [current] = await tx`SELECT id,person_id AS "personId",status,training_user_id AS "trainingUserId" FROM training_link_review_cases WHERE id=${params.data.caseId}::uuid FOR UPDATE`;
      if (!current) return { code: 404, body: { error: 'case_not_found' } };
      if (current.status !== 'open') {
        if (current.status === status && (status !== 'approved' || current.trainingUserId === body.data.trainingUserId)) return { code: 200, body: { v: 1, id: current.id, status, replay: true } };
        return { code: 409, body: { error: 'case_already_resolved', status: current.status } };
      }
      if (status === 'approved') {
        const trainingUserId = body.data.trainingUserId as string;
        const [taken] = await tx`SELECT 1 AS yes FROM training_account_links WHERE training_user_id=${trainingUserId} AND status IN ('pending','active','revocation_pending')`;
        if (taken) return { code: 409, body: { error: 'training_identity_already_linked' } };
        const [mine] = await tx`SELECT 1 AS yes FROM training_account_links WHERE person_id=${current.personId}::uuid AND status IN ('pending','active','revocation_pending')`;
        if (mine) return { code: 409, body: { error: 'person_already_linked' } };
      }
      await tx`UPDATE training_link_review_cases SET status=${status},training_user_id=${body.data.trainingUserId ?? null},verification_method=${body.data.verification?.method ?? null},
        resolution_note=${body.data.note},resolved_at=now(),resolved_by=${actor.actorId} WHERE id=${current.id}::uuid`;
      await tx`INSERT INTO training_link_review_events(case_id,action,actor) VALUES (${current.id}::uuid,${status},${actor.actorId})`;
      return { code: 200, body: { v: 1, id: current.id, status, replay: false, ...(status === 'approved' ? { nextStep: 'admin_link' } : {}) } };   // approval records the decision; the link itself is the audited admin link path
    });
    return reply.code(outcome.code).send(outcome.body);       // sent only after the transaction committed
  });
}
