import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can, type AuthorizationContext } from '@2j/permissions';
import type { createDatabase } from './db.js';

type Database = ReturnType<typeof createDatabase>['client'];
const centerKey = '2j';
const text = (max: number) => z.string().max(max * 2).transform((value) => value.normalize('NFKC').trim()).pipe(z.string().max(max));
const optionalText = (max: number) => text(max).nullable();
const profileInput = z.object({
  businessName: text(120).pipe(z.string().min(1).max(120)),
  contactEmail: z.union([z.literal(''), z.string().max(254).email()]).nullable().transform((value) => value ? value.normalize('NFKC').trim().toLocaleLowerCase('en-US') : null),
  contactPhone: optionalText(40).refine((value) => value === null || (value.length >= 5 && /^[+0-9().\-\s]+$/.test(value)), 'invalid_phone'),
  address: optionalText(200),
  city: optionalText(100),
  postalCode: optionalText(20),
}).strict();
const columns = ['businessName', 'contactEmail', 'contactPhone', 'address', 'city', 'postalCode'] as const;

async function authorize(
  request: FastifyRequest,
  reply: any,
  resolve: (request: FastifyRequest) => Promise<AuthorizationContext | null>,
) {
  const actor = await resolve(request);
  if (!actor) { reply.code(401).send({ error: 'authentication_required' }); return null; }
  if (!can(actor, 'settings.manage')) { reply.code(403).send({ error: 'permission_denied' }); return null; }
  return actor;
}

export function registerCenterProfileRoutes(
  app: FastifyInstance,
  db: Database,
  resolveStaff: (request: FastifyRequest) => Promise<AuthorizationContext | null>,
) {
  app.get('/api/admin/center-profile', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!await authorize(request, reply, resolveStaff)) return;
    try {
      const [profile] = await db`SELECT business_name AS "businessName",contact_email AS "contactEmail",contact_phone AS "contactPhone",address,city,postal_code AS "postalCode",updated_at AS "updatedAt"
        FROM center_business_profile WHERE center_key=${centerKey}`;
      return { profile: profile ?? null };
    } catch {
      request.log.error({ route: 'GET /api/admin/center-profile' }, 'center profile read failed');
      return reply.code(500).send({ error: 'internal_error' });
    }
  });

  app.put('/api/admin/center-profile', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const actor = await authorize(request, reply, resolveStaff);
    if (!actor) return;
    const parsed = profileInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' });
    const next = {
      ...parsed.data,
      contactPhone: parsed.data.contactPhone || null,
      address: parsed.data.address || null,
      city: parsed.data.city || null,
      postalCode: parsed.data.postalCode || null,
    };
    try {
      const profile = await db.begin(async (tx) => {
        const [current] = await tx`SELECT business_name AS "businessName",contact_email AS "contactEmail",contact_phone AS "contactPhone",address,city,postal_code AS "postalCode"
          FROM center_business_profile WHERE center_key=${centerKey} FOR UPDATE`;
        const changedFields = columns.filter((field) => (current?.[field] ?? null) !== (next[field] ?? null));
        const [saved] = await tx`INSERT INTO center_business_profile(center_key,business_name,contact_email,contact_phone,address,city,postal_code,updated_by)
          VALUES (${centerKey},${next.businessName},${next.contactEmail || null},${next.contactPhone || null},${next.address || null},${next.city || null},${next.postalCode || null},${actor.actorId})
          ON CONFLICT(center_key) DO UPDATE SET business_name=excluded.business_name,contact_email=excluded.contact_email,contact_phone=excluded.contact_phone,address=excluded.address,city=excluded.city,postal_code=excluded.postal_code,updated_by=excluded.updated_by,updated_at=now()
          RETURNING business_name AS "businessName",contact_email AS "contactEmail",contact_phone AS "contactPhone",address,city,postal_code AS "postalCode",updated_at AS "updatedAt"`;
        if (changedFields.length) await tx`INSERT INTO center_business_profile_audit_events(center_key,actor_id,action,changed_fields)
          VALUES (${centerKey},${actor.actorId},'center_profile.updated',${JSON.stringify(changedFields)}::jsonb)`;
        return saved;
      });
      return { profile };
    } catch {
      request.log.error({ route: 'PUT /api/admin/center-profile' }, 'center profile update failed');
      return reply.code(500).send({ error: 'internal_error' });
    }
  });
}
