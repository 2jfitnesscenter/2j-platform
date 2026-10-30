import { apiFetch } from './api-fetch.js';
import React from 'react';

const api = import.meta.env?.VITE_API_URL ?? 'http://localhost:3100';
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), char => char.charCodeAt(0)).buffer;
const encode = (value: ArrayBuffer) => {
  const bytes = new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};
async function jsonPost<T>(path: string, body: unknown): Promise<T> {
  const response = await apiFetch(api + path, { method: 'POST', credentials: 'include', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'login_unavailable');
  return result as T;
}
export function StaffLogin() {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const enabled = typeof window !== 'undefined' && 'PublicKeyCredential' in window && Boolean(navigator.credentials?.get);
  const login = async () => {
    setBusy(true); setError('');
    try {
      if (!enabled) throw new Error('Este dispositivo no admite passkeys.');
      const ceremony = await jsonPost<{ challengeId: string; options: Record<string, unknown> & { challenge: string; allowCredentials?: Array<Record<string, unknown> & { id: string }> } }>('/api/staff/auth/passkeys/login/options', {});
      const publicKey = {
        ...ceremony.options,
        challenge: decode(ceremony.options.challenge),
        ...(ceremony.options.allowCredentials ? { allowCredentials: ceremony.options.allowCredentials.map(item => ({ ...item, id: decode(item.id) })) } : {}),
      } as unknown as PublicKeyCredentialRequestOptions;
      const credential = await navigator.credentials.get({ publicKey }) as PublicKeyCredential | null;
      if (!credential) throw new Error('No se completó la verificación.');
      const assertion = credential.response as AuthenticatorAssertionResponse;
      await jsonPost('/api/staff/auth/passkeys/login/verify', {
        challengeId: ceremony.challengeId,
        response: {
          id: credential.id,
          rawId: encode(credential.rawId),
          type: credential.type,
          response: {
            authenticatorData: encode(assertion.authenticatorData),
            clientDataJSON: encode(assertion.clientDataJSON),
            signature: encode(assertion.signature),
            ...(assertion.userHandle ? { userHandle: encode(assertion.userHandle) } : {}),
          },
          clientExtensionResults: credential.getClientExtensionResults(),
        },
      });
      window.location.reload();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      setError(cause instanceof Error && cause.name === 'NotAllowedError' ? 'No se completó el acceso con passkey.' : message === 'staff_auth_disabled' ? 'El acceso con passkey aún no está habilitado en este entorno.' : message === 'login_rejected' ? 'No se pudo verificar la passkey vinculada.' : 'No se pudo iniciar sesión. Inténtalo de nuevo.');
    } finally { setBusy(false); }
  };
  return <main className="staff-login" aria-labelledby="staff-login-title">
    <section className="staff-login-card">
      <div className="staff-login-mark" aria-hidden="true">2J</div>
      <p className="staff-login-eyebrow">FITNESS CENTER · OPERACIONES</p>
      <h1 id="staff-login-title">Acceso del equipo</h1>
      <p>Identifícate con la passkey verificada que tienes vinculada a tu cuenta.</p>
      <button type="button" className="staff-login-button" onClick={() => void login()} disabled={busy || !enabled}>
        {busy ? 'Verificando…' : 'Continuar con passkey'}
      </button>
      {!enabled && <p className="staff-login-note" role="status">Este navegador no ofrece acceso con passkey.</p>}
      {error && <p className="staff-login-error" role="alert">{error}</p>}
    </section>
  </main>;
}
