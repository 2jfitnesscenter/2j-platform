import React from 'react';
import { usePushSubscription } from './push/use-push-subscription.js';

type View = 'home' | 'book' | 'bookings' | 'bunker' | 'store' | 'profile' | 'settings' | 'notifications' | 'news';
type NotificationItem = {id:string;type:string;title:string;body:string;deeplink:string|null;createdAt:string;readAt:string|null};
type CenterNews = {id:string;title:string;body:string;featured:boolean;publishedAt:string|null};
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
type MemberTrainingSummary =
  | { status: 'not_linked' }
  | { status: 'linked'; summaryStatus: 'unavailable' }
  | { status: 'linked'; summaryStatus: 'available'; summary: { trainingStatus: 'active'; asOf: string; currentProgram?: { name: string }; recentActivity?: { lastTrainingAt: string | null; sessionsLast30Days: number } } };
type TrainingCapabilities = {
  contract: '2J-CAPABILITIES-V2.1'; revision: 1; version: 2;
  capabilityLevel: 'full' | 'autonomous' | 'baseline' | 'blocked';
  accessState: 'active' | 'provisional' | 'blocked_unpaid' | 'ended' | 'baseline' | 'suspended';
  reasonCode: string; expiresAt: string;
  trainingSubject: { linkStatus: 'active' | 'not_linked' | 'revoked' };
  capabilities: { autonomousTraining: boolean; routineCreation: boolean; personalRoutineCreation: boolean; personalRoutineManagement: boolean; workoutRecording: boolean; workoutHistory: boolean; guidedTraining: boolean; premiumPrograms: boolean; aiCoach: boolean; professionalFollowUp: boolean };
};
type ClientSession = { id: string; startsAt: string; durationMinutes: number; capacity: number; status: string; isIndividual: boolean; serviceId: string; serviceName: string; areaName: string; professionalName: string | null; myReservationStatus: string | null; myWaitlistStatus: string | null; occupiedCount: number; waitlistCount: number; eligible?: boolean; eligibilityReason?: string | null; canJoinWaitlist?: boolean; availableAlternatives?: Array<{ assignmentId: string; planName?: string }> };
type MemberBookingService = { id: string; name: string };
type MemberCancellation = { kind: 'booking' | 'waitlist'; booking: Booking; summary?: string };
type Booking = { id: string; status: string; sessionId: string; startsAt: string; durationMinutes: number; serviceName: string; areaName: string; sessionStatus: string; isIndividual: boolean };
type FormAssignment = { id: string; status: string; required: boolean; dueAt: string | null; name: string; category: string; version: number };
type FormField = { id: string; label: string; type: string; required: boolean; options?: string[] };
type FormDetail = FormAssignment & { description: string; sensitivity: string; fields: FormField[] };
type Consent = { consentId: string; versionId: string; title: string; body: string; version: number; required: boolean; accepted: boolean };
type Assignment = { id: string; planName: string; kind: string; status: string; startsOn: string; endsOn: string | null; lastEvent: string; rights: Array<{ rightType: string; serviceId?: string | null; serviceName?: string | null; serviceStatus?: string | null; quantity: number | null; balance: number | null }>; modules?: Array<{ module: string; accessLevel: string; capabilities?: string[] }> };
type MembershipResponse = { asOf: string; timezone: string; assignments: Assignment[]; active: Assignment[]; trainingCapabilities?: TrainingCapabilities | null };
type ApiState = { profile: ClientProfile; membership: { assignments: Assignment[]; active: Assignment[] }; bookings: { reservations: Booking[]; waitlist: Booking[] }; sessions: ClientSession[] };
type MemberStoreVariant = { id:string; label:string; size:string|null; flavor:string|null; priceCents:number; availability:'disponible'|'pocas_unidades'|'agotado' };
type MemberStoreProduct = { id:string; category:'nutrition'|'merchandising'; name:string; description:string; variants:MemberStoreVariant[] };
type MemberPurchase = { id:string; status:'completed'|'voided'; paymentState:'paid'|'pending'; totalCents:number; createdAt:string; lines:Array<{productName:string;variantLabel:string;quantity:number;unitPriceCents:number;lineTotalCents:number}> };
type MemberPreferences = { appearance: 'system' | 'light' | 'dark'; language: 'es' };
const defaultPreferences: MemberPreferences = { appearance: 'system', language: 'es' };
const appearanceStorageKey = '2j.member.appearance.v1';
function readAppearanceHint(previewMode: boolean): MemberPreferences['appearance'] {
  if (previewMode || typeof window === 'undefined') return 'system';
  try { const value = window.localStorage.getItem(appearanceStorageKey); return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'; }
  catch { return 'system'; }
}

export function isHubPreviewEnabled(buildFlag: unknown, search: string): boolean {
  if (buildFlag !== true && buildFlag !== 'true') return false;
  const requested = new URLSearchParams(search).getAll('preview');
  return requested.length === 1 && requested[0] === '1';
}

export function isHubDemoBuild(buildFlag: unknown): boolean {
  return buildFlag === true || buildFlag === 'true';
}

function trainingCapabilityLabels(capabilities: TrainingCapabilities['capabilities']) {
  return ([
    ['autonomousTraining', 'Entrenamiento autónomo'], ['personalRoutineCreation', 'Crear rutinas propias'],
    ['personalRoutineManagement', 'Gestionar rutinas propias'], ['workoutRecording', 'Registrar entrenamientos'],
    ['workoutHistory', 'Historial de entrenamientos'], ['guidedTraining', 'Entrena con 2J'],
    ['premiumPrograms', 'Programas Premium'], ['aiCoach', 'IA de entrenamiento'],
    ['professionalFollowUp', 'Seguimiento profesional'],
  ] as const).filter(([key]) => capabilities[key]).map(([, label]) => label);
}

const labels: Record<string, string> = {
  member_pilot_action_not_enabled: 'Las reservas desde la app todavía no están activadas para tu cuenta.',
  session_full: 'La sesión está completa', space_available: 'La sesión ya tiene plazas disponibles', service_archived: 'El servicio ya no está disponible', area_archived: 'El área ya no está disponible',
  no_active_entitlement: 'Necesitas una cuota activa para reservar este servicio', no_entitlement: 'No hay un derecho activo para este servicio', entitlement_required: 'Elige un plan o bono para reservar', entitlement_unavailable: 'No hay un derecho disponible para esta sesión',
  entitlement_not_started: 'Tu plan aún no ha comenzado', entitlement_expired: 'Tu plan ha caducado', entitlement_paused: 'Tu plan está en pausa', entitlement_cancelled: 'Tu plan ya no está activo', entitlement_exhausted: 'Has utilizado todas las sesiones de este bono', insufficient_balance: 'No tienes saldo suficiente',
  entitlement_selection_required: 'Elige el plan o bono que quieres usar', entitlement_selection_invalid: 'Ese plan o bono ya no está disponible para esta sesión', service_not_allowed: 'Este servicio no está incluido en tu plan',
  weekly_limit_reached: 'Has alcanzado tu límite semanal', monthly_limit_reached: 'Has alcanzado tu límite mensual', client_inactive: 'Tu cuenta no está activa', session_started: 'Esta sesión ya ha comenzado', session_cancelled: 'Esta sesión ya no está disponible',
  debt_restriction: 'Hay un saldo pendiente que impide reservar', booking_conflict: 'Ya tienes otra actividad a esa hora', duplicate_booking: 'Ya tienes una reserva o estás en espera', client_already_added: 'Ya tienes una reserva o estás en espera para esta sesión',
  required_document_missing: 'Tienes un documento pendiente', reservation_not_active: 'Esta reserva ya no está activa', waitlist_not_active: 'Esta entrada de espera ya no está activa', idempotency_conflict: 'La solicitud cambió mientras se procesaba. Actualiza la agenda e inténtalo de nuevo.',
  internal_error: 'Ahora no podemos consultar tu espacio.', database_unavailable: 'Ahora no podemos conectar con el centro.', authentication_required: 'Inicia sesión para continuar.',
};
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
const monthRange = (selected = dateKey(new Date())) => {
  const [year, month] = selected.split('-').map(Number);
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  return { from, to: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}` };
};
const shiftMonthKey = (value: string, months: number) => {
  const [year, month] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1 + months, 1, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
};
const monthGridDays = (selected = dateKey(new Date())) => {
  const { from, to } = monthRange(selected);
  const firstWeekday = (new Date(`${from}T12:00:00Z`).getUTCDay() + 6) % 7;
  const count = Number(to.slice(-2));
  const today = dateKey(new Date());
  return Array.from({ length: Math.ceil((firstWeekday + count) / 7) * 7 }, (_, index) => {
    const day = index - firstWeekday + 1;
    if (day < 1 || day > count) return null;
    const key = `${from.slice(0, 8)}${String(day).padStart(2, '0')}`;
    return { date: key, day, today: key === today };
  });
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
    client: '10000000-0000-4000-8000-000000000001', service: '20000000-0000-4000-8000-000000000001', strength: '20000000-0000-4000-8000-000000000002', pilates: '20000000-0000-4000-8000-000000000003',
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
    profile: { id: ids.client, firstName: 'Juan', lastName: 'Demo', email: 'juan.demo@example.test', phone: '+34 600 000 001', status: 'active' } satisfies ClientProfile,
    services: [{ id: ids.service, name: 'Funcional' }, { id: ids.strength, name: 'Fuerza' }, { id: ids.pilates, name: 'Pilates' }] satisfies MemberBookingService[],
    membership: [{ id: ids.plan, planName: 'Plan 2J', kind: 'monthly', status: 'active', startsOn: dateKey(now), endsOn: null, lastEvent: 'activated', rights: [{ rightType: 'sessions_quota', serviceId: ids.service, serviceName: 'Funcional', serviceStatus: 'active', quantity: 12, balance: 8 }], modules: [{ module: 'training', accessLevel: 'read' }] }] satisfies Assignment[],
    reservations: [{ id: ids.reservation, status: 'reserved', sessionId: ids.session, startsAt, durationMinutes: 45, serviceName: 'Funcional', areaName: 'La Sala', sessionStatus: 'scheduled', isIndividual: false }] satisfies Booking[],
    waitlist: [] as Booking[],
    sessions: [
      session,
      { ...session, id: '30000000-0000-4000-8000-000000000002', serviceId: ids.strength, startsAt: previewDateTime(new Date(`${tomorrow}T12:00:00Z`), 19), serviceName: 'Fuerza', areaName: 'El Búnker', myReservationStatus: null },
      { ...session, id: '30000000-0000-4000-8000-000000000003', startsAt: previewDateTime(new Date(`${addCanaryDays(new Date(`${bookingDay}T12:00:00Z`), 2)}T12:00:00Z`), 18), occupiedCount: 11, myReservationStatus: null },
      { ...session, id: '30000000-0000-4000-8000-000000000004', serviceId: ids.strength, startsAt: previewDateTime(new Date(`${addCanaryDays(new Date(`${bookingDay}T12:00:00Z`), 3)}T12:00:00Z`), 19), serviceName: 'Fuerza', areaName: 'El Búnker', capacity: 8, occupiedCount: 8, waitlistCount: 3, myReservationStatus: null, canJoinWaitlist: true },
      { ...session, id: '30000000-0000-4000-8000-000000000005', serviceId: ids.pilates, startsAt: previewDateTime(new Date(`${addCanaryDays(new Date(`${bookingDay}T12:00:00Z`), 4)}T12:00:00Z`), 10), serviceName: 'Pilates', areaName: 'Sala Estudio', capacity: 10, occupiedCount: 10, waitlistCount: 2, myReservationStatus: null, myWaitlistStatus: 'waiting' },
    ],
    forms: [{ id: ids.form, name: 'Ficha de bienvenida', status: 'assigned', required: true, dueAt: null, category: 'onboarding', version: 1 }] satisfies FormAssignment[],
    consents: [{ consentId: '80000000-0000-4000-8000-000000000001', versionId: '80000000-0000-4000-8000-000000000002', title: 'Normas del centro', body: 'Contenido ficticio de vista previa.', version: 1, required: true, accepted: false }] satisfies Consent[],
    notifications: [{ id: ids.notification, type: 'center_notice', title: 'Nuevo horario del sábado', body: 'Consulta en el centro las novedades de esta semana.', deeplink: null, createdAt: now.toISOString(), readAt: null }] satisfies NotificationItem[],
    news: [{ id: '90000000-0000-4000-8000-000000000001', title: 'Bienvenido a tu espacio 2J', body: 'Aquí encontrarás las novedades importantes de tu centro.', featured: true, publishedAt: now.toISOString() }] satisfies CenterNews[],
    store: [
      { id:'a0000000-0000-4000-8000-000000000001',category:'nutrition',name:'Proteína 2J',description:'Formato 900 g · chocolate',variants:[{id:'a1000000-0000-4000-8000-000000000001',label:'Chocolate · 900 g',size:'900 g',flavor:'Chocolate',priceCents:3290,availability:'disponible'}]},
      { id:'a0000000-0000-4000-8000-000000000002',category:'nutrition',name:'Creatina',description:'Monohidrato · 300 g',variants:[{id:'a1000000-0000-4000-8000-000000000002',label:'Neutra · 300 g',size:'300 g',flavor:null,priceCents:1890,availability:'pocas_unidades'}]},
      { id:'a0000000-0000-4000-8000-000000000003',category:'merchandising',name:'Camiseta 2J',description:'Corte deportivo',variants:[{id:'a1000000-0000-4000-8000-000000000003',label:'Talla M',size:'M',flavor:null,priceCents:2200,availability:'disponible'}]},
      { id:'a0000000-0000-4000-8000-000000000004',category:'merchandising',name:'Sudadera 2J',description:'Edición del centro',variants:[{id:'a1000000-0000-4000-8000-000000000004',label:'Talla L',size:'L',flavor:null,priceCents:4200,availability:'agotado'}]},
    ] satisfies MemberStoreProduct[],
    purchases: [{id:'b0000000-0000-4000-8000-000000000001',status:'completed',paymentState:'paid',totalCents:3290,createdAt:now.toISOString(),lines:[{productName:'Proteína 2J',variantLabel:'Chocolate · 900 g',quantity:1,unitPriceCents:3290,lineTotalCents:3290}]}] satisfies MemberPurchase[],
  };
};
const HUB_TRAINING_URL = import.meta.env?.VITE_2J_HUB_DEMO === 'true' ? '' : 'https://app.2jfitnesscenter.com';
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
  const previewMode = isHubDemoBuild(import.meta.env?.VITE_2J_HUB_DEMO) || (previewModeOverride ?? isHubPreviewEnabled(import.meta.env?.VITE_2J_HUB_PREVIEW, typeof window === 'undefined' ? '' : window.location.search));
  const pilotLoginEnabled = !previewMode && (pilotLoginEnabledOverride ?? import.meta.env?.VITE_2J_PILOT_MEMBER_LOGIN === 'true');
  const pilotToolsEnabled = !previewMode && (import.meta.env?.DEV === true || import.meta.env?.VITE_2J_PILOT_TOOLS === 'true');
  const preview = React.useMemo(() => previewMode ? makeHubPreview() : null, [previewMode]);
  const [view, setView] = React.useState<View>('home');
  const [selectedDate, setSelectedDate] = React.useState(() => preview?.sessions[0] ? dateKey(new Date(preview.sessions[0].startsAt)) : dateKey(new Date()));
  const [selectedServiceId, setSelectedServiceId] = React.useState('');
  const [bookingServices, setBookingServices] = React.useState<MemberBookingService[]>(() => preview?.services ?? []);
  const [bookingTab, setBookingTab] = React.useState<'upcoming' | 'history'>('upcoming');
  const [scheduleLoading, setScheduleLoading] = React.useState(!previewMode);
  const [scheduleError, setScheduleError] = React.useState(false);
  const [scheduleVersion, setScheduleVersion] = React.useState(0);
  const [profile, setProfile] = React.useState<ClientProfile | null>(() => preview?.profile ?? null);
  const push = usePushSubscription(Boolean(profile && !previewMode));
  const [preferences, setPreferences] = React.useState<MemberPreferences>(() => ({ ...defaultPreferences, appearance: readAppearanceHint(previewMode) }));
  const [preferenceSaving, setPreferenceSaving] = React.useState(false);
  const [preferenceError, setPreferenceError] = React.useState('');
  const [preferenceSaved, setPreferenceSaved] = React.useState(false);
  const lastPreferencePatch = React.useRef<Partial<MemberPreferences> | null>(null);
  const [membership, setMembership] = React.useState<Assignment[]>(() => preview?.membership ?? []);
  const [activeMembership, setActiveMembership] = React.useState<Assignment[]>(() => preview?.membership.filter(item => item.status === 'active') ?? []);
  const [trainingCapabilities, setTrainingCapabilities] = React.useState<TrainingCapabilities | null>(null);
  const hasActiveMembership = activeMembership.length > 0;
  const [reservations, setReservations] = React.useState<Booking[]>(() => preview?.reservations ?? []);
  const [waitlist, setWaitlist] = React.useState<Booking[]>(() => preview?.waitlist ?? []);
  const [sessions, setSessions] = React.useState<ClientSession[]>(() => preview?.sessions ?? []);
  const [storeProducts,setStoreProducts]=React.useState<MemberStoreProduct[]>(()=>preview?.store??[]);
  const [purchases,setPurchases]=React.useState<MemberPurchase[]>(()=>preview?.purchases??[]);
  const [storeCategory,setStoreCategory]=React.useState<'nutrition'|'merchandising'>('nutrition');
  const [storeFailed,setStoreFailed]=React.useState(false);
  const [bookingEnabled, setBookingEnabled] = React.useState(false);
  const [forms, setForms] = React.useState<FormAssignment[]>(() => preview?.forms ?? []);
  const [consents, setConsents] = React.useState<Consent[]>(() => preview?.consents ?? []);
  const [notifications, setNotifications] = React.useState<NotificationItem[]>(() => preview?.notifications ?? []);
  const [newsItems, setNewsItems] = React.useState<CenterNews[]>(() => preview?.news ?? []);
  const [featuredNews, setFeaturedNews] = React.useState<CenterNews|null>(() => preview?.news[0] ?? null);
  const [trainingSummary, setTrainingSummary] = React.useState<MemberTrainingSummary|null>(null);
  const [trainingSummaryLoading, setTrainingSummaryLoading] = React.useState(false);
  const [trainingSummaryFailed, setTrainingSummaryFailed] = React.useState(false);
  const [trainingSummaryRetry, setTrainingSummaryRetry] = React.useState(0);
  const [newsError, setNewsError] = React.useState(false);
  const [selectedNews, setSelectedNews] = React.useState<CenterNews|null>(null);
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
  const [waitlistPending, setWaitlistPending] = React.useState<ClientSession | null>(null);
  const [cancellationPending, setCancellationPending] = React.useState<MemberCancellation | null>(null);
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
      setPreferences(defaultPreferences);
      setProfile(preview.profile); setMembership(preview.membership); setActiveMembership(preview.membership.filter(item => item.status === 'active')); setReservations(preview.reservations); setWaitlist(preview.waitlist); setBookingEnabled(false);setStoreProducts(preview.store);setPurchases(preview.purchases);setStoreFailed(false);
      setSessions(preview.sessions); setBookingServices(preview.services); setForms(preview.forms); setConsents(preview.consents); setNotifications(preview.notifications);
      setNewsItems(preview.news); setFeaturedNews(preview.news[0] ?? null); setNewsError(false); setSelectedNews(null);
      setUnreadNotifications(preview.notifications.filter(item => !item.readAt).length); setError(''); setLoading(false); return;
    }
    setLoading(true); setError('');
    try {
      const [me, plans] = await Promise.all([
        api<{ profile: ClientProfile }>('/api/me'),
        api<MembershipResponse>('/api/me/membership'),
      ]);
      const hasActivePlan = plans.active.length > 0;
      const [mine, documents, consentItems, bookingAccess, preferencesResult, newsResult, storeResult, purchaseResult] = await Promise.all([
        hasActivePlan ? api<{ reservations: Booking[]; waitlist: Booking[] }>('/api/me/bookings') : Promise.resolve({ reservations: [], waitlist: [] }),
        api<FormAssignment[]>('/api/client-portal/form-assignments'),
        api<Consent[]>('/api/client-portal/consents'),
        hasActivePlan ? api<{ enabled: boolean }>('/api/me/booking-access') : Promise.resolve({ enabled: false }),
        api<{ preferences: MemberPreferences }>('/api/me/preferences').then(value=>({value,failed:false})).catch(()=>({value:{preferences:defaultPreferences},failed:true})),
        api<{ items:CenterNews[]; featured:CenterNews|null }>('/api/me/news').then(value=>({value,failed:false})).catch(()=>({value:{items:[],featured:null},failed:true})),
        api<{items:MemberStoreProduct[]}>('/api/me/store/catalog').then(value=>({value,failed:false})).catch(()=>({value:{items:[]},failed:true})),
        api<{items:MemberPurchase[]}>('/api/me/store/purchases').then(value=>({value,failed:false})).catch(()=>({value:{items:[]},failed:true})),
      ]);
      setProfile(me.profile); setMembership(plans.assignments); setActiveMembership(plans.active); setTrainingCapabilities(plans.trainingCapabilities ?? null); setReservations(mine.reservations); setWaitlist(mine.waitlist); setForms(documents); setConsents(consentItems); setBookingEnabled(bookingAccess.enabled);
      const loadedPreferences = preferencesResult.value.preferences ?? defaultPreferences;
      setPreferences(loadedPreferences);
      if (!preferencesResult.failed) { try { window.localStorage.setItem(appearanceStorageKey, loadedPreferences.appearance); } catch { /* appearance remains available for this session */ } }
      setNewsItems(newsResult.value.items); setFeaturedNews(newsResult.value.featured); setNewsError(newsResult.failed); setSelectedNews(null);
      setStoreProducts(storeResult.value.items);setPurchases(purchaseResult.value.items);setStoreFailed(storeResult.failed||purchaseResult.failed);
      try { const unread = await api<{count:number}>('/api/me/notifications/unread-count'); setUnreadNotifications(unread.count); } catch { setUnreadNotifications(0); }
    } catch (cause) { const message = cause instanceof Error ? cause.message : ''; setError(message === 'client_authentication_required' ? message : labels[message] ?? 'No se han podido cargar tus datos.'); }
    finally { setLoading(false); }
  }, [preview, previewMode]);
  const login = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setLoginError(''); setBusy('login');
    try { await api('/api/pilot/member/login', { method: 'POST', body: JSON.stringify({ code: pilotCode }) }); setPilotCode(''); await refresh(); }
    catch { setLoginError('No se ha podido iniciar sesión. Comprueba el código e inténtalo de nuevo.'); }
    finally { setBusy(null); }
  };
  const logout = async () => {
    setBusy('logout');
    const pushDeviceRemoved = await push.removeDevice();
    if (!pushDeviceRemoved) { setMessage('No se ha podido desconectar este dispositivo de las notificaciones. La sesión sigue abierta; inténtalo de nuevo.'); setBusy(null); return; }
    try { await api('/api/pilot/member/logout', { method: 'POST', body: '{}' }); }
    catch { setMessage('No se pudo cerrar la sesión; vuelve a intentarlo.'); return setBusy(null); }
    setProfile(null); setMembership([]); setActiveMembership([]); setTrainingCapabilities(null); setReservations([]); setWaitlist([]); setSessions([]); setBookingServices([]); setForms([]); setConsents([]); setNotifications([]); setNewsItems([]); setFeaturedNews(null); setNewsError(false); setSelectedNews(null); setMessage(''); setError('client_authentication_required'); setLoading(false); setView('home'); setBusy(null);
  };
  const savePreferences = async (patch: Partial<MemberPreferences>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next); setPreferenceError(''); setPreferenceSaved(false); lastPreferencePatch.current = patch;
    if (previewMode) return;
    setPreferenceSaving(true);
    try {
      const result = await api<{ preferences: MemberPreferences }>('/api/me/preferences', { method: 'PATCH', body: JSON.stringify(patch) });
      setPreferences(result.preferences); setPreferenceSaved(true); lastPreferencePatch.current = null;
      try { window.localStorage.setItem(appearanceStorageKey, result.preferences.appearance); } catch { /* server remains authoritative */ }
    } catch { setPreferenceError('No se ha podido guardar el cambio. Puedes volver a intentarlo.'); }
    finally { setPreferenceSaving(false); }
  };
  const retryPreferenceSave = () => { if (lastPreferencePatch.current) void savePreferences(lastPreferencePatch.current); };
  React.useEffect(() => { void refresh(); }, [refresh]);
  React.useEffect(() => {
    if (previewMode && preview) { setSessions(preview.sessions); setBookingServices(preview.services); setScheduleLoading(false); setScheduleError(false); return; }
    if (!hasActiveMembership) { setSessions([]); setBookingServices([]); setScheduleLoading(false); setScheduleError(false); return; }
    let current = true;
    const { from, to } = monthRange(selectedDate);
    setScheduleLoading(true); setScheduleError(false);
    void api<{ sessions: ClientSession[] }>(`/api/me/sessions?from=${from}&to=${to}`)
      .then(async result => {
        const catalog = await api<{ services: MemberBookingService[] }>('/api/me/booking-services');
        if (current) { setSessions(result.sessions); setBookingServices(catalog.services?.length ? catalog.services : Array.from(new Map(result.sessions.map(session => [session.serviceId, { id: session.serviceId, name: session.serviceName }])).values())); }
      })
      .catch(() => { if (current) setScheduleError(true); })
      .finally(() => { if (current) setScheduleLoading(false); });
    return () => { current = false; };
  }, [preview, previewMode, hasActiveMembership, selectedDate.slice(0, 7), scheduleVersion]);
  React.useEffect(() => {
    if (view !== 'bunker' || previewMode || !profile) return;
    let current = true;
    setTrainingSummaryLoading(true); setTrainingSummaryFailed(false); setTrainingSummary(null);
    void api<MembershipResponse>('/api/me/membership').then(result => { if (current) setTrainingCapabilities(result.trainingCapabilities ?? null); }).catch(() => { if (current) setTrainingCapabilities(null); });
    void api<MemberTrainingSummary>('/api/me/training-summary')
      .then(result => { if (current) setTrainingSummary(result); })
      .catch(() => { if (current) setTrainingSummaryFailed(true); })
      .finally(() => { if (current) setTrainingSummaryLoading(false); });
    return () => { current = false; };
  }, [view, previewMode, profile?.id, trainingSummaryRetry]);
  React.useEffect(() => {
    if (!trainingCapabilities) return;
    const remaining = Date.parse(trainingCapabilities.expiresAt) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) { setTrainingCapabilities(null); return; }
    const timer = window.setTimeout(() => setTrainingCapabilities(null), remaining);
    return () => window.clearTimeout(timer);
  }, [trainingCapabilities]);
  React.useEffect(() => {
    if (!selectedSession && !waitlistPending && !selectedForm && !selectedConsent && !cancellationPending) return;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    (dialog?.querySelector<HTMLButtonElement>('.sheet-close') ?? dialog?.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setSelectedSession(null); setWaitlistPending(null); setSelectedForm(null); setSelectedConsent(null); setCancellationPending(null); return; }
      if (event.key !== 'Tab' || !dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href]')];
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); if (dialogOpener.current?.isConnected) dialogOpener.current.focus(); };
  }, [selectedSession?.id, waitlistPending?.id, selectedForm?.id, selectedConsent?.versionId, cancellationPending?.booking.id]);

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
  const submitSessionAction = async (session: ClientSession, mode: 'reserve' | 'waitlist') => {
    if (previewMode) { setMessage('Vista previa: no se ha enviado ninguna solicitud.'); setSelectedSession(null); setWaitlistPending(null); return; }
    if (!bookingEnabled || (mode === 'reserve' && !session.eligible) || (mode === 'waitlist' && !session.canJoinWaitlist)) return;
    const assignmentId = mode === 'reserve' ? selectedAssignment || session.availableAlternatives?.[0]?.assignmentId : undefined;
    if (mode === 'reserve' && (session.availableAlternatives?.length ?? 0) > 1 && !assignmentId) { setMessage('Elige qué cuota o bono quieres utilizar.'); return; }
    const operationName = `${mode === 'waitlist' ? 'waitlist' : 'reserve'}:${session.id}:${assignmentId ?? 'automatic'}`;
    const operation = keyFor(operationName); setBusy(`session:${session.id}`); setMessage('');
    try {
      await api(mode === 'waitlist' ? `/api/me/sessions/${session.id}/waitlist` : `/api/me/sessions/${session.id}/reservations`, {
        method: 'POST', headers: { 'idempotency-key': operation.key },
        body: JSON.stringify(assignmentId ? { entitlementAssignmentId: assignmentId } : {}),
      });
      operation.clear(); setSelectedSession(null); setWaitlistPending(null);
      const confirmation = mode === 'reserve' ? 'Reserva realizada correctamente.' : 'Solicitud enviada. La lista de espera no garantiza una plaza.';
      setMessage(confirmation); window.setTimeout(() => setMessage(current => current === confirmation ? '' : current), 4000);
      await refreshMemberBookings();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : 'internal_error';
      if (code === 'member_pilot_action_not_enabled') setBookingEnabled(false);
      setMessage(labels[code] ?? 'No se ha podido completar esta operación. Puedes volver a intentarlo.');
    } finally { setBusy(null); }
  };
  const requestWaitlist = async (session: ClientSession) => {
    if (!bookingEnabled || previewMode) return;
    dialogOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (session.canJoinWaitlist) { setWaitlistPending(session); return; }
    try {
      const result = await api<{ session: ClientSession }>(`/api/me/sessions/${session.id}`);
      if (result.session.canJoinWaitlist) setWaitlistPending(result.session);
      else { setSelectedSession(result.session); setMessage(result.session.eligibilityReason ? labels[result.session.eligibilityReason] ?? 'No puedes apuntarte a esta lista de espera.' : 'Esta lista de espera no está disponible para tu cuenta.'); }
    } catch { setMessage('No se ha podido comprobar si puedes apuntarte a la lista de espera.'); }
  };
  const refreshMemberBookings = async () => {
    if (previewMode) return;
    try {
      const mine = await api<{ reservations: Booking[]; waitlist: Booking[] }>('/api/me/bookings');
      setReservations(mine.reservations); setWaitlist(mine.waitlist); setScheduleVersion(value => value + 1);
    } catch { setMessage('El cambio se ha procesado, pero no se pudo actualizar tu agenda. Vuelve a consultar.'); }
  };
  const cancelBooking = async (booking: Booking) => {
    if (previewMode) { setMessage('La cancelación está desactivada en la vista previa.'); return; }
    if (!bookingEnabled) { setMessage('Las reservas desde la app todavía no están activadas para tu cuenta.'); return; }
    try {
      const preview = await api<{ canCancel: boolean; cancellation: { summary: string } }>(`/api/me/bookings/${booking.id}/cancellation-preview`);
      if (!preview.canCancel) { setMessage('Esta reserva ya no se puede cancelar.'); await refreshMemberBookings(); return; }
      dialogOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setCancellationPending({ kind: 'booking', booking, summary: preview.cancellation.summary });
    } catch (cause) { setMessage(cause instanceof Error ? 'No se ha podido consultar la política de cancelación.' : 'No se ha podido consultar la política de cancelación.'); return; }
  };
  const leaveWaitlist = async (entry: Booking) => {
    if (previewMode) { setMessage('La lista de espera está desactivada en la vista previa.'); return; }
    if (!bookingEnabled) { setMessage('Las reservas desde la app todavía no están activadas para tu cuenta.'); return; }
    dialogOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCancellationPending({ kind: 'waitlist', booking: entry });
  };
  const confirmCancellation = async () => {
    if (!cancellationPending) return;
    const pending = cancellationPending; setBusy(pending.booking.id); setMessage('');
    const operation = keyFor(`${pending.kind === 'booking' ? 'cancel' : 'leave-waitlist'}:${pending.booking.id}`);
    try {
      await api(pending.kind === 'booking' ? `/api/me/bookings/${pending.booking.id}/cancel` : `/api/me/waitlist/${pending.booking.id}/cancel`, { method: 'PATCH', headers: { 'idempotency-key': operation.key }, body: '{}' });
      operation.clear(); setCancellationPending(null); setMessage(pending.kind === 'booking' ? 'La reserva se ha cancelado.' : 'Has salido de la lista de espera.'); await refreshMemberBookings();
    } catch (cause) {
      if (cause instanceof Error && cause.message === 'member_pilot_action_not_enabled') setBookingEnabled(false);
      setMessage(cause instanceof Error ? labels[cause.message] ?? 'No se ha podido completar el cambio. Inténtalo de nuevo.' : 'No se ha podido completar el cambio. Inténtalo de nuevo.');
      setCancellationPending(null);
    } finally { setBusy(null); }
  };
  const openNotifications = async () => { setView('notifications'); if (previewMode) { setNotificationCursor(null); return; } try { const result=await api<{items:NotificationItem[];nextBefore:string|null;nextBeforeId:string|null}>('/api/me/notifications'); setNotifications(result.items);setNotificationCursor(result.nextBefore&&result.nextBeforeId?{before:result.nextBefore,beforeId:result.nextBeforeId}:null); } catch { setMessage('No se han podido cargar tus notificaciones.'); } };
  const openNews = (item:CenterNews|null=null) => { setSelectedNews(item); setMessage(''); setView('news'); };
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
  const activeWaitlist = waitlist.filter(row => row.status === 'waiting' && new Date(row.startsAt).getTime() >= Date.now());
  const upcomingAgenda = [...upcoming.map(booking => ({ booking, waiting: false })), ...activeWaitlist.map(booking => ({ booking, waiting: true }))].sort((a,b) => a.booking.startsAt.localeCompare(b.booking.startsAt));
  const historyAgenda = [...reservations.filter(row => row.status !== 'reserved' || new Date(row.startsAt).getTime() < Date.now()).map(booking => ({ booking, waiting: false })), ...waitlist.filter(row => row.status !== 'waiting' || new Date(row.startsAt).getTime() < Date.now()).map(booking => ({ booking, waiting: true }))].sort((a,b) => b.booking.startsAt.localeCompare(a.booking.startsAt));
  const otherMembership = membership.filter(item => item.status !== 'active');
  const profileServiceMap = new Map<string, { id: string; name: string; status: string; rights: Assignment['rights'] }>();
  for (const plan of membership.filter(item => item.status === 'active')) for (const right of plan.rights) {
    if (!right.serviceId || !right.serviceName) continue;
    const service = profileServiceMap.get(right.serviceId) ?? { id: right.serviceId, name: right.serviceName, status: right.serviceStatus ?? 'active', rights: [] };
    service.rights.push(right); profileServiceMap.set(right.serviceId, service);
  }
  const profileServices = [...profileServiceMap.values()];
  const pendingForms = forms.filter(form => ['assigned','review_required','rejected'].includes(form.status));
  const completedForms = forms.filter(form => ['submitted','approved','expired'].includes(form.status));
  const nextBooking = selectNextConfirmedBooking(reservations);
  const serviceOptions = bookingServices;
  const serviceSessions = sessions.filter(session => !selectedServiceId || session.serviceId === selectedServiceId);
  const sessionsForSelectedDay = serviceSessions.filter(session => dateKey(new Date(session.startsAt)) === selectedDate);
  const daysWithSessions = new Set(serviceSessions.map(session => dateKey(new Date(session.startsAt))));
  const monthName = new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${monthRange(selectedDate).from}T12:00:00Z`));
  const alternatives = selectedSession?.availableAlternatives ?? [];
  const copyDiagnostics = async () => {
    const dimensions = typeof window === 'undefined' ? 'unknown' : `${window.innerWidth}x${window.innerHeight}`;
    const diagnostics = [`app=2j-client-app`, `version=${HUB_BUILD_ID}`, `mode=${previewMode ? 'fixture-preview' : 'platform-pilot'}`, `view=${view}`, `timestamp=${new Date().toISOString()}`, `viewport=${dimensions}`].join('\n');
    try { await navigator.clipboard.writeText(diagnostics); setMessage('Información de diagnóstico copiada.'); }
    catch { setMessage('No se pudo copiar la información de diagnóstico en este navegador.'); }
  };
  const [systemLight, setSystemLight] = React.useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches === true);
  React.useEffect(() => { if (typeof window === 'undefined' || !window.matchMedia) return; const media = window.matchMedia('(prefers-color-scheme: light)'); const update = () => setSystemLight(media.matches); update(); media.addEventListener?.('change', update); return () => media.removeEventListener?.('change', update); }, []);
  const resolvedAppearance = preferences.appearance === 'system' ? (systemLight ? 'light' : 'dark') : preferences.appearance;
  React.useEffect(() => { document.documentElement.dataset['2jAppearance'] = resolvedAppearance; const meta=document.querySelector<HTMLMetaElement>('meta[name="theme-color"]'); if(meta) meta.content=resolvedAppearance==='light'?'#F5F7F4':'#0B0F12'; }, [resolvedAppearance]);
  return <div className={`client-app hub-theme${resolvedAppearance === 'light' ? ' hub-theme-light' : ''}`} data-appearance={resolvedAppearance}>
    <header className="client-header" data-view={view}><a className="client-brand" href="#home" onClick={() => setView('home')} aria-label="2J Fitness, inicio"><span className="client-mark">2J</span><span><strong>2J Fitness</strong><small>Tu espacio</small></span></a><div className="client-header-actions">{previewMode&&<span className="preview-pill">DEMO · DATOS FICTICIOS</span>}{pilotLoginEnabled && profile && <button className="text-button" type="button" onClick={() => void logout()} disabled={busy === 'logout'}>{busy === 'logout' ? 'Saliendo…' : 'Cerrar sesión'}</button>}{profile && <><button className="notification-bell" aria-label={`Notificaciones${unreadNotifications?`, ${unreadNotifications} sin leer`:''}`} onClick={()=>void openNotifications()}><svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>{unreadNotifications>0&&<span aria-hidden="true">{unreadNotifications>99?'99+':unreadNotifications}</span>}</button><button className="avatar" aria-label="Mi perfil" onClick={() => setView('profile')}>{profile.firstName.slice(0,1)}</button></>}</div></header>
    <main className="client-main" id="main-content">
      {loading && <div className="loading-card" role="status"><span className="spinner"/> Cargando tu espacio…</div>}
      {!loading && error === 'client_authentication_required' && pilotLoginEnabled && <section className="state-card error-card" aria-labelledby="member-login-title"><span className="state-icon">2J</span><p className="eyebrow">PILOTO LOCAL</p><h1 id="member-login-title">Tu espacio, a tu manera</h1><p>Introduce el código de acceso de tu piloto para consultar tus reservas y derechos.</p><form className="member-login-form" onSubmit={event => void login(event)}><label className="field-label" htmlFor="member-pilot-code">Código de acceso</label><input id="member-pilot-code" name="code" type="password" autoComplete="one-time-code" value={pilotCode} onChange={event => setPilotCode(event.target.value)} required maxLength={128}/>{loginError && <p role="alert" className="inline-message">{loginError}</p>}<button className="button primary" disabled={busy === 'login' || !pilotCode}>{busy === 'login' ? 'Entrando…' : 'Iniciar sesión'}</button></form></section>}
      {!loading && error && !(error === 'client_authentication_required' && pilotLoginEnabled) && <section className="state-card error-card" role="alert"><span className="state-icon">!</span><h1>Tu espacio no está disponible ahora</h1><p>{error === 'client_authentication_required' ? 'Inicia sesión con tu cuenta para consultar tus reservas y derechos.' : 'Comprueba tu conexión e inténtalo de nuevo.'}</p><button className="button primary" onClick={() => void refresh()}>Intentar de nuevo</button></section>}
      {!loading && !error && profile && <>
        {message && view !== 'bookings' && view !== 'notifications' && !selectedSession && <p className="inline-message page-message" role="status">{message}</p>}
        {previewMode&&<p className="preview-note" role="status">Datos ficticios · las reservas y los trámites no se envían.</p>}
        {view === 'home' && <>
          <section className="hub-greeting"><p className="eyebrow">2J FITNESS CENTER</p><h1>Hola, {profile.firstName}</h1><p>Tu espacio 2J, a tu ritmo.</p></section>
          <section className="home-news" aria-labelledby="home-news-title"><div className="home-block-heading"><span className="card-icon" aria-hidden="true">✦</span><div><p className="eyebrow">2J FITNESS CENTER</p><h2 id="home-news-title">Noticias</h2></div></div>{featuredNews ? <><h3>{featuredNews.title}</h3><p className="home-news-excerpt">{featuredNews.body.length>220?`${featuredNews.body.slice(0,217).trimEnd()}…`:featuredNews.body}</p>{featuredNews.publishedAt&&<small className="home-news-date">{dateLabel(featuredNews.publishedAt)}</small>}<button className="text-button" onClick={()=>openNews(newsItems.length>1?null:featuredNews)}>{newsItems.length>1?'Ver noticias':'Leer noticia'} <span aria-hidden="true">→</span></button></> : newsError ? <><p>No se han podido cargar las noticias.</p><button className="text-button" onClick={()=>void refresh()}>Intentar de nuevo <span aria-hidden="true">→</span></button></> : <p>Ahora mismo no hay noticias publicadas.</p>}</section>
          {hasActiveMembership&&<section className="home-book-cta" aria-labelledby="home-book-title"><div><p className="eyebrow">TU PRÓXIMA EXPERIENCIA</p><h2 id="home-book-title">Reservar clase</h2><p>Selecciona actividad, día y hora.</p></div><button className="button primary" onClick={() => setView('book')}>Ver horarios y reservar <span aria-hidden="true">→</span></button></section>}
          {hasActiveMembership&&nextBooking && <section className="home-next-booking" aria-labelledby="next-booking-title"><div className="home-block-heading"><span className="card-icon" aria-hidden="true"><NavIcon name="calendar"/></span><div><p className="eyebrow">TU AGENDA</p><h2 id="next-booking-title">Próxima reserva</h2></div></div><div className="next-booking-content"><p className="next-booking-service">{nextBooking.serviceName}{nextBooking.isIndividual ? <span className="individual-tag">Cita individual</span> : null}</p><p>{dateLabel(nextBooking.startsAt)} · {timeLabel(nextBooking.startsAt)}–{timeLabel(new Date(Date.parse(nextBooking.startsAt) + nextBooking.durationMinutes * 60_000).toISOString())}</p><p>{nextBooking.areaName}</p><span className="confirmed-pill">Confirmada</span></div><div className="next-booking-actions"><button className="text-button" onClick={() => setView('bookings')}>Mis reservas <span aria-hidden="true">→</span></button><button className="quiet-button" onClick={() => void cancelBooking(nextBooking)} disabled={previewMode || !bookingEnabled} title={previewMode ? 'Desactivado en la vista previa' : !bookingEnabled ? 'Las reservas no están activadas para esta cuenta' : undefined}>Cancelar</button></div></section>}
        </>}
        {view === 'book' && !hasActiveMembership && <section className="empty-card membership-required" aria-labelledby="booking-membership-title"><p className="eyebrow">CUOTA NECESARIA</p><h1 id="booking-membership-title">Reservas no disponibles</h1><p>Para consultar y reservar clases necesitas una cuota vigente. Tu perfil, noticias y tienda siguen disponibles.</p>{message&&<p className="inline-message" role="status">{message}</p>}<button className="button secondary" onClick={()=>setView('profile')}>Consultar mis cuotas</button></section>}
        {view === 'book' && hasActiveMembership && <>
          <div className="page-intro"><p className="eyebrow">TU AGENDA · ATLANTIC/CANARY</p><h1>Reservar</h1><p>Elige una actividad, un día y la sesión que quieras reservar.</p></div>
          <>
            <button className="text-button contextual-link" onClick={() => setView('bookings')}>Mis reservas y lista de espera <span aria-hidden="true">→</span></button>
            {!selectedServiceId ? <section className="member-service-picker" aria-labelledby="service-picker-title"><h2 id="service-picker-title">¿Qué quieres reservar?</h2><p>Actividades con sesiones publicadas para este mes.</p>{scheduleLoading ? <div className="loading-card" role="status"><span className="spinner"/> Buscando actividades…</div> : scheduleError ? <section className="empty-card" role="alert"><h3>No se ha podido cargar la agenda.</h3><button className="text-button" onClick={() => setScheduleVersion(value => value + 1)}>Reintentar</button></section> : serviceOptions.length ? <div className="member-service-grid">{serviceOptions.map(service => <button type="button" className="member-service-choice" key={service.id} onClick={() => { setSelectedServiceId(service.id); const first = sessions.find(session => session.serviceId === service.id); if (first) setSelectedDate(dateKey(new Date(first.startsAt))); }}><span className="service-choice-mark" aria-hidden="true">✦</span><span><strong>{service.name}</strong><small>Ver calendario y horarios</small></span><span aria-hidden="true">→</span></button>)}</div> : <section className="empty-card"><h3>No hay actividades disponibles este mes.</h3><p>Prueba con otro mes o vuelve a consultar más adelante.</p></section>}</section> : <>
              <button className="text-button contextual-link" onClick={() => setSelectedServiceId('')}>← Cambiar actividad</button>
              <section className="member-calendar" aria-label="Calendario mensual de sesiones">
                <div className="month-navigation"><button className="quiet-button" aria-label="Mes anterior" onClick={() => { const next = shiftMonthKey(selectedDate, -1); setSelectedDate(next); }}>‹</button><h2>{monthName}</h2><button className="quiet-button" aria-label="Mes siguiente" onClick={() => { const next = shiftMonthKey(selectedDate, 1); setSelectedDate(next); }}>›</button><button className="quiet-button today-button" onClick={() => setSelectedDate(dateKey(new Date()))}>Hoy</button></div>
                <div className="month-weekdays" aria-hidden="true">{['L','M','X','J','V','S','D'].map((label,index)=><span key={`${label}-${index}`}>{label}</span>)}</div>
                <div className="month-grid" role="group" aria-label={`Días de ${monthName}`}>{monthGridDays(selectedDate).map((day,index)=>day ? <button key={day.date} type="button" aria-label={`${day.day}${daysWithSessions.has(day.date) ? ', hay sesiones' : ''}`} aria-pressed={selectedDate===day.date} aria-current={day.today?'date':undefined} className={`month-day${day.today?' today':''}${selectedDate===day.date?' selected':''}${daysWithSessions.has(day.date)?' has-sessions':''}`} onClick={()=>setSelectedDate(day.date)}><span>{day.day}</span>{daysWithSessions.has(day.date)&&<i aria-hidden="true"/>}</button> : <span key={`empty-${index}`} aria-hidden="true" className="month-day-empty"/>)}</div>
              </section>
              <section className="member-day-sessions" aria-live="polite"><div className="section-heading compact"><div><p className="eyebrow">{serviceOptions.find(item=>item.id===selectedServiceId)?.name}</p><h2>{dateLabel(`${selectedDate}T12:00:00Z`)}</h2></div><span className="session-count">{sessionsForSelectedDay.length} {sessionsForSelectedDay.length===1?'sesión':'sesiones'}</span></div>
                {scheduleLoading ? <div className="loading-card" role="status"><span className="spinner"/> Actualizando horarios…</div> : scheduleError ? <section className="empty-card" role="alert"><h3>No se han podido cargar los horarios.</h3><button className="text-button" onClick={() => setScheduleVersion(value => value + 1)}>Reintentar</button></section> : sessionsForSelectedDay.length ? <div className="session-list">{sessionsForSelectedDay.map(session=><SessionCard key={session.id} session={session} onSelect={()=>void openSession(session)} onWaitlist={()=>void requestWaitlist(session)} disabled={previewMode||!bookingEnabled}/>)}</div> : <section className="empty-card"><h3>No hay sesiones este día.</h3><p>Elige otro día marcado en el calendario.</p></section>}
              </section>
            </>}
          </>
        </>}
        {view === 'news' && (selectedNews ? <><button className="text-button contextual-link" onClick={()=>setSelectedNews(null)}>← Volver a noticias</button><article className="center-news-detail"><p className="eyebrow">2J FITNESS CENTER</p>{selectedNews.publishedAt&&<small>{dateLabel(selectedNews.publishedAt)}</small>}<h1>{selectedNews.title}</h1><p>{selectedNews.body}</p><button type="button" className="text-button" onClick={()=>{setSelectedNews(null);setView('home');}}>Volver a Inicio <span aria-hidden="true">→</span></button></article></> : <><div className="page-intro"><p className="eyebrow">2J FITNESS CENTER</p><h1>Noticias</h1><p>Novedades publicadas por tu centro.</p></div><button className="text-button contextual-link" onClick={()=>setView('home')}>← Volver a Inicio</button>{newsError?<section className="empty-card" role="alert"><h2>No se han podido cargar las noticias</h2><button className="button secondary" onClick={()=>void refresh()}>Intentar de nuevo</button></section>:newsItems.length?<div className="member-news-list">{newsItems.map(item=><article className="member-news-item" key={item.id}><div>{item.featured&&<span className="member-news-featured">Destacada</span>}<h2>{item.title}</h2>{item.publishedAt&&<small>{dateLabel(item.publishedAt)}</small>}</div><p>{item.body.length>260?`${item.body.slice(0,257).trimEnd()}…`:item.body}</p><button className="text-button" onClick={()=>setSelectedNews(item)}>Leer noticia <span aria-hidden="true">→</span></button></article>)}</div>:<section className="empty-card"><h2>No hay noticias publicadas</h2><p>Cuando el centro comparta una novedad, aparecerá aquí.</p></section>}</>)}
        {view === 'bunker' && <BunkerDestination previewMode={previewMode} trainingCapabilities={trainingCapabilities} trainingSummary={trainingSummary} trainingSummaryLoading={trainingSummaryLoading} trainingSummaryFailed={trainingSummaryFailed} onRetry={() => setTrainingSummaryRetry(value => value + 1)} />}
        {view === 'store' && <><div className="page-intro"><p className="eyebrow">2J FITNESS CENTER</p><h1>Tienda</h1><p>Consulta los productos disponibles en el centro.</p></div><div className="store-filter" role="group" aria-label="Filtrar productos por categoría"><button type="button" aria-pressed={storeCategory==='nutrition'} className={storeCategory==='nutrition'?'active':''} onClick={()=>setStoreCategory('nutrition')}>Nutrición</button><button type="button" aria-pressed={storeCategory==='merchandising'} className={storeCategory==='merchandising'?'active':''} onClick={()=>setStoreCategory('merchandising')}>Merchandising</button></div>{storeFailed&&<p className="inline-message" role="alert">No se ha podido actualizar el catálogo o el historial. <button className="text-button" onClick={()=>void refresh()}>Reintentar</button></p>}<div className="member-store-grid">{storeProducts.filter(item=>item.category===storeCategory).map(product=><article className="member-store-card" key={product.id}><span className="store-category-icon" aria-hidden="true">{product.category==='nutrition'?'✦':'◈'}</span><div><h2>{product.name}</h2>{product.description&&<p>{product.description}</p>}</div>{product.variants.map(variant=><div className="member-store-variant" key={variant.id}><span>{variant.label}</span><strong>{new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(variant.priceCents/100)}</strong><small className={`availability ${variant.availability}`}>{variant.availability==='disponible'?'Disponible':variant.availability==='pocas_unidades'?'Pocas unidades':'Agotado'}</small></div>)}</article>)}{storeProducts.filter(item=>item.category===storeCategory).length===0&&!storeFailed&&<section className="empty-card profile-empty"><h2>Aún no hay productos en esta categoría.</h2><p>Vuelve a consultar más adelante.</p></section>}</div><p className="store-notice">Consulta los productos disponibles. Las compras se gestionan directamente en el centro.</p></>}
        {view === 'bookings' && !hasActiveMembership && <section className="empty-card membership-required" aria-labelledby="bookings-membership-title"><p className="eyebrow">CUOTA NECESARIA</p><h1 id="bookings-membership-title">Mis reservas</h1><p>El acceso a reservas requiere una cuota vigente. Puedes seguir consultando tu perfil, avisos, documentos y compras.</p>{message&&<p className="inline-message" role="status">{message}</p>}<button className="button secondary" onClick={()=>setView('profile')}>Consultar mis cuotas</button></section>}
        {view === 'bookings' && hasActiveMembership && <><div className="page-intro"><p className="eyebrow">TU ACTIVIDAD</p><h1>Mis reservas</h1><p>Consulta próximas sesiones y tu historial.</p></div><button className="text-button contextual-link" onClick={() => setView('book')}>Volver a Reservar <span aria-hidden="true">→</span></button>{message && <p className="inline-message" role="status">{message}</p>}<div className="booking-tabs" role="tablist" aria-label="Mis reservas">{([['upcoming','Próximas'],['history','Historial']] as const).map(([id,label])=><button key={id} type="button" role="tab" id={`booking-tab-${id}`} tabIndex={bookingTab===id?0:-1} aria-selected={bookingTab===id} aria-controls={`booking-panel-${id}`} onClick={()=>setBookingTab(id)} onKeyDown={event=>{if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;event.preventDefault();const next=bookingTab==='upcoming'?'history':'upcoming';setBookingTab(next);document.getElementById(`booking-tab-${next}`)?.focus();}}>{label}</button>)}</div>{bookingTab==='upcoming'?<section role="tabpanel" id="booking-panel-upcoming" aria-labelledby="booking-tab-upcoming"><h2 className="visually-hidden">Próximas</h2>{upcomingAgenda.length ? <div className="booking-stack">{upcomingAgenda.map(({booking,waiting}) => <BookingCard key={`${waiting?'waitlist':'reservation'}-${booking.id}`} booking={booking} waiting={waiting} busy={busy===booking.id} actionDisabled={previewMode||!bookingEnabled} onCancel={() => waiting ? void leaveWaitlist(booking) : void cancelBooking(booking)}/>)}</div> : <p className="muted">No tienes reservas ni listas de espera próximas.</p>}</section>:<section role="tabpanel" id="booking-panel-history" aria-labelledby="booking-tab-history"><h2 className="visually-hidden">Historial</h2>{historyAgenda.length ? <div className="booking-stack">{historyAgenda.map(({booking,waiting})=><BookingCard key={`${waiting?'waitlist':'reservation'}-${booking.id}`} booking={booking} waiting={waiting} compact/>)}</div>:<p className="muted">Todavía no tienes actividad en tu historial.</p>}</section>}</>}
        {view === 'notifications' && <><div className="page-intro"><p className="eyebrow">TU ESPACIO</p><h1>Notificaciones</h1><p>Avisos importantes de tus reservas y mensajes.</p></div>{message&&<p className="inline-message" role="status">{message}</p>}{notifications.length>0&&unreadNotifications>0&&<button className="text-button" onClick={()=>void readAllNotifications()}>Marcar todas como leídas</button>}{notifications.length? <div className="notification-list">{notifications.map(item=><article className={`notification-item${item.readAt?' is-read':''}`} key={item.id}><span className="notification-dot" aria-hidden="true"/><button type="button" className="notification-open" aria-label={`Abrir aviso: ${item.title}`} onClick={()=>void openNotification(item)}><strong>{item.title}</strong><p>{item.body}</p><small>{new Intl.DateTimeFormat('es-ES',{timeZone:'Atlantic/Canary',dateStyle:'medium',timeStyle:'short'}).format(new Date(item.createdAt))}</small></button>{!item.readAt&&<button type="button" className="text-button notification-read" onClick={()=>void readNotification(item)}>Marcar leída</button>}</article>)}</div>:<section className="empty-card"><h3>Todo al día</h3><p>Aquí aparecerán los avisos de tus reservas.</p></section>}{notificationCursor&&<button className="button secondary full" onClick={()=>void loadOlderNotifications()}>Cargar anteriores</button>}<button className="text-button" onClick={()=>void refresh()}>Actualizar</button></>}
        {view === 'settings' && <>
          <div className="page-intro"><p className="eyebrow">TU CUENTA</p><h1>Ajustes</h1><p>Preferencias generales de tu experiencia 2J.</p></div>
          <section className="settings-card" aria-labelledby="appearance-title">
            <div><p className="eyebrow">EXPERIENCIA</p><h2 id="appearance-title">Apariencia</h2><p>Elige cómo se muestra 2J en este dispositivo.</p></div>
            <fieldset className="appearance-options" disabled={preferenceSaving}>
              <legend className="visually-hidden">Tema de la aplicación</legend>
              {([['system','Sistema','Sigue la configuración del dispositivo'],['light','Claro','Superficies claras y limpias'],['dark','Oscuro','Grafito y acentos lima']] as const).map(([value,label,description])=><label className={`appearance-option${preferences.appearance===value?' selected':''}`} key={value}><input type="radio" name="appearance" value={value} checked={preferences.appearance===value} onChange={()=>void savePreferences({appearance:value})}/><span className="appearance-option-copy"><strong>{label}</strong><small>{description}</small></span><span className="appearance-indicator" aria-hidden="true">{preferences.appearance===value?'✓':''}</span></label>)}
            </fieldset>
            <p className="settings-feedback" role={preferenceError?'alert':'status'} aria-live="polite">{preferenceError || (preferenceSaving?'Guardando preferencia…':preferenceSaved?'Preferencia guardada.':previewMode?'Vista previa: el cambio solo se aplica aquí.':'Los cambios se guardan automáticamente.')}</p>
            {preferenceError&&<button className="button secondary" type="button" onClick={retryPreferenceSave} disabled={preferenceSaving}>Reintentar</button>}
          </section>
          <section className="settings-card" aria-labelledby="language-title"><div><p className="eyebrow">IDIOMA</p><h2 id="language-title">Idioma</h2><p>El idioma disponible actualmente en el espacio 2J.</p></div><div className="settings-value"><span>Español</span><span className="settings-value-note">Actual</span></div></section>
          <section className="settings-card" aria-labelledby="notifications-title"><div><p className="eyebrow">AVISOS</p><h2 id="notifications-title">Notificaciones</h2><p>Los avisos operativos de reservas, cuenta y documentos se mantienen activos para que no te pierdas información importante.</p></div><div className="settings-note"><strong>Buzón personal</strong><span>Los avisos personales están en Perfil. Las noticias del centro se muestran en Inicio.</span><button type="button" className="text-button" onClick={()=>void openNotifications()}>Abrir buzón <span aria-hidden="true">→</span></button></div></section>
          <section className="settings-card" aria-labelledby="push-title">
            <div><p className="eyebrow">EN ESTE DISPOSITIVO</p><h2 id="push-title">Notificaciones push</h2><p>El buzón de Home sigue disponible aunque las notificaciones del navegador estén apagadas.</p></div>
            {previewMode ? <p className="settings-note" role="status">Las notificaciones push no están conectadas en la demo sintética.</p>
              : push.loading ? <p className="settings-note" role="status">Consultando disponibilidad…</p>
              : push.support === 'needs-install' ? <p className="settings-note" role="status">Para recibir notificaciones en iPhone, añade primero 2J a la pantalla de inicio.</p>
              : push.support === 'unsupported' ? <p className="settings-note" role="status">Este navegador no admite notificaciones push web.</p>
              : push.support === 'denied' ? <p className="settings-note" role="status">El permiso está bloqueado en el navegador. Cámbialo en los ajustes del sitio para activar las notificaciones.</p>
              : push.error ? <div className="settings-note" role="alert"><span>No se ha podido consultar o actualizar el estado de las notificaciones.</span><button type="button" className="text-button" onClick={()=>void push.refresh()}>Reintentar</button></div>
              : push.config?.enabled === false ? <p className="settings-note" role="status">El centro todavía no ha habilitado las notificaciones push.</p>
              : push.available && push.config?.enabled ? <div className="settings-note">
                <strong>{push.config.consent === 'granted' ? 'Consentimiento activado' : 'Consentimiento no activado'}</strong>
                <span>{push.config.activeDevices} {push.config.activeDevices === 1 ? 'dispositivo activo' : 'dispositivos activos'} en tu cuenta.</span>
                <span>Registrar este dispositivo no activa otros. Al retirar el consentimiento, se desactivan todos los dispositivos de la cuenta.</span>
                <button type="button" className="button primary" disabled={push.busy} onClick={()=>void push.enable()}>{push.busy ? 'Activando…' : 'Activar en este dispositivo'}</button>
                {push.config.consent === 'granted' && <button type="button" className="button secondary" disabled={push.busy} onClick={()=>void push.disable()}>{push.busy ? 'Desactivando…' : 'Desactivar en todos los dispositivos'}</button>}
              </div> : <p className="settings-note" role="status">Las notificaciones push no están disponibles en este momento.</p>}
          </section>
          <section className="settings-card" aria-labelledby="account-security-title"><div><p className="eyebrow">ACCESO</p><h2 id="account-security-title">Cuenta y seguridad</h2><p>Información disponible para tu cuenta actual.</p></div><dl className="settings-facts"><div><dt>Correo</dt><dd>{profile.email ?? 'No registrado'}</dd></div><div><dt>Estado de la cuenta</dt><dd>{profile.status==='active'?'Activa':'En revisión'}</dd></div><div><dt>Sesión</dt><dd>Sesión de miembro activa</dd></div></dl>{pilotLoginEnabled&&<button className="button secondary" type="button" onClick={()=>void logout()} disabled={busy==='logout'}>{busy==='logout'?'Cerrando sesión…':'Cerrar sesión'}</button>}<p className="settings-caption">La recuperación de cuenta y los métodos de acceso avanzados aún no están disponibles aquí.</p></section>
          <section className="settings-card" aria-labelledby="privacy-title"><div><p className="eyebrow">TUS DATOS</p><h2 id="privacy-title">Privacidad</h2><p>Consulta la documentación y los consentimientos registrados por tu centro.</p></div><button type="button" className="profile-link-card settings-action" onClick={()=>setView('profile')}><span><strong>Documentos y consentimientos</strong><small>Disponible en Perfil</small></span><span aria-hidden="true">→</span></button><p className="settings-caption">Desde aquí no se solicita la eliminación de la cuenta ni de datos.</p></section>
          <section className="settings-card" aria-labelledby="bunker-settings-title"><div><p className="eyebrow">ENTRENAMIENTO</p><h2 id="bunker-settings-title">Preferencias de entrenamiento</h2><p>Las opciones que afectan únicamente a tus entrenamientos se gestionan dentro de Búnker.</p></div><p className="settings-caption">Incluye temporizadores, progresión, ejercicios y dispositivos. No se duplican en los ajustes generales.</p></section>
          {pilotToolsEnabled&&<section className="pilot-access" aria-labelledby="pilot-access-title"><div><p className="eyebrow">SOLO PARA EL EQUIPO</p><h2 id="pilot-access-title">Herramientas del piloto</h2><p>Accesos internos para revisar las experiencias por separado.</p></div><div className="pilot-links">{HUB_STAFF_URL&&<a className="button secondary" href={HUB_STAFF_URL} target="_blank" rel="noopener noreferrer">Abrir área de entrenador <span aria-hidden="true">↗</span></a>}{HUB_ADMIN_URL&&<a className="button secondary" href={HUB_ADMIN_URL} target="_blank" rel="noopener noreferrer">Abrir administración <span aria-hidden="true">↗</span></a>}</div>{(!HUB_STAFF_URL||!HUB_ADMIN_URL)&&<p className="pilot-setup-note">Configura VITE_2J_STAFF_URL y VITE_2J_ADMIN_URL para mostrar los accesos del piloto.</p>}</section>}
        </>}
        {view === 'profile' && <>
          <div className="page-intro"><p className="eyebrow">TU CUENTA</p><h1>Perfil</h1><p>Tu información y servicios del centro.</p></div>
          <section className="profile-card profile-hero"><div className="profile-avatar" aria-hidden="true">{profile.firstName[0]}{profile.lastName[0]}</div><div className="profile-identity"><p className="eyebrow">MI PERFIL</p><h2>{profile.firstName} {profile.lastName}</h2><p>{profile.email ?? 'Email no indicado'}</p><p>{profile.phone ?? 'Teléfono no indicado'}</p></div><span className="active-pill">{profile.status === 'active' ? 'Cuenta activa' : 'Cuenta inactiva'}</span></section>

          {hasActiveMembership&&<section className="profile-section" aria-labelledby="profile-bookings-title"><div className="section-heading"><div><p className="eyebrow">TU ACTIVIDAD</p><h2 id="profile-bookings-title">Mis reservas</h2></div></div><button className="profile-link-card" type="button" onClick={() => setView('bookings')}><span><strong>Próximas e historial</strong><small>{upcomingAgenda.length ? `${upcomingAgenda.length} ${upcomingAgenda.length === 1 ? 'elemento próximo' : 'elementos próximos'}` : 'Consulta y gestiona tu actividad'}</small></span><span aria-hidden="true">→</span></button></section>}

          <section className="profile-section" aria-labelledby="profile-membership-title"><div className="section-heading"><div><p className="eyebrow">CUOTAS Y SALDO</p><h2 id="profile-membership-title">Tus cuotas</h2></div></div>
          {activeMembership.length ? activeMembership.map(plan => <article className="plan-row" key={plan.id}><div><strong>{plan.planName}</strong><span>{plan.startsOn}{plan.endsOn ? ` · hasta ${plan.endsOn}` : ' · Sin fecha de fin'}</span>{plan.rights.filter(right => right.rightType === 'sessions_quota').map((right,index) => <span key={`${right.rightType}-${index}`}>Saldo de sesiones: {right.balance ?? 0} disponibles</span>)}</div><span className="active-pill">Activa</span></article>) : <section className="empty-card profile-empty"><h3>No tienes ninguna cuota activa.</h3><p>Tu perfil y tu acceso al centro siguen disponibles aunque no tengas una cuota activa.</p></section>}
          {otherMembership.length > 0 && <><h3 className="profile-subheading">Otras cuotas</h3>{otherMembership.map(plan => <article className="plan-row" key={plan.id}><div><strong>{plan.planName}</strong><span>{plan.startsOn}{plan.endsOn ? ` · hasta ${plan.endsOn}` : ''}</span></div><span className="active-pill muted-pill">{plan.status === 'paused' ? 'En pausa' : plan.status === 'scheduled' ? 'Programada' : plan.status === 'expired' ? 'Finalizada' : plan.status === 'cancelled' ? 'Cancelada' : 'Inactiva'}</span></article>)}</>}
          </section>

          <section className="profile-section" aria-labelledby="profile-services-title"><div className="section-heading"><div><p className="eyebrow">MIS SERVICIOS</p><h2 id="profile-services-title">Servicios asociados</h2></div></div>
          {profileServices.length ? profileServices.map(service => <article className="plan-row" key={service.id}><div><strong>{service.name}</strong>{service.rights.map((right,index) => <span key={`${right.rightType}-${index}`}>{rightLabel(right.rightType)}{right.rightType === 'sessions_quota' ? ` · ${right.balance ?? 0} disponibles` : ''}</span>)}</div><span className="active-pill">{service.status === 'active' ? 'Activo' : 'No activo'}</span></article>) : <section className="empty-card profile-empty"><h3>No hay servicios activos asociados.</h3><p>Los servicios aparecerán aquí cuando estén respaldados por tus derechos vigentes.</p></section>}
          </section>

          <section className="profile-section" aria-labelledby="profile-purchases-title"><div className="section-heading"><div><p className="eyebrow">TICKETS Y COMPRAS</p><h2 id="profile-purchases-title">Tus compras</h2></div></div>{(purchases?.length??0)>0? <div className="member-purchase-list">{purchases.map(sale=><article className="member-purchase-card" key={sale.id}><div className="member-purchase-heading"><div><strong>{new Intl.DateTimeFormat('es-ES',{dateStyle:'medium',timeZone:'Atlantic/Canary'}).format(new Date(sale.createdAt))}</strong><span>{sale.status==='voided'?'Anulada':sale.paymentState==='paid'?'Pagada en el centro':'Pendiente de pago'}</span></div><strong>{new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(sale.totalCents/100)}</strong></div>{sale.lines.map((line,index)=><p key={`${sale.id}-${index}`}>{line.productName} · {line.variantLabel} × {line.quantity}<span>{new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(line.lineTotalCents/100)}</span></p>)}</article>)}</div>:<section className="empty-card profile-empty"><h3>Aún no hay compras para mostrar.</h3><p>Tus compras y tickets del centro aparecerán aquí.</p></section>}</section>

          <section className="profile-section" aria-labelledby="profile-inbox-title"><div className="section-heading"><div><p className="eyebrow">BUZÓN</p><h2 id="profile-inbox-title">Mensajes y avisos</h2></div></div><button className="profile-link-card" type="button" onClick={() => void openNotifications()}><span><strong>Abrir buzón</strong><small>{unreadNotifications > 0 ? `${unreadNotifications} ${unreadNotifications === 1 ? 'aviso sin leer' : 'avisos sin leer'}` : 'No tienes avisos sin leer'}</small></span><span aria-hidden="true">→</span></button><p className="profile-caption">Las noticias del centro se muestran por separado en Inicio.</p></section>

          <section className="profile-section" aria-labelledby="profile-documents-title"><div className="section-heading"><div><p className="eyebrow">DOCUMENTACIÓN</p><h2 id="profile-documents-title">Contratos y certificados</h2></div></div>
          <h3 className="profile-subheading">Pendientes</h3>
          {pendingForms.map(form => <article className="plan-row document-row" key={form.id}><div><strong>{form.name}</strong><span>{form.status === 'assigned' ? 'Pendiente de completar' : form.status === 'rejected' ? 'Necesita una corrección' : 'En revisión por el centro'}</span>{form.required && <span>Requerido</span>}</div>{form.status === 'assigned' && <button className="quiet-button" onClick={() => void openForm(form)}>Completar</button>}</article>)}
          {consents.filter(consent => !consent.accepted).map(consent => <article className="plan-row document-row" key={consent.versionId}><div><strong>{consent.title}</strong><span>{consent.required ? 'Pendiente de aceptar' : 'Opcional'}</span>{consent.required && <span>Requerido</span>}</div><button className="quiet-button" onClick={() => openConsent(consent)}>Consultar</button></article>)}
          {pendingForms.length === 0 && consents.every(consent => consent.accepted) && <p className="muted profile-doc-empty">No tienes documentos pendientes.</p>}
          <h3 className="profile-subheading">Completados y enviados</h3>
          {completedForms.map(form => <article className="plan-row document-row" key={form.id}><div><strong>{form.name}</strong><span>{form.status === 'approved' ? 'Completado' : form.status === 'submitted' ? 'Enviado · pendiente de revisión' : 'Caducado'}</span></div></article>)}
          {consents.filter(consent => consent.accepted).map(consent => <article className="plan-row document-row" key={consent.versionId}><div><strong>{consent.title}</strong><span>Aceptado</span></div></article>)}
          {completedForms.length === 0 && consents.every(consent => !consent.accepted) && <p className="muted profile-doc-empty">Todavía no hay documentos completados o enviados.</p>}
          <p className="profile-caption">Las aceptaciones se muestran según el estado registrado por el centro.</p></section>
        </>}
      </>}
    </main>
    {pilotToolsEnabled&&<footer className="pilot-footer"><span>Vista piloto · {HUB_BUILD_ID}</span><button type="button" className="text-button" onClick={() => void copyDiagnostics()}>Copiar información de diagnóstico</button></footer>}
    {!loading && !error && profile && <nav className="bottom-nav" aria-label="Navegación principal">{([['home','Inicio','home'],['bunker','Búnker','bunker'],['store','Tienda','store'],['profile','Perfil','profile'],['settings','Ajustes','settings']] as const).map(([id,label,icon]) => {const active=view===id||(view==='book'&&id==='home')||(view==='bookings'&&id==='home')||(view==='news'&&id==='home')||(view==='notifications'&&id==='profile');return <button key={id} className={active?'nav-button active':'nav-button'} aria-current={active?'page':undefined} onClick={()=>{setView(id);setMessage('');setSelectedNews(null);}}><span aria-hidden="true"><NavIcon name={icon}/></span><small>{label}</small></button>;})}</nav>}
    {selectedSession && <div className="sheet-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedSession(null); }}><section className="session-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><button className="sheet-close" aria-label="Cerrar detalle" onClick={() => setSelectedSession(null)}>×</button><p className="eyebrow">DETALLE DE SESIÓN</p><h2 id="sheet-title">{selectedSession.serviceName}</h2><p className="sheet-subtitle">{dateLabel(selectedSession.startsAt)} · {timeLabel(selectedSession.startsAt)}–{timeLabel(new Date(Date.parse(selectedSession.startsAt)+selectedSession.durationMinutes*60_000).toISOString())} · {selectedSession.areaName}{selectedSession.professionalName?` · ${selectedSession.professionalName}`:''} · {selectedSession.durationMinutes} min</p><div className="sheet-capacity"><span>Plazas disponibles</span><strong>{Math.max(0, selectedSession.capacity - selectedSession.occupiedCount)} de {selectedSession.capacity}</strong></div>{Math.max(0,selectedSession.capacity-selectedSession.occupiedCount)===0&&<p className="eligibility-note">Sesión completa. La lista de espera no garantiza una plaza.</p>}{alternatives.length > 1 && <label className="field-label">Usar derecho<select value={selectedAssignment} onChange={event => setSelectedAssignment(event.target.value)}><option value="">Elige un plan o bono</option>{alternatives.map(item => <option key={item.assignmentId} value={item.assignmentId}>{item.planName ?? 'Plan activo'}</option>)}</select></label>}{message && <p className="inline-message" role="status">{message}</p>}{selectedSession.myReservationStatus && <p className="eligibility-note">Ya tienes una reserva asociada a esta sesión.</p>}{selectedSession.myWaitlistStatus==='waiting'&&<p className="eligibility-note">Ya estás en la lista de espera de esta sesión.</p>}{selectedSession.eligibilityReason&&<p className="eligibility-note">{labels[selectedSession.eligibilityReason]??'Esta sesión no está disponible para tu cuenta.'}</p>}{selectedSession.eligible && !selectedSession.myReservationStatus && !selectedSession.myWaitlistStatus && <button className="button primary full" disabled={previewMode||!bookingEnabled||busy===`session:${selectedSession.id}`||(alternatives.length>1&&!selectedAssignment)} onClick={()=>void submitSessionAction(selectedSession,'reserve')}>{busy===`session:${selectedSession.id}`?'Reservando…':'Reservar'}</button>}{selectedSession.canJoinWaitlist&&!selectedSession.myWaitlistStatus&&!selectedSession.myReservationStatus&&<button className="button secondary full" disabled={previewMode||!bookingEnabled||busy===`session:${selectedSession.id}`} onClick={()=>{setSelectedSession(null);setWaitlistPending(selectedSession);}}>Lista de espera</button>}{selectedSession.myReservationStatus&&(()=>{const booking=reservations.find(row=>row.sessionId===selectedSession.id&&row.status==='reserved');return booking?<button className="button secondary full" disabled={previewMode||!bookingEnabled} onClick={()=>{setSelectedSession(null);void cancelBooking(booking);}}>Cancelar reserva</button>:null})()}{selectedSession.myWaitlistStatus==='waiting'&&(()=>{const entry=waitlist.find(row=>row.sessionId===selectedSession.id&&row.status==='waiting');return entry?<button className="button secondary full" disabled={previewMode||!bookingEnabled} onClick={()=>{setSelectedSession(null);void leaveWaitlist(entry);}}>Salir de la lista de espera</button>:null})()}{previewMode && !selectedSession.myReservationStatus&&!selectedSession.myWaitlistStatus && <p className="preview-action-note">Vista previa: las acciones no se envían.</p>}{!bookingEnabled && !previewMode && <p className="eligibility-note">{selectedSession.eligibilityReason==='no_active_entitlement'?'Necesitas una cuota activa para reservar este servicio.':'Las reservas desde la app todavía no están activadas para esta cuenta.'}</p>}</section></div>}
    {waitlistPending && <div className="sheet-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setWaitlistPending(null);}}><section className="session-sheet cancellation-sheet" role="dialog" aria-modal="true" aria-labelledby="waitlist-title"><p className="eyebrow">LISTA DE ESPERA</p><h2 id="waitlist-title">¿Quieres apuntarte?</h2><p className="sheet-subtitle">{waitlistPending.serviceName} · {dateLabel(waitlistPending.startsAt)} · {timeLabel(waitlistPending.startsAt)}</p><p>La lista de espera no garantiza una plaza. Te mostraremos el estado en Próximas.</p>{message&&<p className="inline-message" role="alert">{message}</p>}<div className="member-confirm-actions"><button className="button secondary" onClick={()=>setWaitlistPending(null)}>Volver</button><button className="button primary" disabled={busy===`session:${waitlistPending.id}`} onClick={()=>void submitSessionAction(waitlistPending,'waitlist')}>{busy===`session:${waitlistPending.id}`?'Enviando…':'Confirmar solicitud'}</button></div></section></div>}
    {cancellationPending && <div className="sheet-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setCancellationPending(null);}}><section className="session-sheet cancellation-sheet" role="dialog" aria-modal="true" aria-labelledby="cancel-title"><p className="eyebrow">{cancellationPending.kind==='booking'?'GESTIONAR RESERVA':'LISTA DE ESPERA'}</p><h2 id="cancel-title">{cancellationPending.kind==='booking'?'¿Cancelar esta reserva?':'¿Salir de la lista de espera?'}</h2><p className="sheet-subtitle">{cancellationPending.booking.serviceName} · {dateLabel(cancellationPending.booking.startsAt)} · {timeLabel(cancellationPending.booking.startsAt)}</p><p>{cancellationPending.kind==='booking'?cancellationPending.summary:'Esto no es una cancelación de clase y no tiene penalización. Dejarás de figurar en la lista de espera.'}</p><div className="member-confirm-actions"><button className="button secondary" onClick={()=>setCancellationPending(null)}>Volver</button><button className="button primary" disabled={busy===cancellationPending.booking.id} onClick={()=>void confirmCancellation()}>{busy===cancellationPending.booking.id?'Actualizando…':cancellationPending.kind==='booking'?'Cancelar reserva':'Salir de la lista'}</button></div></section></div>}
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

function SessionCard({ session, onSelect, onWaitlist, disabled = false }: { session: ClientSession; onSelect: () => void; onWaitlist: () => void; disabled?: boolean }) {
  const free = Math.max(0, session.capacity - session.occupiedCount);
  const ownStatus = session.myReservationStatus ? 'Reservada' : session.myWaitlistStatus === 'waiting' ? 'En espera' : session.myWaitlistStatus === 'promoted' ? 'Reservada' : null;
  const notEntitled = session.eligible === false && session.eligibilityReason === 'no_active_entitlement';
  const availability = ownStatus ?? (notEntitled ? 'No permitida por tu cuota' : free > 0 ? 'Disponible' : 'Completa');
  const canRequestWaitlist = free === 0 && !ownStatus;
  return <article className={`session-card${free===0?' is-full':''}`}><button type="button" className="session-card-detail" onClick={onSelect} aria-label={`${timeLabel(session.startsAt)} · ${availability}. Ver detalles`}><strong className="session-card-time">{timeLabel(session.startsAt)}</strong><span className={`session-meta${free===0?' full':''}`}>{availability}</span><span className="session-arrow" aria-hidden="true">→</span></button>{canRequestWaitlist&&<button type="button" className="session-waitlist-button" onClick={onWaitlist} disabled={disabled}>Lista de espera</button>}</article>;
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
function BunkerDestination({ previewMode, trainingCapabilities, trainingSummary, trainingSummaryLoading, trainingSummaryFailed, onRetry }: {
  previewMode: boolean;
  trainingCapabilities: TrainingCapabilities | null;
  trainingSummary: MemberTrainingSummary | null;
  trainingSummaryLoading: boolean;
  trainingSummaryFailed: boolean;
  onRetry: () => void;
}) {
  const level = trainingCapabilities?.capabilityLevel;
  const capabilityNames = trainingCapabilities ? trainingCapabilityLabels(trainingCapabilities.capabilities) : [];
  return <section className="hub-destination">
    <div className="destination-mark"><NavIcon name="bunker"/></div><p className="eyebrow">ENTRENAMIENTO</p><h1>Búnker</h1>
    <p>Tu espacio de rutinas, seguimiento y progreso.</p>
    {previewMode ? <p role="status">La conexión con Búnker no está activa en esta demo sintética.</p> : <div className="hub-training-summary" aria-label="Capacidades de entrenamiento">
      <strong>{trainingCapabilities ? `Acceso ${level === 'full' ? 'completo' : level === 'autonomous' ? 'autónomo' : level === 'baseline' ? 'básico' : 'bloqueado'}` : 'Capacidades de entrenamiento no disponibles'}</strong>
      {trainingCapabilities && <>
        <p>{trainingCapabilities.reasonCode === 'ADMIN_SUSPENDED' ? 'El acceso está suspendido por el centro.' : trainingCapabilities.reasonCode === 'TRAINING_LINK_REVOKED' ? 'El vínculo con Búnker está revocado.' : trainingCapabilities.reasonCode === 'TRAINING_LINK_MISSING' ? 'El perfil de Búnker aún no está vinculado.' : 'Opciones calculadas por Platform para tu cuenta.'}</p>
        {capabilityNames.length ? <ul>{capabilityNames.map(label => <li key={label}>{label}</li>)}</ul> : <p>No hay funciones de entrenamiento disponibles en este momento.</p>}
      </>}
    </div>}
    {!previewMode && (trainingSummaryLoading ? <p role="status">Consultando tu espacio de entrenamiento…</p> : trainingSummaryFailed || (trainingSummary?.status === 'linked' && trainingSummary.summaryStatus === 'unavailable') ? <div role="status"><p>Información de entrenamiento temporalmente no disponible.</p><button className="text-button" onClick={onRetry}>Intentar de nuevo</button></div> : trainingSummary?.status === 'not_linked' ? <p role="status">Búnker aún no vinculado.</p> : trainingSummary?.status === 'linked' && trainingSummary.summaryStatus === 'available' ? <div className="hub-training-summary" role="status"><strong>Búnker conectado</strong>{trainingSummary.summary.currentProgram && <p>Programa actual: {trainingSummary.summary.currentProgram.name}</p>}{trainingSummary.summary.recentActivity && <p>{trainingSummary.summary.recentActivity.lastTrainingAt ? `Última actividad: ${dateLabel(`${trainingSummary.summary.recentActivity.lastTrainingAt}T12:00:00.000Z`)}` : 'Todavía no hay actividad reciente.'} · {trainingSummary.summary.recentActivity.sessionsLast30Days} {trainingSummary.summary.recentActivity.sessionsLast30Days === 1 ? 'entreno' : 'entrenos'} en los últimos 30 días</p>}</div> : null)}
    {previewMode ? <button className="button primary" type="button" disabled>Abrir Búnker</button> : <a className="button primary" href={HUB_TRAINING_URL} target="_blank" rel="noopener noreferrer">Abrir Búnker <span aria-hidden="true">↗</span></a>}
    <small>{previewMode ? 'La demo no abre aplicaciones ni servicios externos.' : 'Se abrirá el espacio de entrenamiento en una nueva pestaña.'}</small>
  </section>;
}

function weekRangeDays(selected = dateKey(new Date())) {
  const start = weekRange(selected).from; const todayKey = dateKey(new Date());
  return Array.from({length:7},(_,index)=>{const key=shiftDateKey(start,index);const date=new Date(`${key}T12:00:00Z`);return {date:key,label:new Intl.DateTimeFormat('es-ES',{timeZone:'UTC',weekday:'short'}).format(date),number:new Intl.DateTimeFormat('es-ES',{timeZone:'UTC',day:'numeric'}).format(date),today:key===todayKey};});
}

export const clientAppTestHelpers = { dateKey, timeLabel, weekRange, weekRangeDays, monthRange, monthGridDays, shiftMonthKey, shiftDateKey, labels, resolveClientNotificationTarget, isHubPreviewEnabled, isHubDemoBuild, selectNextConfirmedBooking, trainingCapabilityLabels, HUB_TRAINING_URL };
