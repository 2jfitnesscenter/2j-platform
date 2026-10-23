import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can, type AuthorizationContext } from '@2j/permissions';
import type { createDatabase } from './db.js';
import { buildTrainingServiceAuthHeaders, parseRemoteTrainingConfig, type RemoteTrainingLinkVerifierOptions } from './training-integration.js';
import type { createTrainingLinkTransactions, ResolvedPersonAuth } from './training-link-protocol.js';
import type { createTrainingCanonicalLinkLifecycle } from './training-link-lifecycle.js';

type DB = ReturnType<typeof createDatabase>['client'];
const uuid = z.string().uuid().transform(value => value.toLowerCase());
export const TRAINING_LINK_ACTIVATE_PATH = '/api/platform/v1/link/activate';
export const TRAINING_LINK_REVOKE_PATH = '/api/platform/v1/link/revoke';
export const TRAINING_PROVISION_PATH = '/api/platform/v1/provision';

/* ------------------------------------------------------------------ signed Platform -> Training client */
const ackSchema = z.object({ v: z.literal(1), status: z.literal('active'), replay: z.boolean(), ackId: z.string().min(1).max(200), linkId: uuid, linkVersion: z.number().int().positive(), trainingUserId: z.string().min(1).max(200) }).strict();
const revokeAckSchema = z.object({ v: z.literal(1), status: z.literal('revoked'), ackId: z.string().min(1).max(200), linkId: uuid, trainingUserId: z.string().min(1).max(200) }).strict();
const provisionedSchema = z.object({ v: z.literal(1), status: z.literal('provisioned'), replay: z.boolean(), trainingUserId: z.string().min(1).max(200), linkState: z.enum(['pending', 'active', 'revoked']) }).strict();

export type ServiceResult<T> = { ok: true; data: T } | { ok: false; status: number | 'unavailable' | 'invalid_response'; error?: string };
export type TrainingServiceClient = { readonly enabled: boolean; post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<ServiceResult<T>> };

/** Fixed-path, signed (2J-SERVICE-AUTH-V1), redirect-refusing, time-bounded client. Disabled (never throws) when not configured. */
export function createTrainingServiceClient(options: RemoteTrainingLinkVerifierOptions): TrainingServiceClient {
  const config = parseRemoteTrainingConfig(options);
  return {
    enabled: config !== null,
    async post<T>(path: string, payload: unknown, schema: z.ZodType<T>): Promise<ServiceResult<T>> {
      if (!config) return { ok: false, status: 'unavailable' };
      const body = Buffer.from(JSON.stringify(payload), 'utf8');
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), Math.max(1, Math.min(options.timeoutMs ?? 8_000, 8_000)));
      try {
        const headers = await buildTrainingServiceAuthHeaders({ keyId: options.keyId!, timestamp: new Date().toISOString(), requestId: randomUUID(), method: 'POST', path, body },
          async canonical => createHmac('sha256', config.key).update(Buffer.from(canonical, 'utf8')).digest('base64url'), controller.signal);
        const response = await options.fetcher!(new URL(path, config.origin), { method: 'POST', redirect: 'error', signal: controller.signal, headers: { accept: 'application/json', 'content-type': 'application/json', ...headers }, body });
        const text = await response.text();
        if (text.length > 16_384) return { ok: false, status: 'invalid_response' };
        let json: unknown = null; try { json = JSON.parse(text); } catch { /* not json */ }
        if (!response.ok) return { ok: false, status: response.status, ...(json && typeof json === 'object' && typeof (json as { error?: unknown }).error === 'string' ? { error: String((json as { error: string }).error) } : {}) };
        const parsed = schema.safeParse(json);
        return parsed.success ? { ok: true, data: parsed.data } : { ok: false, status: 'invalid_response' };
      } catch { return { ok: false, status: 'unavailable' }; }
      finally { clearTimeout(timeout); }
    },
  };
}

/* ------------------------------------------------------------------ lifecycle service */
/**
 * Definitive refusals from Training: the attempt ends as a terminal `conflict`. `proof_required` is deliberately NOT here (H12): it can be a lag between
 * Training storing the owner's receipt and Platform asking, so the link stays `pending` and the same call can be retried (`resume`) until the owner's
 * proof is visible; a genuine absence is closed by an administrator (revoke of the pending link) or by the next link transaction.
 */
const REFUSALS = new Set(['link_conflict', 'not_provisioned', 'training_user_not_found', 'already_provisioned', 'idempotency_conflict']);
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

export type LinkActivation = { status: 'active'; replay: boolean } | { status: 'ack_unavailable' } | { status: 'proof_pending' } | { status: 'refused'; reason: string } | { status: 'not_found' | 'not_pending' };
export type LinkRevocation = { status: 'revoked'; waived: boolean } | { status: 'revocation_pending' } | { status: 'not_linked' } | { status: 'cancelled' };
export type Provisioning = { status: 'active'; trainingUserId: string; linkId: string } | { status: 'provisioning_pending' } | { status: 'link_pending'; trainingUserId: string; linkId: string }
  | { status: 'conflict' | 'person_unavailable' | 'already_provisioned' | 'refused'; reason?: string };

export function createTrainingLinkFlow(db: DB, options: { client: TrainingServiceClient }) {
  const client = options.client;
  const ref = (link: Record<string, unknown>, linkVersion: number) => ({ linkId: link.linkId as string, trainingUserId: link.trainingUserId as string, linkVersion });
  const audit = (tx: DB, personId: string, actor: string, action: string, resourceId: string, details: Record<string, unknown> = {}) =>
    tx`INSERT INTO platform_identity_audit_events(person_id,actor_id,action,resource_id,details) VALUES (${personId}::uuid,${actor.slice(0, 120)},${action},${resourceId}::uuid,(${JSON.stringify(details)}::text)::jsonb)`;

  /** pending -> active, ONLY after Training acknowledged the link (it holds its own evidence). Safe to retry at any point. */
  async function activate(linkId: string, actor: string): Promise<LinkActivation> {
    const [link] = await db`SELECT link_id AS "linkId",person_id AS "personId",training_user_id AS "trainingUserId",status,method,link_version AS "linkVersion",source_receipt_id AS "receiptId"
      FROM training_account_links WHERE link_id=${linkId}::uuid`;
    if (!link) return { status: 'not_found' };
    if (link.status === 'active') return { status: 'active', replay: true };
    if (link.status !== 'pending') return { status: 'not_pending' };
    const result = await client.post(TRAINING_LINK_ACTIVATE_PATH, {
      v: 1, linkId: link.linkId, linkVersion: link.linkVersion, personId: link.personId, trainingUserId: link.trainingUserId,
      origin: link.method === 'provisioned' ? 'provisioned' : 'proof', ...(link.method === 'verified_training_proof' && link.receiptId ? { receiptId: link.receiptId } : {}),
    }, ackSchema);
    if (!result.ok) {
      const refusal = result.status === 409 || result.status === 404 ? (result.error ?? 'refused') : null;
      await db.begin(async tx => {
        await audit(tx as unknown as DB, link.personId, actor, 'training.link_ack_failed', link.linkId, { status: result.status, ...(refusal ? { reason: refusal } : {}) });
        // A definitive refusal (the owner's proof is missing, the person/user is already linked elsewhere ...) ends the attempt; an outage leaves it pending for a retry.
        if (refusal && REFUSALS.has(refusal)) await tx`UPDATE training_account_links SET status='conflict',link_version=link_version+1,updated_by=${actor.slice(0, 120)} WHERE link_id=${linkId}::uuid AND status='pending'`;
      });
      if (refusal === 'proof_required') return { status: 'proof_pending' };
      return refusal && REFUSALS.has(refusal) ? { status: 'refused', reason: refusal } : { status: 'ack_unavailable' };
    }
    if (result.data.linkId !== link.linkId || result.data.trainingUserId !== link.trainingUserId) return { status: 'ack_unavailable' };   // never trust an acknowledgement for something else
    return db.begin(async tx => {
      const [row] = await tx`SELECT status FROM training_account_links WHERE link_id=${linkId}::uuid FOR UPDATE`;
      if (row?.status === 'active') return { status: 'active' as const, replay: true };
      if (row?.status !== 'pending') return { status: 'not_pending' as const };
      await tx`UPDATE training_account_links SET status='active',link_version=link_version+1,training_ack_id=${result.data.ackId},updated_by=${actor.slice(0, 120)} WHERE link_id=${linkId}::uuid AND status='pending'`;
      await audit(tx as unknown as DB, link.personId, actor, 'training.link_activated', link.linkId, { method: link.method });
      return { status: 'active' as const, replay: false };
    });
  }

  /** active -> revocation_pending (access is blocked immediately) -> revoked after Training acknowledges, or an audited administrative waiver. */
  async function revoke(input: { personId: string; actor: string; reason: string; waiveAcknowledgement?: boolean }): Promise<LinkRevocation> {
    const step = await db.begin(async tx => {
      await tx`SELECT id FROM platform_persons WHERE id=${input.personId}::uuid FOR UPDATE`;
      const [link] = await tx`SELECT link_id AS "linkId",training_user_id AS "trainingUserId",status,method,link_version AS "linkVersion" FROM training_account_links
        WHERE person_id=${input.personId}::uuid AND status IN ('pending','active','revocation_pending') FOR UPDATE`;
      if (!link) return { kind: 'none' as const };
      if (link.status === 'pending') {
        await tx`UPDATE training_account_links SET status='conflict',link_version=link_version+1,updated_by=${input.actor.slice(0, 120)} WHERE link_id=${link.linkId}`;
        await audit(tx as unknown as DB, input.personId, input.actor, 'training.link_revoked', link.linkId, { stage: 'pending_cancelled', reason: input.reason.slice(0, 80) });
        return { kind: 'cancelled' as const, link: ref(link, link.linkVersion as number) };
      }
      if (link.method === 'explicit_admin') {
        await tx`UPDATE training_account_links SET status='revoked',updated_by=${input.actor.slice(0, 120)} WHERE link_id=${link.linkId} AND status='active'`;
        await audit(tx as unknown as DB, input.personId, input.actor, 'training.link_revoked', link.linkId, { method: 'explicit_admin', reason: input.reason.slice(0, 80) });
        return { kind: 'legacy' as const, link: ref(link, link.linkVersion as number) };
      }
      if (link.status === 'active') {
        await tx`UPDATE training_account_links SET status='revocation_pending',link_version=link_version+1,updated_by=${input.actor.slice(0, 120)} WHERE link_id=${link.linkId} AND status='active'`;
        await audit(tx as unknown as DB, input.personId, input.actor, 'training.link_revocation_requested', link.linkId, { reason: input.reason.slice(0, 80) });
      }
      const [fresh] = await tx`SELECT link_version AS "linkVersion" FROM training_account_links WHERE link_id=${link.linkId}`;
      return { kind: 'pending_ack' as const, link: ref(link, fresh!.linkVersion as number) };
    });
    if (step.kind === 'none') return { status: 'not_linked' };
    const tell = () => client.post(TRAINING_LINK_REVOKE_PATH, { v: 1, linkId: step.link.linkId, linkVersion: step.link.linkVersion, personId: input.personId, trainingUserId: step.link.trainingUserId, reason: input.reason.slice(0, 80) }, revokeAckSchema);
    if (step.kind === 'cancelled' || step.kind === 'legacy') { await tell(); return step.kind === 'cancelled' ? { status: 'cancelled' } : { status: 'revoked', waived: false }; }
    const result = await tell();
    const missingOnTraining = !result.ok && result.status === 404;                     // Training never had (or no longer has) the link: nothing is left to close there
    if (!result.ok && !missingOnTraining && !input.waiveAcknowledgement) {
      await db.begin(async tx => audit(tx as unknown as DB, input.personId, input.actor, 'training.link_ack_failed', step.link.linkId, { stage: 'revocation', status: result.status }));
      return { status: 'revocation_pending' };
    }
    const ackId = result.ok ? result.data.ackId : missingOnTraining ? 'not-on-training' : `waived:${input.actor}`.slice(0, 200);
    await db.begin(async tx => {
      const [row] = await tx`SELECT status FROM training_account_links WHERE link_id=${step.link.linkId} FOR UPDATE`;
      if (row?.status !== 'revocation_pending') return;
      await tx`UPDATE training_account_links SET status='revoked',link_version=link_version+1,revocation_ack_id=${ackId},updated_by=${input.actor.slice(0, 120)} WHERE link_id=${step.link.linkId} AND status='revocation_pending'`;
      await audit(tx as unknown as DB, input.personId, input.actor, 'training.link_revoked', step.link.linkId, { reason: input.reason.slice(0, 80), waived: !result.ok && !missingOnTraining });
    });
    return { status: 'revoked', waived: !result.ok && !missingOnTraining };
  }

  /** Idempotent creation of a minimal Training profile for a person, its pending link, and the bilateral activation. Resumes from wherever a retry finds it. */
  async function provision(input: { personId: string; displayName: string; idempotencyKey: string; actor: string }): Promise<Provisioning> {
    const requestHash = sha256(`${input.personId}\n${input.displayName}`);
    const begin = await db.begin(async tx => {
      const [person] = await tx`SELECT status FROM platform_persons WHERE id=${input.personId}::uuid FOR UPDATE`;
      if (!person || person.status !== 'active') return { kind: 'person_unavailable' as const };
      const [existing] = await tx`SELECT id,person_id AS "personId",request_hash AS "requestHash",state,training_user_id AS "trainingUserId",correlation_id AS "correlationId" FROM platform_training_provisioning WHERE idempotency_key=${input.idempotencyKey}::uuid`;
      if (existing) {
        if (existing.personId !== input.personId || String(existing.requestHash).trim() !== requestHash) return { kind: 'conflict' as const };
        return { kind: 'resume' as const, row: existing };
      }
      const [open] = await tx`SELECT 1 AS n FROM training_account_links WHERE person_id=${input.personId}::uuid AND status IN ('pending','active','revocation_pending')`;
      if (open) return { kind: 'conflict' as const };
      const [taken] = await tx`SELECT 1 AS n FROM platform_training_provisioning WHERE person_id=${input.personId}::uuid AND state IN ('requested','provisioned')`;
      if (taken) return { kind: 'already_provisioned' as const };
      const [row] = await tx`INSERT INTO platform_training_provisioning(idempotency_key,correlation_id,person_id,request_hash,display_name,created_by)
        VALUES (${input.idempotencyKey}::uuid,${randomUUID()}::uuid,${input.personId}::uuid,${requestHash},${input.displayName},${input.actor.slice(0, 120)})
        RETURNING id,person_id AS "personId",request_hash AS "requestHash",state,training_user_id AS "trainingUserId",correlation_id AS "correlationId"`;
      await audit(tx as unknown as DB, input.personId, input.actor, 'training.provisioning_requested', row!.id as string, {});
      return { kind: 'resume' as const, row: row! };
    });
    if (begin.kind !== 'resume') return begin.kind === 'conflict' ? { status: 'conflict' } : begin.kind === 'already_provisioned' ? { status: 'already_provisioned' } : { status: 'person_unavailable' };
    let row = begin.row;
    if (row.state === 'failed') return { status: 'refused', reason: 'provisioning_failed' };
    if (row.state === 'requested') {
      const result = await client.post(TRAINING_PROVISION_PATH, { v: 1, idempotencyKey: input.idempotencyKey, correlationId: row.correlationId, personId: input.personId, displayName: input.displayName }, provisionedSchema);
      if (!result.ok) {
        const refusal = result.status === 409 ? (result.error ?? 'refused') : null;
        if (refusal && REFUSALS.has(refusal)) {
          await db.begin(async tx => {
            await tx`UPDATE platform_training_provisioning SET state='failed' WHERE id=${row.id} AND state='requested'`;
            await audit(tx as unknown as DB, input.personId, input.actor, 'training.provisioning_failed', row.id as string, { reason: refusal });
          });
          return { status: 'refused', reason: refusal };
        }
        return { status: 'provisioning_pending' };
      }
      row = await db.begin(async tx => {
        const [done] = await tx`UPDATE platform_training_provisioning SET state='provisioned',training_user_id=${result.data.trainingUserId} WHERE id=${row.id} AND state='requested'
          RETURNING id,person_id AS "personId",request_hash AS "requestHash",state,training_user_id AS "trainingUserId",correlation_id AS "correlationId"`;
        if (done) await audit(tx as unknown as DB, input.personId, input.actor, 'training.provisioned', row.id as string, {});
        const [current] = await tx`SELECT id,person_id AS "personId",request_hash AS "requestHash",state,training_user_id AS "trainingUserId",correlation_id AS "correlationId" FROM platform_training_provisioning WHERE id=${row.id}`;
        return current!;
      });
    }
    const trainingUserId = String(row.trainingUserId);
    const link = await db.begin(async tx => {
      for (const key of [`person:${input.personId}`, `training-user:${trainingUserId}`].sort()) await tx.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
      const [existing] = await tx`SELECT link_id AS "linkId",status FROM training_account_links WHERE source_provisioning_id=${row.id}`;
      if (existing) return { linkId: existing.linkId as string, status: existing.status as string };
      const [collision] = await tx`SELECT 1 AS n FROM training_account_links WHERE status IN ('pending','active','revocation_pending') AND (person_id=${input.personId}::uuid OR training_user_id=${trainingUserId})`;
      if (collision) return null;
      const [created] = await tx`INSERT INTO training_account_links(request_id,person_id,training_user_id,status,method,source_provisioning_id,link_version,created_by,updated_by)
        VALUES (${row.id}::uuid,${input.personId}::uuid,${trainingUserId},'pending','provisioned',${row.id}::uuid,1,${input.actor.slice(0, 120)},${input.actor.slice(0, 120)}) RETURNING link_id AS "linkId",status`;
      return { linkId: created!.linkId as string, status: created!.status as string };
    });
    if (!link) return { status: 'conflict' };
    if (link.status === 'active') return { status: 'active', trainingUserId, linkId: link.linkId };
    if (link.status !== 'pending') return { status: 'conflict' };
    const activation = await activate(link.linkId, input.actor);
    return activation.status === 'active' ? { status: 'active', trainingUserId, linkId: link.linkId } : activation.status === 'refused' ? { status: 'refused', reason: activation.reason } : { status: 'link_pending', trainingUserId, linkId: link.linkId };
  }

  return { activate, revoke, provision, client };
}

/* ------------------------------------------------------------------ routes */
export function registerTrainingLinkFlowRoutes(app: FastifyInstance<any, any, any, any, any>, db: DB, options: {
  enabled: boolean;                       // link lifecycle (verify + activate + revoke) — off by default
  provisioningEnabled: boolean;           // profile provisioning — off by default
  flow: ReturnType<typeof createTrainingLinkFlow>;
  transactions: ReturnType<typeof createTrainingLinkTransactions>;
  lifecycle: ReturnType<typeof createTrainingCanonicalLinkLifecycle>;
  resolvePersonAuth: (request: FastifyRequest) => Promise<ResolvedPersonAuth | null>;
  resolveAuthorization: (request: FastifyRequest) => Promise<AuthorizationContext | null>;
  allowedOrigin: string | null;
}) {
  const { flow } = options;
  const originOk = (request: FastifyRequest) => options.allowedOrigin !== null && request.headers.origin === options.allowedOrigin && request.headers['sec-fetch-site'] !== 'cross-site';
  const admin = async (request: FastifyRequest, reply: any) => {
    reply.header('Cache-Control', 'no-store');
    const actor = await options.resolveAuthorization(request);
    if (!actor) { reply.code(401).send({ error: 'authentication_required' }); return null; }
    if (!can(actor, 'identity.people.manage')) { reply.code(403).send({ error: 'permission_denied' }); return null; }
    return actor;
  };
  const activationReply = (reply: any, activation: LinkActivation, linkId: string) => {
    if (activation.status === 'active') return reply.code(200).send({ v: 1, status: 'active', linkId });
    if (activation.status === 'ack_unavailable') return reply.code(202).send({ v: 1, status: 'pending', linkId, retry: true });
    if (activation.status === 'proof_pending') return reply.code(202).send({ v: 1, status: 'pending', linkId, retry: true, reason: 'proof_not_yet_visible' });
    if (activation.status === 'refused') return reply.code(409).send({ error: activation.reason });
    return reply.code(409).send({ error: 'link_not_pending' });
  };

  // Member: finish linking an EXISTING Training account with the owner's own proof (passkey-backed code issued by Training for this transaction).
  app.post('/api/me/training/link', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!options.enabled) return reply.code(423).send({ error: 'training_link_disabled' });
    if (!originOk(request)) return reply.code(403).send({ error: 'origin_rejected' });
    const body = z.object({ transactionId: uuid, challenge: z.string().min(40).max(64), code: z.string().min(43).max(128).regex(/^[A-Za-z0-9_-]+$/) }).strict().safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'validation_error' });
    const auth = await options.resolvePersonAuth(request);
    if (!auth) return reply.code(401).send({ error: 'authentication_required' });
    const verified = await options.transactions.verify({ transactionId: body.data.transactionId, challenge: body.data.challenge, assertion: { v: 1, code: body.data.code }, auth });
    const proceed = verified.status === 'verified' || verified.status === 'not_pending';          // not_pending: a retry after a lost response
    if (!proceed) {
      const code = verified.status === 'wrong_person' || verified.status === 'identity_unavailable' ? 403 : verified.status === 'disabled' ? 423 : verified.status === 'not_found' ? 404 : verified.status === 'verifier_timeout' ? 504 : 409;
      return reply.code(code).send({ error: verified.status });
    }
    const pending = await options.lifecycle.reconcile({ transactionId: body.data.transactionId, auth });
    if (pending.status !== 'pending') return reply.code(pending.status === 'conflict' ? 409 : pending.status === 'disabled' ? 423 : 422).send({ error: pending.status });
    await options.transactions.consume({ transactionId: body.data.transactionId });
    const linkId = String((pending as unknown as { link: { linkId: string } }).link.linkId);
    return activationReply(reply, await flow.activate(linkId, auth.personId), linkId);
  });

  // Member: end my own link. Access stops at once; the link is closed for good after Training acknowledges.
  app.delete('/api/me/training/link', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!options.enabled) return reply.code(423).send({ error: 'training_link_disabled' });
    if (!originOk(request)) return reply.code(403).send({ error: 'origin_rejected' });
    const auth = await options.resolvePersonAuth(request);
    if (!auth) return reply.code(401).send({ error: 'authentication_required' });
    const result = await flow.revoke({ personId: auth.personId, actor: `member:${auth.personId}`, reason: 'member_request' });
    return result.status === 'revocation_pending' ? reply.code(202).send({ v: 1, status: 'revocation_pending', retry: true }) : result.status === 'not_linked' ? reply.code(404).send({ error: 'not_linked' }) : reply.send({ v: 1, ...result });
  });

  // Administrator: revoke / resume a revocation (optionally waiving Training's acknowledgement when Training is unreachable; audited).
  app.post('/api/platform/v1/persons/:personId/training-link/revoke', async (request, reply) => {
    const actor = await admin(request, reply); if (!actor) return;
    if (!options.enabled) return reply.code(423).send({ error: 'training_link_disabled' });
    const params = z.object({ personId: uuid }).safeParse(request.params);
    const body = z.object({ reason: z.string().trim().min(3).max(80), waiveAcknowledgement: z.boolean().optional() }).strict().safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    const result = await flow.revoke({ personId: params.data.personId, actor: actor.actorId, reason: body.data.reason, ...(body.data.waiveAcknowledgement ? { waiveAcknowledgement: true } : {}) });
    return result.status === 'revocation_pending' ? reply.code(202).send({ v: 1, status: 'revocation_pending', retry: true }) : result.status === 'not_linked' ? reply.code(404).send({ error: 'not_linked' }) : reply.send({ v: 1, ...result });
  });

  // Administrator: resume an activation whose acknowledgement was lost (idempotent).
  app.post('/api/platform/v1/persons/:personId/training-link/resume', async (request, reply) => {
    const actor = await admin(request, reply); if (!actor) return;
    if (!options.enabled) return reply.code(423).send({ error: 'training_link_disabled' });
    const params = z.object({ personId: uuid }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'validation_error' });
    const [link] = await db`SELECT link_id AS "linkId" FROM training_account_links WHERE person_id=${params.data.personId}::uuid AND status='pending'`;
    if (!link) return reply.code(404).send({ error: 'no_pending_link' });
    return activationReply(reply, await flow.activate(link.linkId as string, actor.actorId), link.linkId as string);
  });

  // Administrator: create the minimal Training profile for a person (idempotent on the key) and complete the bilateral link.
  app.post('/api/platform/v1/persons/:personId/training-provision', async (request, reply) => {
    const actor = await admin(request, reply); if (!actor) return;
    if (!options.provisioningEnabled) return reply.code(423).send({ error: 'training_provisioning_disabled' });
    const params = z.object({ personId: uuid }).safeParse(request.params);
    const key = uuid.safeParse(request.headers['idempotency-key']);
    const body = z.object({ displayName: z.string().min(1).max(60).refine(value => value.trim() === value && !/[\u0000-\u001f\u007f<>]/.test(value)) }).strict().safeParse(request.body);
    if (!params.success || !key.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    const result = await flow.provision({ personId: params.data.personId, displayName: body.data.displayName, idempotencyKey: key.data, actor: actor.actorId });
    switch (result.status) {
      case 'active': return reply.code(201).send({ v: 1, status: 'active', trainingUserId: result.trainingUserId, linkId: result.linkId });
      case 'link_pending': return reply.code(202).send({ v: 1, status: 'link_pending', trainingUserId: result.trainingUserId, linkId: result.linkId, retry: true });
      case 'provisioning_pending': return reply.code(202).send({ v: 1, status: 'provisioning_pending', retry: true });
      case 'person_unavailable': return reply.code(404).send({ error: 'person_not_found' });
      case 'refused': return reply.code(409).send({ error: result.reason ?? 'refused' });
      default: return reply.code(409).send({ error: result.status });
    }
  });
}
