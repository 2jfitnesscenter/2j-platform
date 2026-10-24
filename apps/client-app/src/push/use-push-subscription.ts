import React from 'react';
import { disablePush, enablePush, getPushConfig, pushSupport, removePushDevice, type PushConfig, type PushEnv, type PushSupport } from './push-client.js';

const browserEnv = (): PushEnv => {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const userAgent = nav?.userAgent ?? '';
  return {
    fetch: (input, init) => fetch(input, init),
    ...(nav && 'serviceWorker' in nav ? { serviceWorker: nav.serviceWorker as unknown as NonNullable<PushEnv['serviceWorker']> } : {}),
    ...(typeof Notification === 'undefined' ? {} : { Notification: Notification as unknown as NonNullable<PushEnv['Notification']> }),
    hasPushManager: typeof window !== 'undefined' && 'PushManager' in window,
    isIos: /iphone|ipad|ipod/i.test(userAgent),
    isStandalone: typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches === true || (navigator as unknown as { standalone?: boolean }).standalone === true),
    userAgent,
  };
};

/** Home hook. Runs only for a signed-in, non-preview member; the server flag remains authoritative. */
export function usePushSubscription(enabled: boolean) {
  const [config, setConfig] = React.useState<PushConfig | null>(null);
  const [support, setSupport] = React.useState<PushSupport>('unsupported');
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const refresh = React.useCallback(async () => {
    const env = browserEnv();
    const nextSupport = pushSupport(env);
    setSupport(nextSupport);
    if (!enabled || nextSupport !== 'supported') { setConfig(null); setError(null); return; }
    setLoading(true);
    try { setConfig(await getPushConfig(env)); setError(null); }
    catch (cause) { setConfig(null); setError(cause instanceof Error ? cause.message : 'push_error'); }
    finally { setLoading(false); }
  }, [enabled]);
  React.useEffect(() => { void refresh(); }, [refresh]);
  const run = async (action: (env: PushEnv) => Promise<unknown>) => {
    if (!enabled) return;
    setBusy(true); setError(null);
    try { await action(browserEnv()); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'push_error'); } finally { setBusy(false); }
  };
  const removeDevice = async () => {
    if (!enabled) return true;
    setBusy(true); setError(null);
    try { await removePushDevice(browserEnv()); await refresh(); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'push_error'); return false; }
    finally { setBusy(false); }
  };
  return { available: config?.enabled === true, support, config, loading, busy, error, refresh, enable: () => run(enablePush), disable: () => run(disablePush), removeDevice };
}
