import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, MouseEvent as ReactMouseEvent, RefObject } from 'react';
import { Button, Card, CardHeader, EmptyState, Icon, IconButton, PageHeader, SearchField, SegmentedControl, StatusChip, Tabs, icons } from '@2j/ui';
import { clearDeepLink, readDeepLink } from './deep-link.js';
import { ClientAvatar, SECTION_LABEL, SECTION_ORDER, chargeChip, clientPlanChip, euros, planStatusChip, reservationChip, reservationRightsLabel, rightLine } from './client-presenters.js';

type Client = { id: string; firstName: string; lastName: string; email?: string | null; phone?: string | null; birthDate?:string|null; status: 'active' | 'archived'; createdAt: string; updatedAt?: string };
type ClientSection = { id: string; label: string; sourceLabel: string; access: 'available' | 'forbidden'; dataState: 'ready' | 'not_connected' };
type ClientEvent = { id: string; eventType: string; actorLabel: string; occurredAt: string };
type ClientReservation = { id: string; status: 'reserved' | 'attended' | 'no_show' | 'cancelled' | 'cancelled_late' | 'cancelled_by_center'; startsAt: string; durationMinutes: number; sessionStatus: 'scheduled' | 'cancelled'; serviceName: string; areaName: string; entitlementName:string|null; rightsUsed:string[]; entitlementMovements:Array<{type:string;quantity:number;occurredAt:string}> };
type ClientWaitlistEntry={id:string;status:string;startsAt:string;sessionStatus:'scheduled'|'cancelled';serviceName:string;areaName:string};
type PlanRight = { id?:string; rightType:string; serviceName:string|null; quantity:number|null; period:string|null; quotaScope:string|null; balance?:number|null };
type ClientPlanAssignment = { id:string; planId:string; planName:string; kind:string; startsOn:string; endsOn:string|null; derivedStatus:'active'|'scheduled'|'paused'|'expired'|'cancelled'|'exhausted'; concept?:string; amountCents?:number; salePriceCents?:number; dueOn?:string; rights:PlanRight[]; modules?:Array<{module:string;accessLevel:string;capabilities:string[]}> };
type AssignablePlan = { id:string; name:string; kind:string; renewalCadence:string|null; periodDays:number|null; basePriceCents:number|null; services:Array<{id:string;name:string;area:string}>; rights:PlanRight[]; modules?:Array<{module:string;accessLevel:string;capabilities:string[]}> };
/** The API serialises PostgreSQL bigint columns as strings ("5000"); money is always compared as integer cents, never as strings or euro floats. */
function toIntegerCents(value: unknown): number | null { if (value === null || value === undefined || value === '') return null; const cents = Number(value); return Number.isSafeInteger(cents) ? cents : null; }
function normalizeAssignablePlan(plan: AssignablePlan): AssignablePlan { return { ...plan, basePriceCents: toIntegerCents(plan.basePriceCents) }; }
function planTypeSummary(plan:AssignablePlan|undefined) { if(!plan)return ''; if(plan.kind==='session_pack')return `Bono de sesiones${plan.periodDays?` · vigencia configurada: ${plan.periodDays} días`:''}`; const cadence=plan.renewalCadence==='weekly'?'semanal':plan.renewalCadence==='monthly'?'mensual':plan.renewalCadence==='custom_period'?'periodo configurado':null; return `Plan recurrente${cadence?` · ${cadence}`:''}`; }
type PlanAction = {assignment:ClientPlanAssignment;action:'pause'|'resume'|'cancel'|'adjust'|'movements';rightId?:string};
type PlanMovementData = {movements:Array<{id:string;rightKey:string;entryType:string;quantity:number;reason:string;occurredAt:string}>;events:Array<{id:string;eventType:string;effectiveOn:string;reason:string|null;createdAt:string}>};
type ClientProfile = { client: Client; capabilities: { manage: boolean; readEntitlements?:boolean;manageCatalogPrice?:boolean; assignPlans?:boolean; collectPayments?:boolean; pauseEntitlements?:boolean;cancelEntitlements?:boolean;adjustEntitlements?:boolean;renewEntitlements?:boolean }; summary: Record<string, { access: 'available' | 'forbidden'; dataState: string; data: unknown }>; sections: ClientSection[]; history: ClientEvent[]; reservations: ClientReservation[]; waitlistEntries?:ClientWaitlistEntry[] };
type ClientList = { items: Client[]; capabilities: { manage: boolean; assignPlans?:boolean }; hasMore: boolean; nextCursor: string | null };
type ClientFormItem = { id:string; formId:string; name:string; category:string; status:string; version:number; dueAt:string|null; assignedAt:string; answers:Record<string,unknown>|null; canReview:boolean; sensitiveReadable:boolean; submittedAt:string|null; reviews:{decision:string;note:string;actorLabel:string;reviewedAt:string}[] };
type ClientConsentItem = { consentId:string; versionId:string; name:string; version:number; title:string; body:string; accepted:boolean; acceptedAt:string|null; canAcceptAssisted:boolean };
type FollowupItem = { id:string; name:string; status:string; dueAt:string|null; assignedAt:string; version:number; answers:Record<string,unknown>|null; submittedAt:string|null };

const apiUrl = import.meta.env?.VITE_API_URL ?? 'http://127.0.0.1:3100';
const statusLabel = { active: 'Activo', archived: 'Archivado' };
const moduleLabels: Record<string, string> = { reservations: 'Reservas', training: 'Entrenamiento', nutrition: 'Nutrición', health: 'Salud', clients: 'Clientes', communication: 'Comunicación' };
const client360Sections = new Set(['summary', 'reservations', 'plans', 'payments', 'documents', 'messages', 'followup', 'history']);

function displayName(client: Client) { return `${client.firstName} ${client.lastName}`; }
function dateLabel(value: string) { return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(new Date(value)); }
function createIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => { const random = Math.random() * 16 | 0; return (char === 'x' ? random : (random & 3 | 8)).toString(16); });
}
function localDateKey() { return new Intl.DateTimeFormat('en-CA',{timeZone:'Atlantic/Canary',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
function plusLocalDays(value:string,days:number){const parts=value.split('-').map(Number);const next=new Date(Date.UTC(parts[0]??1970,(parts[1]??1)-1,(parts[2]??1)+days));return next.toISOString().slice(0,10);}
function euroToCents(value:string) { const normalized=value.trim().replace(',','.'); if(!/^\d+(\.\d{1,2})?$/.test(normalized))return null; const cents=Math.round(Number(normalized)*100); return Number.isSafeInteger(cents)&&cents>0?cents:null; }

export function ClientsPage() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [list, setList] = useState<ClientList>({ items: [], capabilities: { manage: false }, hasMore: false, nextCursor: null });
  const [listState, setListState] = useState<'loading' | 'ready' | 'error' | 'unauthorized'>('loading');
  const [listError, setListError] = useState('');
  const [listBusy, setListBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [profileState, setProfileState] = useState<'idle' | 'loading' | 'ready' | 'error' | 'unauthorized'>('idle');
  const [profileError, setProfileError] = useState('');
  const [profileRetry, setProfileRetry] = useState(0);
  const [documentsData, setDocumentsData] = useState<{forms:ClientFormItem[];consents:ClientConsentItem[]}|null>(null);
  const [followupData, setFollowupData] = useState<FollowupItem[]|null>(null);
  const [operationState, setOperationState] = useState<'loading'|'ready'|'error'>('ready');
  const [operationError, setOperationError] = useState('');
  const [reviewNotes, setReviewNotes] = useState<Record<string,string>>({});
  const [consentConfirmId, setConsentConfirmId] = useState<string|null>(null);
  const [consentTypedName, setConsentTypedName] = useState('');
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [activeSection, setActiveSection] = useState('summary');
  const [showCreate, setShowCreate] = useState(false);
  // Enlaces profundos del Resumen (ver deep-link.ts): se leen una vez y se retiran de la URL.
  const [deepLink] = useState(() => readDeepLink(['new', 'intent'] as const));
  useEffect(() => { clearDeepLink(['new', 'intent']); }, []);
  const [intent, setIntent] = useState<'assign-plan' | 'message' | null>(deepLink.intent === 'assign-plan' || deepLink.intent === 'message' ? deepLink.intent : null);
  const openNewFromLink = useRef(deepLink.new === '1');
  const [showEdit, setShowEdit] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');
  const [showPlanDialog, setShowPlanDialog] = useState(false);
  const [assignablePlans, setAssignablePlans] = useState<AssignablePlan[]>([]);
  const [planCatalogState, setPlanCatalogState] = useState<'idle'|'loading'|'ready'|'error'>('idle');
  const [planSaveBusy, setPlanSaveBusy] = useState(false);
  const [planSaveError, setPlanSaveError] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [planStartsOn, setPlanStartsOn] = useState(localDateKey());
  const [planEndsOn, setPlanEndsOn] = useState('');
  const [planDueOn, setPlanDueOn] = useState(localDateKey());
  const [planPrice, setPlanPrice] = useState('');
  const [planAdjustmentReason,setPlanAdjustmentReason]=useState('');
  const [planOperation,setPlanOperation]=useState<{sourceAssignmentId:string;kind:'renewal'|'change'}|null>(null);
  const [planOperationReason,setPlanOperationReason]=useState('');
  const [planAction,setPlanAction]=useState<PlanAction|null>(null);
  const [planActionReason,setPlanActionReason]=useState('');
  const [planActionQuantity,setPlanActionQuantity]=useState('');
  const [planActionError,setPlanActionError]=useState('');
  const [planActionBusy,setPlanActionBusy]=useState(false);
  const [planMovements,setPlanMovements]=useState<PlanMovementData|null>(null);
  const [collectNow, setCollectNow] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'cash'|'card'|'transfer'|'direct_debit'|'other'>('card');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveFeedback, setArchiveFeedback] = useState('');
  const [archiveError, setArchiveError] = useState('');
  const opener = useRef<HTMLElement | null>(null);
  const archiveOpener = useRef<HTMLElement | null>(null);
  const archiveSucceeded = useRef(false);
  const createNameRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const archiveDialogRef = useRef<HTMLElement>(null);
  const archiveCancelRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  const profilePanelRef = useRef<HTMLDivElement>(null);
  const profileTitleRef = useRef<HTMLHeadingElement>(null);
    const createKeyRef = useRef<string | null>(null);
  const planSaleKeyRef = useRef<string | null>(null);
  const planSalePayloadRef = useRef<string | null>(null);
  const planActionKeyRef=useRef<string|null>(null);
  const planActionPayloadRef=useRef<string|null>(null);
  const listRequest = useRef(0);
  const listHasItems = useRef(false);
  listHasItems.current = list.items.length > 0;
  const savingRef = useRef(saving);
  savingRef.current = saving;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const loadClients = useCallback(async (cursor: string | null, append: boolean) => {
    const requestId = ++listRequest.current;
    if (append) setLoadingMore(true);
    else if (listHasItems.current) setListBusy(true);
    else setListState('loading');
    const params = new URLSearchParams({ status, limit: '50' });
    if (debouncedQuery) params.set('q', debouncedQuery);
    if (cursor) params.set('cursor', cursor);
    try {
      const response = await fetch(`${apiUrl}/api/clients?${params}`);
      const data = await response.json().catch(() => ({}));
      if (requestId !== listRequest.current) return;
      if (response.status === 401) { setListState('unauthorized'); return; }
      if (response.status === 403) throw new Error('Tu perfil no tiene permiso para consultar los datos personales de clientes.');
      if (!response.ok) throw new Error('No se pudo cargar el listado de clientes.');
      const result = data as ClientList;
      setList((previous) => ({ ...result, items: append ? [...previous.items, ...result.items] : result.items }));
      setListState('ready');
      setListError('');
    } catch (error: unknown) {
      if (requestId === listRequest.current) { setListError(error instanceof Error ? error.message : 'No se pudo cargar el listado.'); setListState('error'); }
    } finally {
      if (requestId === listRequest.current) { setListBusy(false); setLoadingMore(false); }
    }
  }, [debouncedQuery, status]);

  useEffect(() => { void loadClients(null, false); }, [loadClients, refreshKey]);

  useEffect(() => {
    const syncRoute=()=>{const params=new URLSearchParams(window.location.hash.split('?')[1]??'');const clientId=params.get('clientId');const section=params.get('tab');if(clientId&&/^[0-9a-f-]{36}$/i.test(clientId))setSelectedId(clientId);else setSelectedId(null);if(section&&['summary','plans','reservations','payments','training','progress','health','documents','messages','followup','history'].includes(section))setActiveSection(section);};
    syncRoute();window.addEventListener('hashchange',syncRoute);return()=>window.removeEventListener('hashchange',syncRoute);
  }, []);

  useEffect(() => {
    let current = true;
    if (!selectedId) { setProfile(null); setProfileState('idle'); return () => { current = false; }; }
    setProfileState('loading');
    setProfileError('');
    void fetch(`${apiUrl}/api/clients/${selectedId}`)
      .then(async (response) => ({ response, data: await response.json().catch(() => ({})) }))
      .then(({ response, data }) => {
        if (!current) return;
        if (response.status === 401) { setProfileState('unauthorized'); return; }
        if (response.status === 403) throw new Error('Tu perfil no tiene permiso para consultar esta ficha.');
        if (!response.ok) throw new Error('No se pudo cargar la ficha del cliente.');
        setProfile(data as ClientProfile);
        setProfileState('ready');
      })
      .catch((error: unknown) => { if (current) { setProfileError(error instanceof Error ? error.message : 'No se pudo cargar la ficha.'); setProfileState('error'); } });
    return () => { current = false; };
  }, [selectedId, profileRetry]);

  useEffect(() => {
    if (!showPlanDialog) return;
    let active=true; setPlanCatalogState('loading'); setPlanSaveError('');
    void fetch(`${apiUrl}/api/plans/assignable`).then(async response=>{if(!response.ok)throw new Error(response.status===403?'Tu perfil no puede asignar cuotas.':'No se pudo cargar el catálogo de planes.');return response.json() as Promise<AssignablePlan[]>;}).then(rawItems=>{const items=rawItems.map(normalizeAssignablePlan);if(active){setAssignablePlans(items);setPlanCatalogState('ready');if(!selectedPlanId&&items[0]){setSelectedPlanId(items[0].id);setPlanPrice(items[0].basePriceCents==null?'':(items[0].basePriceCents/100).toFixed(2));}}}).catch(()=>{if(active)setPlanCatalogState('error');});
    return()=>{active=false;};
  },[showPlanDialog]);

  useEffect(() => {
    if (!selectedId || !['documents','followup'].includes(activeSection)) return;
    let current = true;
    setOperationState('loading'); setOperationError('');
    const requests = activeSection === 'documents'
      ? Promise.all([fetch(`${apiUrl}/api/clients/${selectedId}/forms`),fetch(`${apiUrl}/api/clients/${selectedId}/consents`)]).then(async ([forms,consents]) => { if (!forms.ok || !consents.ok) throw new Error('No se pudieron cargar los documentos del cliente.'); return {forms:await forms.json(),consents:await consents.json()}; })
      : fetch(`${apiUrl}/api/clients/${selectedId}/followup`).then(async response => { if (!response.ok) throw new Error('No se pudo cargar el seguimiento del cliente.'); return {followup:await response.json()}; });
    void requests.then(data=>{if(!current)return;if('forms' in data)setDocumentsData(data as {forms:ClientFormItem[];consents:ClientConsentItem[]});else setFollowupData(data.followup as FollowupItem[]);setOperationState('ready');}).catch((error:unknown)=>{if(current){setOperationError(error instanceof Error?error.message:'No se pudieron cargar los datos.');setOperationState('error');}});
    return ()=>{current=false;};
  },[selectedId,activeSection,refreshKey]);

  async function reviewForm(item:ClientFormItem, decision:'approved'|'rejected') {
    if(!selectedId)return;setDocumentBusy(true);setOperationError('');
    try { const response=await fetch(`${apiUrl}/api/clients/${selectedId}/forms/${item.formId}/review`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({assignmentId:item.id,decision,note:reviewNotes[item.id]??''})});if(!response.ok)throw new Error('No se pudo guardar la revisión.');setReviewNotes(value=>({...value,[item.id]:''}));setRefreshKey(value=>value+1); }
    catch(error){setOperationError(error instanceof Error?error.message:'No se pudo guardar la revisión.');} finally{setDocumentBusy(false);}
  }
  async function acceptConsent(item:ClientConsentItem) {
    if(!selectedId||!consentConfirmed||consentTypedName.trim().length<2)return;setDocumentBusy(true);setOperationError('');
    try {const response=await fetch(`${apiUrl}/api/clients/${selectedId}/consents/${item.versionId}/accept-assisted`,{method:'POST',headers:{'content-type':'application/json','idempotency-key':createIdempotencyKey()},body:JSON.stringify({typedName:consentTypedName.trim(),accepted:true})});if(!response.ok)throw new Error('No se pudo registrar la aceptación asistida.');setConsentConfirmId(null);setConsentConfirmed(false);setConsentTypedName('');setRefreshKey(value=>value+1);setArchiveFeedback('Aceptación registrada por personal del centro.');}
    catch(error){setOperationError(error instanceof Error?error.message:'No se pudo registrar la aceptación.');} finally{setDocumentBusy(false);}
  }

  useEffect(() => {
    if (!showCreate) return;
    createNameRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent | globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !savingRef.current) { setShowCreate(false); setSaveError(''); return; }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]');
      if (!focusable?.length) return;
      const first = focusable.item(0); const last = focusable.item(focusable.length - 1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown as globalThis.EventListener);
    return () => { document.removeEventListener('keydown', onKeyDown as globalThis.EventListener); if (opener.current?.isConnected) opener.current.focus(); };
  }, [showCreate]);

  useEffect(() => {
    if (!showArchiveConfirm) return;
    archiveSucceeded.current = false;
    archiveCancelRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !archiving) { setShowArchiveConfirm(false); setArchiveError(''); return; }
      if (event.key !== 'Tab') return;
      const focusable = archiveDialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])');
      if (!focusable?.length) return;
      const first = focusable.item(0); const last = focusable.item(focusable.length - 1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (archiveSucceeded.current) profileTitleRef.current?.focus();
      else if (archiveOpener.current?.isConnected) archiveOpener.current.focus();
    };
  }, [showArchiveConfirm, archiving]);

  useEffect(() => {
    if (profileState !== 'ready' || !selectedId) return;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo?.({ top: 0 });
      profileTitleRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [profileState, selectedId]);

  const activeSectionData = useMemo(() => profile?.sections?.find((section) => section.id === activeSection) ?? null, [profile, activeSection]);
  const visibleSections = useMemo(() => (profile?.sections ?? []).filter((section) => client360Sections.has(section.id) && section.access === 'available').sort((left, right) => SECTION_ORDER.indexOf(left.id as typeof SECTION_ORDER[number]) - SECTION_ORDER.indexOf(right.id as typeof SECTION_ORDER[number])), [profile]);
  const clientPlans = (profile?.summary.plans?.data as ClientPlanAssignment[] | undefined) ?? [];
  const clientPlanDisplay = [
    { label: 'Activas', items: clientPlans.filter((item) => ['active', 'paused'].includes(item.derivedStatus)) },
    { label: 'Programadas', items: clientPlans.filter((item) => item.derivedStatus === 'scheduled') },
    { label: 'Histórico', items: clientPlans.filter((item) => ['expired', 'cancelled', 'exhausted'].includes(item.derivedStatus)) },
  ].flatMap((group) => group.items.map((item, index) => ({ item, groupLabel: index === 0 ? group.label : null })));
  const activeClientPlan = clientPlans.find((item) => item.derivedStatus === 'active') ?? null;
  const canReadClientFinance = profile?.sections.some((section) => section.id === 'payments' && section.access === 'available') ?? false;
  const nextClientReservation = profile?.reservations?.filter((item) => item.status === 'reserved' && item.sessionStatus === 'scheduled' && new Date(item.startsAt).getTime() >= Date.now()).sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))[0] ?? null;

  useEffect(() => {
    if (profileState !== 'ready' || !profile) return;
    if (visibleSections.some((section) => section.id === activeSection)) return;
    setActiveSection('summary');
    if (window.location.hash.includes('tab=')) window.location.hash = `#clients?clientId=${profile.client.id}`;
  }, [profileState, profile, visibleSections, activeSection]);

  useEffect(() => {
    if (!intent || profileState !== 'ready' || !profile) return;
    if (intent === 'assign-plan') { if (profile.capabilities.assignPlans && profile.client.status === 'active') startPlanSale(); }
    else if (visibleSections.some((section) => section.id === 'messages')) selectSection('messages');
    setIntent(null);
  }, [intent, profileState, profile]);
  useEffect(() => {
    if (!openNewFromLink.current || listState !== 'ready') return;
    openNewFromLink.current = false;
    if (list.capabilities.manage) { opener.current = document.activeElement as HTMLElement | null; createKeyRef.current = createIdempotencyKey(); setShowCreate(true); }
  }, [listState, list.capabilities.manage]);

  async function createClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const addPlanAfterSave = submitter?.value === 'with-plan';
    const form = new FormData(event.currentTarget);
    setSaving(true); setSaveError('');
    createKeyRef.current ??= createIdempotencyKey();
    try {
      const response = await fetch(`${apiUrl}/api/clients`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': createKeyRef.current }, body: JSON.stringify({ firstName: form.get('firstName'), lastName: form.get('lastName'), email: form.get('email'), phone: form.get('phone'), birthDate: form.get('birthDate') || null }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(response.status === 403 ? 'Tu perfil no puede dar de alta clientes.' : result.message ?? 'No se pudo guardar el cliente.');
      createKeyRef.current = null;
      setShowCreate(false); setQuery(''); setDebouncedQuery(''); setStatus('active');
      setSelectedId(result.id); setActiveSection('summary'); setRefreshKey((value) => value + 1);
      if (addPlanAfterSave) startPlanSale();
    } catch (error) { setSaveError(error instanceof Error ? error.message : 'No se pudo guardar el cliente.'); }
    finally { setSaving(false); }
  }

  async function updateClient(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); if(!selectedId||!profile)return; const form=new FormData(event.currentTarget);setEditBusy(true);setEditError('');
    try { const response=await fetch(`${apiUrl}/api/clients/${selectedId}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({firstName:form.get('firstName'),lastName:form.get('lastName'),email:form.get('email'),phone:form.get('phone'),birthDate:form.get('birthDate')||null})});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error==='email_conflict'?'Ya existe un cliente activo con ese email.':'No se pudo actualizar el perfil.');setShowEdit(false);setProfileRetry(value=>value+1);setArchiveFeedback('Datos del cliente actualizados.');setRefreshKey(value=>value+1); }
    catch(error){setEditError(error instanceof Error?error.message:'No se pudo actualizar el perfil.');}finally{setEditBusy(false);}
  }

  async function assignPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;
    const selectedProduct = assignablePlans.find(item => item.id === selectedPlanId);
    if (selectedProduct?.basePriceCents == null && !profile?.capabilities.manageCatalogPrice) { setPlanSaveError('Este plan necesita un precio base configurado por Administración antes de poder venderse.'); return; }
    const amountCents = euroToCents(planPrice);
    if (!amountCents) { setPlanSaveError('Indica un precio válido mayor que cero.'); return; }
    if (collectNow && !profile?.capabilities.collectPayments) { setPlanSaveError('Tu perfil no puede registrar cobros.'); return; }
    const payload = {planId:selectedPlanId,startsOn:planStartsOn,endsOn:planEndsOn||null,dueOn:planDueOn,amountCents,adjustmentReason:planAdjustmentReason.trim()||null,paymentAmountCents:collectNow?amountCents:null,paymentMethod:collectNow?paymentMethod:null,...(planOperation?{sourceAssignmentId:planOperation.sourceAssignmentId,operationKind:planOperation.kind,operationReason:planOperationReason.trim()||null}:{})};
    const product=assignablePlans.find(item=>item.id===selectedPlanId);
    if(product?.basePriceCents!=null&&product.basePriceCents!==amountCents&&!planAdjustmentReason.trim()){setPlanSaveError('Explica el ajuste del precio de venta.');return;}
    const payloadFingerprint = JSON.stringify({clientId:selectedId,payload});
    if (!planSaleKeyRef.current || planSalePayloadRef.current !== payloadFingerprint) {
      planSaleKeyRef.current = createIdempotencyKey();
      planSalePayloadRef.current = payloadFingerprint;
    }
    setPlanSaveBusy(true); setPlanSaveError('');
    try {
      const response = await fetch(`${apiUrl}/api/clients/${selectedId}/plans`, { method:'POST', headers:{'content-type':'application/json','idempotency-key':planSaleKeyRef.current}, body:JSON.stringify(payload) });
      const result = await response.json().catch(()=>({}));
      if (!response.ok) throw new Error(result.error==='price_override_forbidden'?'Tu perfil no puede modificar el precio de catálogo.':result.error==='catalog_price_required'?'Este plan necesita un precio base configurado por Administración antes de poder venderse.':response.status===403?'Tu perfil no tiene permiso para asignar y cobrar esta cuota.':result.error==='cash_session_required'?'Abre la caja antes de registrar un cobro en efectivo.':'No se pudo asignar la cuota.');
      planSaleKeyRef.current = null;
      planSalePayloadRef.current = null;
      setShowPlanDialog(false); setPlanOperation(null);setPlanOperationReason('');setActiveSection('plans'); setRefreshKey(value=>value+1); setProfileRetry(value=>value+1); setArchiveFeedback(collectNow?(planOperation?.kind==='renewal'?'Renovación y cobro registrados.':planOperation?.kind==='change'?'Cambio de plan y cobro registrados.':'Cuota asignada y cobro registrado.'):(planOperation?.kind==='renewal'?'Renovación guardada; el cargo queda pendiente.':planOperation?.kind==='change'?'Cambio de plan guardado; el cargo queda pendiente.':'Cuota asignada; el cargo queda pendiente.'));
    } catch(error) { setPlanSaveError(error instanceof Error?error.message:'No se pudo completar la venta.'); }
    finally { setPlanSaveBusy(false); }
  }

  function startPlanSale(operation?:{assignment:ClientPlanAssignment;kind:'renewal'|'change'}) {
    planSaleKeyRef.current = null;
    planSalePayloadRef.current = null;
    const starts=operation?.kind==='renewal'&&operation.assignment.endsOn?plusLocalDays(operation.assignment.endsOn,1):operation?plusLocalDays(localDateKey(),1):localDateKey();
    setPlanOperation(operation?{sourceAssignmentId:operation.assignment.id,kind:operation.kind}:null);setPlanOperationReason('');setSelectedPlanId(operation?.kind==='renewal'?operation.assignment.planId:''); setPlanStartsOn(starts); setPlanEndsOn(''); setPlanDueOn(starts); setPlanPrice(operation?.kind==='renewal'?((operation.assignment.salePriceCents??operation.assignment.amountCents??0)/100).toFixed(2):'');setPlanAdjustmentReason(''); setCollectNow(false); setPaymentMethod('card'); setPlanSaveError('');
    setShowPlanDialog(true);
  }

  function cancelPlanSale() {
    planSaleKeyRef.current = null;
    planSalePayloadRef.current = null;
    setPlanOperation(null);setPlanOperationReason('');setShowPlanDialog(false);
  }

  async function openPlanAction(assignment:ClientPlanAssignment,action:PlanAction['action'],rightId?:string){
    if(!selectedId)return;setPlanAction({assignment,action,...(rightId?{rightId}:{})});setPlanActionReason('');setPlanActionQuantity('');setPlanActionError('');setPlanMovements(null);planActionKeyRef.current=null;planActionPayloadRef.current=null;
    if(action==='movements')try{const response=await fetch(`${apiUrl}/api/clients/${selectedId}/plans/${assignment.id}/movements`);if(!response.ok)throw new Error();setPlanMovements(await response.json() as PlanMovementData);}catch{setPlanActionError('No se pudo cargar el historial de movimientos.');}
  }
  async function performPlanAction(){
    if(!selectedId||!planAction)return;const requiresReason=planAction.action==='pause'||planAction.action==='cancel'||planAction.action==='adjust';
    if(requiresReason&&planActionReason.trim().length<3){setPlanActionError('Escribe un motivo de al menos 3 caracteres.');return;}
    const body=planAction.action==='adjust'?{rightId:planAction.rightId,quantity:Number(planActionQuantity),reason:planActionReason.trim()}:planAction.action==='pause'||planAction.action==='cancel'?{effectiveOn:localDateKey(),reason:planActionReason.trim()}:{effectiveOn:localDateKey()};
    if(planAction.action==='adjust'&&(!Number.isInteger(Number(planActionQuantity))||Number(planActionQuantity)===0)){setPlanActionError('Indica una cantidad entera distinta de cero.');return;}
    const fingerprint=JSON.stringify({clientId:selectedId,assignmentId:planAction.assignment.id,action:planAction.action,body});if(!planActionKeyRef.current||planActionPayloadRef.current!==fingerprint){planActionKeyRef.current=createIdempotencyKey();planActionPayloadRef.current=fingerprint;}
    setPlanActionBusy(true);setPlanActionError('');
    try{const isAdjustment=planAction.action==='adjust';const response=await fetch(`${apiUrl}/api/clients/${selectedId}/plans/${planAction.assignment.id}/${isAdjustment?'adjustments':planAction.action}`,{method:'POST',headers:{'content-type':'application/json','idempotency-key':planActionKeyRef.current},body:JSON.stringify(body)});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error==='balance_cannot_be_negative'?'El saldo del bono no puede quedar por debajo de cero.':result.error==='assignment_not_paused'?'Esta cuota ya no está en pausa.':result.error==='assignment_not_active'?'Solo se puede pausar una cuota activa.':'No se pudo guardar el cambio. Revisa el permiso y los datos.');setPlanAction(null);setRefreshKey(value=>value+1);setProfileRetry(value=>value+1);setArchiveFeedback(planAction.action==='pause'?'Cuota pausada.':planAction.action==='resume'?'Cuota reanudada.':planAction.action==='cancel'?'Cuota cancelada y conservada en el historial.':'Saldo ajustado y auditado.');}
    catch(error){setPlanActionError(error instanceof Error?error.message:'No se pudo completar la acción.');}finally{setPlanActionBusy(false);}
  }

  async function archiveClient() {
    if (!profile) return;
    setArchiving(true); setArchiveError('');
    try {
      const response = await fetch(`${apiUrl}/api/clients/${profile.client.id}/archive`, { method: 'PATCH' });
      if (!response.ok) throw new Error(response.status === 403 ? 'Tu perfil no puede archivar clientes.' : 'No se pudo archivar el perfil. Inténtalo de nuevo.');
      const archived = await response.json() as Client;
      archiveSucceeded.current = true;
      setProfile((previous) => previous ? { ...previous, client: { ...previous.client, ...archived } } : previous);
      setStatus('archived'); setRefreshKey((value) => value + 1);
      setArchiveFeedback('Perfil archivado. Se conservarán sus datos y su historial.');
      setShowArchiveConfirm(false);
    } catch (error) { setArchiveError(error instanceof Error ? error.message : 'No se pudo archivar el perfil.'); }
    finally { setArchiving(false); }
  }

  /** Tabs are part of the URL so a reload or a shared link returns to the same section. */
  function selectSection(id: string) {
    setActiveSection(id);
    if (selectedId) window.location.hash = id === 'summary' ? `#clients?clientId=${selectedId}` : `#clients?clientId=${selectedId}&tab=${id}`;
  }
  function closeProfile() { setSelectedId(null); setArchiveFeedback(''); window.location.hash = '#clients'; }

  const plansAvailable = profile?.sections.some((section) => section.id === 'plans' && section.access === 'available') ?? false;
  const planChip = plansAvailable ? clientPlanChip(clientPlans) : null;
  const selectedPlan = assignablePlans.find((item) => item.id === selectedPlanId);
  const planPriceCents = euroToCents(planPrice);
  const upcomingReservations = (profile?.reservations ?? []).filter((item) => item.status === 'reserved' && item.sessionStatus === 'scheduled' && new Date(item.startsAt).getTime() >= Date.now()).sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt)).slice(0, 3);
  const openCreate = (event: ReactMouseEvent<HTMLElement>) => { opener.current = event.currentTarget; createKeyRef.current = createIdempotencyKey(); setShowCreate(true); };
  const nextReservationLabel = nextClientReservation ? new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(nextClientReservation.startsAt)) : '';
  const paymentData = canReadClientFinance ? (profile?.summary.payments?.data as { balanceCents?: number; overdueCount?: number; charges?: Array<{ id: string; concept: string; amountCents: number; balanceCents: number; dueOn: string; status: string }>; movements?: Array<{ id: string; concept: string; kind: string; amountCents: number; createdAt: string }> } | null | undefined) : null;
  const sessionsAvailable = activeClientPlan ? activeClientPlan.rights.filter((right) => right.rightType === 'sessions_quota' && right.balance != null) : [];
  const sessionsAvailableTotal = sessionsAvailable.reduce((sum, right) => sum + (right.balance ?? 0), 0);
  const waitingCount = profile?.waitlistEntries?.filter((entry) => entry.status === 'waiting').length ?? 0;
  const unreadMessages = profile?.sections.some((section) => section.id === 'messages' && section.access === 'available') ? Number((profile.summary.messages?.data as { unreadCount?: number } | null)?.unreadCount ?? 0) : 0;
  const overdueCharges = Number(paymentData?.overdueCount ?? 0);
  const archived = profile?.client.status === 'archived';
  const isActiveProfile = profile?.client.status === 'active';
  const money = (cents: number) => euros(cents);
  const facts: Array<{ id: string; label: string; value: string; detail: string }> = [
    ...(nextClientReservation ? [{ id: 'next', label: 'Próxima reserva', value: nextReservationLabel, detail: nextClientReservation.serviceName }] : []),
    ...(sessionsAvailable.length > 0 && activeClientPlan ? [{ id: 'sessions', label: 'Sesiones disponibles', value: String(sessionsAvailableTotal), detail: activeClientPlan.planName }] : []),
    ...(paymentData ? [{ id: 'payment', label: 'Pago', value: Number(paymentData.overdueCount ?? 0) > 0 ? `${Number(paymentData.overdueCount)} ${Number(paymentData.overdueCount) === 1 ? 'vencido' : 'vencidos'}` : Number(paymentData.balanceCents ?? 0) > 0 ? money(Number(paymentData.balanceCents)) : 'Al día', detail: Number(paymentData.balanceCents ?? 0) > 0 ? 'Pendiente de cobro' : 'Sin saldo pendiente' }] : []),
  ];
  const dateTimeLabel = (value: string) => new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

  return <main className="clients-v2" id="clients" data-2j-design="v2">
    {!selectedId && <>
      <PageHeader title="Clientes" description="Busca y abre perfiles del centro. La ficha reúne la información operativa autorizada." actions={list.capabilities.manage ? <Button variant="primary" icon={icons.Plus} onClick={openCreate}>Nuevo cliente</Button> : undefined} />
      {intent && <div className="client-feedback" role="status"><Icon icon={icons.Users} size={20} />{intent === 'assign-plan' ? 'Elige un cliente para asignarle una cuota.' : 'Elige un cliente para escribirle un mensaje.'}<Button size="sm" variant="ghost" onClick={() => setIntent(null)}>Cancelar</Button></div>}
      <Card as="section" padding="none" className="clients-panel" aria-label="Listado de clientes" aria-busy={listBusy || loadingMore}>
        <div className="clients-toolbar">
          <SearchField label="Buscar cliente" placeholder="Nombre, email o teléfono…" value={query} onChange={setQuery} />
          <SegmentedControl label="Filtrar clientes por estado" value={status} onChange={setStatus} options={[{ value: 'active', label: 'Activos' }, { value: 'archived', label: 'Archivados' }]} />
        </div>
        <div className="sr-only" role="status" aria-live="polite">{listState === 'ready' ? `${list.items.length} clientes${list.hasMore ? '. Hay más resultados disponibles.' : ''}` : ''}</div>
        {listState === 'ready' && list.items.length > 0 && <p className="clients-count" aria-label={`${list.items.length}${list.hasMore ? ' o más' : ''} resultados`}>{list.items.length}{list.hasMore ? '+' : ''} {list.items.length === 1 && !list.hasMore ? 'cliente' : 'clientes'}{debouncedQuery ? <> para «{debouncedQuery}»</> : null}{status === 'archived' ? ' archivados' : ''}{listBusy ? <span className="clients-refreshing" role="status"><span className="spinner" /> Actualizando resultados…</span> : null}</p>}
        {listBusy && !(listState === 'ready' && list.items.length > 0) && <div className="clients-refreshing" role="status"><span className="spinner" /> Actualizando resultados…</div>}
        {listState === 'loading' && <EmptyState role="status"><span className="spinner" /> Cargando clientes…</EmptyState>}
        {listState === 'unauthorized' && <EmptyState role="alert" tone="danger" icon={icons.TriangleAlert} title="Acceso no disponible">Tu sesión no permite consultar los datos de clientes.</EmptyState>}
        {listState === 'error' && <EmptyState role="alert" tone="danger" icon={icons.TriangleAlert} title="No se pudo cargar la lista" action={<Button onClick={() => void loadClients(null, false)}>Reintentar</Button>}>{listError}</EmptyState>}
        {(listState === 'ready' || (listState === 'error' && list.items.length > 0)) && list.items.length === 0 && <EmptyState icon={icons.Users} title={debouncedQuery ? 'Sin resultados' : status === 'active' ? 'Aún no hay clientes' : 'No hay clientes archivados'} action={!debouncedQuery && status === 'active' && list.capabilities.manage ? <Button onClick={openCreate}>Crear primer cliente</Button> : undefined}>{debouncedQuery ? 'Prueba con otro nombre, email o teléfono.' : status === 'active' && list.capabilities.manage ? 'Registra un cliente para iniciar su ficha 360.' : 'Los perfiles archivados se conservan aquí.'}</EmptyState>}
        {(listState === 'ready' || (listState === 'error' && list.items.length > 0)) && list.items.length > 0 && <>
          <ul className="client-rows" aria-label="Resultados de clientes">{list.items.map((item) => <li key={item.id}>
            <a className="client-row" href={`#clients?clientId=${item.id}`} aria-label={`${displayName(item)}, ${statusLabel[item.status]}, abrir ficha`} onClick={() => { setSelectedId(item.id); setActiveSection('summary'); setArchiveFeedback(''); }}>
              <ClientAvatar firstName={item.firstName} lastName={item.lastName} />
              <span className="client-row-copy"><strong>{displayName(item)}</strong><small>Cliente desde {dateLabel(item.createdAt)}</small></span>
              {item.status === 'archived' && <StatusChip tone="neutral">Archivado</StatusChip>}
              <Icon icon={icons.ChevronRight} size={16} className="client-row-arrow" />
            </a>
          </li>)}</ul>
          {list.hasMore && <div className="clients-more"><Button disabled={loadingMore || listBusy} loading={loadingMore} onClick={() => list.nextCursor && void loadClients(list.nextCursor, true)}>{loadingMore ? 'Cargando…' : 'Cargar más clientes'}</Button><span>Mostrando {list.items.length} clientes</span></div>}
        </>}
      </Card>
    </>}

    {selectedId && <div className="client-360" ref={profilePanelRef} aria-label="Ficha 360 del cliente">
      <div className="client-360-back"><Button variant="ghost" size="sm" icon={icons.ArrowLeft} onClick={closeProfile}>Todos los clientes</Button></div>
      {profileState === 'idle' && <Card><EmptyState icon={icons.UserRound} title="Elige un cliente">Su resumen e historial aparecerán aquí.</EmptyState></Card>}
      {profileState === 'loading' && <Card><EmptyState role="status"><span className="spinner" /> Cargando ficha…</EmptyState></Card>}
      {profileState === 'unauthorized' && <Card><EmptyState role="alert" tone="danger" icon={icons.TriangleAlert} title="Acceso no disponible">Tu sesión no tiene autorización para consultar esta ficha.</EmptyState></Card>}
      {profileState === 'error' && <Card><EmptyState role="alert" tone="danger" icon={icons.TriangleAlert} title="No se pudo cargar la ficha" action={<Button onClick={() => setProfileRetry((value) => value + 1)}>Reintentar ficha</Button>}>{profileError}</EmptyState></Card>}
      {profileState === 'ready' && profile && <>
        <Card as="header" className="client-header">
          <ClientAvatar firstName={profile.client.firstName} lastName={profile.client.lastName} size="lg" />
          <div className="client-header-main">
            <h1 ref={profileTitleRef} tabIndex={-1} className="client-name">{displayName(profile.client)}</h1>
            <p className="client-since">Cliente desde {dateLabel(profile.client.createdAt)}</p>
            <div className="client-header-chips">{planChip}{archived && <StatusChip tone="neutral">Archivado</StatusChip>}</div>
          </div>
          <div className="client-header-actions">
            {profile.capabilities.assignPlans && isActiveProfile && <Button variant="primary" icon={icons.Plus} onClick={() => startPlanSale()}>Añadir cuota</Button>}
            {profile.capabilities.manage && <Button icon={icons.Pencil} onClick={() => { setEditError(''); setShowEdit(true); }}>Editar datos</Button>}
            {profile.capabilities.manage && isActiveProfile && <Button variant="danger" icon={icons.Archive} onClick={(event) => { archiveOpener.current = event.currentTarget; setArchiveError(''); setShowArchiveConfirm(true); }}>Archivar</Button>}
          </div>
        </Card>
        {facts.length > 0 && <ul className="client-facts" aria-label="Resumen del cliente">{facts.map((fact) => <li key={fact.id}><Card padding="none" className="client-fact"><span className="client-fact-label">{fact.label}</span><strong className="client-fact-value">{fact.value}</strong><span className="client-fact-detail">{fact.detail}</span></Card></li>)}</ul>}
        {archiveFeedback && <div className="client-feedback" role="status"><Icon icon={icons.CircleCheck} size={20} />{archiveFeedback}</div>}
        <Tabs label="Secciones del cliente" items={visibleSections.map((section) => ({ id: section.id, label: SECTION_LABEL[section.id] ?? section.label }))} value={activeSection} onChange={selectSection} panelId="client-section-panel" idPrefix="client-tab" />
        <section className="client-panel" id="client-section-panel" role="tabpanel" aria-labelledby={`client-tab-${activeSection}`} tabIndex={0}>
          {activeSectionData?.access === 'forbidden' && <Card><EmptyState role="status" icon={icons.ShieldCheck} title="Esta sección requiere otro permiso">Solo mostraremos sus datos cuando tu perfil tenga autorización para este módulo.</EmptyState></Card>}

          {activeSection === 'summary' && activeSectionData?.access === 'available' && <div className="client-summary">
            <h2 className="sr-only">Contexto del cliente</h2>
            <div className="client-summary-grid">
              <Card as="section" aria-labelledby="client-next-title"><CardHeader title="Próximas reservas" titleId="client-next-title" level={3} actions={<Button variant="ghost" size="sm" onClick={() => selectSection('reservations')}>Ver reservas</Button>} />
                {upcomingReservations.length > 0 ? <ul className="client-mini-list">{upcomingReservations.map((reservation) => <li key={reservation.id}><strong>{reservation.serviceName}</strong><span>{dateTimeLabel(reservation.startsAt)} · {reservation.areaName}</span></li>)}</ul> : <p className="client-muted">No hay reservas próximas.</p>}
              </Card>
              <Card as="section" aria-label="Cuota activa"><CardHeader title="Plan actual" level={3} actions={activeClientPlan ? <Button variant="ghost" size="sm" onClick={() => selectSection('plans')}>Ver cuota</Button> : undefined} />
                {activeClientPlan ? <div className="client-summary-body"><strong>{activeClientPlan.planName}</strong><span>{activeClientPlan.endsOn ? `Vigente hasta ${dateLabel(`${activeClientPlan.endsOn}T12:00:00`)}` : 'Sin fecha de fin'}</span>{sessionsAvailable.length > 0 && <span>{sessionsAvailableTotal} sesiones disponibles</span>}</div> : <div className="client-summary-body"><strong>Este cliente aún no tiene una cuota activa</strong>{profile.capabilities.assignPlans && isActiveProfile && <span>Usa «Añadir cuota» para asignar un plan.</span>}</div>}
              </Card>
              {(waitingCount > 0 || unreadMessages > 0 || overdueCharges > 0) && <Card as="section" aria-labelledby="client-attention-title"><CardHeader title="Requiere atención" titleId="client-attention-title" level={3} />
                <ul className="client-attention-list">
                  {overdueCharges > 0 && <li><StatusChip tone="danger">Vencido</StatusChip><span>{overdueCharges} {overdueCharges === 1 ? 'cargo vencido' : 'cargos vencidos'}</span><Button variant="ghost" size="sm" onClick={() => selectSection('payments')}>Ver pagos</Button></li>}
                  {waitingCount > 0 && <li><StatusChip tone="info">Lista de espera</StatusChip><span>En lista de espera · {waitingCount}</span><Button variant="ghost" size="sm" onClick={() => selectSection('reservations')}>Ver reservas</Button></li>}
                  {unreadMessages > 0 && <li><StatusChip tone="info">Mensajes</StatusChip><span>{unreadMessages} {unreadMessages === 1 ? 'mensaje sin leer' : 'mensajes sin leer'}</span><Button variant="ghost" size="sm" onClick={() => selectSection('messages')}>Ver mensajes</Button></li>}
                </ul>
              </Card>}
              {profile.history.length > 0 && <Card as="section" aria-labelledby="client-recent-title"><CardHeader title="Actividad reciente" titleId="client-recent-title" level={3} actions={visibleSections.some((section) => section.id === 'history') ? <Button variant="ghost" size="sm" onClick={() => selectSection('history')}>Ver historial</Button> : undefined} />
                <ul className="client-mini-list">{profile.history.slice(0, 3).map((event) => <li key={event.id}><strong>{{ 'client.created': 'Cliente dado de alta', 'client.archived': 'Cliente archivado', 'client.profile_updated': 'Datos del perfil actualizados' }[event.eventType] ?? 'Actividad del cliente'}</strong><span>{dateLabel(event.occurredAt)} · {event.actorLabel || 'Equipo 2J'}</span></li>)}</ul>
              </Card>}
            </div>
          </div>}

          {activeSection === 'history' && activeSectionData?.access === 'available' && <Card as="section" aria-labelledby="client-history-title"><CardHeader title="Historial del cliente" titleId="client-history-title" level={2} description="Registro del perfil" />
            {profile.history.length ? <ol className="client-timeline">{profile.history.map((event) => <li key={event.id}><span className="client-timeline-dot" aria-hidden="true" /><div><strong>{{ 'client.created': 'Cliente dado de alta', 'client.archived': 'Cliente archivado', 'client.profile_updated': 'Datos del perfil actualizados' }[event.eventType] ?? 'Actividad del cliente'}</strong><span>{dateLabel(event.occurredAt)} · {event.actorLabel || 'Equipo 2J'}</span></div></li>)}</ol> : <EmptyState icon={icons.History} title="Aún no hay actividad">Los cambios del perfil quedarán registrados aquí.</EmptyState>}
          </Card>}

          {activeSection === 'reservations' && activeSectionData?.access === 'available' && <div className="client-stack">
            <Card as="section" aria-labelledby="client-res-title"><CardHeader title="Reservas del cliente" titleId="client-res-title" level={2} description="Mismo perfil · ID de cliente" />
              {profile.reservations?.length ? <ul className="client-list">{profile.reservations.map((reservation) => <li key={reservation.id} className="client-list-row">
                <div className="client-list-main"><strong>{reservation.serviceName}</strong><span>{dateTimeLabel(reservation.startsAt)} · {reservation.areaName}{reservation.sessionStatus === 'cancelled' ? ' · Sesión cancelada' : ''}</span>
                  {(reservation.entitlementName || reservation.rightsUsed?.length || reservation.entitlementMovements?.length) ? <small>{reservation.entitlementName ? `Plan: ${reservation.entitlementName}` : ''}{reservation.rightsUsed?.length ? `${reservation.entitlementName ? ' · ' : ''}${reservationRightsLabel(reservation.rightsUsed)}` : ''}{reservation.entitlementMovements?.map((movement) => ` · ${movement.type === 'consume' ? 'Sesión consumida' : 'Sesión restaurada'} (${movement.quantity > 0 ? '+' : ''}${movement.quantity})`).join('')}</small> : null}</div>
                {reservationChip(reservation.status)}
              </li>)}</ul> : <EmptyState icon={icons.CalendarDays} title="Sin reservas todavía">Las próximas reservas del cliente aparecerán aquí.</EmptyState>}
            </Card>
            {(profile.waitlistEntries?.length ?? 0) > 0 && <Card as="section" aria-labelledby="client-wait-title"><CardHeader title="Lista de espera" titleId="client-wait-title" level={2} />
              <ul className="client-list">{profile.waitlistEntries!.map((entry) => <li key={entry.id} className="client-list-row"><div className="client-list-main"><strong>{entry.serviceName}</strong><span>{dateTimeLabel(entry.startsAt)} · {entry.areaName}</span></div><StatusChip tone={entry.status === 'waiting' ? 'info' : entry.status === 'promoted' ? 'success' : 'neutral'}>{entry.status === 'waiting' ? 'En espera' : entry.status === 'promoted' ? 'Promovido a reserva' : entry.status === 'cancelled_by_center' ? 'Cancelada por el centro' : 'Retirada'}</StatusChip></li>)}</ul>
            </Card>}
          </div>}

          {activeSection === 'plans' && activeSectionData?.access === 'available' && <div className="client-stack">
            {clientPlans.length === 0 ? <Card><EmptyState icon={icons.Ticket} title="Este cliente aún no tiene una cuota activa" action={profile.capabilities.assignPlans && isActiveProfile ? <Button variant="primary" icon={icons.Plus} onClick={() => startPlanSale()}>Añadir cuota</Button> : undefined}>Cuando se asigne un plan, sus sesiones y el cargo asociado aparecerán aquí.</EmptyState></Card> :
              clientPlanDisplay.map(({ item, groupLabel }) => <div key={item.id} className="client-plan-group">
                {groupLabel && <h2 className="client-group-title">{groupLabel}</h2>}
                <Card as="article" className="client-plan" aria-label={item.planName}>
                  <div className="client-plan-head"><div><h3>{item.planName}</h3><p>{item.kind === 'recurring' ? 'Plan recurrente' : 'Bono de sesiones'} · Desde {dateLabel(`${item.startsOn}T12:00:00`)} · {item.endsOn ? `Vigente hasta ${dateLabel(`${item.endsOn}T12:00:00`)}` : 'Sin fecha de fin'}</p></div>
                    <div className="client-plan-side">{planStatusChip(item.derivedStatus)}{canReadClientFinance && item.amountCents != null && <strong>{money(item.amountCents)}</strong>}</div></div>
                  <ul className="client-plan-lines" aria-label="Qué incluye">{item.rights.map((right, index) => <li key={`${item.id}-${index}`}>{rightLine(right)}</li>)}{item.modules?.map((module) => <li key={module.module}>{moduleLabels[module.module] ?? 'Otro módulo'}: {module.accessLevel === 'full' ? 'Completo' : 'Limitado'}</li>)}</ul>
                  {canReadClientFinance && item.dueOn && <a className="ui-link" href="#economics">Ver cargo · vence {item.dueOn}</a>}
                  <div className="client-plan-actions">
                    {item.derivedStatus === 'active' && profile.capabilities.renewEntitlements && <Button size="sm" onClick={() => startPlanSale({ assignment: item, kind: 'renewal' })}>Renovar</Button>}
                    {item.derivedStatus === 'active' && profile.capabilities.assignPlans && <Button size="sm" variant="ghost" onClick={() => startPlanSale({ assignment: item, kind: 'change' })}>Cambiar plan</Button>}
                    {item.derivedStatus === 'active' && profile.capabilities.pauseEntitlements && <Button size="sm" onClick={() => void openPlanAction(item, 'pause')}>Pausar</Button>}
                    {item.derivedStatus === 'paused' && profile.capabilities.pauseEntitlements && <Button size="sm" onClick={() => void openPlanAction(item, 'resume')}>Reanudar</Button>}
                    {item.kind === 'session_pack' && profile.capabilities.adjustEntitlements && item.rights.filter((right) => right.rightType === 'sessions_quota' && right.id).map((right) => <Button key={`adjust-${right.id}`} size="sm" onClick={() => void openPlanAction(item, 'adjust', right.id)}>Ajustar saldo</Button>)}
                    {profile.capabilities.readEntitlements && <Button size="sm" variant="ghost" onClick={() => void openPlanAction(item, 'movements')}>Ver movimientos</Button>}
                    {['active', 'paused', 'scheduled'].includes(item.derivedStatus) && profile.capabilities.cancelEntitlements && <Button size="sm" variant="danger" onClick={() => void openPlanAction(item, 'cancel')}>Cancelar</Button>}
                  </div>
                </Card>
              </div>)}
          </div>}

          {activeSection === 'payments' && activeSectionData?.access === 'available' && <div className="client-stack">
            <ul className="client-facts client-facts--pair" aria-label="Resumen económico">
              <li><Card padding="none" className="client-fact"><span className="client-fact-label">Saldo pendiente</span><strong className="client-fact-value">{money(Number(paymentData?.balanceCents ?? 0))}</strong></Card></li>
              <li><Card padding="none" className="client-fact"><span className="client-fact-label">Cargos vencidos</span><strong className="client-fact-value">{Number(paymentData?.overdueCount ?? 0)}</strong></Card></li>
            </ul>
            <Card as="section" aria-labelledby="client-charges-title"><CardHeader title="Cargos recientes" titleId="client-charges-title" level={2} actions={<Button variant="ghost" size="sm" href="#economics">Abrir Pagos</Button>} />
              {(paymentData?.charges ?? []).length ? <ul className="client-list">{(paymentData?.charges ?? []).map((item) => <li key={item.id} className="client-list-row"><div className="client-list-main"><strong>{item.concept}</strong><span>{item.dueOn}</span></div><div className="client-list-side">{chargeChip(item.status)}<strong>{money(Number(item.balanceCents))}{item.status === 'refunded' ? ' devuelto' : ' pendiente'}</strong></div></li>)}</ul> : <p className="client-muted">No hay cargos recientes.</p>}
            </Card>
            <Card as="section" aria-labelledby="client-moves-title"><CardHeader title="Movimientos recientes" titleId="client-moves-title" level={2} />
              {(paymentData?.movements ?? []).length ? <ul className="client-list">{(paymentData?.movements ?? []).map((item) => <li key={item.id} className="client-list-row"><div className="client-list-main"><strong>{item.kind === 'refund' ? 'Devolución' : 'Pago'} · {item.concept}</strong><span>{new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeZone: 'Atlantic/Canary' }).format(new Date(item.createdAt))}</span></div><strong>{money(Number(item.amountCents))}</strong></li>)}</ul> : <p className="client-muted">No hay movimientos recientes.</p>}
            </Card>
          </div>}

          {activeSection === 'messages' && activeSectionData?.access === 'available' && <Card as="section" aria-labelledby="client-msg-title"><CardHeader title="Conversación del centro" titleId="client-msg-title" level={2} actions={<Button variant="ghost" size="sm" href="#communications">Abrir bandeja</Button>} />
            <dl className="client-dl"><div><dt>Mensajes sin leer</dt><dd>{Number((profile.summary.messages?.data as { unreadCount?: number } | null)?.unreadCount ?? 0)}</dd></div><div><dt>Último mensaje</dt><dd>{(profile.summary.messages?.data as { lastMessageAt?: string | null } | null)?.lastMessageAt ? new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeZone: 'Atlantic/Canary' }).format(new Date((profile.summary.messages?.data as { lastMessageAt: string }).lastMessageAt)) : 'Sin conversación'}</dd></div></dl>
          </Card>}

          {activeSection === 'documents' && activeSectionData?.access === 'available' && <div className="client-stack">
            {operationState === 'loading' && <Card><EmptyState role="status"><span className="spinner" /> Cargando documentos…</EmptyState></Card>}
            {operationState === 'error' && <Card><EmptyState role="alert" tone="danger" icon={icons.TriangleAlert} title="No se pudieron cargar los documentos" action={<Button onClick={() => setRefreshKey((value) => value + 1)}>Reintentar</Button>}>{operationError}</EmptyState></Card>}
            {operationError && operationState === 'ready' && <p className="ui-form-error" role="alert">{operationError}</p>}
            {documentsData && <>
              <Card as="section" aria-labelledby="client-forms-title"><CardHeader title="Formularios" titleId="client-forms-title" level={2} description="Versiones y estados vigentes" />
                {documentsData.forms.length === 0 && <p className="client-muted">No hay formularios asignados.</p>}
                {documentsData.forms.map((item) => <article className="client-document" key={item.id}>
                  <div className="client-document-head"><div><strong>{item.name}</strong><span>Versión {item.version}</span><small>Asignado {dateLabel(item.assignedAt)}{item.dueAt ? ` · Vence ${dateLabel(item.dueAt)}` : ''}</small></div>
                    <StatusChip tone={item.status === 'approved' ? 'success' : item.status === 'rejected' ? 'danger' : item.status === 'review_required' || item.status === 'assigned' ? 'warning' : item.status === 'submitted' ? 'info' : 'neutral'}>{({ assigned: 'Pendiente del cliente', submitted: 'Enviado', review_required: 'Requiere revisión', approved: 'Revisión aprobada', rejected: 'Revisión rechazada', expired: 'Caducado', cancelled: 'Cancelado' } as Record<string, string>)[item.status] ?? item.status}</StatusChip></div>
                  {item.status === 'review_required' && item.canReview && <div className="client-document-review"><label>Nota de revisión<textarea rows={2} value={reviewNotes[item.id] ?? ''} maxLength={1000} onChange={(event) => setReviewNotes((value) => ({ ...value, [item.id]: event.target.value }))} /></label><div className="client-document-actions"><Button disabled={documentBusy} onClick={() => void reviewForm(item, 'approved')}>Aprobar revisión</Button><Button variant="danger" disabled={documentBusy} onClick={() => void reviewForm(item, 'rejected')}>Rechazar revisión</Button></div></div>}
                  {item.status === 'review_required' && !item.canReview && <p className="client-muted">Requiere revisión por personal con permisos específicos.</p>}
                  {item.answers && item.sensitiveReadable && <details><summary>Ver respuestas</summary><pre>{JSON.stringify(item.answers, null, 2)}</pre></details>}
                  {item.reviews?.map((review, index) => <p className="client-muted" key={`${item.id}-review-${index}`}>{review.decision === 'approved' ? 'Revisión aprobada' : 'Revisión rechazada'} · {review.actorLabel} · {dateLabel(review.reviewedAt)}{review.note ? ` · ${review.note}` : ''}</p>)}
                </article>)}
              </Card>
              <Card as="section" aria-labelledby="client-consents-title"><CardHeader title="Consentimientos" titleId="client-consents-title" level={2} />
                {documentsData.consents.length === 0 && <p className="client-muted">No hay consentimientos activos.</p>}
                {documentsData.consents.map((item) => <article className="client-document" key={item.versionId}>
                  <div className="client-document-head"><div><strong>{item.name} · {item.title}</strong><span>Versión {item.version}</span><small>{item.acceptedAt ? `Aceptación ${dateLabel(item.acceptedAt)}` : 'Pendiente de aceptación'}</small></div><StatusChip tone={item.accepted ? 'success' : 'warning'}>{item.accepted ? 'Aceptado' : 'Pendiente'}</StatusChip></div>
                  <details><summary>Ver texto vigente</summary><p>{item.body}</p></details>
                  {item.canAcceptAssisted && !item.accepted && (consentConfirmId === item.versionId
                    ? <div className="client-document-review"><label>Nombre declarado<input value={consentTypedName} onChange={(event) => setConsentTypedName(event.target.value)} /></label><label className="client-check"><input type="checkbox" checked={consentConfirmed} onChange={(event) => setConsentConfirmed(event.target.checked)} /> Confirmo que el cliente ha expresado su aceptación</label><p className="client-muted">Registro asistido por personal del centro; no es una firma electrónica certificada.</p><div className="client-document-actions"><Button variant="primary" disabled={documentBusy || !consentConfirmed || consentTypedName.trim().length < 2} onClick={() => void acceptConsent(item)}>{documentBusy ? 'Registrando…' : 'Registrar aceptación'}</Button></div></div>
                    : <div className="client-document-actions"><Button onClick={() => { setConsentConfirmId(item.versionId); setConsentTypedName(displayName(profile.client)); setConsentConfirmed(false); }}>Registrar consentimiento asistido</Button></div>)}
                </article>)}
              </Card>
            </>}
          </div>}

          {activeSection === 'followup' && activeSectionData?.access === 'available' && <Card as="section" aria-labelledby="client-follow-title"><CardHeader title="Check-ins asignados" titleId="client-follow-title" level={2} description="Historial del módulo" />
            {operationState === 'loading' && <p className="client-muted" role="status">Cargando seguimiento…</p>}
            {operationState === 'error' && <div role="alert" className="ui-form-error">{operationError} <Button size="sm" onClick={() => setRefreshKey((value) => value + 1)}>Reintentar</Button></div>}
            {followupData && followupData.length === 0 && <p className="client-muted">No hay check-ins asignados.</p>}
            {followupData?.map((item) => { const overdue = item.status === 'assigned' && item.dueAt && new Date(item.dueAt) < new Date(); const state = overdue ? 'Vencido' : ({ assigned: 'Pendiente', submitted: 'Enviado', review_required: 'Requiere revisión', approved: 'Completado', rejected: 'Requiere revisión', expired: 'Caducado', cancelled: 'Cancelado' } as Record<string, string>)[item.status] ?? item.status; return <article className="client-document" key={item.id}><div className="client-document-head"><div><strong>{item.name}</strong><span>Versión {item.version}</span><small>Asignado {dateLabel(item.assignedAt)}{item.dueAt ? ` · Vence ${dateLabel(item.dueAt)}` : ''}</small></div><StatusChip tone={overdue ? 'danger' : item.status === 'approved' ? 'success' : item.status === 'cancelled' || item.status === 'expired' ? 'neutral' : item.status === 'submitted' ? 'info' : 'warning'}>{state}</StatusChip></div>{item.answers && <details><summary>Ver respuestas</summary><pre>{JSON.stringify(item.answers, null, 2)}</pre></details>}</article>; })}
            <p className="client-muted">El seguimiento conserva sus respuestas propias y no duplica métricas de entrenamiento o salud.</p>
          </Card>}
        </section>
      </>}
    </div>}

    {planAction && <div className="ui-modal-backdrop"><section className="ui-modal" role="dialog" aria-modal="true" aria-labelledby="plan-action-title"><IconButton className="ui-modal-close" icon={icons.X} label="Cerrar diálogo" disabled={planActionBusy} onClick={() => setPlanAction(null)} />
      <h2 className="ui-modal-title" id="plan-action-title">{planAction.action === 'pause' ? 'Pausar cuota' : planAction.action === 'resume' ? 'Reanudar cuota' : planAction.action === 'cancel' ? 'Cancelar cuota' : planAction.action === 'adjust' ? 'Ajustar saldo' : 'Movimientos de la cuota'}</h2>
      <p className="ui-modal-lead">{planAction.assignment.planName} · La asignación y su historial se conservarán.{planAction.action === 'cancel' ? ' La cuota dejará de estar activa desde hoy y no se podrá reanudar.' : planAction.action === 'pause' ? ' Las reservas nuevas con esta cuota quedarán detenidas hasta reanudarla.' : ''}</p>
      <div className="ui-modal-body">
        {(planAction.action === 'pause' || planAction.action === 'cancel' || planAction.action === 'adjust') && <label>Motivo obligatorio<textarea rows={3} maxLength={240} value={planActionReason} onChange={(event) => setPlanActionReason(event.target.value)} /></label>}
        {planAction.action === 'adjust' && <label>Cantidad a ajustar<input type="number" step="1" value={planActionQuantity} onChange={(event) => setPlanActionQuantity(event.target.value)} placeholder="Ej. 2 o -1" /></label>}
        {planAction.action === 'movements' && <div className="client-ledger">{!planMovements && !planActionError && <div role="status">Cargando movimientos…</div>}{planMovements?.movements.map((row) => <div key={row.id}><strong>{row.quantity > 0 ? '+' : ''}{row.quantity} · {row.entryType === 'grant' ? 'Alta de saldo' : row.entryType === 'adjustment' ? 'Ajuste manual' : row.entryType === 'consume' ? 'Consumo' : 'Restauración'}</strong><span>{row.reason} · {dateLabel(row.occurredAt)}</span></div>)}{planMovements?.events.map((row) => <div key={row.id}><strong>{({ activated: 'Asignada', paused: 'Pausada', resumed: 'Reanudada', cancelled: 'Cancelada', renewed: 'Renovada', changed: 'Cambio programado' } as Record<string, string>)[row.eventType] ?? 'Actualizada'}</strong><span>{row.reason ?? 'Sin motivo adicional'} · Vigente {row.effectiveOn}</span></div>)}{planMovements?.movements.length === 0 && planMovements.events.length === 0 && <p>Aún no hay movimientos.</p>}</div>}
        {planActionError && <div className="ui-form-error" role="alert">{planActionError}</div>}
      </div>
      <div className="ui-modal-actions"><Button disabled={planActionBusy} onClick={() => setPlanAction(null)}>Cerrar</Button>{planAction.action !== 'movements' && <Button variant={planAction.action === 'cancel' ? 'danger-solid' : 'primary'} disabled={planActionBusy || ((planAction.action === 'pause' || planAction.action === 'cancel' || planAction.action === 'adjust') && planActionReason.trim().length < 3) || (planAction.action === 'adjust' && (!planActionQuantity || Number(planActionQuantity) === 0))} onClick={() => void performPlanAction()}>{planActionBusy ? 'Guardando…' : planAction.action === 'pause' ? 'Confirmar pausa' : planAction.action === 'resume' ? 'Reanudar cuota' : planAction.action === 'cancel' ? 'Confirmar cancelación' : 'Guardar ajuste'}</Button>}</div>
    </section></div>}

    {showEdit && profile && <div className="ui-modal-backdrop"><section className="ui-modal" role="dialog" aria-modal="true" aria-labelledby="edit-client-title"><h2 className="ui-modal-title" id="edit-client-title">Editar datos del cliente</h2><p className="ui-modal-lead">Actualiza únicamente los datos básicos del perfil.</p><form onSubmit={(event) => void updateClient(event)}><label>Nombre<input name="firstName" required maxLength={80} defaultValue={profile.client.firstName} /></label><label>Apellidos<input name="lastName" required maxLength={100} defaultValue={profile.client.lastName} /></label><label>Email (opcional)<input name="email" type="email" maxLength={254} defaultValue={profile.client.email ?? ''} /></label><label>Teléfono (opcional)<input name="phone" type="tel" maxLength={40} defaultValue={profile.client.phone ?? ''} /></label><label>Fecha de nacimiento (opcional)<input name="birthDate" type="date" defaultValue={profile.client.birthDate ?? ''} /></label>{editError && <div className="ui-form-error" role="alert">{editError}</div>}<div className="ui-modal-actions"><Button disabled={editBusy} onClick={() => setShowEdit(false)}>Cancelar</Button><Button type="submit" variant="primary" disabled={editBusy}>{editBusy ? 'Guardando…' : 'Guardar cambios'}</Button></div></form></section></div>}

    {showCreate && <div className="ui-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setShowCreate(false); }}><section ref={dialogRef} className="ui-modal" role="dialog" aria-modal="true" aria-labelledby="new-client-title"><IconButton className="ui-modal-close" icon={icons.X} label="Cerrar diálogo" disabled={saving} onClick={() => { setShowCreate(false); setSaveError(''); }} /><h2 className="ui-modal-title" id="new-client-title">Nuevo cliente</h2><p className="ui-modal-lead">Guarda los datos básicos. No se añade información clínica ni de pagos.</p><form onSubmit={(event) => void createClient(event)}><label>Nombre<input ref={createNameRef} name="firstName" required maxLength={80} autoComplete="given-name" /></label><label>Apellidos<input name="lastName" required maxLength={100} autoComplete="family-name" /></label><label>Email (opcional)<input name="email" type="email" maxLength={254} autoComplete="email" /></label><label>Teléfono (opcional)<input name="phone" type="tel" maxLength={40} autoComplete="tel" /></label><label>Fecha de nacimiento (opcional)<input name="birthDate" type="date" /></label>{saveError && <div className="ui-form-error" role="alert">{saveError}</div>}<div className="ui-modal-actions"><Button disabled={saving} onClick={() => setShowCreate(false)}>Cancelar</Button><Button type="submit" value="save" variant={list.capabilities.assignPlans ? 'secondary' : 'primary'} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>{list.capabilities.assignPlans && <Button type="submit" value="with-plan" variant="primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar y añadir cuota'}</Button>}</div></form></section></div>}

    {showPlanDialog && selectedId && <div className="ui-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !planSaveBusy) cancelPlanSale(); }}><section className="ui-modal ui-modal--wide" role="dialog" aria-modal="true" aria-labelledby="assign-plan-title"><IconButton className="ui-modal-close" icon={icons.X} label="Cerrar diálogo" disabled={planSaveBusy} onClick={cancelPlanSale} /><h2 className="ui-modal-title" id="assign-plan-title">{planOperation?.kind === 'renewal' ? 'Renovar cuota' : planOperation?.kind === 'change' ? 'Cambiar plan' : 'Añadir cuota'}</h2><p className="ui-modal-lead">La operación conserva la asignación anterior y crea un cargo nuevo.</p>
      {planOperation?.kind === 'change' && <label className="ui-modal-solo">Motivo del cambio (opcional)<input maxLength={240} value={planOperationReason} onChange={(event) => setPlanOperationReason(event.target.value)} /></label>}
      {planCatalogState === 'loading' && <div role="status">Cargando planes disponibles…</div>}
      {planCatalogState === 'error' && <div className="ui-form-error" role="alert">No se pudo cargar el catálogo. Cierra y vuelve a intentarlo.</div>}
      {planCatalogState === 'ready' && assignablePlans.length === 0 && <EmptyState title="No hay planes activos para asignar">Activa primero un producto desde Servicios.</EmptyState>}
      {planCatalogState === 'ready' && assignablePlans.length > 0 && <form onSubmit={(event) => void assignPlan(event)}>
        <label>Producto o plan<select required value={selectedPlanId} onChange={(event) => { const id = event.target.value; setSelectedPlanId(id); const plan = assignablePlans.find((item) => item.id === id); setPlanPrice(plan?.basePriceCents == null ? '' : (plan.basePriceCents / 100).toFixed(2)); setPlanAdjustmentReason(''); }}><option value="">Selecciona un plan</option>{assignablePlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {plan.kind === 'recurring' ? 'Recurrente' : 'Bono de sesiones'}</option>)}</select></label>
        {selectedPlan && <div className="client-plan-preview"><strong>{selectedPlan.name}</strong><small>{planTypeSummary(selectedPlan)}</small><span>Servicios · {selectedPlan.services.map((service) => service.name).join(' · ')}</span>{selectedPlan.rights.map((right, index) => <small key={index}>{rightLine(right)}</small>)}<small>La vigencia y el vencimiento del cargo se confirman en este formulario.</small></div>}
        <div className="ui-modal-grid"><label>Inicio<input type="date" required value={planStartsOn} onChange={(event) => setPlanStartsOn(event.target.value)} /></label><label>Fin (opcional)<input type="date" value={planEndsOn} min={planStartsOn} onChange={(event) => setPlanEndsOn(event.target.value)} /></label></div>
        {selectedPlan?.kind === 'recurring' && <p className="ui-modal-note" data-testid="legacy-duration-note">La duración definitiva del plan se aplicará con el nuevo modelo de cuotas. Esta asignación usa actualmente el comportamiento legacy.</p>}
        <div className="ui-modal-grid"><label>Precio de venta (€)<input inputMode="decimal" placeholder="0,00" value={planPrice} onChange={(event) => setPlanPrice(event.target.value)} readOnly={!profile?.capabilities.manageCatalogPrice} required /></label>{selectedPlan?.basePriceCents == null && !profile?.capabilities.manageCatalogPrice && <p className="ui-modal-note">Este plan necesita un precio base configurado por Administración antes de poder venderse.</p>}<label>Vencimiento del cargo<input type="date" value={planDueOn} onChange={(event) => setPlanDueOn(event.target.value)} required /></label></div>
        {selectedPlan?.basePriceCents != null && planPriceCents !== null && planPriceCents !== selectedPlan.basePriceCents ? <label>Motivo del ajuste de precio<input required minLength={3} maxLength={240} value={planAdjustmentReason} onChange={(event) => setPlanAdjustmentReason(event.target.value)} /></label> : null}
        {profile?.capabilities.collectPayments && <label><input type="checkbox" checked={collectNow} onChange={(event) => setCollectNow(event.target.checked)} /> Cobrar ahora el importe completo</label>}
        {collectNow && profile?.capabilities.collectPayments && <label>Método de pago<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)}><option value="card">Tarjeta</option><option value="cash">Efectivo · requiere caja abierta</option><option value="transfer">Transferencia</option><option value="direct_debit">Domiciliación</option><option value="other">Otro</option></select></label>}
        <p className="ui-modal-note">El precio se registra en el cargo económico existente; lo que incluye el plan queda fijado en el momento de la venta. No se configura renovación automática ni consumo adicional aquí.</p>
        {planSaveError && <div className="ui-form-error" role="alert">{planSaveError}</div>}
        <div className="ui-modal-actions"><Button disabled={planSaveBusy} onClick={cancelPlanSale}>Cancelar</Button><Button type="submit" variant="primary" disabled={planSaveBusy || !selectedPlanId}>{planSaveBusy ? 'Guardando…' : planOperation?.kind === 'renewal' ? 'Renovar y cobrar' : planOperation?.kind === 'change' ? 'Guardar cambio de plan' : collectNow ? 'Asignar y cobrar' : 'Asignar y dejar pendiente'}</Button></div>
      </form>}
    </section></div>}

    {showArchiveConfirm && <div className="ui-modal-backdrop"><section ref={archiveDialogRef} className="ui-modal" role="alertdialog" aria-modal="true" aria-labelledby="archive-client-title" aria-describedby="archive-client-description"><h2 className="ui-modal-title" id="archive-client-title">¿Archivar este cliente?</h2><p className="ui-modal-lead" id="archive-client-description">El perfil y su historial se conservarán. El cliente dejará de aparecer en la lista de activos.</p>{archiveError && <div className="ui-form-error" role="alert">{archiveError}</div>}<div className="ui-modal-actions"><Button ref={archiveCancelRef} disabled={archiving} onClick={() => setShowArchiveConfirm(false)}>Cancelar</Button><Button variant="danger-solid" disabled={archiving} onClick={() => void archiveClient()}>{archiving ? 'Archivando…' : 'Archivar cliente'}</Button></div></section></div>}
  </main>;
}
