import { z } from 'zod';
import type { createDatabase } from './db.js';
import type { TrainingServiceClient } from './training-link-flow.js';

type DB = ReturnType<typeof createDatabase>['client'];

/** Signed Platform -> Training signal (2J-CAPABILITY-SIGNAL-V1). Restrict-only: it can impose a suspension or make Training ask again, never grant. */
export const TRAINING_SIGNAL_PATH = '/api/platform/v1/signals';
const ack = z.object({ v: z.literal(1), status: z.enum(['applied', 'ignored']), signalId: z.string().uuid(), reason: z.string().max(40).optional() }).strict();

const DEFAULT_INTERVAL_MS = 1_000;
const MAX_BACKOFF_S = 300;
/** A signal nobody could deliver for this long is abandoned: by then the 60 s capability cache has long since delivered the same fact. */
const DEFAULT_MAX_AGE_MS = 24 * 3_600_000;
const BATCH = 20;

export type TrainingSignalOptions = {
  client: TrainingServiceClient;
  enabled: boolean;
  intervalMs?: number;
  maxAgeMs?: number;
  /** Operational alert (the operator should look): called at most once per kind per five minutes. */
  onAlert?: (kind: string, detail: Record<string, unknown>) => void;
  logger?: { warn?: (...args: any[]) => void; error?: (...args: any[]) => void } | undefined;
};

type Delivery = { seq: string | number; eventId: string; personId: string; kind: 'suspended' | 'lifted'; signalId: string; attempts: number; createdAt: Date; occurredAt: Date };

/**
 * Delivers suspension / lift events from `platform_training_access_events` (the source of truth, written by the existing admin routes) to Training.
 *
 *  - Nothing existing changes: the dispatcher only READS the event table and keeps its own delivery bookkeeping. Off, it does nothing at all.
 *  - At-least-once and idempotent: every event gets one delivery row; Training orders signals per person by `sequence` (the delivery `seq`) and ignores repeats.
 *  - Durable: a Platform restart resumes pending deliveries. Only events from the moment the dispatcher was first enabled are considered.
 *  - Per person only the latest matters: an older undelivered signal is superseded by a newer one rather than sent after it.
 *  - Failure never matters for correctness: the 60 s capability cache keeps converging on Platform's answer; signals just make it faster.
 */
export function createTrainingSignalDispatcher(db: DB, options: TrainingSignalOptions) {
  const intervalMs = Math.max(100, options.intervalMs ?? DEFAULT_INTERVAL_MS), maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const lastAlert = new Map<string, number>();
  const alert = (kind: string, detail: Record<string, unknown>) => {
    const at = Date.now();
    if (at - (lastAlert.get(kind) ?? -Infinity) < 5 * 60_000) return;
    lastAlert.set(kind, at);
    try { (options.onAlert ?? ((k, d) => options.logger?.warn?.({ alert: k, ...d }, 'training signal alert')))(kind, detail); } catch { /* alerts never break delivery */ }
  };
  let timer: ReturnType<typeof setInterval> | null = null, running = false;

  async function enqueue() {
    await db`INSERT INTO platform_training_signal_state(singleton,enabled_since) VALUES (true,now()) ON CONFLICT (singleton) DO NOTHING`;
    await db`INSERT INTO platform_training_signal_deliveries(event_id,person_id,kind)
      SELECT e.id,e.person_id,e.action FROM platform_training_access_events e, platform_training_signal_state s
      WHERE e.occurred_at>=s.enabled_since AND NOT EXISTS (SELECT 1 FROM platform_training_signal_deliveries d WHERE d.event_id=e.id)
      ORDER BY e.occurred_at,e.id`;
  }

  /** Claims due deliveries by pushing their next attempt into the future (a lease), so two workers never send the same one. */
  async function claim(): Promise<Delivery[]> {
    const rows = await db`UPDATE platform_training_signal_deliveries d SET attempts=d.attempts+1,
        next_attempt_at=now()+(least(${MAX_BACKOFF_S}::int, power(2, least(d.attempts, 8))::int) * interval '1 second')
      FROM platform_training_access_events e
      WHERE d.seq IN (SELECT seq FROM platform_training_signal_deliveries WHERE state='pending' AND next_attempt_at<=now() ORDER BY seq FOR UPDATE SKIP LOCKED LIMIT ${BATCH})
        AND e.id=d.event_id
      RETURNING d.seq,d.event_id AS "eventId",d.person_id AS "personId",d.kind,d.signal_id AS "signalId",d.attempts,d.created_at AS "createdAt",e.occurred_at AS "occurredAt"`;
    return (rows as unknown as Delivery[]).sort((a, b) => Number(a.seq) - Number(b.seq));
  }

  const finish = (seq: string | number, state: 'delivered' | 'superseded' | 'abandoned', error: string | null = null) => state === 'delivered'
    ? db`UPDATE platform_training_signal_deliveries SET state='delivered',delivered_at=now(),last_error=NULL WHERE seq=${seq}`
    : db`UPDATE platform_training_signal_deliveries SET state=${state},last_error=${error} WHERE seq=${seq}`;
  const note = (seq: string | number, error: string) => db`UPDATE platform_training_signal_deliveries SET last_error=${error.slice(0, 80)} WHERE seq=${seq}`;

  async function deliverOne(item: Delivery) {
    // A newer event for the same person makes this one moot: only the latest state is worth telling.
    const [newer] = await db`SELECT 1 AS yes FROM platform_training_signal_deliveries WHERE person_id=${item.personId}::uuid AND seq>${item.seq} LIMIT 1`;
    if (newer) return finish(item.seq, 'superseded');
    if (Date.now() - new Date(item.createdAt).getTime() > maxAgeMs) { alert('platform_signal_abandoned', { reason: 'max_age' }); return finish(item.seq, 'abandoned', 'max_age'); }
    const [link] = await db`SELECT training_user_id AS "trainingUserId" FROM training_account_links WHERE person_id=${item.personId}::uuid AND status='active'`;
    if (!link) return finish(item.seq, 'abandoned', 'no_active_link');          // nobody on the Training side to tell
    const result = await options.client.post(TRAINING_SIGNAL_PATH, {
      v: 1, signalId: item.signalId, kind: item.kind, personId: item.personId, trainingUserId: link.trainingUserId,
      sequence: Number(item.seq), occurredAt: new Date(item.occurredAt).toISOString(),
    }, ack);
    if (result.ok) return finish(item.seq, 'delivered');
    const status = result.status;
    if (status === 404) { alert('platform_signal_refused', { status, reason: 'training_has_no_active_link' }); return finish(item.seq, 'abandoned', 'training_link_not_found'); }
    if (status === 423 || status === 401 || status === 403) alert('platform_signal_not_accepted', { status });
    else if (status === 'unavailable') alert('platform_signal_training_unreachable', {});
    return note(item.seq, `retry_${String(status)}`);        // stays pending; the lease already pushed the next attempt back
  }

  /** One pass: pick up new events, deliver what is due. Never throws. Exposed for tests and for a one-shot manual run. */
  async function tick(): Promise<{ delivered: number; pending: number }> {
    if (!options.enabled || !options.client.enabled) return { delivered: 0, pending: 0 };
    if (running) return { delivered: 0, pending: 0 };
    running = true;
    try {
      await enqueue();
      const due = await claim();
      let delivered = 0;
      for (const item of due) {
        try { await deliverOne(item); } catch (error) { options.logger?.error?.({ errorCode: typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : 'unknown' }, 'training signal delivery failed'); }
      }
      const [{ n }] = await db`SELECT count(*)::int AS n FROM platform_training_signal_deliveries WHERE state='delivered' AND delivered_at>now()-interval '1 minute'` as unknown as [{ n: number }];
      delivered = n;
      const [{ pending }] = await db`SELECT count(*)::int AS pending FROM platform_training_signal_deliveries WHERE state='pending'` as unknown as [{ pending: number }];
      return { delivered, pending };
    } catch (error) {
      options.logger?.error?.({ errorCode: typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : 'unknown' }, 'training signal tick failed');
      return { delivered: 0, pending: -1 };
    } finally { running = false; }
  }

  return {
    enabled: options.enabled && options.client.enabled,
    tick,
    start() { if (!timer && options.enabled && options.client.enabled) { timer = setInterval(() => { void tick(); }, intervalMs); timer.unref?.(); } },
    stop() { if (timer) { clearInterval(timer); timer = null; } },
    /** How far behind the dispatcher is: for a health probe or an alert (`oldestPendingSeconds` growing means Training is not receiving signals). */
    async status() {
      const [row] = await db`SELECT count(*) FILTER (WHERE state='pending')::int AS pending, COALESCE(EXTRACT(EPOCH FROM (now()-min(created_at) FILTER (WHERE state='pending')))::int,0) AS "oldestPendingSeconds" FROM platform_training_signal_deliveries` as unknown as [{ pending: number; oldestPendingSeconds: number }];
      return row;
    },
  };
}
