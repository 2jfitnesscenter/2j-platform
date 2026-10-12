import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { createDatabase } from './db.js';
import type { ClientAuthorizationContext } from './communications.js';

type DB = ReturnType<typeof createDatabase>['client'];
const COOKIE = '2j_member_pilot';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const loginBody = z.object({ code: z.string().trim().min(1).max(128) }).strict();

function cookieValue(request: FastifyRequest) {
  const header = request.headers.cookie ?? '';
  const part = header.split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`));
  if (!part) return null;
  try { return decodeURIComponent(part.slice(COOKIE.length + 1)); } catch { return null; }
}

function matchesMemberOrigin(request: FastifyRequest, expectedOrigin: string) {
  const origin = request.headers.origin;
  if (origin) return origin === expectedOrigin;
  const referer = request.headers.referer;
  if (!referer) return false;
  try { return new URL(referer).origin === expectedOrigin; } catch { return false; }
}

export function createMemberPilotAuth(database: DB, options: { enabled: boolean; memberOrigin: string | null }) {
  const origin = options.memberOrigin;
  const enabled = options.enabled && origin !== null;

  async function resolve(request: FastifyRequest): Promise<ClientAuthorizationContext | null> {
    if (!enabled) return null;
    const raw = cookieValue(request);
    if (!raw || !/^[A-Za-z0-9_-]{40,64}$/.test(raw)) return null;
    const digest = hash(raw);
    const rows = await database.begin(async tx => {
      const matches = await tx`SELECT s.person_id AS "personId",s.auth_subject_link_id AS "subjectId",f.client_id AS "clientId"
        FROM platform_member_sessions s
        JOIN platform_person_auth_subjects a ON a.id=s.auth_subject_link_id AND a.person_id=s.person_id AND a.status='active' AND a.provider='platform-pilot'
        JOIN platform_persons p ON p.id=s.person_id AND p.status='active'
        JOIN platform_person_clients f ON f.person_id=p.id
        JOIN clients c ON c.id=f.client_id AND c.status='active'
        JOIN platform_member_pilot_credentials credential ON credential.auth_subject_link_id=a.id AND credential.status='active'
        WHERE s.session_hash=${digest} AND s.revoked_at IS NULL AND s.expires_at>now() LIMIT 1`;
      if (matches[0]) await tx`UPDATE platform_member_sessions SET last_seen_at=now() WHERE session_hash=${digest} AND revoked_at IS NULL`;
      return matches;
    });
    return rows[0] ? { clientId: rows[0].clientId, personId: rows[0].personId } : null;
  }

  function setCookie(reply: any, value: string, request: FastifyRequest, maxAge: number) {
    const secure = request.protocol === 'https' ? '; Secure' : '';
    reply.header('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
  }

  function csrfAllowed(request: FastifyRequest) {
    return enabled && origin !== null && matchesMemberOrigin(request, origin);
  }

  function register(app: FastifyInstance) {
    app.post('/api/pilot/member/login', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!enabled) return reply.code(404).send({ error: 'pilot_login_disabled' });
      if (!csrfAllowed(request)) return reply.code(403).send({ error: 'origin_rejected' });
      const body = loginBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_pilot_credential' });
      const codeHash = hash(body.data.code);
      const candidates = await database`SELECT credential.auth_subject_link_id AS "subjectId",subject.person_id AS "personId",facet.client_id AS "clientId"
        FROM platform_member_pilot_credentials credential
        JOIN platform_person_auth_subjects subject ON subject.id=credential.auth_subject_link_id AND subject.status='active' AND subject.provider='platform-pilot'
        JOIN platform_persons person ON person.id=subject.person_id AND person.status='active'
        JOIN platform_person_clients facet ON facet.person_id=person.id
        JOIN clients client ON client.id=facet.client_id AND client.status='active'
        WHERE credential.code_hash=${codeHash} AND credential.status='active' LIMIT 1`;
      const candidate = candidates[0];
      if (!candidate) return reply.code(401).send({ error: 'pilot_login_rejected' });
      const raw = randomBytes(32).toString('base64url');
      const sessionHash = hash(raw);
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      try {
        await database.begin(async tx => {
          const old = cookieValue(request);
          if (old && /^[A-Za-z0-9_-]{40,64}$/.test(old)) {
            const revoked = await tx`UPDATE platform_member_sessions SET revoked_at=now() WHERE session_hash=${hash(old)} AND revoked_at IS NULL RETURNING person_id,auth_subject_link_id`;
            for (const row of revoked) await tx`INSERT INTO platform_member_session_audit_events(person_id,auth_subject_link_id,action) VALUES (${row.person_id},${row.auth_subject_link_id},'session.revoked')`;
          }
          await tx`INSERT INTO platform_member_sessions(session_hash,person_id,auth_subject_link_id,expires_at) VALUES (${sessionHash},${candidate.personId},${candidate.subjectId},now()+interval '8 hours')`;
          await tx`INSERT INTO platform_member_session_audit_events(person_id,auth_subject_link_id,action) VALUES (${candidate.personId},${candidate.subjectId},'session.created')`;
        });
      } catch (error) {
        request.log.error({ errorCode: typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown' }, 'pilot member session creation failed');
        return reply.code(500).send({ error: 'pilot_login_unavailable' });
      }
      setCookie(reply, raw, request, SESSION_TTL_MS / 1000);
      return reply.code(200).send({ expiresAt: expiresAt.toISOString() });
    });

    app.post('/api/pilot/member/logout', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (!enabled) return reply.code(404).send({ error: 'pilot_login_disabled' });
      if (!csrfAllowed(request)) return reply.code(403).send({ error: 'origin_rejected' });
      const raw = cookieValue(request);
      if (raw && /^[A-Za-z0-9_-]{40,64}$/.test(raw)) {
        await database.begin(async tx => {
          const rows = await tx`UPDATE platform_member_sessions SET revoked_at=now() WHERE session_hash=${hash(raw)} AND revoked_at IS NULL RETURNING person_id,auth_subject_link_id`;
          for (const row of rows) await tx`INSERT INTO platform_member_session_audit_events(person_id,auth_subject_link_id,action) VALUES (${row.person_id},${row.auth_subject_link_id},'session.revoked')`;
        });
      }
      setCookie(reply, '', request, 0);
      return reply.code(204).send();
    });
  }

  return { enabled, resolve, register, csrfAllowed, cookieName: COOKIE };
}
