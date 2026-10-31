import * as React from 'react';
import { apiFetch } from './api-fetch.js';

const api = import.meta.env?.VITE_API_URL ?? 'http://127.0.0.1:3100';

/** `unavailable`: la cuenta no ficha (sin ficha de equipo o sin permiso); en ese caso no se muestra ningún aviso. */
export type ShiftState = 'loading' | 'open' | 'closed' | 'unavailable';
export type ShiftAction = 'abrir la caja' | 'cobrar' | 'cerrar la caja';
/** Códigos del API que significan «falta fichar la entrada» (apertura, cierre y cobro). */
export const SHIFT_REQUIRED_CODES = ['clock_in_required', 'cash_custodian_not_clocked_in'] as const;

/** Estado del turno de quien está usando el panel y la acción de fichar sin salir de la pantalla. */
export function useShift() {
  const [state, setState] = React.useState<ShiftState>('loading');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const refresh = React.useCallback(async () => {
    try {
      const response = await apiFetch(`${api}/api/timeclock/self`);
      if (!response.ok) { setState('unavailable'); return; }
      const data = await response.json() as { openShift?: unknown };
      setState(data.openShift ? 'open' : 'closed');
    } catch { setState('unavailable'); }
  }, []);
  React.useEffect(() => { void refresh(); }, [refresh]);
  const clockIn = React.useCallback(async () => {
    setBusy(true); setError('');
    try {
      const response = await apiFetch(`${api}/api/timeclock/clock-in`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ origin: 'web' }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok && body.error !== 'shift_already_open') throw new Error('No se pudo fichar. Inténtalo desde Fichaje.');
      setState('open');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No se pudo fichar.'); } finally { setBusy(false); }
  }, []);
  /** El API acaba de rechazar una acción por no haber turno: se muestra el aviso aunque la lectura previa dijera otra cosa. */
  const markClosed = React.useCallback(() => setState('closed'), []);
  return { state, busy, error, clockIn, refresh, markClosed };
}

/** Aviso guiado: dice el motivo, ofrece la solución y deja al usuario donde estaba (el diálogo y lo escrito no se tocan). */
export function ShiftNotice({ action, shift }: { action: ShiftAction; shift: ReturnType<typeof useShift> }) {
  if (shift.state !== 'closed') return null;
  return <div className="shift-notice" role="status">
    <p><strong>Para {action} primero tienes que fichar la entrada</strong></p>
    <button type="button" className="button primary" disabled={shift.busy} onClick={() => void shift.clockIn()}>{shift.busy ? 'Fichando…' : 'Fichar entrada ahora'}</button>
    {shift.error && <p className="shift-notice-error" role="alert">{shift.error}</p>}
  </div>;
}
