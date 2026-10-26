import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import { z } from 'zod';
import { can, type AuthorizationContext, type ApprovedRole } from '@2j/permissions';
import { rpIdMatchesOrigin } from './platform-passkeys.js';
import type { createDatabase } from './db.js';

type DB = ReturnType<typeof createDatabase>['client'];
const PROVIDER = 'platform-passkey';
const COOKIE = '2j_staff_session';
const SESSION_MS = 8 * 60 * 60 * 1000;
const CEREMONY_MS = 5 * 60 * 1000;
const ENROLLMENT_MS = 15 * 60 * 1000;
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const credentialResponse = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{16,1024}$/), rawId: z.string().max(2048), type: z.literal('public-key'), response: z.record(z.string(), z.unknown()), clientExtensionResults: z.record(z.string(), z.unknown()).optional(), authenticatorAttachment: z.string().max(32).optional() }).passthrough();
const approvedRole = (value: unknown): ApprovedRole | null => value === 'admin' || value === 'trainer' || value === 'reception-management' || value === 'accountant' ? value : null;

export type StaffAuthOptions = {
  enabled: boolean;
  rpId: string | null;
  origins: string[];
  ownerPersonId: string | null;
  baseAuthorization: (request: FastifyRequest) => Promise<AuthorizationContext | null>;
  now?: () => number;
  maxRequestsPerMinute?: number;
};

function readCookie(request: FastifyRequest) {
  const part = (request.headers.cookie ?? '').split(';').map(value => value.trim()).find(value => value.startsWith(COOKIE + '='));
  if (!part) return null;
  try { return decodeURIComponent(part.slice(COOKIE.length + 1)); } catch { return null; }
}

export function createStaffAuth(database: DB, options: StaffAuthOptions) {
  const rpId = options.rpId, origins = [...new Set(options.origins)], now = options.now ?? Date.now;
  const validPair = Boolean(rpId && origins.length && origins.every(origin => rpIdMatchesOrigin(rpId, origin)));
  if (options.enabled && !validPair) throw new Error('Staff passkeys need a relying-party id that exactly matches every configured staff application origin.');
  const enabled = options.enabled && validPair;
  const attempts = new Map<string, number[]>();
  const originAllowed = (request: FastifyRequest) => typeof request.headers.origin === 'string' && origins.includes(request.headers.origin) && request.headers['sec-fetch-site'] !== 'cross-site';
  const limited = (request: FastifyRequest) => {
    const t = now(), recent = (attempts.get(request.ip) ?? []).filter(at => t - at < 60_000);
    recent.push(t); attempts.set(request.ip, recent);
    if (attempts.size > 5000) for (const [key, values] of attempts) if (values.every(at => t - at >= 60_000)) attempts.delete(key);
    return recent.length > (options.maxRequestsPerMinute ?? 20);
  };
  const audit = (tx: any, person: string, subject: string, action: string, resource: string | null = null) =>
    tx.unsafe('INSERT INTO platform_staff_session_audit_events(person_id,auth_subject_link_id,action,resource_id) VALUES ($1::uuid,$2::uuid,$3,$4::uuid)', [person, subject, action, resource]);
  const setCookie = (reply: any, request: FastifyRequest, value: string, age: number) => {
    const secure = request.protocol === 'https' ? '; Secure' : '';
    reply.header('Set-Cookie', COOKIE + '=' + value + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + age + secure);
  };

  async function resolve(request: FastifyRequest): Promise<AuthorizationContext | null> {
    if (!enabled) return null;
    const raw = readCookie(request);
    if (!raw || !/^[A-Za-z0-9_-]{40,64}$/.test(raw)) return null;
    const digest = hash(raw);
    const rows = await database.unsafe(
      'SELECT p.id AS "personId", a.id AS "subjectId", a.auth_subject AS "actorId", sp.base_role AS "baseRole", (p.id=$2::uuid) AS "isOwner", (p.status=$4 AND a.status=$4 AND a.provider=$3 AND EXISTS(SELECT 1 FROM platform_passkeys k WHERE k.auth_subject_link_id=a.id AND k.status=$4 AND k.rp_id=$5) AND (p.id=$2::uuid OR (sp.id IS NOT NULL AND sp.status=$4 AND sp.auth_actor_id=a.auth_subject))) AS valid FROM platform_staff_sessions sess JOIN platform_person_auth_subjects a ON a.id=sess.auth_subject_link_id AND a.person_id=sess.person_id JOIN platform_persons p ON p.id=sess.person_id LEFT JOIN platform_person_staff ps ON ps.person_id=p.id LEFT JOIN staff_professionals sp ON sp.id=ps.professional_id WHERE sess.session_hash=$1 AND sess.revoked_at IS NULL AND sess.expires_at>now() LIMIT 1',
      [digest, options.ownerPersonId, PROVIDER, 'active', rpId],
    );
    const session = rows[0];
    if (!session || session.valid !== true) return null;
    const assignedRole: ApprovedRole | null = session.isOwner === true ? 'owner' : approvedRole(session.baseRole);
    if (!assignedRole) return null;
    await database.unsafe('UPDATE platform_staff_sessions SET last_seen_at=now() WHERE session_hash=$1 AND revoked_at IS NULL', [digest]);
    return { actorId: String(session.actorId), role: assignedRole, ...(session.isOwner === true ? { explicitPermissions: ['owner.panel.read'] } : {}) };
  }

  async function revoke(request: FastifyRequest) {
    const raw = readCookie(request);
    if (!raw || !/^[A-Za-z0-9_-]{40,64}$/.test(raw)) return;
    await database.begin(async (tx: any) => {
      const rows = await tx.unsafe('UPDATE platform_staff_sessions SET revoked_at=now() WHERE session_hash=$1 AND revoked_at IS NULL RETURNING person_id,auth_subject_link_id', [hash(raw)]);
      for (const row of rows) await audit(tx, String(row.person_id), String(row.auth_subject_link_id), 'session.revoked');
    });
  }

  function register(app: FastifyInstance, db: DB) {
    const guard = (request: FastifyRequest, reply: any) => {
      reply.header('Cache-Control', 'no-store');
      if (!enabled) { reply.code(423).send({ error: 'staff_auth_disabled' }); return false; }
      if (!originAllowed(request)) { reply.code(403).send({ error: 'origin_rejected' }); return false; }
      if (limited(request)) { reply.code(429).send({ error: 'rate_limited' }); return false; }
      return true;
    };
    const admin = async (request: FastifyRequest, reply: any) => {
      reply.header('Cache-Control', 'no-store');
      if (!enabled) { reply.code(423).send({ error: 'staff_auth_disabled' }); return null; }
      const actor = await options.baseAuthorization(request);
      if (!actor) { reply.code(401).send({ error: 'authentication_required' }); return null; }
      if (!can(actor, 'identity.people.manage')) { reply.code(403).send({ error: 'permission_denied' }); return null; }
      return actor;
    };

    // Enrollment is issued only by an already trusted identity.people.manage actor; no email/phone lookup or self-registration.
    app.post('/api/platform/v1/persons/:personId/staff-passkey-enrollments', async (request, reply) => {
      const actor = await admin(request, reply); if (!actor) return;
      const params = z.object({ personId: uuid }).safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'validation_error' });
      const token = randomBytes(32).toString('base64url');
      const expires = new Date(now() + ENROLLMENT_MS);
      try {
        const result = await db.begin(async (tx: any) => {
          const persons = await tx.unsafe('SELECT p.status, EXISTS(SELECT 1 FROM platform_person_staff ps JOIN staff_professionals sp ON sp.id=ps.professional_id AND sp.status=$2 WHERE ps.person_id=p.id) AS "activeStaff" FROM platform_persons p WHERE p.id=$1::uuid FOR UPDATE', [params.data.personId, 'active']);
          const person = persons[0];
          if (!person || person.status !== 'active' || person.activeStaff !== true && params.data.personId !== options.ownerPersonId) return false;
          let subjects = await tx.unsafe('SELECT id,auth_subject AS "authSubject" FROM platform_person_auth_subjects WHERE person_id=$1::uuid AND provider=$2 AND status=$3 FOR UPDATE', [params.data.personId, PROVIDER, 'active']);
          let subject = subjects[0];
          if (!subject) {
            subjects = await tx.unsafe('INSERT INTO platform_person_auth_subjects(person_id,auth_subject,provider,created_by) VALUES ($1::uuid,$2,$3,$4) RETURNING id,auth_subject AS "authSubject"', [params.data.personId, 'staff-pk-' + randomBytes(18).toString('base64url'), PROVIDER, actor.actorId.slice(0, 120)]);
            subject = subjects[0];
          }
          const linked = await tx.unsafe('SELECT sp.id,sp.auth_actor_id AS "authActorId" FROM platform_person_staff ps JOIN staff_professionals sp ON sp.id=ps.professional_id WHERE ps.person_id=$1::uuid FOR UPDATE OF sp', [params.data.personId]);
          if (linked.some((row: any) => row.authActorId && row.authActorId !== subject.authSubject)) throw new Error('staff_identity_already_linked');
          for (const row of linked) await tx.unsafe('UPDATE staff_professionals SET auth_actor_id=$1,updated_at=now() WHERE id=$2 AND (auth_actor_id IS NULL OR auth_actor_id=$1)', [subject.authSubject, row.id]);
          await tx.unsafe('UPDATE platform_staff_passkey_enrollments SET consumed_at=now() WHERE person_id=$1::uuid AND consumed_at IS NULL', [params.data.personId]);
          const enrollments = await tx.unsafe('INSERT INTO platform_staff_passkey_enrollments(token_hash,person_id,auth_subject_link_id,created_by,expires_at) VALUES ($1,$2::uuid,$3::uuid,$4,$5) RETURNING id', [hash(token), params.data.personId, subject.id, actor.actorId.slice(0, 120), expires.toISOString()]);
          await audit(tx, params.data.personId, String(subject.id), 'passkey.enrollment_issued', String(enrollments[0].id));
          return true;
        });
        if (!result) return reply.code(404).send({ error: 'staff_identity_not_found' });
      } catch (error) {
        if ((error as Error).message === 'staff_identity_already_linked') return reply.code(409).send({ error: 'staff_identity_already_linked' });
        throw error;
      }
      return reply.code(201).send({ v: 1, enrollmentToken: token, expiresAt: expires.toISOString() });
    });

    app.post('/api/staff/auth/passkeys/register/options', async (request, reply) => {
      if (!guard(request, reply)) return;
      const body = z.object({ enrollmentToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict().safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'validation_error' });
      const rows = await db.unsafe('SELECT e.id,e.person_id AS "personId",e.auth_subject_link_id AS "subjectId",a.auth_subject AS "authSubject" FROM platform_staff_passkey_enrollments e JOIN platform_person_auth_subjects a ON a.id=e.auth_subject_link_id AND a.person_id=e.person_id AND a.status=$3 AND a.provider=$2 JOIN platform_persons p ON p.id=e.person_id AND p.status=$3 WHERE e.token_hash=$1 AND e.consumed_at IS NULL AND e.expires_at>now() AND (e.person_id=$4::uuid OR EXISTS (SELECT 1 FROM platform_person_staff ps JOIN staff_professionals sp ON sp.id=ps.professional_id AND sp.status=$3 AND sp.auth_actor_id=a.auth_subject WHERE ps.person_id=e.person_id))', [hash(body.data.enrollmentToken), PROVIDER, 'active', options.ownerPersonId]);
      const enrollment = rows[0];
      if (!enrollment) return reply.code(401).send({ error: 'enrollment_invalid' });
      const existing = await db.unsafe('SELECT credential_id AS id FROM platform_passkeys WHERE auth_subject_link_id=$1::uuid AND status=$2 AND rp_id=$3', [enrollment.subjectId, 'active', rpId]);
      const opts = await generateRegistrationOptions({ rpName: '2J Fitness Center', rpID: rpId!, userName: String(enrollment.authSubject), userID: Buffer.from(String(enrollment.subjectId).replaceAll('-', ''), 'hex'), attestationType: 'none', excludeCredentials: existing.map((row: any) => ({ id: String(row.id) })), authenticatorSelection: { residentKey: 'required', userVerification: 'required' }, timeout: CEREMONY_MS });
      const challenges = await db.unsafe('INSERT INTO platform_staff_passkey_challenges(purpose,challenge,enrollment_id,expires_at) VALUES ($1,$2,$3::uuid,$4) RETURNING id', ['registration', opts.challenge, enrollment.id, new Date(now() + CEREMONY_MS).toISOString()]);
      return reply.send({ v: 1, challengeId: challenges[0]!.id, options: opts });
    });

    app.post('/api/staff/auth/passkeys/register/verify', async (request, reply) => {
      if (!guard(request, reply)) return;
      const body = z.object({ enrollmentToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/), challengeId: uuid, response: credentialResponse, label: z.string().trim().min(1).max(60).regex(/^[^\u0000-\u001f<>]+$/).optional() }).strict().safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'validation_error' });
      const enrollments = await db.unsafe('SELECT id,person_id AS "personId",auth_subject_link_id AS "subjectId" FROM platform_staff_passkey_enrollments WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now()', [hash(body.data.enrollmentToken)]);
      const enrollment = enrollments[0];
      if (!enrollment) return reply.code(401).send({ error: 'enrollment_invalid' });
      const challenges = await db.unsafe('UPDATE platform_staff_passkey_challenges SET consumed_at=now() WHERE id=$1::uuid AND purpose=$2 AND enrollment_id=$3::uuid AND consumed_at IS NULL AND expires_at>now() RETURNING challenge', [body.data.challengeId, 'registration', enrollment.id]);
      if (!challenges[0]) return reply.code(401).send({ error: 'challenge_invalid' });
      let verification;
      try { verification = await verifyRegistrationResponse({ response: body.data.response as never, expectedChallenge: String(challenges[0].challenge), expectedOrigin: request.headers.origin!, expectedRPID: rpId!, requireUserVerification: true }); }
      catch { return reply.code(400).send({ error: 'registration_rejected' }); }
      if (!verification.verified || !verification.registrationInfo) return reply.code(400).send({ error: 'registration_rejected' });
      const credential = verification.registrationInfo.credential;
      try {
        await db.begin(async (tx: any) => {
          const spent = await tx.unsafe('UPDATE platform_staff_passkey_enrollments SET consumed_at=now() WHERE id=$1::uuid AND consumed_at IS NULL AND expires_at>now() RETURNING id', [enrollment.id]);
          if (!spent[0]) throw new Error('enrollment_invalid');
          const keys = await tx.unsafe('INSERT INTO platform_passkeys(person_id,auth_subject_link_id,credential_id,public_key,sign_count,transports,rp_id,label) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8) RETURNING id', [enrollment.personId, enrollment.subjectId, credential.id, Buffer.from(credential.publicKey), credential.counter, credential.transports ?? [], rpId, body.data.label ?? 'passkey']);
          await audit(tx, String(enrollment.personId), String(enrollment.subjectId), 'passkey.registered', String(keys[0].id));
        });
      } catch (error) { return reply.code((error as {code?:string}).code === '23505' ? 409 : 401).send({ error: (error as {code?:string}).code === '23505' ? 'credential_already_registered' : 'enrollment_invalid' }); }
      return reply.code(201).send({ v: 1, status: 'registered' });
    });

    app.post('/api/staff/auth/passkeys/login/options', async (request, reply) => {
      if (!guard(request, reply)) return;
      if (request.body !== undefined && request.body !== null && Object.keys(request.body as object).length) return reply.code(400).send({ error: 'validation_error' });
      const opts = await generateAuthenticationOptions({ rpID: rpId!, userVerification: 'required', timeout: CEREMONY_MS });
      const challenges = await db.unsafe('INSERT INTO platform_staff_passkey_challenges(purpose,challenge,expires_at) VALUES ($1,$2,$3) RETURNING id', ['authentication', opts.challenge, new Date(now() + CEREMONY_MS).toISOString()]);
      return reply.send({ v: 1, challengeId: challenges[0]!.id, options: opts });
    });

    app.post('/api/staff/auth/passkeys/login/verify', async (request, reply) => {
      if (!guard(request, reply)) return;
      const body = z.object({ challengeId: uuid, response: credentialResponse }).strict().safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'validation_error' });
      const challenges = await db.unsafe('UPDATE platform_staff_passkey_challenges SET consumed_at=now() WHERE id=$1::uuid AND purpose=$2 AND consumed_at IS NULL AND expires_at>now() RETURNING challenge', [body.data.challengeId, 'authentication']);
      if (!challenges[0]) return reply.code(401).send({ error: 'challenge_invalid' });
      const rows = await db.unsafe('SELECT k.id,k.person_id AS "personId",k.auth_subject_link_id AS "subjectId",k.public_key AS "publicKey",k.sign_count AS "signCount",k.transports,k.rp_id AS "rpId",a.auth_subject AS "authSubject" FROM platform_passkeys k JOIN platform_person_auth_subjects a ON a.id=k.auth_subject_link_id AND a.person_id=k.person_id AND a.status=$2 AND a.provider=$3 JOIN platform_persons p ON p.id=k.person_id AND p.status=$2 WHERE k.credential_id=$1 AND k.rp_id=$4 AND k.status=$2 AND (p.id=$5::uuid OR EXISTS (SELECT 1 FROM platform_person_staff ps JOIN staff_professionals sp ON sp.id=ps.professional_id AND sp.status=$2 AND sp.auth_actor_id=a.auth_subject WHERE ps.person_id=p.id))', [body.data.response.id, 'active', PROVIDER, rpId, options.ownerPersonId]);
      const stored = rows[0];
      if (!stored) return reply.code(401).send({ error: 'login_rejected' });
      let verification;
      try { verification = await verifyAuthenticationResponse({ response: body.data.response as never, expectedChallenge: String(challenges[0].challenge), expectedOrigin: request.headers.origin!, expectedRPID: rpId!, requireUserVerification: true, credential: { id: body.data.response.id, publicKey: new Uint8Array(stored.publicKey as Buffer), counter: Number(stored.signCount), transports: stored.transports as never } }); }
      catch { return reply.code(401).send({ error: 'login_rejected' }); }
      const nextCounter = verification.authenticationInfo.newCounter;
      if (!verification.verified || (Number(stored.signCount) > 0 || nextCounter > 0) && nextCounter <= Number(stored.signCount)) return reply.code(401).send({ error: 'login_rejected' });
      const token = randomBytes(32).toString('base64url'), expiresAt = new Date(now() + SESSION_MS);
      try {
        await db.begin(async (tx: any) => {
          const freshRows = await tx.unsafe('SELECT k.sign_count AS "signCount",a.status AS "subjectStatus",p.status AS "personStatus",a.auth_subject AS "authSubject",sp.status AS "staffStatus",sp.auth_actor_id AS "authActorId" FROM platform_passkeys k JOIN platform_person_auth_subjects a ON a.id=k.auth_subject_link_id AND a.person_id=k.person_id JOIN platform_persons p ON p.id=k.person_id LEFT JOIN platform_person_staff ps ON ps.person_id=p.id LEFT JOIN staff_professionals sp ON sp.id=ps.professional_id WHERE k.id=$1::uuid AND k.status=$2 FOR UPDATE OF k,a,p', [stored.id, 'active']);
          const current = freshRows[0];
          const valid = current?.subjectStatus === 'active' && current.personStatus === 'active' && current.authSubject === stored.authSubject &&
            (String(stored.personId) === options.ownerPersonId || current.staffStatus === 'active' && current.authActorId === stored.authSubject) &&
            Number(current.signCount) === Number(stored.signCount);
          if (!valid) throw new Error('login_rejected');
          await tx.unsafe('UPDATE platform_passkeys SET sign_count=$1,last_used_at=now() WHERE id=$2::uuid AND status=$3', [nextCounter, stored.id, 'active']);
          await tx.unsafe('INSERT INTO platform_staff_sessions(session_hash,person_id,auth_subject_link_id,expires_at) VALUES ($1,$2::uuid,$3::uuid,$4)', [hash(token), stored.personId, stored.subjectId, expiresAt.toISOString()]);
          await audit(tx, String(stored.personId), String(stored.subjectId), 'session.created');
        });
      } catch { return reply.code(401).send({ error: 'login_rejected' }); }
      setCookie(reply, request, token, SESSION_MS / 1000);
      return reply.send({ v: 1, expiresAt: expiresAt.toISOString() });
    });

    app.get('/api/staff/auth/session', async (request, reply) => {
      reply.header('Cache-Control','no-store');
      const context = await resolve(request);
      if (!context) return reply.code(401).send({ error:'authentication_required' });
      return reply.send({ actorId: context.actorId, role: context.role, owner: context.explicitPermissions?.includes('owner.panel.read') === true });
    });
    app.post('/api/staff/auth/logout', async (request, reply) => {
      reply.header('Cache-Control','no-store');
      if (!enabled) return reply.code(404).send({ error:'staff_auth_disabled' });
      if (!originAllowed(request)) return reply.code(403).send({ error:'origin_rejected' });
      await revoke(request); setCookie(reply, request, '', 0); return reply.code(204).send();
    });
  }

  return { enabled, resolve, csrfAllowed: (request: FastifyRequest) => enabled && originAllowed(request), register };
}
