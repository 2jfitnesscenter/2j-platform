import React from 'react';
import { Button, Card, EmptyState, PageHeader, icons } from '@2j/ui';
import { apiFetch } from './api-fetch.js';

const apiUrl = import.meta.env?.VITE_API_URL ?? 'http://127.0.0.1:3100';
const loopbackHosts = ['127.0.0.1', 'localhost', '[::1]'];

/** Fixed Bunker admin address for this build (https, or loopback http for local runs). Empty means the link is not configured. */
export function resolveBunkerAdminUrl(configured: unknown): string {
  if (typeof configured !== 'string' || !configured) return '';
  try {
    const url = new URL(configured);
    const safe = (url.protocol === 'https:' || (url.protocol === 'http:' && loopbackHosts.includes(url.hostname))) && !url.username && !url.password;
    return safe ? url.origin : '';
  } catch { return ''; }
}
export const BUNKER_ADMIN_START_PATH = '/api/platform/v1/staff-sso/start';
export const bunkerAdminRuntime = { navigate: (url: string) => window.location.assign(url) };
export const bunkerAdminConfig = { url: resolveBunkerAdminUrl(import.meta.env?.VITE_2J_BUNKER_ADMIN_URL) };

/** `#bunker?sso_challenge=<43 url-safe characters>`: what Bunker puts in the address when it sends the browser back after starting the flow. */
export function bunkerChallengeFromHash(hash: string): string | null {
  const match = /^#bunker\?sso_challenge=([A-Za-z0-9_-]{43})$/.exec(hash);
  return match ? match[1]! : null;
}
/** Only the fixed Bunker origin is followed; anything else the API might return is ignored. */
export function bunkerDestination(redirectUrl: unknown, bunkerUrl: string): string | null {
  if (typeof redirectUrl !== 'string' || !bunkerUrl) return null;
  try { const target = new URL(redirectUrl); return target.origin === bunkerUrl && target.search === '' && /^#code=[A-Za-z0-9_-]{43,128}$/.test(target.hash) ? target.toString() : null; } catch { return null; }
}
const messages: Record<string, string> = {
  permission_denied: 'Tu perfil no tiene acceso a Búnker.',
  authentication_required: 'Tu sesión ha caducado. Vuelve a entrar en Platform.',
  bunker_sso_disabled: 'El acceso único a Búnker está desactivado en este entorno.',
  bunker_sso_not_configured: 'El acceso único a Búnker no está configurado en este entorno.',
  bunker_sso_rate_limited: 'Demasiados intentos seguidos. Espera un minuto.',
};

/**
 * Entry to the Bunker admin. Platform proves who the staff member is (single sign-on, no second password); this page holds no Bunker logic.
 * Step 1 leaves for Bunker's start page, which keeps a secret in its own cookie and returns here with only that secret's SHA-256.
 * Step 2 asks Platform for a one-time handoff bound to that value and follows only the validated Bunker address.
 */
export function BunkerPage() {
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const started = React.useRef(false);
  const open = () => {
    if (busy) return;
    if (!bunkerAdminConfig.url) { setMessage('La dirección de Búnker no está configurada en este entorno.'); return; }
    setBusy(true); setMessage('');
    bunkerAdminRuntime.navigate(`${bunkerAdminConfig.url}${BUNKER_ADMIN_START_PATH}`);
  };
  React.useEffect(() => {
    const challenge = bunkerChallengeFromHash(window.location.hash);
    if (!challenge || started.current) return;
    started.current = true;
    setBusy(true);
    void (async () => {
      try {
        const response = await apiFetch(`${apiUrl}/api/staff/bunker/sso`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challenge }), cache: 'no-store' });
        const body = await response.json().catch(() => ({})) as { redirectUrl?: string; error?: string };
        if (!response.ok) { setMessage(messages[body.error ?? ''] ?? 'No se pudo abrir Búnker. Inténtalo de nuevo.'); window.location.hash = '#bunker'; setBusy(false); return; }
        const destination = bunkerDestination(body.redirectUrl, bunkerAdminConfig.url);
        if (!destination) { setMessage('No se pudo abrir Búnker. Inténtalo de nuevo.'); window.location.hash = '#bunker'; setBusy(false); return; }
        bunkerAdminRuntime.navigate(destination);
      } catch { setMessage('No se pudo abrir Búnker. Inténtalo de nuevo.'); setBusy(false); }
    })();
  }, []);
  return <main className="summary bunker-page" id="bunker" data-2j-design="v2">
    <PageHeader title="Búnker" description="Administración de entrenamiento. Entras con tu sesión de Platform, sin otra contraseña." />
    <Card>
      <EmptyState icon={icons.ShieldCheck} title="Abrir la administración de Búnker">
        Platform comprueba tu perfil y te pasa a Búnker con un acceso de un solo uso (caduca en 60 segundos).
        <div><Button variant="primary" disabled={busy} onClick={open}>{busy ? 'Abriendo…' : 'Abrir Búnker'}</Button></div>
      </EmptyState>
      {message && <p role="alert" className="summary-state summary-error">{message}</p>}
    </Card>
  </main>;
}
