import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can, type AuthorizationContext } from '@2j/permissions';
import type { createDatabase } from './db.js';
import { verifyInternalServiceRequest, type InternalServiceKeys } from './internal-service-auth.js';
import { bindingChallengeFor } from './training-sso.js';

type DB = ReturnType<typeof createDatabase>['client'];
export const BUNKER_ADMIN_PERMISSION = 'bunker.admin.access';
/** Distinct from the member Training SSO (`2j-training-sso` / `training-session`): a code of one flow is never valid in the other. */
export const BUNKER_ADMIN_SSO_AUDIENCE = '2j-bunker-admin-sso';
export const BUNKER_ADMIN_SSO_PURPOSE = 'bunker-admin-session';
export const BUNKER_ADMIN_SSO_TTL_SECONDS = 60;
export const BUNKER_ADMIN_SSO_MAX_ISSUES_PER_MINUTE = 10;
export const BUNKER_ADMIN_SSO_MAX_REJECTION_AUDITS_PER_CODE = 5;
export const BUNKER_ADMIN_SSO_REDEEM_PATH = '/api/internal/platform/v2/staff-sso/redeem';
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const issueBody = z.object({ challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
const redeemBody = z.object({
  v: z.literal(2),
  code: z.string().min(43).max(128).regex(/^[A-Za-z0-9_-]+$/),
  verifier: z.string().min(43).max(128).regex(/^[A-Za-z0-9_-]+$/),
  audience: z.string().min(1).max(120),
  purpose: z.string().min(1).max(120),
}).strict();

export type StaffBunkerSsoOptions = {
  enabled: boolean;
  keys: InternalServiceKeys;
  /** Trusted staff session (same resolver as every other Platform staff route). */
  resolveStaff: (request: FastifyRequest) => Promise<AuthorizationContext | null>;
  /** Current authorization of a person, read fresh at redemption: a revoked session, demoted profile or suspended person must not pass. */
  currentAuthorization: (personId: string) => Promise<AuthorizationContext | null>;
  /** Fixed server-side Bunker admin redeem page. The code is appended as a URL fragment. */
  redirectUrl: string | null;
  /** Exact origins of the staff app. Issuance enforces them (CSRF defence). */
  allowedOrigins: readonly string[];
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
function noStore(reply: FastifyReply) { reply.header('Cache-Control', 'no-store'); reply.header('Referrer-Policy', 'no-referrer'); }

/**
 * Staff single sign-on into the Bunker admin. Platform proves the person and checks `bunker.admin.access` (assigned per profile, never per person);
 * Bunker redeems the one-time code server-to-server (2J-SERVICE-AUTH-V1) and keeps its own UID, mapped from the returned personId.
 */
export function registerStaffBunkerSsoRoutes(app: FastifyInstance<any, any, any, any, any>, db: DB, options: StaffBunkerSsoOptions) {
  const redirectBase = validRedirect(options.redirectUrl);

  app.post('/api/staff/bunker/sso', async (request, reply) => {
    noStore(reply);
    if (!options.enabled) return reply.code(423).send({ error: 'bunker_sso_disabled' });
    if (!redirectBase || options.allowedOrigins.length === 0) return reply.code(503).send({ error: 'bunker_sso_not_configured' });
    if (typeof request.headers.origin !== 'string' || !options.allowedOrigins.includes(request.headers.origin) || request.headers['sec-fetch-site'] === 'cross-site') return reply.code(403).send({ error: 'origin_rejected' });
    const asked = issueBody.safeParse(request.body);
    if (!asked.success) return reply.code(400).send({ error: 'binding_challenge_required' });
    const context = await options.resolveStaff(request);
    if (!context?.personId) return reply.code(401).send({ error: 'authentication_required' });
    const personId = context.personId;
    if (!can(context, BUNKER_ADMIN_PERMISSION)) return reply.code(403).send({ error: 'permission_denied' });
    const [subject] = await db`SELECT s.id FROM platform_person_auth_subjects s JOIN platform_persons p ON p.id=s.person_id
      WHERE s.person_id=${personId}::uuid AND s.auth_subject=${context.actorId} AND s.status='active' AND p.status='active'`;
    if (!subject) return reply.code(401).send({ error: 'authentication_required' });
    const code = randomBytes(32).toString('base64url');
    try {
      const issued = await db.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${personId}::text,1))`;
        const [recent] = await tx`SELECT count(*)::int AS n FROM platform_staff_sso_codes WHERE person_id=${personId}::uuid AND created_at>now()-interval '1 minute'`;
        if ((recent?.n ?? 0) >= BUNKER_ADMIN_SSO_MAX_ISSUES_PER_MINUTE) return null;
        await tx`UPDATE platform_staff_sso_codes SET state='revoked',terminal_reason='superseded',version=version+1
          WHERE person_id=${personId}::uuid AND state='pending' AND expires_at>now()`;
        const [row] = await tx`INSERT INTO platform_staff_sso_codes(code_hash,person_id,auth_subject_link_id,audience,purpose,binding_challenge,expires_at)
          VALUES (${hash(code)},${personId}::uuid,${subject.id},${BUNKER_ADMIN_SSO_AUDIENCE},${BUNKER_ADMIN_SSO_PURPOSE},${asked.data.challenge},now()+(${BUNKER_ADMIN_SSO_TTL_SECONDS} * interval '1 second'))
          RETURNING id,expires_at AS "expiresAt"`;
        await tx`INSERT INTO platform_identity_audit_events(person_id,actor_id,action,resource_id,details)
          VALUES (${personId}::uuid,${String(subject.id)},'staff.bunker_sso_issued',${row!.id},(${JSON.stringify({ audience: BUNKER_ADMIN_SSO_AUDIENCE, role: context.role })}::text)::jsonb)`;
        return row!;
      });
      if (!issued) return reply.code(429).send({ error: 'bunker_sso_rate_limited' });
      return reply.code(201).send({ v: 1, redirectUrl: `${redirectBase}#code=${code}`, expiresAt: new Date(issued.expiresAt).toISOString() });
    } catch (error) {
      request.log.error({ errorCode: typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : 'unknown' }, 'bunker staff sso issuance failed');
      return reply.code(503).send({ error: 'bunker_sso_unavailable' });
    }
  });

  app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
    scope.post(BUNKER_ADMIN_SSO_REDEEM_PATH, async (request, reply) => {
      noStore(reply);
      if (!options.enabled) return reply.code(423).send({ error: 'bunker_sso_disabled' });
      if (Object.keys(options.keys).length === 0) return reply.code(503).send({ error: 'service_auth_unavailable' });
      const raw = Buffer.isBuffer(request.body) ? request.body : null;
      if (!raw) return reply.code(400).send({ error: 'invalid_sso_request' });
      const verified = await verifyInternalServiceRequest(request, db, options.keys, { expectedMethod: 'POST', expectedPath: BUNKER_ADMIN_SSO_REDEEM_PATH, body: raw });
      if (verified && 'unavailable' in verified) return reply.code(503).send({ error: 'service_auth_unavailable' });
      if (!verified) return reply.code(401).send({ error: 'service_auth_rejected' });
      if (verified.caller !== 'bunker') return reply.code(403).send({ error: 'service_caller_not_allowed' });
      let json: unknown;
      try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { return reply.code(400).send({ error: 'invalid_sso_request' }); }
      const parsed = redeemBody.safeParse(json);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_sso_request' });
      if (parsed.data.audience !== BUNKER_ADMIN_SSO_AUDIENCE || parsed.data.purpose !== BUNKER_ADMIN_SSO_PURPOSE) return reply.code(409).send({ error: 'sso_context_mismatch' });

      const codeHash = hash(parsed.data.code);
      const actor = `service:${verified.keyId}`.slice(0, 120);
      try {
        const outcome = await db.begin(async (tx) => {
          const [row] = await tx`SELECT id,person_id AS "personId",auth_subject_link_id AS "subjectId",binding_challenge AS "bindingChallenge",state,expires_at<=now() AS "isExpired"
            FROM platform_staff_sso_codes WHERE code_hash=${codeHash} FOR UPDATE`;
          if (!row) return { http: 404, error: 'sso_code_not_found' } as const;
          const reject = async (reason: string) => {
            await tx`INSERT INTO platform_identity_audit_events(person_id,actor_id,action,resource_id,details)
              SELECT ${row.personId}::uuid,${actor}::text,'staff.bunker_sso_rejected',${row.id}::uuid,(${JSON.stringify({ reason })}::text)::jsonb
              WHERE (SELECT count(*) FROM platform_identity_audit_events WHERE resource_id=${row.id}::uuid AND action='staff.bunker_sso_rejected')<${BUNKER_ADMIN_SSO_MAX_REJECTION_AUDITS_PER_CODE}`;
          };
          if (row.state === 'consumed') { await reject('already_used'); return { http: 409, error: 'sso_code_already_used' } as const; }
          if (row.state === 'revoked') { await reject('revoked'); return { http: 409, error: 'sso_code_revoked' } as const; }
          if (row.state === 'expired' || row.isExpired) {
            if (row.state === 'pending') await tx`UPDATE platform_staff_sso_codes SET state='expired',terminal_reason='ttl_elapsed',version=version+1 WHERE id=${row.id}`;
            await reject('expired');
            return { http: 410, error: 'sso_code_expired' } as const;
          }
          const expected = Buffer.from(String(row.bindingChallenge), 'utf8');
          const presented = Buffer.from(bindingChallengeFor(parsed.data.verifier), 'utf8');
          if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) {
            await reject('binding_mismatch');
            return { http: 403, error: 'sso_binding_mismatch' } as const;
          }
          await tx`SELECT id FROM platform_persons WHERE id=${row.personId}::uuid FOR SHARE`;
          const [subject] = await tx`SELECT s.auth_subject AS "authSubject" FROM platform_person_auth_subjects s JOIN platform_persons p ON p.id=s.person_id
            WHERE s.id=${row.subjectId} AND s.person_id=${row.personId}::uuid AND s.status='active' AND p.status='active' FOR SHARE OF s`;
          const [live] = await tx`SELECT 1 AS ok FROM platform_staff_sessions WHERE auth_subject_link_id=${row.subjectId} AND person_id=${row.personId}::uuid AND revoked_at IS NULL AND expires_at>now() LIMIT 1`;
          // The permission is re-read now, not trusted from issue time: a profile change, deactivation or sign-out inside the 60 s window wins.
          const current = subject && live ? await options.currentAuthorization(String(row.personId)) : null;
          if (!subject || !live || !current || !can(current, BUNKER_ADMIN_PERMISSION)) {
            await tx`UPDATE platform_staff_sso_codes SET state='revoked',terminal_reason='permission_changed',version=version+1 WHERE id=${row.id}`;
            await reject('permission_changed');
            return { http: 403, error: 'bunker_access_denied' } as const;
          }
          await tx`UPDATE platform_staff_sso_codes SET state='consumed',consumed_key_id=${verified.keyId},version=version+1 WHERE id=${row.id}`;
          await tx`INSERT INTO platform_identity_audit_events(person_id,actor_id,action,resource_id,details)
            VALUES (${row.personId}::uuid,${actor},'staff.bunker_sso_redeemed',${row.id},(${JSON.stringify({ role: current.role })}::text)::jsonb)`;
          return { http: 200, body: { v: 1 as const, personId: String(row.personId), authSubject: String(subject.authSubject), role: current.role, permission: BUNKER_ADMIN_PERMISSION } } as const;
        });
        if (outcome.http === 200) return reply.code(200).send(outcome.body);
        return reply.code(outcome.http).send({ error: outcome.error });
      } catch (error) {
        request.log.error({ errorCode: typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : 'unknown' }, 'bunker staff sso redemption failed');
        return reply.code(503).send({ error: 'bunker_sso_unavailable' });
      }
    });
  });
}
