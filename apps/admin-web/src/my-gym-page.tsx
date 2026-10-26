import React from 'react';
import { Button, Card, CardHeader, EmptyState, Icon, PageHeader, SegmentedControl, StatusChip, icons, type StatusTone } from '@2j/ui';
import { NewsPage } from './news-page.js';

const apiUrl = import.meta.env?.VITE_API_URL ?? 'http://127.0.0.1:3100';

type ShortSession = { id: string; startsAt: string; serviceName: string; capacity: number; occupied: number; waiting: number };
type Panel = {
  timezone: string; asOf: string; localDate: string;
  today: {
    classes: { sessionCount: number; capacity: number; occupied: number; sessions: Array<{ id: string; startsAt: string; serviceName: string; capacity: number; occupied: number }> };
    clockedIn: Array<{ id: string; displayName: string; since: string; forgotten: boolean }>;
    cash: { state: 'none' | 'open' | 'closed' | 'late_close'; openedAt: string | null; closedAt: string | null; differenceCents: number | null; localDate: string };
    collections: { pendingCents: number; chargeCount: number; overdueCount: number };
    clients: { overdue: number; blocked: number };
    waitlist: { entries: number; sessions: number };
    teamAlerts: { forgottenShifts: number; activeAbsences: number; unassignedSessions: number };
    reviews: { transfers: number; forms: number; bunkerLinks: number };
  };
  week: {
    dueSoon: { assignments: number; windowDays: number };
    sessions: { lowOccupancy: ShortSession[]; fullWithWaitlist: ShortSession[]; thresholds: { lowOccupancyPercent: number; lowOccupancyHoursAhead: number } };
    lowStock: { threshold: number; items: Array<{ productName: string; variantLabel: string; stock: number }> };
    storeSales: { count: number; collectedCents: number; pendingCents: number };
  };
  month: {
    newClients: { thisMonth: number; previousMonth: number };
    revenue: { plans: { thisMonthCents: number; previousMonthCents: number }; store: { thisMonthCents: number; previousMonthCents: number }; byMethod: Record<string, { thisMonthCents: number; previousMonthCents: number }> };
    occupancyBySlot: Array<{ serviceName: string; hour: number; sessions: number; occupancyPercent: number }>;
    bunkerLinkedClients: number;
  };
};
type PanelState = { status: 'loading' } | { status: 'ready'; data: Panel } | { status: 'denied' } | { status: 'error' };
type Metric = { id: string; label: string; value: string; detail: string; href?: string; tone?: StatusTone | undefined };

const euros = (cents: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const clock = new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', hour: '2-digit', minute: '2-digit' });
const dayTime = new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const methodLabel: Record<string, string> = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', direct_debit: 'Domiciliación', other: 'Otro' };
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const delta = (now: number, before: number) => before === 0 ? (now === 0 ? 'Sin cambios' : 'Mes anterior: 0') : `${now >= before ? '+' : '−'}${Math.round(Math.abs(now - before) / before * 100)} % frente al mes anterior`;

function cashMetric(cash: Panel['today']['cash']): Metric {
  if (cash.state === 'none') return { id: 'cash', label: 'Caja', value: 'Sin turno', detail: 'Hoy no se ha abierto ninguna caja.', href: '#economics' };
  if (cash.state === 'open') return { id: 'cash', label: 'Caja', value: 'Abierta', detail: `Desde las ${clock.format(new Date(cash.openedAt as string))}`, href: '#economics' };
  const difference = cash.differenceCents ?? 0;
  return { id: 'cash', label: 'Caja', value: cash.state === 'late_close' ? 'Cierre tardío' : 'Cerrada', detail: difference === 0 ? 'Cuadra: sin diferencia.' : `Diferencia ${difference > 0 ? '+' : '−'}${euros(Math.abs(difference))} · solo la ves tú`, tone: difference === 0 ? undefined : 'danger', href: '#economics' };
}

function MetricList({ label, metrics }: { label: string; metrics: Metric[] }) {
  return <ul className="summary-metrics my-gym-metrics" aria-label={label}>{metrics.map((metric) => <li key={metric.id}><Card padding="none" className="summary-metric">
    {(() => { const body = <><span className="summary-metric-label">{metric.label}</span><strong className="summary-metric-value">{metric.value}</strong><span className={`summary-metric-detail ${metric.tone ? `is-${metric.tone}` : ''}`}>{metric.detail}</span></>; return metric.href ? <a className="summary-metric-body" href={metric.href}>{body}</a> : <div className="summary-metric-body">{body}</div>; })()}
  </Card></li>)}</ul>;
}

function SessionRows({ title, sessions, empty }: { title: string; sessions: ShortSession[]; empty: string }) {
  return <Card as="section" padding="none" className="summary-card" aria-label={title}>
    <div className="summary-card-head"><CardHeader title={title} level={3} actions={<StatusChip tone="neutral" icon={null}>{sessions.length}</StatusChip>} /></div>
    {sessions.length === 0 ? <p className="my-gym-empty">{empty}</p> : <ul className="summary-list">{sessions.map((session) => <li key={session.id}><div className="summary-row my-gym-row"><span className="summary-row-copy"><strong>{session.serviceName}</strong><small>{dayTime.format(new Date(session.startsAt))}</small></span><span>{session.occupied}/{session.capacity}{session.waiting > 0 ? ` · ${session.waiting} en espera` : ''}</span></div></li>)}</ul>}
  </Card>;
}

/** Panel del propietario (spec #96, opción A, Fase 1): solo lectura, solo agregados, solo con owner.panel.read. */
function OwnerPanel() {
  const [state, setState] = React.useState<PanelState>({ status: 'loading' });
  const load = React.useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const response = await fetch(`${apiUrl}/api/admin/owner-panel`, { cache: 'no-store' });
      if (response.status === 403 || response.status === 401) { setState({ status: 'denied' }); return; }
      if (!response.ok) throw new Error(String(response.status));
      setState({ status: 'ready', data: await response.json() as Panel });
    } catch { setState({ status: 'error' }); }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  if (state.status === 'loading') return <Card className="summary-state" role="status"><span className="spinner" /> Preparando el panel…</Card>;
  if (state.status === 'denied') return <Card><EmptyState icon={icons.ShieldCheck} title="El panel del propietario es solo para el propietario" role="status">Tu perfil no tiene el permiso del panel. Pídeselo a Administración si lo necesitas.</EmptyState></Card>;
  if (state.status === 'error') return <Card className="summary-state summary-error" role="alert"><strong>No se pudo cargar el panel</strong><Button onClick={() => void load()}>Reintentar</Button></Card>;

  const { today, week, month } = state.data;
  const forgotten = today.clockedIn.filter((person) => person.forgotten);
  const todayMetrics: Metric[] = [
    { id: 'classes', label: 'Clases de hoy', value: `${today.classes.occupied}/${today.classes.capacity}`, detail: `${plural(today.classes.sessionCount, 'sesión', 'sesiones')} · plazas ocupadas`, href: '#calendar' },
    { id: 'clocked', label: 'Fichados ahora', value: String(today.clockedIn.length), detail: today.clockedIn.length === 0 ? 'Nadie con jornada abierta' : today.clockedIn.slice(0, 3).map((person) => person.displayName).join(' · '), href: '#staff', ...(forgotten.length > 0 ? { tone: 'danger' as const } : {}) },
    cashMetric(today.cash),
    { id: 'collections', label: 'Pendiente de cobro', value: euros(today.collections.pendingCents), detail: `${plural(today.collections.chargeCount, 'cargo', 'cargos')} · ${today.collections.overdueCount} vencidos`, href: '#economics', ...(today.collections.overdueCount > 0 ? { tone: 'danger' as const } : {}) },
    { id: 'clients', label: 'Cuota vencida o bloqueada', value: String(today.clients.overdue), detail: `${plural(today.clients.overdue, 'cliente vencido', 'clientes vencidos')} · ${plural(today.clients.blocked, 'bloqueado', 'bloqueados')}`, href: '#clients', ...(today.clients.blocked > 0 ? { tone: 'danger' as const } : {}) },
    { id: 'waitlist', label: 'Lista de espera', value: String(today.waitlist.entries), detail: `En ${plural(today.waitlist.sessions, 'sesión', 'sesiones')}`, href: '#calendar' },
    { id: 'team', label: 'Alertas de equipo', value: String(today.teamAlerts.forgottenShifts + today.teamAlerts.activeAbsences + today.teamAlerts.unassignedSessions), detail: `${plural(today.teamAlerts.forgottenShifts, 'fichaje olvidado', 'fichajes olvidados')} · ${plural(today.teamAlerts.activeAbsences, 'ausencia', 'ausencias')} · ${plural(today.teamAlerts.unassignedSessions, 'sesión sin profesional', 'sesiones sin profesional')}`, href: '#staff' },
    { id: 'reviews', label: 'Pendiente de revisar', value: String(today.reviews.transfers + today.reviews.forms + today.reviews.bunkerLinks), detail: `${today.reviews.transfers} transferencias · ${today.reviews.forms} formularios · ${today.reviews.bunkerLinks} vinculaciones de Búnker`, href: '#home' },
  ];
  const weekMetrics: Metric[] = [
    { id: 'due', label: 'Cuotas que vencen', value: String(week.dueSoon.assignments), detail: `En los próximos ${week.dueSoon.windowDays} días`, href: '#clients' },
    { id: 'store', label: 'Ventas de tienda (7 días)', value: euros(week.storeSales.collectedCents), detail: `${plural(week.storeSales.count, 'venta', 'ventas')} · ${euros(week.storeSales.pendingCents)} pendientes de cobro`, href: '#store' },
    { id: 'stock', label: 'Stock bajo', value: String(week.lowStock.items.length), detail: `${week.lowStock.threshold} unidades o menos`, href: '#store' },
  ];
  const revenue = month.revenue;
  const monthMetrics: Metric[] = [
    { id: 'clients-new', label: 'Altas del mes', value: String(month.newClients.thisMonth), detail: `Mes anterior: ${month.newClients.previousMonth}`, href: '#clients' },
    { id: 'plans', label: 'Cobrado en cuotas', value: euros(revenue.plans.thisMonthCents), detail: delta(revenue.plans.thisMonthCents, revenue.plans.previousMonthCents), href: '#economics' },
    { id: 'shop', label: 'Cobrado en tienda', value: euros(revenue.store.thisMonthCents), detail: delta(revenue.store.thisMonthCents, revenue.store.previousMonthCents), href: '#store' },
    { id: 'bunker', label: 'Clientes de Búnker vinculados', value: String(month.bunkerLinkedClients), detail: 'Con vinculación activa', href: '#home' },
  ];
  const methods = Object.entries(revenue.byMethod).filter(([, value]) => value.thisMonthCents !== 0 || value.previousMonthCents !== 0);

  return <div className="my-gym-panel">
    <p className="my-gym-note">Solo lectura. Datos agregados de la hora de Canarias; sin datos de salud ni de contacto. La diferencia de caja solo la ve el propietario.</p>
    <section aria-labelledby="gym-today"><h2 id="gym-today" className="my-gym-heading">Hoy</h2><MetricList label="Indicadores de hoy" metrics={todayMetrics} />
      {today.classes.sessions.length > 0 && <Card as="section" padding="none" className="summary-card" aria-label="Clases de hoy"><div className="summary-card-head"><CardHeader title="Clases de hoy" level={3} /></div><ul className="summary-list">{today.classes.sessions.map((session) => <li key={session.id}><div className="summary-row my-gym-row"><span className="summary-row-copy"><strong>{session.serviceName}</strong><small>{clock.format(new Date(session.startsAt))}</small></span><span>{session.occupied}/{session.capacity}</span></div></li>)}</ul></Card>}</section>
    <section aria-labelledby="gym-week"><h2 id="gym-week" className="my-gym-heading">Esta semana</h2><MetricList label="Indicadores de la semana" metrics={weekMetrics} />
      <div className="my-gym-columns"><SessionRows title="Clases con pocas reservas" sessions={week.sessions.lowOccupancy} empty={`Ninguna por debajo del ${week.sessions.thresholds.lowOccupancyPercent} % en las próximas ${week.sessions.thresholds.lowOccupancyHoursAhead} h.`} /><SessionRows title="Clases llenas con lista de espera" sessions={week.sessions.fullWithWaitlist} empty="Ninguna clase llena con espera." /></div>
      {week.lowStock.items.length > 0 && <Card as="section" padding="none" className="summary-card" aria-label="Productos con stock bajo"><div className="summary-card-head"><CardHeader title="Productos con stock bajo" level={3} /></div><ul className="summary-list">{week.lowStock.items.map((item) => <li key={`${item.productName}-${item.variantLabel}`}><div className="summary-row my-gym-row"><span className="summary-row-copy"><strong>{item.productName}</strong><small>{item.variantLabel}</small></span><span>{item.stock} u.</span></div></li>)}</ul></Card>}</section>
    <section aria-labelledby="gym-month"><h2 id="gym-month" className="my-gym-heading">Este mes</h2><MetricList label="Indicadores del mes" metrics={monthMetrics} />
      <div className="my-gym-columns">
        <Card as="section" padding="none" className="summary-card" aria-label="Cobrado por método de pago"><div className="summary-card-head"><CardHeader title="Cobrado por método de pago" level={3} description="Neto de devoluciones, frente al mes anterior." /></div>
          {methods.length === 0 ? <p className="my-gym-empty">Sin cobros este mes ni el anterior.</p> : <table className="my-gym-table"><thead><tr><th scope="col">Método</th><th scope="col">Este mes</th><th scope="col">Mes anterior</th></tr></thead><tbody>{methods.map(([method, value]) => <tr key={method}><th scope="row">{methodLabel[method] ?? method}</th><td>{euros(value.thisMonthCents)}</td><td>{euros(value.previousMonthCents)}</td></tr>)}</tbody></table>}</Card>
        <Card as="section" padding="none" className="summary-card" aria-label="Ocupación media por servicio y franja"><div className="summary-card-head"><CardHeader title="Ocupación por servicio y franja" level={3} description="Sesiones ya celebradas este mes." /></div>
          {month.occupancyBySlot.length === 0 ? <p className="my-gym-empty">Aún no hay sesiones celebradas este mes.</p> : <table className="my-gym-table"><thead><tr><th scope="col">Servicio</th><th scope="col">Franja</th><th scope="col">Sesiones</th><th scope="col">Ocupación</th></tr></thead><tbody>{month.occupancyBySlot.map((row) => <tr key={`${row.serviceName}-${row.hour}`}><th scope="row">{row.serviceName}</th><td>{String(row.hour).padStart(2, '0')}:00</td><td>{row.sessions}</td><td>{row.occupancyPercent} %</td></tr>)}</tbody></table>}</Card>
      </div></section>
  </div>;
}

type Settings = { dueDay: number; timezone: string; debtBlocksNewReservations: boolean; fiscalLegalGateOpen: boolean; documentRetentionMonths: number | null };

/** Datos del negocio: solo lo que Platform ya guarda y publica; lo demás se declara como «no conectado». */
function BusinessTab() {
  const [settings, setSettings] = React.useState<Settings | 'denied' | 'error' | null>(null);
  React.useEffect(() => { void (async () => {
    try { const response = await fetch(`${apiUrl}/api/economics/settings`, { cache: 'no-store' }); if (response.status === 403 || response.status === 401) { setSettings('denied'); return; } if (!response.ok) throw new Error(); setSettings(await response.json() as Settings); } catch { setSettings('error'); }
  })(); }, []);
  const rows: Array<[string, string]> | null = settings && typeof settings === 'object' ? [
    ['Zona horaria', 'Atlantic/Canary (hora de Canarias)'],
    ['Día de vencimiento de la cuota mensual', `Día ${settings.dueDay} · el bloqueo empieza a las 00:00 del día siguiente`],
    ['Restringir nuevas reservas por deuda', settings.debtBlocksNewReservations ? 'Sí' : 'No'],
    ['Conservación de documentos', settings.documentRetentionMonths == null ? 'Sin definir' : `${settings.documentRetentionMonths} meses`],
    ['Facturación', settings.fiscalLegalGateOpen ? 'Habilitada' : 'Cerrada hasta la validación fiscal (D106)'],
  ] : null;
  return <Card as="section" padding="none" className="summary-card" aria-labelledby="gym-business-title">
    <div className="summary-card-head"><CardHeader title="Datos del negocio" titleId="gym-business-title" level={2} description="Solo lectura: lo que Platform ya guarda del centro." /></div>
    {settings === null && <div className="summary-state" role="status"><span className="spinner" /> Cargando…</div>}
    {settings === 'denied' && <p className="my-gym-empty" role="status">Tu perfil no puede ver los ajustes económicos del centro.</p>}
    {settings === 'error' && <p className="my-gym-empty" role="alert">No se pudieron cargar los datos del negocio.</p>}
    {rows && <dl className="my-gym-facts">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
    <div className="my-gym-notconnected" role="note"><Icon icon={icons.CircleAlert} size={20} /><span><strong>No conectado.</strong> Razón social, contacto, dirección, logotipo y colores del centro todavía no se guardan en Platform; no se muestran campos editables que no guardarían nada.</span></div>
  </Card>;
}

function ConsentsTab() {
  return <Card as="section" aria-labelledby="gym-consents-title">
    <CardHeader title="Consentimientos" titleId="gym-consents-title" level={2} description="Formularios y consentimientos de los clientes." />
    <EmptyState icon={icons.ShieldCheck} title="Se gestionan desde la ficha de cada cliente">Los formularios y consentimientos se asignan y revisan en la pestaña Documentos de cada cliente. La gestión central de versiones llegará con la validación jurídica (D16–D23 y D33); hasta entonces no se muestra aquí ningún consentimiento de salud.<p><a className="button secondary" href="#clients">Ir a Clientes</a></p></EmptyState>
  </Card>;
}

/** Mi gimnasio (paridad visual 13): Panel (opción A de #96) · Datos del negocio · Novedades · Consentimientos. */
export function MyGymPage() {
  const [tab, setTab] = React.useState<'panel' | 'business' | 'news' | 'consents'>('panel');
  return <main className="summary my-gym-page" id="my-gym" data-2j-design="v2">
    <PageHeader title="Mi gimnasio" description="El pulso del centro y sus ajustes, en un solo sitio." />
    <div className="activity-tabs"><SegmentedControl label="Secciones de Mi gimnasio" value={tab} onChange={setTab} options={[{ value: 'panel', label: 'Panel' }, { value: 'business', label: 'Datos del negocio' }, { value: 'news', label: 'Novedades' }, { value: 'consents', label: 'Consentimientos' }]} /></div>
    {tab === 'panel' && <OwnerPanel />}
    {tab === 'business' && <BusinessTab />}
    {tab === 'news' && <NewsPage embedded />}
    {tab === 'consents' && <ConsentsTab />}
  </main>;
}
