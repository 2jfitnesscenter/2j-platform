import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createDatabase } from './db.js';

const timezone = 'Atlantic/Canary';
const uuid = z.string().uuid();
const serviceStatus = z.enum(['active', 'draft']);
const rightInput = z.object({
  rightType: z.enum(['service_access', 'sessions_quota', 'period_quota']),
  serviceId: uuid.transform((value) => value.toLowerCase()).nullable().optional(),
  quotaScope: z.enum(['shared', 'per_service']).nullable().optional(),
  quantity: z.number().int().min(1).max(100_000).nullable().optional(),
  period: z.enum(['week', 'month', 'plan_period']).nullable().optional(),
  periodMode: z.enum(['calendar', 'rolling']).nullable().optional(),
  timezone: z.literal(timezone).optional(),
  validDays: z.number().int().min(1).max(3660).nullable().optional(),
  validDaysStartRule: z.enum(['purchase', 'first_use']).nullable().optional(),
}).strict().superRefine((right, context) => {
  if (right.rightType === 'service_access') {
    if (right.quantity != null || right.quotaScope != null || right.period != null || right.periodMode != null || right.timezone != null) context.addIssue({ code: 'custom', message: 'El acceso directo no admite cuota ni periodo.' });
  } else if (!Number.isInteger(right.quantity) || !right.quotaScope) {
    context.addIssue({ code: 'custom', message: 'Las cuotas necesitan cantidad y alcance.' });
  }
  if (right.quotaScope === 'per_service' && !right.serviceId) context.addIssue({ code: 'custom', message: 'La cuota por servicio debe indicar el servicio de destino.' });
  if (right.quotaScope === 'shared' && right.serviceId) context.addIssue({ code: 'custom', message: 'La cuota compartida debe aplicarse globalmente a los servicios incluidos.' });
  if (right.rightType === 'period_quota' && (!right.period || (right.period === 'plan_period' ? right.periodMode != null || right.timezone != null : !right.periodMode || (right.timezone ?? timezone) !== timezone))) context.addIssue({ code: 'custom', message: 'La cuota periódica necesita un modo y zona horaria Atlantic/Canary, salvo que siga el periodo del plan.' });
  if (right.rightType !== 'period_quota' && (right.period != null || right.periodMode != null || right.timezone != null)) context.addIssue({ code: 'custom', message: 'Solo las cuotas periódicas admiten periodo y zona horaria.' });
  if ((right.validDays == null) !== (right.validDaysStartRule == null)) context.addIssue({ code: 'custom', message: 'La caducidad necesita indicar si comienza en la compra o en el primer uso.' });
});

export const serviceInput = z.object({ name: z.string().trim().min(1).max(100), areaId: uuid.transform((value) => value.toLowerCase()), status: serviceStatus }).strict();
export const areaInput = z.object({ name: z.string().trim().min(1).max(80) }).strict();
export const planInput = z.object({
  name: z.string().trim().min(1).max(100), serviceIds: z.array(uuid.transform((value) => value.toLowerCase())).min(1).max(20), kind: z.enum(['recurring', 'session_pack']),
  renewalCadence: z.enum(['weekly', 'monthly', 'custom_period']).nullable().optional(),
  periodDays: z.number().int().min(1).max(3660).nullable().optional(), rights: z.array(rightInput).min(1).max(40),
}).strict().superRefine((plan, context) => {
  if (new Set(plan.serviceIds).size !== plan.serviceIds.length) context.addIssue({ code: 'custom', path: ['serviceIds'], message: 'No se pueden repetir servicios.' });
  if (plan.kind === 'recurring' && !plan.renewalCadence) context.addIssue({ code: 'custom', path: ['renewalCadence'], message: 'El plan recurrente requiere una renovación definida.' });
  if (plan.kind === 'session_pack' && (plan.renewalCadence != null || plan.periodDays != null)) context.addIssue({ code: 'custom', path: ['kind'], message: 'El bono de sesiones no tiene renovación.' });
  if (plan.kind === 'session_pack' && plan.rights.some((right) => right.rightType === 'period_quota')) context.addIssue({ code: 'custom', path: ['rights'], message: 'Los bonos de sesiones no admiten cuotas periódicas.' });
  if (plan.kind === 'session_pack' && !plan.rights.some((right) => right.rightType === 'sessions_quota')) context.addIssue({ code: 'custom', path: ['rights'], message: 'El bono de sesiones requiere un derecho con número de sesiones.' });
  if (plan.renewalCadence === 'custom_period' && !plan.periodDays) context.addIssue({ code: 'custom', path: ['periodDays'], message: 'El periodo personalizado requiere días.' });
  if (plan.renewalCadence !== 'custom_period' && plan.periodDays != null) context.addIssue({ code: 'custom', path: ['periodDays'], message: 'Los días solo aplican al periodo personalizado.' });
  plan.rights.forEach((right, index) => {
    if (right.serviceId && !plan.serviceIds.includes(right.serviceId)) context.addIssue({ code: 'custom', path: ['rights', index, 'serviceId'], message: 'El derecho debe apuntar a un servicio incluido en el plan.' });
  });
  const scopedRights = new Set<string>();
  for (const [index, right] of plan.rights.entries()) {
    const scopeKey = `${right.rightType}:${right.period ?? ''}:${right.serviceId ?? '*'}`;
    const overlapping = right.rightType !== 'service_access' && (right.serviceId == null
      ? plan.rights.some((other, otherIndex) => otherIndex !== index && other.rightType === right.rightType && (other.period ?? null) === (right.period ?? null) && other.serviceId != null)
      : plan.rights.some((other, otherIndex) => otherIndex !== index && other.rightType === right.rightType && (other.period ?? null) === (right.period ?? null) && other.serviceId == null));
    if (scopedRights.has(scopeKey) || overlapping) context.addIssue({ code: 'custom', path: ['rights', index], message: 'No se pueden solapar derechos globales y específicos para el mismo periodo.' });
    scopedRights.add(scopeKey);
  }
});

type SqlClient = ReturnType<typeof createDatabase>['client'];
type SqlError = FastifyError & { code?: string; constraint_name?: string };

export function mapDatabaseError(error: unknown) {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  if (code === '23505') return { status: 409, body: { error: 'conflict', message: 'Ya existe una definición con esos datos.' } };
  if (code === '23503') return { status: 409, body: { error: 'reference_conflict', message: 'Un elemento relacionado ya no está disponible.' } };
  if (['23502', '23514', '22P02', '22003', '22023'].includes(code)) return { status: 422, body: { error: 'constraint_violation', message: 'La definición no cumple las reglas del catálogo.' } };
  if (code === '55000') return { status: 409, body: { error: 'definition_immutable', message: 'La definición activa es inmutable; crea una nueva versión.' } };
  if (code.startsWith('08') || ['57P01', '57P02', '57P03', '53300', '53400', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'].includes(code)) return { status: 503, body: { error: 'database_unavailable', message: 'La base de datos no está disponible.' } };
  return { status: 500, body: { error: 'internal_error', message: 'No se pudo completar la operación.' } };
}

export function buildServer(databaseUrl = process.env.DATABASE_URL) {
  const app = Fastify({ logger: true, bodyLimit: 16_384 });
  const { client } = createDatabase(databaseUrl);
  const allowedOrigin = process.env.CORS_ORIGIN ?? 'http://127.0.0.1:5173';
  const originHost = new URL(allowedOrigin).hostname.replace(/^\[|\]$/g, '');
  if (!['127.0.0.1', 'localhost', '::1'].includes(originHost)) throw new Error('CORS_ORIGIN must be loopback-only until runtime authentication is approved.');
  app.register(cors, { origin: allowedOrigin, methods: ['GET', 'POST', 'PATCH', 'OPTIONS'], allowedHeaders: ['content-type', 'idempotency-key'] });
  app.addHook('onRequest', async (request, reply) => {
    const host = request.hostname?.replace(/^\[|\]$/g, '').toLowerCase();
    if (!host || !['127.0.0.1', 'localhost', '::1'].includes(host)) return reply.code(400).send({ error: 'invalid_host' });
  });
  app.addHook('onClose', async () => { await client.end(); });
  app.get('/health', async (_request, reply) => {
    try { await client`SELECT 1`; return { status: 'ok', mode: 'local-only', database: 'ready' }; }
    catch { return reply.code(503).send({ status: 'unavailable', mode: 'local-only', database: 'unavailable' }); }
  });
  app.get('/api/areas', async (_request, reply) => {
    try { return await client`SELECT id,name,status FROM areas WHERE status='active' ORDER BY normalized_name`; }
    catch (error) { return sendDatabaseError(app, reply, error); }
  });
  app.post('/api/areas', async (request, reply) => {
    const parsed = areaInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() });
    const name = parsed.data.name.normalize('NFKC').trim();
    const normalizedName = name.toLocaleLowerCase('es');
    try {
      const [row] = await client`INSERT INTO areas(name,normalized_name,status) VALUES (${name},${normalizedName},'active') RETURNING id,name,status`;
      return reply.code(201).send(row);
    } catch (error) { return sendDatabaseError(app, reply, error); }
  });
  app.patch('/api/areas/:areaId/archive', async (request, reply) => {
    const { areaId } = request.params as { areaId: string };
    if (!uuid.safeParse(areaId).success) return reply.code(400).send({ error: 'invalid_area_id' });
    try {
      const [row] = await client`UPDATE areas SET status='archived' WHERE id=${areaId} AND status='active' RETURNING id,name,status`;
      if (!row) return reply.code(404).send({ error: 'area_not_found' });
      return row;
    } catch (error) { return sendDatabaseError(app, reply, error); }
  });
  app.get('/api/services', async (_request, reply) => {
    try {
      return await client`SELECT s.id,s.name,s.status,s.area_id AS "areaId",a.name AS area,s.updated_at AS "updatedAt",count(DISTINCT p.id)::int AS "planCount",count(DISTINCT r.id)::int AS "rightCount" FROM services s JOIN areas a ON a.id=s.area_id LEFT JOIN plan_services ps ON ps.service_id=s.id LEFT JOIN plans p ON p.id=ps.plan_id AND p.current_version=ps.plan_version AND p.status <> 'archived' LEFT JOIN plan_rights r ON r.plan_id=p.id AND r.plan_version=p.current_version AND (r.service_id IS NULL OR r.service_id=s.id) WHERE s.status <> 'archived' GROUP BY s.id,a.name ORDER BY lower(a.name),lower(s.name),s.id`;
    } catch (error) { return sendDatabaseError(app, reply, error); }
  });
  app.post('/api/services', async (request, reply) => {
    const parsed = serviceInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() });
    try {
      const [row] = await client`INSERT INTO services (name,area_id,status) SELECT ${parsed.data.name},id,${parsed.data.status} FROM areas WHERE id=${parsed.data.areaId} AND status='active' RETURNING id,name,area_id AS "areaId",status,updated_at AS "updatedAt"`;
      if (!row) return reply.code(404).send({ error: 'area_not_found' });
      return reply.code(201).send(row);
    } catch (error) { return sendDatabaseError(app, reply, error); }
  });
  app.patch('/api/services/:serviceId/archive', async (request, reply) => {
    const { serviceId } = request.params as { serviceId: string };
    if (!uuid.safeParse(serviceId).success) return reply.code(400).send({ error: 'invalid_service_id' });
    try {
      const [row] = await client`UPDATE services SET status='archived' WHERE id=${serviceId} AND status <> 'archived' RETURNING id,name,status`;
      if (!row) return reply.code(404).send({ error: 'service_not_found' });
      return row;
    } catch (error) { return sendDatabaseError(app, reply, error); }
  });
  app.get('/api/services/:serviceId/plans', async (request, reply) => {
    const { serviceId } = request.params as { serviceId: string };
    if (!uuid.safeParse(serviceId).success) return reply.code(400).send({ error: 'invalid_service_id' });
    try {
      const [service] = await client`SELECT id,status FROM services WHERE id=${serviceId}`;
      if (!service) return reply.code(404).send({ error: 'service_not_found' });
      if (service.status === 'archived') return reply.code(409).send({ error: 'service_archived' });
      return await listPlans(client, serviceId);
    }
    catch (error) { return sendDatabaseError(app, reply, error); }
  });
  app.post('/api/plans', async (request, reply) => {
    const idempotencyKey = request.headers['idempotency-key'];
    if (typeof idempotencyKey !== 'string' || !uuid.safeParse(idempotencyKey).success) return reply.code(400).send({ error: 'idempotency_key_required' });
    const parsed = planInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() });
    const serviceIds = [...parsed.data.serviceIds].sort(compareCodeUnits);
    const canonicalRights = parsed.data.rights.map((right) => ({
      rightType: right.rightType, serviceId: right.serviceId ?? null, quotaScope: right.quotaScope ?? null,
      quantity: right.quantity ?? null, period: right.period ?? null, periodMode: right.periodMode ?? null,
      timezone: right.rightType === 'period_quota' && right.period !== 'plan_period' ? timezone : null,
      validDays: right.validDays ?? null, validDaysStartRule: right.validDaysStartRule ?? null,
    })).sort((a, b) => compareCodeUnits(JSON.stringify(a), JSON.stringify(b)));
    const body = { ...parsed.data, serviceIds, rights: parsed.data.rights };
    const canonicalBody = {
      name: body.name, serviceIds: body.serviceIds, kind: body.kind, renewalCadence: body.renewalCadence ?? null, periodDays: body.periodDays ?? null,
      rights: canonicalRights,
    };
    const requestHash = createHash('sha256').update(JSON.stringify(canonicalBody)).digest('hex');
    try {
      const result = await client.begin(async (tx) => {
        const [prior] = await tx`SELECT id,request_hash AS "requestHash" FROM plans WHERE idempotency_key=${idempotencyKey}`;
        if (prior) return prior.requestHash.trim() === requestHash ? { id: prior.id, replay: true as const } : { error: 'idempotency_conflict' as const };
        const services = await tx`SELECT id,status FROM services WHERE id IN ${tx(body.serviceIds)} ORDER BY id FOR SHARE`;
        if (services.length !== body.serviceIds.length) return { error: 'service_not_found' as const };
        if (services.some((item) => item.status === 'archived')) return { error: 'service_archived' as const };
        const [existing] = await tx`SELECT id,request_hash AS "requestHash" FROM plans WHERE idempotency_key=${idempotencyKey}`;
        if (existing) return existing.requestHash.trim() === requestHash ? { id: existing.id, replay: true as const } : { error: 'idempotency_conflict' as const };
        const [plan] = await tx`INSERT INTO plans(name,status,current_version,idempotency_key,request_hash) VALUES (${body.name},'draft',1,${idempotencyKey},${requestHash}) RETURNING id`;
        if (!plan) throw new Error('Plan insert returned no row');
        await tx`INSERT INTO plan_versions(plan_id,version,kind,renewal_cadence,period_days,timezone) VALUES (${plan.id},1,${body.kind},${body.renewalCadence ?? null},${body.periodDays ?? null},${timezone})`;
        await tx`INSERT INTO plan_services(plan_id,plan_version,service_id) SELECT ${plan.id},1,id FROM services WHERE id IN ${tx(body.serviceIds)}`;
        for (const right of body.rights) {
          await tx`INSERT INTO plan_rights(plan_id,plan_version,right_type,service_id,quota_scope,quantity,period,period_mode,timezone,valid_days,valid_days_start_rule) VALUES (${plan.id},1,${right.rightType},${right.serviceId ?? null},${right.quotaScope ?? null},${right.quantity ?? null},${right.period ?? null},${right.periodMode ?? null},${right.rightType === 'period_quota' && right.period !== 'plan_period' ? timezone : null},${right.validDays ?? null},${right.validDaysStartRule ?? null})`;
        }
        return { id: plan.id, replay: false as const };
      });
      if ('error' in result) {
        const status = result.error === 'idempotency_conflict' ? 409 : result.error === 'service_archived' ? 409 : 404;
        return reply.code(status).send({ error: result.error });
      }
      const plan = await getPlan(client, result.id);
      return reply.code(result.replay ? 200 : 201).send(plan);
    } catch (error) {
      if (getDatabaseCode(error) === '23505') {
        const [existing] = await client`SELECT id,request_hash AS "requestHash" FROM plans WHERE idempotency_key=${idempotencyKey}`.catch(() => []);
        if (existing) {
          if (existing.requestHash.trim() !== requestHash) return reply.code(409).send({ error: 'idempotency_conflict' });
          return reply.code(200).send(await getPlan(client, existing.id));
        }
      }
      return sendDatabaseError(app, reply, error);
    }
  });
  app.post('/api/plans/:planId/activate', async (request, reply) => {
    const { planId } = request.params as { planId: string };
    if (!uuid.safeParse(planId).success) return reply.code(400).send({ error: 'invalid_plan_id' });
    try {
      const result = await client.begin(async (tx) => {
        const [plan] = await tx`SELECT id,status FROM plans WHERE id=${planId} FOR UPDATE`;
        if (!plan) return 'not_found';
        if (plan.status !== 'draft') return 'conflict';
        const services = await tx`SELECT s.id,s.status FROM plans p JOIN plan_services ps ON ps.plan_id=p.id AND ps.plan_version=p.current_version JOIN services s ON s.id=ps.service_id WHERE p.id=${planId} ORDER BY s.id FOR SHARE OF s`;
        if (services.length === 0 || services.some((service) => service.status !== 'active')) return 'archived_service';
        await tx`UPDATE plan_versions SET frozen_at=now() WHERE plan_id=${planId} AND version=(SELECT current_version FROM plans WHERE id=${planId}) AND frozen_at IS NULL`;
        await tx`UPDATE plans SET status='active' WHERE id=${planId}`;
        return 'active';
      });
      if (result === 'not_found') return reply.code(404).send({ error: 'plan_not_found' });
      if (result === 'conflict') return reply.code(409).send({ error: 'plan_state_conflict' });
      if (result === 'archived_service') return reply.code(409).send({ error: 'plan_requires_active_services' });
      return await getPlan(client, planId);
    } catch (error) { return sendDatabaseError(app, reply, error); }
  });
  app.post('/api/plans/:planId/archive', async (request, reply) => {
    const { planId } = request.params as { planId: string };
    if (!uuid.safeParse(planId).success) return reply.code(400).send({ error: 'invalid_plan_id' });
    try {
      const [row] = await client`UPDATE plans SET status='archived' WHERE id=${planId} AND status <> 'archived' RETURNING id,name,status,current_version AS "currentVersion"`;
      if (!row) return reply.code(404).send({ error: 'plan_not_found' });
      return row;
    } catch (error) { return sendDatabaseError(app, reply, error); }
  });
  return app;
}

function compareCodeUnits(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function listPlans(client: SqlClient, serviceId: string) {
  const plans = await client`SELECT p.id,p.name,p.status,p.current_version AS "currentVersion",v.kind,v.renewal_cadence AS "renewalCadence",v.period_days AS "periodDays" FROM plan_services ps JOIN plans p ON p.id=ps.plan_id AND p.current_version=ps.plan_version JOIN plan_versions v ON v.plan_id=p.id AND v.version=p.current_version WHERE ps.service_id=${serviceId} AND p.status <> 'archived' ORDER BY lower(p.name),p.id`;
  return Promise.all(plans.map(async (plan) => {
    const services = await client`SELECT s.id,s.name,a.name AS area FROM plan_services ps JOIN services s ON s.id=ps.service_id JOIN areas a ON a.id=s.area_id WHERE ps.plan_id=${plan.id} AND ps.plan_version=${plan.currentVersion} ORDER BY lower(s.name),s.id`;
    const rights = await client`SELECT id,right_type AS "rightType",service_id AS "serviceId",quota_scope AS "quotaScope",quantity,period,period_mode AS "periodMode",timezone,valid_days AS "validDays",valid_days_start_rule AS "validDaysStartRule" FROM plan_rights WHERE plan_id=${plan.id} AND plan_version=${plan.currentVersion} ORDER BY right_type,service_id NULLS FIRST,id`;
    return { ...plan, services, rights };
  }));
}

async function getPlan(client: SqlClient, planId: string) { return (await listPlansById(client, planId))[0] ?? null; }
async function listPlansById(client: SqlClient, planId: string) {
  const rows = await client`SELECT id,name,status,current_version AS "currentVersion" FROM plans WHERE id=${planId}`;
  if (!rows[0]) return [];
  const plan = rows[0];
  const versionRows = await client`SELECT kind,renewal_cadence AS "renewalCadence",period_days AS "periodDays" FROM plan_versions WHERE plan_id=${planId} AND version=${plan.currentVersion}`;
  const services = await client`SELECT s.id,s.name,a.name AS area FROM plan_services ps JOIN services s ON s.id=ps.service_id JOIN areas a ON a.id=s.area_id WHERE ps.plan_id=${planId} AND ps.plan_version=${plan.currentVersion} ORDER BY lower(s.name),s.id`;
  const rights = await client`SELECT id,right_type AS "rightType",service_id AS "serviceId",quota_scope AS "quotaScope",quantity,period,period_mode AS "periodMode",timezone,valid_days AS "validDays",valid_days_start_rule AS "validDaysStartRule" FROM plan_rights WHERE plan_id=${planId} AND plan_version=${plan.currentVersion} ORDER BY right_type,service_id NULLS FIRST,id`;
  return [{ ...plan, ...versionRows[0], services, rights }];
}

function sendDatabaseError(app: ReturnType<typeof Fastify>, reply: { code: (status: number) => { send: (body: unknown) => unknown } }, error: unknown) {
  const mapped = mapDatabaseError(error);
  if (mapped.status >= 500) app.log.error(error);
  return reply.code(mapped.status).send(mapped.body);
}

function getDatabaseCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const app = buildServer();
  const host = process.env.HOST ?? '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('HOST must be loopback-only until runtime authentication is approved.');
  await app.listen({ host, port: Number(process.env.PORT ?? 3100) });
}
