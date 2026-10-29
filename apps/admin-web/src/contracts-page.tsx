import React from 'react';
import { Button, Card, CardHeader, EmptyState, Icon, PageHeader, StatusChip, icons, type StatusTone } from '@2j/ui';

const apiUrl = import.meta.env?.VITE_API_URL ?? 'http://127.0.0.1:3100';

type Contract = { id: string; clientId: string; clientName: string; planName: string; kind: string; startsOn: string; endsOn: string | null; status: string; paymentState: string | null; dueOn: string | null; amountCents: number | null; balanceCents: number | null; expiringSoon: boolean };
type ContractsResponse = { items: Contract[]; summary: { activeCount: number; expiringSoonCount: number; pendingCents: number | null }; capabilities: { money: boolean; assignPlans: boolean } };
type Filters = { status: string; payment: string; expiring: boolean; q: string };
type LoadState = { status: 'loading' } | { status: 'ready'; data: ContractsResponse } | { status: 'denied' } | { status: 'error' };

const shortDate = new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const euros = (cents: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const day = (value: string | null) => value ? shortDate.format(new Date(`${value}T12:00:00Z`)) : 'Sin caducidad';
const statusPresentation: Record<string, { label: string; tone: StatusTone }> = {
  active: { label: 'Vigente', tone: 'success' }, scheduled: { label: 'Programada', tone: 'info' }, paused: { label: 'Pausada', tone: 'warning' },
  expired: { label: 'Finalizada', tone: 'neutral' }, cancelled: { label: 'Cancelada', tone: 'neutral' },
};
const paymentPresentation: Record<string, { label: string; tone: StatusTone }> = {
  paid: { label: 'Al día', tone: 'success' }, pending: { label: 'Pendiente', tone: 'info' }, unpaid: { label: 'Vencido', tone: 'danger' },
  void: { label: 'Anulado', tone: 'neutral' }, exempt: { label: 'Exento', tone: 'neutral' },
};

/**
 * Contratos (paridad con Contracts.jsx de 2jfit-admin): las cuotas asignadas a clientes, con estado, pago y vencimiento.
 * Solo lectura. Asignar o renovar una cuota se hace desde la ficha del cliente, que es donde viven las reglas de derechos.
 */
export function ContractsPage() {
  const [filters, setFilters] = React.useState<Filters>({ status: 'current', payment: 'all', expiring: false, q: '' });
  const [state, setState] = React.useState<LoadState>({ status: 'loading' });
  const set = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch }));

  const load = React.useCallback(async (signal?: AbortSignal) => {
    const params = new URLSearchParams({ status: filters.status, payment: filters.payment, expiring: filters.expiring ? '1' : '0' });
    if (filters.q.trim()) params.set('q', filters.q.trim());
    try {
      const response = await fetch(`${apiUrl}/api/contracts?${params}`, signal ? { signal } : undefined);
      if (response.status === 403 || response.status === 401) { setState({ status: 'denied' }); return; }
      if (!response.ok) throw new Error(String(response.status));
      setState({ status: 'ready', data: await response.json() as ContractsResponse });
    } catch (caught) { if ((caught as Error).name !== 'AbortError') setState({ status: 'error' }); }
  }, [filters]);

  React.useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void load(controller.signal); }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load]);

  const header = <PageHeader title="Contratos" description="Cuotas asignadas a clientes: vigencia, pago y próximos vencimientos. Para asignar o renovar, abre la ficha del cliente." actions={<Button icon={icons.RefreshCw} onClick={() => { setState({ status: 'loading' }); void load(); }}>Actualizar</Button>} />;
  if (state.status === 'denied') return <main className="summary reports-page" id="contracts" data-2j-design="v2">{header}<Card><EmptyState icon={icons.ShieldCheck} title="Tu perfil no puede consultar los contratos" role="status">Pide ayuda a una persona con permiso para ver cuotas y clientes.</EmptyState></Card></main>;

  const data = state.status === 'ready' ? state.data : null;
  const money = data?.capabilities.money ?? false;
  const tiles: Array<[string, string, string]> = [
    ['Cuotas vigentes', data ? String(data.summary.activeCount) : '—', 'Activas hoy'],
    ['Vencen en 7 días', data ? String(data.summary.expiringSoonCount) : '—', 'Vigentes que terminan esta semana'],
    ...(money ? [['Importe pendiente', data?.summary.pendingCents != null ? euros(data.summary.pendingCents) : '—', 'Cuotas vigentes y programadas'] as [string, string, string]] : []),
  ];
  return <main className="summary reports-page" id="contracts" data-2j-design="v2">
    {header}
    <ul className="summary-metrics" aria-label="Resumen de contratos">
      {tiles.map(([label, value, detail]) => <li key={label}><Card padding="none" className="summary-metric"><div className="summary-metric-body"><span className="summary-metric-label">{label}</span><strong className="summary-metric-value">{value}</strong><span className="summary-metric-detail">{detail}</span></div></Card></li>)}
    </ul>
    <Card as="section" padding="none" className="summary-card" aria-labelledby="contracts-list-title">
      <div className="summary-card-head"><CardHeader title="Contratos" titleId="contracts-list-title" level={2} description="Ordenados por fecha de fin: primero los que antes vencen." /></div>
      <form className="reports-filters" aria-label="Filtros de contratos" onSubmit={(event) => event.preventDefault()}>
        <label>Cliente<input type="search" value={filters.q} maxLength={80} placeholder="Nombre del cliente…" onChange={(event) => set({ q: event.target.value })} /></label>
        <label>Estado<select value={filters.status} onChange={(event) => set({ status: event.target.value })}>
          <option value="current">Vigentes y programadas</option><option value="active">Solo vigentes</option><option value="scheduled">Programadas</option><option value="paused">Pausadas</option><option value="expired">Finalizadas</option><option value="cancelled">Canceladas</option><option value="all">Todas</option></select></label>
        {money && <label>Pago<select value={filters.payment} onChange={(event) => set({ payment: event.target.value })}>
          <option value="all">Todos</option><option value="paid">Al día</option><option value="pending">Pendiente</option><option value="unpaid">Vencido</option></select></label>}
        <label className="contracts-check"><input type="checkbox" checked={filters.expiring} onChange={(event) => set({ expiring: event.target.checked })} />Solo los que vencen en 7 días</label>
      </form>
      {state.status === 'loading' && <div className="summary-state" role="status"><span className="spinner" /> Cargando contratos…</div>}
      {state.status === 'error' && <div className="summary-state summary-error" role="alert"><strong>No se pudieron cargar los contratos</strong><Button onClick={() => { setState({ status: 'loading' }); void load(); }}>Reintentar</Button></div>}
      {data && (data.items.length === 0
        ? <div className="summary-empty"><span className="summary-empty-icon"><Icon icon={icons.FileText} size={24} /></span><strong>Sin contratos con estos filtros</strong><span>Cambia el estado o quita algún filtro.</span></div>
        : <div className="reports-table-wrap"><table className="reports-table"><caption className="sr-only">Contratos</caption>
          <thead><tr><th scope="col">Cliente</th><th scope="col">Cuota</th><th scope="col">Inicio</th><th scope="col">Fin</th><th scope="col">Estado</th>{money && <th scope="col">Pago</th>}{money && <th scope="col" className="is-number">Pendiente</th>}</tr></thead>
          <tbody>{data.items.map((item) => { const status = statusPresentation[item.status] ?? { label: item.status, tone: 'neutral' as StatusTone }; const pay = item.paymentState ? paymentPresentation[item.paymentState] ?? { label: item.paymentState, tone: 'neutral' as StatusTone } : null; return <tr key={item.id}>
            <th scope="row"><a href={`#clients?clientId=${item.clientId}`}>{item.clientName}</a></th><td>{item.planName}</td><td>{day(item.startsOn)}</td>
            <td>{day(item.endsOn)}{item.expiringSoon && <> <StatusChip tone="warning" icon={null}>Vence pronto</StatusChip></>}</td>
            <td><StatusChip tone={status.tone} icon={null}>{status.label}</StatusChip></td>
            {money && <td>{pay ? <StatusChip tone={pay.tone} icon={null}>{pay.label}</StatusChip> : '—'}</td>}
            {money && <td className="is-number">{item.balanceCents != null ? euros(item.balanceCents) : '—'}</td>}</tr>; })}</tbody></table></div>)}
      {data?.capabilities.assignPlans && <p className="reports-note">Para asignar una cuota, entra en la ficha del cliente y usa «Asignar cuota».</p>}
    </Card>
  </main>;
}
