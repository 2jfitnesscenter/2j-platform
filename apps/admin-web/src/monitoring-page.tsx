import React from 'react';
import { Button, Card, CardHeader, EmptyState, Icon, PageHeader, StatusChip, icons } from '@2j/ui';

const apiUrl = import.meta.env?.VITE_API_URL ?? 'http://127.0.0.1:3100';

type Monitoring = {
  timezone: string; checkedAt: string; uptimeSeconds: number; healthy: boolean;
  checks: Array<{ id: string; label: string; ok: boolean; detail: string }>;
  counts: { activeClients: number | null; activePlanAssignments: number | null; openCashRegisters: number | null; scheduledSessionsNext7Days: number | null };
};
type LoadState = { status: 'loading' } | { status: 'ready'; data: Monitoring } | { status: 'denied' } | { status: 'error' };

const stamp = new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
function uptime(seconds: number) {
  const days = Math.floor(seconds / 86400), hours = Math.floor((seconds % 86400) / 3600), minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}
const countLabels: Array<[keyof Monitoring['counts'], string, string]> = [
  ['activeClients', 'Clientes activos', 'Fichas en estado activo'],
  ['activePlanAssignments', 'Cuotas vigentes', 'Asignadas y en vigor hoy'],
  ['openCashRegisters', 'Cajas abiertas', 'Ahora mismo'],
  ['scheduledSessionsNext7Days', 'Sesiones próximas', 'Programadas en los próximos 7 días'],
];

/**
 * Monitorización (paridad con BackendFunctions.jsx de 2jfit-admin). Solo lectura y solo `owner.panel.read`: comprobaciones de sí/no
 * y contadores. Nunca muestra claves, variables de entorno, cadenas de conexión ni rutas: la API no las envía.
 */
export function MonitoringPage() {
  const [state, setState] = React.useState<LoadState>({ status: 'loading' });
  const load = React.useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`${apiUrl}/api/admin/monitoring`, signal ? { signal } : undefined);
      if (response.status === 403 || response.status === 401) { setState({ status: 'denied' }); return; }
      if (!response.ok) throw new Error(String(response.status));
      setState({ status: 'ready', data: await response.json() as Monitoring });
    } catch (caught) { if ((caught as Error).name !== 'AbortError') setState({ status: 'error' }); }
  }, []);
  React.useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  const header = <PageHeader title="Monitorización" description="Estado del servidor y de los datos del centro. Solo lectura: aquí no hay claves ni configuración." actions={<Button icon={icons.RefreshCw} onClick={() => { setState({ status: 'loading' }); void load(); }}>Comprobar de nuevo</Button>} />;
  if (state.status === 'denied') return <main className="summary monitoring-page" id="monitoring" data-2j-design="v2">{header}<Card><EmptyState icon={icons.ShieldCheck} title="Esta sección es solo para el propietario" role="status">Tu perfil no tiene acceso a la monitorización.</EmptyState></Card></main>;
  if (state.status === 'loading') return <main className="summary monitoring-page" id="monitoring" data-2j-design="v2">{header}<Card className="summary-state" role="status"><span className="spinner" /> Comprobando…</Card></main>;
  if (state.status === 'error') return <main className="summary monitoring-page" id="monitoring" data-2j-design="v2">{header}<Card className="summary-state summary-error" role="alert"><strong>No se pudo consultar el estado</strong><span>Si la API no responde, esta pantalla tampoco puede avisar: revisa el servidor.</span><Button onClick={() => { setState({ status: 'loading' }); void load(); }}>Reintentar</Button></Card></main>;

  const { data } = state;
  return <main className="summary monitoring-page" id="monitoring" data-2j-design="v2">
    {header}
    <Card as="section" padding="none" className="summary-card" aria-labelledby="monitoring-health-title">
      <div className="summary-card-head"><CardHeader title="Comprobaciones" titleId="monitoring-health-title" level={2}
        description={`Última comprobación ${stamp.format(new Date(data.checkedAt))} · API en marcha desde hace ${uptime(data.uptimeSeconds)}`}
        actions={<StatusChip tone={data.healthy ? 'success' : 'danger'}>{data.healthy ? 'Todo en orden' : 'Hay problemas'}</StatusChip>} /></div>
      <ul className="summary-list" aria-label="Resultado de las comprobaciones">{data.checks.map((check) => <li key={check.id}><div className="summary-row">
        <span className={`summary-attention-icon is-${check.ok ? 'success' : 'danger'}`}><Icon icon={check.ok ? icons.CircleCheck : icons.TriangleAlert} size={20} /></span>
        <span className="summary-row-copy"><strong>{check.label}</strong><small>{check.detail}</small></span>
        <span className="summary-row-meta"><StatusChip tone={check.ok ? 'success' : 'danger'}>{check.ok ? 'Correcto' : 'Falla'}</StatusChip></span></div></li>)}</ul>
    </Card>
    <ul className="summary-metrics" aria-label="Contadores del centro">
      {countLabels.map(([key, label, detail]) => <li key={key}><Card padding="none" className="summary-metric"><div className="summary-metric-body"><span className="summary-metric-label">{label}</span><strong className="summary-metric-value">{data.counts[key] == null ? '—' : String(data.counts[key])}</strong><span className="summary-metric-detail">{detail}</span></div></Card></li>)}
    </ul>
  </main>;
}
