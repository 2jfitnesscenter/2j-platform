import webpush from 'web-push';
import type { PushProvider, PushSendResult } from './push.js';

/** Web Push (RFC 8030/8291/8292, VAPID). No third party sees the content beyond the browser's own push service; works on Android (Chrome, Firefox, Edge) and on iOS 16.4+ for a PWA added to the home screen. */
export function createWebPushProvider(config: { publicKey: string; privateKey: string; subject: string }): PushProvider {
  if (!/^(mailto:|https:\/\/)/.test(config.subject)) throw new Error('PUSH_VAPID_SUBJECT must be a mailto: or https: URL');
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  return {
    async send(subscription, payload, options): Promise<PushSendResult> {
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: subscription.keys },
          JSON.stringify({ title: payload.title, body: payload.body, url: payload.url, kind: payload.kind, tag: payload.tag, lang: 'es', silent: true }),
          { TTL: options.ttlSeconds, urgency: 'normal', timeout: 10_000 });
        return { ok: true };
      } catch (error) {
        const status = typeof (error as { statusCode?: unknown }).statusCode === 'number' ? (error as { statusCode: number }).statusCode : null;
        if (status === 404 || status === 410) return { ok: false, status, code: `http_${status}`, gone: true, retryable: false };
        const retryable = status === null || status === 429 || status >= 500;
        return { ok: false, status, code: status === null ? 'network' : `http_${status}`, gone: false, retryable };
      }
    },
  };
}

export const generateVapidKeys = () => webpush.generateVAPIDKeys();
