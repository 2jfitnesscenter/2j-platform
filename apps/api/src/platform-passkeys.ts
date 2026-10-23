import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import { can, type AuthorizationContext } from '@2j/permissions';
import type { createDatabase } from './db.js';

type DB = ReturnType<typeof createDatabase>['client'];
const PROVIDER = 'platform-passkey';
const ENROLLMENT_TTL_MS = 15 * 60 * 1000;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
// The structure of the WebAuthn response is validated by the library; here we only bound what we are willing to parse.
const webauthnResponse = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{16,1024}$/), rawId: z.string().max(2048), type: z.literal('public-key'), response: z.record(z.unknown()), clientExtensionResults: z.record(z.unknown()).optional(), authenticatorAttachment: z.string().max(32).optional() }).passthrough();

export type PlatformPasskeyOptions = {
  enabled: boolean;
  /** Relying-party id: the exact host (for example `home.2jfitnesscenter.com`). It is immutable once credentials exist. */
  rpId: string | null;
  rpName?: string;
  /** The only origin allowed to run ceremonies (the Home member app). */
  origin: string | null;
  startSession: (request: FastifyRequest, reply: any, subject: { personId: string; subjectId: string }) => Promise<Date>;
  resolveAuthorization: (request: FastifyRequest) => Promise<AuthorizationContext | null>;
  now?: () => number;
  /** Per-client ceremony requests per minute (default 30). */
  maxRequestsPerMinute?: number;
};

/**
 * True only when `rpId` IS the exact host of `origin`. A registrable parent (for example `2jfitnesscenter.com` for
 * `home.2jfitnesscenter.com`) is deliberately refused: it would make every credential valid for every sibling subdomain, and an RP ID can never
 * be narrowed again once credentials exist. Widening it is a code change that needs a security review, not a configuration value.
 */
export function rpIdMatchesOrigin(rpId: string, origin: string) {
  try {
    const url = new URL(origin);
    if (!/^[a-z0-9.-]+$/.test(rpId) || rpId.startsWith('.') || rpId.endsWith('.') || !(rpId.includes('.') || rpId === 'localhost')) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(rpId) || url.hostname.startsWith('[')) return false;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))) return false;
    return url.hostname === rpId;
  } catch { return false; }
}

export function registerPlatformPasskeyRoutes(app: FastifyInstance<any, any, any, any, any>, db: DB, options: PlatformPasskeyOptions) {
  const rpId = options.rpId, origin = options.origin;
  const configured = options.enabled && rpId !== null && origin !== null && rpIdMatchesOrigin(rpId, origin);
  if (options.enabled && !configured) throw new Error('Platform passkeys need a valid relying-party id that matches the member origin.');
  const now = options.now ?? Date.now;
  const attempts = new Map<string, number[]>();
  const limited = (request: FastifyRequest) => {
    const key = request.ip, t = now();
    const recent = (attempts.get(key) ?? []).filter(time => t - time < 60_000);
    recent.push(t); attempts.set(key, recent);
    if (attempts.size > 5_000) for (const [k, v] of attempts) if (v.every(time => t - time >= 60_000)) attempts.delete(k);
    return recent.length > (options.maxRequestsPerMinute ?? 30);
  };
  const originOk = (request: FastifyRequest) => origin !== null && request.headers.origin === origin && request.headers['sec-fetch-site'] !== 'cross-site';
  const audit = (tx: DB, personId: string, actor: string, action: string, resourceId: string, details: Record<string, unknown> = {}) =>
    tx`INSERT INTO platform_identity_audit_events(person_id,actor_id,action,resource_id,details) VALUES (${personId}::uuid,${actor.slice(0, 120)},${action},${resourceId}::uuid,(${JSON.stringify(details)}::text)::jsonb)`;
  const guard = (request: FastifyRequest, reply: any) => {
    reply.header('Cache-Control', 'no-store');
    if (!configured) { reply.code(423).send({ error: 'platform_passkeys_disabled' }); return false; }
    if (!originOk(request)) { reply.code(403).send({ error: 'origin_rejected' }); return false; }
    return true;
  };
  const adminGuard = async (request: FastifyRequest, reply: any) => {
    reply.header('Cache-Control', 'no-store');
    if (!configured) { reply.code(423).send({ error: 'platform_passkeys_disabled' }); return null; }
    const actor = await options.resolveAuthorization(request);
    if (!actor) { reply.code(401).send({ error: 'authentication_required' }); return null; }
    if (!can(actor, 'identity.people.manage')) { reply.code(403).send({ error: 'permission_denied' }); return null; }
    return actor;
  };

  // Administrator: let a verified person enroll their first passkey. The token is shown once and stored only as a hash.
  app.post('/api/platform/v1/persons/:personId/passkey-enrollments', async (request, reply) => {
    const actor = await adminGuard(request, reply); if (!actor) return;
    const params = z.object({ personId: uuid }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'validation_error' });
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now() + ENROLLMENT_TTL_MS);
    const result = await db.begin(async tx => {
      const [person] = await tx`SELECT status FROM platform_persons WHERE id=${params.data.personId}::uuid FOR UPDATE`;
      if (!person || person.status !== 'active') return null;
      let [subject] = await tx`SELECT id FROM platform_person_auth_subjects WHERE person_id=${params.data.personId}::uuid AND provider=${PROVIDER} AND status='active'`;
      if (!subject) {
        [subject] = await tx`INSERT INTO platform_person_auth_subjects(person_id,auth_subject,provider,created_by) VALUES (${params.data.personId}::uuid,${`pk-${randomUUID()}`},${PROVIDER},${actor.actorId.slice(0, 120)}) RETURNING id`;
        await audit(tx as unknown as DB, params.data.personId, actor.actorId, 'person.auth_subject_linked', subject!.id as string, { provider: PROVIDER });
      }
      await tx`UPDATE platform_passkey_enrollments SET consumed_at=now() WHERE auth_subject_link_id=${subject!.id} AND consumed_at IS NULL`;
      const [enrollment] = await tx`INSERT INTO platform_passkey_enrollments(token_hash,person_id,auth_subject_link_id,created_by,expires_at) VALUES (${hash(token)},${params.data.personId}::uuid,${subject!.id},${actor.actorId.slice(0, 120)},${expiresAt.toISOString()}::timestamptz) RETURNING id`;
      await audit(tx as unknown as DB, params.data.personId, actor.actorId, 'passkey.enrollment_issued', enrollment!.id as string);
      return true;
    });
    if (!result) return reply.code(404).send({ error: 'person_not_found' });
    return reply.code(201).send({ v: 1, enrollmentToken: token, expiresAt: expiresAt.toISOString() });
  });

  async function liveEnrollment(token: string) {
    const [row] = await db`SELECT e.id,e.person_id AS "personId",e.auth_subject_link_id AS "subjectId",a.auth_subject AS "authSubject"
      FROM platform_passkey_enrollments e JOIN platform_person_auth_subjects a ON a.id=e.auth_subject_link_id AND a.person_id=e.person_id AND a.status='active' AND a.provider=${PROVIDER}
      JOIN platform_persons p ON p.id=e.person_id AND p.status='active'
      WHERE e.token_hash=${hash(token)} AND e.consumed_at IS NULL AND e.expires_at>now()`;
    return row ?? null;
  }

  app.post('/api/me/passkeys/register/options', async (request, reply) => {
    if (!guard(request, reply)) return;
    if (limited(request)) return reply.code(429).send({ error: 'rate_limited' });
    const body = z.object({ enrollmentToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict().safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'validation_error' });
    const enrollment = await liveEnrollment(body.data.enrollmentToken);
    if (!enrollment) return reply.code(401).send({ error: 'enrollment_invalid' });
    const existing = await db`SELECT credential_id AS id FROM platform_passkeys WHERE auth_subject_link_id=${enrollment.subjectId} AND status='active'`;
    const optionsJson = await generateRegistrationOptions({
      rpName: options.rpName ?? '2J Fitness Center', rpID: rpId!, userName: String(enrollment.authSubject), userID: Buffer.from(String(enrollment.subjectId).replaceAll('-', ''), 'hex'),
      attestationType: 'none', excludeCredentials: existing.map(row => ({ id: String(row.id) })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' }, timeout: CHALLENGE_TTL_MS,
    });
    const [challenge] = await db`INSERT INTO platform_passkey_challenges(purpose,challenge,enrollment_id,expires_at) VALUES ('registration',${optionsJson.challenge},${enrollment.id},${new Date(now() + CHALLENGE_TTL_MS).toISOString()}::timestamptz) RETURNING id`;
    return reply.send({ v: 1, challengeId: challenge!.id, options: optionsJson });
  });

  app.post('/api/me/passkeys/register/verify', async (request, reply) => {
    if (!guard(request, reply)) return;
    if (limited(request)) return reply.code(429).send({ error: 'rate_limited' });
    const body = z.object({ enrollmentToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/), challengeId: uuid, response: webauthnResponse, label: z.string().trim().min(1).max(60).regex(/^[^\u0000-\u001f<>]+$/).optional() }).strict().safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'validation_error' });
    const enrollment = await liveEnrollment(body.data.enrollmentToken);
    if (!enrollment) return reply.code(401).send({ error: 'enrollment_invalid' });
    // The challenge is spent by this attempt, whatever its outcome; a new ceremony needs new options.
    const [challenge] = await db`UPDATE platform_passkey_challenges SET consumed_at=now() WHERE id=${body.data.challengeId}::uuid AND purpose='registration' AND enrollment_id=${enrollment.id} AND consumed_at IS NULL AND expires_at>now() RETURNING challenge`;
    if (!challenge) return reply.code(401).send({ error: 'challenge_invalid' });
    let verification;
    try {
      verification = await verifyRegistrationResponse({ response: body.data.response as never, expectedChallenge: String(challenge.challenge), expectedOrigin: origin!, expectedRPID: rpId!, requireUserVerification: true });
    } catch { return reply.code(400).send({ error: 'registration_rejected' }); }
    if (!verification.verified || !verification.registrationInfo) return reply.code(400).send({ error: 'registration_rejected' });
    const credential = verification.registrationInfo.credential;
    try {
      await db.begin(async tx => {
        const [spent] = await tx`UPDATE platform_passkey_enrollments SET consumed_at=now() WHERE id=${enrollment.id} AND consumed_at IS NULL AND expires_at>now() RETURNING id`;
        if (!spent) throw Object.assign(new Error('enrollment already used'), { code: 'ENROLLMENT_USED' });
        const [passkey] = await tx`INSERT INTO platform_passkeys(person_id,auth_subject_link_id,credential_id,public_key,sign_count,transports,rp_id,label)
          VALUES (${enrollment.personId},${enrollment.subjectId},${credential.id},${Buffer.from(credential.publicKey)},${credential.counter},${(credential.transports ?? []) as string[]},${rpId!},${body.data.label ?? 'passkey'}) RETURNING id`;
        await audit(tx as unknown as DB, String(enrollment.personId), String(enrollment.authSubject), 'passkey.registered', passkey!.id as string);
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      return reply.code(code === 'ENROLLMENT_USED' ? 401 : code === '23505' ? 409 : 500).send({ error: code === 'ENROLLMENT_USED' ? 'enrollment_invalid' : code === '23505' ? 'credential_already_registered' : 'internal_error' });
    }
    return reply.code(201).send({ v: 1, status: 'registered' });
  });

  app.post('/api/me/passkeys/login/options', async (request, reply) => {
    if (!guard(request, reply)) return;
    if (limited(request)) return reply.code(429).send({ error: 'rate_limited' });
    if (request.body !== undefined && request.body !== null && Object.keys(request.body as object).length) return reply.code(400).send({ error: 'validation_error' });
    const optionsJson = await generateAuthenticationOptions({ rpID: rpId!, userVerification: 'required', timeout: CHALLENGE_TTL_MS });
    const [challenge] = await db`INSERT INTO platform_passkey_challenges(purpose,challenge,expires_at) VALUES ('authentication',${optionsJson.challenge},${new Date(now() + CHALLENGE_TTL_MS).toISOString()}::timestamptz) RETURNING id`;
    return reply.send({ v: 1, challengeId: challenge!.id, options: optionsJson });
  });

  app.post('/api/me/passkeys/login/verify', async (request, reply) => {
    if (!guard(request, reply)) return;
    if (limited(request)) return reply.code(429).send({ error: 'rate_limited' });
    const body = z.object({ challengeId: uuid, response: webauthnResponse }).strict().safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'validation_error' });
    const [challenge] = await db`UPDATE platform_passkey_challenges SET consumed_at=now() WHERE id=${body.data.challengeId}::uuid AND purpose='authentication' AND consumed_at IS NULL AND expires_at>now() RETURNING challenge`;
    if (!challenge) return reply.code(401).send({ error: 'challenge_invalid' });
    const [stored] = await db`SELECT k.id,k.person_id AS "personId",k.auth_subject_link_id AS "subjectId",k.public_key AS "publicKey",k.sign_count AS "signCount",k.transports,k.rp_id AS "rpId"
      FROM platform_passkeys k JOIN platform_person_auth_subjects a ON a.id=k.auth_subject_link_id AND a.person_id=k.person_id AND a.status='active' AND a.provider=${PROVIDER}
      JOIN platform_persons p ON p.id=k.person_id AND p.status='active'
      WHERE k.credential_id=${body.data.response.id} AND k.status='active'`;
    if (!stored || stored.rpId !== rpId) return reply.code(401).send({ error: 'login_rejected' });
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body.data.response as never, expectedChallenge: String(challenge.challenge), expectedOrigin: origin!, expectedRPID: rpId!, requireUserVerification: true,
        credential: { id: body.data.response.id, publicKey: new Uint8Array(stored.publicKey as Buffer), counter: Number(stored.signCount), transports: stored.transports as never },
      });
    } catch {
      await db.begin(tx => audit(tx as unknown as DB, String(stored.personId), 'anonymous', 'passkey.login_rejected', stored.id as string, { reason: 'verification_failed' }));
      return reply.code(401).send({ error: 'login_rejected' });
    }
    const newCounter = verification.authenticationInfo.newCounter;
    // A counter that does not advance (when the authenticator uses one) means the credential may have been cloned.
    if (!verification.verified || (Number(stored.signCount) > 0 || newCounter > 0) && newCounter <= Number(stored.signCount)) {
      await db.begin(tx => audit(tx as unknown as DB, String(stored.personId), 'anonymous', 'passkey.login_rejected', stored.id as string, { reason: verification.verified ? 'counter_regression' : 'not_verified' }));
      return reply.code(401).send({ error: 'login_rejected' });
    }
    try {
      await db.begin(async tx => {
        await tx`UPDATE platform_passkeys SET sign_count=${newCounter},last_used_at=now() WHERE id=${stored.id} AND status='active'`;
        await audit(tx as unknown as DB, String(stored.personId), `passkey:${String(stored.id)}`, 'passkey.login', stored.id as string);
      });
      const expiresAt = await options.startSession(request, reply, { personId: String(stored.personId), subjectId: String(stored.subjectId) });
      return reply.code(200).send({ v: 1, expiresAt: expiresAt.toISOString() });
    } catch { return reply.code(500).send({ error: 'login_unavailable' }); }
  });

  // Administrator: revoke every passkey of a person and end their sessions (lost device, offboarding).
  app.post('/api/platform/v1/persons/:personId/passkeys/revoke', async (request, reply) => {
    const actor = await adminGuard(request, reply); if (!actor) return;
    const params = z.object({ personId: uuid }).safeParse(request.params);
    const body = z.object({ reason: z.string().trim().min(3).max(80) }).strict().safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    const revoked = await db.begin(async tx => {
      const keys = await tx`UPDATE platform_passkeys SET status='revoked',revoked_at=now() WHERE person_id=${params.data.personId}::uuid AND status='active' RETURNING id,auth_subject_link_id`;
      const sessions = await tx`UPDATE platform_member_sessions s SET revoked_at=now() FROM platform_person_auth_subjects a WHERE a.id=s.auth_subject_link_id AND a.person_id=${params.data.personId}::uuid AND a.provider=${PROVIDER} AND s.revoked_at IS NULL RETURNING s.person_id,s.auth_subject_link_id`;
      for (const row of sessions) await tx`INSERT INTO platform_member_session_audit_events(person_id,auth_subject_link_id,action) VALUES (${row.person_id},${row.auth_subject_link_id},'session.revoked')`;
      await tx`UPDATE platform_passkey_enrollments SET consumed_at=now() WHERE person_id=${params.data.personId}::uuid AND consumed_at IS NULL`;
      for (const key of keys) await audit(tx as unknown as DB, params.data.personId, actor.actorId, 'passkey.revoked', key.id as string, { reason: body.data.reason });
      return keys.length;
    });
    return reply.send({ v: 1, revokedPasskeys: revoked });
  });
}
