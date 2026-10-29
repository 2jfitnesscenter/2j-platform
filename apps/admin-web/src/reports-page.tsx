import React from 'react';
import { Button, Card, CardHeader, EmptyState, Icon, PageHeader, StatusChip, Tabs, icons, type StatusTone } from '@2j/ui';
import { ReportsSummary } from './reports-summary.js';

const apiUrl = import.meta.env?.VITE_API_URL ?? 'http://127.0.0.1:3100';

type SaleRow = { id: string; kind: 'plan' | 'charge' | 'store'; occurredAt: string; clientName: string; concept: string; soldCents: number; collectedCents: number; status: string; methods: string[]; invoice: 'issued' | 'none' };
type Totals = { soldCents: number; collectedCents: number; pendingCents: number; voidedCount: number; voidedCents: number; rowCount: number };
type SalesResponse = { items: SaleRow[]; truncated: boolean; totals: Totals; capabilities: { export: boolean } };
type Filters = { from: string; to: string; q: string; kind: string; method: string; invoice: string };
type LoadState = { status: 'loading' } | { status: 'ready'; data: SalesResponse } | { status: 'denied' } | { status: 'error' };

const canaryDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit' });
const shortDate = new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', day: 'numeric', month: 'short', year: 'numeric' });
const euros = (cents: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const kindLabel: Record<string, string> = { plan: 'Cuota', charge: 'Cargo', store: 'Tienda' };
const methodLabel: Record<string, string> = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', direct_debit: 'Domiciliación', other: 'Otro' };
const statusPresentation: Record<string, { label: string; tone: StatusTone }> = {
  paid: { label: 'Cobrada', tone: 'success' }, partial: { label: 'Cobro parcial', tone: 'warning' }, pending: { label: 'Pendiente', tone: 'info' },
  unpaid: { label: 'Vencida', tone: 'danger' }, refunded: { label: 'Devuelta', tone: 'neutral' }, void: { label: 'Anulada', tone: 'neutral' }, exempt: { label: 'Exenta', tone: 'neutral' },
};

function defaultFilters(): Filters {
  const today = canaryDay.format(new Date());
  return { from: `${today.slice(0, 7)}-01`, to: today, q: '', kind: 'all', method: '', invoice: 'all' };
}
function queryOf(filters: Filters) {
  const params = new URLSearchParams({ from: filters.from, to: filters.to, kind: filters.kind, invoice: filters.invoice, limit: '500' });
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.method) params.set('method', filters.method);
  return params;
}

/**
 * Informes (paridad visual 10, referencia: Reports.jsx de Base44). D108: listado simple de ventas con filtros, vendido frente a cobrado y anuladas
 * diferenciadas, sin gráficos. Solo lectura; no emite facturas (D106).
 */
export function ReportsPage() {
  const [filters, setFilters] = React.useState<Filters>(defaultFilters);
  const [state, setState] = React.useState<LoadState>({ status: 'loading' });
  const [tab, setTab] = React.useState<'sales' | 'summary'>('sales');
  const set = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch }));
  const valid = filters.from !== '' && filters.to !== '' && filters.to >= filters.from;

  const load = React.useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`${apiUrl}/api/reports/sales?${queryOf(filters)}`, signal ? { signal } : undefined);
      if (response.status === 403 || response.status === 401) { setState({ status: 'denied' }); return; }
      if (!response.ok) throw new Error(String(response.status));
      setState({ status: 'ready', data: await response.json() as SalesResponse });
    } catch (caught) { if ((caught as Error).name !== 'AbortError') setState({ status: 'error' }); }
  }, [filters]);

  React.useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void load(controller.signal); }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load, valid]);

  const header = <PageHeader title="Informes" description="Ventas y cobros del periodo, en hora de Canarias. Solo lectura: aquí no se emiten facturas." actions={<Button icon={icons.RefreshCw} onClick={() => { setState({ status: 'loading' }); void load(); }}>Actualizar</Button>} />;
  if (state.status === 'denied') return <main className="summary reports-page" id="reports" data-2j-design="v2">{header}<Card><EmptyState icon={icons.ShieldCheck} title="Tu perfil no puede consultar los informes" role="status">Pide ayuda a una persona con permiso de lectura económica.</EmptyState></Card></main>;

  const data = state.status === 'ready' ? state.data : null;
  const totals = data?.totals;
  const tabs = <Tabs label="Secciones de informes" items={[{ id: 'sales', label: 'Ventas' }, { id: 'summary', label: 'Resumen' }]} value={tab} onChange={(id) => setTab(id as 'sales' | 'summary')} panelId="reports-panel" idPrefix="reports-tab" />;
  if (tab === 'summary') return <main className="summary reports-page" id="reports" data-2j-design="v2">{header}{tabs}<div role="tabpanel" id="reports-panel" aria-labelledby="reports-tab-summary"><ReportsSummary /></div></main>;
  return <main className="summary reports-page" id="reports" data-2j-design="v2">
    {header}
    {tabs}
    <ul className="summary-metrics" aria-label="Totales del periodo">
      {[['Vendido', totals ? euros(totals.soldCents) : '—', 'Sin anuladas ni exentas'], ['Cobrado', totals ? euros(totals.collectedCents) : '—', 'Neto de devoluciones'], ['Pendiente de cobro', totals ? euros(totals.pendingCents) : '—', 'Vendido menos cobrado'], ['Anuladas', totals ? String(totals.voidedCount) : '—', totals ? `${euros(totals.voidedCents)} fuera del vendido` : 'Importe fuera del vendido']].map(([label, value, detail]) =>
        <li key={label}><Card padding="none" className="summary-metric"><div className="summary-metric-body"><span className="summary-metric-label">{label}</span><strong className="summary-metric-value">{value}</strong><span className="summary-metric-detail">{detail}</span></div></Card></li>)}
    </ul>
    <Card as="section" padding="none" className="summary-card" aria-labelledby="reports-list-title">
      <div className="summary-card-head"><CardHeader title="Ventas" titleId="reports-list-title" level={2} description="Cuotas, cargos y ventas de tienda, del más reciente al más antiguo."
        actions={data?.capabilities.export ? <a className="button secondary" href={`${apiUrl}/api/reports/sales.csv?${queryOf(filters)}`} download>Exportar CSV</a> : null} /></div>
      <form className="reports-filters" aria-label="Filtros del informe" onSubmit={(event) => event.preventDefault()}>
        <label>Desde<input type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => set({ from: event.target.value })} /></label>
        <label>Hasta<input type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => set({ to: event.target.value })} /></label>
        <label>Cliente o concepto<input type="search" value={filters.q} maxLength={80} placeholder="Buscar…" onChange={(event) => set({ q: event.target.value })} /></label>
        <label>Tipo<select value={filters.kind} onChange={(event) => set({ kind: event.target.value })}><option value="all">Todos</option><option value="plan">Cuotas</option><option value="charge">Cargos</option><option value="store">Tienda</option></select></label>
        <label>Método de pago<select value={filters.method} onChange={(event) => set({ method: event.target.value })}><option value="">Todos</option>{Object.entries(methodLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Factura<select value={filters.invoice} onChange={(event) => set({ invoice: event.target.value })}><option value="all">Todas</option><option value="with">Con factura</option><option value="without">Sin factura</option></select></label>
      </form>
      {!valid && <div className="form-error" role="alert">La fecha final no puede ser anterior a la inicial.</div>}
      {valid && state.status === 'loading' && <div className="summary-state" role="status"><span className="spinner" /> Cargando el informe…</div>}
      {valid && state.status === 'error' && <div className="summary-state summary-error" role="alert"><strong>No se pudo cargar el informe</strong><Button onClick={() => { setState({ status: 'loading' }); void load(); }}>Reintentar</Button></div>}
      {valid && data && (data.items.length === 0
        ? <div className="summary-empty"><span className="summary-empty-icon"><Icon icon={icons.ReceiptText} size={24} /></span><strong>Sin ventas en este periodo</strong><span>Cambia las fechas o quita algún filtro.</span></div>
        : <div className="reports-table-wrap"><table className="reports-table"><caption className="sr-only">Ventas del periodo</caption>
          <thead><tr><th scope="col">Fecha</th><th scope="col">Cliente</th><th scope="col">Concepto</th><th scope="col">Tipo</th><th scope="col" className="is-number">Vendido</th><th scope="col" className="is-number">Cobrado</th><th scope="col">Estado</th><th scope="col">Método</th><th scope="col">Factura</th></tr></thead>
          <tbody>{data.items.map((item) => { const presentation = statusPresentation[item.status] ?? { label: item.status, tone: 'neutral' as StatusTone }; const voided = item.status === 'void'; return <tr key={item.id} className={voided ? 'is-voided' : undefined}>
            <th scope="row">{shortDate.format(new Date(item.occurredAt))}</th><td>{item.clientName}</td><td>{item.concept}</td><td>{kindLabel[item.kind] ?? item.kind}</td>
            <td className="is-number">{euros(item.soldCents)}</td><td className="is-number">{euros(item.collectedCents)}</td>
            <td><StatusChip tone={presentation.tone} icon={null}>{presentation.label}</StatusChip></td>
            <td>{item.methods.map((method) => methodLabel[method] ?? method).join(' + ') || '—'}</td><td>{item.invoice === 'issued' ? 'Con factura' : 'Sin factura'}</td></tr>; })}</tbody></table></div>)}
      {data?.truncated && <p className="reports-note" role="status">Se muestran las 500 ventas más recientes del periodo; acota las fechas o los filtros para ver el resto.</p>}
    </Card>
  </main>;
}
