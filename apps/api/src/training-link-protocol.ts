import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createDatabase } from './db.js';

const uuid = z.string().uuid().transform((value) => value.toLowerCase());
export const TRAINING_LINK_TTL_MS = 5 * 60 * 1000;
export const TRAINING_LINK_AUDIENCE = '2j-training-account-link';
export const TRAINING_LINK_PURPOSE = 'training-account-link';
export type ResolvedPersonAuth = { personId: string; authSubject: string; provider: string; providerVersion: number };
const transactionDto = z.object({
  transactionId: uuid,
  personId: uuid,
  state: z.enum(['pending', 'verified', 'consumed', 'expired', 'cancelled']),
  expiresAt: z.coerce.date().transform((value) => value.toISOString()),
  version: z.number().int().positive(),
}).strict();
export const TrainingLinkChallengeV1 = z.object({
  v: z.literal(1),
  status: z.enum(['created', 'replay']),
  transaction: transactionDto,
  challenge: z.string().min(40).max(64).nullable(),
  audience: z.literal(TRAINING_LINK_AUDIENCE),
  purpose: z.literal(TRAINING_LINK_PURPOSE),
}).strict();
export const TrainingLinkTransactionReceiptV1 = z.object({ v: z.literal(1), status: z.enum(['cancelled', 'consumed', 'expired']), transaction: transactionDto }).strict();
type SqlClient = ReturnType<typeof createDatabase>['client'];
const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
function publicTransaction(value: Record<string, unknown>) {
  return transactionDto.parse({ transactionId: value.transactionId, personId: value.personId, state: value.state, expiresAt: value.expiresAt, version: value.version });
}

export function createTrainingLinkTransactions(database: SqlClient, options: { enabled?: boolean; serviceCallsEnabled?: boolean; ttlMs?: number } = {}) {
  const ttlMs = Math.max(1, Math.min(options.ttlMs ?? TRAINING_LINK_TTL_MS, TRAINING_LINK_TTL_MS));
  return {
    async create(input: { personId: string; authSubject: string; provider: string; providerVersion: number; requestId: string }) {
      if (!options.enabled) return { status: 'disabled' as const };
      const personId = uuid.parse(input.personId), requestId = uuid.parse(input.requestId);
      const challenge = randomBytes(32).toString('base64url'), nonceHash = digest(challenge);
      const transactionId = randomUUID();
      try {
        const result = await database.begin(async (tx) => {
          await tx.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))', [requestId]);
          const bindings = await tx.unsafe("SELECT s.id AS \"authSubjectLinkId\" FROM platform_person_auth_subjects s JOIN platform_persons p ON p.id=s.person_id WHERE s.person_id=$1 AND s.provider=$2 AND s.provider_version=$3 AND s.auth_subject=$4 AND s.status='active' AND p.status='active' FOR UPDATE OF s,p", [personId, input.provider, input.providerVersion, input.authSubject]);
          if (!bindings[0]) throw Object.assign(new Error('Auth binding unavailable'), { code: 'AUTH_BINDING_UNAVAILABLE' });
          const requestHash = digest(personId + '\n' + input.provider + '\n' + input.providerVersion + '\n' + bindings[0].authSubjectLinkId);
          const replay = await tx.unsafe('SELECT transaction_id AS \"transactionId\",person_id AS \"personId\",auth_subject_link_id AS \"authSubjectLinkId\",request_hash AS \"requestHash\",state,expires_at AS \"expiresAt\",version FROM training_link_transactions WHERE request_id=$1 FOR UPDATE', [requestId]);
          if (replay[0]) {
            if (replay[0].requestHash.trim() !== requestHash || replay[0].personId !== personId || replay[0].authSubjectLinkId !== bindings[0].authSubjectLinkId) throw Object.assign(new Error('Idempotency conflict'), { code: 'IDEMPOTENCY_CONFLICT' });
            return { replay: true as const, row: replay[0] };
          }
          const rows = await tx.unsafe("INSERT INTO training_link_transactions(transaction_id,person_id,auth_subject_link_id,request_id,request_hash,nonce_hash,audience,purpose,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now()+($9 * interval '1 millisecond')) RETURNING transaction_id AS \"transactionId\",person_id AS \"personId\",state,expires_at AS \"expiresAt\",version", [transactionId, personId, bindings[0].authSubjectLinkId, requestId, requestHash, nonceHash, TRAINING_LINK_AUDIENCE, TRAINING_LINK_PURPOSE, ttlMs]);
          await tx.unsafe("INSERT INTO platform_identity_audit_events(person_id,actor_id,action,resource_id,details) VALUES ($1,$2,'training.link_transaction_created',$3,($4::text)::jsonb)", [personId, bindings[0].authSubjectLinkId, transactionId, JSON.stringify({ audience: TRAINING_LINK_AUDIENCE, purpose: TRAINING_LINK_PURPOSE })]);
          return { replay: false as const, row: rows[0] };
        });
        return result.replay
          ? { v: 1 as const, status: 'replay' as const, transaction: result.row, challenge: null, audience: TRAINING_LINK_AUDIENCE, purpose: TRAINING_LINK_PURPOSE }
          : { v: 1 as const, status: 'created' as const, transaction: result.row, challenge, audience: TRAINING_LINK_AUDIENCE, purpose: TRAINING_LINK_PURPOSE };
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === 'AUTH_BINDING_UNAVAILABLE') return { status: 'identity_unavailable' as const };
        if (code === 'IDEMPOTENCY_CONFLICT') return { status: 'idempotency_conflict' as const };
        throw error;
      }
    },
    async cancel(input: { transactionId: string; personId: string; authSubject: string; provider: string; providerVersion: number }) {
      if (!options.enabled) return { status: 'disabled' as const };
      const transactionId = uuid.parse(input.transactionId), personId = uuid.parse(input.personId);
      return database.begin(async (tx) => {
        const rows = await tx.unsafe('SELECT t.transaction_id AS "transactionId",t.person_id AS "personId",t.auth_subject_link_id AS "authSubjectLinkId",t.state,t.expires_at AS "expiresAt",t.expires_at<=now() AS "isExpired",t.version FROM training_link_transactions t WHERE t.transaction_id=$1 FOR UPDATE', [transactionId]);
        const row = rows[0];
        if (!row || row.personId !== personId) return { status: 'not_found' as const };
        const binding = await tx.unsafe("SELECT id FROM platform_person_auth_subjects WHERE id=$1 AND person_id=$2 AND provider=$3 AND provider_version=$4 AND auth_subject=$5 AND status='active' FOR SHARE", [row.authSubjectLinkId, personId, input.provider, input.providerVersion, input.authSubject]);
        if (!binding.length) return { status: 'identity_unavailable' as const };
        if (['consumed','cancelled','expired'].includes(row.state)) return { status: row.state as 'consumed'|'cancelled'|'expired', transaction: row };
        if (row.isExpired) {
          const [expired] = await tx.unsafe("UPDATE training_link_transactions SET state='expired',failure_reason='ttl_elapsed',version=version+1 WHERE transaction_id=$1 RETURNING transaction_id AS \"transactionId\",person_id AS \"personId\",state,expires_at AS \"expiresAt\",version", [transactionId]);
          await tx.unsafe("INSERT INTO platform_identity_audit_events(person_id,actor_id,action,resource_id,details) VALUES ($1,$2,'training.link_transaction_expired',$3,'{}'::jsonb)", [personId, row.authSubjectLinkId, transactionId]);
          return { status: 'expired' as const, transaction: expired };
        }
        const [cancelled] = await tx.unsafe("UPDATE training_link_transactions SET state='cancelled',cancelled_at=now(),failure_reason='cancelled_by_subject',version=version+1 WHERE transaction_id=$1 RETURNING transaction_id AS \"transactionId\",person_id AS \"personId\",state,expires_at AS \"expiresAt\",version", [transactionId]);
        await tx.unsafe("INSERT INTO platform_identity_audit_events(person_id,actor_id,action,resource_id,details) VALUES ($1,$2,'training.link_transaction_cancelled',$3,'{}'::jsonb)", [personId, row.authSubjectLinkId, transactionId]);
        return { status: 'cancelled' as const, transaction: cancelled };
      });
    },
    /** Internal future transition; no route is registered and no verifier is configured in this task. */
    async verify(input: { transactionId: string; challenge: string; assertion: unknown; auth: ResolvedPersonAuth }, verifier?: (assertion: unknown, signal: AbortSignal) => Promise<string | null>) {
      if (!options.enabled || !options.serviceCallsEnabled || !verifier) return { status: 'disabled' as const };
      const transactionId = uuid.parse(input.transactionId);
      const auth = { ...input.auth, personId: uuid.parse(input.auth.personId) };
      const candidate = await database.begin(async (tx) => tx.unsafe('SELECT t.nonce_hash AS \"nonceHash\",t.person_id AS \"personId\",t.state,t.expires_at AS \"expiresAt\",t.expires_at<=now() AS \"isExpired\",s.provider,s.provider_version AS \"providerVersion\",s.auth_subject AS \"authSubject\",s.status AS \"subjectStatus\",p.status AS \"personStatus\" FROM training_link_transactions t JOIN platform_person_auth_subjects s ON s.id=t.auth_subject_link_id JOIN platform_persons p ON p.id=t.person_id WHERE t.transaction_id=$1 FOR UPDATE OF t,s,p', [transactionId]));
      if (!candidate[0]) return { status: 'not_found' as const };
      if (candidate[0].personId !== auth.personId || candidate[0].provider !== auth.provider || candidate[0].providerVersion !== auth.providerVersion || candidate[0].authSubject !== auth.authSubject) return { status: 'wrong_person' as const };
      if (candidate[0].subjectStatus !== 'active' || candidate[0].personStatus !== 'active') return { status: 'identity_unavailable' as const };
      if (candidate[0].state !== 'pending') return { status: 'not_pending' as const };
      if (candidate[0].isExpired) return { status: 'expired' as const };
      const challengeHash = Buffer.from(digest(input.challenge), 'hex'), storedHash = Buffer.from(candidate[0].nonceHash.trim(), 'hex');
      if (storedHash.length !== challengeHash.length || !timingSafeEqual(storedHash, challengeHash)) return { status: 'invalid_challenge' as const };
      const controller = new AbortController();
      let trainingUserId: string | null = null;
      try { trainingUserId = await verifier(input.assertion, controller.signal); } catch { trainingUserId = null; }
      const candidateUser = z.string().min(1).max(200).refine((value) => value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value)).safeParse(trainingUserId);
      if (!candidateUser.success) return { status: 'proof_rejected' as const };
      return database.begin(async (tx) => {
        const [row] = await tx.unsafe("UPDATE training_link_transactions SET state='verified',verified_training_user_id=$2,version=version+1 WHERE transaction_id=$1 AND state='pending' AND expires_at>now() RETURNING transaction_id AS \"transactionId\",person_id AS \"personId\",auth_subject_link_id AS \"authSubjectLinkId\",state,version", [transactionId, candidateUser.data]);
        if (!row) return { status: 'replayed' as const };
        await tx.unsafe("INSERT INTO platform_identity_audit_events(person_id,actor_id,action,resource_id,details) VALUES ($1,$2,'training.link_transaction_verified',$3,'{}'::jsonb)", [row.personId, row.authSubjectLinkId, transactionId]);
        return { status: 'verified' as const, transaction: row };
      });
    },
    /** Consumes a verified transaction only; deliberately creates no canonical link or remote acknowledgement. */
    async consume(input: { transactionId: string }) {
      if (!options.enabled || !options.serviceCallsEnabled) return { status: 'disabled' as const };
      const transactionId = uuid.parse(input.transactionId);
      return database.begin(async (tx) => {
        const [row] = await tx.unsafe("UPDATE training_link_transactions SET state='consumed',consumed_at=now(),version=version+1 WHERE transaction_id=$1 AND state='verified' AND verified_training_user_id IS NOT NULL AND expires_at>now() RETURNING transaction_id AS \"transactionId\",person_id AS \"personId\",auth_subject_link_id AS \"authSubjectLinkId\",state,version", [transactionId]);
        if (!row) return { status: 'not_consumable' as const };
        await tx.unsafe("INSERT INTO platform_identity_audit_events(person_id,actor_id,action,resource_id,details) VALUES ($1,$2,'training.link_transaction_consumed',$3,'{}'::jsonb)", [row.personId, row.authSubjectLinkId, transactionId]);
        return { status: 'consumed' as const, transaction: row };
      });
    },
  };
}

export function registerTrainingLinkTransactionRoutes(app: FastifyInstance, database: SqlClient, options: {
  enabled?: boolean;
  serviceCallsEnabled?: boolean;
  resolvePersonAuth: (request: FastifyRequest) => Promise<ResolvedPersonAuth | null>;
}) {
  const service = createTrainingLinkTransactions(database, { enabled: options.enabled ?? false, serviceCallsEnabled: options.serviceCallsEnabled ?? false });
  app.post('/api/platform/v1/training-link-transactions', async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache');
    if (!options.enabled) return reply.code(423).send({ error: 'training_verified_linking_disabled' });
    const body = z.object({ requestId: uuid }).strict().safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'validation_error' });
    let resolved: ResolvedPersonAuth | null;
    try { resolved = await options.resolvePersonAuth(request); } catch { return reply.code(503).send({ error: 'auth_subject_resolution_unavailable' }); }
    if (!resolved) return reply.code(401).send({ error: 'authentication_required' });
    const identity = z.object({
      personId: uuid,
      authSubject: z.string().min(1).max(500).refine((value) => value === value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)),
      provider: z.string().regex(/^[a-z][a-z0-9.-]{0,63}$/),
      providerVersion: z.number().int().min(1).max(32767),
    }).strict().safeParse(resolved);
    if (!identity.success) return reply.code(401).send({ error: 'authentication_required' });
    try {
      const result = await service.create({ ...identity.data, requestId: body.data.requestId });
      if (result.status === 'identity_unavailable') return reply.code(403).send({ error: 'verified_person_binding_required' });
      if (result.status === 'idempotency_conflict') return reply.code(409).send({ error: 'idempotency_conflict' });
      if (result.status === 'disabled') return reply.code(423).send({ error: 'training_verified_linking_disabled' });
      const response = TrainingLinkChallengeV1.parse({ ...result, transaction: publicTransaction(result.transaction as Record<string, unknown>) });
      return reply.code(result.status === 'created' ? 201 : 200).send(response);
    } catch { return reply.code(500).send({ error: 'internal_error' }); }
  });
  app.delete('/api/platform/v1/training-link-transactions/:transactionId', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!options.enabled) return reply.code(423).send({ error: 'training_verified_linking_disabled' });
    const params = z.object({ transactionId: uuid }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'validation_error' });
    let resolved: ResolvedPersonAuth | null;
    try { resolved = await options.resolvePersonAuth(request); } catch { return reply.code(503).send({ error: 'auth_subject_resolution_unavailable' }); }
    if (!resolved) return reply.code(401).send({ error: 'authentication_required' });
    try {
      const result = await service.cancel({ transactionId: params.data.transactionId, ...resolved });
      if (result.status === 'not_found') return reply.code(404).send({ error: 'link_transaction_not_found' });
      if (result.status === 'identity_unavailable') return reply.code(403).send({ error: 'verified_person_binding_required' });
      if (result.status === 'disabled') return reply.code(423).send({ error: 'training_verified_linking_disabled' });
      return reply.send(TrainingLinkTransactionReceiptV1.parse({ v: 1, transaction: publicTransaction(result.transaction as Record<string, unknown>), status: result.status }));
    } catch { return reply.code(500).send({ error: 'internal_error' }); }
  });
}
