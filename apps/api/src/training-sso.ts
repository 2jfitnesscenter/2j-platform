import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { createDatabase } from './db.js';
import { verifyInternalServiceRequest, type InternalServiceKeys } from './internal-service-auth.js';
import { computeTrainingCapabilities } from './training-capabilities-api.js';
import type { ResolvedPersonAuth } from './training-link-protocol.js';

type DB = ReturnType<typeof createDatabase>['client'];
export const TRAINING_SSO_AUDIENCE = '2j-training-sso';
export const TRAINING_SSO_PURPOSE = 'training-session';
export const TRAINING_SSO_TTL_SECONDS = 60;
/** At most this many codes can be issued per person in any rolling minute; a new code supersedes the previous live one. */
export const TRAINING_SSO_MAX_ISSUES_PER_MINUTE = 10;
/** Repeated redemption attempts of one dead code are audited at most this many times (replay protection itself is unaffected). */
export const TRAINING_SSO_MAX_REJECTION_AUDITS_PER_CODE = 5;
export const TRAINING_SSO_REDEEM_PATH = '/api/internal/platform/v2/sso/redeem';
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
/** PKCE S256: the challenge a browser derives from its secret verifier. Both sides of the contract use exactly this. */
export const bindingChallengeFor = (verifier: string) => createHash('sha256').update(verifier, 'ascii').digest('base64url');
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
/** What Home sends to ask for a code: the challenge created by the browser at Training (never the verifier). */
const issueBody = z.object({ challenge: z.string().regex(CHALLENGE) }).strict();
/** v2 of the redeem request adds the verifier Training read from the HttpOnly cookie of the browser that started the flow. */
const redeemBody = z.object({
  v: z.literal(2),
  code: z.string().min(43).max(128).regex(/^[A-Za-z0-9_-]+$/),
  verifier: z.string().min(43).max(128).regex(/^[A-Za-z0-9_-]+$/),
  audience: z.string().min(1).max(120),
  purpose: z.string().min(1).max(120),
}).strict();

export type TrainingSsoOptions = {
  enabled: boolean;
  keys: InternalServiceKeys;
  resolvePersonAuth: (request: FastifyRequest) => Promise<ResolvedPersonAuth | null>;
  /** Fixed, server-side destination. The code is appended as a URL fragment so it is never sent to a server or logged. */
  redirectUrl: string | null;
  /** Exact origin of the member app. Required: issuance enforces it for every authentication provider (CSRF defence). */
  allowedOrigin: string | null;
};

function validRedirect(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (url.hash || url.search || url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) return null;
    return url.toString();
  } catch { return null; }
}

function noStore(reply: FastifyReply) {
  reply.header('Cache-Control', 'no-store');
  reply.header('Referrer-Policy', 'no-referrer');
}

/**
 * Platform-issued, single-use Training session codes. Platform proves the person; Training redeems the code
 * server-to-server (2J-SERVICE-AUTH-V1) and only then opens its own session. Nothing here changes Training identity.
 */
export function registerTrainingSsoRoutes(app: FastifyInstance<any, any, any, any, any>, db: DB, options: TrainingSsoOptions) {
  const redirectBase = validRedirect(options.redirectUrl);
  const allowedOrigin = options.allowedOrigin;

  app.post('/api/me/training/sso', async (request, reply) => {
    noStore(reply);
    if (!options.enabled) return reply.code(423).send({ error: 'training_sso_disabled' });
    if (!redirectBase || !allowedOrigin) return reply.code(503).send({ error: 'training_sso_not_configured' });
    // Cookie-authenticated, state-changing: the browser must say it comes from the member app, whoever authenticated it.
    const fetchSite = request.headers['sec-fetch-site'];
    if (request.headers.origin !== allowedOrigin || fetchSite === 'cross-site') return reply.code(403).send({ error: 'origin_rejected' });
    // The code is bound to the browser that started the flow at Training: without its challenge there is nothing to bind to.
    const asked = issueBody.safeParse(request.body);
    if (!asked.success) return reply.code(400).send({ error: 'binding_challenge_required' });
    const auth = await options.resolvePersonAuth(request);
    if (!auth) return reply.code(401).send({ error: 'authentication_required' });
    const [subject] = await db`SELECT s.id FROM platform_person_auth_subjects s JOIN platform_persons p ON p.id=s.person_id
      WHERE s.person_id=${auth.personId}::uuid AND s.provider=${auth.provider} AND s.provider_version=${auth.providerVersion} AND s.auth_subject=${auth.authSubject}
        AND s.status='active' AND p.status='active'`;
    if (!subject) return reply.code(401).send({ error: 'authentication_required' });

    const computed = await computeTrainingCapabilities(db, auth.personId);
    if (computed.status !== 'ok') return reply.code(computed.status === 'not_found' ? 401 : 503).send({ error: computed.status === 'not_found' ? 'authentication_required' : 'capabilities_unavailable' });
    const caps = computed.payload;
    if (caps.capabilityLevel === 'blocked' || !caps.trainingSubject.trainingUserId) {
      if (caps.reasonCode === 'ADMIN_SUSPENDED') return reply.code(403).send({ error: 'training_access_suspended', reasonCode: caps.reasonCode });
      return reply.code(409).send({ error: 'training_link_required', reasonCode: caps.reasonCode });
    }

    const code = randomBytes(32).toString('base64url');
    try {
      const issued = await db.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${auth.personId}::text,0))`;
        const [recent] = await tx`SELECT count(*)::int AS n FROM platform_training_sso_codes WHERE person_id=${auth.personId}::uuid AND created_at>now()-interval '1 minute'`;
        if ((recent?.n ?? 0) >= TRAINING_SSO_MAX_ISSUES_PER_MINUTE) return null;
        // One live code per person: issuing a new one retires the previous (it can no longer be redeemed).
        await tx`UPDATE platform_training_sso_codes SET state='revoked',terminal_reason='superseded',version=version+1
          WHERE person_id=${auth.personId}::uuid AND state='pending' AND expires_at>now()`;
        const [row] = await tx`INSERT INTO platform_training_sso_codes(code_hash,person_id,auth_subject_link_id,training_user_id,audience,purpose,binding_challenge,expires_at)
          VALUES (${hash(code)},${auth.personId}::uuid,${subject.id},${caps.trainingSubject.trainingUserId!},${TRAINING_SSO_AUDIENCE},${TRAINING_SSO_PURPOSE},${asked.data.challenge},now()+(${TRAINING_SSO_TTL_SECONDS} * interval '1 second'))
          RETURNING id,expires_at AS "expiresAt"`;
        await tx`INSERT INTO platform_identity_audit_events(person_id,actor_id,action,resource_id,details)
          VALUES (${auth.personId}::uuid,${String(subject.id)},'training.sso_issued',${row!.id},(${JSON.stringify({ audience: TRAINING_SSO_AUDIENCE, capabilityLevel: caps.capabilityLevel })}::text)::jsonb)`;
        return row!;
      });
      if (!issued) return reply.code(429).send({ error: 'training_sso_rate_limited' });
      return reply.code(201).send({ v: 1, redirectUrl: `${redirectBase}#code=${code}`, expiresAt: new Date(issued.expiresAt).toISOString() });
    } catch (error) {
      request.log.error({ errorCode: typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : 'unknown' }, 'training sso issuance failed');
      return reply.code(503).send({ error: 'training_sso_unavailable' });
    }
  });

  // Encapsulated scope: the route needs the exact request bytes to verify the signed body digest.
  app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
    scope.post(TRAINING_SSO_REDEEM_PATH, async (request, reply) => {
      noStore(reply);
      if (!options.enabled) return reply.code(423).send({ error: 'training_sso_disabled' });
      if (Object.keys(options.keys).length === 0) return reply.code(503).send({ error: 'service_auth_unavailable' });
      const raw = Buffer.isBuffer(request.body) ? request.body : null;
      if (!raw) return reply.code(400).send({ error: 'invalid_sso_request' });
      const verified = await verifyInternalServiceRequest(request, db, options.keys, { expectedMethod: 'POST', expectedPath: TRAINING_SSO_REDEEM_PATH, body: raw });
      if (verified && 'unavailable' in verified) return reply.code(503).send({ error: 'service_auth_unavailable' });
      if (!verified) return reply.code(401).send({ error: 'service_auth_rejected' });
      if (verified.caller !== 'bunker') return reply.code(403).send({ error: 'service_caller_not_allowed' });
      let json: unknown;
      try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { return reply.code(400).send({ error: 'invalid_sso_request' }); }
      const parsed = redeemBody.safeParse(json);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_sso_request' });
      if (parsed.data.audience !== TRAINING_SSO_AUDIENCE || parsed.data.purpose !== TRAINING_SSO_PURPOSE) return reply.code(409).send({ error: 'sso_context_mismatch' });

      const codeHash = hash(parsed.data.code);
      const actor = `service:${verified.keyId}`.slice(0, 120);

      try {
        const outcome = await db.begin(async (tx) => {
          const [row] = await tx`SELECT id,person_id AS "personId",auth_subject_link_id AS "subjectId",training_user_id AS "trainingUserId",binding_challenge AS "bindingChallenge",state,expires_at<=now() AS "isExpired"
            FROM platform_training_sso_codes WHERE code_hash=${codeHash} FOR UPDATE`;
          if (!row) return { http: 404, error: 'sso_code_not_found' } as const;
          // Replays of a dead code stay rejected, but the evidence they leave is bounded (no unbounded append-only growth).
          const reject = async (reason: string) => {
            await tx`INSERT INTO platform_identity_audit_events(person_id,actor_id,action,resource_id,details)
              SELECT ${row.personId}::uuid,${actor}::text,'training.sso_rejected',${row.id}::uuid,(${JSON.stringify({ reason })}::text)::jsonb
              WHERE (SELECT count(*) FROM platform_identity_audit_events WHERE resource_id=${row.id}::uuid AND action='training.sso_rejected')<${TRAINING_SSO_MAX_REJECTION_AUDITS_PER_CODE}`;
          };
          if (row.state === 'consumed') { await reject('already_used'); return { http: 409, error: 'sso_code_already_used' } as const; }
          if (row.state === 'revoked') { await reject('revoked'); return { http: 409, error: 'sso_code_revoked' } as const; }
          if (row.state === 'expired' || row.isExpired) {
            if (row.state === 'pending') await tx`UPDATE platform_training_sso_codes SET state='expired',terminal_reason='ttl_elapsed',version=version+1 WHERE id=${row.id}`;
            await reject('expired');
            return { http: 410, error: 'sso_code_expired' } as const;
          }
          // Browser binding: only the browser that started the flow at Training holds the verifier. A mismatch does NOT consume the code
          // (a forwarded or leaked code must not be burnable by whoever holds it), but it is audited and never succeeds.
          const expectedChallenge = typeof row.bindingChallenge === 'string' ? Buffer.from(row.bindingChallenge, 'utf8') : null;
          const presentedChallenge = Buffer.from(bindingChallengeFor(parsed.data.verifier), 'utf8');
          if (!expectedChallenge || expectedChallenge.length !== presentedChallenge.length || !timingSafeEqual(expectedChallenge, presentedChallenge)) {
            await reject('binding_mismatch');
            return { http: 403, error: 'sso_binding_mismatch' } as const;
          }
          // Serialise with suspension/lifting (they take FOR UPDATE on the person): whatever they commit before this lock is visible to
          // the capability read below, and anything committed after it applies from the next verification. A stale snapshot cannot win.
          await tx`SELECT id FROM platform_persons WHERE id=${row.personId}::uuid FOR SHARE`;
          const [binding] = await tx`SELECT 1 AS ok FROM platform_persons p
            JOIN platform_person_auth_subjects s ON s.person_id=p.id AND s.id=${row.subjectId} AND s.status='active'
            JOIN training_account_links l ON l.person_id=p.id AND l.status='active' AND l.training_user_id=${row.trainingUserId}
            WHERE p.id=${row.personId}::uuid AND p.status='active' FOR SHARE OF s,l`;
          if (!binding) {
            await tx`UPDATE platform_training_sso_codes SET state='revoked',terminal_reason='binding_changed',version=version+1 WHERE id=${row.id}`;
            await reject('binding_changed');
            return { http: 409, error: 'sso_binding_changed' } as const;
          }
          const computed = await computeTrainingCapabilities(tx as unknown as DB, String(row.personId));
          if (computed.status !== 'ok') return { http: 503, error: 'capabilities_unavailable' } as const;
          const caps = computed.payload;
          if (caps.capabilityLevel === 'blocked' || caps.trainingSubject.trainingUserId !== row.trainingUserId) {
            await tx`UPDATE platform_training_sso_codes SET state='revoked',terminal_reason='capability_blocked',version=version+1 WHERE id=${row.id}`;
            await reject('capability_blocked');
            return { http: 403, error: 'training_access_blocked', reasonCode: caps.reasonCode } as const;
          }
          await tx`UPDATE platform_training_sso_codes SET state='consumed',consumed_key_id=${verified.keyId},version=version+1 WHERE id=${row.id}`;
          await tx`INSERT INTO platform_identity_audit_events(person_id,actor_id,action,resource_id,details)
            VALUES (${row.personId}::uuid,${actor},'training.sso_redeemed',${row.id},(${JSON.stringify({ capabilityLevel: caps.capabilityLevel })}::text)::jsonb)`;
          return { http: 200, body: { v: 1 as const, personId: String(row.personId), trainingUserId: String(row.trainingUserId), capabilities: caps } } as const;
        });
        if (outcome.http === 200) return reply.code(200).send(outcome.body);
        return reply.code(outcome.http).send('reasonCode' in outcome ? { error: outcome.error, reasonCode: outcome.reasonCode } : { error: outcome.error });
      } catch (error) {
        request.log.error({ errorCode: typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : 'unknown' }, 'training sso redemption failed');
        return reply.code(503).send({ error: 'training_sso_unavailable' });
      }
    });
  });
}
