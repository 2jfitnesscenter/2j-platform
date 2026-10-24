// Home side of Web Push. Pure functions with injected browser APIs so they are testable without a browser; `use-push-subscription.ts` is the React wrapper.
// Nothing here runs by itself: Home decides when to call it, only when the server says push is enabled (flag), and always after an explicit tap.

export type PushConfig = { enabled: false } | { enabled: true; vapidPublicKey: string; consent: 'granted' | 'revoked' | 'unset'; activeDevices: number };
export type PushSupport = 'supported' | 'unsupported' | 'needs-install' | 'denied';
type SubscriptionLike = { endpoint: string; toJSON(): { endpoint?: string; keys?: { p256dh?: string; auth?: string } }; unsubscribe(): Promise<boolean> };
type PushManagerLike = { getSubscription(): Promise<SubscriptionLike | null>; subscribe(options: { userVisibleOnly: true; applicationServerKey: Uint8Array }): Promise<SubscriptionLike> };
export type PushEnv = {
  fetch: (input: string, init: { method: string; credentials: 'include'; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  serviceWorker?: { ready: Promise<{ pushManager: PushManagerLike }> };
  Notification?: { permission: string; requestPermission(): Promise<string> };
  hasPushManager: boolean;
  /** iOS only delivers web push to a PWA added to the home screen (16.4+). */
  isIos: boolean;
  isStandalone: boolean;
  userAgent?: string;
};

export function urlBase64ToUint8Array(value: string): Uint8Array {
  const padded = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
}

export function pushSupport(env: PushEnv): PushSupport {
  if (env.isIos && !env.isStandalone) return 'needs-install';
  if (!env.serviceWorker || !env.hasPushManager || !env.Notification) return 'unsupported';
  return env.Notification.permission === 'denied' ? 'denied' : 'supported';
}

async function call(env: PushEnv, method: string, path: string, body?: unknown) {
  const response = await env.fetch(path, { method, credentials: 'include', headers: body === undefined ? {} : { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error((json as { error?: string }).error ?? `http_${response.status}`), { status: response.status });
  return json as Record<string, unknown>;
}

export const getPushConfig = async (env: PushEnv): Promise<PushConfig> => (await call(env, 'GET', '/api/me/push/config')) as unknown as PushConfig;

/** Turn notifications on for THIS device: ask the center, ask the browser, record consent, subscribe, tell Platform. Never throws for user-visible refusals. */
export async function enablePush(env: PushEnv): Promise<'enabled' | PushSupport | 'disabled-by-center'> {
  const support = pushSupport(env);
  if (support !== 'supported') return support;
  const config = await getPushConfig(env);
  if (!config.enabled) return 'disabled-by-center';
  const permission = await env.Notification!.requestPermission();          // must follow a user gesture
  if (permission !== 'granted') return 'denied';
  await call(env, 'PUT', '/api/me/push/consent', { granted: true });
  const registration = await env.serviceWorker!.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey) });
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('invalid_subscription');
  await call(env, 'POST', '/api/me/push/subscriptions', { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth }, ...(env.userAgent ? { userAgent: env.userAgent.slice(0, 300) } : {}) });
  return 'enabled';
}

/** Turn notifications off: withdraw consent on the server (switches every device off) and drop this browser subscription. */
export async function disablePush(env: PushEnv): Promise<void> {
  await call(env, 'PUT', '/api/me/push/consent', { granted: false });
  const registration = await env.serviceWorker?.ready;
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) await subscription.unsubscribe();
}

/** Remove only this browser from the signed-in person before logout; consent on other devices stays intact. */
export async function removePushDevice(env: PushEnv): Promise<void> {
  const registration = await env.serviceWorker?.ready;
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  const endpoint = subscription.toJSON().endpoint ?? subscription.endpoint;
  try { await call(env, 'DELETE', '/api/me/push/subscriptions', { endpoint }); }
  catch (error) {
    // When the Platform flag is off, it rejects all push routes. Unsubscribe locally so this device stops receiving pushes.
    if ((error as { status?: number }).status !== 423) throw error;
  }
  await subscription.unsubscribe();
}
