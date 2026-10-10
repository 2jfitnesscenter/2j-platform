import React from 'react';

type View = 'home' | 'book' | 'bookings' | 'profile';
type ClientProfile = { id: string; firstName: string; lastName: string; email: string | null; phone?: string | null; status: string };
type ClientSession = { id: string; startsAt: string; durationMinutes: number; capacity: number; status: string; isIndividual: boolean; serviceId: string; serviceName: string; areaName: string; professionalName: string | null; myReservationStatus: string | null; myWaitlistStatus: string | null; occupiedCount: number; waitlistCount: number; eligible?: boolean; eligibilityReason?: string | null; canJoinWaitlist?: boolean; availableAlternatives?: Array<{ assignmentId: string; planName?: string }> };
type Booking = { id: string; status: string; sessionId: string; startsAt: string; durationMinutes: number; serviceName: string; areaName: string; sessionStatus: string; isIndividual: boolean };
type FormAssignment = { id: string; status: string; required: boolean; dueAt: string | null; name: string; category: string; version: number };
type FormField = { id: string; label: string; type: string; required: boolean; options?: string[] };
type FormDetail = FormAssignment & { description: string; sensitivity: string; fields: FormField[] };
type Consent = { consentId: string; versionId: string; title: string; body: string; version: number; required: boolean; accepted: boolean };
type Assignment = { id: string; planName: string; kind: string; status: string; startsOn: string; endsOn: string | null; lastEvent: string; rights: Array<{ rightType: string; quantity: number | null; balance: number | null }>; modules?: Array<{ module: string; accessLevel: string }> };
type ApiState = { profile: ClientProfile; membership: { assignments: Assignment[]; active: Assignment[] }; bookings: { reservations: Booking[]; waitlist: Booking[] }; sessions: ClientSession[] };

const labels: Record<string, string> = { session_full: 'La sesión está completa', service_archived: 'El servicio ya no está disponible', area_archived: 'El área ya no está disponible', no_active_entitlement: 'No hay un derecho activo para este servicio', no_entitlement: 'No hay un derecho activo para este servicio', entitlement_required: 'Elige un plan o bono para reservar', entitlement_unavailable: 'No hay un derecho disponible para esta sesión', entitlement_not_started: 'Tu plan aún no ha comenzado', entitlement_expired: 'Tu plan ha caducado', entitlement_paused: 'Tu plan está en pausa', entitlement_cancelled: 'Tu plan ya no está activo', entitlement_exhausted: 'Has utilizado todas las sesiones de este bono', insufficient_balance: 'No tienes saldo suficiente', weekly_limit_reached: 'Has alcanzado tu límite semanal', monthly_limit_reached: 'Has alcanzado tu límite mensual', service_not_allowed: 'Este servicio no está incluido en tu plan', client_inactive: 'Tu cuenta no está activa', session_started: 'Esta sesión ya ha comenzado', debt_restriction: 'Hay un saldo pendiente que impide reservar', booking_conflict: 'Ya tienes otra actividad a esa hora', duplicate_booking: 'Ya tienes una reserva o estás en espera', required_document_missing: 'Tienes un documento pendiente', session_cancelled: 'Esta sesión ya no está disponible', internal_error: 'Ahora no podemos consultar tu espacio.', database_unavailable: 'Ahora no podemos conectar con el centro.', authentication_required: 'Inicia sesión para continuar.' };
const keyFor = (operation: string) => {
  const storageKey = `2j:${operation}:idempotency`;
  let key = sessionStorage.getItem(storageKey);
  if (!key) { key = crypto.randomUUID(); sessionStorage.setItem(storageKey, key); }
  return { key, clear: () => sessionStorage.removeItem(storageKey) };
};
const dateKey = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const shiftDateKey = (value: string, days: number) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.UTC(year!, month! - 1, day! + days, 12)));
};
const weekRange = (selected = dateKey(new Date())) => {
  const [year, month, day] = selected.split('-').map(Number); const date = new Date(Date.UTC(year!, month! - 1, day!, 12));
  const weekday = (date.getUTCDay() + 6) % 7; const from = shiftDateKey(selected, -weekday);
  return { from, to: shiftDateKey(from, 6) };
};
const dateLabel = (value: string) => new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(value));
const timeLabel = (value: string) => new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const dayLabel = (value: string) => new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', weekday: 'short' }).format(new Date(value));

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const origin = import.meta.env?.VITE_API_BASE_URL?.replace(/\/+$/, '') ?? '';
  const response = await fetch(`${origin}${path}`, { ...init, headers: { 'content-type': 'application/json', ...init?.headers }, credentials: 'include', cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? 'No se ha podido completar la solicitud.');
  return body as T;
}

export function ClientApp() {
  const [view, setView] = React.useState<View>('home');
  const [selectedDate, setSelectedDate] = React.useState(() => dateKey(new Date()));
  const [profile, setProfile] = React.useState<ClientProfile | null>(null);
  const [membership, setMembership] = React.useState<Assignment[]>([]);
  const [reservations, setReservations] = React.useState<Booking[]>([]);
  const [waitlist, setWaitlist] = React.useState<Booking[]>([]);
  const [sessions, setSessions] = React.useState<ClientSession[]>([]);
  const [forms, setForms] = React.useState<FormAssignment[]>([]);
  const [consents, setConsents] = React.useState<Consent[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState('');
  const [selectedSession, setSelectedSession] = React.useState<ClientSession | null>(null);
  const [selectedForm, setSelectedForm] = React.useState<FormDetail | null>(null);
  const [selectedConsent, setSelectedConsent] = React.useState<Consent | null>(null);
  const [formAnswers, setFormAnswers] = React.useState<Record<string, unknown>>({});
  const [typedName, setTypedName] = React.useState('');
  const [consentChecked, setConsentChecked] = React.useState(false);
  const [dialogError, setDialogError] = React.useState('');
  const [selectedAssignment, setSelectedAssignment] = React.useState('');
  const dialogOpener = React.useRef<HTMLElement | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true); setError('');
    try {
      const { from, to } = weekRange(selectedDate);
      const [me, plans, mine, agenda, documents, consentItems] = await Promise.all([
        api<{ profile: ClientProfile }>('/api/me'),
        api<{ assignments: Assignment[] }>('/api/me/membership'),
        api<{ reservations: Booking[]; waitlist: Booking[] }>('/api/me/bookings'),
        api<{ sessions: ClientSession[] }>(`/api/me/sessions?from=${from}&to=${to}`),
        api<FormAssignment[]>('/api/client-portal/form-assignments'),
        api<Consent[]>('/api/client-portal/consents'),
      ]);
      setProfile(me.profile); setMembership(plans.assignments); setReservations(mine.reservations); setWaitlist(mine.waitlist); setSessions(agenda.sessions); setForms(documents); setConsents(consentItems);
    } catch (cause) { const message = cause instanceof Error ? cause.message : ''; setError(message === 'client_authentication_required' ? message : labels[message] ?? 'No se han podido cargar tus datos.'); }
    finally { setLoading(false); }
  }, [selectedDate]);
  React.useEffect(() => { void refresh(); }, [refresh]);
  React.useEffect(() => {
    if (!selectedSession && !selectedForm && !selectedConsent) return;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    dialog?.querySelector<HTMLButtonElement>('.sheet-close')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setSelectedSession(null); setSelectedForm(null); setSelectedConsent(null); return; }
      if (event.key !== 'Tab' || !dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href]')];
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); if (dialogOpener.current?.isConnected) dialogOpener.current.focus(); };
  }, [selectedSession?.id, selectedForm?.id, selectedConsent?.versionId]);

  const openSession = async (session: ClientSession) => {
    dialogOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMessage(''); setSelectedAssignment(''); setSelectedSession(session);
    try {
      const result = await api<{ session: ClientSession }>(`/api/me/sessions/${session.id}`);
      setSelectedSession(result.session);
      setSelectedAssignment(result.session.availableAlternatives?.length === 1 ? result.session.availableAlternatives[0]!.assignmentId : '');
    } catch (cause) { setMessage(cause instanceof Error ? labels[cause.message] ?? 'No se ha podido consultar la sesión.' : 'No se ha podido consultar la sesión.'); }
  };
  const openForm = async (form: FormAssignment) => {
    dialogOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDialogError(''); setFormAnswers({}); setSelectedForm({ ...form, description: '', sensitivity: 'operational', fields: [] });
    try { setSelectedForm(await api<FormDetail>(`/api/client-portal/form-assignments/${form.id}`)); }
    catch { setDialogError('No se ha podido abrir el documento. Inténtalo de nuevo.'); }
  };
  const submitForm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selectedForm) return;
    if (selectedForm.fields.some(field => { const answer = formAnswers[field.id]; return field.required && (answer === undefined || answer === '' || (field.type === 'acceptance' && answer !== true) || (Array.isArray(answer) && answer.length === 0)); })) { setDialogError('Completa los campos obligatorios antes de continuar.'); return; }
    setBusy(`form:${selectedForm.id}`); setDialogError(''); const operation = keyFor(`form:${selectedForm.id}`);
    try { await api(`/api/client-portal/form-assignments/${selectedForm.id}/respond`, { method: 'POST', headers: { 'idempotency-key': operation.key }, body: JSON.stringify({ answers: formAnswers }) }); operation.clear(); setSelectedForm(null); setMessage('Documento enviado para revisión.'); await refresh(); }
    catch { setDialogError('No se ha podido enviar el documento. Puedes volver a intentarlo.'); }
    finally { setBusy(null); }
  };
  const openConsent = (consent: Consent) => { dialogOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setDialogError(''); setTypedName(''); setConsentChecked(false); setSelectedConsent(consent); };
  const acceptConsent = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selectedConsent) return;
    if (!consentChecked || !typedName.trim()) { setDialogError('Marca tu aceptación e indica tu nombre completo.'); return; }
    setBusy(`consent:${selectedConsent.versionId}`); setDialogError(''); const operation = keyFor(`consent:${selectedConsent.versionId}`);
    try { await api(`/api/client-portal/consents/${selectedConsent.versionId}/accept`, { method: 'POST', headers: { 'idempotency-key': operation.key }, body: JSON.stringify({ typedName, accepted: true }) }); operation.clear(); setSelectedConsent(null); setMessage('Tu aceptación se ha guardado.'); await refresh(); }
    catch { setDialogError('No se ha podido guardar la aceptación. Puedes volver a intentarlo.'); }
    finally { setBusy(null); }
  };
  const reserve = async (session: ClientSession, joinWaitlist = false) => {
    const id = `${joinWaitlist ? 'waitlist' : 'reserve'}:${session.id}:${selectedAssignment || 'automatic'}`; setBusy(id); setMessage('');
    const operation = keyFor(id);
    try {
      await api(joinWaitlist ? `/api/me/sessions/${session.id}/waitlist` : `/api/me/sessions/${session.id}/reservations`, { method: 'POST', headers: { 'idempotency-key': operation.key }, body: JSON.stringify(selectedAssignment ? { entitlementAssignmentId: selectedAssignment } : {}) });
      operation.clear(); setMessage(joinWaitlist ? 'Ya estás en la lista de espera.' : 'Tu plaza está reservada.'); await refresh();
    } catch (cause) { setMessage(cause instanceof Error ? labels[cause.message] ?? 'No se ha podido completar la reserva. Puedes volver a intentarlo.' : 'No se ha podido completar la reserva. Puedes volver a intentarlo.'); }
    finally { setBusy(null); }
  };
  const cancelBooking = async (booking: Booking) => {
    try {
      const preview = await api<{ canCancel: boolean; cancellation: { summary: string } }>(`/api/me/bookings/${booking.id}/cancellation-preview`);
      if (!preview.canCancel) { setMessage('Esta reserva ya no se puede cancelar.'); await refresh(); return; }
      if (!window.confirm(`¿Quieres cancelar esta reserva? ${preview.cancellation.summary}`)) return;
    } catch (cause) { setMessage(cause instanceof Error ? 'No se ha podido consultar la política de cancelación.' : 'No se ha podido consultar la política de cancelación.'); return; }
    const key = keyFor(`cancel:${booking.id}`); setBusy(booking.id); setMessage('');
    try { await api(`/api/me/bookings/${booking.id}/cancel`, { method: 'PATCH', headers: { 'idempotency-key': key.key }, body: '{}' }); key.clear(); setMessage('La reserva se ha cancelado.'); await refresh(); }
    catch (cause) { setMessage(cause instanceof Error ? labels[cause.message] ?? 'No se ha podido cancelar. Inténtalo de nuevo.' : 'No se ha podido cancelar. Inténtalo de nuevo.'); }
    finally { setBusy(null); }
  };
  const leaveWaitlist = async (entry: Booking) => {
    if (!window.confirm('¿Quieres salir de la lista de espera?')) return;
    const key = keyFor(`leave-waitlist:${entry.id}`); setBusy(entry.id); setMessage('');
    try { await api(`/api/me/waitlist/${entry.id}/cancel`, { method: 'PATCH', headers: { 'idempotency-key': key.key }, body: '{}' }); key.clear(); setMessage('Has salido de la lista de espera.'); await refresh(); }
    catch (cause) { setMessage(cause instanceof Error ? labels[cause.message] ?? 'No se ha podido actualizar la lista.' : 'No se ha podido actualizar la lista.'); }
    finally { setBusy(null); }
  };

  const upcoming = reservations.filter(row => row.status === 'reserved' && new Date(row.startsAt).getTime() >= Date.now()).sort((a,b) => a.startsAt.localeCompare(b.startsAt));
  const sessionsForSelectedDay = sessions.filter(session => dateKey(new Date(session.startsAt)) === selectedDate);
  const activePlans = membership.filter(plan => plan.status === 'active' && plan.lastEvent !== 'paused');
  const alternatives = selectedSession?.availableAlternatives ?? [];
  const pendingDocuments = forms.filter(form => form.required && (form.status === 'assigned' || form.status === 'rejected'));
  const pendingConsents = consents.filter(consent => consent.required && !consent.accepted);
  return <div className="client-app">
    <header className="client-header"><a className="client-brand" href="#home" onClick={() => setView('home')} aria-label="2J Fitness, inicio"><span className="client-mark">2J</span><span><strong>2J Fitness</strong><small>Tu espacio</small></span></a><button className="avatar" aria-label="Mi perfil" onClick={() => setView('profile')}>{profile?.firstName?.slice(0,1) ?? '·'}</button></header>
    <main className="client-main" id="main-content">
      {loading && <div className="loading-card" role="status"><span className="spinner"/> Cargando tu espacio…</div>}
      {!loading && error && <section className="state-card error-card" role="alert"><span className="state-icon">!</span><h1>Tu espacio no está disponible ahora</h1><p>{error === 'client_authentication_required' ? 'Inicia sesión con tu cuenta para consultar tus reservas y derechos.' : 'Comprueba tu conexión e inténtalo de nuevo.'}</p><button className="button primary" onClick={() => void refresh()}>Intentar de nuevo</button></section>}
      {!loading && !error && profile && <>
        {message && view !== 'bookings' && !selectedSession && <p className="inline-message page-message" role="status">{message}</p>}
        {view === 'home' && <>
          <section className="welcome"><p className="eyebrow">TU CENTRO · 2J FITNESS</p><h1>Hola, {profile.firstName}</h1><p>Tu entrenamiento empieza con un buen plan.</p><button className="button primary" onClick={() => setView('book')}>Reservar una sesión <span aria-hidden="true">→</span></button></section>
          <div className="section-heading"><div><p className="eyebrow">A CONTINUACIÓN</p><h2>Próximas reservas</h2></div><button className="text-button" onClick={() => setView('bookings')}>Ver todas</button></div>
          {upcoming.length ? <div className="booking-stack">{upcoming.slice(0,2).map(row => <BookingCard key={row.id} booking={row} busy={busy === row.id} onCancel={() => void cancelBooking(row)}/>)}</div> : <section className="empty-card"><span className="empty-mark">✳</span><h3>Tu semana está abierta</h3><p>Busca una sesión y reserva tu próxima visita.</p><button className="button secondary" onClick={() => setView('book')}>Explorar sesiones</button></section>}
          <section className="membership-card"><div className="membership-top"><span className="plan-symbol">✦</span><div><p className="eyebrow">TU PLAN</p><h2>{activePlans[0]?.planName ?? 'Sin plan activo'}</h2></div><span className="active-pill">{activePlans.length ? 'Activo' : 'Consultar'}</span></div><div className="membership-details">{activePlans[0]?.rights?.filter(right => right.rightType === 'sessions_quota').map((right,index) => <div key={index}><span>Sesiones disponibles</span><strong>{right.balance ?? '—'}</strong></div>) ?? <p>Consulta en recepción las opciones disponibles para ti.</p>}</div></section>
          {activePlans.some(plan => plan.modules?.some(module => module.module === 'training')) && <section className="module-card"><span className="plan-symbol" aria-hidden="true">↗</span><div><p className="eyebrow">MÓDULO 2J</p><h2>Entrenamiento</h2><p>Tu acceso está disponible. El contenido se abrirá desde Búnker.</p></div></section>}
          {(pendingDocuments.length > 0 || pendingConsents.length > 0) && <button className="notice-card" onClick={() => setView('profile')}><span aria-hidden="true">!</span><span><strong>Documentación pendiente</strong><small>{pendingDocuments.length + pendingConsents.length} elemento{pendingDocuments.length + pendingConsents.length === 1 ? '' : 's'} requiere{pendingDocuments.length + pendingConsents.length === 1 ? '' : 'n'} tu atención</small></span><span aria-hidden="true">→</span></button>}
        </>}
        {view === 'book' && <><div className="page-intro"><p className="eyebrow">HORARIO DEL CENTRO · ATLANTIC/CANARY</p><h1>Reserva tu sesión</h1><p>Elige la actividad que mejor encaje en tu semana.</p></div><div className="week-navigation"><button className="quiet-button" aria-label="Semana anterior" onClick={() => setSelectedDate(value => shiftDateKey(value, -7))}>‹</button><span>{dateLabel(`${weekRange(selectedDate).from}T12:00:00Z`)} – {dateLabel(`${weekRange(selectedDate).to}T12:00:00Z`)}</span><button className="quiet-button" aria-label="Semana siguiente" onClick={() => setSelectedDate(value => shiftDateKey(value, 7))}>›</button></div><div className="week-strip" aria-label="Elige un día">{weekRangeDays(selectedDate).map(day => <button type="button" key={day.date} aria-pressed={selectedDate === day.date} className={`day-chip${day.today ? ' today' : ''}${selectedDate === day.date ? ' selected' : ''}`} onClick={() => setSelectedDate(day.date)}><small>{day.label}</small><strong>{day.number}</strong></button>)}</div><div className="section-heading compact"><div><p className="eyebrow">{dateLabel(`${selectedDate}T12:00:00Z`)}</p><h2>Sesiones disponibles</h2></div></div>{sessionsForSelectedDay.length ? <div className="session-list">{sessionsForSelectedDay.map(session => <SessionCard key={session.id} session={session} onSelect={() => void openSession(session)}/>)}</div> : <section className="empty-card"><span className="empty-mark">✳</span><h3>No hay sesiones este día</h3><p>Elige otra fecha o vuelve a consultar pronto.</p></section>}</>}
        {view === 'bookings' && <><div className="page-intro"><p className="eyebrow">TU ACTIVIDAD</p><h1>Mis reservas</h1><p>Consulta próximas sesiones y tu historial.</p></div>{message && <p className="inline-message" role="status">{message}</p>}<h2 className="subheading">Próximas</h2>{upcoming.length ? <div className="booking-stack">{upcoming.map(row => <BookingCard key={row.id} booking={row} busy={busy === row.id} onCancel={() => void cancelBooking(row)}/>)}</div> : <p className="muted">Todavía no tienes reservas próximas.</p>}<h2 className="subheading">Lista de espera</h2>{waitlist.filter(row => row.status === 'waiting').length ? <div className="booking-stack">{waitlist.filter(row => row.status === 'waiting').map(row => <BookingCard key={row.id} booking={row} waiting busy={busy === row.id} onCancel={() => void leaveWaitlist(row)}/>)}</div> : <p className="muted">No estás en ninguna lista de espera.</p>}<h2 className="subheading">Historial</h2>{reservations.filter(row => row.status !== 'reserved' || new Date(row.startsAt).getTime() < Date.now()).slice(0,6).map(row => <BookingCard key={row.id} booking={row} compact/>)}{waitlist.filter(row => row.status !== 'waiting').slice(0,6).map(row => <BookingCard key={row.id} booking={row} waiting compact/>)}</>}
        {view === 'profile' && <>
          <div className="page-intro"><p className="eyebrow">TU CUENTA</p><h1>Perfil</h1><p>Tu información y derechos activos.</p></div>
          <section className="profile-card"><div className="profile-avatar">{profile.firstName[0]}{profile.lastName[0]}</div><div><h2>{profile.firstName} {profile.lastName}</h2><p>{profile.email ?? 'Email no indicado'}</p>{profile.phone && <p>{profile.phone}</p>}</div></section>
          <div className="section-heading"><div><p className="eyebrow">MEMBRESÍA</p><h2>Planes y derechos</h2></div></div>
          {membership.length ? membership.map(plan => (
            <section className="plan-row" key={plan.id}><div><strong>{plan.planName}</strong><span>{plan.startsOn}{plan.endsOn ? ` · hasta ${plan.endsOn}` : ''}</span></div><span className="active-pill">{plan.status === 'active' ? 'Activo' : plan.status === 'paused' ? 'Pausado' : plan.status}</span></section>
          )) : <p className="muted">No encontramos planes asociados a tu cuenta.</p>}
          <div className="section-heading"><div><p className="eyebrow">TU CENTRO</p><h2>Documentación y consentimientos</h2></div></div>
          {forms.length ? forms.map(form => (
            <section className="plan-row document-row" key={form.id}><div><strong>{form.name}</strong><span>{form.status === 'assigned' ? 'Pendiente de completar' : form.status === 'rejected' ? 'Requiere una corrección · consulta en recepción' : 'En revisión por el centro'}</span></div>{form.status === 'assigned' && <button className="quiet-button" onClick={() => void openForm(form)}>Completar</button>}</section>
          )) : <p className="muted">No tienes formularios pendientes.</p>}
          {consents.map(consent => (
            <section className="plan-row document-row" key={consent.versionId}><div><strong>{consent.title}</strong><span>{consent.accepted ? 'Aceptado' : consent.required ? 'Pendiente de aceptar' : 'Opcional'}</span></div>{!consent.accepted && <button className="quiet-button" onClick={() => openConsent(consent)}>Consultar</button>}</section>
          ))}
        </>}
      </>}
    </main>
    {!loading && !error && profile && <nav className="bottom-nav" aria-label="Navegación principal">{([['home','Inicio','⌂'],['book','Reservar','＋'],['bookings','Mis reservas','▦'],['profile','Perfil','◉']] as const).map(([id,label,icon]) => <button key={id} className={view === id ? 'nav-button active' : 'nav-button'} aria-current={view === id ? 'page' : undefined} onClick={() => { setView(id); setMessage(''); }}><span aria-hidden="true">{icon}</span><small>{label}</small></button>)}</nav>}
    {selectedSession && <div className="sheet-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedSession(null); }}><section className="session-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><button className="sheet-close" aria-label="Cerrar detalle" onClick={() => setSelectedSession(null)}>×</button><p className="eyebrow">DETALLE DE SESIÓN</p><h2 id="sheet-title">{selectedSession.serviceName}</h2><p className="sheet-subtitle">{dateLabel(selectedSession.startsAt)} · {timeLabel(selectedSession.startsAt)} · {selectedSession.areaName}</p><div className="sheet-capacity"><span>Plazas disponibles</span><strong>{Math.max(0, selectedSession.capacity - selectedSession.occupiedCount)}</strong></div>{alternatives.length > 1 && <label className="field-label">Usar derecho<select value={selectedAssignment} onChange={event => setSelectedAssignment(event.target.value)}><option value="">Elige un plan o bono</option>{alternatives.map(item => <option key={item.assignmentId} value={item.assignmentId}>{item.planName ?? 'Plan activo'}</option>)}</select></label>}{message && <p className="inline-message" role="status">{message}</p>}{selectedSession.eligible && <button className="button primary full" disabled={busy !== null || (alternatives.length > 1 && !selectedAssignment)} onClick={() => void reserve(selectedSession)}>{busy?.startsWith('reserve') ? 'Reservando…' : 'Confirmar reserva'}</button>}{selectedSession.canJoinWaitlist && <button className="button secondary full" disabled={busy !== null} onClick={() => void reserve(selectedSession,true)}>{busy?.startsWith('waitlist') ? 'Añadiendo…' : 'Apuntarme a la lista de espera'}</button>}{!selectedSession.eligible && !selectedSession.canJoinWaitlist && <p className="eligibility-note">{labels[selectedSession.eligibilityReason ?? ''] ?? 'Esta sesión no está disponible para reservar ahora.'}</p>}<p className="sheet-footnote">La reserva utiliza las reglas y los derechos vigentes de tu cuenta.</p></section></div>}
    {selectedForm && <div className="sheet-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedForm(null); }}><section className="session-sheet document-sheet" role="dialog" aria-modal="true" aria-labelledby="form-title"><button className="sheet-close" aria-label="Cerrar formulario" onClick={() => setSelectedForm(null)}>×</button><p className="eyebrow">DOCUMENTACIÓN DEL CENTRO</p><h2 id="form-title">{selectedForm.name}</h2>{selectedForm.description && <p className="muted">{selectedForm.description}</p>}{dialogError && selectedForm.fields.length === 0 ? <><p className="inline-message" role="alert">{dialogError}</p><button className="button secondary full" onClick={() => void openForm(selectedForm)}>Intentar de nuevo</button></> : <form onSubmit={event => void submitForm(event)}>{selectedForm.fields.map(field => <DocumentField key={field.id} field={field} value={formAnswers[field.id]} onChange={value => setFormAnswers(current => ({ ...current, [field.id]: value }))}/>)}{dialogError && <p className="inline-message" role="alert">{dialogError}</p>}<button className="button primary full" disabled={busy === `form:${selectedForm.id}`}>{busy === `form:${selectedForm.id}` ? 'Enviando…' : 'Enviar documento'}</button></form>}</section></div>}
    {selectedConsent && <div className="sheet-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedConsent(null); }}><section className="session-sheet document-sheet" role="dialog" aria-modal="true" aria-labelledby="consent-title"><button className="sheet-close" aria-label="Cerrar consentimiento" onClick={() => setSelectedConsent(null)}>×</button><p className="eyebrow">CONSENTIMIENTO DEL CENTRO</p><h2 id="consent-title">{selectedConsent.title}</h2><div className="consent-copy">{selectedConsent.body}</div><form onSubmit={event => void acceptConsent(event)}><label className="consent-check"><input type="checkbox" checked={consentChecked} onChange={event => setConsentChecked(event.target.checked)}/>He leído y acepto este consentimiento.</label><label className="field-label">Nombre completo<input autoComplete="name" value={typedName} onChange={event => setTypedName(event.target.value)} required maxLength={160}/></label>{dialogError && <p className="inline-message" role="alert">{dialogError}</p>}<button className="button primary full" disabled={busy === `consent:${selectedConsent.versionId}`}>{busy === `consent:${selectedConsent.versionId}` ? 'Guardando…' : 'Confirmar aceptación'}</button></form></section></div>}
  </div>;
}

function SessionCard({ session, onSelect }: { session: ClientSession; onSelect: () => void }) {
  const free = Math.max(0, session.capacity - session.occupiedCount);
  const ownStatus = session.myReservationStatus ? 'Ya estás en esta sesión' : session.myWaitlistStatus === 'waiting' ? 'Estás en lista de espera' : session.myWaitlistStatus === 'promoted' ? 'Plaza confirmada' : null;
  return <button className="session-card" onClick={onSelect}><div className="session-time"><strong>{timeLabel(session.startsAt)}</strong><span>{dayLabel(session.startsAt)} · {dateLabel(session.startsAt).split(' ')[1]}</span></div><div className="session-info"><strong>{session.serviceName}</strong><span>{session.areaName}{session.isIndividual ? ' · Cita individual' : ''}{session.professionalName ? ` · ${session.professionalName}` : ''}</span><div className="session-meta"><span>{ownStatus ?? (free > 0 ? `${free} ${free === 1 ? 'plaza libre' : 'plazas libres'}` : 'Completa')}</span>{!ownStatus && session.waitlistCount > 0 && <span>Espera {session.waitlistCount}</span>}</div></div><span className="session-arrow" aria-hidden="true">→</span></button>;
}
function BookingCard({ booking, waiting = false, compact = false, busy = false, onCancel }: { booking: Booking; waiting?: boolean; compact?: boolean; busy?: boolean; onCancel?: () => void }) {
  const statusLabel = waiting ? booking.status === 'waiting' ? 'En lista de espera' : booking.status === 'promoted' ? 'Convertida en reserva' : booking.status === 'cancelled_by_center' ? 'Cancelada por el centro' : 'Lista de espera cancelada' : booking.status === 'reserved' ? 'Confirmada' : booking.status === 'attended' ? 'Asistió' : booking.status === 'no_show' ? 'No asistió' : booking.status === 'cancelled_by_center' ? 'Cancelada por el centro' : booking.status === 'cancelled_late' ? 'Cancelación tardía' : 'Cancelada';
  return <article className={`booking-card${compact ? ' compact' : ''}`}><div className="booking-date"><strong>{timeLabel(booking.startsAt)}</strong><span>{new Intl.DateTimeFormat('es-ES',{timeZone:'Atlantic/Canary',day:'2-digit',month:'short'}).format(new Date(booking.startsAt))}</span></div><div className="booking-detail"><strong>{booking.serviceName}{booking.isIndividual ? ' · Individual' : ''}</strong><span>{booking.areaName}</span><small>{statusLabel}</small></div>{onCancel && <button className="quiet-button" onClick={onCancel} disabled={busy}>{busy ? '…' : waiting ? 'Salir' : 'Cancelar'}</button>}</article>;
}
function DocumentField({ field, value, onChange }: { field: FormField; value: unknown; onChange: (value: unknown) => void }) {
  const id = `client-form-${field.id}`;
  if (field.type === 'multiple_choice') return <fieldset className="form-field"><legend>{field.label}{field.required ? ' · Obligatorio' : ''}</legend>{(field.options ?? []).map(option => { const selected = Array.isArray(value) ? value as string[] : []; return <label className="consent-check" key={option}><input type="checkbox" checked={selected.includes(option)} onChange={event => onChange(event.target.checked ? [...selected, option] : selected.filter(item => item !== option))}/>{option}</label>; })}</fieldset>;
  if (field.type === 'yes_no' || field.type === 'acceptance') return <label className="consent-check"><input id={id} type="checkbox" checked={value === true} onChange={event => onChange(event.target.checked)}/>{field.label}{field.required ? ' · Obligatorio' : ''}</label>;
  if (field.type === 'long_text') return <label className="form-field" htmlFor={id}>{field.label}{field.required ? ' · Obligatorio' : ''}<textarea id={id} value={typeof value === 'string' ? value : ''} onChange={event => onChange(event.target.value)} required={field.required} maxLength={5000}/></label>;
  if (field.type === 'single_choice' || field.type === 'scale') return <label className="form-field" htmlFor={id}>{field.label}{field.required ? ' · Obligatorio' : ''}<select id={id} value={value == null ? '' : String(value)} required={field.required} onChange={event => onChange(field.type === 'scale' ? Number(event.target.value) : event.target.value)}><option value="">Selecciona una opción</option>{(field.type === 'scale' ? Array.from({length:10},(_,index) => String(index+1)) : field.options ?? []).map(option => <option key={option} value={option}>{option}</option>)}</select></label>;
  return <label className="form-field" htmlFor={id}>{field.label}{field.required ? ' · Obligatorio' : ''}<input id={id} type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'} value={value == null ? '' : String(value)} onChange={event => onChange(field.type === 'number' ? event.target.value === '' ? undefined : Number(event.target.value) : event.target.value)} required={field.required} maxLength={field.type === 'number' || field.type === 'date' ? undefined : 5000}/></label>;
}
function weekRangeDays(selected = dateKey(new Date())) {
  const start = weekRange(selected).from; const todayKey = dateKey(new Date());
  return Array.from({length:7},(_,index)=>{const key=shiftDateKey(start,index);const date=new Date(`${key}T12:00:00Z`);return {date:key,label:new Intl.DateTimeFormat('es-ES',{timeZone:'UTC',weekday:'short'}).format(date),number:new Intl.DateTimeFormat('es-ES',{timeZone:'UTC',day:'numeric'}).format(date),today:key===todayKey};});
}

export const clientAppTestHelpers = { dateKey, timeLabel, weekRange, weekRangeDays, shiftDateKey, labels };
