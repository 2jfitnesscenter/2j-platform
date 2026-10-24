import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { createDatabase } from './db.js';
import type { ClientAuthorizationContext } from './communications.js';

type DB = ReturnType<typeof createDatabase>['client'];
/** Either the pool or a transaction handle: modules enqueue INSIDE their own transaction so the push and the business event commit together. */
type Sql = Pick<DB, 'unsafe'> & ((strings: TemplateStringsArray, ...values: any[]) => PromiseLike<any>);

/**
 * Push kinds the product has approved, each with a FIXED generic Spanish text (owner decision: lock-screen text carries no names, amounts or health data).
 * A module never supplies text: it names a kind and, where the text counts something, an integer. So a push can only ever say what is written here.
 *   essential  service messages the member cannot switch off (D38): they still need a device subscription.
 *   regular    need the member's current push consent.
 * Deliberately ABSENT (the owner decided "no push"): booking confirmation (D187), publication of an evaluation (D25), reactivation of a suspended
 * waiting-list request (D209), a protected-absence notice (D206), any health data.
 */
export type PushParams = { count?: number; recovered?: number; notRecovered?: number };
type Template = { category: 'essential' | 'regular'; url: string; title: string; body: (params: PushParams) => string };
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
export const PUSH_TEMPLATES = Object.freeze({
  // D199 (+ D211: one grouped push when overlapping waits were cancelled by the new place)
  'waitlist.promoted': { category: 'essential', url: '/reservas', title: 'Reserva confirmada', body: ({ count = 0 }) => count > 0 ? `Se te ha asignado una plaza. Se ${plural(count, 'ha cancelado 1 espera', `han cancelado ${count} esperas`)} que se solapaban.` : 'Se te ha asignado una plaza desde la lista de espera.' },
  // D209: one push per event (not per request, review #47)
  'waitlist.suspended': { category: 'essential', url: '/reservas', title: 'Espera suspendida', body: () => 'Una de tus esperas se ha suspendido. Revisa tus reservas.' },
  // D176/D248: one grouped push, only when something was cancelled
  'booking.cancelled_by_membership': { category: 'essential', url: '/reservas', title: 'Reservas canceladas', body: ({ count = 0 }) => `Se ${plural(count, 'ha cancelado 1 reserva', `han cancelado ${count} reservas`)} por un cambio en tu cuota.` },
  // D255: one grouped push with the result
  'booking.recovered': { category: 'essential', url: '/reservas', title: 'Reservas actualizadas', body: ({ recovered = 0, notRecovered = 0 }) => `Se ${plural(recovered, 'ha recuperado 1 reserva', `han recuperado ${recovered} reservas`)} y ${notRecovered} no ${plural(notRecovered, 'ha podido recuperarse', 'han podido recuperarse')}.` },
  // D152
  'document.requested': { category: 'regular', url: '/perfil', title: 'Documento solicitado', body: () => 'El centro te ha pedido un documento. Entra en tu perfil para entregarlo.' },
  'document.rejected': { category: 'regular', url: '/perfil', title: 'Documento rechazado', body: () => 'Un documento entregado necesita revisión. Entra en tu perfil.' },
} as const satisfies Record<string, Template>);
export type PushKind = keyof typeof PUSH_TEMPLATES;
export const PUSH_KINDS = Object.freeze(Object.fromEntries(Object.entries(PUSH_TEMPLATES).map(([kind, template]) => [kind, template.category])) as Record<PushKind, 'essential' | 'regular'>);

export type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };
export type PushSendResult = { ok: true } | { ok: false; status: number | null; code: string; gone: boolean; retryable: boolean };
/** The only thing that knows about a push service. Web Push (VAPID) today; FCM/APNs behind the same interface when a native shell exists. */
export interface PushProvider {
  send(subscription: PushSubscriptionInput, payload: { title: string; body: string; url: string | null; kind: string; tag: string }, options: { ttlSeconds: number }): Promise<PushSendResult>;
}

export class PushIntentError extends Error { constructor(readonly code: string) { super(code); } }

export type PushIntentInput = { personId: string; kind: PushKind; dedupeKey: string; params?: PushParams; expiresInMinutes?: number };

/**
 * THE API Platform modules call. Idempotent per (person, dedupeKey): a retried business transaction cannot push twice. Pass the module's own
 * transaction as `sql` so the intent exists if and only if the business change committed. Returns whether a new intent was created.
 * Nothing is sent here: delivery is the dispatcher's job and happens only when PUSH_ENABLED is on.
 */
export async function enqueuePushIntent(sql: Sql, input: PushIntentInput): Promise<{ created: boolean; intentId: string }> {
  const template = (PUSH_TEMPLATES as Record<string, Template>)[input.kind];
  if (!template || !Object.hasOwn(PUSH_TEMPLATES, input.kind)) throw new PushIntentError('unknown_push_kind');
  if (!/^[0-9a-f-]{36}$/i.test(input.personId)) throw new PushIntentError('invalid_person');
  const params = input.params ?? {};
  for (const [key, value] of Object.entries(params)) if (!['count', 'recovered', 'notRecovered'].includes(key) || !Number.isInteger(value) || (value as number) < 0 || (value as number) > 999) throw new PushIntentError('invalid_params');
  if (!input.dedupeKey || input.dedupeKey.length > 200) throw new PushIntentError('invalid_dedupe_key');
  const minutes = Math.min(Math.max(Math.trunc(input.expiresInMinutes ?? 24 * 60), 1), 7 * 24 * 60);
  const [row] = await sql`
    INSERT INTO platform_push_intents(person_id,kind,category,dedupe_key,title,body,url,expires_at)
    VALUES (${input.personId}::uuid,${input.kind},${template.category},${input.dedupeKey},${template.title},${template.body(params)},${template.url},now()+${minutes}*interval '1 minute')
    ON CONFLICT (person_id,dedupe_key) DO NOTHING RETURNING id`;
  if (row) return { created: true, intentId: String(row.id) };
  const [existing] = await sql`SELECT id FROM platform_push_intents WHERE person_id=${input.personId}::uuid AND dedupe_key=${input.dedupeKey}`;
  return { created: false, intentId: String(existing.id) };
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const DEFAULT_INTERVAL_MS = 2_000;
const RETRY_DELAY_S = 60;
const MAX_ATTEMPTS = 2;                // E14: one retry
const LEASE_S = 300;

export type PushServiceOptions = { enabled: boolean; provider?: PushProvider | null; vapidPublicKey?: string | null; intervalMs?: number; retryDelaySeconds?: number; logger?: { warn?: (...a: any[]) => void; error?: (...a: any[]) => void } | undefined };

export function createPushService(db: DB, options: PushServiceOptions) {
  const enabled = options.enabled && Boolean(options.provider);
  const retryDelay = options.retryDelaySeconds ?? RETRY_DELAY_S;
  let timer: ReturnType<typeof setInterval> | null = null, running = false;

  async function consentOf(sql: Sql, personId: string): Promise<'granted' | 'revoked' | 'unset'> {
    const [row] = await sql`SELECT action FROM platform_push_consent_events WHERE person_id=${personId}::uuid ORDER BY occurred_at DESC,id DESC LIMIT 1`;
    return row ? (row.action as 'granted' | 'revoked') : 'unset';
  }

  async function setConsent(personId: string, granted: boolean) {
    return db.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`push-consent:${personId}`}))`;
      const current = await consentOf(tx as unknown as Sql, personId);
      if ((current === 'granted') !== granted || current === 'unset') await tx`INSERT INTO platform_push_consent_events(person_id,action) VALUES (${personId}::uuid,${granted ? 'granted' : 'revoked'})`;
      // Withdrawing consent switches every device off at once; the person can subscribe again after granting.
      if (!granted) await tx`UPDATE platform_push_subscriptions SET status='revoked' WHERE person_id=${personId}::uuid AND status='active'`;
      return granted ? 'granted' as const : 'revoked' as const;
    });
  }

  async function subscribe(personId: string, input: PushSubscriptionInput, userAgent: string | null) {
    if (await consentOf(db as unknown as Sql, personId) !== 'granted') throw new PushIntentError('push_consent_required');
    const hash = sha256(input.endpoint);
    const [row] = await db`
      INSERT INTO platform_push_subscriptions(person_id,endpoint,endpoint_hash,p256dh,auth,user_agent)
      VALUES (${personId}::uuid,${input.endpoint},${hash},${input.keys.p256dh},${input.keys.auth},${userAgent})
      ON CONFLICT (endpoint_hash) DO UPDATE SET person_id=EXCLUDED.person_id, p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth, user_agent=EXCLUDED.user_agent,
        status='active', invalidated_reason=NULL, last_seen_at=now()
      RETURNING id`;
    return String(row!.id);
  }

  async function unsubscribe(personId: string, endpoint: string) {
    const rows = await db`UPDATE platform_push_subscriptions SET status='revoked' WHERE person_id=${personId}::uuid AND endpoint_hash=${sha256(endpoint)} AND status='active' RETURNING id`;
    return rows.length > 0;
  }

  async function claim(limit: number) {
    return await db`
      UPDATE platform_push_intents SET attempts=attempts+1, next_attempt_at=now()+${LEASE_S}*interval '1 second'
      WHERE id IN (SELECT id FROM platform_push_intents WHERE status='pending' AND next_attempt_at<=now() ORDER BY created_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
      RETURNING id, person_id AS "personId", kind, category, title, body, url, attempts, expires_at<=now() AS expired`;
  }

  const finish = (id: string, status: string) => db`UPDATE platform_push_intents SET status=${status}, finished_at=now() WHERE id=${id}::uuid`;

  async function deliver(intent: any) {
    if (intent.expired) return finish(intent.id, 'expired');
    if (intent.category === 'regular' && await consentOf(db as unknown as Sql, intent.personId) !== 'granted') return finish(intent.id, 'skipped_no_consent');
    // A retry only goes to devices that did not already receive it.
    const [{ delivered }] = await db`SELECT count(*)::int AS delivered FROM platform_push_deliveries WHERE intent_id=${intent.id}::uuid AND status='sent'` as unknown as [{ delivered: number }];
    const subs = await db`SELECT s.id, s.endpoint, s.p256dh, s.auth FROM platform_push_subscriptions s WHERE s.person_id=${intent.personId}::uuid AND s.status='active'
      AND NOT EXISTS (SELECT 1 FROM platform_push_deliveries d WHERE d.intent_id=${intent.id}::uuid AND d.subscription_id=s.id AND d.status='sent') ORDER BY s.created_at`;
    if (!subs.length) return finish(intent.id, delivered > 0 ? 'sent' : 'skipped_no_subscription');
    let sent = 0, retry = 0, gone = 0, failed = 0;
    for (const sub of subs) {
      let result: PushSendResult;
      try {
        result = await options.provider!.send({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          { title: intent.title, body: intent.body, url: intent.url, kind: intent.kind, tag: intent.id }, { ttlSeconds: 3600 });
      } catch { result = { ok: false, status: null, code: 'provider_exception', gone: false, retryable: true }; }
      const status = result.ok ? 'sent' : result.gone ? 'gone' : result.retryable && intent.attempts < MAX_ATTEMPTS ? 'retry' : 'failed';
      await db`INSERT INTO platform_push_deliveries(intent_id,subscription_id,attempt,status,http_status,error_code) VALUES (${intent.id}::uuid,${sub.id}::uuid,${intent.attempts},${status},${result.ok ? 201 : result.status},${result.ok ? null : result.code.slice(0, 40)})`;
      if (result.ok) { sent += 1; await db`UPDATE platform_push_subscriptions SET last_success_at=now() WHERE id=${sub.id}::uuid`; }
      else if (result.gone) { gone += 1; await db`UPDATE platform_push_subscriptions SET status='invalid', invalidated_reason=${result.code.slice(0, 40)}, last_failure_at=now() WHERE id=${sub.id}::uuid`; }   // E14: dead tokens are discarded
      else { if (status === 'retry') retry += 1; else failed += 1; await db`UPDATE platform_push_subscriptions SET last_failure_at=now() WHERE id=${sub.id}::uuid`; }
    }
    if (retry > 0) return db`UPDATE platform_push_intents SET next_attempt_at=now()+${retryDelay}*interval '1 second' WHERE id=${intent.id}::uuid`;
    if (sent > 0 || delivered > 0) return finish(intent.id, 'sent');
    return finish(intent.id, gone > 0 && failed === 0 ? 'skipped_no_subscription' : 'failed');
  }

  /** One pass over due intents. Never throws. Exposed for tests and for a one-shot manual run. */
  async function dispatch(limit = 20): Promise<{ processed: number }> {
    if (!enabled || running) return { processed: 0 };
    running = true;
    try {
      const due = await claim(limit);
      for (const intent of due) {
        try { await deliver(intent); } catch (error) { options.logger?.error?.({ errorCode: typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : 'unknown' }, 'push delivery failed'); }
      }
      return { processed: due.length };
    } catch (error) {
      options.logger?.error?.({ errorCode: typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : 'unknown' }, 'push dispatch failed');
      return { processed: 0 };
    } finally { running = false; }
  }

  return {
    enabled, consentOf: (personId: string) => consentOf(db as unknown as Sql, personId), setConsent, subscribe, unsubscribe, dispatch,
    publicKey: options.vapidPublicKey ?? null,
    start() { if (!timer && enabled) { timer = setInterval(() => { void dispatch(); }, Math.max(250, options.intervalMs ?? DEFAULT_INTERVAL_MS)); timer.unref?.(); } },
    stop() { if (timer) { clearInterval(timer); timer = null; } },
    async status() {
      const [row] = await db`SELECT count(*) FILTER (WHERE status='pending')::int AS pending, COALESCE(EXTRACT(EPOCH FROM (now()-min(created_at) FILTER (WHERE status='pending')))::int,0) AS "oldestPendingSeconds" FROM platform_push_intents`;
      return row as unknown as { pending: number; oldestPendingSeconds: number };
    },
  };
}
export type PushService = ReturnType<typeof createPushService>;

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2048).refine(value => value.startsWith('https://')),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }).strict(),
  userAgent: z.string().max(300).optional(),
}).strict();

/** Member-facing routes. The person always comes from the authenticated session, never from the body. */
export function registerPushRoutes(app: FastifyInstance, db: DB, resolveClient: (request: FastifyRequest) => Promise<ClientAuthorizationContext | null>, push: PushService, memberOrigin: string | null) {
  async function member(request: FastifyRequest, reply: any, mutating: boolean) {
    reply.header('Cache-Control', 'no-store');
    if (mutating && memberOrigin && request.headers.origin !== memberOrigin) { reply.code(403).send({ error: 'origin_rejected' }); return null; }
    const actor = await resolveClient(request);
    if (!actor) { reply.code(401).send({ error: 'client_authentication_required' }); return null; }
    const [person] = await db`
      SELECT p.id FROM platform_person_clients pc JOIN platform_persons p ON p.id=pc.person_id AND p.status='active' JOIN clients c ON c.id=pc.client_id AND c.status='active'
      WHERE pc.client_id=${actor.clientId}::uuid AND (${actor.personId ?? null}::uuid IS NULL OR pc.person_id=${actor.personId ?? null}::uuid) LIMIT 1`;
    if (!person) { reply.code(409).send({ error: 'member_identity_unavailable' }); return null; }
    return String(person.id);
  }
  const off = (reply: any) => reply.code(423).send({ error: 'push_disabled' });

  app.get('/api/me/push/config', async (request, reply) => {
    const personId = await member(request, reply, false); if (!personId) return;
    if (!push.enabled) return { enabled: false };
    const [{ n }] = await db`SELECT count(*)::int AS n FROM platform_push_subscriptions WHERE person_id=${personId}::uuid AND status='active'` as unknown as [{ n: number }];
    return { enabled: true, vapidPublicKey: push.publicKey, consent: await push.consentOf(personId), activeDevices: n };
  });
  app.put('/api/me/push/consent', async (request, reply) => {
    const personId = await member(request, reply, true); if (!personId) return;
    if (!push.enabled) return off(reply);
    const parsed = z.object({ granted: z.boolean() }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_push_consent' });
    return { consent: await push.setConsent(personId, parsed.data.granted) };
  });
  app.post('/api/me/push/subscriptions', async (request, reply) => {
    const personId = await member(request, reply, true); if (!personId) return;
    if (!push.enabled) return off(reply);
    const parsed = subscriptionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_push_subscription' });
    try { const id = await push.subscribe(personId, { endpoint: parsed.data.endpoint, keys: parsed.data.keys }, parsed.data.userAgent ?? null); return reply.code(201).send({ id }); }
    catch (error) { if (error instanceof PushIntentError && error.code === 'push_consent_required') return reply.code(409).send({ error: error.code }); throw error; }
  });
  app.delete('/api/me/push/subscriptions', async (request, reply) => {
    const personId = await member(request, reply, true); if (!personId) return;
    if (!push.enabled) return off(reply);
    const parsed = z.object({ endpoint: z.string().max(2048) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_push_subscription' });
    return { removed: await push.unsubscribe(personId, parsed.data.endpoint) };
  });
}
