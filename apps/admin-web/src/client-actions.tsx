import * as React from 'react';
import { Button, icons } from '@2j/ui';
import { apiFetch } from './api-fetch.js';
import { Modal } from './modal.js';
import { ShiftNotice, useShift } from './shift-notice.js';

const api = import.meta.env?.VITE_API_URL ?? 'http://localhost:3100';
const euro = (cents: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const uuid = () => globalThis.crypto?.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });

export type ActionItem = { id: string; label: string; href?: string; onSelect?: () => void; disabled?: boolean; hint?: string | undefined; tone?: 'danger' | undefined };

/** Menú «Acciones» de la ficha: se cierra con Escape, con un clic fuera o al elegir; las opciones sin permiso no aparecen. */
export function ActionsMenu({ items }: { items: ActionItem[] }) {
  const [open, setOpen] = React.useState(false);
  const root = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', escape); };
  }, [open]);
  if (items.length === 0) return null;
  return <div className="client-actions-menu" ref={root}>
    <Button icon={icons.ChevronDown} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>Acciones</Button>
    {open ? <ul role="menu" aria-label="Acciones del cliente">{items.map((item) => <li key={item.id} role="none">
      {item.href && !item.disabled
        ? <a role="menuitem" href={item.href} onClick={() => setOpen(false)}>{item.label}</a>
        : <button type="button" role="menuitem" disabled={item.disabled} className={item.tone === 'danger' ? 'is-danger' : undefined} onClick={() => { setOpen(false); item.onSelect?.(); }}>{item.label}{item.hint ? <small>{item.hint}</small> : null}</button>}
    </li>)}</ul> : null}
  </div>;
}

type Charge = { id: string; concept: string; balanceCents: number; dueOn: string; status: string };
/**
 * Cargo pendiente más antiguo (el primero que vence): es el que cobra el botón «Registrar pago» de la cabecera.
 * Solo cuentan los cargos cobrables (pendiente o vencido): el API también devuelve saldo en cargos anulados o exentos.
 */
export function firstPendingCharge(charges: Charge[] | undefined): Charge | null {
  return [...(charges ?? [])].filter((charge) => Number(charge.balanceCents) > 0 && (charge.status === 'pending' || charge.status === 'unpaid')).sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0] ?? null;
}

const METHODS = [['cash', 'Efectivo'], ['bizum', 'Bizum'], ['transfer', 'Transferencia']] as const;
/** Registrar pago (D250): importe pendiente precargado + método + confirmar. D113: sin turno, aviso guiado de A70. */
export function RegisterPaymentDialog({ charge, onClose, onDone }: { charge: Charge; onClose: () => void; onDone: () => void }) {
  const shift = useShift();
  const [method, setMethod] = React.useState<'cash' | 'bizum' | 'transfer'>('cash');
  const [amount, setAmount] = React.useState((Number(charge.balanceCents) / 100).toFixed(2));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const key = React.useRef<{ fingerprint: string; key: string } | null>(null);
  const cents = /^\d{1,7}(?:[.,]\d{1,2})?$/.test(amount.trim()) ? Math.round(Number(amount.trim().replace(',', '.')) * 100) : null;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!cents || cents < 1) { setError('Indica un importe válido.'); return; }
    if (cents > Number(charge.balanceCents)) { setError('El importe supera el saldo pendiente.'); return; }
    const payload = { chargeId: charge.id, splits: [{ method, amountCents: cents }] };
    const fingerprint = JSON.stringify(payload);
    if (key.current?.fingerprint !== fingerprint) key.current = { fingerprint, key: uuid() };
    setBusy(true); setError('');
    try {
      const response = await apiFetch(`${api}/api/economics/payments`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key.current.key }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        // Con turno cerrado se enseña el aviso de fichar; con turno abierto (o una cuenta que no ficha) lo que falta es abrir la caja.
        if (body.error === 'cash_session_required') { if (await shift.refresh() === 'closed') return; setError('Abre la caja antes de registrar cobros.'); return; }
        if (body.error === 'clock_in_required' || body.error === 'cash_custodian_not_clocked_in') { shift.markClosed(); return; }
        setError(body.error === 'amount_exceeds_balance' ? 'El importe supera el saldo pendiente.' : response.status === 403 ? 'Tu perfil no puede registrar cobros.' : 'No se pudo registrar el pago.');
        return;
      }
      onDone();
    } catch { setError('No se pudo conectar con el servidor.'); } finally { setBusy(false); }
  }
  return <Modal titleId="client-payment-title" title="Registrar pago" description={`${charge.concept} · pendiente ${euro(Number(charge.balanceCents))}`} onClose={onClose} closeDisabled={busy}>
    <form onSubmit={(event) => void submit(event)} className="client-payment-form">
      <ShiftNotice action="cobrar" shift={shift} />
      <label>Importe (€)<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={busy} data-modal-initial-focus /></label>
      <label>Método<select value={method} onChange={(event) => setMethod(event.target.value as typeof method)} disabled={busy}>{METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {error ? <p className="new-sale-error" role="alert">{error}</p> : null}
      <div className="new-sale-actions"><Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button><Button type="submit" variant="primary" loading={busy}>Confirmar pago</Button></div>
    </form>
  </Modal>;
}
