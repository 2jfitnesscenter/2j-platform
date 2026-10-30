import React from 'react';
import { Button, Card, CardHeader, EmptyState, Icon, PageHeader, StatusChip, icons, type StatusTone } from '@2j/ui';

const apiUrl = import.meta.env?.VITE_API_URL ?? 'http://127.0.0.1:3100';

type Management = {
  timezone: string;
  windows: { shiftDays: number; differenceDays: number };
  openRegisters: Array<{ id: string; registerName: string; localDate: string; openedAt: string; custodian: string | null; forgotten: boolean }>;
  closedShifts: Array<{ id: string; registerName: string; localDate: string; openedAt: string; closedAt: string | null; status: string; countedCents: number | null; expectedCents: number | null; differenceCents: number | null }>;
  accumulatedDifference: { differenceCents: number; shiftsWithDifference: number; shifts: number };
  teamClockings: Array<{ id: string; displayName: string; eventType: 'clock_in' | 'clock_out'; occurredAt: string; origin: string }>;
};
type LoadState = { status: 'loading' } | { status: 'ready'; data: Management } | { status: 'denied' } | { status: 'error' };

const euros = (cents: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const clock = new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
const day = (value: string) => dayFmt.format(new Date(`${value}T12:00:00Z`));
const signed = (cents: number) => cents === 0 ? 'Cuadra' : `${cents > 0 ? '+' : '−'}${euros(Math.abs(cents))}`;
const tone = (cents: number | null): StatusTone => cents == null ? 'neutral' : cents === 0 ? 'success' : 'warning';
const originLabel: Record<string, string> = { web: 'Web', staff_app: 'App del equipo', manual_admin: 'Corrección' };

/**
 * Panel de gestión (paridad con Administration.jsx de 2jfit-admin), solo para quien tiene `owner.panel.read`.
 * Cajas abiertas ahora, turnos de caja cerrados, descuadre acumulado y fichajes de hoy. Solo lectura. A38: las diferencias
 * de caja no las ve nadie más; por eso el servidor responde 403 al resto y esta pantalla solo explica que no hay acceso.
 */
export function ManagementPage() {
  const [state, setState] = React.useState<LoadState>({ status: 'loading' });
  const load = React.useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`${apiUrl}/api/admin/management-panel`, signal ? { signal } : undefined);
      if (response.status === 403 || response.status === 401) { setState({ status: 'denied' }); return; }
      if (!response.ok) throw new Error(String(response.status));
      setState({ status: 'ready', data: await response.json() as Management });
    } catch (caught) { if ((caught as Error).name !== 'AbortError') setState({ status: 'error' }); }
  }, []);
  React.useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  const header = <PageHeader title="Panel de gestión" description="Cajas, turnos y fichajes del equipo. Solo lectura y solo para el propietario." actions={<Button icon={icons.RefreshCw} onClick={() => { setState({ status: 'loading' }); void load(); }}>Actualizar</Button>} />;
  if (state.status === 'denied') return <main className="summary management-page" id="management" data-2j-design="v2">{header}<Card><EmptyState icon={icons.ShieldCheck} title="Este panel es solo para el propietario" role="status">Tu perfil no tiene acceso a las diferencias de caja ni a la gestión del centro.</EmptyState></Card></main>;
  if (state.status === 'loading') return <main className="summary management-page" id="management" data-2j-design="v2">{header}<Card className="summary-state" role="status"><span className="spinner" /> Cargando el panel…</Card></main>;
  if (state.status === 'error') return <main className="summary management-page" id="management" data-2j-design="v2">{header}<Card className="summary-state summary-error" role="alert"><strong>No se pudo cargar el panel</strong><Button onClick={() => { setState({ status: 'loading' }); void load(); }}>Reintentar</Button></Card></main>;

  const { data } = state;
  const forgotten = data.openRegisters.filter((row) => row.forgotten).length;
  const accumulated = data.accumulatedDifference;
  const tiles: Array<{ label: string; value: string; detail: string; tone?: StatusTone }> = [
    { label: 'Cajas abiertas ahora', value: String(data.openRegisters.length), detail: forgotten > 0 ? `${forgotten} de días anteriores` : 'Ninguna de días anteriores', ...(forgotten > 0 ? { tone: 'danger' as const } : {}) },
    { label: 'Turnos cerrados', value: String(data.closedShifts.length), detail: `Últimos ${data.windows.shiftDays} días` },
    { label: 'Descuadre acumulado', value: signed(accumulated.differenceCents), detail: `${accumulated.shiftsWithDifference} de ${accumulated.shifts} turnos con diferencia · ${data.windows.differenceDays} días`, tone: accumulated.differenceCents === 0 ? 'success' : 'warning' },
    { label: 'Fichajes de hoy', value: String(data.teamClockings.length), detail: 'Entradas y salidas del equipo' },
  ];
  return <main className="summary management-page" id="management" data-2j-design="v2">
    {header}
    <ul className="summary-metrics" aria-label="Resumen de gestión">
      {tiles.map((tile) => <li key={tile.label}><Card padding="none" className="summary-metric"><div className="summary-metric-body"><span className="summary-metric-label">{tile.label}</span><strong className="summary-metric-value">{tile.value}</strong><span className={`summary-metric-detail ${tile.tone ? `is-${tile.tone}` : ''}`}>{tile.detail}</span></div></Card></li>)}
    </ul>

    <Card as="section" padding="none" className="summary-card" aria-labelledby="mgmt-open-title">
      <div className="summary-card-head"><CardHeader title="Cajas abiertas ahora" titleId="mgmt-open-title" level={2} description="Una caja de un día anterior sigue abierta hasta que alguien la cierre." /></div>
      {data.openRegisters.length === 0
        ? <div className="summary-empty"><span className="summary-empty-icon"><Icon icon={icons.Wallet} size={24} /></span><strong>No hay ninguna caja abierta</strong></div>
        : <ul className="summary-list" aria-label="Cajas abiertas">{data.openRegisters.map((row) => <li key={row.id}><div className="summary-row">
          <span className="summary-row-copy"><strong>{row.registerName}</strong><small>{row.custodian ? `A cargo de ${row.custodian}` : 'Sin responsable asignado'} · abierta {day(row.localDate)} a las {clock.format(new Date(row.openedAt))}</small></span>
          <span className="summary-row-meta">{row.forgotten ? <StatusChip tone="danger">Día anterior</StatusChip> : <StatusChip tone="success">Hoy</StatusChip>}</span></div></li>)}</ul>}
    </Card>

    <Card as="section" padding="none" className="summary-card" aria-labelledby="mgmt-closed-title">
      <div className="summary-card-head"><CardHeader title="Turnos de caja cerrados" titleId="mgmt-closed-title" level={2} description={`Últimos ${data.windows.shiftDays} días, del más reciente al más antiguo.`} /></div>
      {data.closedShifts.length === 0
        ? <div className="summary-empty"><span className="summary-empty-icon"><Icon icon={icons.ReceiptText} size={24} /></span><strong>Sin turnos cerrados en este periodo</strong></div>
        : <div className="reports-table-wrap"><table className="reports-table"><caption className="sr-only">Turnos de caja cerrados</caption>
          <thead><tr><th scope="col">Día</th><th scope="col">Caja</th><th scope="col">Cierre</th><th scope="col" className="is-number">Esperado</th><th scope="col" className="is-number">Contado</th><th scope="col">Diferencia</th></tr></thead>
          <tbody>{data.closedShifts.map((row) => <tr key={row.id}>
            <th scope="row">{day(row.localDate)}</th><td>{row.registerName}</td><td>{row.closedAt ? clock.format(new Date(row.closedAt)) : '—'}{row.status === 'late_close' && <> <StatusChip tone="warning" icon={null}>Cierre tardío</StatusChip></>}</td>
            <td className="is-number">{row.expectedCents != null ? euros(row.expectedCents) : '—'}</td><td className="is-number">{row.countedCents != null ? euros(row.countedCents) : '—'}</td>
            <td>{row.differenceCents != null ? <StatusChip tone={tone(row.differenceCents)} icon={null}>{signed(row.differenceCents)}</StatusChip> : '—'}</td></tr>)}</tbody></table></div>}
    </Card>

    <Card as="section" padding="none" className="summary-card" aria-labelledby="mgmt-clock-title">
      <div className="summary-card-head"><CardHeader title="Fichajes del equipo hoy" titleId="mgmt-clock-title" level={2} description="Sin totales de horas." actions={<Button variant="ghost" size="sm" href="#timeclock">Abrir fichaje</Button>} /></div>
      {data.teamClockings.length === 0
        ? <div className="summary-empty"><span className="summary-empty-icon"><Icon icon={icons.Clock} size={24} /></span><strong>Nadie ha fichado hoy</strong></div>
        : <ul className="summary-list" aria-label="Fichajes de hoy">{data.teamClockings.map((row) => <li key={row.id}><div className="summary-row">
          <span className="summary-row-copy"><strong>{row.displayName}</strong><small>{originLabel[row.origin] ?? row.origin}</small></span>
          <span className="summary-row-meta"><StatusChip tone={row.eventType === 'clock_in' ? 'success' : 'neutral'}>{row.eventType === 'clock_in' ? 'Entrada' : 'Salida'}</StatusChip><time dateTime={row.occurredAt}>{clock.format(new Date(row.occurredAt))}</time></span></div></li>)}</ul>}
    </Card>
  </main>;
}
