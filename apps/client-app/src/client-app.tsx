import React from 'react';

type View = 'home' | 'book' | 'bookings' | 'bunker' | 'store' | 'profile' | 'settings' | 'notifications';
type NotificationItem = {id:string;type:string;title:string;body:string;deeplink:string|null;createdAt:string;readAt:string|null};
type ClientNotificationTarget = { view: 'bookings' | 'profile' | 'book' };
const clientNotificationId = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
export function resolveClientNotificationTarget(deeplink: unknown): ClientNotificationTarget | null {
  if (typeof deeplink !== 'string') return null;
  if (deeplink === '/bookings' || new RegExp(`^/bookings/${clientNotificationId}$`, 'i').test(deeplink)) return { view: 'bookings' };
  if (deeplink === '/profile' || deeplink === '/profile/documents' || deeplink === '/membership') return { view: 'profile' };
  if (new RegExp(`^/sessions/${clientNotificationId}$`, 'i').test(deeplink)) return { view: 'book' };
  return null;
}
type ClientProfile = { id: string; firstName: string; lastName: string; email: string | null; phone?: string | null; status: string };
type ClientSession = { id: string; startsAt: string; durationMinutes: number; capacity: number; status: string; isIndividual: boolean; serviceId: string; serviceName: string; areaName: string; professionalName: string | null; myReservationStatus: string | null; myWaitlistStatus: string | null; occupiedCount: number; waitlistCount: number; eligible?: boolean; eligibilityReason?: string | null; canJoinWaitlist?: boolean; availableAlternatives?: Array<{ assignmentId: string; planName?: string }> };
type Booking = { id: string; status: string; sessionId: string; startsAt: string; durationMinutes: number; serviceName: string; areaName: string; sessionStatus: string; isIndividual: boolean };
type FormAssignment = { id: string; status: string; required: boolean; dueAt: string | null; name: string; category: string; version: number };
type FormField = { id: string; label: string; type: string; required: boolean; options?: string[] };
type FormDetail = FormAssignment & { description: string; sensitivity: string; fields: FormField[] };
type Consent = { consentId: string; versionId: string; title: string; body: string; version: number; required: boolean; accepted: boolean };
type Assignment = { id: string; planName: string; kind: string; status: string; startsOn: string; endsOn: string | null; lastEvent: string; rights: Array<{ rightType: string; quantity: number | null; balance: number | null }>; modules?: Array<{ module: string; accessLevel: string }> };
type ApiState = { profile: ClientProfile; membership: { assignments: Assignment[]; active: Assignment[] }; bookings: { reservations: Booking[]; waitlist: Booking[] }; sessions: ClientSession[] };

export function isHubPreviewEnabled(buildFlag: unknown, search: string): boolean {
  if (buildFlag !== true && buildFlag !== 'true') return false;
  const requested = new URLSearchParams(search).getAll('preview');
  return requested.length === 1 && requested[0] === '1';
}

const labels: Record<string, string> = { member_pilot_action_not_enabled: 'Las reservas desde la app todavía no están activadas para tu cuenta.', session_full: 'La sesión está completa', service_archived: 'El servicio ya no está disponible', area_archived: 'El área ya no está disponible', no_active_entitlement: 'No hay un derecho activo para este servicio', no_entitlement: 'No hay un derecho activo para este servicio', entitlement_required: 'Elige un plan o bono para reservar', entitlement_unavailable: 'No hay un derecho disponible para esta sesión', entitlement_not_started: 'Tu plan aún no ha comenzado', entitlement_expired: 'Tu plan ha caducado', entitlement_paused: 'Tu plan está en pausa', entitlement_cancelled: 'Tu plan ya no está activo', entitlement_exhausted: 'Has utilizado todas las sesiones de este bono', insufficient_balance: 'No tienes saldo suficiente', weekly_limit_reached: 'Has alcanzado tu límite semanal', monthly_limit_reached: 'Has alcanzado tu límite mensual', service_not_allowed: 'Este servicio no está incluido en tu plan', client_inactive: 'Tu cuenta no está activa', session_started: 'Esta sesión ya ha comenzado', debt_restriction: 'Hay un saldo pendiente que impide reservar', booking_conflict: 'Ya tienes otra actividad a esa hora', duplicate_booking: 'Ya tienes una reserva o estás en espera', required_document_missing: 'Tienes un documento pendiente', session_cancelled: 'Esta sesión ya no está disponible', internal_error: 'Ahora no podemos consultar tu espacio.', database_unavailable: 'Ahora no podemos conectar con el centro.', authentication_required: 'Inicia sesión para continuar.' };
const rightLabel = (rightType: string) => rightType === 'sessions_quota' ? 'Sesiones' : rightType === 'service_access' ? 'Acceso a servicio' : rightType === 'quota' ? 'Cuota' : 'Derecho';
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
const previewDateTime = (date: Date, hour: number, minute = 0) => {
  const localDate = dateKey(date);
  const [year, month, day] = localDate.split('-').map(Number);
  let candidate = Date.UTC(year!, month! - 1, day!, hour, minute);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(candidate));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const actual = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute));
    const target = Date.UTC(year!, month! - 1, day!, hour, minute);
    candidate += target - actual;
  }
  return new Date(candidate).toISOString();
};
const addCanaryDays = (date: Date, days: number) => shiftDateKey(dateKey(date), days);
const makeHubPreview = (now = new Date()) => {
  const currentCanaryTime = new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  const startsToday = timeLabel(previewDateTime(now, 18)).localeCompare(currentCanaryTime) > 0;
  const bookingDay = startsToday ? dateKey(now) : addCanaryDays(now, 1);
  const startsAt = previewDateTime(new Date(`${bookingDay}T12:00:00Z`), 18);
  const tomorrow = addCanaryDays(new Date(`${bookingDay}T12:00:00Z`), 1);
  const ids = {
    client: '10000000-0000-4000-8000-000000000001', service: '20000000-0000-4000-8000-000000000001',
    session: '30000000-0000-4000-8000-000000000001', reservation: '40000000-0000-4000-8000-000000000001',
    plan: '50000000-0000-4000-8000-000000000001', form: '60000000-0000-4000-8000-000000000001',
    notification: '70000000-0000-4000-8000-000000000001',
  };
  const session: ClientSession = {
    id: ids.session, serviceId: ids.service, serviceName: 'Funcional', areaName: 'La Sala', professionalName: 'Alex',
    startsAt, durationMinutes: 45, capacity: 12, occupiedCount: 8, waitlistCount: 0, status: 'scheduled', isIndividual: false,
    myReservationStatus: 'reserved', myWaitlistStatus: null, eligible: true, eligibilityReason: null, canJoinWaitlist: false,
  };
  return {
    profile: { id: ids.client, firstName: 'Juan', lastName: 'Demo', email: null, status: 'active' } satisfies ClientProfile,
    membership: [{ id: ids.plan, planName: 'Plan 2J', kind: 'monthly', status: 'active', startsOn: dateKey(now), endsOn: null, lastEvent: 'activated', rights: [{ rightType: 'sessions_quota', quantity: 12, balance: 8 }], modules: [{ module: 'training', accessLevel: 'read' }] }] satisfies Assignment[],
    reservations: [{ id: ids.reservation, status: 'reserved', sessionId: ids.session, startsAt, durationMinutes: 45, serviceName: 'Funcional', areaName: 'La Sala', sessionStatus: 'scheduled', isIndividual: false }] satisfies Booking[],
    waitlist: [] as Booking[],
    sessions: [session, { ...session, id: '30000000-0000-4000-8000-000000000002', startsAt: previewDateTime(new Date(`${tomorrow}T12:00:00Z`), 19), serviceName: 'Fuerza', areaName: 'El Búnker', myReservationStatus: null }],
    forms: [{ id: ids.form, name: 'Ficha de bienvenida', status: 'assigned', required: true, dueAt: null, category: 'onboarding', version: 1 }] satisfies FormAssignment[],
    consents: [{ consentId: '80000000-0000-4000-8000-000000000001', versionId: '80000000-0000-4000-8000-000000000002', title: 'Normas del centro', body: 'Contenido ficticio de vista previa.', version: 1, required: true, accepted: false }] satisfies Consent[],
    notifications: [{ id: ids.notification, type: 'center_notice', title: 'Nuevo horario del sábado', body: 'Consulta en el centro las novedades de esta semana.', deeplink: null, createdAt: now.toISOString(), readAt: null }] satisfies NotificationItem[],
  };
};
const HUB_TRAINING_URL = 'https://app.2jfitnesscenter.com';
const HUB_STAFF_URL = import.meta.env?.VITE_2J_STAFF_URL || (import.meta.env?.DEV ? 'http://127.0.0.1:5175' : '');
const HUB_ADMIN_URL = import.meta.env?.VITE_2J_ADMIN_URL || (import.meta.env?.DEV ? 'http://127.0.0.1:5174' : '');
const HUB_BUILD_ID = import.meta.env?.VITE_2J_BUILD_ID || 'local';

export function selectNextConfirmedBooking(bookings: Booking[], now = Date.now()): Booking | null {
  return bookings
    .filter(row => row.status === 'reserved' && !row.sessionStatus.toLowerCase().startsWith('cancelled') && new Date(row.startsAt).getTime() >= now)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0] ?? null;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const origin = import.meta.env?.VITE_API_BASE_URL?.replace(/\/+$/, '') ?? '';
  const response = await fetch(`${origin}${path}`, { ...init, headers: { 'content-type': 'application/json', ...init?.headers }, credentials: 'include', cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? 'No se ha podido completar la solicitud.');
  return body as T;
}

export function ClientApp({ previewModeOverride, pilotLoginEnabledOverride }: { previewModeOverride?: boolean; pilotLoginEnabledOverride?: boolean } = {}) {
  const previewMode = previewModeOverride ?? isHubPreviewEnabled(import.meta.env?.VITE_2J_HUB_PREVIEW, typeof window === 'undefined' ? '' : window.location.search);
  const pilotLoginEnabled = !previewMode && (pilotLoginEnabledOverride ?? import.meta.env?.VITE_2J_PILOT_MEMBER_LOGIN === 'true');
  const pilotToolsEnabled = previewMode || import.meta.env?.DEV === true || import.meta.env?.VITE_2J_PILOT_TOOLS === 'true';
  const preview = React.useMemo(() => previewMode ? makeHubPreview() : null, [previewMode]);
  const [view, setView] = React.useState<View>('home');
  const [selectedDate, setSelectedDate] = React.useState(() => preview?.sessions[0] ? dateKey(new Date(preview.sessions[0].startsAt)) : dateKey(new Date()));
  const [profile, setProfile] = React.useState<ClientProfile | null>(() => preview?.profile ?? null);
  const [membership, setMembership] = React.useState<Assignment[]>(() => preview?.membership ?? []);
  const [reservations, setReservations] = React.useState<Booking[]>(() => preview?.reservations ?? []);
  const [waitlist, setWaitlist] = React.useState<Booking[]>(() => preview?.waitlist ?? []);
  const [sessions, setSessions] = React.useState<ClientSession[]>(() => preview?.sessions ?? []);
  const [bookingEnabled, setBookingEnabled] = React.useState(false);
  const [forms, setForms] = React.useState<FormAssignment[]>(() => preview?.forms ?? []);
  const [consents, setConsents] = React.useState<Consent[]>(() => preview?.consents ?? []);
  const [notifications, setNotifications] = React.useState<NotificationItem[]>(() => preview?.notifications ?? []);
  const [unreadNotifications, setUnreadNotifications] = React.useState(() => preview?.notifications.filter(item => !item.readAt).length ?? 0);
  const [notificationCursor, setNotificationCursor] = React.useState<{before:string;beforeId:string}|null>(null);
  const notificationInFlight = React.useRef(new Set<string>());
  const [loading, setLoading] = React.useState(!previewMode);
  const [error, setError] = React.useState('');
  const [pilotCode, setPilotCode] = React.useState('');
  const [loginError, setLoginError] = React.useState('');
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
    if (previewMode && preview) {
      setProfile(preview.profile); setMembership(preview.membership); setReservations(preview.reservations); setWaitlist(preview.waitlist); setBookingEnabled(false);
      setSessions(preview.sessions); setForms(preview.forms); setConsents(preview.consents); setNotifications(preview.notifications);
      setUnreadNotifications(preview.notifications.filter(item => !item.readAt).length); setError(''); setLoading(false); return;
    }
    setLoading(true); setError('');
    try {
      const { from, to } = weekRange(selectedDate);
      const [me, plans, mine, agenda, documents, consentItems, bookingAccess] = await Promise.all([
        api<{ profile: ClientProfile }>('/api/me'),
        api<{ assignments: Assignment[] }>('/api/me/membership'),
        api<{ reservations: Booking[]; waitlist: Booking[] }>('/api/me/bookings'),
        api<{ sessions: ClientSession[] }>(`/api/me/sessions?from=${from}&to=${to}`),
        api<FormAssignment[]>('/api/client-portal/form-assignments'),
        api<Consent[]>('/api/client-portal/consents'),
        api<{ enabled: boolean }>('/api/me/booking-access'),
      ]);
      setProfile(me.profile); setMembership(plans.assignments); setReservations(mine.reservations); setWaitlist(mine.waitlist); setSessions(agenda.sessions); setForms(documents); setConsents(consentItems); setBookingEnabled(bookingAccess.enabled);
      try { const unread = await api<{count:number}>('/api/me/notifications/unread-count'); setUnreadNotifications(unread.count); } catch { setUnreadNotifications(0); }
      // Interim composition: only center_notice notifications feed the Inicio news block.
      // Member notifications remain their own domain and open in the Buzón.
      try { const latest = await api<{items:NotificationItem[]}>('/api/me/notifications?limit=20'); setNotifications(latest.items ?? []); } catch { setNotifications([]); }
    } catch (cause) { const message = cause instanceof Error ? cause.message : ''; setError(message === 'client_authentication_required' ? message : labels[message] ?? 'No se han podido cargar tus datos.'); }
    finally { setLoading(false); }
  }, [preview, previewMode, selectedDate]);
  const login = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setLoginError(''); setBusy('login');
    try { await api('/api/pilot/member/login', { method: 'POST', body: JSON.stringify({ code: pilotCode }) }); setPilotCode(''); await refresh(); }
    catch { setLoginError('No se ha podido iniciar sesión. Comprueba el código e inténtalo de nuevo.'); }
    finally { setBusy(null); }
  };
  const logout = async () => {
    setBusy('logout');
    try { await api('/api/pilot/member/logout', { method: 'POST', body: '{}' }); }
    catch { setMessage('No se pudo cerrar la sesión; vuelve a intentarlo.'); return setBusy(null); }
    setProfile(null); setMembership([]); setReservations([]); setWaitlist([]); setSessions([]); setForms([]); setConsents([]); setNotifications([]); setMessage(''); setError('client_authentication_required'); setLoading(false); setView('home'); setBusy(null);
  };
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
    if (previewMode) { setSelectedSession({ ...session, availableAlternatives: [], eligible: session.myReservationStatus ? false : true, canJoinWaitlist: false }); return; }
    try {
      const result = await api<{ session: ClientSession }>(`/api/me/sessions/${session.id}`);
      setSelectedSession(result.session);
      setSelectedAssignment(result.session.availableAlternatives?.length === 1 ? result.session.availableAlternatives[0]!.assignmentId : '');
    } catch (cause) { setMessage(cause instanceof Error ? labels[cause.message] ?? 'No se ha podido consultar la sesión.' : 'No se ha podido consultar la sesión.'); }
  };
  const openForm = async (form: FormAssignment) => {
    dialogOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDialogError(''); setFormAnswers({}); setSelectedForm({ ...form, description: '', sensitivity: 'operational', fields: [] });
    if (previewMode) { setSelectedForm({ ...form, description: 'Contenido de ejemplo para mostrar el aspecto de la documentación del centro.', sensitivity: 'operational', fields: [{ id: 'goal', label: '¿Qué te gustaría conseguir?', type: 'short_text', required: true }] }); return; }
    try { setSelectedForm(await api<FormDetail>(`/api/client-portal/form-assignments/${form.id}`)); }
    catch { setDialogError('No se ha podido abrir el documento. Inténtalo de nuevo.'); }
  };
  const submitForm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selectedForm) return;
    if (previewMode) { setDialogError('En la vista previa no se envían formularios.'); return; }
    if (selectedForm.fields.some(field => { const answer = formAnswers[field.id]; return field.required && (answer === undefined || answer === '' || (field.type === 'acceptance' && answer !== true) || (Array.isArray(answer) && answer.length === 0)); })) { setDialogError('Completa los campos obligatorios antes de continuar.'); return; }
    setBusy(`form:${selectedForm.id}`); setDialogError(''); const operation = keyFor(`form:${selectedForm.id}`);
    try { await api(`/api/client-portal/form-assignments/${selectedForm.id}/respond`, { method: 'POST', headers: { 'idempotency-key': operation.key }, body: JSON.stringify({ answers: formAnswers }) }); operation.clear(); setSelectedForm(null); setMessage('Documento enviado para revisión.'); await refresh(); }
    catch { setDialogError('No se ha podido enviar el documento. Puedes volver a intentarlo.'); }
    finally { setBusy(null); }
  };
  const openConsent = (consent: Consent) => { dialogOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setDialogError(''); setTypedName(''); setConsentChecked(false); setSelectedConsent(consent); };
  const acceptConsent = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selectedConsent) return;
    if (previewMode) { setDialogError('En la vista previa no se guardan consentimientos.'); return; }
    if (!consentChecked || !typedName.trim()) { setDialogError('Marca tu aceptación e indica tu nombre completo.'); return; }
    setBusy(`consent:${selectedConsent.versionId}`); setDialogError(''); const operation = keyFor(`consent:${selectedConsent.versionId}`);
    try { await api(`/api/client-portal/consents/${selectedConsent.versionId}/accept`, { method: 'POST', headers: { 'idempotency-key': operation.key }, body: JSON.stringify({ typedName, accepted: true }) }); operation.clear(); setSelectedConsent(null); setMessage('Tu aceptación se ha guardado.'); await refresh(); }
    catch { setDialogError('No se ha podido guardar la aceptación. Puedes volver a intentarlo.'); }
    finally { setBusy(null); }
  };
  const reserve = async (session: ClientSession, joinWaitlist = false) => {
    if (previewMode) { setMessage('La reserva está desactivada en la vista previa.'); return; }
    if (!bookingEnabled) { setMessage('Las reservas desde la app todavía no están activadas para tu cuenta.'); return; }
    const id = `${joinWaitlist ? 'waitlist' : 'reserve'}:${session.id}:${selectedAssignment || 'automatic'}`; setBusy(id); setMessage('');
    const operation = keyFor(id);
    try {
      await api(joinWaitlist ? `/api/me/sessions/${session.id}/waitlist` : `/api/me/sessions/${session.id}/reservations`, { method: 'POST', headers: { 'idempotency-key': operation.key }, body: JSON.stringify(selectedAssignment ? { entitlementAssignmentId: selectedAssignment } : {}) });
      operation.clear(); setMessage(joinWaitlist ? 'Ya estás en la lista de espera.' : 'Tu plaza está reservada.'); await refresh();
    } catch (cause) { if (cause instanceof Error && cause.message === 'member_pilot_action_not_enabled') setBookingEnabled(false); setMessage(cause instanceof Error ? labels[cause.message] ?? 'No se ha podido completar la reserva. Puedes volver a intentarlo.' : 'No se ha podido completar la reserva. Puedes volver a intentarlo.'); }
    finally { setBusy(null); }
  };
  const cancelBooking = async (booking: Booking) => {
    if (previewMode) { setMessage('La cancelación está desactivada en la vista previa.'); return; }
    if (!bookingEnabled) { setMessage('Las reservas desde la app todavía no están activadas para tu cuenta.'); return; }
    try {
      const preview = await api<{ canCancel: boolean; cancellation: { summary: string } }>(`/api/me/bookings/${booking.id}/cancellation-preview`);
      if (!preview.canCancel) { setMessage('Esta reserva ya no se puede cancelar.'); await refresh(); return; }
      if (!window.confirm(`¿Quieres cancelar esta reserva? ${preview.cancellation.summary}`)) return;
    } catch (cause) { setMessage(cause instanceof Error ? 'No se ha podido consultar la política de cancelación.' : 'No se ha podido consultar la política de cancelación.'); return; }
    const key = keyFor(`cancel:${booking.id}`); setBusy(booking.id); setMessage('');
    try { await api(`/api/me/bookings/${booking.id}/cancel`, { method: 'PATCH', headers: { 'idempotency-key': key.key }, body: '{}' }); key.clear(); setMessage('La reserva se ha cancelado.'); await refresh(); }
    catch (cause) { if (cause instanceof Error && cause.message === 'member_pilot_action_not_enabled') setBookingEnabled(false); setMessage(cause instanceof Error ? labels[cause.message] ?? 'No se ha podido cancelar. Inténtalo de nuevo.' : 'No se ha podido cancelar. Inténtalo de nuevo.'); }
    finally { setBusy(null); }
  };
  const leaveWaitlist = async (entry: Booking) => {
    if (previewMode) { setMessage('La lista de espera está desactivada en la vista previa.'); return; }
    if (!bookingEnabled) { setMessage('Las reservas desde la app todavía no están activadas para tu cuenta.'); return; }
    if (!window.confirm('¿Quieres salir de la lista de espera?')) return;
    const key = keyFor(`leave-waitlist:${entry.id}`); setBusy(entry.id); setMessage('');
    try { await api(`/api/me/waitlist/${entry.id}/cancel`, { method: 'PATCH', headers: { 'idempotency-key': key.key }, body: '{}' }); key.clear(); setMessage('Has salido de la lista de espera.'); await refresh(); }
    catch (cause) { if (cause instanceof Error && cause.message === 'member_pilot_action_not_enabled') setBookingEnabled(false); setMessage(cause instanceof Error ? labels[cause.message] ?? 'No se ha podido actualizar la lista.' : 'No se ha podido actualizar la lista.'); }
    finally { setBusy(null); }
  };
  const openNotifications = async () => { setView('notifications'); if (previewMode) { setNotificationCursor(null); return; } try { const result=await api<{items:NotificationItem[];nextBefore:string|null;nextBeforeId:string|null}>('/api/me/notifications'); setNotifications(result.items);setNotificationCursor(result.nextBefore&&result.nextBeforeId?{before:result.nextBefore,beforeId:result.nextBeforeId}:null); } catch { setMessage('No se han podido cargar tus notificaciones.'); } };
  const loadOlderNotifications=async()=>{if(!notificationCursor)return;try{const result=await api<{items:NotificationItem[];nextBefore:string|null;nextBeforeId:string|null}>(`/api/me/notifications?before=${encodeURIComponent(notificationCursor.before)}&beforeId=${notificationCursor.beforeId}`);setNotifications(rows=>[...rows,...result.items]);setNotificationCursor(result.nextBefore&&result.nextBeforeId?{before:result.nextBefore,beforeId:result.nextBeforeId}:null);}catch{setMessage('No se han podido cargar más avisos.');}};
  const readNotification = async (item: NotificationItem) => {
    if (item.readAt) return true;
    if (notificationInFlight.current.has(item.id)) return false;
    notificationInFlight.current.add(item.id);
    if (previewMode) { setNotifications(rows => rows.map(row => row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row)); setUnreadNotifications(count => Math.max(0, count - 1)); notificationInFlight.current.delete(item.id); return true; }
    try { await api(`/api/me/notifications/${item.id}/read`,{method:'PATCH',body:'{}'}); setNotifications(rows=>rows.map(row=>row.id===item.id?{...row,readAt:new Date().toISOString()}:row)); setUnreadNotifications(count=>Math.max(0,count-1)); return true; }
    catch { setMessage('No se ha podido marcar como leída. Puedes volver a intentarlo.'); return false; }
    finally { notificationInFlight.current.delete(item.id); }
  };
  const openNotification = async (item: NotificationItem) => {
    if (notificationInFlight.current.has(item.id)) return;
    const target = resolveClientNotificationTarget(item.deeplink);
    const wasRead = await readNotification(item);
    if (target) { if (wasRead) setMessage(''); setView(target.view); }
    else if (wasRead) setMessage(item.deeplink === null ? 'Este aviso es informativo; los mensajes del centro todavía no están disponibles aquí.' : 'Este aviso no tiene un destino disponible.');
  };
  const readAllNotifications = async () => { if (previewMode) { setNotifications(rows=>rows.map(row=>({...row,readAt:row.readAt??new Date().toISOString()})));setUnreadNotifications(0);return; } try { await api('/api/me/notifications/read-all',{method:'POST',body:'{}'});setNotifications(rows=>rows.map(row=>({...row,readAt:row.readAt??new Date().toISOString()})));setUnreadNotifications(0); } catch { setMessage('No se han podido marcar como leídas.'); } };

  const upcoming = reservations.filter(row => row.status === 'reserved' && !row.sessionStatus.toLowerCase().startsWith('cancelled') && new Date(row.startsAt).getTime() >= Date.now()).sort((a,b) => a.startsAt.localeCompare(b.startsAt));
  const nextBooking = selectNextConfirmedBooking(reservations);
  const sessionsForSelectedDay = sessions.filter(session => dateKey(new Date(session.startsAt)) === selectedDate);
  const groupedSessions = Array.from(sessionsForSelectedDay.reduce((groups, session) => groups.set(session.areaName, [...(groups.get(session.areaName) ?? []), session]), new Map<string, ClientSession[]>()));
  const alternatives = selectedSession?.availableAlternatives ?? [];
  const copyDiagnostics = async () => {
    const dimensions = typeof window === 'undefined' ? 'unknown' : `${window.innerWidth}x${window.innerHeight}`;
    const diagnostics = [`app=2j-client-app`, `version=${HUB_BUILD_ID}`, `mode=${previewMode ? 'fixture-preview' : 'platform-pilot'}`, `view=${view}`, `timestamp=${new Date().toISOString()}`, `viewport=${dimensions}`].join('\n');
    try { await navigator.clipboard.writeText(diagnostics); setMessage('Información de diagnóstico copiada.'); }
    catch { setMessage('No se pudo copiar la información de diagnóstico en este navegador.'); }
  };
  return <div className="client-app hub-theme">
    <header className="client-header"><a className="client-brand" href="#home" onClick={() => setView('home')} aria-label="2J Fitness, inicio"><span className="client-mark">2J</span><span><strong>2J Fitness</strong><small>Tu espacio</small></span></a><div className="client-header-actions">{previewMode&&<span className="preview-pill">Vista previa</span>}{pilotLoginEnabled && profile && <button className="text-button" type="button" onClick={() => void logout()} disabled={busy === 'logout'}>{busy === 'logout' ? 'Saliendo…' : 'Cerrar sesión'}</button>}{profile && <><button className="notification-bell" aria-label={`Notificaciones${unreadNotifications?`, ${unreadNotifications} sin leer`:''}`} onClick={()=>void openNotifications()}><svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>{unreadNotifications>0&&<span aria-hidden="true">{unreadNotifications>99?'99+':unreadNotifications}</span>}</button><button className="avatar" aria-label="Mi perfil" onClick={() => setView('profile')}>{profile.firstName.slice(0,1)}</button></>}</div></header>
    <main className="client-main" id="main-content">
      {loading && <div className="loading-card" role="status"><span className="spinner"/> Cargando tu espacio…</div>}
      {!loading && error === 'client_authentication_required' && pilotLoginEnabled && <section className="state-card error-card" aria-labelledby="member-login-title"><span className="state-icon">2J</span><p className="eyebrow">PILOTO LOCAL</p><h1 id="member-login-title">Tu espacio, a tu manera</h1><p>Introduce el código de acceso de tu piloto para consultar tus reservas y derechos.</p><form className="member-login-form" onSubmit={event => void login(event)}><label className="field-label" htmlFor="member-pilot-code">Código de acceso</label><input id="member-pilot-code" name="code" type="password" autoComplete="one-time-code" value={pilotCode} onChange={event => setPilotCode(event.target.value)} required maxLength={128}/>{loginError && <p role="alert" className="inline-message">{loginError}</p>}<button className="button primary" disabled={busy === 'login' || !pilotCode}>{busy === 'login' ? 'Entrando…' : 'Iniciar sesión'}</button></form></section>}
      {!loading && error && !(error === 'client_authentication_required' && pilotLoginEnabled) && <section className="state-card error-card" role="alert"><span className="state-icon">!</span><h1>Tu espacio no está disponible ahora</h1><p>{error === 'client_authentication_required' ? 'Inicia sesión con tu cuenta para consultar tus reservas y derechos.' : 'Comprueba tu conexión e inténtalo de nuevo.'}</p><button className="button primary" onClick={() => void refresh()}>Intentar de nuevo</button></section>}
      {!loading && !error && profile && <>
        {message && view !== 'bookings' && view !== 'notifications' && !selectedSession && <p className="inline-message page-message" role="status">{message}</p>}
        {previewMode&&<p className="preview-note" role="status">Datos ficticios · las reservas y los trámites no se envían.</p>}
        {view === 'home' && <>
          <section className="hub-greeting"><p className="eyebrow">2J FITNESS CENTER</p><h1>Hola, {profile.firstName}</h1><p>Tu espacio 2J, a tu ritmo.</p></section>
          <section className="home-news" aria-labelledby="home-news-title"><div className="home-block-heading"><span className="card-icon" aria-hidden="true">✦</span><div><p className="eyebrow">2J FITNESS CENTER</p><h2 id="home-news-title">Noticias</h2></div></div>{notifications.find(item => item.type === 'center_notice') ? <><h3>{notifications.find(item => item.type === 'center_notice')!.title}</h3><p>{notifications.find(item => item.type === 'center_notice')!.body}</p><button className="text-button" onClick={() => void openNotifications()}>Ver avisos <span aria-hidden="true">→</span></button></> : <><p>Aquí aparecerán las noticias y avisos destacados del centro.</p><button className="text-button" onClick={() => void openNotifications()}>Abrir buzón <span aria-hidden="true">→</span></button></>}</section>
          <section className="home-book-cta" aria-labelledby="home-book-title"><div><p className="eyebrow">TU PRÓXIMA EXPERIENCIA</p><h2 id="home-book-title">Reservar clase</h2><p>Selecciona actividad, día y hora.</p></div><button className="button primary" onClick={() => setView('book')}>Ver horarios y reservar <span aria-hidden="true">→</span></button></section>
          <section className="home-next-booking" aria-labelledby="next-booking-title"><div className="home-block-heading"><span className="card-icon" aria-hidden="true"><NavIcon name="calendar"/></span><div><p className="eyebrow">TU AGENDA</p><h2 id="next-booking-title">Próxima reserva</h2></div></div>{nextBooking ? <><div className="next-booking-content"><p className="next-booking-service">{nextBooking.serviceName}{nextBooking.isIndividual ? <span className="individual-tag">Cita individual</span> : null}</p><p>{dateLabel(nextBooking.startsAt)} · {timeLabel(nextBooking.startsAt)}–{timeLabel(new Date(Date.parse(nextBooking.startsAt) + nextBooking.durationMinutes * 60_000).toISOString())}</p><p>{nextBooking.areaName}</p><span className="confirmed-pill">Confirmada</span></div><button className="text-button" onClick={() => setView('bookings')}>Mis reservas <span aria-hidden="true">→</span></button></> : <><p className="muted">No tienes ninguna reserva próxima.</p><button className="text-button" onClick={() => setView('bookings')}>Ver mis reservas <span aria-hidden="true">→</span></button></>}</section>
        </>}
        {view === 'book' && <><div className="page-intro"><p className="eyebrow">TU SEMANA · ATLANTIC/CANARY</p><h1>Reservar</h1><p>Elige una sesión de las actividades disponibles en tu centro.</p></div>{!bookingEnabled && !previewMode && <p className="inline-message page-message" role="status">Las reservas desde la app todavía no están activadas para tu cuenta.</p>}<button className="text-button contextual-link" onClick={() => setView('bookings')}>Mis reservas y lista de espera <span aria-hidden="true">→</span></button><div className="week-navigation"><button className="quiet-button" aria-label="Semana anterior" onClick={() => setSelectedDate(value => shiftDateKey(value, -7))}>‹</button><span>{dateLabel(`${weekRange(selectedDate).from}T12:00:00Z`)} – {dateLabel(`${weekRange(selectedDate).to}T12:00:00Z`)}</span><button className="quiet-button" aria-label="Semana siguiente" onClick={() => setSelectedDate(value => shiftDateKey(value, 7))}>›</button></div><div className="week-strip" aria-label="Elige un día">{weekRangeDays(selectedDate).map(day => <button type="button" key={day.date} aria-pressed={selectedDate === day.date} className={`day-chip${day.today ? ' today' : ''}${selectedDate === day.date ? ' selected' : ''}`} onClick={() => setSelectedDate(day.date)}><small>{day.label}</small><strong>{day.number}</strong></button>)}</div>{groupedSessions.length ? groupedSessions.map(([areaName, areaSessions]) => <section className="area-session-group" key={areaName}><div className="section-heading compact"><div><p className="eyebrow">TU CENTRO</p><h2>{areaName}</h2></div><span className="session-count">{areaSessions.length} {areaSessions.length === 1 ? 'sesión' : 'sesiones'}</span></div><div className="session-list">{areaSessions.map(session => <SessionCard key={session.id} session={session} onSelect={() => void openSession(session)}/>)}</div></section>) : <section className="empty-card"><span className="empty-mark">✳</span><h2>No hay sesiones este día</h2><p>Elige otra fecha o vuelve a consultar pronto.</p></section>}</>}
        {view === 'bunker' && <section className="hub-destination"><div className="destination-mark"><NavIcon name="bunker"/></div><p className="eyebrow">ENTRENAMIENTO</p><h1>Búnker</h1><p>Tu espacio de rutinas, seguimiento y progreso.</p><a className="button primary" href={HUB_TRAINING_URL} target="_blank" rel="noopener noreferrer">Abrir Búnker <span aria-hidden="true">↗</span></a><small>Se abrirá el espacio de entrenamiento en una nueva pestaña.</small></section>}
        {view === 'store' && <><div className="page-intro"><p className="eyebrow">2J FITNESS CENTER</p><h1>Tienda</h1><p>Descubre las categorías disponibles en el centro.</p></div><div className="store-categories"><article className="store-category"><span className="store-category-icon" aria-hidden="true">✦</span><h2>Nutrición</h2><p>Productos seleccionados para acompañar tu entrenamiento.</p></article><article className="store-category"><span className="store-category-icon" aria-hidden="true">◈</span><h2>Merchandising</h2><p>Ropa y artículos con identidad 2J.</p></article></div><p className="store-notice">Catálogo informativo. Las compras se gestionan directamente en el centro.</p></>}
        {view === 'bookings' && <><div className="page-intro"><p className="eyebrow">TU ACTIVIDAD</p><h1>Mis reservas</h1><p>Consulta próximas sesiones y tu historial.</p></div><button className="text-button contextual-link" onClick={() => setView('book')}>Volver a Reservar <span aria-hidden="true">→</span></button>{message && <p className="inline-message" role="status">{message}</p>}<h2 className="subheading">Próximas</h2>{upcoming.length ? <div className="booking-stack">{upcoming.map(row => <BookingCard key={row.id} booking={row} busy={busy === row.id} actionDisabled={previewMode || !bookingEnabled} onCancel={() => void cancelBooking(row)}/>)}</div> : <p className="muted">Todavía no tienes reservas próximas.</p>}<h2 className="subheading">Lista de espera</h2>{waitlist.filter(row => row.status === 'waiting').length ? <div className="booking-stack">{waitlist.filter(row => row.status === 'waiting').map(row => <BookingCard key={row.id} booking={row} waiting busy={busy === row.id} actionDisabled={previewMode || !bookingEnabled} onCancel={() => void leaveWaitlist(row)}/>)}</div> : <p className="muted">No estás en ninguna lista de espera.</p>}<h2 className="subheading">Historial</h2>{reservations.filter(row => row.status !== 'reserved' || new Date(row.startsAt).getTime() < Date.now()).slice(0,6).map(row => <BookingCard key={row.id} booking={row} compact/>)}{waitlist.filter(row => row.status !== 'waiting').slice(0,6).map(row => <BookingCard key={row.id} booking={row} waiting compact/>)}</>}
        {view === 'notifications' && <><div className="page-intro"><p className="eyebrow">TU ESPACIO</p><h1>Notificaciones</h1><p>Avisos importantes de tus reservas y mensajes.</p></div>{message&&<p className="inline-message" role="status">{message}</p>}{notifications.length>0&&unreadNotifications>0&&<button className="text-button" onClick={()=>void readAllNotifications()}>Marcar todas como leídas</button>}{notifications.length? <div className="notification-list">{notifications.map(item=><article className={`notification-item${item.readAt?' is-read':''}`} key={item.id}><span className="notification-dot" aria-hidden="true"/><button type="button" className="notification-open" aria-label={`Abrir aviso: ${item.title}`} onClick={()=>void openNotification(item)}><strong>{item.title}</strong><p>{item.body}</p><small>{new Intl.DateTimeFormat('es-ES',{timeZone:'Atlantic/Canary',dateStyle:'medium',timeStyle:'short'}).format(new Date(item.createdAt))}</small></button>{!item.readAt&&<button type="button" className="text-button notification-read" onClick={()=>void readNotification(item)}>Marcar leída</button>}</article>)}</div>:<section className="empty-card"><h3>Todo al día</h3><p>Aquí aparecerán los avisos de tus reservas.</p></section>}{notificationCursor&&<button className="button secondary full" onClick={()=>void loadOlderNotifications()}>Cargar anteriores</button>}<button className="text-button" onClick={()=>void refresh()}>Actualizar</button></>}
        {view === 'settings' && <><div className="page-intro"><p className="eyebrow">TU CUENTA</p><h1>Ajustes</h1><p>Preferencias generales de tu experiencia 2J.</p></div><section className="settings-empty"><span className="settings-mark" aria-hidden="true"><NavIcon name="settings"/></span><h2>Todo en su sitio</h2><p>Cuando haya ajustes generales disponibles, podrás gestionarlos aquí.</p></section>{pilotToolsEnabled&&<section className="pilot-access" aria-labelledby="pilot-access-title"><div><p className="eyebrow">SOLO PARA EL EQUIPO</p><h2 id="pilot-access-title">Herramientas del piloto</h2><p>Accesos internos para revisar las experiencias por separado.</p></div><div className="pilot-links">{HUB_STAFF_URL&&<a className="button secondary" href={HUB_STAFF_URL} target="_blank" rel="noopener noreferrer">Abrir área de entrenador <span aria-hidden="true">↗</span></a>}{HUB_ADMIN_URL&&<a className="button secondary" href={HUB_ADMIN_URL} target="_blank" rel="noopener noreferrer">Abrir administración <span aria-hidden="true">↗</span></a>}</div>{(!HUB_STAFF_URL||!HUB_ADMIN_URL)&&<p className="pilot-setup-note">Configura VITE_2J_STAFF_URL y VITE_2J_ADMIN_URL para mostrar los accesos del piloto.</p>}</section>}</>}
        {view === 'profile' && <>
          <div className="page-intro"><p className="eyebrow">TU CUENTA</p><h1>Perfil</h1><p>Tu información y derechos activos.</p></div>
          <section className="profile-card"><div className="profile-avatar">{profile.firstName[0]}{profile.lastName[0]}</div><div><p className="eyebrow">MI PERFIL</p><h2>{profile.firstName} {profile.lastName}</h2><p>{profile.email ?? 'Email no indicado'}</p>{profile.phone && <p>{profile.phone}</p>}</div></section>
          <div className="section-heading"><div><p className="eyebrow">MEMBRESÍA</p><h2>Cuotas y saldo</h2></div></div>
          {membership.length ? membership.map(plan => (
            <section className="plan-row" key={plan.id}><div><strong>{plan.planName}</strong><span>{plan.startsOn}{plan.endsOn ? ` · hasta ${plan.endsOn}` : ''}</span>{plan.rights.length > 0 && <div className="profile-rights">{plan.rights.map((right,index) => <span key={`${right.rightType}-${index}`}>{rightLabel(right.rightType)} · {right.balance ?? right.quantity ?? '—'} disponibles</span>)}</div>}</div><span className="active-pill">{plan.status === 'active' ? 'Activo' : plan.status === 'paused' ? 'Pausado' : plan.status}</span></section>
          )) : <p className="muted">No encontramos planes asociados a tu cuenta.</p>}
          <div className="section-heading"><div><p className="eyebrow">DOCUMENTACIÓN</p><h2>Contratos y certificados</h2></div></div>
          {forms.length ? forms.map(form => (
            <section className="plan-row document-row" key={form.id}><div><strong>{form.name}</strong><span>{form.status === 'assigned' ? 'Pendiente de completar' : form.status === 'rejected' ? 'Requiere una corrección · consulta en recepción' : 'En revisión por el centro'}</span></div>{form.status === 'assigned' && <button className="quiet-button" onClick={() => void openForm(form)}>Completar</button>}</section>
          )) : <p className="muted">No tienes formularios pendientes.</p>}
          {consents.map(consent => (
            <section className="plan-row document-row" key={consent.versionId}><div><strong>{consent.title}</strong><span>{consent.accepted ? 'Aceptado' : consent.required ? 'Pendiente de aceptar' : 'Opcional'}</span></div>{!consent.accepted && <button className="quiet-button" onClick={() => openConsent(consent)}>Consultar</button>}</section>
          ))}
          <div className="section-heading"><div><p className="eyebrow">COMUNICACIÓN</p><h2>Buzón</h2></div><button className="text-button" onClick={() => void openNotifications()}>Abrir <span aria-hidden="true">→</span></button></div>
        </>}
      </>}
    </main>
    {pilotToolsEnabled&&<footer className="pilot-footer"><span>Vista piloto · {HUB_BUILD_ID}</span><button type="button" className="text-button" onClick={() => void copyDiagnostics()}>Copiar información de diagnóstico</button></footer>}
    {!loading && !error && profile && <nav className="bottom-nav" aria-label="Navegación principal">{([['home','Inicio','home'],['bunker','Búnker','bunker'],['store','Tienda','store'],['profile','Perfil','profile'],['settings','Ajustes','settings']] as const).map(([id,label,icon]) => <button key={id} className={view === id || (view === 'book' && id === 'home') || (view === 'bookings' && id === 'home') || (view === 'notifications' && id === 'profile') ? 'nav-button active' : 'nav-button'} aria-current={view === id || (view === 'book' && id === 'home') || (view === 'bookings' && id === 'home') || (view === 'notifications' && id === 'profile') ? 'page' : undefined} onClick={() => { setView(id); setMessage(''); }}><span aria-hidden="true"><NavIcon name={icon}/></span><small>{label}</small></button>)}</nav>}
    {selectedSession && <div className="sheet-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedSession(null); }}><section className="session-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><button className="sheet-close" aria-label="Cerrar detalle" onClick={() => setSelectedSession(null)}>×</button><p className="eyebrow">DETALLE DE SESIÓN</p><h2 id="sheet-title">{selectedSession.serviceName}</h2><p className="sheet-subtitle">{dateLabel(selectedSession.startsAt)} · {timeLabel(selectedSession.startsAt)} · {selectedSession.areaName}</p><div className="sheet-capacity"><span>Plazas disponibles</span><strong>{Math.max(0, selectedSession.capacity - selectedSession.occupiedCount)}</strong></div>{alternatives.length > 1 && <label className="field-label">Usar derecho<select value={selectedAssignment} onChange={event => setSelectedAssignment(event.target.value)}><option value="">Elige un plan o bono</option>{alternatives.map(item => <option key={item.assignmentId} value={item.assignmentId}>{item.planName ?? 'Plan activo'}</option>)}</select></label>}{message && <p className="inline-message" role="status">{message}</p>}{selectedSession.myReservationStatus && <p className="eligibility-note">Tu plaza ya está reservada.</p>}{selectedSession.eligible && !selectedSession.myReservationStatus && <button className="button primary full" disabled={previewMode || !bookingEnabled || busy !== null || (alternatives.length > 1 && !selectedAssignment)} onClick={() => void reserve(selectedSession)}>{busy?.startsWith('reserve') ? 'Reservando…' : 'Confirmar reserva'}</button>}{selectedSession.canJoinWaitlist && <button className="button secondary full" disabled={previewMode || !bookingEnabled || busy !== null} onClick={() => void reserve(selectedSession,true)}>{busy?.startsWith('waitlist') ? 'Añadiendo…' : 'Apuntarme a la lista de espera'}</button>}{previewMode && !selectedSession.myReservationStatus && <p className="preview-action-note">En la vista previa las reservas están desactivadas.</p>}{!bookingEnabled && !previewMode && <p className="eligibility-note">Las reservas desde la app todavía no están activadas para tu cuenta.</p>}<p className="sheet-footnote">La reserva utiliza las reglas y los derechos vigentes de tu cuenta.</p></section></div>}
    {selectedForm && <div className="sheet-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedForm(null); }}><section className="session-sheet document-sheet" role="dialog" aria-modal="true" aria-labelledby="form-title"><button className="sheet-close" aria-label="Cerrar formulario" onClick={() => setSelectedForm(null)}>×</button><p className="eyebrow">DOCUMENTACIÓN DEL CENTRO</p><h2 id="form-title">{selectedForm.name}</h2>{selectedForm.description && <p className="muted">{selectedForm.description}</p>}{dialogError && selectedForm.fields.length === 0 ? <><p className="inline-message" role="alert">{dialogError}</p><button className="button secondary full" onClick={() => void openForm(selectedForm)}>Intentar de nuevo</button></> : <form onSubmit={event => void submitForm(event)}>{selectedForm.fields.map(field => <DocumentField key={field.id} field={field} value={formAnswers[field.id]} onChange={value => setFormAnswers(current => ({ ...current, [field.id]: value }))}/>)}{dialogError && <p className="inline-message" role="alert">{dialogError}</p>}{previewMode&&<p className="preview-action-note">Vista previa: los formularios no se envían.</p>}<button className="button primary full" disabled={previewMode || busy === `form:${selectedForm.id}`}>{busy === `form:${selectedForm.id}` ? 'Enviando…' : 'Enviar documento'}</button></form>}</section></div>}
    {selectedConsent && <div className="sheet-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedConsent(null); }}><section className="session-sheet document-sheet" role="dialog" aria-modal="true" aria-labelledby="consent-title"><button className="sheet-close" aria-label="Cerrar consentimiento" onClick={() => setSelectedConsent(null)}>×</button><p className="eyebrow">CONSENTIMIENTO DEL CENTRO</p><h2 id="consent-title">{selectedConsent.title}</h2><div className="consent-copy">{selectedConsent.body}</div><form onSubmit={event => void acceptConsent(event)}><label className="consent-check"><input type="checkbox" checked={consentChecked} onChange={event => setConsentChecked(event.target.checked)}/>He leído y acepto este consentimiento.</label><label className="field-label">Nombre completo<input autoComplete="name" value={typedName} onChange={event => setTypedName(event.target.value)} required maxLength={160}/></label>{dialogError && <p className="inline-message" role="alert">{dialogError}</p>}{previewMode&&<p className="preview-action-note">Vista previa: no se guardan consentimientos.</p>}<button className="button primary full" disabled={previewMode || busy === `consent:${selectedConsent.versionId}`}>{busy === `consent:${selectedConsent.versionId}` ? 'Guardando…' : 'Confirmar aceptación'}</button></form></section></div>}
  </div>;
}

function NavIcon({ name }: { name: 'home' | 'calendar' | 'bunker' | 'store' | 'settings' | 'profile' }) {
  const paths: Record<typeof name, React.ReactNode> = {
    home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/><path d="M3 10h18"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/></>,
    bunker: <><path d="M3 11 12 4l9 7v9H3z"/><path d="M8 20v-5h8v5M8 10h.01M16 10h.01"/></>,
    store: <><path d="M4 8h16l-1 12H5z"/><path d="m3 8 2-5h14l2 5M9 12v2M15 12v2"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.6-1.4-2.4L7.3 15a8 8 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.6 1.4 2.4-1.4 1.1a8 8 0 0 1 0 2Z"/></>,
    profile: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
  };
  return <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" focusable="false" aria-hidden="true">{paths[name]}</svg>;
}

function SessionCard({ session, onSelect }: { session: ClientSession; onSelect: () => void }) {
  const free = Math.max(0, session.capacity - session.occupiedCount);
  const ownStatus = session.myReservationStatus ? 'Ya estás en esta sesión' : session.myWaitlistStatus === 'waiting' ? 'Estás en lista de espera' : session.myWaitlistStatus === 'promoted' ? 'Plaza confirmada' : null;
  return <button className="session-card" onClick={onSelect}><div className="session-time"><strong>{timeLabel(session.startsAt)}</strong><span>{dayLabel(session.startsAt)} · {dateLabel(session.startsAt).split(' ')[1]}</span></div><div className="session-info"><strong>{session.serviceName}</strong><span>{session.areaName}{session.isIndividual ? ' · Cita individual' : ''}{session.professionalName ? ` · ${session.professionalName}` : ''}</span><div className="session-meta"><span>{ownStatus ?? (free > 0 ? `${free} ${free === 1 ? 'plaza libre' : 'plazas libres'}` : 'Completa')}</span>{!ownStatus && session.waitlistCount > 0 && <span>Espera {session.waitlistCount}</span>}</div></div><span className="session-arrow" aria-hidden="true">→</span></button>;
}
function BookingCard({ booking, waiting = false, compact = false, busy = false, actionDisabled = false, onCancel }: { booking: Booking; waiting?: boolean; compact?: boolean; busy?: boolean; actionDisabled?: boolean; onCancel?: () => void }) {
  const statusLabel = waiting ? booking.status === 'waiting' ? 'En lista de espera' : booking.status === 'promoted' ? 'Convertida en reserva' : booking.status === 'cancelled_by_center' ? 'Cancelada por el centro' : 'Lista de espera cancelada' : booking.status === 'reserved' ? 'Confirmada' : booking.status === 'attended' ? 'Asistió' : booking.status === 'no_show' ? 'No asistió' : booking.status === 'cancelled_by_center' ? 'Cancelada por el centro' : booking.status === 'cancelled_late' ? 'Cancelación tardía' : 'Cancelada';
  return <article className={`booking-card${compact ? ' compact' : ''}`}><div className="booking-date"><strong>{timeLabel(booking.startsAt)}</strong><span>{new Intl.DateTimeFormat('es-ES',{timeZone:'Atlantic/Canary',day:'2-digit',month:'short'}).format(new Date(booking.startsAt))}</span></div><div className="booking-detail"><strong>{booking.serviceName}{booking.isIndividual ? ' · Individual' : ''}</strong><span>{booking.areaName}</span><small>{statusLabel}</small></div>{onCancel && <button className="quiet-button" onClick={onCancel} disabled={busy || actionDisabled} title={actionDisabled ? 'Desactivado en la vista previa' : undefined}>{busy ? '…' : waiting ? 'Salir' : actionDisabled ? 'Vista previa' : 'Cancelar'}</button>}</article>;
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

export const clientAppTestHelpers = { dateKey, timeLabel, weekRange, weekRangeDays, shiftDateKey, labels, resolveClientNotificationTarget, isHubPreviewEnabled, selectNextConfirmedBooking, HUB_TRAINING_URL };
