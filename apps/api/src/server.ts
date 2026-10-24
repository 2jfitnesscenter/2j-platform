import { isIP } from 'node:net';
import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import { createHash, createHmac } from 'node:crypto';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createDatabase } from './db.js';
import { registerClientRoutes } from './clients.js';
import { registerClientPlanRoutes } from './client-plans.js';
import { registerEntitlementRoutes } from './entitlements.js';
import { parseInternalServiceKeys, type InternalServiceKeys } from './internal-service-auth.js';
import { registerTrainingCapabilitiesRoute } from './training-capabilities-api.js';
import { registerTrainingSsoRoutes } from './training-sso.js';
import { registerTrainingSuspensionRoutes } from './training-suspensions.js';
import { createTrainingSignalDispatcher } from './training-signals.js';
import { registerAssignmentPeriodRoutes } from './assignment-periods.js';
import { registerCalendarRoutes } from './calendar.js';
import { registerClientAppRoutes } from './client-app.js';
import { createPushService, registerPushRoutes, type PushProvider } from './push.js';
import { createWebPushProvider } from './push-web-provider.js';
import { createMemberPilotAuth } from './member-pilot-auth.js';
import { registerMemberBookingCohortRoutes } from './member-booking-cohort.js';
import { registerEconomicRoutes } from './economics.js';
import { registerEconomicExtensions } from './economic-extensions.js';
import { registerStaffRoutes } from './staff.js';
import { registerCommunicationRoutes, type ClientAuthorizationContext } from './communications.js';
import { registerDashboardRoutes } from './dashboard.js';
import { registerPersonIdentityRoutes } from './person-identity.js';
import { registerPlatformPasskeyRoutes } from './platform-passkeys.js';
import { createTrainingLinkTransactions, registerTrainingLinkTransactionRoutes, type ResolvedPersonAuth, type TrainingLinkVerifier } from './training-link-protocol.js';
import { registerTrainingLinkReviewRoutes } from './training-link-review.js';
import { createTrainingLinkFlow, createTrainingServiceClient, registerTrainingLinkFlowRoutes, type TrainingServiceClient } from './training-link-flow.js';
import { createRemoteTrainingLinkVerifier, createRemoteTrainingReceiptReconciler, createTrainingAdapter, type TrainingAdapter } from './training-integration.js';
import { createTrainingCanonicalLinkLifecycle } from './training-link-lifecycle.js';
import { registerNotificationRoutes } from './notifications.js';
import { registerCenterNewsRoutes } from './center-news.js';
import { registerStoreRoutes } from './store.js';
import { createBookingEligibilityResolver, type BookingEligibilityResolver } from './booking-eligibility.js';
import { can, type AuthorizationContext, type ApprovedRole } from '@2j/permissions';

const timezone = 'Atlantic/Canary';
const uuid = z.string().uuid();
const serviceStatus = z.enum(['active', 'draft']);
const rightInput = z.object({
  rightType: z.enum(['service_access', 'sessions_quota', 'period_quota','training_access']),
  trainingAccessLevel: z.enum(['full','autonomous']).nullable().optional(),
  serviceId: uuid.transform((value) => value.toLowerCase()).nullable().optional(),
  quotaScope: z.enum(['shared', 'per_service']).nullable().optional(),
  quantity: z.number().int().min(1).max(100_000).nullable().optional(),
  weeklyFrequency: z.number().int().min(1).max(5).nullable().optional(),
  quantityRule: z.enum(['weekday_ratio_v1','fixed_v1','unlimited']).nullable().optional(),
  period: z.enum(['week', 'month', 'plan_period']).nullable().optional(),
  periodMode: z.enum(['calendar', 'rolling']).nullable().optional(),
  timezone: z.literal(timezone).optional(),
  validDays: z.number().int().min(1).max(3660).nullable().optional(),
  validDaysStartRule: z.enum(['purchase', 'first_use']).nullable().optional(),
}).strict().superRefine((right, context) => {
  if (right.rightType === 'training_access') {
    if (!right.trainingAccessLevel) context.addIssue({ code:'custom',path:['trainingAccessLevel'],message:'El acceso a Training debe ser full o autonomous.' });
    if (right.serviceId != null || right.quantity != null || right.quotaScope != null || right.weeklyFrequency != null || right.quantityRule != null || right.period != null || right.periodMode != null || right.timezone != null || right.validDays != null || right.validDaysStartRule != null) context.addIssue({code:'custom',message:'El acceso a Training solo admite su nivel explícito.'});
  } else if (right.trainingAccessLevel != null) {
    context.addIssue({code:'custom',path:['trainingAccessLevel'],message:'El nivel Training solo aplica al derecho training_access.'});
  }
  if (right.rightType === 'service_access') {
    if (!right.serviceId) context.addIssue({ code: 'custom', path: ['serviceId'], message: 'El acceso directo debe indicar un servicio de destino.' });
    if (right.quantity != null || right.quotaScope != null || right.weeklyFrequency != null || right.quantityRule != null || right.period != null || right.periodMode != null || right.timezone != null) context.addIssue({ code: 'custom', message: 'El acceso directo no admite cuota ni periodo.' });
  } else if (right.rightType === 'period_quota' && (!Number.isInteger(right.quantity) || !right.quotaScope || right.quantityRule != null)) {
    context.addIssue({ code: 'custom', message: 'Las cuotas necesitan cantidad y alcance.' });
  } else if (right.rightType === 'sessions_quota' && !right.quotaScope) {
    context.addIssue({ code:'custom',message:'Las cuotas necesitan cantidad y alcance.' });
  }
  if (right.quotaScope === 'per_service' && !right.serviceId) context.addIssue({ code: 'custom', message: 'La cuota por servicio debe indicar el servicio de destino.' });
  if (right.quotaScope === 'shared' && right.serviceId) context.addIssue({ code: 'custom', message: 'La cuota compartida debe aplicarse globalmente a los servicios incluidos.' });
  if (right.rightType === 'period_quota' && (!right.period || (right.period === 'plan_period' ? right.periodMode != null || right.timezone != null : !right.periodMode || (right.timezone ?? timezone) !== timezone))) context.addIssue({ code: 'custom', message: 'La cuota periódica necesita un modo y zona horaria Atlantic/Canary, salvo que siga el periodo del plan.' });
  if (right.weeklyFrequency != null && right.rightType !== 'sessions_quota') context.addIssue({ code: 'custom', message: 'La frecuencia semanal solo aplica a una bolsa de sesiones.' });
  if (right.quantityRule != null && right.rightType !== 'sessions_quota') context.addIssue({code:'custom',message:'La modalidad de cantidad solo aplica a bolsas de sesiones.'});
  if (right.rightType !== 'period_quota' && (right.period != null || right.periodMode != null || right.timezone != null)) context.addIssue({ code: 'custom', message: 'Solo las cuotas periódicas admiten periodo y zona horaria.' });
  if ((right.validDays == null) !== (right.validDaysStartRule == null)) context.addIssue({ code: 'custom', message: 'La caducidad necesita indicar si comienza en la compra o en el primer uso.' });
});

export const serviceInput = z.object({ name: z.string().trim().min(1).max(100), areaId: uuid.transform((value) => value.toLowerCase()), status: serviceStatus, cancellationWindowMinutes:z.number().int().min(0).max(10080).default(0),lateCancellationPolicy:z.enum(['restore','consume']).default('restore') }).strict();
export const areaInput = z.object({ name: z.string().trim().min(1).max(80) }).strict();
export const planInput = z.object({
  name: z.string().trim().min(1).max(100), serviceIds: z.array(uuid.transform((value) => value.toLowerCase())).min(1).max(20), kind: z.enum(['recurring', 'session_pack']),
  renewalCadence: z.enum(['weekly', 'monthly', 'custom_period']).nullable().optional(),
  periodDays: z.number().int().min(1).max(3660).nullable().optional(), basePriceCents: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  termKind:z.enum(['natural_month','custom_range','rolling_months','pack','one_off']).nullable().optional(),termMonths:z.number().int().nullable().optional(),maxSpanDays:z.number().int().nullable().optional(),paymentRule:z.enum(['monthly_day10_v1','grace_from_assignment_v1','on_payment_v1']).nullable().optional(),paymentBlock:z.enum(['enforce','off']).nullable().optional(),
  modules: z.array(z.object({ module: z.enum(['reservations','training','nutrition','health']), accessLevel: z.enum(['limited','full']), capabilities: z.array(z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$/)).max(30).default([]) }).strict()).max(10).default([]),
  rights: z.array(rightInput).min(1).max(40),
}).strict().superRefine((plan, context) => {
  const termKind=plan.termKind??null;
  if(termKind===null){if([plan.termMonths,plan.maxSpanDays,plan.paymentRule,plan.paymentBlock].some(value=>value!=null))context.addIssue({code:'custom',path:['termKind'],message:'Los metadatos de contrato requieren termKind.'});}
  else {
    const expectedRule=termKind==='natural_month'?'monthly_day10_v1':['pack','one_off'].includes(termKind)?'on_payment_v1':'grace_from_assignment_v1';
    const expectedKind=['pack','one_off'].includes(termKind)?'session_pack':'recurring';
    if(plan.kind!==expectedKind)context.addIssue({code:'custom',path:['kind'],message:'El tipo de plan no es compatible con termKind.'});
    if(plan.paymentRule!=null&&plan.paymentRule!==expectedRule)context.addIssue({code:'custom',path:['paymentRule'],message:'La regla de pago no es compatible con termKind.'});
    if(termKind==='natural_month'&&(plan.termMonths!=null||plan.maxSpanDays!=null||plan.renewalCadence!=='monthly'))context.addIssue({code:'custom',path:['termKind'],message:'natural_month requiere renovación mensual y no admite duración ni máximo de rango.'});
    if(termKind==='custom_range'&&plan.termMonths!=null)context.addIssue({code:'custom',path:['termMonths'],message:'custom_range no admite termMonths.'});
    if(termKind==='rolling_months'&&(![3,6,12].includes(plan.termMonths??0)||plan.maxSpanDays!=null))context.addIssue({code:'custom',path:['termMonths'],message:'rolling_months requiere 3, 6 o 12 meses y no admite maxSpanDays.'});
    if(['pack','one_off'].includes(termKind)&&(plan.termMonths!=null||plan.maxSpanDays!=null))context.addIssue({code:'custom',path:['termKind'],message:'pack y one_off no usan duración ni rango fijo.'});
    if(['pack','one_off'].includes(termKind)&&plan.paymentBlock!=null&&plan.paymentBlock!=='off')context.addIssue({code:'custom',path:['paymentBlock'],message:'pack y one_off se activan tras validar el pago y no usan bloqueo por deuda.'});
  }
  if(plan.termMonths!=null&&![3,6,12].includes(plan.termMonths))context.addIssue({code:'custom',path:['termMonths'],message:'Solo se admiten contratos de 3, 6 o 12 meses.'});
  if(plan.maxSpanDays!=null&&(plan.maxSpanDays<1||plan.maxSpanDays>3660))context.addIssue({code:'custom',path:['maxSpanDays'],message:'maxSpanDays debe estar entre 1 y 3660.'});
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
    if (right.rightType === 'sessions_quota') {
      if (termKind == null) {
        if (right.quantityRule != null || !Number.isInteger(right.quantity)) context.addIssue({code:'custom',path:['rights',index],message:'Los derechos legacy requieren una cantidad fija y no admiten modalidad.'});
      } else if (['natural_month','custom_range','rolling_months'].includes(termKind)) {
        if (right.quantityRule === 'weekday_ratio_v1') {
          if (right.quantity != null || right.weeklyFrequency == null) context.addIssue({code:'custom',path:['rights',index],message:'weekday_ratio_v1 requiere frecuencia semanal y no admite cantidad fija.'});
        } else if (right.quantityRule === 'unlimited') {
          if (right.quantity != null || right.weeklyFrequency != null) context.addIssue({code:'custom',path:['rights',index],message:'unlimited no admite cantidad ni frecuencia.'});
        } else context.addIssue({code:'custom',path:['rights',index],message:'El contrato requiere una modalidad explícita para la bolsa de sesiones.'});
      } else if (['pack','one_off'].includes(termKind)) {
        if (right.quantityRule !== 'fixed_v1' || !Number.isInteger(right.quantity) || right.weeklyFrequency != null) context.addIssue({code:'custom',path:['rights',index],message:'pack y one_off requieren cantidad fija sin frecuencia semanal.'});
      }
    }
    if (right.serviceId && !plan.serviceIds.includes(right.serviceId)) context.addIssue({ code: 'custom', path: ['rights', index, 'serviceId'], message: 'El derecho debe apuntar a un servicio incluido en el plan.' });
  });
  if (termKind != null && !plan.rights.some((right) => right.rightType === 'sessions_quota')) context.addIssue({code:'custom',path:['rights'],message:'Los contratos requieren al menos un derecho de bolsa de sesiones.'});
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

/** Validates the trusted-proxy list: concrete addresses or narrow CIDRs only, so a typo can never trust the whole internet. */
export function parseTrustedProxies(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 4) throw new Error('trustedProxies must be a list of at most 4 proxy addresses.');
  return value.map(entry => {
    if (typeof entry !== 'string') throw new Error('trustedProxies entries must be strings.');
    const [address, prefix, ...rest] = entry.trim().split('/');
    const family = address ? isIP(address) : 0;
    const bits = family === 4 ? 32 : 128;
    const length = prefix === undefined ? bits : /^\d{1,3}$/.test(prefix) ? Number(prefix) : NaN;
    const minimum = family === 4 ? 16 : 64;
    if (!family || rest.length || !Number.isInteger(length) || length > bits || (prefix !== undefined && length < minimum)) throw new Error('trustedProxies entries must be an IP address or a CIDR no wider than /16 (IPv4) or /64 (IPv6).');
    return prefix === undefined ? address! : `${address}/${length}`;
  });
}

export type ServerOptions = {
  authorizationResolver?: (request: import('fastify').FastifyRequest) => Promise<AuthorizationContext | null>;
  bookingEligibilityResolver?: BookingEligibilityResolver;
  clientAuthorizationResolver?: (request: import('fastify').FastifyRequest) => Promise<ClientAuthorizationContext | null>;
  memberPilotAuthEnabled?: boolean;
  memberPilotBookingEnabled?: boolean;
  memberPilotCohortManagementEnabled?: boolean;
  /** Web Push (decisions D152, D176, D199…). Off by default; needs the VAPID keys unless a provider is injected. */
  pushEnabled?: boolean;
  pushProvider?: PushProvider;
  pushVapidPublicKey?: string;
  pushIntervalMs?: number;
  memberAppOrigin?: string | null;
  trainingLinkingEnabled?: boolean;
  trainingVerifiedLinkingEnabled?: boolean;
  trainingServiceCallsEnabled?: boolean;
  trainingCanonicalLinkingEnabled?: boolean;
  trainingSummaryEnabled?: boolean;
  trainingSummaryAdapter?: TrainingAdapter;
  trainingCapabilitiesKeys?: InternalServiceKeys;
  /** One-time Training SSO (Platform -> Búnker). Off by default; never enabled implicitly. */
  trainingSsoEnabled?: boolean;
  trainingSsoRedirectUrl?: string | null;
  resolvePersonAuth?: (request: import('fastify').FastifyRequest) => Promise<ResolvedPersonAuth | null>;
  trainingLinkVerifier?: TrainingLinkVerifier;
  /** Bilateral link lifecycle (finish linking with the owner's proof, activate, revoke). Off by default; needs verified + canonical linking and service calls. */
  /** Platform-owned WebAuthn passkeys. Off by default; refused outside development/test until a human security review approves a rollout. */
  platformPasskeysEnabled?: boolean;
  /** Exact relying-party id, immutable once credentials exist (for example home.2jfitnesscenter.com). */
  platformPasskeyRpId?: string | null;
  platformPasskeyMaxRequestsPerMinute?: number;
  /** Exact addresses/CIDRs of the reverse proxies allowed to set X-Forwarded-For/-Proto (empty = trust none, the default). Never `true` or a catch-all: see docs/runbooks/2J-INT-proxy-and-rate-limits.md. */
  trustedProxies?: string[];
  trainingLinkLifecycleEnabled?: boolean;
  /** Idempotent provisioning of a minimal Training profile. Off by default. */
  trainingProvisioningEnabled?: boolean;
  /** Manual review queue for Training links that cannot be completed with the owner's passkey proof (A26). Off by default. */
  trainingLinkReviewEnabled?: boolean;
  /** Signed suspension/lift signals to Training (2J-CAPABILITY-SIGNAL-V1). Proof of concept: off by default and refused outside development/test. Needs the signed Training client. */
  trainingSignalsEnabled?: boolean;
  trainingSignalsIntervalMs?: number;
  trainingServiceClient?: TrainingServiceClient;
  /** Development/test only: lets the signed Training client talk to a loopback http origin. */
  trainingServiceAllowInsecureLoopback?: boolean;
  logger?: FastifyServerOptions['logger'];
};

export function buildServer(databaseUrl = process.env.DATABASE_URL, options: ServerOptions = {}) {
  if (options.memberPilotAuthEnabled && !['development', 'test'].includes(process.env.NODE_ENV ?? '')) {
    throw new Error('Pilot member authentication is restricted to development/test environments.');
  }
  if (options.trainingProvisioningEnabled && !['development', 'test'].includes(process.env.NODE_ENV ?? '')) throw new Error('Training provisioning is restricted to development/test environments until a later, explicitly approved phase.');
  if (options.trainingSignalsEnabled && !['development', 'test'].includes(process.env.NODE_ENV ?? '')) throw new Error('Training signals are a proof of concept, restricted to development/test environments until a later, explicitly approved phase.');
  if (options.platformPasskeysEnabled && !['development', 'test'].includes(process.env.NODE_ENV ?? '')) throw new Error('Platform passkeys are restricted to development/test environments until a security review approves a rollout.');
  if (options.memberPilotBookingEnabled && (!options.memberPilotAuthEnabled || !['development', 'test'].includes(process.env.NODE_ENV ?? ''))) throw new Error('Member booking pilot mutations require development/test Member pilot authentication.');
  if (options.memberPilotCohortManagementEnabled && !['development', 'test'].includes(process.env.NODE_ENV ?? '')) throw new Error('Member pilot cohort management is restricted to development/test environments.');
  const trustedProxies = parseTrustedProxies(options.trustedProxies);
  const app = Fastify({
    trustProxy: trustedProxies.length ? trustedProxies : false,
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
  if (options.trainingServiceAllowInsecureLoopback && !['development', 'test'].includes(process.env.NODE_ENV ?? '')) throw new Error('Insecure loopback Training calls are restricted to development/test environments.');
  const { client } = createDatabase(databaseUrl);
  const trainingCapabilitiesKeys = options.trainingCapabilitiesKeys ?? parseInternalServiceKeys(process.env.PLATFORM_INTERNAL_SERVICE_KEYS);
  const authorizationResolver = options.authorizationResolver ?? (async () => null);
  const memberPilotAuth = createMemberPilotAuth(client, { enabled: options.memberPilotAuthEnabled === true, memberOrigin: options.memberAppOrigin ?? null, passkeysEnabled: options.platformPasskeysEnabled === true });
  const clientAuthorizationResolver = options.clientAuthorizationResolver ?? (memberPilotAuth.enabled ? memberPilotAuth.resolve : async () => null);
  const trainingSummaryAdapter = options.trainingSummaryEnabled === true && options.trainingServiceCallsEnabled === true
    ? options.trainingSummaryAdapter ?? (() => {
    try {
      const baseUrl = process.env.TRAINING_SERVICE_BASE_URL ?? '';
      const keyId = process.env.TRAINING_SERVICE_KEY_ID ?? '';
      const encodedSecret = process.env.TRAINING_SERVICE_SECRET ?? '';
      const secret = Buffer.from(encodedSecret, 'base64url');
      const origins = (process.env.TRAINING_SERVICE_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
      const base = new URL(baseUrl);
      if (!/^[A-Za-z0-9._-]{1,80}$/.test(keyId) || secret.length < 32 || secret.toString('base64url') !== encodedSecret || !origins.includes(base.origin)) return createTrainingAdapter();
      return createTrainingAdapter({
        enabled: true, baseUrl, allowedOrigins: origins, keyId, fetcher: globalThis.fetch,
        signRequest: async canonical => createHmac('sha256', secret).update(Buffer.from(canonical, 'utf8')).digest('base64url'),
      });
    } catch { return createTrainingAdapter(); }
  })()
    : createTrainingAdapter();
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
  let stopTrainingSignals: () => void = () => {};
  app.addHook('onClose', async () => { stopTrainingSignals(); await client.end(); });
  registerClientRoutes(app, client, authorizationResolver);
  registerClientPlanRoutes(app, client, authorizationResolver);
  registerEntitlementRoutes(app, client, authorizationResolver);
  registerTrainingCapabilitiesRoute(app, client, trainingCapabilitiesKeys);
  registerTrainingSuspensionRoutes(app, client, authorizationResolver);
  registerTrainingSsoRoutes(app, client, {
    enabled: options.trainingSsoEnabled === true,
    keys: trainingCapabilitiesKeys,
    resolvePersonAuth: options.resolvePersonAuth ?? (memberPilotAuth.enabled ? memberPilotAuth.resolvePerson : async () => null),
    redirectUrl: options.trainingSsoRedirectUrl ?? null,
    allowedOrigin: options.memberAppOrigin ?? null,
  });
  registerAssignmentPeriodRoutes(app, client, authorizationResolver);
  const bookingEligibilityResolver = options.bookingEligibilityResolver ?? createBookingEligibilityResolver();
  const allowMemberBooking = async (personId: string | undefined, request: import('fastify').FastifyRequest) => {
    if (!options.memberPilotBookingEnabled || !personId) return false;
    const [row] = await client`SELECT 1 AS enabled FROM platform_member_booking_pilot_cohort WHERE person_id=${personId}::uuid AND status='active'`;
    return Boolean(row);
  };
  registerCalendarRoutes(app, client, authorizationResolver, bookingEligibilityResolver, clientAuthorizationResolver, allowMemberBooking);
  registerClientAppRoutes(app, client, clientAuthorizationResolver, bookingEligibilityResolver, options.memberPilotBookingEnabled === true, trainingSummaryAdapter);
  registerMemberBookingCohortRoutes(app, client, authorizationResolver, options.memberPilotCohortManagementEnabled === true);
  const pushEnabled = options.pushEnabled === true;
  const vapid = { publicKey: options.pushVapidPublicKey ?? process.env.PUSH_VAPID_PUBLIC_KEY ?? '', privateKey: process.env.PUSH_VAPID_PRIVATE_KEY ?? '', subject: process.env.PUSH_VAPID_SUBJECT ?? '' };
  if (pushEnabled && !options.pushProvider && !(vapid.publicKey && vapid.privateKey && vapid.subject)) throw new Error('PUSH_ENABLED needs PUSH_VAPID_PUBLIC_KEY, PUSH_VAPID_PRIVATE_KEY and PUSH_VAPID_SUBJECT.');
  const push = createPushService(client, { enabled: pushEnabled, provider: pushEnabled ? options.pushProvider ?? createWebPushProvider(vapid) : null, vapidPublicKey: vapid.publicKey || null, ...(options.pushIntervalMs ? { intervalMs: options.pushIntervalMs } : {}), logger: app.log });
  registerPushRoutes(app, client, clientAuthorizationResolver, push, memberOrigin);
  app.addHook('onReady', async () => { push.start(); });
  app.addHook('onClose', async () => { push.stop(); });
  memberPilotAuth.register(app);
  registerPlatformPasskeyRoutes(app, client, { enabled: options.platformPasskeysEnabled === true, rpId: options.platformPasskeyRpId ?? null, origin: options.memberAppOrigin ?? null, startSession: memberPilotAuth.startSession, resolveAuthorization: authorizationResolver, ...(options.platformPasskeyMaxRequestsPerMinute ? { maxRequestsPerMinute: options.platformPasskeyMaxRequestsPerMinute } : {}) });
  registerEconomicRoutes(app, client, authorizationResolver);
  registerEconomicExtensions(app, client, authorizationResolver);
  registerStaffRoutes(app, client, authorizationResolver);
  registerCommunicationRoutes(app, client, authorizationResolver, clientAuthorizationResolver);
  registerNotificationRoutes(app, client, authorizationResolver, clientAuthorizationResolver);
  registerCenterNewsRoutes(app, client, authorizationResolver, clientAuthorizationResolver);
  registerStoreRoutes(app, client, authorizationResolver, clientAuthorizationResolver);
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
    resolvePersonAuth: options.resolvePersonAuth ?? (memberPilotAuth.enabled ? memberPilotAuth.resolvePerson : async () => null),
  });
  app.decorate('trainingCanonicalLinkLifecycle', createTrainingCanonicalLinkLifecycle(client, {
    trainingVerifiedLinkingEnabled: options.trainingVerifiedLinkingEnabled === true,
    trainingServiceCallsEnabled: options.trainingServiceCallsEnabled === true,
    trainingCanonicalLinkingEnabled: options.trainingCanonicalLinkingEnabled === true,
    reconcileReceipt: createRemoteTrainingReceiptReconciler({
      trainingVerifiedLinkingEnabled: options.trainingVerifiedLinkingEnabled === true,
      trainingServiceCallsEnabled: options.trainingServiceCallsEnabled === true,
      trainingCanonicalLinkingEnabled: options.trainingCanonicalLinkingEnabled === true,
      ...(options.trainingServiceAllowInsecureLoopback ? { allowInsecureLoopbackForTests: true } : {}),
      ...(process.env.TRAINING_SERVICE_BASE_URL ? { baseUrl: process.env.TRAINING_SERVICE_BASE_URL } : {}),
      ...(process.env.TRAINING_SERVICE_KEY_ID ? { keyId: process.env.TRAINING_SERVICE_KEY_ID } : {}),
      ...(process.env.TRAINING_SERVICE_SECRET ? { secret: process.env.TRAINING_SERVICE_SECRET } : {}),
      fetcher: globalThis.fetch,
    }),
  }));
  const lifecycleOn = options.trainingLinkLifecycleEnabled === true || options.trainingProvisioningEnabled === true || options.trainingSignalsEnabled === true;
  const trainingServiceClient = options.trainingServiceClient ?? createTrainingServiceClient({
    trainingVerifiedLinkingEnabled: lifecycleOn,
    trainingServiceCallsEnabled: options.trainingServiceCallsEnabled === true,
    ...(process.env.TRAINING_SERVICE_BASE_URL ? { baseUrl: process.env.TRAINING_SERVICE_BASE_URL } : {}),
    ...(process.env.TRAINING_SERVICE_KEY_ID ? { keyId: process.env.TRAINING_SERVICE_KEY_ID } : {}),
    ...(process.env.TRAINING_SERVICE_SECRET ? { secret: process.env.TRAINING_SERVICE_SECRET } : {}),
    fetcher: globalThis.fetch,
    ...(options.trainingServiceAllowInsecureLoopback ? { allowInsecureLoopbackForTests: true } : {}),
  });
  const linkVerifier = options.trainingLinkVerifier ?? createRemoteTrainingLinkVerifier({
    trainingVerifiedLinkingEnabled: options.trainingVerifiedLinkingEnabled === true,
    trainingServiceCallsEnabled: options.trainingServiceCallsEnabled === true,
    ...(process.env.TRAINING_SERVICE_BASE_URL ? { baseUrl: process.env.TRAINING_SERVICE_BASE_URL } : {}),
    ...(process.env.TRAINING_SERVICE_KEY_ID ? { keyId: process.env.TRAINING_SERVICE_KEY_ID } : {}),
    ...(process.env.TRAINING_SERVICE_SECRET ? { secret: process.env.TRAINING_SERVICE_SECRET } : {}),
    fetcher: globalThis.fetch,
    ...(options.trainingServiceAllowInsecureLoopback ? { allowInsecureLoopbackForTests: true } : {}),
  });
  const trainingSignals = createTrainingSignalDispatcher(client, { client: trainingServiceClient, enabled: options.trainingSignalsEnabled === true && options.trainingServiceCallsEnabled === true, ...(options.trainingSignalsIntervalMs ? { intervalMs: options.trainingSignalsIntervalMs } : {}), logger: app.log });
  (app as unknown as { trainingSignals: typeof trainingSignals }).trainingSignals = trainingSignals;
  app.addHook('onReady', async () => { trainingSignals.start(); });
  stopTrainingSignals = () => trainingSignals.stop();
  registerTrainingLinkFlowRoutes(app, client, {
    enabled: options.trainingLinkLifecycleEnabled === true && options.trainingVerifiedLinkingEnabled === true && options.trainingCanonicalLinkingEnabled === true && options.trainingServiceCallsEnabled === true,
    provisioningEnabled: options.trainingProvisioningEnabled === true && options.trainingServiceCallsEnabled === true,
    flow: createTrainingLinkFlow(client, { client: trainingServiceClient }),
    transactions: createTrainingLinkTransactions(client, { enabled: options.trainingVerifiedLinkingEnabled === true, serviceCallsEnabled: options.trainingServiceCallsEnabled === true, verifier: linkVerifier }),
    lifecycle: (app as unknown as { trainingCanonicalLinkLifecycle: ReturnType<typeof createTrainingCanonicalLinkLifecycle> }).trainingCanonicalLinkLifecycle,
    resolvePersonAuth: options.resolvePersonAuth ?? (memberPilotAuth.enabled ? memberPilotAuth.resolvePerson : async () => null),
    resolveAuthorization: authorizationResolver,
    allowedOrigin: options.memberAppOrigin ?? null,
  });
  registerTrainingLinkReviewRoutes(app, client, {
    enabled: options.trainingLinkReviewEnabled === true,
    resolvePersonAuth: options.resolvePersonAuth ?? (memberPilotAuth.enabled ? memberPilotAuth.resolvePerson : async () => null),
    resolveAuthorization: authorizationResolver,
    allowedOrigin: options.memberAppOrigin ?? null,
  });
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
    const context = await authorizationResolver(request);
    if (!context) return reply.code(401).send({ error: 'authentication_required' });
    if (!can(context, 'calendar.read')) return reply.code(403).send({ error: 'permission_denied' });
    const { serviceId } = request.params as { serviceId: string };
    if (!uuid.safeParse(serviceId).success) return reply.code(400).send({ error: 'invalid_service_id' });
    try {
      const [service] = await client`SELECT id,status FROM services WHERE id=${serviceId}`;
      if (!service) return reply.code(404).send({ error: 'service_not_found' });
      if (service.status === 'archived') return reply.code(409).send({ error: 'service_archived' });
      const plans = await listPlans(client, serviceId);
      if (can(context, 'catalog.pricing.manage')) return plans;
      return plans.map((plan) => {
        const { basePriceCents: _hiddenPrice, ...safePlan } = plan as typeof plan & { basePriceCents?: number | null };
        return safePlan;
      });
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
      rightType: right.rightType, trainingAccessLevel:right.trainingAccessLevel??null, serviceId: right.serviceId ?? null, quotaScope: right.quotaScope ?? null,
      quantity: right.quantity ?? null, period: right.period ?? null, periodMode: right.periodMode ?? null,
      weeklyFrequency: right.weeklyFrequency ?? null, quantityRule: right.quantityRule ?? null,
      timezone: right.rightType === 'period_quota' && right.period !== 'plan_period' ? timezone : null,
      validDays: right.validDays ?? null, validDaysStartRule: right.validDaysStartRule ?? null,
    })).sort((a, b) => compareCodeUnits(JSON.stringify(a), JSON.stringify(b)));
    const body = { ...parsed.data, serviceIds, rights: parsed.data.rights };
    const canonicalBody = {
      name: body.name, serviceIds: body.serviceIds, kind: body.kind, renewalCadence: body.renewalCadence ?? null, periodDays: body.periodDays ?? null,
        rights: canonicalRights, basePriceCents: body.basePriceCents ?? null,
      modules: [...body.modules].map((item) => ({ ...item, capabilities: [...item.capabilities].sort(compareCodeUnits) })).sort((a,b) => compareCodeUnits(a.module,b.module)),
    };
    const contract=normalizePlanContract(body);
    if(contract.termKind!==null)Object.assign(canonicalBody,{termKind:contract.termKind,termMonths:contract.termMonths,maxSpanDays:contract.maxSpanDays,paymentRule:contract.paymentRule,paymentBlock:contract.paymentBlock});
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
        await tx`INSERT INTO plan_versions(plan_id,version,kind,renewal_cadence,period_days,timezone,base_price_cents,term_kind,term_months,max_span_days,payment_rule,payment_block) VALUES (${plan.id},1,${body.kind},${body.renewalCadence ?? null},${body.periodDays ?? null},${timezone},${body.basePriceCents ?? null},${contract.termKind},${contract.termMonths},${contract.maxSpanDays},${contract.paymentRule},${contract.paymentBlock})`;
        await tx`INSERT INTO plan_services(plan_id,plan_version,service_id) SELECT ${plan.id},1,id FROM services WHERE id IN ${tx(body.serviceIds)}`;
        for (const right of body.rights) {
          await tx`INSERT INTO plan_rights(plan_id,plan_version,right_type,training_access_level,service_id,quota_scope,quantity,weekly_frequency,quantity_rule,period,period_mode,timezone,valid_days,valid_days_start_rule) VALUES (${plan.id},1,${right.rightType},${right.trainingAccessLevel??null},${right.serviceId ?? null},${right.quotaScope ?? null},${right.quantity ?? null},${right.weeklyFrequency ?? null},${right.quantityRule??null},${right.period ?? null},${right.periodMode ?? null},${right.rightType === 'period_quota' && right.period !== 'plan_period' ? timezone : null},${right.validDays ?? null},${right.validDaysStartRule ?? null})`;
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
    const canonical={...body,serviceIds,modules:[...body.modules].map(item=>({...item,capabilities:[...item.capabilities].sort(compareCodeUnits)})).sort((a,b)=>compareCodeUnits(a.module,b.module)),rights:[...body.rights].map(right=>({...right,trainingAccessLevel:right.trainingAccessLevel??null,serviceId:right.serviceId??null,quantityRule:right.quantityRule??null})).sort((a,b)=>compareCodeUnits(JSON.stringify(a),JSON.stringify(b)))};
    const contract=normalizePlanContract(body);if(contract.termKind!==null)Object.assign(canonical,{termKind:contract.termKind,termMonths:contract.termMonths,maxSpanDays:contract.maxSpanDays,paymentRule:contract.paymentRule,paymentBlock:contract.paymentBlock});
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
        await tx`INSERT INTO plan_versions(plan_id,version,kind,renewal_cadence,period_days,timezone,base_price_cents,term_kind,term_months,max_span_days,payment_rule,payment_block) VALUES (${plan.id},${version},${body.kind},${body.renewalCadence??null},${body.periodDays??null},${timezone},${body.basePriceCents??null},${contract.termKind},${contract.termMonths},${contract.maxSpanDays},${contract.paymentRule},${contract.paymentBlock})`;
        await tx`INSERT INTO plan_services(plan_id,plan_version,service_id) SELECT ${plan.id},${version},id FROM services WHERE id IN ${tx(serviceIds)}`;
        for(const right of body.rights)await tx`INSERT INTO plan_rights(plan_id,plan_version,right_type,training_access_level,service_id,quota_scope,quantity,weekly_frequency,quantity_rule,period,period_mode,timezone,valid_days,valid_days_start_rule) VALUES (${plan.id},${version},${right.rightType},${right.trainingAccessLevel??null},${right.serviceId??null},${right.quotaScope??null},${right.quantity??null},${right.weeklyFrequency??null},${right.quantityRule??null},${right.period??null},${right.periodMode??null},${right.rightType==='period_quota'&&right.period!=='plan_period'?timezone:null},${right.validDays??null},${right.validDaysStartRule??null})`;
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

function normalizePlanContract(plan: {termKind?:string|null|undefined;termMonths?:number|null|undefined;maxSpanDays?:number|null|undefined;paymentRule?:string|null|undefined;paymentBlock?:string|null|undefined}) {
  const termKind=plan.termKind??null;
  if(termKind===null)return{termKind:null,termMonths:null,maxSpanDays:null,paymentRule:null,paymentBlock:null};
  const paymentRule=termKind==='natural_month'?'monthly_day10_v1':['pack','one_off'].includes(termKind)?'on_payment_v1':'grace_from_assignment_v1';
  const paymentBlock=['pack','one_off'].includes(termKind)?'off':plan.paymentBlock??'enforce';
  return{termKind,termMonths:plan.termMonths??null,maxSpanDays:plan.maxSpanDays??null,paymentRule,paymentBlock};
}

async function listPlans(client: SqlClient, serviceId: string) {
  const plans = await client`SELECT p.id,p.name,p.status,p.current_version AS "currentVersion",v.kind,v.renewal_cadence AS "renewalCadence",v.period_days AS "periodDays",v.base_price_cents AS "basePriceCents",v.term_kind AS "termKind",v.term_months AS "termMonths",v.max_span_days AS "maxSpanDays",v.payment_rule AS "paymentRule",v.payment_block AS "paymentBlock" FROM plan_services ps JOIN plans p ON p.id=ps.plan_id AND p.current_version=ps.plan_version JOIN plan_versions v ON v.plan_id=p.id AND v.version=p.current_version WHERE ps.service_id=${serviceId} AND p.status <> 'archived' ORDER BY lower(p.name),p.id`;
  return Promise.all(plans.map(async (plan) => {
    const services = await client`SELECT s.id,s.name,a.name AS area FROM plan_services ps JOIN services s ON s.id=ps.service_id JOIN areas a ON a.id=s.area_id WHERE ps.plan_id=${plan.id} AND ps.plan_version=${plan.currentVersion} ORDER BY lower(s.name),s.id`;
    const rights = await client`SELECT id,right_type AS "rightType",training_access_level AS "trainingAccessLevel",service_id AS "serviceId",quota_scope AS "quotaScope",quantity,weekly_frequency AS "weeklyFrequency",quantity_rule AS "quantityRule",period,period_mode AS "periodMode",timezone,valid_days AS "validDays",valid_days_start_rule AS "validDaysStartRule" FROM plan_rights WHERE plan_id=${plan.id} AND plan_version=${plan.currentVersion} ORDER BY right_type,service_id NULLS FIRST,id`;
    const modules = await client`SELECT m.module,m.access_level AS "accessLevel",COALESCE((SELECT jsonb_agg(c.capability ORDER BY c.capability) FROM plan_module_capabilities c WHERE c.plan_id=m.plan_id AND c.plan_version=m.plan_version AND c.module=m.module),'[]'::jsonb) AS capabilities FROM plan_module_accesses m WHERE m.plan_id=${plan.id} AND m.plan_version=${plan.currentVersion} ORDER BY m.module`;
    return { ...plan, services, rights, modules };
  }));
}

async function getPlan(client: SqlClient, planId: string) { return (await listPlansById(client, planId))[0] ?? null; }
async function listPlansById(client: SqlClient, planId: string) {
  const rows = await client`SELECT id,name,status,current_version AS "currentVersion" FROM plans WHERE id=${planId}`;
  if (!rows[0]) return [];
  const plan = rows[0];
  const versionRows = await client`SELECT kind,renewal_cadence AS "renewalCadence",period_days AS "periodDays",base_price_cents AS "basePriceCents",term_kind AS "termKind",term_months AS "termMonths",max_span_days AS "maxSpanDays",payment_rule AS "paymentRule",payment_block AS "paymentBlock" FROM plan_versions WHERE plan_id=${planId} AND version=${plan.currentVersion}`;
  const services = await client`SELECT s.id,s.name,a.name AS area FROM plan_services ps JOIN services s ON s.id=ps.service_id JOIN areas a ON a.id=s.area_id WHERE ps.plan_id=${planId} AND ps.plan_version=${plan.currentVersion} ORDER BY lower(s.name),s.id`;
  const rights = await client`SELECT id,right_type AS "rightType",training_access_level AS "trainingAccessLevel",service_id AS "serviceId",quota_scope AS "quotaScope",quantity,weekly_frequency AS "weeklyFrequency",quantity_rule AS "quantityRule",period,period_mode AS "periodMode",timezone,valid_days AS "validDays",valid_days_start_rule AS "validDaysStartRule" FROM plan_rights WHERE plan_id=${planId} AND plan_version=${plan.currentVersion} ORDER BY right_type,service_id NULLS FIRST,id`;
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
    trainingServiceCallsEnabled: process.env.TRAINING_SERVICE_CALLS_ENABLED === 'true',
    trainingSummaryEnabled: process.env.TRAINING_SUMMARY_ENABLED === 'true',
    trainingVerifiedLinkingEnabled: process.env.TRAINING_VERIFIED_LINKING_ENABLED === 'true',
    trainingCanonicalLinkingEnabled: process.env.TRAINING_CANONICAL_LINKING_ENABLED === 'true',
    platformPasskeysEnabled: process.env.PLATFORM_PASSKEYS_ENABLED === 'true',
    trustedProxies: (process.env.PLATFORM_TRUSTED_PROXIES ?? '').split(',').map(value => value.trim()).filter(Boolean),
    platformPasskeyRpId: process.env.PLATFORM_PASSKEY_RP_ID ?? null,
    trainingLinkLifecycleEnabled: process.env.TRAINING_LINK_LIFECYCLE_ENABLED === 'true',
    trainingProvisioningEnabled: process.env.TRAINING_PROVISIONING_ENABLED === 'true',
    trainingSignalsEnabled: process.env.TRAINING_SIGNALS_ENABLED === 'true',
    ...(Number.isInteger(Number(process.env.TRAINING_SIGNALS_INTERVAL_MS)) && Number(process.env.TRAINING_SIGNALS_INTERVAL_MS) >= 100 ? { trainingSignalsIntervalMs: Number(process.env.TRAINING_SIGNALS_INTERVAL_MS) } : {}),
    trainingServiceAllowInsecureLoopback: process.env.TRAINING_SERVICE_ALLOW_INSECURE_LOOPBACK === 'true',
    trainingSsoEnabled: process.env.TRAINING_SSO_ENABLED === 'true',
    trainingSsoRedirectUrl: process.env.TRAINING_SSO_REDIRECT_URL ?? null,
    memberAppOrigin: process.env.MEMBER_APP_ORIGIN ?? null,
    ...(localDemoClientId ? { clientAuthorizationResolver: async () => ({ clientId: localDemoClientId.toLowerCase() }) } : {}),
  });
  await app.listen({ host, port: Number(process.env.PORT ?? 3100) });
}
