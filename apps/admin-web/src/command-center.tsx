import React from 'react';
import { Button, Card, CardHeader, Icon, PageHeader, StatusChip, icons, type LucideIcon, type StatusTone } from '@2j/ui';
import { useCommandCenter, type CommandCenterModel } from './app-shell.js';

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

const quickActionIcons: Record<string, LucideIcon> = {
  'new-client': icons.UserRound,
  'new-reservation': icons.CalendarDays,
  'collect-payment': icons.Wallet,
  'send-message': icons.MessageSquare,
  'record-absence': icons.Clock,
  cash: icons.ReceiptText,
};

function QuickActions({ actions }: { actions: CommandCenterModel['quickActions'] }) {
  const available = actions.filter(action => safeInternalHref(action.href));
  if (available.length === 0) return null;
  return <nav className="summary-quick-actions" aria-label="Acciones rápidas">
    {available.map(action => <Button
      key={action.id}
      variant="ghost"
      size="sm"
      href={action.href}
      icon={quickActionIcons[action.id] ?? icons.LayoutGrid}
      className="summary-quick-action"
    >{action.label}</Button>)}
  </nav>;
}

function buildMetrics(data: CommandCenterModel): Metric[] {
  const { permissions, today } = data;
  const metrics: Metric[] = [];
  if (permissions.calendar) {
    const free = Math.max(0, today.capacity - today.occupied);
    metrics.push({ id: 'bookings', label: 'Reservas hoy', value: String(today.occupied), detail: `${free} ${free === 1 ? 'plaza libre' : 'plazas libres'}`, href: '#calendar' });
    if (today.capacity > 0) metrics.push({ id: 'occupancy', label: 'Ocupación hoy', value: `${Math.round((today.occupied / today.capacity) * 100)} %`, detail: `${today.occupied} de ${today.capacity} plazas`, href: '#calendar' });
  }
  if (permissions.billing && data.economics) {
    const overdue = Number(data.economics.overdueCount);
    metrics.push({ id: 'pending', label: 'Pendiente de cobro', value: money(Number(data.economics.pendingCents)), detail: overdue > 0 ? `${overdue} ${overdue === 1 ? 'cargo vencido' : 'cargos vencidos'}` : 'Sin cargos vencidos', ...(overdue > 0 ? { detailTone: 'danger' as const } : {}), href: '#economics' });
  }
  if (permissions.clients && data.clients) {
    metrics.push({ id: 'clients', label: 'Clientes activos', value: String(data.clients.active), detail: `${data.clients.recentSignups} ${data.clients.recentSignups === 1 ? 'alta' : 'altas'} en 30 días`, href: '#clients' });
  }
  return metrics;
}

function AttentionCard({ rows }: { rows: AttentionRow[] }) {
  return <Card as="section" padding="none" className="summary-card" aria-labelledby="summary-attention-title">
    <div className="summary-card-head"><CardHeader title="Requiere atención" titleId="summary-attention-title" actions={<StatusChip tone={rows.length === 0 ? 'success' : rows.some(row => row.tone === 'danger') ? 'danger' : 'warning'} icon={null}>{rows.length}</StatusChip>} /></div>
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

export function CommandCenter() {
  const { data, state, error, reload } = useCommandCenter();
  const [updatedAt, setUpdatedAt] = React.useState<string | null>(null);
  React.useEffect(() => { if (data) setUpdatedAt(new Date().toISOString()); }, [data]);
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
  const canSeeAttention = permissions.calendar || permissions.billing || permissions.staff;
  const canSeePending = permissions.communications || permissions.transfers || (permissions.documents && permissions.clients) || (permissions.followup && permissions.clients);
  const attentionRows: AttentionRow[] = [
    ...(canSeeAttention ? data.attention.filter(item => !pendingKinds.has(item.kind)) : []),
    ...(canSeePending ? data.attention.filter(item => pendingKinds.has(item.kind)) : []),
  ].map(item => ({ id: item.id, title: item.title, summary: item.summary, href: item.href, ageAt: item.ageAt, ...attentionPresentation(item.kind) }));
  if (permissions.communications && data.unread > 0) attentionRows.push({ id: 'unread-messages', title: `${data.unread} ${data.unread === 1 ? 'mensaje sin leer' : 'mensajes sin leer'}`, summary: 'Hay conversaciones que esperan respuesta', href: '#communications', ageAt: null, label: 'Responder', tone: 'info', icon: icons.MessageSquare });
  attentionRows.sort((a, b) => toneRank[a.tone] - toneRank[b.tone]);
  const showAttention = canSeeAttention || canSeePending;
  const metrics = buildMetrics(data);
  const refreshing = state === 'loading';

  return <main className="summary" id="home" data-2j-design="v2">
    <PageHeader
      title="Resumen"
      description={description}
      meta={updatedAt ? `Actualizado a las ${dateTime(updatedAt)} · hora de Canarias` : undefined}
      actions={<Button icon={icons.RefreshCw} loading={refreshing} onClick={() => void reload()}>Actualizar</Button>}
    />

    <QuickActions actions={data.quickActions ?? []} />

    {metrics.length > 0 && <ul className="summary-metrics" aria-label="Indicadores de hoy">{metrics.map(metric => <MetricTile key={metric.id} metric={metric} />)}</ul>}

    {(showAttention || permissions.calendar) && <div className={`summary-columns ${showAttention && permissions.calendar ? '' : 'is-single'}`}>
      {showAttention && <AttentionCard rows={attentionRows} />}
      {permissions.calendar && <SessionsCard data={data} />}
    </div>}

    {permissions.staff && data.team && <Card as="section" className="summary-team" aria-labelledby="summary-team-title">
      <CardHeader title="Equipo ahora" titleId="summary-team-title" actions={<Button variant="ghost" size="sm" href="#staff">Ver equipo</Button>} />
      <dl className="summary-team-stats">
        <div><dd>{data.team.workingNow}</dd><dt>Trabajando ahora</dt></div>
        <div><dd>{data.team.activeAbsences}</dd><dt>Ausencias activas</dt></div>
        <div><dd>{data.team.substitutions}</dd><dt>Coberturas activas</dt></div>
      </dl>
    </Card>}
  </main>;
}
