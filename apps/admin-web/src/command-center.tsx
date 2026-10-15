import React from 'react';
import { useCommandCenter } from './app-shell.js';

const api = import.meta.env?.VITE_API_URL ?? 'http://127.0.0.1:3100';
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

function attentionStatus(kind: string) {
  if (kind === 'overdue_payments') return 'Vencido';
  if (kind === 'waitlist') return 'Lista de espera';
  if (kind === 'unassigned_session') return 'Sin asignar';
  if (kind === 'open_timeclock') return 'Por cerrar';
  if (kind === 'absence_sessions') return 'Sesiones afectadas';
  return 'Revisar';
}

function ItemLink({ href, children, className = '' }: { href: string; children: React.ReactNode; className?: string }) {
  return safeInternalHref(href)
    ? <a className={className} href={href}>{children}</a>
    : <div className={`${className} is-unlinked`}>{children}</div>;
}

export function CommandCenter() {
  const { data, state, error, reload } = useCommandCenter();
  const today = new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  if (state === 'loading') return <main className="command-center" id="home"><header className="summary-heading"><div><div className="eyebrow">CENTRO DE OPERACIONES</div><h1>Resumen</h1><p>{today} · Lo importante de hoy y lo que requiere tu atención.</p></div></header><section className="summary-state" role="status"><span className="spinner"/> Preparando tu resumen…</section></main>;
  if (state === 'error' || !data) return <main className="command-center" id="home"><header className="summary-heading"><div><div className="eyebrow">CENTRO DE OPERACIONES</div><h1>Resumen</h1><p>{today} · Lo importante de hoy y lo que requiere tu atención.</p></div></header><section className="summary-state summary-error" role="alert"><strong>No se pudo cargar el resumen</strong><span>{error}</span><button className="button secondary" onClick={() => void reload()}>Reintentar</button></section></main>;

  const permissions = data.permissions;
  const attentionItems = data.attention.filter(item => !pendingKinds.has(item.kind));
  const pendingItems = data.attention.filter(item => pendingKinds.has(item.kind));
  const canSeeAttention = permissions.calendar || permissions.billing || permissions.staff;
  const canSeePending = permissions.communications || permissions.transfers || (permissions.documents && permissions.clients) || (permissions.followup && permissions.clients);
  const allSessions = data.today.sessions ?? [];
  const now = Date.now();
  const currentSessions = allSessions.filter(session => session.isNow);
  const upcomingSessions = allSessions.filter(session => !session.isNow && Date.parse(session.startsAt) >= now);
  const endedSessions = allSessions.filter(session => !session.isNow && Date.parse(session.startsAt) < now).sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  const sessions = [...currentSessions, ...upcomingSessions, ...endedSessions].slice(0, 5);
  const moreSessions = Math.max(0, allSessions.length - sessions.length);

  return <main className="command-center" id="home">
    <header className="summary-heading">
      <div><div className="eyebrow">CENTRO DE OPERACIONES</div><h1>Resumen</h1><p>{today} · Lo importante de hoy y lo que requiere tu atención.</p></div>
      <button className="button secondary" onClick={() => void reload()}>Actualizar</button>
    </header>

    {permissions.calendar && <section className="summary-agenda panel" aria-labelledby="summary-agenda-title">
      <div className="summary-section-heading">
        <div><div className="eyebrow">HOY · ATLANTIC/CANARY</div><h2 id="summary-agenda-title">Agenda de hoy</h2><p>{data.today.sessionCount} {data.today.sessionCount === 1 ? 'sesión programada' : 'sesiones programadas'}</p></div>
        <a className="button secondary" href="#calendar">Abrir agenda</a>
      </div>
      <dl className="summary-agenda-stats">
        <div><dt>Reservas</dt><dd>{data.today.occupied}</dd></div>
        <div><dt>Plazas libres</dt><dd>{Math.max(0, data.today.capacity - data.today.occupied)}</dd></div>
        <div><dt>En lista de espera</dt><dd>{data.today.waitlistCount}</dd></div>
      </dl>
      {sessions.length === 0
        ? <div className="summary-empty"><strong>No hay sesiones programadas hoy</strong><span>Consulta la agenda para ver otros días o preparar la próxima sesión.</span><a href="#calendar">Ir a la agenda <span aria-hidden="true">↗</span></a></div>
        : <ul className="summary-session-list" aria-label="Próximas sesiones de hoy">{sessions.map(session => <li key={session.id}>
          <ItemLink href="#calendar" className={`summary-session-row ${session.isNow ? 'is-current' : ''}`}>
            <time dateTime={session.startsAt}>{dateTime(session.startsAt)}</time>
            <span className="summary-session-main"><strong>{session.serviceName}</strong><small>{session.professionalName ?? 'Profesional sin asignar'}{session.state === 'in_progress' ? ' · En curso' : session.state === 'finished' ? ' · Finalizada' : ''}</small></span>
            <span className="summary-session-capacity"><strong>{session.occupied}/{session.capacity}</strong></span>
            {session.waitlistCount > 0 && <span className="summary-session-waitlist has-waitlist">{session.waitlistCount} en espera</span>}
            <span className="summary-row-arrow" aria-hidden="true">↗</span>
          </ItemLink>
        </li>)}</ul>}
      {moreSessions > 0 && <p className="summary-more-sessions">+{moreSessions} {moreSessions === 1 ? 'sesión' : 'sesiones'} hoy · <a href="#calendar">Ver todas en la agenda</a></p>}
    </section>}

    <div className="summary-work-grid">
      {canSeeAttention && <section className="summary-panel panel" aria-labelledby="summary-attention-title">
        <div className="summary-section-heading"><div><div className="eyebrow">ACCIÓN</div><h2 id="summary-attention-title">Necesitan atención</h2></div><span className="summary-count">{attentionItems.length}</span></div>
        {attentionItems.length === 0
          ? <div className="summary-empty"><strong>Todo al día</strong><span>No hay incidencias operativas en las áreas disponibles para tu perfil.</span></div>
          : <ul className="summary-item-list">{attentionItems.map(item => <li key={item.id}><ItemLink href={item.href} className="summary-item-link"><span className={`summary-item-mark ${item.kind === 'overdue_payments' ? 'is-urgent' : ''}`} aria-hidden="true"/><span className="summary-item-copy"><strong>{item.title}</strong><small>{item.summary}</small></span><span className="summary-item-meta">{date(item.ageAt)}<b>{attentionStatus(item.kind)}</b></span><span className="summary-row-arrow" aria-hidden="true">›</span></ItemLink></li>)}</ul>}
      </section>}

      {canSeePending && <section className="summary-panel panel" aria-labelledby="summary-pending-title">
        <div className="summary-section-heading"><div><div className="eyebrow">BANDEJAS</div><h2 id="summary-pending-title">Pendientes</h2></div><span className="summary-count">{pendingItems.length + (permissions.communications && data.unread > 0 ? 1 : 0)}</span></div>
        <ul className="summary-item-list">
          {permissions.communications && <li><ItemLink href="#communications" className="summary-item-link"><span className="summary-item-mark" aria-hidden="true"/><span className="summary-item-copy"><strong>{data.unread ? `${data.unread} ${data.unread === 1 ? 'mensaje sin leer' : 'mensajes sin leer'}` : 'Bandeja de mensajes'}</strong><small>{data.unread ? 'Hay conversaciones que esperan respuesta' : 'No hay mensajes sin leer'}</small></span><span className="summary-item-meta"><b>{data.unread ? 'Responder' : 'Ver bandeja'}</b></span><span className="summary-row-arrow" aria-hidden="true">›</span></ItemLink></li>}
          {pendingItems.map(item => <li key={item.id}><ItemLink href={item.href} className="summary-item-link"><span className="summary-item-mark" aria-hidden="true"/><span className="summary-item-copy"><strong>{item.title}</strong><small>{item.summary}</small></span><span className="summary-item-meta">{date(item.ageAt)}<b>{item.kind === 'pending_transfers' ? 'Validar' : item.kind === 'overdue_checkin' ? 'Seguimiento' : 'Revisar'}</b></span><span className="summary-row-arrow" aria-hidden="true">›</span></ItemLink></li>)}
        </ul>
        {pendingItems.length === 0 && (!permissions.communications || data.unread === 0) && <div className="summary-empty"><strong>No tienes trabajo pendiente en tus bandejas</strong><span>Se mostrarán aquí los mensajes y revisiones disponibles para tu perfil.</span></div>}
      </section>}
    </div>

    {(permissions.staff && data.team || permissions.billing && data.economics) && <div className="summary-support-grid">
      {permissions.staff && data.team && <section className="summary-panel summary-compact-panel panel" aria-labelledby="summary-team-title"><div className="summary-section-heading"><div><div className="eyebrow">EQUIPO</div><h2 id="summary-team-title">Pulso operativo</h2></div><a className="summary-text-link" href="#staff">Ver equipo</a></div><dl className="summary-compact-stats"><div><dd>{data.team.workingNow}</dd><dt>Trabajando ahora</dt></div><div><dd>{data.team.activeAbsences}</dd><dt>Ausencias activas</dt></div><div><dd>{data.team.substitutions}</dd><dt>Coberturas activas</dt></div></dl></section>}
      {permissions.billing && data.economics && <section className="summary-panel summary-compact-panel panel" aria-labelledby="summary-economics-title"><div className="summary-section-heading"><div><div className="eyebrow">ECONOMÍA · ACCESO AUTORIZADO</div><h2 id="summary-economics-title">Pendiente de gestión</h2></div><a className="summary-text-link" href="#economics">Abrir economía</a></div><dl className="summary-compact-stats summary-finance-stats"><div><dd>{money(Number(data.economics.pendingCents))}</dd><dt>Pendiente de cobro</dt></div><div><dd>{data.economics.overdueCount}</dd><dt>Cargos vencidos</dt></div>{data.permissions.cash && <div><dd>{data.economics.cashSession ? data.economics.cashSession.status === 'open' ? 'Abierta' : 'Cerrada' : 'Sin abrir'}</dd><dt>Caja de hoy</dt></div>}</dl></section>}
    </div>}
  </main>;
}
