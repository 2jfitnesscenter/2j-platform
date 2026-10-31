import React from 'react';
import { Button, Card, CardHeader, Icon, PageHeader, StatusChip, icons, type LucideIcon, type StatusTone } from '@2j/ui';
import { hasProfessionalRoute, useCommandCenter, type CommandCenterModel } from './app-shell.js';
import { PLATFORM_CHANGELOG } from './platform-changelog.js';
import { InvoiceDialog } from './invoice-ui.js';
import { NewSaleLauncher } from './new-sale-launcher.js';

const pendingKinds = new Set(['sensitive_review', 'document_pending', 'consent_pending', 'overdue_checkin', 'pending_transfers']);

function money(cents: number) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function date(value: string | null) {
  return value ? new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '';
}

function safeInternalHref(value: string) {
  return /^#[a-z][a-z0-9-]*(?:\?[a-zA-Z0-9_=&%-]*)?$/.test(value);
}

function ItemLink({ href, children, className = '' }: { href: string; children: React.ReactNode; className?: string }) {
  return safeInternalHref(href)
    ? <a className={className} href={href}>{children}</a>
    : <div className={`${className} is-unlinked`}>{children}</div>;
}

const quickActionIcons: Record<string, LucideIcon> = {
  'new-client': icons.UserRound,
  'new-reservation': icons.CalendarDays,
  'new-sale': icons.ShoppingBag,
  'assign-plan': icons.Ticket,
  'collect-payment': icons.Wallet,
  'send-message': icons.MessageSquare,
  'timeclock-toggle': icons.Clock,
  'open-cash': icons.Wallet,
  'close-cash': icons.ReceiptText,
};

/** Accesos rápidos del Resumen (paridad visual 2): solo los que el servidor concede a este perfil; cada uno abre su sección. */
function QuickActions({ actions }: { actions: CommandCenterModel['quickActions'] }) {
  const usable = actions.filter(action => safeInternalHref(action.href));
  if (usable.length === 0) return null;
  return <nav className="summary-quick" aria-label="Accesos rápidos">
    <ul>{usable.map(action => <li key={action.id}><a href={action.href}><Icon icon={quickActionIcons[action.id] ?? icons.ArrowLeft} size={16} />{action.label}</a></li>)}</ul>
  </nav>;
}

type AttentionRow = { id: string; title: string; summary: string; href: string; ageAt: string | null; label: string; tone: StatusTone; icon: LucideIcon };
const toneRank: Record<StatusTone, number> = { danger: 0, warning: 1, info: 2, success: 3, neutral: 4 };

/** Presentation of the incidences the API already returns. PP-01 (the "requires attention" engine and its thresholds) is not implemented: nothing is derived here. */
function attentionPresentation(kind: string): Pick<AttentionRow, 'label' | 'tone' | 'icon'> {
  switch (kind) {
    case 'overdue_payments': return { label: 'Vencido', tone: 'danger', icon: icons.ReceiptText };
    case 'unassigned_session': return { label: 'Sin asignar', tone: 'danger', icon: icons.UserX };
    case 'open_timeclock': return { label: 'Por cerrar', tone: 'warning', icon: icons.Clock };
    case 'absence_sessions': return { label: 'Sesiones afectadas', tone: 'warning', icon: icons.CalendarClock };
    case 'waitlist': return { label: 'Lista de espera', tone: 'info', icon: icons.Hourglass };
    case 'overdue_checkin': return { label: 'Seguimiento', tone: 'warning', icon: icons.ClipboardCheck };
    case 'pending_transfers': return { label: 'Validar', tone: 'warning', icon: icons.Wallet };
    case 'sensitive_review':
    case 'document_pending':
    case 'consent_pending': return { label: 'Revisar', tone: 'warning', icon: icons.FileWarning };
    default: return { label: 'Revisar', tone: 'warning', icon: icons.Inbox };
  }
}

type Metric = { id: string; label: string; value: string; detail: string; href?: string; detailTone?: StatusTone };

function MetricTile({ metric }: { metric: Metric }) {
  const body = <>
    <span className="summary-metric-label">{metric.label}</span>
    <strong className="summary-metric-value">{metric.value}</strong>
    <span className={`summary-metric-detail ${metric.detailTone ? `is-${metric.detailTone}` : ''}`}>{metric.detail}</span>
  </>;
  return <li><Card padding="none" className="summary-metric">
    {metric.href && safeInternalHref(metric.href) ? <a className="summary-metric-body" href={metric.href}>{body}</a> : <div className="summary-metric-body">{body}</div>}
  </Card></li>;
}

function buildMetrics(data: CommandCenterModel): Metric[] {
  const { permissions, today, commercial } = data;
  const metrics: Metric[] = [];
  // Orden y contenido como el Resumen de Base44: clientes, cuotas, reservas, ocupación, importes, transferencias, ventas, stock.
  if (permissions.clients && data.clients) {
    metrics.push({ id: 'clients', label: 'Clientes activos', value: String(data.clients.active), detail: `${data.clients.recentSignups} ${data.clients.recentSignups === 1 ? 'alta' : 'altas'} en 30 días`, href: '#clients' });
  }
  if (commercial?.plans) {
    const soon = commercial.plans.expiringSoonCount;
    metrics.push({ id: 'plans', label: 'Cuotas vigentes', value: String(commercial.plans.activeCount), detail: soon > 0 ? `${soon} ${soon === 1 ? 'vence' : 'vencen'} en 7 días` : 'Ninguna vence en 7 días', ...(soon > 0 ? { detailTone: 'warning' as const } : {}), href: '#clients' });
  }
  if (permissions.calendar) {
    const free = Math.max(0, today.capacity - today.occupied);
    metrics.push({ id: 'bookings', label: 'Reservas hoy', value: String(today.occupied), detail: `${free} ${free === 1 ? 'plaza libre' : 'plazas libres'}`, href: '#calendar' });
    if (today.capacity > 0) metrics.push({ id: 'occupancy', label: 'Ocupación hoy', value: `${Math.round((today.occupied / today.capacity) * 100)} %`, detail: `${today.occupied} de ${today.capacity} plazas`, href: '#calendar' });
  }
  if (permissions.billing && data.economics) {
    const overdue = Number(data.economics.overdueCount);
    metrics.push({ id: 'pending', label: 'Pendiente de cobro', value: money(Number(data.economics.pendingCents)), detail: overdue > 0 ? `${overdue} ${overdue === 1 ? 'cargo vencido' : 'cargos vencidos'}` : 'Sin cargos vencidos', ...(overdue > 0 ? { detailTone: 'danger' as const } : {}), href: '#economics' });
  }
  if (commercial?.transfers) {
    const pending = commercial.transfers.pendingCount;
    metrics.push({ id: 'transfers', label: 'Transferencias por validar', value: String(pending), detail: pending > 0 ? 'Justificantes pendientes de revisión' : 'Nada pendiente', ...(pending > 0 ? { detailTone: 'warning' as const } : {}), href: '#economics' });
  }
  if (commercial?.storeSales) {
    const count = commercial.storeSales.monthCount;
    metrics.push({ id: 'store-sales', label: 'Ventas del mes', value: money(commercial.storeSales.monthTotalCents), detail: `${count} ${count === 1 ? 'operación' : 'operaciones'}`, href: '#store' });
  }
  if (commercial?.lowStock) {
    const count = commercial.lowStock.count;
    metrics.push({ id: 'low-stock', label: 'Productos con stock bajo', value: String(count), detail: count > 0 ? 'Revisa el inventario' : 'Stock suficiente', ...(count > 0 ? { detailTone: 'warning' as const } : {}), href: '#store' });
  }
  return metrics;
}

export function AttentionCard({ rows, title = 'Requiere atención' }: { rows: AttentionRow[]; title?: string }) {
  return <Card as="section" padding="none" className="summary-card" aria-labelledby="summary-attention-title">
    <div className="summary-card-head"><CardHeader title={title} titleId="summary-attention-title" actions={<StatusChip tone={rows.length === 0 ? 'success' : rows.some(row => row.tone === 'danger') ? 'danger' : 'warning'} icon={null}>{rows.length}</StatusChip>} /></div>
    {rows.length === 0
      ? <div className="summary-empty"><span className="summary-empty-icon"><Icon icon={icons.CircleCheck} size={24} /></span><strong>Nada requiere tu atención.</strong><span>No hay incidencias en las áreas disponibles para tu perfil.</span></div>
      : <ul className="summary-list" aria-label="Elementos que requieren atención">{rows.map(row => <li key={row.id}>
        <ItemLink href={row.href} className="summary-row summary-attention-row">
          <span className={`summary-attention-icon is-${row.tone}`}><Icon icon={row.icon} size={20} /></span>
          <span className="summary-row-copy"><strong>{row.title}</strong><small>{row.summary}</small></span>
          <span className="summary-row-meta"><StatusChip tone={row.tone}>{row.label}</StatusChip>{row.ageAt && <time dateTime={row.ageAt}>{date(row.ageAt)}</time>}</span>
          <Icon icon={icons.ChevronRight} size={16} className="summary-row-arrow" />
        </ItemLink>
      </li>)}</ul>}
  </Card>;
}

function SessionsCard({ data }: { data: CommandCenterModel }) {
  const allSessions = data.today.sessions ?? [];
  const now = Date.now();
  const currentSessions = allSessions.filter(session => session.isNow);
  const upcomingSessions = allSessions.filter(session => !session.isNow && Date.parse(session.startsAt) >= now);
  const endedSessions = allSessions.filter(session => !session.isNow && Date.parse(session.startsAt) < now).sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  const sessions = [...currentSessions, ...upcomingSessions, ...endedSessions].slice(0, 5);
  const moreSessions = Math.max(0, allSessions.length - sessions.length);
  const count = data.today.sessionCount;
  return <Card as="section" padding="none" className="summary-card" aria-labelledby="summary-sessions-title">
    <div className="summary-card-head"><CardHeader title="Próximas sesiones" titleId="summary-sessions-title" description={`${count} ${count === 1 ? 'sesión programada' : 'sesiones programadas'} hoy · hora de Canarias`} actions={<Button variant="ghost" size="sm" href="#calendar">Abrir agenda</Button>} /></div>
    {sessions.length === 0
      ? <div className="summary-empty"><span className="summary-empty-icon"><Icon icon={icons.CalendarDays} size={24} /></span><strong>No hay sesiones programadas hoy</strong><span>Consulta la agenda para ver otros días o preparar la próxima sesión.</span></div>
      : <ul className="summary-list" aria-label="Próximas sesiones de hoy">{sessions.map(session => {
        const full = session.capacity > 0 && session.occupied >= session.capacity;
        const fill = session.capacity > 0 ? Math.min(100, Math.round((session.occupied / session.capacity) * 100)) : 0;
        return <li key={session.id}>
          <ItemLink href="#calendar" className={`summary-row summary-session-row ${session.isNow ? 'is-current' : ''}`}>
            <time dateTime={session.startsAt}>{dateTime(session.startsAt)}</time>
            <span className="summary-row-copy summary-session-main"><strong>{session.serviceName}</strong><small className={session.professionalName ? '' : 'is-missing'}>{session.professionalName ?? 'Profesional sin asignar'}</small></span>
            <span className="summary-session-load">
              <span className="summary-session-capacity"><strong>{session.occupied}/{session.capacity}</strong></span>
              <span className="summary-fill" aria-hidden="true"><span style={{ width: `${fill}%` }} /></span>
            </span>
            <span className="summary-session-flags">
              {session.state === 'in_progress' && <StatusChip tone="info">En curso</StatusChip>}
              {session.state === 'finished' && <StatusChip tone="neutral">Finalizada</StatusChip>}
              {session.state !== 'finished' && full && <StatusChip tone="info">Lleno</StatusChip>}
              {session.waitlistCount > 0 && <span className="summary-session-waitlist">{session.waitlistCount} en espera</span>}
            </span>
            <Icon icon={icons.ChevronRight} size={16} className="summary-row-arrow" />
          </ItemLink>
        </li>;
      })}</ul>}
    {moreSessions > 0 && <p className="summary-more-sessions">+{moreSessions} {moreSessions === 1 ? 'sesión' : 'sesiones'} hoy · <a href="#calendar">Ver todas en la agenda</a></p>}
  </Card>;
}

/** Ocupación de hoy: plazas reservadas sobre plazas ofrecidas, con lo que queda por resolver. */
function OccupancyCard({ data }: { data: CommandCenterModel }) {
  const { capacity, occupied, waitlistCount, unassignedCount, sessionCount } = data.today;
  const percent = capacity > 0 ? Math.min(100, Math.round((occupied / capacity) * 100)) : 0;
  return <Card as="section" padding="none" className="summary-card summary-occupancy" aria-labelledby="summary-occupancy-title">
    <div className="summary-card-head"><CardHeader title="Ocupación de hoy" titleId="summary-occupancy-title" actions={<Button variant="ghost" size="sm" href="#calendar">Abrir agenda</Button>} /></div>
    {capacity === 0
      ? <div className="summary-empty"><span className="summary-empty-icon"><Icon icon={icons.Users} size={24} /></span><strong>Sin plazas ofrecidas hoy</strong><span>Cuando haya sesiones programadas verás aquí cuántas plazas están reservadas.</span></div>
      : <div className="summary-occupancy-body">
        <div className="summary-occupancy-meter"><span className="summary-fill" role="img" aria-label={`${percent} % de ocupación`}><span style={{ width: `${percent}%` }} /></span>
          <small>{occupied} de {capacity} plazas · {sessionCount} {sessionCount === 1 ? 'sesión' : 'sesiones'}</small></div>
        <ul className="summary-occupancy-notes">
          <li className={waitlistCount > 0 ? 'is-info' : ''}>{waitlistCount} {waitlistCount === 1 ? 'persona en espera' : 'personas en espera'}</li>
          <li className={unassignedCount > 0 ? 'is-danger' : ''}>{unassignedCount} {unassignedCount === 1 ? 'sesión sin profesional' : 'sesiones sin profesional'}</li>
        </ul>
      </div>}
  </Card>;
}

const longDate = new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', day: 'numeric', month: 'short' });

/** Cuotas que vencen en los próximos 7 días. Solo lectura: la renovación se hace desde la ficha del cliente. */
function ExpiringPlansCard({ plans }: { plans: NonNullable<NonNullable<CommandCenterModel['commercial']>['expiringPlans']> }) {
  return <Card as="section" padding="none" className="summary-card" aria-labelledby="summary-expiring-title">
    <div className="summary-card-head"><CardHeader title="Cuotas próximas a vencer" titleId="summary-expiring-title" description="Vencen en los próximos 7 días" actions={<Button variant="ghost" size="sm" href="#clients">Ver clientes</Button>} /></div>
    {plans.length === 0
      ? <div className="summary-empty"><span className="summary-empty-icon"><Icon icon={icons.Ticket} size={24} /></span><strong>Ninguna cuota vence esta semana</strong><span>Las cuotas que estén a punto de terminar aparecerán aquí.</span></div>
      : <ul className="summary-list" aria-label="Cuotas próximas a vencer">{plans.map(plan => <li key={plan.assignmentId}>
        <ItemLink href={`#clients?clientId=${plan.clientId}`} className="summary-row">
          <span className="summary-row-copy"><strong>{plan.clientName}</strong><small>{plan.planName}</small></span>
          <span className="summary-row-meta"><StatusChip tone="warning">Vence {longDate.format(new Date(`${plan.endsOn}T12:00:00Z`))}</StatusChip></span>
          <Icon icon={icons.ChevronRight} size={16} className="summary-row-arrow" />
        </ItemLink>
      </li>)}</ul>}
  </Card>;
}

/** Últimos cobros y devoluciones registrados (no es el historial de auditoría, que vive en Actividad). */
function RecentMovementsCard({ movements, canReadInvoices }: { movements: NonNullable<NonNullable<CommandCenterModel['commercial']>['recentMovements']>; canReadInvoices: boolean }) {
  const [invoice, setInvoice] = React.useState<{ chargeId: string; title: string } | null>(null);
  return <>
  <Card as="section" padding="none" className="summary-card" aria-labelledby="summary-movements-title">
    <div className="summary-card-head"><CardHeader title="Últimos movimientos" titleId="summary-movements-title" description="Cobros y devoluciones recientes" actions={<Button variant="ghost" size="sm" href="#economics">Ver economía</Button>} /></div>
    {movements.length === 0
      ? <div className="summary-empty"><span className="summary-empty-icon"><Icon icon={icons.Wallet} size={24} /></span><strong>Sin movimientos registrados</strong><span>Los cobros y devoluciones aparecerán aquí.</span></div>
      : <ul className="summary-list" aria-label="Últimos movimientos">{movements.map(movement => <li key={movement.id}>
        <div className="summary-movement-item">
          <ItemLink href="#economics" className="summary-row">
            <span className="summary-row-copy"><strong>{movement.concept}</strong><small>{movement.clientName} · <time dateTime={movement.occurredAt}>{date(movement.occurredAt)}</time></small></span>
            <span className="summary-row-meta"><StatusChip tone={movement.kind === 'refund' ? 'danger' : 'success'}>{movement.kind === 'refund' ? 'Devolución' : 'Cobro'}</StatusChip><strong>{movement.kind === 'refund' ? '−' : ''}{money(movement.amountCents)}</strong></span>
            <Icon icon={icons.ChevronRight} size={16} className="summary-row-arrow" />
          </ItemLink>
          {canReadInvoices && movement.chargeId && <Button size="sm" onClick={() => setInvoice({ chargeId: movement.chargeId!, title: `${movement.clientName} · ${movement.concept}` })}>Factura y ticket</Button>}
        </div>
      </li>)}</ul>}
  </Card>
  {invoice && <InvoiceDialog chargeId={invoice.chargeId} title={invoice.title} onClose={() => setInvoice(null)} />}
  </>;
}

const fullDate = new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', day: 'numeric', month: 'long', year: 'numeric' });

/** Qué ha cambiado en el panel. Cerrado por defecto: es información secundaria. */
function PlatformNews() {
  const [open, setOpen] = React.useState(false);
  return <Card as="section" padding="none" className="summary-card summary-news" aria-labelledby="summary-news-title">
    <button type="button" className="summary-news-toggle" aria-expanded={open} aria-controls="summary-news-list" onClick={() => setOpen(value => !value)}>
      <Icon icon={icons.History} size={20} />
      <span className="summary-row-copy"><strong id="summary-news-title">Novedades de la plataforma</strong><small>{PLATFORM_CHANGELOG.length} {PLATFORM_CHANGELOG.length === 1 ? 'entrega' : 'entregas'} recientes</small></span>
      <Icon icon={icons.ChevronDown} size={16} className="summary-news-chevron" />
    </button>
    {open && <ol id="summary-news-list" className="summary-news-list">{PLATFORM_CHANGELOG.map(change => <li key={change.date + change.title}>
      <div className="summary-news-head"><strong>{change.title}</strong><time dateTime={change.date}>{fullDate.format(new Date(`${change.date}T12:00:00Z`))}</time></div>
      <ul>{change.items.map(item => <li key={item}>{item}</li>)}</ul>
    </li>)}</ol>}
  </Card>;
}

/** What needs attention for this profile (shared by the Resumen and the Actividad screen). */
export function attentionOf(data: CommandCenterModel) {
  const permissions = data.permissions;
  const canSeeAttention = permissions.calendar || permissions.billing || permissions.staff;
  const canSeePending = permissions.communications || permissions.transfers || (permissions.documents && permissions.clients) || (permissions.followup && permissions.clients);
  const attentionRows: AttentionRow[] = [
    ...(canSeeAttention ? data.attention.filter(item => !pendingKinds.has(item.kind)) : []),
    ...(canSeePending ? data.attention.filter(item => pendingKinds.has(item.kind)) : []),
  ].map(item => ({ id: item.id, title: item.title, summary: item.summary, href: item.href, ageAt: item.ageAt, ...attentionPresentation(item.kind) }));
  if (permissions.communications && data.unread > 0) attentionRows.push({ id: 'unread-messages', title: `${data.unread} ${data.unread === 1 ? 'mensaje sin leer' : 'mensajes sin leer'}`, summary: 'Hay conversaciones que esperan respuesta', href: '#communications', ageAt: null, label: 'Responder', tone: 'info', icon: icons.MessageSquare });
  attentionRows.sort((a, b) => toneRank[a.tone] - toneRank[b.tone]);
  return { canSeeAttention, canSeePending, rows: attentionRows };
}

export function CommandCenter() {
  const { data, state, error, reload } = useCommandCenter();
  const [updatedAt, setUpdatedAt] = React.useState<string | null>(null);
  React.useEffect(() => { if (data) setUpdatedAt(new Date().toISOString()); }, [data]);
  // El shell carga el resumen una sola vez: al volver desde Cobrar, Vender, Caja o Mensajes se refresca solo, para no mostrar cifras viejas.
  const hadDataOnEntry = React.useRef(Boolean(data));
  React.useEffect(() => { if (hadDataOnEntry.current) void reload(); }, [reload]);
  const today = new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  const description = `${today} · Lo importante de hoy y lo que requiere tu atención.`;

  if (!data && state !== 'error') return <main className="summary" id="home" data-2j-design="v2">
    <PageHeader title="Resumen" description={description} />
    <Card className="summary-state" role="status"><span className="spinner" /> Preparando tu resumen…</Card>
  </main>;
  if (!data) return <main className="summary" id="home" data-2j-design="v2">
    <PageHeader title="Resumen" description={description} />
    <Card className="summary-state summary-error" role="alert"><strong>No se pudo cargar el resumen</strong><span>{error}</span><Button onClick={() => void reload()}>Reintentar</Button></Card>
  </main>;

  const permissions = data.permissions;
  const { canSeeAttention, canSeePending, rows: attentionRows } = attentionOf(data);
  const showAttention = canSeeAttention || canSeePending;
  const metrics = buildMetrics(data);
  const expiringPlans = data.commercial?.expiringPlans ?? null;
  const recentMovements = data.commercial?.recentMovements ?? null;
  const refreshing = state === 'loading';
  // «Nueva venta» la ofrece quien el servidor deja vender o cobrar; el diálogo vuelve a comprobar los permisos del cliente elegido.
  const canSell = data.quickActions.some(action => ['assign-plan', 'collect-payment'].includes(action.id));

  return <main className="summary" id="home" data-2j-design="v2">
    <PageHeader
      title="Resumen"
      description={description}
      meta={updatedAt ? `Actualizado a las ${dateTime(updatedAt)} · hora de Canarias` : undefined}
      actions={<>{canSell && <NewSaleLauncher onDone={() => void reload()} />}{hasProfessionalRoute('reports') && <Button href="#reports" icon={icons.ArrowUpRight}>Ver informes</Button>}<Button icon={icons.RefreshCw} loading={refreshing} onClick={() => void reload()}>Actualizar</Button></>}
    />

    <QuickActions actions={data.quickActions} />

    {metrics.length > 0 && <ul className="summary-metrics" aria-label="Indicadores de hoy">{metrics.map(metric => <MetricTile key={metric.id} metric={metric} />)}</ul>}

    {permissions.calendar && <OccupancyCard data={data} />}

    {(showAttention || permissions.calendar) && <div className={`summary-columns ${showAttention && permissions.calendar ? '' : 'is-single'}`}>
      {showAttention && <AttentionCard rows={attentionRows} />}
      {permissions.calendar && <SessionsCard data={data} />}
    </div>}

    {(expiringPlans || recentMovements) && <div className={`summary-columns ${expiringPlans && recentMovements ? '' : 'is-single'}`}>
      {expiringPlans && <ExpiringPlansCard plans={expiringPlans} />}
      {recentMovements && <RecentMovementsCard movements={recentMovements} canReadInvoices={permissions.invoices === true} />}
    </div>}

    {permissions.staff && data.team && <Card as="section" className="summary-team" aria-labelledby="summary-team-title">
      <CardHeader title="Equipo ahora" titleId="summary-team-title" actions={<Button variant="ghost" size="sm" href="#staff">Ver equipo</Button>} />
      <dl className="summary-team-stats">
        <div><dd>{data.team.workingNow}</dd><dt>Trabajando ahora</dt></div>
        <div><dd>{data.team.activeAbsences}</dd><dt>Ausencias activas</dt></div>
        <div><dd>{data.team.substitutions}</dd><dt>Coberturas activas</dt></div>
      </dl>
    </Card>}

    <PlatformNews />
  </main>;
}
