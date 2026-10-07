import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createDatabase } from './db.js';

export const serviceInput = z.object({ name: z.string().trim().min(1).max(100), area: z.string().trim().min(1).max(80), status: z.enum(['active', 'draft']) }).strict();
export const planInput = z.object({ name: z.string().trim().min(1).max(100), billingCadence: z.enum(['monthly', 'weekly', 'session_pack', 'period']), priceMinor: z.number().int().nonnegative().nullable().optional(), periodDays: z.number().int().min(1).max(3660).nullable().optional(), rights: z.array(z.object({ rightType: z.enum(['service_access', 'sessions_quota', 'period_quota']), quantity: z.number().int().positive().nullable().optional(), period: z.enum(['week', 'month', 'plan_period']).nullable().optional(), validDays: z.number().int().min(1).max(3660).nullable().optional() }).strict()).min(1).max(20) }).strict().superRefine((plan, context) => {
  plan.rights.forEach((right, index) => {
    if (right.rightType === 'service_access' && (right.quantity != null || right.period != null)) context.addIssue({ code: 'custom', path: ['rights', index], message: 'Service access cannot have a quota or period' });
    if (right.rightType !== 'service_access' && !Number.isInteger(right.quantity)) context.addIssue({ code: 'custom', path: ['rights', index, 'quantity'], message: 'Quota rights require a quantity' });
    if (right.rightType === 'period_quota' && !right.period) context.addIssue({ code: 'custom', path: ['rights', index, 'period'], message: 'Periodic quotas require a period' });
  });
});

export function buildServer(databaseUrl = process.env.DATABASE_URL) {
  const app = Fastify({ logger: true, bodyLimit: 16_384 });
  const { client } = createDatabase(databaseUrl);
  app.register(cors, { origin: 'http://127.0.0.1:5173' });
  app.addHook('onClose', async () => { await client.end(); });
  app.get('/health', async () => ({ status: 'ok', mode: 'local-only' }));
  app.get('/api/services', async (_request, reply) => {
    try {
      const rows = await client`SELECT s.id, s.name, s.area, s.status, s.updated_at AS "updatedAt", count(DISTINCT p.id)::int AS "planCount", count(r.id)::int AS "entitlementCount" FROM services s LEFT JOIN plans p ON p.service_id=s.id AND p.status <> 'archived' LEFT JOIN plan_rights r ON r.plan_id=p.id GROUP BY s.id ORDER BY s.updated_at DESC, s.name`;
      return rows;
    } catch (error) { app.log.error(error); return reply.code(503).send({ error: 'database_unavailable' }); }
  });
  app.post('/api/services', async (request, reply) => {
    const parsed = serviceInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() });
    try { const [row] = await client`INSERT INTO services (name,area,status) VALUES (${parsed.data.name},${parsed.data.area},${parsed.data.status}) RETURNING id,name,area,status,updated_at AS "updatedAt"`; return reply.code(201).send(row); }
    catch (error) { if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') return reply.code(409).send({ error: 'service_already_exists' }); app.log.error(error); return reply.code(503).send({ error: 'database_unavailable' }); }
  });
  app.get('/api/services/:serviceId/plans', async (request, reply) => {
    const { serviceId } = request.params as { serviceId: string };
    if (!z.string().uuid().safeParse(serviceId).success) return reply.code(400).send({ error: 'invalid_service_id' });
    const plans = await client`SELECT id,name,billing_cadence AS "billingCadence",price_minor AS "priceMinor",currency,period_days AS "periodDays",status FROM plans WHERE service_id=${serviceId} AND status <> 'archived' ORDER BY name`;
    const ids = plans.map((plan) => plan.id);
    const rights = ids.length ? await client`SELECT id,plan_id AS "planId",right_type AS "rightType",quantity,period,valid_days AS "validDays" FROM plan_rights WHERE plan_id IN ${client(ids)}` : [];
    return plans.map((plan) => ({ ...plan, rights: rights.filter((right) => right.planId === plan.id) }));
  });
  app.post('/api/services/:serviceId/plans', async (request, reply) => {
    const { serviceId } = request.params as { serviceId: string };
    if (!z.string().uuid().safeParse(serviceId).success) return reply.code(400).send({ error: 'invalid_service_id' });
    const parsed = planInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() });
    for (const right of parsed.data.rights) {
      if (right.rightType === 'service_access' && (right.quantity != null || right.period != null)) return reply.code(400).send({ error: 'invalid_service_access_right' });
      if (right.rightType !== 'service_access' && !Number.isInteger(right.quantity)) return reply.code(400).send({ error: 'right_quantity_required' });
      if (right.rightType === 'period_quota' && !right.period) return reply.code(400).send({ error: 'right_period_required' });
    }
    try {
      const result = await client.begin(async (tx) => {
        const [exists] = await tx`SELECT id FROM services WHERE id=${serviceId} AND status <> 'archived'`;
        if (!exists) return null;
        const [plan] = await tx`INSERT INTO plans (service_id,name,billing_cadence,price_minor,period_days) VALUES (${serviceId},${parsed.data.name},${parsed.data.billingCadence},${parsed.data.priceMinor ?? null},${parsed.data.periodDays ?? null}) RETURNING id,name,billing_cadence AS "billingCadence",price_minor AS "priceMinor",currency,period_days AS "periodDays",status`;
        if (!plan) throw new Error('Plan insert returned no row');
        const rights = await Promise.all(parsed.data.rights.map((right) => tx`INSERT INTO plan_rights (plan_id,right_type,quantity,period,valid_days) VALUES (${plan.id},${right.rightType},${right.quantity ?? null},${right.period ?? null},${right.validDays ?? null}) RETURNING id,right_type AS "rightType",quantity,period,valid_days AS "validDays"`));
        return { ...plan, rights: rights.flat() };
      });
      if (!result) return reply.code(404).send({ error: 'service_not_found' });
      return reply.code(201).send(result);
    } catch (error) { app.log.error(error); return reply.code(503).send({ error: 'database_unavailable' }); }
  });
  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const app = buildServer();
  await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 3100) });
}
