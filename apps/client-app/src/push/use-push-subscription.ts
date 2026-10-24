import React from 'react';
import { disablePush, enablePush, getPushConfig, pushSupport, type PushConfig, type PushEnv, type PushSupport } from './push-client.js';

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

/** Home hook. `available` is false while the server flag is off, so Home can hide the control entirely. */
export function usePushSubscription() {
  const [config, setConfig] = React.useState<PushConfig | null>(null);
  const [support, setSupport] = React.useState<PushSupport>('unsupported');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const refresh = React.useCallback(async () => {
    const env = browserEnv();
    setSupport(pushSupport(env));
    try { setConfig(await getPushConfig(env)); } catch { setConfig({ enabled: false }); }
  }, []);
  React.useEffect(() => { void refresh(); }, [refresh]);
  const run = async (action: (env: PushEnv) => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await action(browserEnv()); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'push_error'); } finally { setBusy(false); }
  };
  return { available: config?.enabled === true, support, config, busy, error, enable: () => run(enablePush), disable: () => run(disablePush) };
}
