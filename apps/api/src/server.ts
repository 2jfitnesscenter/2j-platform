import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createDatabase } from './db.js';
import { registerClientRoutes } from './clients.js';
import { registerClientPlanRoutes } from './client-plans.js';
import { registerEntitlementRoutes } from './entitlements.js';
import { registerCalendarRoutes } from './calendar.js';
import { registerClientAppRoutes } from './client-app.js';
import { createMemberPilotAuth } from './member-pilot-auth.js';
import { registerMemberBookingCohortRoutes } from './member-booking-cohort.js';
import { registerEconomicRoutes } from './economics.js';
import { registerEconomicExtensions } from './economic-extensions.js';
import { registerStaffRoutes } from './staff.js';
import { registerCommunicationRoutes, type ClientAuthorizationContext } from './communications.js';
import { registerDashboardRoutes } from './dashboard.js';
import { registerPersonIdentityRoutes } from './person-identity.js';
import { registerTrainingLinkTransactionRoutes, type ResolvedPersonAuth, type TrainingLinkVerifier } from './training-link-protocol.js';
import { createRemoteTrainingLinkVerifier, createRemoteTrainingReceiptReconciler } from './training-integration.js';
import { createTrainingCanonicalLinkLifecycle } from './training-link-lifecycle.js';
import { registerNotificationRoutes } from './notifications.js';
import { createBookingEligibilityResolver, type BookingEligibilityResolver } from './booking-eligibility.js';
import { can, type AuthorizationContext, type ApprovedRole } from '@2j/permissions';

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
    if (!right.serviceId) context.addIssue({ code: 'custom', path: ['serviceId'], message: 'El acceso directo debe indicar un servicio de destino.' });
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

export const serviceInput = z.object({ name: z.string().trim().min(1).max(100), areaId: uuid.transform((value) => value.toLowerCase()), status: serviceStatus, cancellationWindowMinutes:z.number().int().min(0).max(10080).default(0),lateCancellationPolicy:z.enum(['restore','consume']).default('restore') }).strict();
export const areaInput = z.object({ name: z.string().trim().min(1).max(80) }).strict();
export const planInput = z.object({
  name: z.string().trim().min(1).max(100), serviceIds: z.array(uuid.transform((value) => value.toLowerCase())).min(1).max(20), kind: z.enum(['recurring', 'session_pack']),
  renewalCadence: z.enum(['weekly', 'monthly', 'custom_period']).nullable().optional(),
  periodDays: z.number().int().min(1).max(3660).nullable().optional(), basePriceCents: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  modules: z.array(z.object({ module: z.enum(['reservations','training','nutrition','health']), accessLevel: z.enum(['limited','full']), capabilities: z.array(z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$/)).max(30).default([]) }).strict()).max(10).default([]),
  rights: z.array(rightInput).min(1).max(40),
}).strict().superRefine((plan, context) => {
  if (new Set(plan.serviceIds).size !== plan.serviceIds.length) context.addIssue({ code: 'custom', path: ['serviceIds'], message: 'No se pueden repetir servicios.' });
  if (plan.kind === 'recurring' && !plan.renewalCadence) context.addIssue({ code: 'custom', path: ['renewalCadence'], message: 'El plan recurrente requiere una renovación definida.' });
  if (plan.kind === 'session_pack' && (plan.renewalCadence != null || plan.periodDays != null)) context.addIssue({ code: 'custom', path: ['kind'], message: 'El bono de sesiones no tiene renovación.' });
  if (plan.kind === 'session_pack' && plan.rights.some((right) => right.rightType === 'period_quota')) context.addIssue({ code: 'custom', path: ['rights'], message: 'Los bonos de sesiones no admiten cuotas periódicas.' });
  if (plan.kind === 'session_pack' && !plan.rights.some((right) => right.rightType === 'sessions_quota')) context.addIssue({ code: 'custom', path: ['rights'], message: 'El bono de sesiones requiere un derecho con número de sesiones.' });
  if (plan.renewalCadence === 'custom_period' && !plan.periodDays) context.addIssue({ code: 'custom', path: ['periodDays'], message: 'El periodo personalizado requiere días.' });
  if (plan.renewalCadence !== 'custom_period' && plan.periodDays != null) context.addIssue({ code: 'custom', path: ['periodDays'], message: 'Los días solo aplican al periodo personalizado.' });
  if (new Set(plan.modules.map((item) => item.module)).size !== plan.modules.length) context.addIssue({ code: 'custom', path: ['modules'], message: 'No se puede repetir el acceso a un módulo.' });
  plan.modules.forEach((item, index) => { if (new Set(item.capabilities).size !== item.capabilities.length || item.capabilities.some((capability) => capability.split('.')[0] !== item.module)) context.addIssue({ code: 'custom', path: ['modules', index, 'capabilities'], message: 'Las capacidades deben ser únicas y pertenecer al módulo.' }); });
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

export type ServerOptions = {
  authorizationResolver?: (request: import('fastify').FastifyRequest) => Promise<AuthorizationContext | null>;
  bookingEligibilityResolver?: BookingEligibilityResolver;
  clientAuthorizationResolver?: (request: import('fastify').FastifyRequest) => Promise<ClientAuthorizationContext | null>;
  memberPilotAuthEnabled?: boolean;
  memberPilotBookingEnabled?: boolean;
  memberPilotCohortManagementEnabled?: boolean;
  memberAppOrigin?: string | null;
  trainingLinkingEnabled?: boolean;
  trainingVerifiedLinkingEnabled?: boolean;
  trainingServiceCallsEnabled?: boolean;
  trainingCanonicalLinkingEnabled?: boolean;
  resolvePersonAuth?: (request: import('fastify').FastifyRequest) => Promise<ResolvedPersonAuth | null>;
  trainingLinkVerifier?: TrainingLinkVerifier;
  logger?: FastifyServerOptions['logger'];
};

export function buildServer(databaseUrl = process.env.DATABASE_URL, options: ServerOptions = {}) {
  if (options.memberPilotAuthEnabled && !['development', 'test'].includes(process.env.NODE_ENV ?? '')) {
    throw new Error('Pilot member authentication is restricted to development/test environments.');
  }
  if (options.memberPilotBookingEnabled && (!options.memberPilotAuthEnabled || !['development', 'test'].includes(process.env.NODE_ENV ?? ''))) throw new Error('Member booking pilot mutations require development/test Member pilot authentication.');
  if (options.memberPilotCohortManagementEnabled && !['development', 'test'].includes(process.env.NODE_ENV ?? '')) throw new Error('Member pilot cohort management is restricted to development/test environments.');
  const app = Fastify({
    logger: options.logger ?? { serializers: { req(request) { return { method: request.method ?? '', url: typeof request.url === 'string' ? request.url.split('?')[0] ?? '/' : '/' }; } } },
    bodyLimit: 16_384,
  });
  app.setErrorHandler((error, request, reply) => {
    const fastifyError = error as FastifyError;
    const route = typeof request.url === 'string' ? request.url.split('?')[0] ?? '/' : '/';
    if (fastifyError.code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
      app.log.warn({ errorCode: 'invalid_json', method: request.method, route }, 'request body rejected');
      return reply.code(400).send({ error: 'invalid_json', message: 'El cuerpo de la solicitud no es JSON válido.' });
    }
    const statusCode = typeof fastifyError.statusCode === 'number' && fastifyError.statusCode >= 400 && fastifyError.statusCode < 600 ? fastifyError.statusCode : 500;
    if (statusCode >= 500) app.log.error({ errorCode: fastifyError.code ?? 'unknown', method: request.method, route }, 'request failed');
    return reply.code(statusCode).send({ error: statusCode < 500 ? 'request_rejected' : 'internal_error' });
  });
  const { client } = createDatabase(databaseUrl);
  const authorizationResolver = options.authorizationResolver ?? (async () => null);
  const memberPilotAuth = createMemberPilotAuth(client, { enabled: options.memberPilotAuthEnabled === true, memberOrigin: options.memberAppOrigin ?? null });
  const clientAuthorizationResolver = options.clientAuthorizationResolver ?? (memberPilotAuth.enabled ? memberPilotAuth.resolve : async () => null);
  const allowedOrigin = process.env.CORS_ORIGIN ?? 'http://127.0.0.1:5173';
  const memberOrigin = options.memberAppOrigin ?? null;
  for (const configuredOrigin of [allowedOrigin, ...(memberOrigin ? [memberOrigin] : [])]) {
    const parsedOrigin = new URL(configuredOrigin);
    const originHost = parsedOrigin.hostname.replace(/^\[|\]$/g, '');
    if (!['127.0.0.1', 'localhost', '::1'].includes(originHost) || parsedOrigin.origin !== configuredOrigin.replace(/\/$/, '')) throw new Error('CORS_ORIGIN and MEMBER_APP_ORIGIN must be exact loopback origins.');
  }
  if (options.memberPilotAuthEnabled && !memberOrigin) throw new Error('MEMBER_APP_ORIGIN is required when pilot member authentication is enabled.');
  const corsOrigins = [...new Set([allowedOrigin, ...(memberOrigin ? [memberOrigin] : [])])];
  app.register(cors, { origin: corsOrigins, credentials: true, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['content-type', 'idempotency-key'] });
  app.addHook('onRequest', async (request, reply) => {
    const host = request.hostname?.replace(/^\[|\]$/g, '').toLowerCase();
    if (!host || !['127.0.0.1', 'localhost', '::1'].includes(host)) return reply.code(400).send({ error: 'invalid_host' });
    // Fastify resolves percent-encoded path characters before setting routeOptions.url.
    // Use the matched route so alternate encodings cannot skip the Member CSRF policy.
    const routePath = request.routeOptions.url ?? '';
    const memberMutation = routePath.startsWith('/api/me/') || routePath.startsWith('/api/client-portal/');
    if (memberPilotAuth.enabled && memberMutation && !['GET','HEAD','OPTIONS'].includes(request.method) && !memberPilotAuth.csrfAllowed(request)) return reply.code(403).send({ error: 'origin_rejected' });
  });
  app.addHook('onSend', async (request, reply, payload) => {
    const route = request.routeOptions.url ?? '';
    if (['/api/me/sessions/:sessionId/reservations','/api/me/sessions/:sessionId/waitlist','/api/me/bookings/:reservationId/cancel','/api/me/waitlist/:entryId/cancel'].includes(route)) {
      let code = '';
      if (typeof payload === 'string') { try { const parsed = JSON.parse(payload); if (typeof parsed?.error === 'string') code = parsed.error; } catch {} }
      const outcome = reply.statusCode < 400 ? 'success' : code === 'member_pilot_action_not_enabled' ? 'cohort_blocked' : ['no_active_entitlement','entitlement_required','entitlement_unavailable','debt_restriction','required_document_missing','session_full','booking_conflict','service_archived','area_archived'].includes(code) ? 'eligibility_blocked' : 'failure';
      request.log.info({ pilotAction: route, outcome, statusCode: reply.statusCode }, 'member booking pilot attempt');
    }
    return payload;
  });
  app.addHook('onClose', async () => { await client.end(); });
  registerClientRoutes(app, client, authorizationResolver);
  registerClientPlanRoutes(app, client, authorizationResolver);
  registerEntitlementRoutes(app, client, authorizationResolver);
  const bookingEligibilityResolver = options.bookingEligibilityResolver ?? createBookingEligibilityResolver();
  const allowMemberBooking = async (personId: string | undefined, request: import('fastify').FastifyRequest) => {
    if (!options.memberPilotBookingEnabled || !personId) return false;
    const [row] = await client`SELECT 1 AS enabled FROM platform_member_booking_pilot_cohort WHERE person_id=${personId}::uuid AND status='active'`;
    return Boolean(row);
  };
  registerCalendarRoutes(app, client, authorizationResolver, bookingEligibilityResolver, clientAuthorizationResolver, allowMemberBooking);
  registerClientAppRoutes(app, client, clientAuthorizationResolver, bookingEligibilityResolver, options.memberPilotBookingEnabled === true);
  registerMemberBookingCohortRoutes(app, client, authorizationResolver, options.memberPilotCohortManagementEnabled === true);
  memberPilotAuth.register(app);
  registerEconomicRoutes(app, client, authorizationResolver);
  registerEconomicExtensions(app, client, authorizationResolver);
  registerStaffRoutes(app, client, authorizationResolver);
  registerCommunicationRoutes(app, client, authorizationResolver, clientAuthorizationResolver);
  registerNotificationRoutes(app, client, authorizationResolver, clientAuthorizationResolver);
  registerDashboardRoutes(app, client, authorizationResolver);
  registerPersonIdentityRoutes(app, client, authorizationResolver, options.trainingLinkingEnabled === true);
  registerTrainingLinkTransactionRoutes(app, client, {
    enabled: options.trainingVerifiedLinkingEnabled === true,
    serviceCallsEnabled: options.trainingServiceCallsEnabled === true,
    verifier: options.trainingLinkVerifier ?? createRemoteTrainingLinkVerifier({
      trainingVerifiedLinkingEnabled: options.trainingVerifiedLinkingEnabled === true,
      trainingServiceCallsEnabled: options.trainingServiceCallsEnabled === true,
      ...(process.env.TRAINING_SERVICE_BASE_URL ? { baseUrl: process.env.TRAINING_SERVICE_BASE_URL } : {}),
      ...(process.env.TRAINING_SERVICE_KEY_ID ? { keyId: process.env.TRAINING_SERVICE_KEY_ID } : {}),
      ...(process.env.TRAINING_SERVICE_SECRET ? { secret: process.env.TRAINING_SERVICE_SECRET } : {}),
      fetcher: globalThis.fetch,
    }),
    resolvePersonAuth: options.resolvePersonAuth ?? (async () => null),
  });
  app.decorate('trainingCanonicalLinkLifecycle', createTrainingCanonicalLinkLifecycle(client, {
    trainingVerifiedLinkingEnabled: options.trainingVerifiedLinkingEnabled === true,
    trainingServiceCallsEnabled: options.trainingServiceCallsEnabled === true,
    trainingCanonicalLinkingEnabled: options.trainingCanonicalLinkingEnabled === true,
    reconcileReceipt: createRemoteTrainingReceiptReconciler({
      trainingVerifiedLinkingEnabled: options.trainingVerifiedLinkingEnabled === true,
      trainingServiceCallsEnabled: options.trainingServiceCallsEnabled === true,
      trainingCanonicalLinkingEnabled: options.trainingCanonicalLinkingEnabled === true,
      ...(process.env.TRAINING_SERVICE_BASE_URL ? { baseUrl: process.env.TRAINING_SERVICE_BASE_URL } : {}),
      ...(process.env.TRAINING_SERVICE_KEY_ID ? { keyId: process.env.TRAINING_SERVICE_KEY_ID } : {}),
      ...(process.env.TRAINING_SERVICE_SECRET ? { secret: process.env.TRAINING_SERVICE_SECRET } : {}),
      fetcher: globalThis.fetch,
    }),
  }));
  app.get('/health', async (_request, reply) => {
    try { await client`SELECT 1`; return { status: 'ok', mode: 'local-only', database: 'ready' }; }
    catch { return reply.code(503).send({ status: 'unavailable', mode: 'local-only', database: 'unavailable' }); }
  });
  app.get('/api/areas', async (_request, reply) => {
    try { return await client`SELECT id,name,status FROM areas WHERE status='active' ORDER BY normalized_name`; }
    catch (error) { return sendDatabaseError(app, reply, error); }
  });
  app.post('/api/areas', async (request, reply) => {
    const context = await authorizationResolver(request);
    if (!context) return reply.code(401).send({ error: 'authentication_required' });
    if (!can(context, 'catalog.pricing.manage')) return reply.code(403).send({ error: 'permission_denied' });
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
    const context = await authorizationResolver(request);
    if (!context) return reply.code(401).send({ error: 'authentication_required' });
    if (!can(context, 'catalog.pricing.manage')) return reply.code(403).send({ error: 'permission_denied' });
    const { areaId } = request.params as { areaId: string };
    if (!uuid.safeParse(areaId).success) return reply.code(400).send({ error: 'invalid_area_id' });
    try {
      const result = await client.begin(async (tx) => {
        const [area] = await tx`SELECT id,status FROM areas WHERE id=${areaId} FOR UPDATE`;
        if (!area || area.status !== 'active') return { error: 'area_not_found' as const };
        const [operational] = await tx`SELECT
          EXISTS (SELECT 1 FROM calendar_sessions WHERE area_id=${areaId} AND status='scheduled' AND starts_at > now()) OR
          EXISTS (SELECT 1 FROM recurring_session_templates WHERE area_id=${areaId} AND status='active' AND (ends_on IS NULL OR ends_on >= (now() AT TIME ZONE 'Atlantic/Canary')::date)) AS exists`;
        if (operational?.exists) return { error: 'future_calendar_items_exist' as const };
        const [row] = await tx`UPDATE areas SET status='archived' WHERE id=${areaId} AND status='active' RETURNING id,name,status`;
        return row ? { row } : { error: 'area_not_found' as const };
      });
      if ('error' in result) return reply.code(result.error === 'future_calendar_items_exist' ? 409 : 404).send({ error: result.error });
      return result.row;
    } catch (error) { return sendDatabaseError(app, reply, error); }
  });
  app.get('/api/services', async (_request, reply) => {
    try {
      return await client`SELECT s.id,s.name,s.status,s.area_id AS "areaId",s.cancellation_window_minutes AS "cancellationWindowMinutes",s.late_cancellation_policy AS "lateCancellationPolicy",a.name AS area,s.updated_at AS "updatedAt",count(DISTINCT p.id)::int AS "planCount",count(DISTINCT r.id)::int AS "rightCount" FROM services s JOIN areas a ON a.id=s.area_id LEFT JOIN plan_services ps ON ps.service_id=s.id LEFT JOIN plans p ON p.id=ps.plan_id AND p.current_version=ps.plan_version AND p.status <> 'archived' LEFT JOIN plan_rights r ON r.plan_id=p.id AND r.plan_version=p.current_version AND (r.service_id IS NULL OR r.service_id=s.id) WHERE s.status <> 'archived' GROUP BY s.id,a.name ORDER BY lower(a.name),lower(s.name),s.id`;
    } catch (error) { return sendDatabaseError(app, reply, error); }
  });
  app.post('/api/services', async (request, reply) => {
    const context = await authorizationResolver(request);
    if (!context) return reply.code(401).send({ error: 'authentication_required' });
    if (!can(context, 'catalog.pricing.manage')) return reply.code(403).send({ error: 'permission_denied' });
    const parsed = serviceInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() });
    try {
      const row = await client.begin(async (tx) => {
        const [area] = await tx`SELECT id FROM areas WHERE id=${parsed.data.areaId} AND status='active' FOR SHARE`;
        if (!area) return null;
        const [created] = await tx`INSERT INTO services (name,area_id,status,cancellation_window_minutes,late_cancellation_policy) VALUES (${parsed.data.name},${area.id},${parsed.data.status},${parsed.data.cancellationWindowMinutes},${parsed.data.lateCancellationPolicy}) RETURNING id,name,area_id AS "areaId",status,cancellation_window_minutes AS "cancellationWindowMinutes",late_cancellation_policy AS "lateCancellationPolicy",updated_at AS "updatedAt"`;
        return created ?? null;
      });
      if (!row) return reply.code(404).send({ error: 'area_not_found' });
      return reply.code(201).send(row);
    } catch (error) { return sendDatabaseError(app, reply, error); }
  });
  app.patch('/api/services/:serviceId/archive', async (request, reply) => {
    const context = await authorizationResolver(request);
    if (!context) return reply.code(401).send({ error: 'authentication_required' });
    if (!can(context, 'catalog.pricing.manage')) return reply.code(403).send({ error: 'permission_denied' });
    const { serviceId } = request.params as { serviceId: string };
    if (!uuid.safeParse(serviceId).success) return reply.code(400).send({ error: 'invalid_service_id' });
    try {
      const result = await client.begin(async (tx) => {
        const [service] = await tx`SELECT id,status FROM services WHERE id=${serviceId} FOR UPDATE`;
        if (!service || service.status === 'archived') return { error: 'service_not_found' as const };
        const [operational] = await tx`SELECT
          EXISTS (SELECT 1 FROM calendar_sessions WHERE service_id=${serviceId} AND status='scheduled' AND starts_at > now()) OR
          EXISTS (SELECT 1 FROM recurring_session_templates WHERE service_id=${serviceId} AND status='active' AND (ends_on IS NULL OR ends_on >= (now() AT TIME ZONE 'Atlantic/Canary')::date)) AS exists`;
        if (operational?.exists) return { error: 'future_calendar_items_exist' as const };
        const [row] = await tx`UPDATE services SET status='archived' WHERE id=${serviceId} AND status <> 'archived' RETURNING id,name,status`;
        return row ? { row } : { error: 'service_not_found' as const };
      });
      if ('error' in result) return reply.code(result.error === 'future_calendar_items_exist' ? 409 : 404).send({ error: result.error });
      return result.row;
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
    const context=await authorizationResolver(request);
    if(!context)return reply.code(401).send({error:'authentication_required'});
    if(!can(context,'catalog.pricing.manage'))return reply.code(403).send({error:'permission_denied'});
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
        rights: canonicalRights, basePriceCents: body.basePriceCents ?? null,
      modules: [...body.modules].map((item) => ({ ...item, capabilities: [...item.capabilities].sort(compareCodeUnits) })).sort((a,b) => compareCodeUnits(a.module,b.module)),
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
        await tx`INSERT INTO plan_versions(plan_id,version,kind,renewal_cadence,period_days,timezone,base_price_cents) VALUES (${plan.id},1,${body.kind},${body.renewalCadence ?? null},${body.periodDays ?? null},${timezone},${body.basePriceCents ?? null})`;
        await tx`INSERT INTO plan_services(plan_id,plan_version,service_id) SELECT ${plan.id},1,id FROM services WHERE id IN ${tx(body.serviceIds)}`;
        for (const right of body.rights) {
          await tx`INSERT INTO plan_rights(plan_id,plan_version,right_type,service_id,quota_scope,quantity,period,period_mode,timezone,valid_days,valid_days_start_rule) VALUES (${plan.id},1,${right.rightType},${right.serviceId ?? null},${right.quotaScope ?? null},${right.quantity ?? null},${right.period ?? null},${right.periodMode ?? null},${right.rightType === 'period_quota' && right.period !== 'plan_period' ? timezone : null},${right.validDays ?? null},${right.validDaysStartRule ?? null})`;
        }
        for (const moduleAccess of body.modules) {
          await tx`INSERT INTO plan_module_accesses(plan_id,plan_version,module,access_level) VALUES (${plan.id},1,${moduleAccess.module},${moduleAccess.accessLevel})`;
          for (const capability of moduleAccess.capabilities) await tx`INSERT INTO plan_module_capabilities(plan_id,plan_version,module,capability) VALUES (${plan.id},1,${moduleAccess.module},${capability})`;
        }
        await tx`INSERT INTO economic_audit_events(actor_id,action,resource_type,resource_id,details) VALUES (${context.actorId},'catalog.plan_created','plan',${plan.id},${JSON.stringify({version:1,basePriceCents:body.basePriceCents??null,modules:body.modules.map(item=>item.module)})}::jsonb)`;
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
  app.post('/api/plans/:planId/versions', async (request, reply) => {
    reply.header('Cache-Control','no-store');
    const context=await authorizationResolver(request);
    if(!context)return reply.code(401).send({error:'authentication_required'});
    if(!can(context,'catalog.pricing.manage'))return reply.code(403).send({error:'permission_denied'});
    const {planId}=request.params as {planId:string};
    if(!uuid.safeParse(planId).success)return reply.code(400).send({error:'invalid_plan_id'});
    const idempotencyKey=request.headers['idempotency-key'];
    if(typeof idempotencyKey!=='string'||!uuid.safeParse(idempotencyKey).success)return reply.code(400).send({error:'idempotency_key_required'});
    const parsed=planInput.safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:'validation_error',details:parsed.error.flatten()});
    const body=parsed.data;const serviceIds=[...body.serviceIds].sort(compareCodeUnits);
    const canonical={...body,serviceIds,modules:[...body.modules].map(item=>({...item,capabilities:[...item.capabilities].sort(compareCodeUnits)})).sort((a,b)=>compareCodeUnits(a.module,b.module)),rights:[...body.rights].map(right=>({...right,serviceId:right.serviceId??null})).sort((a,b)=>compareCodeUnits(JSON.stringify(a),JSON.stringify(b)))};
    const requestHash=createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
    try{
      const result=await client.begin(async tx=>{
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyKey},0))`;
        const [prior]=await tx`SELECT plan_id AS "planId",version,request_hash AS "requestHash" FROM plan_version_changes WHERE idempotency_key=${idempotencyKey}`;
        if(prior)return prior.requestHash.trim()===requestHash?{planId:prior.planId,version:prior.version,replay:true as const}:{error:'idempotency_conflict' as const};
        const [plan]=await tx`SELECT id,name,status,current_version AS "currentVersion" FROM plans WHERE id=${planId} FOR UPDATE`;
        if(!plan||plan.status==='archived')return {error:'plan_unavailable' as const};
        const services=await tx`SELECT id,status FROM services WHERE id IN ${tx(serviceIds)} ORDER BY id FOR SHARE`;
        if(services.length!==serviceIds.length)return {error:'service_not_found' as const};
        if(services.some(item=>item.status==='archived'))return {error:'service_archived' as const};
        const version=Number(plan.currentVersion)+1;
        await tx`INSERT INTO plan_versions(plan_id,version,kind,renewal_cadence,period_days,timezone,base_price_cents) VALUES (${plan.id},${version},${body.kind},${body.renewalCadence??null},${body.periodDays??null},${timezone},${body.basePriceCents??null})`;
        await tx`INSERT INTO plan_services(plan_id,plan_version,service_id) SELECT ${plan.id},${version},id FROM services WHERE id IN ${tx(serviceIds)}`;
        for(const right of body.rights)await tx`INSERT INTO plan_rights(plan_id,plan_version,right_type,service_id,quota_scope,quantity,period,period_mode,timezone,valid_days,valid_days_start_rule) VALUES (${plan.id},${version},${right.rightType},${right.serviceId??null},${right.quotaScope??null},${right.quantity??null},${right.period??null},${right.periodMode??null},${right.rightType==='period_quota'&&right.period!=='plan_period'?timezone:null},${right.validDays??null},${right.validDaysStartRule??null})`;
        for(const access of body.modules){await tx`INSERT INTO plan_module_accesses(plan_id,plan_version,module,access_level) VALUES (${plan.id},${version},${access.module},${access.accessLevel})`;for(const capability of access.capabilities)await tx`INSERT INTO plan_module_capabilities(plan_id,plan_version,module,capability) VALUES (${plan.id},${version},${access.module},${capability})`;}
        if(plan.status==='active')await tx`UPDATE plan_versions SET frozen_at=now() WHERE plan_id=${plan.id} AND version=${version}`;
        await tx`UPDATE plans SET current_version=${version},name=${body.name} WHERE id=${plan.id}`;
        await tx`INSERT INTO plan_version_changes(plan_id,version,actor_id,idempotency_key,request_hash) VALUES (${plan.id},${version},${context.actorId},${idempotencyKey},${requestHash})`;
        await tx`INSERT INTO economic_audit_events(actor_id,action,resource_type,resource_id,details) VALUES (${context.actorId},'catalog.plan_version_created','plan',${plan.id},${JSON.stringify({version,basePriceCents:body.basePriceCents??null,modules:body.modules.map(item=>item.module)})}::jsonb)`;
        return {planId:plan.id,version,replay:false as const};
      });
      if('error'in result)return reply.code(result.error==='service_not_found'?404:409).send({error:result.error});
      const output=await getPlan(client,result.planId);
      return reply.code(result.replay?200:201).send(output);
    }catch(error){return sendDatabaseError(app,reply,error);}
  });
  app.post('/api/plans/:planId/activate', async (request, reply) => {
    const context=await authorizationResolver(request);
    if(!context)return reply.code(401).send({error:'authentication_required'});
    if(!can(context,'catalog.pricing.manage'))return reply.code(403).send({error:'permission_denied'});
    const { planId } = request.params as { planId: string };
    if (!uuid.safeParse(planId).success) return reply.code(400).send({ error: 'invalid_plan_id' });
    try {
      const result = await client.begin(async (tx) => {
        const [plan] = await tx`SELECT id,status FROM plans WHERE id=${planId} FOR UPDATE`;
        if (!plan) return 'not_found';
        if (plan.status === 'archived') return 'conflict';
        const services = await tx`SELECT s.id,s.status FROM plans p JOIN plan_services ps ON ps.plan_id=p.id AND ps.plan_version=p.current_version JOIN services s ON s.id=ps.service_id WHERE p.id=${planId} ORDER BY s.id FOR SHARE OF s`;
        if (services.length === 0 || services.some((service) => service.status !== 'active')) return 'archived_service';
        const [version] = await tx`SELECT frozen_at AS "frozenAt" FROM plan_versions WHERE plan_id=${planId} AND version=(SELECT current_version FROM plans WHERE id=${planId}) FOR UPDATE`;
        if (version?.frozenAt) return 'conflict';
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
    const context=await authorizationResolver(request);
    if(!context)return reply.code(401).send({error:'authentication_required'});
    if(!can(context,'catalog.pricing.manage'))return reply.code(403).send({error:'permission_denied'});
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
  const plans = await client`SELECT p.id,p.name,p.status,p.current_version AS "currentVersion",v.kind,v.renewal_cadence AS "renewalCadence",v.period_days AS "periodDays",v.base_price_cents AS "basePriceCents" FROM plan_services ps JOIN plans p ON p.id=ps.plan_id AND p.current_version=ps.plan_version JOIN plan_versions v ON v.plan_id=p.id AND v.version=p.current_version WHERE ps.service_id=${serviceId} AND p.status <> 'archived' ORDER BY lower(p.name),p.id`;
  return Promise.all(plans.map(async (plan) => {
    const services = await client`SELECT s.id,s.name,a.name AS area FROM plan_services ps JOIN services s ON s.id=ps.service_id JOIN areas a ON a.id=s.area_id WHERE ps.plan_id=${plan.id} AND ps.plan_version=${plan.currentVersion} ORDER BY lower(s.name),s.id`;
    const rights = await client`SELECT id,right_type AS "rightType",service_id AS "serviceId",quota_scope AS "quotaScope",quantity,period,period_mode AS "periodMode",timezone,valid_days AS "validDays",valid_days_start_rule AS "validDaysStartRule" FROM plan_rights WHERE plan_id=${plan.id} AND plan_version=${plan.currentVersion} ORDER BY right_type,service_id NULLS FIRST,id`;
    const modules = await client`SELECT m.module,m.access_level AS "accessLevel",COALESCE((SELECT jsonb_agg(c.capability ORDER BY c.capability) FROM plan_module_capabilities c WHERE c.plan_id=m.plan_id AND c.plan_version=m.plan_version AND c.module=m.module),'[]'::jsonb) AS capabilities FROM plan_module_accesses m WHERE m.plan_id=${plan.id} AND m.plan_version=${plan.currentVersion} ORDER BY m.module`;
    return { ...plan, services, rights, modules };
  }));
}

async function getPlan(client: SqlClient, planId: string) { return (await listPlansById(client, planId))[0] ?? null; }
async function listPlansById(client: SqlClient, planId: string) {
  const rows = await client`SELECT id,name,status,current_version AS "currentVersion" FROM plans WHERE id=${planId}`;
  if (!rows[0]) return [];
  const plan = rows[0];
  const versionRows = await client`SELECT kind,renewal_cadence AS "renewalCadence",period_days AS "periodDays",base_price_cents AS "basePriceCents" FROM plan_versions WHERE plan_id=${planId} AND version=${plan.currentVersion}`;
  const services = await client`SELECT s.id,s.name,a.name AS area FROM plan_services ps JOIN services s ON s.id=ps.service_id JOIN areas a ON a.id=s.area_id WHERE ps.plan_id=${planId} AND ps.plan_version=${plan.currentVersion} ORDER BY lower(s.name),s.id`;
  const rights = await client`SELECT id,right_type AS "rightType",service_id AS "serviceId",quota_scope AS "quotaScope",quantity,period,period_mode AS "periodMode",timezone,valid_days AS "validDays",valid_days_start_rule AS "validDaysStartRule" FROM plan_rights WHERE plan_id=${planId} AND plan_version=${plan.currentVersion} ORDER BY right_type,service_id NULLS FIRST,id`;
  const modules = await client`SELECT m.module,m.access_level AS "accessLevel",COALESCE((SELECT jsonb_agg(c.capability ORDER BY c.capability) FROM plan_module_capabilities c WHERE c.plan_id=m.plan_id AND c.plan_version=m.plan_version AND c.module=m.module),'[]'::jsonb) AS capabilities FROM plan_module_accesses m WHERE m.plan_id=${planId} AND m.plan_version=${plan.currentVersion} ORDER BY m.module`;
  return [{ ...plan, ...versionRows[0], services, rights, modules }];
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
  const host = process.env.HOST ?? '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('HOST must be loopback-only until runtime authentication is approved.');
  const localDemoRole = process.env.LOCAL_DEMO_ROLE;
  if (localDemoRole && process.env.NODE_ENV !== 'development') throw new Error('LOCAL_DEMO_ROLE is only allowed in NODE_ENV=development.');
  const allowedLocalRoles: ApprovedRole[] = ['admin', 'trainer', 'reception-management', 'accountant'];
  if (localDemoRole && !allowedLocalRoles.includes(localDemoRole as ApprovedRole)) throw new Error('LOCAL_DEMO_ROLE must be an approved role.');
  const localContext: AuthorizationContext | null = localDemoRole ? { actorId: `local-demo:${localDemoRole}`, role: localDemoRole as ApprovedRole } : null;
  const localDemoClientId = process.env.LOCAL_DEMO_CLIENT_ID;
  if (localDemoClientId && process.env.NODE_ENV !== 'development') throw new Error('LOCAL_DEMO_CLIENT_ID is only allowed in NODE_ENV=development.');
  if (localDemoClientId && !z.string().uuid().safeParse(localDemoClientId).success) throw new Error('LOCAL_DEMO_CLIENT_ID must be a client UUID.');
  const app = buildServer(undefined, {
    authorizationResolver: async () => localContext,
    memberPilotAuthEnabled: process.env.PILOT_MEMBER_AUTH_ENABLED === 'true',
    memberPilotBookingEnabled: process.env.PILOT_MEMBER_BOOKING_ENABLED === 'true',
    memberPilotCohortManagementEnabled: process.env.PILOT_MEMBER_COHORT_MANAGEMENT_ENABLED === 'true',
    memberAppOrigin: process.env.MEMBER_APP_ORIGIN ?? null,
    ...(localDemoClientId ? { clientAuthorizationResolver: async () => ({ clientId: localDemoClientId.toLowerCase() }) } : {}),
  });
  await app.listen({ host, port: Number(process.env.PORT ?? 3100) });
}
