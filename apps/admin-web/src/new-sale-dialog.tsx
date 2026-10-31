import * as React from 'react';
import { Button, icons } from '@2j/ui';
import { apiFetch } from './api-fetch.js';
import { Modal } from './modal.js';
import { ShiftNotice, useShift } from './shift-notice.js';

const api = import.meta.env?.VITE_API_URL ?? 'http://localhost:3100';

type Plan = { id: string; name: string; basePriceCents: number | null };
type Variant = { id: string; label: string; priceCents: number; active: boolean; stockTracked: boolean; stock: number | null };
type Product = { id: string; name: string; category: string; active: boolean; variants: Variant[] };
type PlanLine = { key: string; kind: 'plan'; planId: string; name: string; basePriceCents: number | null; price: string; reason: string; startsOn: string };
type ProductLine = { key: string; kind: 'product'; variantId: string; name: string; priceCents: number; quantity: number; stock: number | null };
type Line = PlanLine | ProductLine;
type Done = { chargeId?: string | undefined; invoiced?: boolean };

/** Métodos del cobro. Bizum se registra como «otro» (el API no distingue Bizum de otros métodos). */
const METHODS = [['cash', 'Efectivo'], ['other', 'Bizum'], ['transfer', 'Transferencia']] as const;
const RECENTS_KEY = '2j-new-sale-recents';
const euro = (cents: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const toCents = (value: string) => { const match = /^\d{1,7}(?:[.,]\d{1,2})?$/.exec(value.trim()); return match ? Math.round(Number(value.trim().replace(',', '.')) * 100) : null; };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Atlantic/Canary' });
const uuid = () => globalThis.crypto?.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
function readRecents(): string[] { try { return JSON.parse(window.localStorage.getItem(RECENTS_KEY) ?? '[]') as string[]; } catch { return []; } }
function writeRecents(ids: string[]) { try { window.localStorage.setItem(RECENTS_KEY, JSON.stringify([...new Set([...ids, ...readRecents()])].slice(0, 12))); } catch { /* sin almacenamiento: no pasa nada */ } }

export type NewSaleCapabilities = { assignPlans?: boolean; collectPayments?: boolean; manageCatalogPrice?: boolean };
type Props = { clientId: string; clientName: string; capabilities: NewSaleCapabilities; onClose: () => void; onDone: () => void };

/**
 * «Nueva venta» (A73): cuotas y productos en un solo carrito, sin salir de la ficha. Reutiliza los endpoints existentes
 * (`POST /api/clients/:id/plans`, `POST /api/admin/store/sales`, `POST /api/economics/charges/:id/invoice`); no repite ninguna regla:
 * precios, stock, permisos y caja (D113) los decide el API. Cada línea lleva su propia clave de idempotencia, así que reintentar
 * tras un fallo nunca duplica lo que ya se registró.
 */
export function NewSaleDialog({ clientId, clientName, capabilities, onClose, onDone }: Props) {
  const shift = useShift();
  const [tab, setTab] = React.useState<'plans' | 'products'>('plans');
  const [query, setQuery] = React.useState('');
  const [plans, setPlans] = React.useState<Plan[] | null>(null);
  const [products, setProducts] = React.useState<Product[] | null>(null);
  const [igic, setIgic] = React.useState<number | null>(null);
  const [lines, setLines] = React.useState<Line[]>([]);
  const [step, setStep] = React.useState<'cart' | 'confirm' | 'done'>('cart');
  const [method, setMethod] = React.useState<'cash' | 'other' | 'transfer'>('cash');
  const [pending, setPending] = React.useState(false);
  const [asInvoice, setAsInvoice] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [lineErrors, setLineErrors] = React.useState<Record<string, string>>({});
  const [done, setDone] = React.useState<Record<string, Done>>({});
  const [documentNotice, setDocumentNotice] = React.useState('');
  const keys = React.useRef(new Map<string, { fingerprint: string; key: string }>());
  const registered = React.useRef(false);
  /** La ficha se recarga al cerrar (no antes): recargar con el diálogo abierto borraría la pantalla de resultado. */
  const finish = () => { if (registered.current) onDone(); onClose(); };
  const recents = React.useMemo(() => readRecents(), []);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [plansResponse, storeResponse, settingsResponse] = await Promise.all([
        apiFetch(`${api}/api/plans/assignable`).catch(() => null), apiFetch(`${api}/api/admin/store`).catch(() => null), apiFetch(`${api}/api/economics/invoice-settings`).catch(() => null),
      ]);
      if (cancelled) return;
      const planList = plansResponse?.ok ? await plansResponse.json() as Plan[] : [];
      const storeBody = storeResponse?.ok ? await storeResponse.json() as { products: Product[] } : null;
      const settings = settingsResponse?.ok ? await settingsResponse.json() as { defaultIgicBasisPoints?: number } : null;
      if (cancelled) return;
      setPlans(plansResponse?.ok && capabilities.assignPlans ? planList : []);
      setProducts(storeBody ? storeBody.products.filter((product) => product.active) : []);
      setIgic(settings?.defaultIgicBasisPoints ?? null);
      if (!(plansResponse?.ok && capabilities.assignPlans) && storeBody) setTab('products');
    })();
    return () => { cancelled = true; };
  }, [capabilities.assignPlans]);

  const ready = plans !== null && products !== null;
  const rank = (id: string) => { const index = recents.indexOf(id); return index < 0 ? 999 : index; };
  const needle = query.trim().toLocaleLowerCase('es');
  const visiblePlans = (plans ?? []).filter((plan) => !needle || plan.name.toLocaleLowerCase('es').includes(needle)).sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name, 'es'));
  const visibleProducts = (products ?? []).map((product) => ({ ...product, variants: product.variants.filter((variant) => variant.active && (!needle || `${product.name} ${variant.label}`.toLocaleLowerCase('es').includes(needle))) }))
    .filter((product) => product.variants.length > 0).sort((a, b) => Math.min(...a.variants.map((v) => rank(v.id))) - Math.min(...b.variants.map((v) => rank(v.id))) || a.name.localeCompare(b.name, 'es'));

  const planCents = (line: PlanLine) => toCents(line.price);
  const lineCents = (line: Line) => line.kind === 'plan' ? (planCents(line) ?? 0) : line.priceCents * line.quantity;
  const total = lines.reduce((sum, line) => sum + lineCents(line), 0);
  const planLines = lines.filter((line): line is PlanLine => line.kind === 'plan');
  const productLines = lines.filter((line): line is ProductLine => line.kind === 'product');
  const paying = !pending && total > 0;

  const addPlan = (plan: Plan) => {
    if (plan.basePriceCents == null && !capabilities.manageCatalogPrice) { setError('Este plan necesita un precio base configurado por Administración antes de poder venderse.'); return; }
    setError(''); setLines((current) => [...current, { key: uuid(), kind: 'plan', planId: plan.id, name: plan.name, basePriceCents: plan.basePriceCents, price: plan.basePriceCents == null ? '' : (plan.basePriceCents / 100).toFixed(2), reason: '', startsOn: today() }]);
  };
  const addVariant = (product: Product, variant: Variant) => {
    setError('');
    setLines((current) => {
      const existing = current.find((line): line is ProductLine => line.kind === 'product' && line.variantId === variant.id);
      if (existing) return current.map((line) => line === existing ? { ...existing, quantity: Math.min(existing.quantity + 1, existing.stock ?? 1000) } : line);
      return [...current, { key: uuid(), kind: 'product', variantId: variant.id, name: `${product.name} · ${variant.label}`, priceCents: variant.priceCents, quantity: 1, stock: variant.stockTracked ? variant.stock : null }];
    });
  };
  const patch = (key: string, change: Partial<PlanLine> | Partial<ProductLine>) => setLines((current) => current.map((line) => line.key === key ? { ...line, ...change } as Line : line));
  const remove = (key: string) => setLines((current) => current.filter((line) => line.key !== key));

  function cartProblem(): string {
    for (const line of planLines) {
      const cents = planCents(line);
      if (!cents || cents < 1) return `Indica un precio válido para «${line.name}».`;
      if (line.basePriceCents != null && cents !== line.basePriceCents && line.reason.trim().length < 3) return `Explica el descuento o ajuste de «${line.name}».`;
    }
    return '';
  }
  function toConfirm() { const problem = cartProblem(); if (problem) { setError(problem); return; } setError(''); setStep('confirm'); }

  function idempotencyKey(id: string, payload: unknown) {
    const fingerprint = JSON.stringify(payload); const current = keys.current.get(id);
    if (current?.fingerprint === fingerprint) return current.key;
    const key = uuid(); keys.current.set(id, { fingerprint, key }); return key;
  }
  /** Texto claro del rechazo del API. Cadena vacía = el motivo ya se enseña con el aviso de fichar. */
  function failure(code: string | undefined, status: number): string {
    if (code === 'cash_session_required') { if (shift.state !== 'open') { shift.markClosed(); return ''; } return 'Abre la caja antes de cobrar (menú Caja).'; }
    if (code === 'price_override_forbidden') return 'Tu perfil no puede cambiar el precio del plan.';
    if (code === 'adjustment_reason_required') return 'Explica el ajuste del precio.';
    if (code === 'insufficient_stock') return 'No hay stock suficiente de alguno de los productos.';
    if (code === 'cash_session_previous_day_requires_owner_resolution') return 'Hay una caja de un día anterior pendiente de resolución del propietario.';
    if (status === 403 || code === 'permission_denied') return 'Tu perfil no puede registrar esta venta.';
    if (status === 401) return 'Tu sesión ha caducado. Vuelve a entrar.';
    return 'No se pudo registrar. Inténtalo de nuevo; no se duplicará lo ya registrado.';
  }

  async function confirm() {
    if (paying && !capabilities.collectPayments) { setError('Tu perfil no puede registrar cobros. Marca «Dejar pendiente de pago».'); return; }
    setBusy(true); setError(''); setDocumentNotice(''); setLineErrors({});
    const finished: Record<string, Done> = { ...done };
    let failed = false;
    try {
      for (const line of planLines) {
        if (finished[line.key]) continue;
        const amountCents = planCents(line)!;
        const payload = { planId: line.planId, startsOn: line.startsOn, endsOn: null, dueOn: line.startsOn, amountCents, adjustmentReason: line.basePriceCents != null && amountCents !== line.basePriceCents ? line.reason.trim() : null, paymentAmountCents: paying ? amountCents : null, paymentMethod: paying ? method : null };
        const response = await apiFetch(`${api}/api/clients/${clientId}/plans`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey(line.key, { clientId, payload }) }, body: JSON.stringify(payload) });
        const body = await response.json().catch(() => ({})) as { chargeId?: string; error?: string };
        if (!response.ok) { setLineErrors((current) => ({ ...current, [line.key]: failure(body.error, response.status) })); failed = true; break; }
        finished[line.key] = { chargeId: body.chargeId }; writeRecents([line.planId]);
      }
      if (!failed && productLines.length > 0 && !productLines.every((line) => finished[line.key])) {
        const payload = { clientId, lines: productLines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })), paymentState: paying ? 'paid' : 'pending', paymentMethod: paying ? method : null, note: note.trim() };
        const response = await apiFetch(`${api}/api/admin/store/sales`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey('products', payload) }, body: JSON.stringify(payload) });
        const body = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) { const message = failure(body.error, response.status); for (const line of productLines) setLineErrors((current) => ({ ...current, [line.key]: message })); failed = true; }
        else { for (const line of productLines) finished[line.key] = {}; writeRecents(productLines.map((line) => line.variantId)); }
      }
      setDone(finished);
      if (Object.keys(finished).length > 0) registered.current = true;
      if (failed) { setError(shift.state === 'closed' ? '' : 'Algo no se pudo registrar. Lo ya registrado queda guardado; corrige y vuelve a confirmar.'); return; }
      if (paying) {
        let issued = 0; let refused = '';
        for (const line of planLines) {
          const chargeId = finished[line.key]?.chargeId; if (!chargeId || finished[line.key]?.invoiced) continue;
          const response = await apiFetch(`${api}/api/economics/charges/${chargeId}/invoice`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documentType: asInvoice ? 'full_invoice' : 'simplified_ticket' }) });
          if (response.ok) { finished[line.key] = { ...finished[line.key], invoiced: true }; issued += 1; }
          else { const body = await response.json().catch(() => ({})) as { error?: string; missing?: string[] }; refused = body.error === 'issuer_incomplete' ? `Falta configurar los datos de facturación${body.missing?.length ? ` (${body.missing.join(', ')})` : ''}.` : body.error === 'client_data_incomplete' ? 'Faltan datos fiscales del cliente.' : response.status === 403 ? 'Tu perfil no puede emitir facturas.' : 'No se pudo emitir el documento; puedes hacerlo desde Pagos.'; }
        }
        setDone({ ...finished });
        setDocumentNotice(refused ? `La venta está registrada. ${refused}` : issued > 0 ? `${issued === 1 ? 'Documento emitido' : 'Documentos emitidos'} (${asInvoice ? 'factura' : 'ticket'}).` : '');
      }
      setStep('done');
    } catch { setError('No se pudo conectar con el servidor. Lo ya registrado queda guardado; vuelve a confirmar.'); } finally { setBusy(false); }
  }

  const igicText = igic == null ? null : `${(igic / 100).toLocaleString('es-ES', { maximumFractionDigits: 2 })} % de IGIC incluido`;
  return <Modal titleId="new-sale-title" title="Nueva venta" description={`Venta para ${clientName}.`} onClose={finish} closeDisabled={busy} wide>
    {step === 'done' ? <div className="new-sale-done" role="status">
      <p><strong>Venta registrada</strong></p>
      <ul>{lines.map((line) => <li key={line.key}>{line.kind === 'product' ? `${line.quantity} × ` : ''}{line.name} — {euro(lineCents(line))}</li>)}</ul>
      <p>{pending ? 'Queda pendiente de pago.' : `Cobrado: ${euro(total)}.`} {documentNotice}</p>
      <div className="new-sale-actions"><Button variant="primary" onClick={finish}>Cerrar</Button></div>
    </div> : <div className="new-sale">
      {!ready ? <p role="status"><span className="spinner" /> Cargando el catálogo…</p> : <>
        <div className="new-sale-columns">
          <section aria-label="Catálogo" className="new-sale-catalog">
            <div role="tablist" aria-label="Tipo de artículo" className="new-sale-tabs">
              {(plans ?? []).length > 0 || capabilities.assignPlans ? <button type="button" role="tab" aria-selected={tab === 'plans'} onClick={() => setTab('plans')}>Cuotas</button> : null}
              <button type="button" role="tab" aria-selected={tab === 'products'} onClick={() => setTab('products')}>Productos</button>
            </div>
            <label className="new-sale-search">Buscar<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === 'plans' ? 'Nombre de la cuota…' : 'Producto o variante…'} data-modal-initial-focus /></label>
            {tab === 'plans' ? <ul className="new-sale-list" aria-label="Cuotas disponibles">{visiblePlans.length === 0 ? <li className="new-sale-empty">{(plans ?? []).length === 0 ? 'Tu perfil no puede vender cuotas o no hay cuotas activas.' : 'Sin resultados.'}</li> : visiblePlans.map((plan) => <li key={plan.id}>
              <button type="button" onClick={() => addPlan(plan)}><span>{plan.name}</span><strong>{plan.basePriceCents == null ? 'Sin precio' : euro(plan.basePriceCents)}</strong></button></li>)}</ul>
              : <ul className="new-sale-list" aria-label="Productos disponibles">{visibleProducts.length === 0 ? <li className="new-sale-empty">{(products ?? []).length === 0 ? 'Tu perfil no puede vender productos o el catálogo está vacío.' : 'Sin resultados.'}</li> : visibleProducts.map((product) => <li key={product.id}><span className="new-sale-product">{product.name}</span>
                <ul>{product.variants.map((variant) => { const out = variant.stockTracked && (variant.stock ?? 0) < 1; return <li key={variant.id}><button type="button" disabled={out} onClick={() => addVariant(product, variant)}><span>{variant.label}{variant.stockTracked && variant.stock != null ? ` · ${variant.stock} en stock` : ''}</span><strong>{out ? 'Agotado' : euro(variant.priceCents)}</strong></button></li>; })}</ul></li>)}</ul>}
          </section>
          <section aria-label="Carrito" className="new-sale-cart">
            <h3>Carrito</h3>
            {lines.length === 0 ? <p className="new-sale-empty">Elige una cuota o un producto.</p> : <ul>{lines.map((line) => <li key={line.key} className="new-sale-line">
              <div className="new-sale-line-head"><strong>{line.name}</strong><button type="button" className="text-button" aria-label={`Quitar ${line.name}`} disabled={busy || !!done[line.key]} onClick={() => remove(line.key)}>Quitar</button></div>
              {line.kind === 'plan' ? <div className="new-sale-fields">
                <label>Precio (€)<input inputMode="decimal" value={line.price} disabled={!capabilities.manageCatalogPrice || busy || !!done[line.key]} onChange={(event) => patch(line.key, { price: event.target.value })} aria-label={`Precio de ${line.name}`} /></label>
                {capabilities.manageCatalogPrice && line.basePriceCents != null && planCents(line) !== line.basePriceCents ? <label>Motivo del descuento<input value={line.reason} maxLength={240} onChange={(event) => patch(line.key, { reason: event.target.value })} aria-label={`Motivo del descuento de ${line.name}`} /></label> : null}
                <label>Inicio<input type="date" value={line.startsOn} disabled={busy || !!done[line.key]} onChange={(event) => patch(line.key, { startsOn: event.target.value || today() })} aria-label={`Inicio de ${line.name}`} /></label>
              </div> : <div className="new-sale-fields">
                <label>Cantidad<input inputMode="numeric" value={line.quantity} disabled={busy || !!done[line.key]} aria-label={`Cantidad de ${line.name}`} onChange={(event) => { const next = Number(event.target.value.replace(/\D/g, '')) || 1; patch(line.key, { quantity: Math.max(1, Math.min(next, line.stock ?? 1000)) }); }} /></label>
                <span>{euro(line.priceCents)} × {line.quantity}</span>
              </div>}
              <p className="new-sale-line-total">{euro(lineCents(line))}{done[line.key] ? ' · registrado' : ''}</p>
              {lineErrors[line.key] ? <p className="new-sale-error" role="alert">{lineErrors[line.key]}</p> : null}
            </li>)}</ul>}
            <p className="new-sale-total" aria-live="polite">Total <strong>{euro(total)}</strong>{igicText ? <small> · {igicText}</small> : null}</p>
          </section>
        </div>
        {step === 'confirm' ? <section className="new-sale-confirm" aria-label="Confirmar el cobro">
          <h3>Confirmar</h3>
          {paying ? <ShiftNotice action="cobrar" shift={shift} /> : null}
          <label className="new-sale-check"><input type="checkbox" checked={pending} onChange={(event) => setPending(event.target.checked)} disabled={busy} /> Dejar pendiente de pago</label>
          {!pending ? <>
            <label>Método<select value={method} onChange={(event) => setMethod(event.target.value as typeof method)} disabled={busy}>{METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            {planLines.length > 0 ? <label className="new-sale-check"><input type="checkbox" checked={asInvoice} onChange={(event) => setAsInvoice(event.target.checked)} disabled={busy} /> Emitir factura <small>(sin marcar se emite un ticket)</small></label> : null}
          </> : null}
          {productLines.length > 0 ? <label>Nota interna de la venta de productos<input value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} disabled={busy} /></label> : null}
          <p className="new-sale-muted">Descuentos de productos, notas en factura y renovación automática de la cuota aún no están conectados.</p>
        </section> : null}
        {error ? <p className="new-sale-error" role="alert">{error}</p> : null}
        <div className="new-sale-actions">
          <Button type="button" variant="ghost" onClick={step === 'confirm' ? () => setStep('cart') : finish} disabled={busy}>{step === 'confirm' ? 'Volver' : 'Cancelar'}</Button>
          {step === 'cart' ? <Button type="button" variant="primary" icon={icons.Check} disabled={lines.length === 0 || total < 1} onClick={toConfirm}>Cobrar {total > 0 ? euro(total) : ''}</Button>
            : <Button type="button" variant="primary" loading={busy} onClick={() => void confirm()}>{pending ? 'Registrar venta pendiente' : `Confirmar cobro de ${euro(total)}`}</Button>}
        </div>
      </>}
    </div>}
  </Modal>;
}
