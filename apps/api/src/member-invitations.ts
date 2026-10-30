import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can, type AuthorizationContext } from '@2j/permissions';
import type { createDatabase } from './db.js';

type DB = ReturnType<typeof createDatabase>['client'];
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const tokenHash = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

/** Platform onboarding invitation issuance. This route never creates identities or Training accounts. */
export function registerMemberInvitationRoutes(app: FastifyInstance<any, any, any, any, any>, db: DB, resolve: (request: FastifyRequest) => Promise<AuthorizationContext | null>) {
  const authorize = async (request: FastifyRequest, reply: any) => {
    reply.header('Cache-Control', 'no-store');
    const actor = await resolve(request);
    if (!actor) { reply.code(401).send({ error: 'authentication_required' }); return null; }
    if (!can(actor, 'member.invitations.manage')) { reply.code(403).send({ error: 'permission_denied' }); return null; }
    return actor;
  };

  app.get('/api/platform/v1/member-invitations', async (request, reply) => {
    const actor = await authorize(request, reply); if (!actor) return;
    const parsed = z.object({ status: z.enum(['pending', 'revoked', 'expired', 'all']).default('pending'), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict().safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' });
    const rows = await db`
      SELECT id,created_by AS "createdBy",created_at AS "createdAt",expires_at AS "expiresAt",
        CASE WHEN status='revoked' THEN 'revoked' WHEN expires_at<=now() THEN 'expired' ELSE 'pending' END AS status
      FROM platform_member_invitations
      WHERE (${parsed.data.status}='all' OR (${parsed.data.status}='expired' AND status='pending' AND expires_at<=now()) OR (${parsed.data.status}='pending' AND status='pending' AND expires_at>now()) OR status=${parsed.data.status})
      ORDER BY created_at DESC,id DESC LIMIT ${parsed.data.limit}`;
    return { v: 1, invitations: rows };
  });

  app.post('/api/platform/v1/member-invitations', async (request, reply) => {
    const actor = await authorize(request, reply); if (!actor) return;
    const body = z.object({}).strict().safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'validation_error' });
    const secret = randomBytes(32).toString('base64url');
    const saved = await db.begin(async tx => {
      const [row] = await tx`
        INSERT INTO platform_member_invitations(token_hash,created_by,expires_at)
        VALUES (${tokenHash(secret)},${actor.actorId.slice(0,120)},now()+interval '24 hours')
        RETURNING id,created_at AS "createdAt",expires_at AS "expiresAt"`;
      await tx`INSERT INTO platform_member_invitation_events(invitation_id,actor_id,action) VALUES (${row!.id}::uuid,${actor.actorId.slice(0,120)},'created')`;
      return row!;
    });
    // Deliberately returned only here. The raw bearer secret is never stored or logged and is absent from every read route.
    return reply.code(201).send({ v: 1, invitation: { ...saved, status: 'pending' }, secret });
  });

  app.post('/api/platform/v1/member-invitations/:invitationId/revoke', async (request, reply) => {
    const actor = await authorize(request, reply); if (!actor) return;
    const params = z.object({ invitationId: uuid }).strict().safeParse(request.params);
    const body = z.object({ reason: z.string().trim().min(10).max(300) }).strict().safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    const outcome = await db.begin(async tx => {
      const [current] = await tx`SELECT id,status,expires_at AS "expiresAt",expires_at<=now() AS expired FROM platform_member_invitations WHERE id=${params.data.invitationId}::uuid FOR UPDATE`;
      if (!current) return { status: 404, body: { error: 'invitation_not_found' } };
      if (current.status !== 'pending') return { status: 409, body: { error: 'invitation_already_revoked' } };
      if (current.expired) return { status: 409, body: { error: 'invitation_expired' } };
      const [updated] = await tx`UPDATE platform_member_invitations SET status='revoked',revoked_by=${actor.actorId.slice(0,120)},revoked_at=now(),revoke_reason=${body.data.reason} WHERE id=${current.id} AND status='pending' AND expires_at>now() RETURNING id,status,revoked_at AS "revokedAt"`;
      if (!updated) return { status: 409, body: { error: 'invitation_already_revoked' } };
      await tx`INSERT INTO platform_member_invitation_events(invitation_id,actor_id,action) VALUES (${current.id}::uuid,${actor.actorId.slice(0,120)},'revoked')`;
      return { status: 200, body: { v: 1, invitation: updated } };
    });
    return reply.code(outcome.status).send(outcome.body);
  });
}
