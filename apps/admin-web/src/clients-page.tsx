import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';

type Client = { id: string; firstName: string; lastName: string; email?: string | null; phone?: string | null; birthDate?:string|null; status: 'active' | 'archived'; createdAt: string; updatedAt?: string };
type ClientSection = { id: string; label: string; sourceLabel: string; access: 'available' | 'forbidden'; dataState: 'ready' | 'not_connected' };
type ClientEvent = { id: string; eventType: string; actorLabel: string; occurredAt: string };
type ClientReservation = { id: string; status: 'reserved' | 'attended' | 'no_show' | 'cancelled' | 'cancelled_late' | 'cancelled_by_center'; startsAt: string; durationMinutes: number; sessionStatus: 'scheduled' | 'cancelled'; serviceName: string; areaName: string; entitlementName:string|null; rightsUsed:string[]; entitlementMovements:Array<{type:string;quantity:number;occurredAt:string}> };
type ClientWaitlistEntry={id:string;status:string;startsAt:string;sessionStatus:'scheduled'|'cancelled';serviceName:string;areaName:string};
type PlanRight = { id?:string; rightType:string; serviceName:string|null; quantity:number|null; period:string|null; quotaScope:string|null; balance?:number|null };
type ClientPlanAssignment = { id:string; planId:string; planName:string; kind:string; startsOn:string; endsOn:string|null; derivedStatus:'active'|'scheduled'|'paused'|'expired'|'cancelled'|'exhausted'; concept?:string; amountCents?:number; salePriceCents?:number; dueOn?:string; rights:PlanRight[]; modules?:Array<{module:string;accessLevel:string;capabilities:string[]}> };
type AssignablePlan = { id:string; name:string; kind:string; renewalCadence:string|null; periodDays:number|null; basePriceCents:number|null; services:Array<{id:string;name:string;area:string}>; rights:PlanRight[]; modules?:Array<{module:string;accessLevel:string;capabilities:string[]}> };
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

function ClientIcon({ name }: { name: 'people' | 'search' | 'arrow' | 'close' | 'plus' | 'calendar' | 'chevron' }) {
  const paths = {
    people: <><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.4-3.1 2.2-4.7 5.5-4.7s5.1 1.6 5.5 4.7M16 5.4a3 3 0 0 1 0 5.8m1.6 3.3c1.8.8 2.8 2.2 3 4.5"/></>,
    search: <><circle cx="10.8" cy="10.8" r="6.3"/><path d="m15.4 15.4 4.1 4.1"/></>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>, close: <path d="m6 6 12 12M18 6 6 18"/>, plus: <path d="M12 5v14M5 12h14"/>, calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>, chevron: <path d="m9 18 6-6-6-6"/>,
  };
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

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
  const archiveCancelRef = useRef<HTMLButtonElement>(null);
  const profilePanelRef = useRef<HTMLElement>(null);
  const profileTitleRef = useRef<HTMLHeadingElement>(null);
  const tabsRef = useRef(new Map<string, HTMLButtonElement>());
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
    void fetch(`${apiUrl}/api/plans/assignable`).then(async response=>{if(!response.ok)throw new Error(response.status===403?'Tu perfil no puede asignar cuotas.':'No se pudo cargar el catálogo de planes.');return response.json() as Promise<AssignablePlan[]>;}).then(items=>{if(active){setAssignablePlans(items);setPlanCatalogState('ready');if(!selectedPlanId&&items[0]){setSelectedPlanId(items[0].id);setPlanPrice(items[0].basePriceCents==null?'':(items[0].basePriceCents/100).toFixed(2));}}}).catch(()=>{if(active)setPlanCatalogState('error');});
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
    const compact = window.matchMedia?.('(max-width: 1120px)').matches ?? window.innerWidth <= 1120;
    if (!compact) return;
    const frame = window.requestAnimationFrame(() => {
      profilePanelRef.current?.scrollIntoView?.({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      profileTitleRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [profileState, selectedId]);

  const activeSectionData = useMemo(() => profile?.sections?.find((section) => section.id === activeSection) ?? null, [profile, activeSection]);
  const visibleSections = useMemo(() => (profile?.sections ?? []).filter((section) => client360Sections.has(section.id) && section.access === 'available'), [profile]);
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

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, currentId: string) {
    const sections = visibleSections;
    const index = sections.findIndex((section) => section.id === currentId);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % sections.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + sections.length) % sections.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = sections.length - 1;
    else return;
    event.preventDefault();
    const section = sections[next];
    if (section) { setActiveSection(section.id); tabsRef.current.get(section.id)?.focus(); }
  }

  return <div className="shell clients-experience">
    <aside className="sidebar"><a className="brand" href="#services" aria-label="2J Platform, inicio"><span className="brand-mark">2J</span><span className="brand-copy">FITNESS CENTER<small>OPERACIONES</small></span></a><div className="nav-label">GESTIÓN</div><nav aria-label="Gestión"><a className="nav-item" href="#services">Servicios y planes</a><a className="nav-item active" href="#clients" aria-current="page"><ClientIcon name="people"/> Clientes</a><a className="nav-item" href="#calendar">Calendario</a><a className="nav-item" href="#economics">Pagos</a><a className="nav-item" href="#staff">Equipo</a></nav><div className="sidebar-footer"><span className="status-dot"/> Datos protegidos por permisos</div></aside>
    <main className="main" id="clients"><header className="topbar"><div className="crumb">Gestión <ClientIcon name="arrow"/> Clientes</div><div className="local-pill"><span className="status-dot"/> Entorno local</div></header>
      <section className="page-heading"><div><div className="eyebrow">RELACIÓN CON CLIENTES</div><h1>Clientes</h1><p>Busca y gestiona perfiles del centro. La ficha reúne la información operativa autorizada.</p></div>{list.capabilities.manage && <button className="button primary" onClick={(event) => { opener.current = event.currentTarget; createKeyRef.current = createIdempotencyKey(); setShowCreate(true); }}><ClientIcon name="plus"/> Nuevo cliente</button>}</section>
      <section className={`clients-layout ${selectedId?'has-profile':''}`} aria-label="Gestión de clientes">
        <section className="panel clients-list-panel" aria-label="Listado de clientes" aria-busy={listBusy || loadingMore}><div className="panel-heading"><div><h2>{status === 'active' ? 'Clientes activos' : 'Clientes archivados'}</h2><p>Busca por nombre o datos de contacto. Orden alfabético.</p></div><span className="count" aria-label={`${list.items.length}${list.hasMore ? ' o más' : ''} resultados`}>{listState === 'ready' ? `${list.items.length}${list.hasMore ? '+' : ''}` : '—'}</span></div>
          <div className="toolbar client-toolbar"><label className="search"><ClientIcon name="search"/><span className="sr-only">Buscar cliente</span><input aria-label="Buscar cliente" placeholder="Buscar por nombre" value={query} onChange={(event) => setQuery(event.target.value)}/></label><label className="filter-label"><span>Estado</span><select aria-label="Filtrar clientes por estado" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="active">Activos</option><option value="archived">Archivados</option></select></label></div>
          <div className="sr-only" role="status" aria-live="polite">{listState === 'ready' ? `${list.items.length} clientes${list.hasMore ? '. Hay más resultados disponibles.' : ''}` : ''}</div>
          {listBusy && <div className="list-refresh-status" role="status"><span className="spinner"/> Actualizando resultados…</div>}
          {listState === 'loading' && <div className="state-panel" role="status"><span className="spinner"/><span>Cargando clientes…</span></div>}
          {listState === 'unauthorized' && <div className="state-panel error-panel" role="alert"><strong>Acceso no disponible</strong><span>Tu sesión no permite consultar los datos de clientes.</span></div>}
          {listState === 'error' && <div className="state-panel error-panel" role="alert"><strong>No se pudo cargar la lista</strong><span>{listError}</span><button className="button secondary" onClick={() => void loadClients(null, false)}>Reintentar</button></div>}
          {(listState === 'ready' || (listState === 'error' && list.items.length > 0)) && list.items.length === 0 && <div className="state-panel"><span className="state-icon"><ClientIcon name="people"/></span><strong>{debouncedQuery ? 'Sin resultados' : status === 'active' ? 'Aún no hay clientes' : 'No hay clientes archivados'}</strong><span>{debouncedQuery ? 'Prueba con otro nombre o dato de contacto.' : status === 'active' && list.capabilities.manage ? 'Registra un cliente para iniciar su ficha 360.' : 'Los perfiles archivados se conservan aquí.'}</span>{!debouncedQuery && status === 'active' && list.capabilities.manage && <button className="button secondary" onClick={(event) => { opener.current = event.currentTarget; createKeyRef.current = createIdempotencyKey(); setShowCreate(true); }}>Crear primer cliente</button>}</div>}
          {(listState === 'ready' || (listState === 'error' && list.items.length > 0)) && list.items.length > 0 && <><div className="client-rows" role="list" aria-label="Resultados de clientes">{list.items.map((client) => <div role="listitem" key={client.id}><button className={`client-row ${client.id === selectedId ? 'selected' : ''}`} aria-pressed={client.id === selectedId} aria-label={`${displayName(client)}, ${statusLabel[client.status]}, abrir ficha`} onClick={() => { setSelectedId(client.id); setActiveSection('summary'); setArchiveFeedback(''); window.location.hash=`#clients?clientId=${client.id}`; }}><span className="client-avatar" aria-hidden="true">{client.firstName.slice(0, 1)}{client.lastName.slice(0, 1)}</span><span className="client-row-copy"><strong>{displayName(client)}</strong><span>{dateLabel(client.createdAt)} · {statusLabel[client.status]}</span></span><span className="client-row-action">Abrir ficha</span><ClientIcon name="chevron"/></button></div>)}</div>{list.hasMore && <div className="load-more-row"><button className="button secondary" disabled={loadingMore || listBusy} onClick={() => list.nextCursor && void loadClients(list.nextCursor, true)}>{loadingMore ? 'Cargando…' : 'Cargar más clientes'}</button><span>Mostrando {list.items.length} clientes</span></div>}</>}
        </section>
        <section ref={profilePanelRef} className="panel client-detail-panel" aria-label="Ficha 360 del cliente">{profileState === 'idle' && <div className="detail-state detail-placeholder"><span className="state-icon"><ClientIcon name="people"/></span><strong>Elige un cliente</strong><span>Su resumen e historial aparecerán aquí.</span></div>}
          {profileState === 'loading' && <div className="detail-state" role="status"><span className="spinner"/><span>Cargando ficha…</span></div>}
          {profileState === 'unauthorized' && <div className="detail-state detail-error" role="alert"><strong>Acceso no disponible</strong><span>Tu sesión no tiene autorización para consultar esta ficha.</span></div>}
          {profileState === 'error' && <div className="detail-state detail-error" role="alert"><strong>No se pudo cargar la ficha</strong><span>{profileError}</span><button className="button secondary" onClick={() => setProfileRetry((value) => value + 1)}>Reintentar ficha</button></div>}
          {profileState === 'ready' && profile && <><header className="client-profile-heading"><button type="button" className="text-button client-back" onClick={()=>{setSelectedId(null);window.location.hash='#clients';}}>← Todos los clientes</button><span className="client-avatar large" aria-hidden="true">{profile.client.firstName.slice(0, 1)}{profile.client.lastName.slice(0, 1)}</span><div className="client-profile-title"><div className="eyebrow">CLIENTE 360 · PERFIL OPERATIVO</div><h2 ref={profileTitleRef} tabIndex={-1}>{displayName(profile.client)}</h2><p>Alta {dateLabel(profile.client.createdAt)}</p></div><span className={`badge ${profile.client.status}`}>{statusLabel[profile.client.status]}</span>{profile.capabilities.manage&&<button className="button secondary" onClick={()=>{setEditError('');setShowEdit(true);}}>Editar datos</button>}{profile.capabilities.assignPlans&&profile.client.status==='active'&&<button className="button primary" onClick={() => startPlanSale()}>Añadir cuota</button>}{profile.capabilities.manage && profile.client.status === 'active' && <button className="text-button archive-client" onClick={(event) => { archiveOpener.current = event.currentTarget; setArchiveError(''); setShowArchiveConfirm(true); }}>Archivar</button>}</header>
            {archiveFeedback && <div className="archive-feedback" role="status">{archiveFeedback}</div>}
            <nav className="client-tabs" aria-label="Secciones del cliente" role="tablist" aria-orientation="horizontal">{visibleSections.map((section) => <button key={section.id} ref={(node) => { if (node) tabsRef.current.set(section.id, node); }} type="button" role="tab" id={`client-tab-${section.id}`} aria-selected={activeSection === section.id} aria-controls="client-section-panel" aria-current={activeSection === section.id ? 'page' : undefined} tabIndex={activeSection === section.id ? 0 : -1} className={activeSection === section.id ? 'selected' : ''} onClick={() => setActiveSection(section.id)} onKeyDown={(event) => handleTabKey(event, section.id)}>{section.id === 'plans' ? 'Cuotas' : section.id === 'payments' ? 'Cuotas y pagos' : section.id === 'documents' ? 'Documentos' : section.label}</button>)}</nav>
            <section className="client-section-panel" id="client-section-panel" role="tabpanel" aria-labelledby={`client-tab-${activeSection}`} tabIndex={0}>
              {activeSectionData?.access === 'forbidden' && <div className="detail-state" role="status"><strong>Esta sección requiere otro permiso</strong><span>Solo mostraremos sus datos cuando tu perfil tenga autorización para este módulo.</span></div>}
              {activeSection === 'summary' && activeSectionData?.access === 'available' && <div className="client-summary"><div className="summary-title"><div><div className="eyebrow">RESUMEN OPERATIVO</div><h3>Contexto del cliente</h3></div><span className="source-pill">Datos de 2J Platform</span></div><div className="client-summary-cards"><article><span>Estado del perfil</span><strong>{statusLabel[profile.client.status]}</strong><small>Alta {dateLabel(profile.client.createdAt)}</small></article><article><span>Reservas</span><strong>{profile.reservations?.length ?? 0}</strong><small>Reservas registradas en Platform</small></article>{nextClientReservation&&<article><span>Próxima reserva</span><strong>{nextClientReservation.serviceName}</strong><small>{new Intl.DateTimeFormat('es-ES',{timeZone:'Atlantic/Canary',dateStyle:'medium',timeStyle:'short'}).format(new Date(nextClientReservation.startsAt))}</small></article>}</div><div className="client-active-plan" aria-label="Cuota activa">{activeClientPlan?<><div><span className="eyebrow">CUOTA ACTIVA</span><strong>{activeClientPlan.planName}</strong><span>{activeClientPlan.endsOn?`Vence ${dateLabel(`${activeClientPlan.endsOn}T12:00:00`)}`:'Sin fecha de fin'} · Activa</span></div><div className="client-plan-actions"><button className="text-button" onClick={()=>setActiveSection('plans')}>Ver cuota</button>{profile.capabilities.assignPlans&&<button className="text-button" onClick={() => startPlanSale()}>Añadir otra</button>}</div></>:<><div><span className="eyebrow">CUOTA ACTIVA</span><strong>Este cliente aún no tiene una cuota activa</strong></div>{profile.capabilities.assignPlans&&<button className="button secondary" onClick={() => startPlanSale()}>Añadir cuota</button>}</>}</div>{(profile.waitlistEntries?.some((item)=>item.status==='waiting')||profile.summary.documents?.access==='available')&&<div className="client-summary-links">{profile.waitlistEntries?.some((item)=>item.status==='waiting')&&<button className="text-button" onClick={()=>setActiveSection('reservations')}>En lista de espera · Ver reservas</button>}{profile.summary.documents?.access==='available'&&<button className="text-button" onClick={()=>setActiveSection('documents')}>Ver documentos y revisiones</button>}</div>}</div>}
              {activeSection === 'history' && activeSectionData?.access === 'available' && <div className="client-history"><div className="summary-title"><div><div className="eyebrow">REGISTRO DEL PERFIL</div><h3>Historial del cliente</h3></div></div>{profile.history.length ? <ol>{profile.history.map((event) => <li key={event.id}><span className="history-dot"/><div><strong>{{'client.created':'Cliente dado de alta','client.archived':'Cliente archivado','client.profile_updated':'Datos del perfil actualizados'}[event.eventType] ?? 'Actividad del cliente'}</strong><span>{dateLabel(event.occurredAt)} · {event.actorLabel || 'Equipo 2J'}</span></div></li>)}</ol> : <div className="detail-state"><span className="state-icon"><ClientIcon name="calendar"/></span><strong>Aún no hay actividad</strong><span>Los cambios del perfil quedarán registrados aquí.</span></div>}</div>}
              {activeSection === 'reservations' && activeSectionData?.access === 'available' && <div className="client-history"><div className="summary-title"><div><div className="eyebrow">CALENDARIO</div><h3>Reservas del cliente</h3></div><span className="source-pill">Mismo perfil · ID de cliente</span></div>{profile.reservations?.length ? <ol>{profile.reservations.map((reservation) => <li key={reservation.id}><span className="history-dot"/><div><strong>{reservation.serviceName} · {reservation.status === 'reserved' ? 'Reservado' : reservation.status === 'attended' ? 'Asistió' : reservation.status === 'no_show' ? 'No-show' : reservation.status === 'cancelled_by_center' ? 'Cancelada por el centro' : reservation.status === 'cancelled_late' ? 'Cancelación tardía' : 'Cancelado'}</strong><span>{new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(reservation.startsAt))} · {reservation.areaName}{reservation.sessionStatus === 'cancelled' ? ' · Sesión cancelada' : ''}{reservation.entitlementName ? ` · Derecho: ${reservation.entitlementName}` : ''}{reservation.rightsUsed?.length ? ` · ${reservation.rightsUsed.map((right) => right === 'sessions_quota' ? 'Bono de sesiones' : right === 'period_quota' ? 'Límite periódico' : 'Acceso').join(', ')}` : ''}{reservation.entitlementMovements?.map((movement) => ` · ${movement.type === 'consume' ? 'Sesión consumida' : 'Sesión restaurada'} (${movement.quantity > 0 ? '+' : ''}${movement.quantity})`).join('')}</span></div></li>)}</ol> : <div className="detail-state"><span className="state-icon"><ClientIcon name="calendar"/></span><strong>Sin reservas todavía</strong><span>Las próximas reservas del cliente aparecerán aquí.</span></div>}</div>}
              {activeSection === 'reservations' && activeSectionData?.access === 'available' && (profile.waitlistEntries?.length ?? 0) > 0 && <div className="client-history"><div className="summary-title"><div><div className="eyebrow">CALENDARIO</div><h3>Lista de espera</h3></div></div><ol>{profile.waitlistEntries!.map((entry) => <li key={entry.id}><span className="history-dot"/><div><strong>{entry.serviceName} · {entry.status === 'waiting' ? 'En espera' : entry.status === 'promoted' ? 'Promovido a reserva' : entry.status === 'cancelled_by_center' ? 'Cancelada por el centro' : 'Retirada'}</strong><span>{new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.startsAt))} · {entry.areaName}</span></div></li>)}</ol></div>}
              {activeSection === 'plans' && activeSectionData?.access === 'available' && <div className="client-history"><div className="summary-title"><div><div className="eyebrow">SERVICIOS Y DERECHOS</div><h3>Cuotas del cliente</h3></div>{profile.capabilities.assignPlans&&profile.client.status==='active'&&<button className="button primary" onClick={() => startPlanSale()}>Añadir cuota</button>}</div>{clientPlans.length===0?<div className="detail-state"><strong>Este cliente aún no tiene una cuota activa</strong><span>Cuando se asigne un plan, sus derechos y el cargo asociado aparecerán aquí.</span>{profile.capabilities.assignPlans&&<button className="button secondary" onClick={() => startPlanSale()}>Añadir cuota</button>}</div>:<div className="client-plan-list">{clientPlanDisplay.map(({item,groupLabel})=><article className="client-plan-card" key={item.id}>{groupLabel&&<h4 className="client-plan-group-title">{groupLabel}</h4>}<div><strong>{item.planName}</strong><span>{{active:'Activa',scheduled:'Programada',paused:'En pausa',exhausted:'Bono agotado',expired:'Vencida',cancelled:'Cancelada'}[item.derivedStatus]} · Desde {dateLabel(`${item.startsOn}T12:00:00`)}</span><small>{item.endsOn?`Hasta ${dateLabel(`${item.endsOn}T12:00:00`)}`:'Sin fecha de fin'} · {item.kind==='recurring'?'Plan recurrente':'Bono de sesiones'}</small></div>{canReadClientFinance && item.amountCents != null && <strong>{new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(item.amountCents/100)}</strong>}<div className="client-plan-rights">{item.rights.map((right,index)=><span key={`${item.id}-${index}`}>{right.rightType==='service_access'?`Acceso${right.serviceName?` · ${right.serviceName}`:''}`:right.rightType==='sessions_quota'?`${right.quantity} sesiones${right.serviceName?` · ${right.serviceName}`:''}`:`${right.quantity} ${right.period==='week'?'por semana':right.period==='month'?'por mes':'por periodo'}${right.serviceName?` · ${right.serviceName}`:''}`}{right.balance!=null&&right.rightType==='sessions_quota'?` · ${right.balance} restantes`:''}</span>)}</div>{item.modules?.length ? <div className="client-plan-rights" aria-label="Accesos a módulos">{item.modules.map(module => <span key={module.module}>{moduleLabels[module.module] ?? 'Otro módulo'}: {module.accessLevel === 'full' ? 'Completo' : 'Limitado'}</span>)}</div> : null}{canReadClientFinance && item.dueOn && <a className="text-button" href="#economics">Ver cargo · vence {item.dueOn}</a>}<div className="client-plan-actions">{item.derivedStatus==='active'&&profile.capabilities.pauseEntitlements&&<button className="button secondary" onClick={()=>void openPlanAction(item,'pause')}>Pausar</button>}{item.derivedStatus==='paused'&&profile.capabilities.pauseEntitlements&&<button className="button secondary" onClick={()=>void openPlanAction(item,'resume')}>Reanudar</button>}{['active','paused','scheduled'].includes(item.derivedStatus)&&profile.capabilities.cancelEntitlements&&<button className="button danger" onClick={()=>void openPlanAction(item,'cancel')}>Cancelar</button>}{item.kind==='session_pack'&&profile.capabilities.adjustEntitlements&&item.rights.filter(right=>right.rightType==='sessions_quota'&&right.id).map(right=><button key={`adjust-${right.id}`} className="button secondary" onClick={()=>void openPlanAction(item,'adjust',right.id)}>Ajustar saldo</button>)}{profile.capabilities.readEntitlements&&<button className="text-button" onClick={()=>void openPlanAction(item,'movements')}>Ver movimientos</button>}{item.derivedStatus==='active'&&profile.capabilities.renewEntitlements&&<button className="text-button" onClick={()=>startPlanSale({assignment:item,kind:'renewal'})}>Renovar</button>}{item.derivedStatus==='active'&&profile.capabilities.assignPlans&&<button className="text-button" onClick={()=>startPlanSale({assignment:item,kind:'change'})}>Cambiar plan</button>}</div></article>)}</div>}</div>}              {activeSection === 'payments' && activeSectionData?.access === 'available' && <div className="client-history"><div className="summary-title"><div><div className="eyebrow">PAGOS</div><h3>Resumen económico</h3></div><a className="source-pill" href="#economics">Abrir Pagos</a></div><div className="client-contact-grid"><div><span>Saldo pendiente</span><strong>{new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(Number((profile.summary.payments?.data as {balanceCents?:number}|null)?.balanceCents??0)/100)}</strong></div><div><span>Cargos vencidos</span><strong>{Number((profile.summary.payments?.data as {overdueCount?:number}|null)?.overdueCount??0)}</strong></div></div><h4>Cargos recientes</h4><div className="economic-client-list">{((profile.summary.payments?.data as {charges?:Array<{id:string;concept:string;amountCents:number;balanceCents:number;dueOn:string;status:string}>}|null)?.charges??[]).map(item=><div key={item.id}><span>{item.concept}<small>{item.dueOn} · {{pending:'Pendiente',unpaid:'Vencido',paid:'Pagado',refunded:'Devuelto',exempt:'Exento',void:'Anulado'}[item.status]??item.status}</small></span><strong>{new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(Number(item.balanceCents)/100)}{item.status==='refunded'?' devuelto':' pendiente'}</strong></div>)}</div><h4>Movimientos recientes</h4><div className="economic-client-list">{((profile.summary.payments?.data as {movements?:Array<{id:string;concept:string;kind:string;amountCents:number;createdAt:string}>}|null)?.movements??[]).map(item=><div key={item.id}><span>{item.kind==='refund'?'Devolución':'Pago'} · {item.concept}<small>{new Intl.DateTimeFormat('es-ES',{dateStyle:'medium',timeZone:'Atlantic/Canary'}).format(new Date(item.createdAt))}</small></span><strong>{new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(Number(item.amountCents)/100)}</strong></div>)}</div></div>}
              {activeSection === 'messages' && activeSectionData?.access === 'available' && <div className="client-history"><div className="summary-title"><div><div className="eyebrow">COMUNICACIÓN</div><h3>Conversación del centro</h3></div><a className="source-pill" href="#communications">Abrir bandeja</a></div><div className="client-contact-grid"><div><span>Mensajes sin leer</span><strong>{Number((profile.summary.messages?.data as {unreadCount?:number}|null)?.unreadCount??0)}</strong></div><div><span>Último mensaje</span><strong>{(profile.summary.messages?.data as {lastMessageAt?:string|null}|null)?.lastMessageAt ? new Intl.DateTimeFormat('es-ES',{dateStyle:'medium',timeZone:'Atlantic/Canary'}).format(new Date((profile.summary.messages?.data as {lastMessageAt:string}).lastMessageAt)) : 'Sin conversación'}</strong></div></div><p className="pii-context">Las notas internas se mantienen separadas y visibles solo con permiso específico.</p></div>}
              {activeSection === 'documents' && activeSectionData?.access === 'available' && <div className="client-history"><div className="summary-title"><div><div className="eyebrow">DOCUMENTACIÓN</div><h3>Documentos del cliente</h3></div><span className="source-pill">Versiones y estados vigentes</span></div>{operationState==='loading'&&<div role="status">Cargando documentos…</div>}{operationState==='error'&&<div role="alert">{operationError}<button className="button secondary" onClick={()=>setRefreshKey(value=>value+1)}>Reintentar</button></div>}{operationError&&operationState==='ready'&&<p role="alert">{operationError}</p>}{documentsData&&<><h4>Formularios</h4>{documentsData.forms.length===0&&<p>No hay formularios asignados.</p>}{documentsData.forms.map(item=><article className="client-document-item" key={item.id}><div><strong>{item.name}</strong><span>Versión {item.version} · {{assigned:'Pendiente del cliente',submitted:'Enviado',review_required:'Requiere revisión',approved:'Revisión aprobada',rejected:'Revisión rechazada',expired:'Caducado',cancelled:'Cancelado'}[item.status]??item.status}</span><small>Asignado {dateLabel(item.assignedAt)}{item.dueAt?` · Vence ${dateLabel(item.dueAt)}`:''}</small></div>{item.status==='review_required'&&item.canReview&&<div className="review-actions"><label>Nota de revisión<textarea value={reviewNotes[item.id]??''} maxLength={1000} onChange={event=>setReviewNotes(value=>({...value,[item.id]:event.target.value}))}/></label><button className="button secondary" disabled={documentBusy} onClick={()=>void reviewForm(item,'approved')}>Aprobar revisión</button><button className="button danger" disabled={documentBusy} onClick={()=>void reviewForm(item,'rejected')}>Rechazar revisión</button></div>}{item.status==='review_required'&&!item.canReview&&<p className="pii-context">Requiere revisión por personal con permisos específicos.</p>}{item.answers&&item.sensitiveReadable&&<details><summary>Ver respuestas</summary><pre>{JSON.stringify(item.answers,null,2)}</pre></details>}{item.reviews?.map((review,index)=><p className="pii-context" key={`${item.id}-review-${index}`}>{review.decision==='approved'?'Revisión aprobada':'Revisión rechazada'} · {review.actorLabel} · {dateLabel(review.reviewedAt)}{review.note?` · ${review.note}`:''}</p>)}</article>)}<h4>Consentimientos</h4>{documentsData.consents.length===0&&<p>No hay consentimientos activos.</p>}{documentsData.consents.map(item=><article className="client-document-item" key={item.versionId}><div><strong>{item.name} · {item.title}</strong><span>Versión {item.version} · {item.accepted?'Aceptado':'Pendiente'}</span><small>{item.acceptedAt?`Aceptación ${dateLabel(item.acceptedAt)}`:'Pendiente de aceptación'}</small></div><details><summary>Ver texto vigente</summary><p>{item.body}</p></details>{item.canAcceptAssisted&&!item.accepted&&(consentConfirmId===item.versionId?<div className="review-actions"><label>Nombre declarado<input value={consentTypedName} onChange={event=>setConsentTypedName(event.target.value)} /></label><label><input type="checkbox" checked={consentConfirmed} onChange={event=>setConsentConfirmed(event.target.checked)}/> Confirmo que el cliente ha expresado su aceptación</label><p className="pii-context">Registro asistido por personal del centro; no es una firma electrónica certificada.</p><button className="button primary" disabled={documentBusy||!consentConfirmed||consentTypedName.trim().length<2} onClick={()=>void acceptConsent(item)}>{documentBusy?'Registrando…':'Registrar aceptación'}</button></div>:<button className="button secondary" onClick={()=>{setConsentConfirmId(item.versionId);setConsentTypedName(displayName(profile.client));setConsentConfirmed(false);}}>Registrar consentimiento asistido</button>)}</article>)}</>}</div>}
              {activeSection === 'followup' && activeSectionData?.access === 'available' && <div className="client-history"><div className="summary-title"><div><div className="eyebrow">SEGUIMIENTO</div><h3>Check-ins asignados</h3></div><span className="source-pill">Historial del módulo</span></div>{operationState==='loading'&&<div role="status">Cargando seguimiento…</div>}{operationState==='error'&&<div role="alert">{operationError}<button className="button secondary" onClick={()=>setRefreshKey(value=>value+1)}>Reintentar</button></div>}{followupData&&followupData.length===0&&<p>No hay check-ins asignados.</p>}{followupData?.map(item=>{const state=item.status==='assigned'&&item.dueAt&&new Date(item.dueAt)<new Date()?'Vencido':({assigned:'Pendiente',submitted:'Enviado',review_required:'Requiere revisión',approved:'Completado',rejected:'Requiere revisión',expired:'Caducado',cancelled:'Cancelado'} as Record<string,string>)[item.status]??item.status;return <article className="client-document-item" key={item.id}><div><strong>{item.name}</strong><span>{state} · Versión {item.version}</span><small>Asignado {dateLabel(item.assignedAt)}{item.dueAt?` · Vence ${dateLabel(item.dueAt)}`:''}</small></div>{item.answers&&<details><summary>Ver respuestas</summary><pre>{JSON.stringify(item.answers,null,2)}</pre></details>}</article>})}<p className="pii-context">El seguimiento conserva sus respuestas propias y no duplica métricas de entrenamiento o salud.</p></div>}
            </section>
          </>}
        </section>
      </section>
      <footer className="footer-note">2J Platform <span>·</span> Clientes 360</footer>
    </main>
    {planAction && <div className="backdrop"><section className="dialog plan-action-dialog" role="dialog" aria-modal="true" aria-labelledby="plan-action-title"><button className="icon-button dialog-close" aria-label="Cerrar diálogo" disabled={planActionBusy} onClick={() => setPlanAction(null)}><ClientIcon name="close"/></button><div className="eyebrow">CLIENTE 360 · CUOTAS</div><h2 id="plan-action-title">{planAction.action === 'pause' ? 'Pausar cuota' : planAction.action === 'resume' ? 'Reanudar cuota' : planAction.action === 'cancel' ? 'Cancelar cuota' : planAction.action === 'adjust' ? 'Ajustar saldo' : 'Movimientos del derecho'}</h2><p>{planAction.assignment.planName} · La asignación y su historial se conservarán.</p>
      {(planAction.action === 'pause' || planAction.action === 'cancel' || planAction.action === 'adjust') && <label>Motivo obligatorio<textarea rows={3} maxLength={240} value={planActionReason} onChange={event => setPlanActionReason(event.target.value)}/></label>}
      {planAction.action === 'adjust' && <label>Cantidad a ajustar<input type="number" step="1" value={planActionQuantity} onChange={event => setPlanActionQuantity(event.target.value)} placeholder="Ej. 2 o -1"/></label>}
      {planAction.action === 'movements' && <div className="plan-ledger-list">{!planMovements && !planActionError && <div role="status">Cargando movimientos…</div>}{planMovements?.movements.map(row => <div key={row.id}><strong>{row.quantity > 0 ? '+' : ''}{row.quantity} · {row.entryType === 'grant' ? 'Alta de saldo' : row.entryType === 'adjustment' ? 'Ajuste manual' : row.entryType === 'consume' ? 'Consumo' : 'Restauración'}</strong><span>{row.reason} · {dateLabel(row.occurredAt)}</span></div>)}{planMovements?.events.map(row => <div key={row.id}><strong>{({activated:'Asignada',paused:'Pausada',resumed:'Reanudada',cancelled:'Cancelada',renewed:'Renovada',changed:'Cambio programado'} as Record<string,string>)[row.eventType] ?? 'Actualizada'}</strong><span>{row.reason ?? 'Sin motivo adicional'} · Vigente {row.effectiveOn}</span></div>)}{planMovements?.movements.length === 0 && planMovements.events.length === 0 && <p>Aún no hay movimientos.</p>}</div>}
      {planActionError && <div className="form-error" role="alert">{planActionError}</div>}<div className="dialog-actions"><button type="button" className="button secondary" disabled={planActionBusy} onClick={() => setPlanAction(null)}>Cerrar</button>{planAction.action !== 'movements' && <button type="button" className={planAction.action === 'cancel' ? 'button danger' : 'button primary'} disabled={planActionBusy || ((planAction.action === 'pause' || planAction.action === 'cancel' || planAction.action === 'adjust') && planActionReason.trim().length < 3) || (planAction.action === 'adjust' && (!planActionQuantity || Number(planActionQuantity) === 0))} onClick={() => void performPlanAction()}>{planActionBusy ? 'Guardando…' : planAction.action === 'pause' ? 'Confirmar pausa' : planAction.action === 'resume' ? 'Reanudar cuota' : planAction.action === 'cancel' ? 'Confirmar cancelación' : 'Guardar ajuste'}</button>}</div>
    </section></div>}
    {showEdit && profile && <div className="backdrop"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="edit-client-title"><h2 id="edit-client-title">Editar datos del cliente</h2><p>Actualiza únicamente los datos básicos del perfil.</p><form onSubmit={event=>void updateClient(event)}><label>Nombre<input name="firstName" required maxLength={80} defaultValue={profile.client.firstName}/></label><label>Apellidos<input name="lastName" required maxLength={100} defaultValue={profile.client.lastName}/></label><label>Email (opcional)<input name="email" type="email" maxLength={254} defaultValue={profile.client.email??''}/></label><label>Teléfono (opcional)<input name="phone" type="tel" maxLength={40} defaultValue={profile.client.phone??''}/></label><label>Fecha de nacimiento (opcional)<input name="birthDate" type="date" defaultValue={profile.client.birthDate??''}/></label>{editError&&<div className="form-error" role="alert">{editError}</div>}<div className="dialog-actions"><button type="button" className="button secondary" disabled={editBusy} onClick={()=>setShowEdit(false)}>Cancelar</button><button className="button primary" disabled={editBusy}>{editBusy?'Guardando…':'Guardar cambios'}</button></div></form></section></div>}
{showCreate && <div className="backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setShowCreate(false); }}><section ref={dialogRef} className="dialog" role="dialog" aria-modal="true" aria-labelledby="new-client-title"><button className="icon-button dialog-close" aria-label="Cerrar diálogo" disabled={saving} onClick={() => { setShowCreate(false); setSaveError(''); }}><ClientIcon name="close"/></button><div className="eyebrow">CLIENTES 360</div><h2 id="new-client-title">Nuevo cliente</h2><p>Guarda los datos básicos. No se añade información clínica ni de pagos.</p><form onSubmit={(event) => void createClient(event)}><label>Nombre<input ref={createNameRef} name="firstName" required maxLength={80} autoComplete="given-name"/></label><label>Apellidos<input name="lastName" required maxLength={100} autoComplete="family-name"/></label><label>Email (opcional)<input name="email" type="email" maxLength={254} autoComplete="email"/></label><label>Teléfono (opcional)<input name="phone" type="tel" maxLength={40} autoComplete="tel"/></label><label>Fecha de nacimiento (opcional)<input name="birthDate" type="date"/></label>{saveError && <div className="form-error" role="alert">{saveError}</div>}<div className="dialog-actions client-create-actions"><button type="button" className="button secondary" disabled={saving} onClick={() => setShowCreate(false)}>Cancelar</button><button type="submit" value="save" className="button secondary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>{list.capabilities.assignPlans&&<button type="submit" value="with-plan" className="button primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar y añadir cuota'}</button>}</div></form></section></div>}
    {showPlanDialog&&selectedId&&<div className="backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!planSaveBusy)cancelPlanSale();}}><section className="dialog plan-assignment-dialog" role="dialog" aria-modal="true" aria-labelledby="assign-plan-title"><button className="icon-button dialog-close" aria-label="Cerrar diálogo" disabled={planSaveBusy} onClick={cancelPlanSale}><ClientIcon name="close"/></button><div className="eyebrow">CLIENTE 360 · VENTA</div><h2 id="assign-plan-title">{planOperation?.kind==='renewal'?'Renovar cuota':planOperation?.kind==='change'?'Cambiar plan':'Añadir cuota'}</h2><p>La operación conserva la asignación anterior y crea snapshot y cargo nuevos.</p>{planOperation?.kind==='change'&&<label>Motivo del cambio (opcional)<input maxLength={240} value={planOperationReason} onChange={event=>setPlanOperationReason(event.target.value)}/></label>}{planCatalogState==='loading'&&<div role="status">Cargando planes disponibles…</div>}{planCatalogState==='error'&&<div className="form-error" role="alert">No se pudo cargar el catálogo. Cierra y vuelve a intentarlo.</div>}{planCatalogState==='ready'&&assignablePlans.length===0&&<div className="detail-state"><strong>No hay planes activos para asignar</strong><span>Activa primero un producto desde Servicios.</span></div>}{planCatalogState==='ready'&&assignablePlans.length>0&&<form onSubmit={event=>void assignPlan(event)}><label>Producto o plan<select required value={selectedPlanId} onChange={event=>{const id=event.target.value;setSelectedPlanId(id);const plan=assignablePlans.find(item=>item.id===id);setPlanPrice(plan?.basePriceCents==null?'':(plan.basePriceCents/100).toFixed(2));setPlanAdjustmentReason('')}}><option value="">Selecciona un plan</option>{assignablePlans.map(plan=><option key={plan.id} value={plan.id}>{plan.name} · {plan.kind==='recurring'?'Recurrente':'Bono de sesiones'}</option>)}</select></label>{assignablePlans.find(plan=>plan.id===selectedPlanId)&&<div className="plan-assignment-preview"><strong>{assignablePlans.find(plan=>plan.id===selectedPlanId)?.name}</strong><span>{assignablePlans.find(plan=>plan.id===selectedPlanId)?.services.map(service=>service.name).join(' · ')}</span>{assignablePlans.find(plan=>plan.id===selectedPlanId)?.rights.map((right,index)=><small key={index}>{right.rightType==='service_access'?`Acceso${right.serviceName?` · ${right.serviceName}`:''}`:`${right.quantity} ${right.rightType==='sessions_quota'?'sesiones':right.period==='week'?'por semana':right.period==='month'?'por mes':'por periodo'}${right.serviceName?` · ${right.serviceName}`:''}`}</small>)}</div>}<div className="client-plan-date-grid"><label>Inicio<input type="date" required value={planStartsOn} onChange={event=>setPlanStartsOn(event.target.value)}/></label><label>Fin (opcional)<input type="date" value={planEndsOn} min={planStartsOn} onChange={event=>setPlanEndsOn(event.target.value)}/></label></div><div className="client-plan-date-grid"><label>Precio de venta (€)<input inputMode="decimal" placeholder="0,00" value={planPrice} onChange={event=>setPlanPrice(event.target.value)} readOnly={!profile?.capabilities.manageCatalogPrice} required/></label>{assignablePlans.find(plan=>plan.id===selectedPlanId)?.basePriceCents==null&&!profile?.capabilities.manageCatalogPrice&&<p className="pii-context">Este plan necesita un precio base configurado por Administración antes de poder venderse.</p>}<label>Vencimiento del cargo<input type="date" value={planDueOn} onChange={event=>setPlanDueOn(event.target.value)} required/></label></div>{(()=>{const plan=assignablePlans.find(item=>item.id===selectedPlanId);const cents=euroToCents(planPrice);return plan?.basePriceCents!=null&&cents!==null&&cents!==plan.basePriceCents?<label>Motivo del ajuste de precio<input required minLength={3} maxLength={240} value={planAdjustmentReason} onChange={event=>setPlanAdjustmentReason(event.target.value)}/></label>:null})()}{profile?.capabilities.collectPayments&&<label className="collect-plan-toggle"><input type="checkbox" checked={collectNow} onChange={event=>setCollectNow(event.target.checked)}/> Cobrar ahora el importe completo</label>}{collectNow&&profile?.capabilities.collectPayments&&<label>Método de pago<select value={paymentMethod} onChange={event=>setPaymentMethod(event.target.value as typeof paymentMethod)}><option value="card">Tarjeta</option><option value="cash">Efectivo · requiere caja abierta</option><option value="transfer">Transferencia</option><option value="direct_debit">Domiciliación</option><option value="other">Otro</option></select></label>}<p className="pii-context">El precio se registra en el cargo económico existente; los derechos proceden del plan congelado. No se configura renovación automática ni consumo adicional aquí.</p>{planSaveError&&<div className="form-error" role="alert">{planSaveError}</div>}<div className="dialog-actions"><button type="button" className="button secondary" disabled={planSaveBusy} onClick={cancelPlanSale}>Cancelar</button><button className="button primary" disabled={planSaveBusy||!selectedPlanId}>{planSaveBusy?'Guardando…':planOperation?.kind==='renewal'?'Renovar y cobrar':planOperation?.kind==='change'?'Guardar cambio de plan':collectNow?'Asignar y cobrar':'Asignar y dejar pendiente'}</button></div></form>}</section></div>}    {showArchiveConfirm && <div className="backdrop archive-backdrop"><section ref={archiveDialogRef} className="dialog archive-dialog" role="alertdialog" aria-modal="true" aria-labelledby="archive-client-title" aria-describedby="archive-client-description"><div className="eyebrow">ACCIÓN SOBRE EL PERFIL</div><h2 id="archive-client-title">¿Archivar este cliente?</h2><p id="archive-client-description">El perfil y su historial se conservarán. El cliente dejará de aparecer en la lista de activos.</p>{archiveError && <div className="form-error" role="alert">{archiveError}</div>}<div className="dialog-actions"><button ref={archiveCancelRef} type="button" className="button secondary" disabled={archiving} onClick={() => setShowArchiveConfirm(false)}>Cancelar</button><button type="button" className="button danger" disabled={archiving} onClick={() => void archiveClient()}>{archiving ? 'Archivando…' : 'Archivar cliente'}</button></div></section></div>}
  </div>;
}
