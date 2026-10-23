import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, IconButton, PageHeader, SegmentedControl, icons } from '@2j/ui';
import { ScheduleEditor, type ScheduleSubmitItem, type ScheduleSubmitResult } from './schedule-editor';
import { serviceColorIndex, type ExistingGroup } from './schedule-logic';
export { serviceColorIndex };

const apiUrl = import.meta.env?.VITE_API_URL ?? 'http://127.0.0.1:3100';
type Session = { id: string; serviceId: string; serviceName: string; areaId: string; areaName: string; professionalId?:string|null;professionalName?:string|null;templateId: string | null; source: 'manual' | 'template'; startsAt: string; durationMinutes: number; capacity: number; status: 'scheduled' | 'cancelled'; occupiedCount: number; overbookCount: number; waitlistCount: number; isIndividual: boolean; occurrenceOverridden?:boolean };
type ClientOption = { id: string; firstName: string; lastName: string };
type BookingAlternative={assignmentId:string;planId:string;planName:string;availableBalance:number|null;periodUsage:{period:string;used:number;limit:number}[]};
type BookingPreview={allowed:boolean;decision:string;blockingReasons:string[];selectedEntitlement:BookingAlternative|null;availableAlternatives:BookingAlternative[];capacity:{occupied:number;limit:number;available:number}|null;waitlistAllowed:boolean;overridePossible:{debt:boolean;documents:boolean;capacity:boolean};requiredDocuments?:Array<{requirementId:string;requirementType:string;label:string}>};
type Attendee = { id: string; clientId: string; firstName: string; lastName: string; status: string; createdAt: string };
type CalendarConfirmation = { title: string; message: string; confirmLabel: string; tone?: 'danger' | 'primary'; action: () => void };
type CalendarData = { weekStart: string; timezone: 'Atlantic/Canary'; sessions: Session[]; currentProfessionalId?:string|null; professionals:{id:string;displayName:string;calendarColor:string|null}[]; areas: { id: string; name: string }[]; services: { id: string; name: string; areaId: string }[]; templates: { id: string; serviceId: string; serviceName: string; areaId: string; areaName: string; professionalId?:string|null;professionalName?:string|null;weekday: number; localStartTime: string; durationMinutes: number; capacity: number; startsOn: string; endsOn: string | null }[]; capabilities: { manage: boolean; attendance: boolean; overrideCapacity: boolean;overrideAvailability:boolean;overrideDocuments:boolean;overrideDebt:boolean } };
export type CalendarFilter = 'all'|'upcoming'|'mine'|'full'|'waitlist'|'cancelled';
export function filterCalendarSessions<T extends {status:string;startsAt:string;serviceId:string;professionalId?:string|null;capacity:number;occupiedCount:number;waitlistCount:number}>(sessions:T[], filter:CalendarFilter, currentProfessionalId:string|null|undefined, now=Date.now(), serviceId='', professionalId='') {
  return sessions.filter(session => {
    if (serviceId && session.serviceId!==serviceId) return false;
    if (professionalId && session.professionalId!==professionalId) return false;
    if (filter==='cancelled') return session.status==='cancelled';
    if (filter==='all') return true;
    if (session.status==='cancelled') return false;
    if (filter==='upcoming') return Date.parse(session.startsAt)>now;
    if (filter==='mine') return Boolean(currentProfessionalId && session.professionalId===currentProfessionalId);
    if (filter==='full') return session.occupiedCount>=session.capacity;
    if (filter==='waitlist') return session.waitlistCount>0;
    return true;
  });
}

export function groupSessionsByOverlap<T extends { id:string; startsAt:string; durationMinutes:number }>(sessions:T[]) {
  const sorted=[...sessions].sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt)||a.id.localeCompare(b.id));
  const groups:T[][]=[]; let group:T[]=[]; let groupEnd=-Infinity;
  for(const session of sorted){const start=Date.parse(session.startsAt);const end=start+session.durationMinutes*60_000;if(group.length&&start>=groupEnd){groups.push(group);group=[];groupEnd=-Infinity;}group.push(session);groupEnd=Math.max(groupEnd,end);}
  if(group.length)groups.push(group);return groups;
}
const spanishDate = new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', weekday: 'short', day: 'numeric', month: 'short' });
// Day + month without the weekday, for labels that already carry the full weekday name (avoids "Sábado sáb, 17 oct").
const dayMonthDate = new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', day: 'numeric', month: 'short' });
// "sáb 17 oct" (no comma): the day title in Día view.
const shortDayTitle = { format: (value: Date) => spanishDate.format(value).replace(',', '') };
const spanishTime = new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', hour: '2-digit', minute: '2-digit' });
const dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
function localTimeEnd(value:string,duration:number) { const [hour,minute]=value.slice(0,5).split(':').map(Number);const total=(hour??0)*60+(minute??0)+duration;return `${String(Math.floor(total/60)%24).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`; }
type ScheduleTemplate = CalendarData['templates'][number];

function dateKey(value: Date) { return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`; }
function canaryDateKey(value: Date) { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value); const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''; return `${part('year')}-${part('month')}-${part('day')}`; }
function canaryToday() { const [year, month, day] = canaryDateKey(new Date()).split('-').map(Number); return new Date(Date.UTC(year!, month! - 1, day!)); }
function localDateTimeToCanaryIso(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error('Indica una fecha y hora válidas.');
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  let candidate = target;
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = formatter.formatToParts(new Date(candidate)); const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? '0');
    candidate += target - Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'));
  }
  if (canaryDateKey(new Date(candidate)) !== `${match[1]}-${match[2]}-${match[3]}` || formatter.formatToParts(new Date(candidate)).filter((item) => ['hour','minute'].includes(item.type)).map((item) => item.value).join(':') !== `${match[4]}:${match[5]}`) throw new Error('Esa hora local no existe por el cambio horario. Elige otra hora.');
  return new Date(candidate).toISOString();
}
function canaryInputDateTime(value: string) { const date = new Date(value); const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date); const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''; return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`; }
function calendarGridRow(group:Session[]) { const minutes=(value:string)=>{const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Atlantic/Canary',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));const part=(type:string)=>Number(parts.find(item=>item.type===type)?.value??0);return part('hour')*60+part('minute');};const start=Math.max(6*60,Math.min(22*60,Math.min(...group.map(item=>minutes(item.startsAt)))));const end=Math.min(22*60,Math.max(...group.map(item=>minutes(item.startsAt)+item.durationMinutes)));const row=Math.floor((start-6*60)/30)+1;const span=Math.max(2,Math.ceil((end-start)/30));return `${row} / span ${span}`; }
function weekMonday(from: Date) { const day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())); day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7)); return day; }
function addDays(value: Date, count: number) { const result = new Date(value); result.setUTCDate(result.getUTCDate() + count); return result; }
function errorMessage(error: unknown) { return error instanceof TypeError ? 'No hay conexión con el servicio. Comprueba la red e inténtalo de nuevo.' : error instanceof Error ? error.message : 'No se pudo completar la operación.'; }
function validationMessage(details: unknown) { const fieldErrors = (details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors ?? {}; const specific = Object.values(fieldErrors).flat().find((message) => typeof message === 'string' && /[áéíóúñ¿]|^Indica|^Selecciona|^Elige/.test(message) && !/^(String|Number|Required|Invalid|Expected)/.test(message)); return specific ?? 'Revisa los datos del formulario: alguno falta o no es válido.'; }
function humanError(code: string, warnings: string[] = []) { const warningText=warnings.map((warning)=>({outside_working_hours:'Fuera del horario habitual',professional_absent:'Ausencia programada',substitution_available:'Hay un sustituto disponible'} as Record<string,string>)[warning]).filter(Boolean).join(' · '); if(code==='professional_availability_confirmation_required'&&warningText)return `Confirma la excepción: ${warningText}.`; return ({ session_cancelled: 'La sesión está cancelada.', required_documents_pending:'Faltan documentos para completar la reserva.', capacity_full: 'La sesión está completa. Puedes añadir al cliente a la lista de espera.', client_not_found: 'No se encontró el cliente.', client_archived: 'El cliente está archivado y no puede reservar.', client_already_added: 'El cliente ya está en la sesión o en espera.', entitlement_unavailable: 'No se puede confirmar un derecho o saldo activo para este cliente.', entitlement_required: 'Este cliente no tiene un derecho o saldo disponible para esta sesión.',no_entitlement:'Este cliente no tiene un derecho activo para este servicio.',service_not_allowed:'El plan del cliente no incluye este servicio.',entitlement_not_started:'El derecho todavía no está vigente para la fecha de la sesión.',entitlement_expired:'El derecho habrá caducado en la fecha de la sesión.',entitlement_paused:'El derecho está pausado.',entitlement_cancelled:'El derecho está cancelado.',entitlement_exhausted:'No quedan sesiones disponibles en el bono.',weekly_limit_reached:'Ya ha utilizado el máximo de sesiones de esta semana.',monthly_limit_reached:'Ya ha utilizado el máximo de sesiones de este mes.',duplicate_booking:'El cliente ya tiene una reserva o está en espera para esta sesión.',booking_conflict:'El cliente tiene otra reserva que se solapa con esta sesión.',debt_restriction:'Hay un cargo vencido que bloquea nuevas reservas.',overdue_balance_blocks_booking:'Hay un cargo vencido que bloquea nuevas reservas.',required_document_missing:'Falta documentación obligatoria para reservar.',session_full:'La sesión está completa.',entitlement_selection_required:'Elige qué derecho del cliente debe utilizarse.',entitlement_selection_invalid:'El derecho seleccionado ya no está disponible.',idempotency_conflict:'La solicitud no coincide con un intento anterior. Actualiza la ficha y vuelve a intentarlo.', individual_session_client_mismatch: 'Esta cita individual está reservada para otro cliente.', individual_capacity_fixed: 'Una cita individual siempre conserva una plaza.', professional_session_conflict: 'Ese profesional ya tiene otra sesión en ese horario.', capacity_below_occupancy: 'La capacidad no puede quedar por debajo de las plazas ocupadas.', service_archived: 'El servicio ya no está disponible para reservas.', area_archived: 'El área ya no está disponible para reservas.', future_calendar_items_exist: 'Resuelve primero las sesiones y plantillas futuras de este servicio o área.', session_not_found_or_cancelled: 'La sesión ya está cancelada o no está disponible.', professional_unavailable: 'El profesional ya no está disponible.', professional_availability_confirmation_required: 'Revisa los avisos de disponibilidad antes de confirmar.', override_reason_required: 'Indica un motivo para confirmar esta excepción.', permission_denied: 'Tu perfil no tiene permiso para esta acción.', session_started: 'La sesión ya ha empezado y no admite nuevas reservas.', session_not_found: 'La sesión ya no existe.', session_not_editable: 'Solo se pueden editar sesiones programadas.', session_already_generated: 'Esa sesión ya existe.', schedule_conflict: 'Los horarios se solapan entre sí o con otro horario existente del mismo profesional.', service_not_found: 'El servicio ya no existe.', service_area_mismatch: 'El servicio no pertenece a esa área.', area_not_found: 'El área ya no existe.', template_not_found: 'No se encontró el horario recurrente.', template_inactive: 'El horario recurrente no está activo en esa fecha.', template_not_active: 'El horario recurrente ya no está activo.', template_weekday_mismatch: 'La fecha no coincide con el día de la semana del horario.', reservation_not_found: 'No se encontró la reserva.', reservation_not_active: 'Esta reserva ya no está activa.', waitlist_not_found: 'No se encontró la entrada de la lista de espera.', waitlist_not_active: 'Esta entrada de la lista de espera ya no está activa.', client_inactive: 'El cliente no está activo.', authentication_required: 'Tu sesión ha caducado. Vuelve a iniciar sesión.', internal_error: 'El servicio ha tenido un fallo. Inténtalo de nuevo en unos minutos.' } as Record<string, string>)[code] ?? 'No se pudo completar la operación. Inténtalo de nuevo.'; }

export function CalendarPage() {
  const [week, setWeek] = useState(() => weekMonday(canaryToday()));
  const [data, setData] = useState<CalendarData | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [selectedDay, setSelectedDay] = useState(() => (canaryToday().getUTCDay() + 6) % 7);
  const [isNarrow,setIsNarrow]=useState(()=>typeof window!=='undefined'&&window.matchMedia?.('(max-width: 1120px)').matches===true);
  const [viewMode,setViewMode]=useState<'day'|'week'>(()=>typeof window!=='undefined'&&window.matchMedia?.('(max-width: 1120px)').matches?'day':'week');
  const [sessionFilter,setSessionFilter]=useState<CalendarFilter>('all');
  const [serviceFilter,setServiceFilter]=useState('');
  const [professionalFilter,setProfessionalFilter]=useState('');
  const [dialog, setDialog] = useState<'session' | 'template' | 'bulk-template' | null>(null);
  const dialogMode = dialog as 'session' | 'template' | 'bulk-template' | null;
  const scheduleDirtyRef = useRef(false);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [editingOccurrence, setEditingOccurrence] = useState(false);
  const [occurrenceAvailabilityWarning, setOccurrenceAvailabilityWarning] = useState(false);
  const [occurrenceAvailabilityOverride, setOccurrenceAvailabilityOverride] = useState(false);
  const [occurrenceAvailabilityReason, setOccurrenceAvailabilityReason] = useState('');
  const [createAvailabilityWarnings, setCreateAvailabilityWarnings] = useState<string[] | null>(null);
  const [createAvailabilityReason, setCreateAvailabilityReason] = useState('');
  const [attendees, setAttendees] = useState<{ reservations: Attendee[]; waitlist: Attendee[] } | null>(null);
  const [attendeeError, setAttendeeError] = useState('');
  const [clientQuery, setClientQuery] = useState('');
  const [clientOptions, setClientOptions] = useState<ClientOption[]>([]);
  const [clientActiveIndex, setClientActiveIndex] = useState(0);
  const [clientBusy, setClientBusy] = useState(false);
  const [clientSearchError, setClientSearchError] = useState('');
  const [clientId, setClientId] = useState('');
  const [bookingPreview,setBookingPreview]=useState<BookingPreview|null>(null);
  const [bookingPreviewBusy,setBookingPreviewBusy]=useState(false);
  const [bookingPreviewError,setBookingPreviewError]=useState('');
  const [entitlementAssignmentId,setEntitlementAssignmentId]=useState('');
  const [overrideDebt,setOverrideDebt]=useState(false);
  const [overrideDebtReason,setOverrideDebtReason]=useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const modalRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [notice, setNotice] = useState('');
  const [sessionFeedback, setSessionFeedback] = useState('');
  const [missingDocuments, setMissingDocuments] = useState<{label:string;requirementType:string}[]>([]);
  const [overrideDocuments, setOverrideDocuments] = useState(false);
  const [documentOverrideReason, setDocumentOverrideReason] = useState('');
  const [confirmation, setConfirmation] = useState<CalendarConfirmation | null>(null);
  const confirmationOpenerRef = useRef<HTMLElement | null>(null);
  const confirmationRef = useRef<HTMLElement>(null);
  const idempotencyKeysRef=useRef(new Map<string,string>());

  async function loadWeek(keepVisible = false) {
    if (!keepVisible || !data) setState('loading'); setError('');
    try {
      const response = await fetch(`${apiUrl}/api/calendar/week?weekStart=${dateKey(week)}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(humanError(body.error ?? 'No se pudo cargar la semana.'));
      setData(body as CalendarData); setState('ready');
      setSelectedSession((current) => current ? (body.sessions as Session[]).find((item) => item.id === current.id) ?? { ...current, status: 'cancelled' } : null);
    } catch (caught) { setError(errorMessage(caught)); setState('error'); }
  }
  useEffect(() => { void loadWeek(); }, [week, retry]);
  useEffect(()=>{if(typeof window==='undefined'||!window.matchMedia)return;const media=window.matchMedia('(max-width: 1120px)');const update=()=>{setIsNarrow(media.matches);if(media.matches)setViewMode('day');};update();media.addEventListener?.('change',update);return()=>media.removeEventListener?.('change',update);},[]);

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(week, index)), [week]);
  const sessionsFor = (day: Date) => (data?.sessions ?? []).filter((session) => canaryDateKey(new Date(session.startsAt)) === dateKey(day));
  const visibleSessionsFor = (day:Date) => filterCalendarSessions(sessionsFor(day),sessionFilter,data?.currentProfessionalId,Date.now(),serviceFilter,professionalFilter);
  const hasActiveCalendarFilters=sessionFilter!=='all'||Boolean(serviceFilter)||Boolean(professionalFilter);
  const currentDay = weekDays[selectedDay] ?? weekDays[0]!;
  const weekLabel = `${new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', day: 'numeric', month: 'short' }).format(week)} – ${new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', day: 'numeric', month: 'short', year: 'numeric' }).format(weekDays[6]!)}`;

  function openScheduleEditor(event?: React.MouseEvent<HTMLElement>) {
    if (event) openerRef.current = event.currentTarget;
    setSelectedSession(null); setActionError(''); scheduleDirtyRef.current = false; setDialog('bulk-template');
  }
  function requestCloseSchedule() {
    if (!scheduleDirtyRef.current) { setDialog(null); return; }
    confirmationOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirmation({ title: 'Descartar los horarios nuevos', message: 'Hay horarios añadidos que todavía no se han creado. Si sales ahora, se perderán.', confirmLabel: 'Descartar y salir', tone: 'danger', action: () => { scheduleDirtyRef.current = false; setDialog(null); } });
  }

  function openSession(session: Session, opener: HTMLElement | null = openerRef.current) {
    document.querySelectorAll<HTMLDetailsElement>('.calendar-overflow[open]').forEach((details) => { details.open = false; });
    if (opener) openerRef.current = opener;
    setDialog(null); setSelectedSession(session); setAttendees(null); setAttendeeError(''); setClientId(''); setClientQuery(''); setActionError(''); setNotice(''); setMissingDocuments([]); setOverrideDocuments(false); setDocumentOverrideReason('');setBookingPreview(null);setOverrideDebt(false);setOverrideDebtReason('');
    void fetch(`${apiUrl}/api/calendar/sessions/${session.id}/attendees`).then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(humanError(body.error ?? 'No se pudo cargar la sesión.'));
      setAttendees(body);
    }).catch((caught: unknown) => setAttendeeError(errorMessage(caught)));
  }

  useEffect(() => {
    if ((!selectedSession && dialog !== 'session') || !data?.capabilities.manage || clientQuery.trim().length < 2) { setClientOptions([]); setClientSearchError(''); setClientBusy(false); return; }
    let current = true;
    const timer = window.setTimeout(() => {
      setClientBusy(true); setClientSearchError('');
      void fetch(`${apiUrl}/api/clients?q=${encodeURIComponent(clientQuery.trim())}&status=active&limit=20`)
        .then(async (response) => { const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(humanError(body.error ?? 'No se pudo buscar el cliente.')); return body; })
        .then((body) => { if (current) { setClientOptions(body.items ?? []); setClientActiveIndex(0); } })
        .catch((caught: unknown) => { if (current) setClientSearchError(errorMessage(caught)); })
        .finally(() => { if (current) setClientBusy(false); });
    }, 250);
    return () => { current = false; window.clearTimeout(timer); };
  }, [clientQuery, selectedSession, dialog, data?.capabilities.manage]);

  useEffect(()=>{
    if(!selectedSession||!clientId){setBookingPreview(null);setBookingPreviewError('');setBookingPreviewBusy(false);setEntitlementAssignmentId('');return;}
    let current=true;setBookingPreview(null);setBookingPreviewBusy(true);setBookingPreviewError('');setEntitlementAssignmentId('');
    void fetch(`${apiUrl}/api/calendar/sessions/${selectedSession.id}/booking-eligibility?clientId=${encodeURIComponent(clientId)}`)
      .then(async response=>{const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(humanError(body.error??'No se pudo comprobar la elegibilidad.'));return body as BookingPreview;})
      .then(body=>{if(current){setBookingPreview(body);setMissingDocuments((body.requiredDocuments??[]).map(item=>({label:item.label,requirementType:item.requirementType})));if(body.availableAlternatives.length===1)setEntitlementAssignmentId(body.availableAlternatives[0]!.assignmentId);}})
      .catch(caught=>{if(current)setBookingPreviewError(errorMessage(caught));})
      .finally(()=>{if(current)setBookingPreviewBusy(false);});
    return()=>{current=false;};
  },[selectedSession?.id,clientId]);

  function selectClient(client: ClientOption) { setClientId(client.id); setClientQuery(`${client.firstName} ${client.lastName}`); setClientOptions([]); setClientActiveIndex(0); }
  function onClientPickerKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && clientOptions.length) { event.preventDefault(); setClientActiveIndex((value) => (value + 1) % clientOptions.length); }
    else if (event.key === 'ArrowUp' && clientOptions.length) { event.preventDefault(); setClientActiveIndex((value) => (value + clientOptions.length - 1) % clientOptions.length); }
    else if (event.key === 'Enter' && clientOptions[clientActiveIndex]) { event.preventDefault(); selectClient(clientOptions[clientActiveIndex]!); }
    else if (event.key === 'Escape' && clientOptions.length) { event.preventDefault(); setClientOptions([]); }
  }
  function askConfirmation(event: React.MouseEvent<HTMLElement>, next: CalendarConfirmation) { confirmationOpenerRef.current = event.currentTarget; setConfirmation(next); }

  async function mutate(url: string, method: string, payload?: unknown) {
    setBusy(true); setActionError(''); setNotice(''); setSessionFeedback('');
    const signature=`${method}:${url}:${JSON.stringify(payload??null)}`;
    let idempotencyKey=idempotencyKeysRef.current.get(signature);
    if(!idempotencyKey){idempotencyKey=globalThis.crypto.randomUUID();idempotencyKeysRef.current.set(signature,idempotencyKey);}
    try {
      const response = await fetch(`${apiUrl}${url}`, { method, headers:{...(payload?{'content-type':'application/json'}:{}),'idempotency-key':idempotencyKey}, ...(payload ? { body: JSON.stringify(payload) } : {}) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { if (method === 'POST' && url === '/api/calendar/sessions' && body.error === 'professional_availability_confirmation_required') { setCreateAvailabilityWarnings(Array.isArray(body.warnings) ? body.warnings : []); setActionError(''); return null; } if (body.error === 'validation_error') throw new Error(validationMessage(body.details)); if (body.error === 'required_documents_pending') setMissingDocuments(body.missing ?? []); if (method === 'PATCH' && url.startsWith('/api/calendar/sessions/') && body.error === 'professional_availability_confirmation_required') { setOccurrenceAvailabilityWarning(true); setSessionFeedback('Este cambio queda fuera del horario habitual del profesional.'); } throw new Error(humanError(body.error ?? 'No se pudo completar la operación.', body.warnings ?? [])); }
      idempotencyKeysRef.current.delete(signature);
      setMissingDocuments([]); setOverrideDocuments(false); setDocumentOverrideReason('');
      if (selectedSession) setSessionFeedback('Cambios guardados.'); else setNotice('Cambios guardados.');
      await loadWeek(true);
      if (selectedSession) {
        const refreshed = await fetch(`${apiUrl}/api/calendar/sessions/${selectedSession.id}/attendees`);
        if (refreshed.ok) setAttendees(await refreshed.json());
      }
      return body;
    } catch (caught) { if (selectedSession) setSessionFeedback(errorMessage(caught)); else setActionError(errorMessage(caught)); return null; }
    finally { setBusy(false); }
  }

  async function saveSession(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    if (clientQuery.trim() && !clientId) { setActionError('Elige un cliente de la lista o borra el texto para crear una sesión de grupo.'); return; }
    const selectedService = data?.services.find((service) => service.id === String(form.get('serviceId')));
    if (!selectedService) { setActionError('Selecciona un servicio disponible.'); return; }
    const startsAt = localDateTimeToCanaryIso(String(form.get('startsAt')));
    const overrideAvailability = createAvailabilityWarnings !== null;
    const availabilityReason = createAvailabilityReason.trim();
    if (overrideAvailability && availabilityReason.length < 3) { setActionError('Indica el motivo de la excepción (mínimo 3 caracteres) para crear la sesión fuera de disponibilidad.'); return; }
    const result = await mutate('/api/calendar/sessions', 'POST', { serviceId: selectedService.id, areaId: selectedService.areaId, startsAt, durationMinutes: Number(form.get('durationMinutes')), capacity: clientId ? 1 : Number(form.get('capacity')), ...(String(form.get('professionalId')||'') ? {professionalId:String(form.get('professionalId'))} : {}), overrideAvailability, ...(overrideAvailability ? { availabilityReason } : {}), ...(clientId ? { individualClientId: clientId } : {}), ...(overrideDocuments ? {overrideDocuments:true,documentOverrideReason} : {}) });
    if (result) { setDialog(null); setClientQuery(''); setCreateAvailabilityWarnings(null); setCreateAvailabilityReason(''); await loadWeek(true); }
  }
  async function saveTemplate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const selectedService = data?.services.find((service) => service.id === String(form.get('serviceId')));
    if (!selectedService) { setActionError('Selecciona un servicio disponible.'); return; }
    const result = await mutate('/api/calendar/templates', 'POST', { serviceId: selectedService.id, areaId: selectedService.areaId, weekday: Number(form.get('weekday')), localStartTime: String(form.get('localStartTime')), durationMinutes: Number(form.get('durationMinutes')), capacity: Number(form.get('capacity')), ...(String(form.get('professionalId')||'') ? {professionalId:String(form.get('professionalId'))} : {}), startsOn: String(form.get('startsOn')), endsOn: String(form.get('endsOn')) || null });
    if (result) { setDialog(null); setNotice(`Plantilla guardada. Se han creado ${result.materializedCount ?? 0} sesiones próximas automáticamente.`); await loadWeek(true); }
  }
  // One draft = one call to the existing batch endpoint. Calls run in order and stop at the first failure, so what was created is reported exactly.
  async function createSchedules(items: ScheduleSubmitItem[]): Promise<ScheduleSubmitResult> {
    const createdDraftIds: string[] = [];
    let createdTemplates = 0; let materialized = 0;
    for (const item of items) {
      const result = await mutate('/api/calendar/templates/batch', 'POST', item.payload);
      if (!result) {
        if (createdDraftIds.length) setActionError((current) => `${current || 'No se pudo crear el resto.'} Ya se crearon ${createdTemplates} ${createdTemplates === 1 ? 'horario' : 'horarios'}; los demás siguen en la lista.`);
        return { createdDraftIds, failed: true };
      }
      createdDraftIds.push(item.draftId); createdTemplates += result.templates?.length ?? item.payload.weekdays.length; materialized += result.materializedCount ?? 0;
    }
    scheduleDirtyRef.current = false; setDialog(null);
    setNotice(`${createdTemplates} ${createdTemplates === 1 ? 'horario creado' : 'horarios creados'}; ${materialized} sesiones próximas generadas automáticamente.`);
    return { createdDraftIds, failed: false };
  }
  async function archiveTemplates(templatesToArchive: { id: string }[]) {
    for (const template of templatesToArchive) { const result = await mutate('/api/calendar/templates/' + template.id + '/archive', 'PATCH'); if (!result) return; }
  }
  async function saveOccurrence(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedSession) return;
    const form = new FormData(event.currentTarget);
    let startsAt: string;
    try { startsAt = localDateTimeToCanaryIso(String(form.get('startsAt'))); }
    catch (caught) { setSessionFeedback(errorMessage(caught)); return; }
    const result = await mutate(`/api/calendar/sessions/${selectedSession.id}`, 'PATCH', {
      startsAt, durationMinutes: Number(form.get('durationMinutes')), capacity: Number(form.get('capacity')),
      professionalId: String(form.get('professionalId') || '') || null,
      ...(occurrenceAvailabilityOverride ? { overrideAvailability: true, availabilityReason: occurrenceAvailabilityReason.trim() } : {}),
    });
    if (result) { setSelectedSession((current) => current ? { ...current, ...result } : current); setEditingOccurrence(false); setOccurrenceAvailabilityWarning(false); setOccurrenceAvailabilityOverride(false); setOccurrenceAvailabilityReason(''); setSessionFeedback('Sesión actualizada. La plantilla y las demás fechas no han cambiado.'); }
  }

  const manage = data?.capabilities.manage === true;
  const previewOverrideable=Boolean(bookingPreview)&&bookingPreview!.blockingReasons.length>0&&bookingPreview!.blockingReasons.every(reason=>(reason==='debt_restriction'&&overrideDebt&&overrideDebtReason.trim().length>=3)||(reason==='required_document_missing'&&overrideDocuments&&documentOverrideReason.trim().length>=3));
  const canProceedWithBooking=Boolean(bookingPreview?.allowed||previewOverrideable);
  const canOverbook=Boolean(bookingPreview)&&bookingPreview!.blockingReasons.every(reason=>reason==='session_full'||(reason==='debt_restriction'&&overrideDebt&&overrideDebtReason.trim().length>=3)||(reason==='required_document_missing'&&overrideDocuments&&documentOverrideReason.trim().length>=3));
  busyRef.current = busy;
  const modalOpen = Boolean(dialog || selectedSession);
  const scheduleOpenRef = useRef(false); scheduleOpenRef.current = dialog === 'bulk-template';
  const requestCloseScheduleRef = useRef(requestCloseSchedule); requestCloseScheduleRef.current = requestCloseSchedule;
  useEffect(() => {
    if (!modalOpen) return;
    const container = modalRef.current;
    (container?.querySelector<HTMLElement>('[data-calendar-initial-focus]') ?? container?.querySelector<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled])'))?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busyRef.current) { if (confirmationRef.current) return; if (scheduleOpenRef.current) { requestCloseScheduleRef.current(); return; } setDialog(null); setSelectedSession(null); return; }
      if (event.key !== 'Tab' || !container) return;
      const focusable = [...container.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled])')];
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0]?.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); if (openerRef.current?.isConnected) openerRef.current.focus(); };
  }, [modalOpen]);
  useEffect(() => {
    if (!confirmation) return;
    confirmationRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
    function onKeyDown(event: KeyboardEvent) { if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); setConfirmation(null); } }
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); if (confirmationOpenerRef.current?.isConnected) confirmationOpenerRef.current.focus(); };
  }, [confirmation]);
  const selectedCapacity = selectedSession ? selectedSession.capacity - selectedSession.occupiedCount : 0;
  const todayIndex = (canaryToday().getUTCDay() + 6) % 7;
  const attendance = data?.capabilities.attendance === true;
  const todaySessions = data?.sessions.filter((session) => canaryDateKey(new Date(session.startsAt)) === canaryDateKey(new Date())) ?? [];
  const viewingCurrentWeek = dateKey(week) === dateKey(weekMonday(canaryToday()));
  const todayScheduledSessions = todaySessions.filter((session) => session.status === 'scheduled');
  const todayOccupied = todayScheduledSessions.reduce((sum, session) => sum + session.occupiedCount, 0);
  const todayAvailable = todayScheduledSessions.reduce((sum, session) => sum + Math.max(0, session.capacity - session.occupiedCount), 0);
  const todayWaitlist = todayScheduledSessions.reduce((sum, session) => sum + session.waitlistCount, 0);
  const clientPicker = (inputId: string, label: string) => {
    const listId = `${inputId}-options`;
    return <>
      <label htmlFor={inputId}>{label}</label><input id={inputId} role="combobox" aria-autocomplete="list" aria-expanded={clientOptions.length > 0} aria-controls={listId} aria-activedescendant={clientOptions.length ? `${listId}-${clientActiveIndex}` : undefined} aria-describedby={`${inputId}-help`} value={clientQuery} onKeyDown={onClientPickerKeyDown} onChange={(event) => { setClientQuery(event.target.value); setClientId(''); }} placeholder="Escribe al menos 2 caracteres" autoComplete="off"/><small id={`${inputId}-help`}>Busca y elige un cliente de la lista.</small>
      {clientBusy && <small role="status">Buscando clientes…</small>}
      {clientSearchError && <small className="field-error" role="alert">{clientSearchError}</small>}
      {clientOptions.length > 0 && <ul id={listId} className="client-picker" role="listbox" aria-label="Resultados de clientes">{clientOptions.map((client, index) => <li id={`${listId}-${index}`} key={client.id} role="option" aria-selected={index === clientActiveIndex} className={index === clientActiveIndex ? 'selected' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => selectClient(client)}>{client.firstName} {client.lastName}</li>)}</ul>}
    </>;
  };
  const renderSessionCard = (session:Session) => {
    const full = session.capacity > 0 && session.occupiedCount >= session.capacity;
    const fill = session.capacity > 0 ? Math.min(100, Math.round((session.occupiedCount / session.capacity) * 100)) : 0;
    return <button key={session.id} data-service-color={serviceColorIndex(session.serviceId)} className={`session-card ${session.status} ${session.overbookCount > 0 ? 'overbooked' : ''} ${full && session.status === 'scheduled' ? 'is-full' : ''}`} onClick={(event) => { const group=event.currentTarget.closest('.overlap-group');if(group){const disclosure=group.querySelector('details');if(disclosure)disclosure.open=false;}openSession(session, event.currentTarget); }} aria-label={`${spanishTime.format(new Date(session.startsAt))}, ${session.serviceName}${session.isIndividual ? ', cita individual' : ''}, ${session.occupiedCount} de ${session.capacity} plazas ocupadas${session.overbookCount > 0 ? `, sobrecupo ${session.overbookCount}` : ''}${session.status === 'cancelled' ? ', cancelada' : ''}`}><span className="session-time">{spanishTime.format(new Date(session.startsAt))}</span><strong>{session.serviceName}</strong><span className="seat-count"><strong>{session.occupiedCount}/{session.capacity}</strong>{full && session.status === 'scheduled' && <span className="session-full">Lleno</span>}</span>{viewMode === 'day' && session.professionalName && <small className="session-pro">{session.professionalName}</small>}<span className="session-fill" aria-hidden="true"><span style={{ width: `${fill}%` }} /></span></button>;
  };
  const renderDayColumn = (day:Date,index:number) => {
    const overlapGroups = groupSessionsByOverlap(visibleSessionsFor(day));
    const visibleLimit = viewMode === 'day' && !isNarrow ? 4 : 2;
    const overflowGroups = overlapGroups.map((group) => group.slice(visibleLimit)).filter((group) => group.length > 0);
    const overflowCount = overflowGroups.reduce((count, group) => count + group.length, 0);
    return <section key={dateKey(day)} className={`day-column ${selectedDay === index ? 'day-selected' : ''}`} aria-label={`${dayNames[index]} ${dayMonthDate.format(day)}`}>
      <header><div><span>{dayNames[index]}</span><strong>{new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', day: 'numeric' }).format(day)}</strong></div><small>{visibleSessionsFor(day).length}</small></header>
      <div className="day-sessions">{overlapGroups.map((group, groupIndex) => {
        const shown = group.slice(0, visibleLimit);
        return <div key={`${dateKey(day)}-${groupIndex}`} className="overlap-group" aria-label={group.length > 1 ? `${group.length} sesiones simultáneas` : undefined} style={{ gridRow: calendarGridRow(group), gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}>{shown.map(renderSessionCard)}</div>;
      })}{visibleSessionsFor(day).length === 0 && <p className="day-empty">{hasActiveCalendarFilters ? 'Sin sesiones para este filtro' : 'Sin sesiones'}</p>}</div>
      {overflowCount > 0 && <details className="calendar-overflow"><summary>Ver {overflowCount} {overflowCount === 1 ? 'sesión simultánea adicional' : 'sesiones simultáneas adicionales'}</summary><div className="calendar-overflow-list" role="group" aria-label="Más sesiones simultáneas">{overflowGroups.flat().map((session) => <button type="button" key={session.id} onClick={(event) => openSession(session, event.currentTarget)}><time>{spanishTime.format(new Date(session.startsAt))}</time><strong>{session.serviceName}</strong><span>{session.occupiedCount}/{session.capacity}</span></button>)}</div></details>}
    </section>;
  };
  return <div className="agenda-root" data-2j-design="v2"><main className="agenda-v2" id="calendar">
      <PageHeader title="Agenda" description="Sesiones, espacios, plazas y lista de espera en hora local de Canarias." actions={manage ? <>
        <Button onClick={openScheduleEditor}>Configurar horarios</Button>
        <Button onClick={(event) => { openerRef.current = event.currentTarget; setDialog('template'); setActionError(''); setSelectedSession(null); }}>Nueva plantilla</Button>
        <Button variant="primary" icon={icons.Plus} data-calendar-initial-focus onClick={(event) => { openerRef.current = event.currentTarget; setDialog('session'); setCreateAvailabilityWarnings(null); setCreateAvailabilityReason(''); setActionError(''); setSelectedSession(null); setClientId(''); setClientQuery(''); }}>Nueva sesión</Button>
      </> : undefined} />
      {viewingCurrentWeek && <Card as="section" className="today-summary" aria-label="Operativa de hoy">
        <div className="today-operational-heading"><h2>{new Intl.DateTimeFormat('es-ES',{timeZone:'Atlantic/Canary',weekday:'long',day:'numeric',month:'long'}).format(new Date(`${canaryDateKey(new Date())}T12:00:00Z`))}</h2><Button variant="ghost" size="sm" onClick={() => setSelectedDay(todayIndex)}>Ver hoy en la semana</Button></div>
        {todayScheduledSessions.length === 0 ? <p className="today-operational-empty">Hoy no hay sesiones programadas.</p> : <dl className="today-operational-metrics"><div><dt>Sesiones</dt><dd>{todayScheduledSessions.length}</dd></div><div><dt>Plazas ocupadas</dt><dd>{todayOccupied}</dd></div><div><dt>Plazas libres</dt><dd>{todayAvailable}</dd></div><div><dt>En espera</dt><dd>{todayWaitlist}</dd></div></dl>}
       </Card>}
       <Card as="section" padding="none" className="calendar-panel" aria-label="Calendario semanal" aria-busy={state === 'loading'}>
         <div className="calendar-toolbar"><h2>{viewMode==='day'?`${dayNames[selectedDay]} ${dayMonthDate.format(currentDay)}`:weekLabel}</h2><div className="calendar-toolbar-actions"><SegmentedControl label="Vista de agenda" value={viewMode} onChange={setViewMode} options={[{ value: 'day', label: 'Día' }, { value: 'week', label: 'Semana', disabled: isNarrow, ...(isNarrow ? { title: 'La semana completa se mantiene como selector de días en esta pantalla.' } : {}) }]} /><div className="week-controls"><IconButton icon={icons.ChevronLeft} label="Semana anterior" onClick={() => setWeek((value) => addDays(value, -7))} /><Button className="today-button" onClick={() => { const today = canaryToday(); setWeek(weekMonday(today)); setSelectedDay((today.getUTCDay() + 6) % 7); }}>Hoy</Button><IconButton icon={icons.ChevronRight} label="Semana siguiente" onClick={() => setWeek((value) => addDays(value, 7))} /></div></div></div>
        {state === 'loading' && <div className="calendar-state" role="status"><span className="spinner"/>Cargando calendario…</div>}
        {state === 'error' && <div className="calendar-state error-panel" role="alert"><strong>No se pudo cargar la semana</strong><span>{error}</span><Button onClick={() => setRetry((value) => value + 1)}>Reintentar</Button></div>}
        {state === 'ready' && <>
          <div className="calendar-filter-bar" aria-label="Filtros de agenda">
            <div className="calendar-filter-field"><label htmlFor="calendar-filter">Filtrar sesiones</label><select id="calendar-filter" value={sessionFilter} onChange={event=>setSessionFilter(event.target.value as CalendarFilter)}><option value="all">Todas</option><option value="upcoming">Próximas</option>{data?.currentProfessionalId&&<option value="mine">Mis sesiones</option>}<option value="full">Completas</option><option value="waitlist">Con espera</option><option value="cancelled">Canceladas</option></select></div>
            <div className="calendar-filter-field"><label htmlFor="calendar-service-filter">Servicio</label><select id="calendar-service-filter" value={serviceFilter} onChange={event=>setServiceFilter(event.target.value)}><option value="">Todos los servicios</option>{data?.services?.map(service=><option key={service.id} value={service.id}>{service.name}</option>)}</select></div>
            <div className="calendar-filter-field"><label htmlFor="calendar-professional-filter">Profesional</label><select id="calendar-professional-filter" value={professionalFilter} onChange={event=>setProfessionalFilter(event.target.value)}><option value="">Todos los profesionales</option>{data?.professionals?.map(professional=><option key={professional.id} value={professional.id}>{professional.displayName}</option>)}</select></div>
            {hasActiveCalendarFilters&&<Button className="calendar-filter-reset" onClick={()=>{setSessionFilter('all');setServiceFilter('');setProfessionalFilter('');}}>Limpiar filtros</Button>}
          </div>
          <div className={`week-strip ${viewMode==='day'?'is-visible':''}`} role="tablist" aria-label="Días de la semana">{weekDays.map((day, index) => <button key={dateKey(day)} id={`calendar-day-tab-${index}`} role="tab" tabIndex={selectedDay === index ? 0 : -1} aria-selected={selectedDay === index} aria-label={`${dayNames[index]} ${dayMonthDate.format(day)}${index === todayIndex && dateKey(day) === canaryDateKey(new Date()) ? ', hoy' : ''}`} className={selectedDay === index ? 'selected' : ''} onClick={() => setSelectedDay(index)} onKeyDown={(event) => { const next = event.key === 'ArrowRight' ? (index + 1) % 7 : event.key === 'ArrowLeft' ? (index + 6) % 7 : event.key === 'Home' ? 0 : event.key === 'End' ? 6 : -1; if (next >= 0) { event.preventDefault(); setSelectedDay(next); document.getElementById(`calendar-day-tab-${next}`)?.focus(); } }}><span>{dayNames[index]}</span><strong>{new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', day: 'numeric' }).format(day)}</strong><small>{visibleSessionsFor(day).length}</small></button>)}</div>
          <div className={`week-grid ${viewMode==='day'?'day-view':'week-view'}`} aria-label={viewMode==='day'?`Sesiones de ${dayNames[selectedDay]} ${dayMonthDate.format(currentDay)}`:`Sesiones de la semana ${weekLabel}`}><div className="calendar-time-axis" aria-hidden="true">{Array.from({length:16},(_,index)=><span key={index} style={{gridRow:'span 2'}}>{`${String(index+6).padStart(2,'0')}:00`}</span>)}</div>{weekDays.map(renderDayColumn)}</div>
          {(data?.sessions.length ?? 0) === 0 && <div className="calendar-empty"><strong>Esta semana aún no tiene sesiones</strong><span>Consulta otra semana o configura los primeros horarios del centro.</span>{manage && <button className="button secondary" onClick={openScheduleEditor}>Crear tu primer horario</button>}</div>}
          {manage && (data?.templates.length ?? 0) > 0 && <details className="recurring-templates"><summary>Horarios recurrentes <span>{data?.templates.length}</span><small>Sesiones concretas generadas automáticamente · próximos 90 días.</small></summary><div className="template-week-grid">{['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'].map((dayName,dayIndex)=>{const weekday=(dayIndex+1)%7;const items=(data?.templates??[]).filter(template=>template.weekday===weekday);return <section className="template-day" key={dayName}><h3>{dayName}</h3>{items.length?items.map(template=><article key={template.id} data-service-color={serviceColorIndex(template.serviceId)}><div><strong>{template.serviceName}</strong><span>{String(template.localStartTime).slice(0,5)}–{localTimeEnd(String(template.localStartTime),template.durationMinutes)} · {template.durationMinutes} min · {template.capacity} plazas</span><small>{template.professionalName&&<>Profesional · {template.professionalName} · </>}Desde {template.startsOn}{template.endsOn?<> · Hasta {template.endsOn}</>:' · Sin fecha de fin'}</small></div><button className="text-button danger-text" disabled={busy} onClick={event=>askConfirmation(event,{title:'Archivar plantilla',message:'La plantilla dejará de generar nuevas sesiones. Las sesiones ya creadas conservarán su estado y se resolverán por separado.',confirmLabel:'Archivar plantilla',tone:'danger',action:()=>void mutate('/api/calendar/templates/'+template.id+'/archive','PATCH')})}>Archivar</button></article>):<span className="template-day-empty">Sin horario</span>}</section>})}</div></details>}
        </>}
      </Card>
      {notice && <div className="calendar-notice" role="status">{notice}<button className="text-button" onClick={() => setNotice('')}>Cerrar</button></div>}
    </main>
    {dialog && dialog !== 'bulk-template' && <div className="backdrop"><section ref={modalRef} className="dialog calendar-dialog" role="dialog" aria-modal="true" aria-labelledby="calendar-dialog-title"><button className="icon-button dialog-close" aria-label="Cerrar diálogo" onClick={() => setDialog(null)}>×</button><div className="eyebrow">CALENDARIO</div><h2 id="calendar-dialog-title">{dialog === 'session' ? 'Nueva sesión' : dialogMode === 'bulk-template' ? 'Configurar horarios' : 'Nueva plantilla recurrente'}</h2><p>{dialog === 'session' ? 'La sesión es una fecha concreta y queda separada de cualquier plantilla.' : dialogMode === 'bulk-template' ? 'Crea varias plantillas semanales de una vez. Las próximas sesiones concretas se crearán automáticamente.' : 'La plantilla y cada sesión concreta son independientes. Se crean automáticamente sesiones para los próximos 90 días.'}</p><form onChange={(event) => { if (dialog === 'session' && createAvailabilityWarnings !== null && (event.target as HTMLElement).getAttribute('name') !== 'availabilityReason') { setCreateAvailabilityWarnings(null); setCreateAvailabilityReason(''); } }} onSubmit={(event) => void (dialog === 'session' ? saveSession(event) : saveTemplate(event))}>{<><label>Servicio<select name="serviceId" required defaultValue="" data-calendar-initial-focus><option value="" disabled>Selecciona un servicio</option>{data?.services.map((service) => <option key={service.id} value={service.id}>{service.name} · {data.areas.find((area) => area.id === service.areaId)?.name}</option>)}</select></label><label>Profesional<select name="professionalId" defaultValue=""><option value="">Sin asignar</option>{data?.professionals?.map(person=><option key={person.id} value={person.id}>{person.displayName}</option>)}</select></label>{dialog === 'session' ? <><label>Fecha y hora<input name="startsAt" type="datetime-local" required defaultValue={`${dateKey(currentDay)}T09:00`}/></label><div className="calendar-form-row"><label>Duración (min)<input name="durationMinutes" type="number" min="5" max="480" defaultValue="60" required/></label>{!clientQuery.trim() && !clientId && <label>Capacidad<input name="capacity" type="number" min="1" max="500" defaultValue="12" required/></label>}</div><div className="individual-client-field">{clientPicker('individual-client', 'Cliente individual (opcional)')}{clientId && <small className="field-note">Cita individual · 1 plaza para {clientQuery}</small>}{clientQuery.trim() && !clientId && <small className="field-error" role="alert">Elige un cliente de la lista; la sesión no se convertirá en grupo.</small>}</div>{createAvailabilityWarnings!==null&&<div className="missing-documents availability-exception" role="alert"><strong>Esta sesión queda fuera de la disponibilidad del profesional.</strong><p>{createAvailabilityWarnings.map(warning=>({outside_working_hours:'Fuera del horario habitual',professional_absent:'Ausencia programada',substitution_available:'Hay un sustituto disponible'} as Record<string,string>)[warning]).filter(Boolean).join(' · ')||'Revisa la disponibilidad antes de continuar.'}</p>{data?.capabilities.overrideAvailability?<label>Motivo de la excepción (obligatorio)<textarea name="availabilityReason" value={createAvailabilityReason} minLength={3} maxLength={240} required onChange={event=>setCreateAvailabilityReason(event.target.value)}/><small>Solo se usa para confirmar esta excepción de disponibilidad; queda registrado.</small></label>:<p>Tu perfil no puede confirmar excepciones de disponibilidad. Elige otra hora o pide a un administrador que la cree.</p>}</div>}{missingDocuments.length>0&&<div className="missing-documents" role="alert"><strong>Faltan documentos para completar la reserva:</strong><ul>{missingDocuments.map((item,index)=><li key={`${item.label}-${index}`}>{item.label|| (item.requirementType==='form'?'Formulario requerido':'Consentimiento requerido')}</li>)}</ul>{data?.capabilities.overrideDocuments&&<div className="document-override"><label><input type="checkbox" checked={overrideDocuments} onChange={event=>setOverrideDocuments(event.target.checked)}/> Continuar con excepción</label>{overrideDocuments&&<label>Motivo obligatorio<textarea value={documentOverrideReason} minLength={3} maxLength={240} required onChange={event=>setDocumentOverrideReason(event.target.value)}/></label>}</div>}</div>}</> : <><div className="calendar-form-row"><label>Día<select name="weekday" defaultValue={String((selectedDay + 1) % 7)}>{['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'].map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label><label>Hora<input name="localStartTime" type="time" defaultValue="09:00" required/></label></div><div className="calendar-form-row"><label>Duración (min)<input name="durationMinutes" type="number" min="5" max="480" defaultValue="60" required/></label><label>Capacidad<input name="capacity" type="number" min="1" max="500" defaultValue="12" required/></label></div><div className="calendar-form-row"><label>Desde<input name="startsOn" type="date" defaultValue={dateKey(currentDay)} required/></label><label>Hasta (opcional)<input name="endsOn" type="date"/></label></div></>}</>}{actionError && <div className="form-error" role="alert">{actionError}</div>}<div className="dialog-actions"><button type="button" className="button secondary" onClick={() => setDialog(null)}>Cancelar</button><button className="button primary" disabled={busy || !data?.services.length || (overrideDocuments && documentOverrideReason.trim().length < 3) || (dialog === 'session' && createAvailabilityWarnings !== null && (!data?.capabilities.overrideAvailability || createAvailabilityReason.trim().length < 3))}>{busy ? 'Guardando…' : dialog === 'session' ? (createAvailabilityWarnings !== null ? 'Crear sesión con excepción' : 'Crear sesión') : dialogMode === 'bulk-template' ? 'Crear horarios' : 'Guardar plantilla'}</button></div></form></section></div>}
    {selectedSession && <div className="backdrop"><section ref={modalRef} className="dialog calendar-dialog session-dialog" role="dialog" aria-modal="true" aria-labelledby="session-detail-title"><button className="icon-button dialog-close" data-calendar-initial-focus aria-label="Cerrar detalle" onClick={() => setSelectedSession(null)}>×</button><div className="eyebrow">{selectedSession.isIndividual ? 'CITA INDIVIDUAL' : selectedSession.areaName} · {selectedSession.source === 'template' ? 'Sesión generada' : 'Sesión puntual'}{selectedSession.occurrenceOverridden ? ' · Fecha ajustada' : ''}</div><h2 id="session-detail-title">{selectedSession.serviceName}</h2>{selectedSession.professionalName&&<p>Profesional · {selectedSession.professionalName}</p>}<p>{spanishDate.format(new Date(selectedSession.startsAt))} · {spanishTime.format(new Date(selectedSession.startsAt))} · {selectedSession.durationMinutes} min</p>{sessionFeedback && <div className="inline-feedback" role="status">{sessionFeedback}</div>}{manage && selectedSession.status === 'scheduled' && !editingOccurrence && <button className="button secondary" onClick={() => { setSessionFeedback(''); setEditingOccurrence(true); }}>Editar esta sesión</button>}{editingOccurrence && <form className="occurrence-editor" onSubmit={(event) => void saveOccurrence(event)}><p>Solo cambia esta fecha. La plantilla y las demás sesiones recurrentes permanecerán intactas.</p><label>Fecha y hora<input name="startsAt" type="datetime-local" defaultValue={canaryInputDateTime(selectedSession.startsAt)} required/></label><div className="calendar-form-row"><label>Duración (min)<input name="durationMinutes" type="number" min="5" max="480" defaultValue={selectedSession.durationMinutes} required/></label><label>Capacidad<input name="capacity" type="number" min={Math.max(1, selectedSession.occupiedCount)} max={selectedSession.isIndividual ? 1 : 500} defaultValue={selectedSession.capacity} required/></label></div><label>Profesional<select name="professionalId" defaultValue={selectedSession.professionalId ?? ''}><option value="">Sin asignar</option>{data?.professionals?.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select></label>{occurrenceAvailabilityWarning && <div className="missing-documents" role="alert"><strong>Este cambio queda fuera del horario habitual del profesional.</strong>{data?.capabilities.overrideAvailability ? <><label><input type="checkbox" checked={occurrenceAvailabilityOverride} onChange={(event) => setOccurrenceAvailabilityOverride(event.target.checked)}/> Confirmar excepción para esta sesión</label>{occurrenceAvailabilityOverride && <label>Motivo obligatorio<textarea value={occurrenceAvailabilityReason} minLength={3} maxLength={240} required onChange={(event) => setOccurrenceAvailabilityReason(event.target.value)} placeholder="Explica el motivo de la excepción"/></label>}</> : <p>Tu perfil no puede confirmar esta excepción. Pide ayuda a una persona autorizada.</p>}</div>}<div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => { setEditingOccurrence(false); setOccurrenceAvailabilityWarning(false); setOccurrenceAvailabilityOverride(false); setOccurrenceAvailabilityReason(''); }}>Cancelar</button><button className="button primary" disabled={busy || (occurrenceAvailabilityWarning && (!data?.capabilities.overrideAvailability || !occurrenceAvailabilityOverride || occurrenceAvailabilityReason.trim().length < 3))}>{busy ? 'Guardando…' : 'Guardar solo esta sesión'}</button></div></form>}<div className="session-capacity-summary"><div><strong>{selectedSession.occupiedCount}</strong><span>Ocupadas</span></div><div><strong>{Math.max(0, selectedCapacity)}</strong><span>Disponibles</span></div><div><strong>{selectedSession.waitlistCount}</strong><span>En espera</span></div></div>{selectedSession.overbookCount > 0 && <div className="overbook-banner">Sobrecupo +{selectedSession.overbookCount}</div>}{attendeeError && <div className="form-error" role="alert">{attendeeError}<button className="text-button" onClick={() => openSession(selectedSession, openerRef.current)}>Reintentar</button></div>}{!attendees && !attendeeError && <div className="calendar-inline-state" role="status"><span className="spinner"/>Cargando reservas…</div>}{attendees && <><h3>Reservas</h3>{attendees.reservations.length ? <ul className="attendee-list">{attendees.reservations.map((item) => <li key={item.id}><span><strong>{item.firstName} {item.lastName}</strong><small>{item.status === 'reserved' ? 'Reservado' : item.status === 'attended' ? 'Asistió' : item.status === 'no_show' ? 'No-show' : item.status === 'cancelled_by_center' ? 'Cancelada por el centro' : 'Cancelado'}</small></span>{item.status !== 'cancelled_by_center' && <span className="attendee-actions">{item.status !== 'cancelled' && attendance && selectedSession.status === 'scheduled' && <><button className="text-button" disabled={busy} onClick={() => void mutate(`/api/calendar/reservations/${item.id}/attendance`, 'PATCH', { status: 'attended' })}>Asistió</button><button className="text-button" disabled={busy} onClick={() => void mutate(`/api/calendar/reservations/${item.id}/attendance`, 'PATCH', { status: 'no_show' })}>No-show</button>{['attended','no_show'].includes(item.status) && <button className="text-button" disabled={busy} onClick={() => void mutate(`/api/calendar/reservations/${item.id}/attendance`, 'PATCH', { status: 'reserved' })}>Reabrir reserva</button>}</>}{item.status === 'reserved' && manage && selectedSession.status === 'scheduled' && <button className="text-button danger-text" disabled={busy} onClick={(event) => askConfirmation(event, { title: 'Cancelar reserva', message: `¿Cancelar la reserva de ${item.firstName} ${item.lastName}?`, confirmLabel: 'Cancelar reserva', tone: 'danger', action: () => void mutate(`/api/calendar/reservations/${item.id}/cancel`, 'PATCH') })}>Cancelar</button>}</span>}</li>)}</ul> : <p className="calendar-muted">Aún no hay reservas.</p>}<h3>Lista de espera</h3>{attendees.waitlist.length ? <ul className="attendee-list">{attendees.waitlist.map((item) => <li key={item.id}><span><strong>{item.firstName} {item.lastName}</strong><small>{item.status === 'cancelled_by_center' ? 'Cancelada por el centro' : item.status === 'cancelled' ? 'Retirado' : 'En espera'}</small></span>{item.status === 'waiting' && manage && selectedSession.status === 'scheduled' && <button className="text-button danger-text" disabled={busy} onClick={() => void mutate(`/api/calendar/waitlist/${item.id}/cancel`, 'PATCH')}>Retirar</button>}</li>)}</ul> : <p className="calendar-muted">Sin clientes en espera.</p>}{selectedSession.status === 'scheduled' && manage && !selectedSession.isIndividual && <div className="booking-box"><h3>Añadir cliente</h3>{missingDocuments.length>0&&<div className="missing-documents" role="alert"><strong>Faltan documentos para completar la reserva:</strong><ul>{missingDocuments.map((item,index)=><li key={`${item.label}-${index}`}>{item.label|| (item.requirementType==='form'?'Formulario requerido':'Consentimiento requerido')}</li>)}</ul>{data?.capabilities.overrideDocuments&&<div className="document-override"><label><input type="checkbox" checked={overrideDocuments} onChange={event=>setOverrideDocuments(event.target.checked)}/> Continuar con excepción</label>{overrideDocuments&&<label>Motivo obligatorio<textarea value={documentOverrideReason} minLength={3} maxLength={240} required onChange={event=>setDocumentOverrideReason(event.target.value)} placeholder="Explica por qué se continúa sin completar el requisito"/></label>}</div>}</div>}{clientPicker('booking-client', 'Buscar cliente')}{bookingPreviewBusy && <p className="calendar-muted" role="status">Comprobando derecho, saldo y restricciones…</p>}{bookingPreviewError && <p className="form-error" role="alert">{bookingPreviewError}</p>}{bookingPreview && <div className="booking-eligibility" aria-live="polite"><strong>{bookingPreview.allowed ? 'Puede reservar' : bookingPreview.waitlistAllowed ? 'Puede entrar en lista de espera' : 'Reserva bloqueada'}</strong>{bookingPreview.selectedEntitlement && <p>{bookingPreview.selectedEntitlement.planName}{bookingPreview.selectedEntitlement.availableBalance !== null ? ` · ${bookingPreview.selectedEntitlement.availableBalance} sesiones disponibles` : ''}{bookingPreview.selectedEntitlement.periodUsage.map(item=>` · ${item.used}/${item.limit} ${item.period==='week'?'esta semana':'este mes'}`).join('')}</p>}{bookingPreview.availableAlternatives.length>1 && <label>Derecho que utilizará<select value={entitlementAssignmentId} onChange={event=>setEntitlementAssignmentId(event.target.value)}><option value="">Elige un derecho</option>{bookingPreview.availableAlternatives.map(item=><option key={item.assignmentId} value={item.assignmentId}>{item.planName}{item.availableBalance!==null?` · ${item.availableBalance} sesiones`:''}</option>)}</select></label>}{bookingPreview.blockingReasons.filter(reason=>reason!=='session_full').map(reason=><p key={reason} className="calendar-muted">{humanError(reason)}</p>)}{bookingPreview.blockingReasons.includes('session_full') && <p className="calendar-muted">La sesión está completa.</p>}{bookingPreview.overridePossible.debt && <label><input type="checkbox" checked={overrideDebt} onChange={event=>setOverrideDebt(event.target.checked)}/> Autorizar reserva pese al cargo vencido</label>}{overrideDebt && <label>Motivo de la excepción<textarea value={overrideDebtReason} minLength={3} maxLength={240} onChange={event=>setOverrideDebtReason(event.target.value)}/></label>}</div>}{selectedCapacity > 0 ? <button className="button primary" disabled={!clientId || busy || bookingPreviewBusy || !bookingPreview || !canProceedWithBooking || (bookingPreview.availableAlternatives.length>1&&!entitlementAssignmentId) || (overrideDocuments && documentOverrideReason.trim().length < 3)} onClick={() => clientId && void mutate(`/api/calendar/sessions/${selectedSession.id}/reservations`, 'POST', { clientId, ...(entitlementAssignmentId?{entitlementAssignmentId}:{}), ...(overrideDebt?{overrideDebt:true,overrideReason:overrideDebtReason}:{}), ...(overrideDocuments ? { overrideDocuments: true, documentOverrideReason } : {}) }).then((result) => { if (result) { setClientId(''); setClientQuery(''); setClientOptions([]); } })}>Reservar plaza</button> : <div className="waitlist-actions"><button className="button secondary" disabled={!clientId || busy || bookingPreviewBusy || !bookingPreview?.waitlistAllowed || (bookingPreview.availableAlternatives.length>1&&!entitlementAssignmentId)} onClick={() => clientId && void mutate(`/api/calendar/sessions/${selectedSession.id}/waitlist`, 'POST', { clientId, ...(entitlementAssignmentId?{entitlementAssignmentId}:{}) }).then((result) => { if (result) { setClientId(''); setClientQuery(''); setClientOptions([]); } })}>Añadir a lista de espera</button>{data?.capabilities.overrideCapacity && <button className="button danger" disabled={!clientId || busy || bookingPreviewBusy || !canOverbook || ((bookingPreview?.availableAlternatives.length??0)>1&&!entitlementAssignmentId)} onClick={(event) => clientId && askConfirmation(event, { title: 'Autorizar sobrecupo', message: `La capacidad se superará en una plaza para ${clientQuery}. ¿Quieres continuar?`, confirmLabel: 'Autorizar sobrecupo', tone: 'danger', action: () => void mutate(`/api/calendar/sessions/${selectedSession.id}/reservations`, 'POST', { clientId, overbook: true, ...(entitlementAssignmentId?{entitlementAssignmentId}:{}), ...(overrideDebt?{overrideDebt:true,overrideReason:overrideDebtReason}:{}), ...(overrideDocuments?{overrideDocuments:true,documentOverrideReason}:{}) }).then((result) => { if (result) { setClientId(''); setClientQuery(''); setClientOptions([]); } }) })}>Autorizar sobrecupo</button>}</div>}</div>}{manage && selectedSession.status === 'scheduled' && <button className="text-button danger-text cancel-session" onClick={(event) => askConfirmation(event, { title: 'Cancelar sesión', message: 'Las reservas y entradas de espera activas se cancelarán y su historial se conservará. ¿Quieres cancelar esta sesión?', confirmLabel: 'Cancelar sesión', tone: 'danger', action: () => void mutate(`/api/calendar/sessions/${selectedSession.id}/cancel`, 'PATCH') })}>Cancelar sesión</button>}</>}</section></div>}
    {confirmation && <div className="backdrop confirmation-backdrop"><section ref={confirmationRef} className="dialog confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-message"><div className="eyebrow">CONFIRMACIÓN 2J</div><h2 id="confirmation-title">{confirmation.title}</h2><p id="confirmation-message">{confirmation.message}</p><div className="dialog-actions"><button className="button secondary" disabled={busy} onClick={() => setConfirmation(null)}>Volver</button><button className={`button ${confirmation.tone === 'danger' ? 'danger' : 'primary'}`} disabled={busy} onClick={() => { const action = confirmation.action; setConfirmation(null); action(); }}>{confirmation.confirmLabel}</button></div></section></div>}
  {dialog === 'bulk-template' && <div className="backdrop"><section ref={modalRef} className="dialog calendar-dialog schedule-dialog" role="dialog" aria-modal="true" aria-labelledby="schedule-editor-title"><button className="icon-button dialog-close" aria-label="Cerrar configuración de horarios" onClick={requestCloseSchedule}>×</button><div className="eyebrow">AGENDA</div><h2 id="schedule-editor-title">Configurar horarios</h2>
    <ScheduleEditor templates={data?.templates ?? []} services={data?.services ?? []} areas={data?.areas ?? []} professionals={data?.professionals ?? []} today={dateKey(canaryToday())} busy={busy} error={actionError} onClearError={() => setActionError('')} onCancel={requestCloseSchedule} onDirtyChange={(dirty) => { scheduleDirtyRef.current = dirty; }} onSubmit={createSchedules}
      onArchive={(group: ExistingGroup, opener) => askConfirmation({ currentTarget: opener } as React.MouseEvent<HTMLElement>, { title: 'Archivar horario recurrente', message: group.templates.length > 1 ? `Dejarán de generar sesiones nuevas ${group.templates.length} horarios (${group.weekdays.length} días). Las sesiones concretas ya creadas y su historial se conservan.` : 'Dejará de generar sesiones nuevas. Las sesiones concretas ya creadas y su historial se conservan.', confirmLabel: 'Archivar horario', tone: 'danger', action: () => void archiveTemplates(group.templates) })} />
  </section></div>}</div>;
}
