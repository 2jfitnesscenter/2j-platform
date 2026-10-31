import React from 'react';
import { Button, Card, CardHeader, Icon, icons } from '@2j/ui';

const apiUrl = import.meta.env?.VITE_API_URL ?? 'http://127.0.0.1:3100';

type Summary = {
  from: string; to: string;
  monthly: Array<{ month: string; soldCents: number; collectedCents: number }>;
  overdue: { cents: number; count: number };
  averageFee: { cents: number; count: number };
  occupancy: { sessions: number; capacity: number; occupied: number; rate: number | null };
  attendance: { attended: number; noShow: number; rate: number | null };
  reservationsByService: Array<{ name: string; count: number }>;
  feesByPlan: Array<{ name: string; count: number; soldCents: number }>;
  collectedByMethod: Array<{ method: string; cents: number }>;
  capabilities: { export: boolean };
};
type LoadState = { status: 'loading' } | { status: 'ready'; data: Summary } | { status: 'error' };

const canaryDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit' });
const monthName = new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', month: 'short', year: '2-digit' });
const euros = (cents: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const percent = (rate: number | null) => (rate === null ? 'Sin datos' : `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(rate * 100)} %`);
const methodLabel: Record<string, string> = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', direct_debit: 'Domiciliación', bizum: 'Bizum', other: 'Otro' };
const monthLabel = (month: string) => monthName.format(new Date(`${month}-01T00:00:00Z`));

function defaultRange() {
  const today = canaryDay.format(new Date());
  const first = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); first.setUTCMonth(first.getUTCMonth() - 5);
  return { from: first.toISOString().slice(0, 10), to: today };
}

/** Barras horizontales en SVG propio: el valor va siempre escrito (no solo color) y hay una tabla equivalente para lectores de pantalla. */
function BarList({ title, rows, unit }: { title: string; rows: Array<{ label: string; value: number; text: string }>; unit: string }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  const rowHeight = 34; const labelWidth = 150; const barWidth = 300;
  return <figure className="reports-chart">
    <svg role="img" aria-label={`${title}: ${rows.map((row) => `${row.label} ${row.text}`).join(', ')}`} viewBox={`0 0 ${labelWidth + barWidth + 90} ${rows.length * rowHeight}`} className="reports-chart-svg">
      {rows.map((row, index) => <g key={row.label} transform={`translate(0 ${index * rowHeight})`}>
        <text x={0} y={21} className="reports-chart-label">{row.label.length > 22 ? `${row.label.slice(0, 21)}…` : row.label}</text>
        <rect x={labelWidth} y={7} width={Math.max(3, (row.value / max) * barWidth)} height={18} rx={3} className="reports-bar" />
        <text x={labelWidth + Math.max(3, (row.value / max) * barWidth) + 8} y={21} className="reports-chart-value">{row.text}</text>
      </g>)}
    </svg>
    <table className="sr-only"><caption>{title}</caption><thead><tr><th scope="col">Concepto</th><th scope="col">{unit}</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.label}><th scope="row">{row.label}</th><td>{row.text}</td></tr>)}</tbody></table>
  </figure>;
}

/** Barras agrupadas por mes: vendido (azul) frente a cobrado (verde marca), con leyenda escrita. */
function MonthlyChart({ monthly }: { monthly: Summary['monthly'] }) {
  const width = 640; const height = 220; const left = 56; const bottom = 28; const top = 12;
  const max = Math.max(100, ...monthly.flatMap((row) => [row.soldCents, row.collectedCents]));
  const plotHeight = height - bottom - top; const slot = (width - left) / Math.max(1, monthly.length);
  const barWidth = Math.min(26, slot / 2.6);
  const y = (cents: number) => top + plotHeight - (cents / max) * plotHeight;
  const ticks = [0, 0.5, 1].map((fraction) => fraction * max);
  return <figure className="reports-chart">
    <ul className="reports-legend" aria-label="Leyenda"><li><span className="reports-swatch is-sold" aria-hidden="true" />Vendido</li><li><span className="reports-swatch" aria-hidden="true" />Cobrado</li></ul>
    <svg role="img" aria-label={`Ingresos mensuales: ${monthly.map((row) => `${monthLabel(row.month)} vendido ${euros(row.soldCents)}, cobrado ${euros(row.collectedCents)}`).join('; ')}`} viewBox={`0 0 ${width} ${height}`} className="reports-chart-svg">
      {ticks.map((tick) => <g key={tick}><line x1={left} x2={width} y1={y(tick)} y2={y(tick)} className="reports-grid" /><text x={left - 8} y={y(tick) + 4} textAnchor="end" className="reports-chart-label">{euros(tick).replace(',00', '')}</text></g>)}
      {monthly.map((row, index) => { const x = left + index * slot + slot / 2; return <g key={row.month}>
        <rect x={x - barWidth - 1} y={y(row.soldCents)} width={barWidth} height={Math.max(0, top + plotHeight - y(row.soldCents))} rx={2} className="reports-bar is-sold" />
        <rect x={x + 1} y={y(row.collectedCents)} width={barWidth} height={Math.max(0, top + plotHeight - y(row.collectedCents))} rx={2} className="reports-bar" />
        <text x={x} y={height - 8} textAnchor="middle" className="reports-chart-label">{monthLabel(row.month)}</text></g>; })}
    </svg>
    <table className="sr-only"><caption>Ingresos mensuales</caption><thead><tr><th scope="col">Mes</th><th scope="col">Vendido</th><th scope="col">Cobrado</th></tr></thead>
      <tbody>{monthly.map((row) => <tr key={row.month}><th scope="row">{monthLabel(row.month)}</th><td>{euros(row.soldCents)}</td><td>{euros(row.collectedCents)}</td></tr>)}</tbody></table>
  </figure>;
}

/**
 * Pestaña Resumen de Informes (decisión A59): KPIs financieros y operativos y gráficos del rango elegido. Solo agregados de la API, sin datos personales ni
 * de salud; no emite nada (D106). La exportación Excel multi-hoja (D109) solo se ofrece con `billing.export`.
 */
export function ReportsSummary() {
  const [range, setRange] = React.useState(defaultRange);
  const [state, setState] = React.useState<LoadState>({ status: 'loading' });
  const valid = range.from !== '' && range.to !== '' && range.to >= range.from && Date.parse(range.to) - Date.parse(range.from) <= 366 * 86_400_000;
  const query = new URLSearchParams(range).toString();

  const load = React.useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`${apiUrl}/api/reports/summary?${new URLSearchParams({ from: range.from, to: range.to })}`, signal ? { signal } : undefined);
      if (!response.ok) throw new Error(String(response.status));
      setState({ status: 'ready', data: await response.json() as Summary });
    } catch (caught) { if ((caught as Error).name !== 'AbortError') setState({ status: 'error' }); }
  }, [range]);
  React.useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void load(controller.signal); }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load, valid]);

  const data = state.status === 'ready' ? state.data : null;
  const kpis: Array<[string, string, string]> = [
    ['Vencido sin cobrar', data ? euros(data.overdue.cents) : '—', data ? `${data.overdue.count} cuotas y cargos vencidos, a día de hoy` : 'A día de hoy'],
    ['Cuota media', data ? (data.averageFee.count ? euros(data.averageFee.cents) : 'Sin datos') : '—', data ? `${data.averageFee.count} cuotas vendidas en el periodo` : 'Cuotas del periodo'],
    ['Ocupación', data ? percent(data.occupancy.rate) : '—', data ? `${data.occupancy.occupied} de ${data.occupancy.capacity} plazas en ${data.occupancy.sessions} sesiones` : 'Plazas ocupadas'],
    ['Asistencia', data ? percent(data.attendance.rate) : '—', data ? `${data.attendance.attended} asistencias y ${data.attendance.noShow} ausencias` : 'Sesiones ya celebradas'],
  ];
  const chartCard = (id: string, title: string, description: string, wide: boolean, body: React.ReactNode) =>
    <Card as="section" padding="none" className={`summary-card reports-chart-card${wide ? ' is-wide' : ''}`} aria-labelledby={id}><div className="summary-card-head"><CardHeader title={title} titleId={id} level={2} description={description} /></div>{body}</Card>;
  return <div className="reports-summary">
    <form className="reports-filters" aria-label="Periodo del resumen" onSubmit={(event) => event.preventDefault()}>
      <label>Desde<input type="date" value={range.from} max={range.to || undefined} onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))} /></label>
      <label>Hasta<input type="date" value={range.to} min={range.from || undefined} onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))} /></label>
      {data?.capabilities.export && valid && <a className="button secondary" href={`${apiUrl}/api/reports/export.xlsx?${query}`} download>Exportar Excel</a>}
    </form>
    {!valid && <div className="form-error" role="alert">Elige un periodo de como máximo 366 días, con la fecha final igual o posterior a la inicial.</div>}
    {valid && state.status === 'loading' && <div className="summary-state" role="status"><span className="spinner" /> Cargando el resumen…</div>}
    {valid && state.status === 'error' && <div className="summary-state summary-error" role="alert"><strong>No se pudo cargar el resumen</strong><Button onClick={() => { setState({ status: 'loading' }); void load(); }}>Reintentar</Button></div>}
    {valid && data && <>
      <ul className="summary-metrics" aria-label="Indicadores del periodo">
        {kpis.map(([label, value, detail]) => <li key={label}><Card padding="none" className="summary-metric"><div className="summary-metric-body"><span className="summary-metric-label">{label}</span><strong className="summary-metric-value">{value}</strong><span className="summary-metric-detail">{detail}</span></div></Card></li>)}
      </ul>
      <div className="reports-charts">
        {chartCard('reports-monthly-title', 'Ingresos mensuales', 'Vendido frente a cobrado, por mes, sin anuladas ni exentas.', true, <MonthlyChart monthly={data.monthly} />)}
        {chartCard('reports-services-title', 'Reservas por servicio', 'Plazas reservadas, asistidas o con ausencia.', false, data.reservationsByService.length
          ? <BarList title="Reservas por servicio" unit="Reservas" rows={data.reservationsByService.map((row) => ({ label: row.name, value: row.count, text: String(row.count) }))} />
          : <p className="reports-note">Sin reservas en este periodo.</p>)}
        {chartCard('reports-plans-title', 'Cuotas por plan', 'Cuotas vendidas en el periodo.', false, data.feesByPlan.length
          ? <BarList title="Cuotas por plan" unit="Cuotas" rows={data.feesByPlan.map((row) => ({ label: row.name, value: row.count, text: `${row.count} · ${euros(row.soldCents)}` }))} />
          : <p className="reports-note">Sin cuotas vendidas en este periodo.</p>)}
        {chartCard('reports-methods-title', 'Cobros por método', 'Cobros registrados, sin descontar devoluciones.', false, data.collectedByMethod.length
          ? <BarList title="Cobros por método" unit="Cobrado" rows={data.collectedByMethod.map((row) => ({ label: methodLabel[row.method] ?? row.method, value: row.cents, text: euros(row.cents) }))} />
          : <p className="reports-note">Sin cobros en este periodo.</p>)}
      </div>
      <p className="reports-note"><Icon icon={icons.ShieldCheck} size={16} /> Solo cifras agregadas: este resumen no muestra datos personales ni de salud y no emite facturas.</p>
    </>}
  </div>;
}
