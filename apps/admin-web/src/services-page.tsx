import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cadenceShortLabel, euroLabel, frequencyOptions, frequencyShortLabel, isSessionPackShaped, kindLabel, moduleLabel, periodLabel, rightLabel, statusLabel } from './product-copy.js';
import { useProfessionalCapabilities } from './app-shell.js';
import { Button, Card, Icon as UiIcon, PageHeader, SearchField, SegmentedControl, StatusChip, icons } from '@2j/ui';

type Area = { id: string; name: string };
type Service = { id: string; name: string; area: string; areaId: string; status: 'active' | 'draft' | 'archived'; planCount: number; rightCount: number; updatedAt: string };
type Right = { id: string; rightType: string; serviceId: string | null; quotaScope: 'shared' | 'per_service' | null; quantity: number | null; period: string | null; periodMode: 'calendar' | 'rolling' | null; timezone: string | null; validDays: number | null; validDaysStartRule: 'purchase' | 'first_use' | null };
type Module = {module:'reservations'|'training'|'nutrition'|'health';accessLevel:'limited'|'full';capabilities:string[]};
type Plan = { id: string; name: string; currentVersion?:number; kind: 'recurring' | 'session_pack'; renewalCadence: string | null; periodDays: number | null; status: 'active' | 'draft' | 'archived'; basePriceCents?:number|null; modules?:Module[]; services: { id: string; name: string; area: string; status?: 'active' | 'draft' | 'archived'; areaStatus?: 'active' | 'archived' }[]; rights: Right[] };
type RightDraft = { rightType: 'service_access' | 'sessions_quota' | 'period_quota'; serviceId: string; quotaScope: 'shared' | 'per_service'; quantity: string; period: 'week' | 'month' | 'plan_period'; periodMode: 'calendar' | 'rolling' | null; validDays: string; validDaysStartRule: 'purchase' | 'first_use' };
const apiUrl = import.meta.env?.VITE_API_URL ?? 'http://127.0.0.1:3100';

const iconMap = { grid: icons.LayoutGrid, search: icons.Search, plus: icons.Plus, arrow: icons.ArrowRight, close: icons.X, layers: icons.Layers, shield: icons.ShieldCheck, chevron: icons.ChevronRight } as const;
function Icon({ name, size = 18 }: { name: keyof typeof iconMap; size?: number }) { return <UiIcon icon={iconMap[name]} size={size >= 20 ? 20 : 16} />; }
const statusTone = { active: 'success', draft: 'neutral', archived: 'neutral' } as const;

function Dialog({ titleId, onClose, opener, children, className = '' }: { titleId: string; onClose: () => void; opener: HTMLElement | null; children: React.ReactNode; className?: string }) {
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useLayoutEffect(() => {
    const first = dialogRef.current?.querySelector<HTMLElement>('[data-dialog-initial-focus]') ?? dialogRef.current?.querySelector<HTMLElement>('[autofocus]') ?? dialogRef.current?.querySelector<HTMLElement>('button,input,select,textarea,[tabindex]:not([tabindex="-1"])');
    first?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((item) => !item.hasAttribute('disabled'));
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0]?.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); if (opener?.isConnected) opener.focus(); };
  }, [opener]);
  return <div className="ui-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialogRef} className={`ui-modal ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}><button className="ui-button ui-button--ghost ui-icon-button ui-modal-close" aria-label="Cerrar diálogo" onClick={onClose}><Icon name="close"/></button>{children}</section></div>;
}

function legacyRightLine(right:RightDraft, serviceName: (id:string)=>string) {
  if(right.rightType==='service_access')return `Acceso a ${serviceName(right.serviceId)}`;
  const target=right.quotaScope==='per_service'?` · ${serviceName(right.serviceId)}`:'';
  if(right.rightType==='sessions_quota')return `${right.quantity} sesiones${right.quotaScope==='shared'?' compartidas':''}${target}`;
  const period=periodLabel[right.period]??'periodo';
  return `${right.quantity} accesos / ${period}${right.period==='plan_period'?' del plan':` · ${right.periodMode==='calendar'?'calendario':'móvil'}`}${target}`;
}
function planQuotaSummary(plan:Plan) {
  const quotas=plan.rights.filter(right=>right.rightType==='sessions_quota'||right.rightType==='period_quota');
  if(!quotas.length)return plan.rights.some(right=>right.rightType==='service_access')?'Acceso a servicios':'Sin límite configurado';
  return quotas.map(right=>right.rightType==='sessions_quota'?`${right.quantity} sesiones${right.quotaScope==='shared'?'':' por servicio'}`:`${right.quantity} accesos / ${periodLabel[right.period??'']??'periodo'}`).join(' · ');
}
function planPeriodSummary(plan:Plan) {
  if(plan.kind==='session_pack')return 'Bono · sin renovación';
  if(plan.renewalCadence==='weekly')return 'Recurrente · semanal';
  if(plan.renewalCadence==='monthly')return 'Recurrente · mensual';
  if(plan.renewalCadence==='custom_period')return `Recurrente · cada ${plan.periodDays??'—'} días`;
  return 'Recurrente';
}
function PlanCatalog({plans,activatingPlanId,archivingPlanId,onActivate,onVersion,onArchive}:{plans:Plan[];activatingPlanId:string|null;archivingPlanId:string|null;onActivate:(plan:Plan)=>void;onVersion:(plan:Plan,event:React.MouseEvent<HTMLButtonElement>)=>void;onArchive:(plan:Plan)=>void}) {
  const [expandedPlanId,setExpandedPlanId]=useState<string|null>(null);
  const hasArchivedService=(plan:Plan)=>plan.services.some(service=>service.status==='archived');
  const hasUnavailableDependency=(plan:Plan)=>plan.services.some(service=>service.status==='archived'||service.areaStatus==='archived');
  const price=(plan:Plan)=>plan.basePriceCents==null?'—':new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(Number(plan.basePriceCents)/100);
  const details=(plan:Plan)=><div className="plan-detail-expanded"><div className="associated-services" aria-label="Servicios incluidos">{plan.services.map(item=><span className="service-chip" key={item.id}>{item.name}{item.status==='archived'?' · Archivado':''}<span>{item.area}</span></span>)}</div><div className="rights-block"><div className="rights-title"><Icon name="shield" size={16}/> Qué incluye</div><ul>{plan.rights.map(right=><li key={right.id}><span>{rightLabel[right.rightType]??'Condición'}</span><strong>{right.rightType==='service_access'?right.serviceId?plan.services.find(service=>service.id===right.serviceId)?.name??'Servicio':'Destino sin especificar':right.rightType==='sessions_quota'?right.quotaScope==='shared'?`${right.quantity} sesiones compartidas`:`${right.quantity} sesiones para ${plan.services.find(service=>service.id===right.serviceId)?.name??'el servicio seleccionado'}`:`${right.quantity} accesos / ${periodLabel[right.period??'']??'periodo'}${right.period==='plan_period'?' del plan':` · ${right.periodMode==='calendar'?'calendario':'móvil'}`}${right.quotaScope==='per_service'?` · ${plan.services.find(service=>service.id===right.serviceId)?.name??'servicio'}`:''}`}</strong>{right.validDays&&<small>Caduca {right.validDays} días desde {right.validDaysStartRule==='purchase'?'la compra':'el primer uso'}</small>}</li>)}</ul></div>{Boolean(plan.modules?.length)&&<div className="rights-block module-rights"><div className="rights-title"><Icon name="layers" size={16}/> Accesos a módulos</div><ul>{plan.modules?.map(access=><li key={access.module}><span>{moduleLabel[access.module]}</span><strong>{access.accessLevel==='full'?'Completo':'Limitado'}{access.capabilities.length?` · ${access.capabilities.length} capacidades`:''}</strong></li>)}</ul></div>}{plan.kind==='recurring'&&<p className="plan-legacy-note" data-testid="plan-legacy-note">Este plan usa el modelo anterior de cuotas. La frecuencia y las sesiones del periodo se aplicarán con el nuevo modelo (2J-098E).</p>}<div className="plan-detail-actions"><span>Versión {plan.currentVersion??1}</span>{plan.status!=='archived'&&!plan.services.some(service=>service.status==='archived')&&<button className="ui-button ui-button--secondary ui-button--sm" onClick={event=>onVersion(plan,event)}>Crear nueva versión</button>}</div></div>;
  return <ul className="plan-cards" aria-label="Planes del servicio">{plans.map(plan=><li key={plan.id}><Card as="article" className="plan-card" aria-label={plan.name}>
    <div className="plan-card-head"><div><h3>{plan.name}</h3><p>{kindLabel[plan.kind]} · Versión {plan.currentVersion??1}</p></div><div className="plan-card-side"><StatusChip tone={statusTone[plan.status]}>{statusLabel[plan.status]}</StatusChip><strong className="plan-price">{price(plan)}</strong></div></div>
    <dl className="plan-facts"><div><dt>{plan.kind==='session_pack'?'Sesiones':'Cuota actual'}</dt><dd>{planQuotaSummary(plan)}</dd></div><div><dt>Vigencia</dt><dd>{planPeriodSummary(plan)}</dd></div><div><dt>Servicios</dt><dd>{plan.services.map(item=>`${item.name}${item.status==='archived'?' · Archivado':''}`).join(', ')||'—'}</dd></div></dl>
    {hasArchivedService(plan)&&<p className="field-note">Este plan conserva el historial del servicio archivado; puedes consultar y archivar su definición.</p>}
    <div className="plan-row-actions"><Button size="sm" variant="ghost" aria-expanded={expandedPlanId===plan.id} onClick={()=>setExpandedPlanId(current=>current===plan.id?null:plan.id)}>{expandedPlanId===plan.id?'Ocultar':'Detalles'}</Button>{(plan.status==='draft'||plan.status==='archived')&&!hasUnavailableDependency(plan)&&<Button size="sm" variant="primary" disabled={activatingPlanId!==null} loading={activatingPlanId===plan.id} onClick={()=>onActivate(plan)}>{activatingPlanId===plan.id?'Activando…':plan.status==='archived'?'Reactivar plan':'Activar plan'}</Button>}{plan.status==='archived'&&hasUnavailableDependency(plan)&&<span className="plan-legacy-note">No se puede reactivar: hay un servicio o área archivados.</span>}{plan.status!=='archived'&&!hasUnavailableDependency(plan)&&<Button size="sm" variant="ghost" onClick={event=>onVersion(plan,event)}>Nueva versión</Button>}{plan.status!=='archived'&&<Button size="sm" variant="ghost" disabled={archivingPlanId!==null} loading={archivingPlanId===plan.id} onClick={()=>onArchive(plan)}>{archivingPlanId===plan.id?'Archivando…':'Archivar plan'}</Button>}</div>
    {expandedPlanId===plan.id&&<section aria-label={`Detalles de ${plan.name}`}>{details(plan)}</section>}
  </Card></li>)}</ul>;
}

export function ServicesPage({ section = 'services' }: { section?: 'services' | 'areas' | 'plans' }) {
  const shellCapabilities = useProfessionalCapabilities();
  const canManageCatalog = shellCapabilities?.catalogPricingManage === true;
  const [catalogView, setCatalogView] = useState<'services'|'areas'|'plans'>(section);
  useEffect(() => setCatalogView(section), [section]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [areasLoading, setAreasLoading] = useState(true);
  const [services, setServices] = useState<Service[]>([]);
  const [query, setQuery] = useState('');
  const [areaFilter, setAreaFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [areaError, setAreaError] = useState('');
  const [dialog, setDialog] = useState<'area' | 'service' | 'plan' | null>(null);
  const dialogOpener = useRef<HTMLElement | null>(null);
  const planIdempotencyKey = useRef<string | null>(null);
  const detailPanel = useRef<HTMLElement>(null);
  const [name, setName] = useState('');
  const [areaName, setAreaName] = useState('');
  const [areaActionError, setAreaActionError] = useState('');
  const [catalogNotice, setCatalogNotice] = useState('');
  const [serviceAreaId, setServiceAreaId] = useState('');
  const [serviceStatus, setServiceStatus] = useState<Service['status'] | ''>('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansState, setPlansState] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle');
  const [plansError, setPlansError] = useState('');
  const [activatingPlanId, setActivatingPlanId] = useState<string | null>(null);
  const [archivingPlanId, setArchivingPlanId] = useState<string | null>(null);
  const [planActionFeedback, setPlanActionFeedback] = useState('');
  const [planName, setPlanName] = useState('');
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [kind, setKind] = useState<Plan['kind'] | ''>('');
  const [cadence, setCadence] = useState('monthly');
  const [periodDays, setPeriodDays] = useState('');
  const [frequency, setFrequency] = useState('');
  const [packSessions, setPackSessions] = useState('');
  const [packValidDays, setPackValidDays] = useState('');
  const [packStartRule, setPackStartRule] = useState<'purchase' | 'first_use'>('purchase');
  // Plans created with the previous quota model keep their stored quotas untouched (read-only for the staff).
  const [legacyRights, setLegacyRights] = useState<RightDraft[] | null>(null);
  const [basePrice, setBasePrice] = useState('');
  const [moduleAccesses,setModuleAccesses]=useState<Module[]>([]);
  const [editingPlanId,setEditingPlanId]=useState<string|null>(null);

  const selected = services.find((service) => service.id === selectedId) ?? null;
  const visible = useMemo(() => services.filter((item) => item.name.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')) && (areaFilter === 'all' || item.areaId === areaFilter)), [services, query, areaFilter]);

  async function refreshAreas() {
    setAreasLoading(true); setAreaError('');
    try { const response = await fetch(`${apiUrl}/api/areas`); if (!response.ok) throw new Error(); const rows = await response.json() as Area[]; setAreas(rows); if (!serviceAreaId && rows[0]) setServiceAreaId(rows[0].id); }
    catch { setAreaError('No se pudieron cargar las áreas del centro.'); }
    finally { setAreasLoading(false); }
  }
  async function refreshServices() {
    setLoading(true); setError('');
    try {
      const response = await fetch(`${apiUrl}/api/services`);
      if (!response.ok) throw new Error();
      const rows = await response.json() as Service[];
      setServices(rows);
      setSelectedId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id ?? null);
      return rows;
    } catch { setError('No se pudo cargar el catálogo. Comprueba la conexión con la API e inténtalo de nuevo.'); return null; }
    finally { setLoading(false); }
  }
  async function loadPlans(serviceId: string) {
    if (!canManageCatalog) { setPlans([]); setPlansState('idle'); return; }
    setPlansState('loading'); setPlansError('');
    try {
      const response = await fetch(`${apiUrl}/api/services/${serviceId}/plans`);
      if (!response.ok) throw new Error();
      const rows = await response.json() as Plan[]; setPlans(rows); setPlansState('ready');
    } catch { setPlans([]); setPlansError('No se pudieron cargar los planes de este servicio.'); setPlansState('error'); }
  }
  async function loadAllPlans() {
    if (!canManageCatalog) { setPlans([]); setPlansState('idle'); return; }
    setPlansState('loading'); setPlansError('');
    try {
      const servicesResponse = await fetch(`${apiUrl}/api/services?includeArchived=true`);
      if (!servicesResponse.ok) throw new Error();
      const allServices = await servicesResponse.json() as Service[];
      const lists = await Promise.all(allServices.map(async (item) => {
        const response = await fetch(`${apiUrl}/api/services/${item.id}/plans?includeArchived=true`);
        if (!response.ok) throw new Error();
        return await response.json() as Plan[];
      }));
      const byId = new Map<string, Plan>();
      for (const plan of lists.flat()) byId.set(plan.id, plan);
      setPlans([...byId.values()].sort((left, right) => left.name.localeCompare(right.name, 'es')));
      setPlansState('ready');
    } catch { setPlans([]); setPlansError('No se pudieron cargar los planes.'); setPlansState('error'); }
  }
  async function activatePlan(plan: Plan) {
    if (!canManageCatalog || !['draft', 'archived'].includes(plan.status) || activatingPlanId || plan.services.some(service => service.status === 'archived' || service.areaStatus === 'archived')) return;
    const reactivating = plan.status === 'archived';
    if (!window.confirm(reactivating ? '¿Reactivar este plan? Se volverá a ofrecer su versión congelada a nuevas contrataciones.' : 'Al activar el plan, esta versión quedará disponible para asignarla a clientes.')) return;
    setActivatingPlanId(plan.id); setPlanActionFeedback('');
    try {
      const response = await fetch(`${apiUrl}/api/plans/${plan.id}/activate`, { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? ({ service_not_active: 'Activa todos los servicios incluidos antes de activar este plan.', plan_not_found: 'No se encontró el plan.' } as Record<string, string>)[body.error] ?? 'No se pudo activar el plan.');
      setPlanActionFeedback(reactivating ? 'Plan reactivado con su versión congelada y disponible para nuevas contrataciones.' : 'Plan activado y disponible para asignarlo a clientes.');
      await (section === 'plans' ? loadAllPlans() : selectedId ? loadPlans(selectedId) : Promise.resolve());
    } catch (cause) { setPlanActionFeedback(cause instanceof Error ? cause.message : 'No se pudo activar el plan.'); }
    finally { setActivatingPlanId(null); }
  }
  async function archivePlan(plan: Plan) {
    if (!canManageCatalog || plan.status === 'archived' || archivingPlanId || !window.confirm(`¿Archivar ${plan.name}? Se conservarán su versión y las asignaciones existentes.`)) return;
    setArchivingPlanId(plan.id); setPlanActionFeedback('');
    try {
      const response = await fetch(`${apiUrl}/api/plans/${plan.id}/archive`, { method: 'POST' });
      if (!response.ok) throw new Error('No se pudo archivar el plan.');
      setPlanActionFeedback('Plan archivado; se conservan su versión y las asignaciones existentes.');
      await (section === 'plans' ? loadAllPlans() : selectedId ? loadPlans(selectedId) : Promise.resolve());
    } catch (cause) { setPlanActionFeedback(cause instanceof Error ? cause.message : 'No se pudo archivar el plan.'); }
    finally { setArchivingPlanId(null); }
  }
  useEffect(() => { void refreshAreas(); void refreshServices(); }, []);
  useEffect(() => { if (section === 'plans') return; if (selectedId && canManageCatalog && catalogView === 'plans') void loadPlans(selectedId); else { setPlans([]); setPlansState('idle'); } }, [selectedId, canManageCatalog, catalogView, section]);
  useEffect(() => { if (section === 'plans') void loadAllPlans(); }, [section, canManageCatalog]);

  function openAreaDialog(event?: React.MouseEvent<HTMLButtonElement>) { if (!canManageCatalog) return; dialogOpener.current = event?.currentTarget ?? document.activeElement as HTMLElement; setAreaName(''); setAreaActionError(''); setDialog('area'); }
  function openServiceDialog(event?: React.MouseEvent<HTMLButtonElement>) { if (!canManageCatalog) return; dialogOpener.current = event?.currentTarget ?? document.activeElement as HTMLElement; setSaveError(''); setDialog('service'); }
  function openPlanDialog(event?: React.MouseEvent<HTMLButtonElement>) {
    if (!canManageCatalog || !selected) return;
    setCatalogView('plans');
    dialogOpener.current = event?.currentTarget ?? document.activeElement as HTMLElement;
    planIdempotencyKey.current = crypto.randomUUID();
    setSaveError(''); setEditingPlanId(null);setPlanName(''); setKind(''); setCadence('monthly'); setPeriodDays(''); setFrequency(''); setPackSessions(''); setPackValidDays(''); setPackStartRule('purchase'); setLegacyRights(null); setServiceIds([selected.id]);setBasePrice('');setModuleAccesses([]); setDialog('plan');
  }
  async function createArea(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!canManageCatalog || !areaName.trim()) return;
    setSaving(true); setAreaActionError('');
    try {
      const response = await fetch(`${apiUrl}/api/areas`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: areaName.trim() }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error === 'duplicate_area' ? 'Ya existe un área con ese nombre.' : 'No se pudo crear el área.');
      const created = body as Area; await refreshAreas(); setDialog(null); setAreaName(''); setAreaActionError('');
      if (created?.id) setCatalogNotice(`${created.name} está lista para asociar servicios.`);
    } catch (cause) { setAreaActionError(cause instanceof Error ? cause.message : 'No se pudo crear el área.'); }
    finally { setSaving(false); }
  }
  async function archiveArea(area: Area) {
    if (!canManageCatalog || !window.confirm(`¿Archivar ${area.name}? El historial se conserva. No se puede archivar mientras tenga sesiones o plantillas futuras activas.`)) return;
    setAreaActionError('');
    try {
      const response = await fetch(`${apiUrl}/api/areas/${area.id}/archive`, { method: 'PATCH' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error === 'future_calendar_items_exist' ? 'Resuelve primero las sesiones y plantillas futuras de esta área.' : 'No se pudo archivar el área.');
      await Promise.all([refreshAreas(), refreshServices()]); setAreaActionError(''); setCatalogNotice(`${area.name} se ha archivado. El historial se conserva.`);
    } catch (cause) { setAreaActionError(cause instanceof Error ? cause.message : 'No se pudo archivar el área.'); }
  }
  function openVersionDialog(plan:Plan,event:React.MouseEvent<HTMLButtonElement>){
    if(!canManageCatalog)return;setCatalogView('plans');dialogOpener.current=event.currentTarget;planIdempotencyKey.current=crypto.randomUUID();setEditingPlanId(plan.id);setSaveError('');setPlanName(plan.name);setKind(plan.kind);setCadence(plan.renewalCadence??'monthly');setPeriodDays(plan.periodDays?String(plan.periodDays):'');setFrequency('');
    const pack=isSessionPackShaped(plan);
    if(pack){const quota=plan.rights.find(right=>right.rightType==='sessions_quota')!;setPackSessions(String(quota.quantity??''));setPackValidDays(quota.validDays?String(quota.validDays):'');setPackStartRule(quota.validDaysStartRule??'purchase');setLegacyRights(null);}
    else{setPackSessions('');setPackValidDays('');setPackStartRule('purchase');setLegacyRights(plan.rights.map(right=>({rightType:right.rightType as RightDraft['rightType'],serviceId:right.serviceId??'',quotaScope:right.quotaScope??'shared',quantity:right.quantity?String(right.quantity):'',period:(right.period??'month') as RightDraft['period'],periodMode:right.periodMode??'calendar',validDays:right.validDays?String(right.validDays):'',validDaysStartRule:right.validDaysStartRule??'purchase'})));}
    setServiceIds(plan.services.map(item=>item.id));setBasePrice(plan.basePriceCents==null?'':(Number(plan.basePriceCents)/100).toFixed(2));setModuleAccesses(plan.modules??[]);setDialog('plan');
  }
  async function createService(event: React.FormEvent) {
    event.preventDefault(); if (!name.trim() || !serviceAreaId || !serviceStatus) return; setSaving(true); setSaveError('');
    try {
      const response = await fetch(`${apiUrl}/api/services`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name.trim(), areaId: serviceAreaId, status: serviceStatus }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? 'No se pudo guardar el servicio.');
      const rows = await refreshServices(); setName(''); setDialog(null);
      const created = rows?.find((item) => item.name === name.trim()); if (created) setSelectedId(created.id);
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : 'No se pudo guardar el servicio.'); }
    finally { setSaving(false); }
  }
  function toRightPayload(right: RightDraft) {
    return { rightType: right.rightType, serviceId: right.rightType !== 'service_access' && right.quotaScope === 'shared' ? null : right.serviceId || null,
      ...(right.rightType === 'service_access' ? {} : { quotaScope: right.quotaScope, quantity: Number(right.quantity) }),
      ...(right.rightType === 'period_quota' ? { period: right.period, ...(right.period === 'plan_period' ? {} : { periodMode: right.periodMode, timezone: 'Atlantic/Canary' }) } : {}),
      ...(right.validDays ? { validDays: Number(right.validDays), validDaysStartRule: right.validDaysStartRule } : {}) };
  }
  // Access to the included services is derived from the selected services; the staff never edits it as a separate decision.
  function buildRights() {
    const access = (id: string) => ({ rightType: 'service_access', serviceId: id });
    if (legacyRights) {
      const kept = legacyRights.filter((right) => right.rightType === 'service_access' ? Boolean(right.serviceId) && serviceIds.includes(right.serviceId) : right.quotaScope === 'shared' || serviceIds.includes(right.serviceId)).map(toRightPayload);
      const covered = new Set(kept.filter((right) => right.rightType === 'service_access').map((right) => right.serviceId));
      return [...kept, ...serviceIds.filter((id) => !covered.has(id)).map(access)];
    }
    return [...serviceIds.map(access), { rightType: 'sessions_quota', serviceId: null, quotaScope: 'shared', quantity: Number(packSessions), ...(packValidDays ? { validDays: Number(packValidDays), validDaysStartRule: packStartRule } : {}) }];
  }
  async function createPlan(event: React.FormEvent) {
    event.preventDefault(); if (!canSavePlan) return;
    setSaving(true); setSaveError('');
    const amount=basePrice.trim()?Number(basePrice.replace(',','.')):null;
    if(amount!==null&&(!Number.isFinite(amount)||amount<0||amount>1_000_000_000)){setSaving(false);return;}
    const body = { name: planName.trim(), serviceIds, kind, basePriceCents:amount===null?null:Math.round(amount*100),modules:moduleAccesses, ...(kind === 'recurring' ? { renewalCadence: cadence, ...(cadence === 'custom_period' ? { periodDays: Number(periodDays) } : {}) } : {}), rights: buildRights() };
    try {
      const response = await fetch(`${apiUrl}/api/plans${editingPlanId?`/${editingPlanId}/versions`:''}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': planIdempotencyKey.current ?? crypto.randomUUID() }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message ?? (result.error === 'conflict' ? 'Ya existe un plan con ese nombre.' : 'No se pudo guardar el plan.'));
      const planServiceIds = (result.services as Plan['services'] | undefined)?.map((item) => item.id) ?? [];
      const serviceId = selectedId && planServiceIds.includes(selectedId) ? selectedId : planServiceIds[0] ?? selectedId;
      const [rows] = await Promise.all([refreshServices(), section === 'plans' ? loadAllPlans() : serviceId ? loadPlans(serviceId) : Promise.resolve()]);
      if (rows && serviceId) setSelectedId(rows.find((item) => item.id === serviceId)?.id ?? null);
      setDialog(null);
      planIdempotencyKey.current = null;
      setEditingPlanId(null);
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : 'No se pudo guardar el plan.'); }
    finally { setSaving(false); }
  }
  function togglePlanService(serviceId: string, checked: boolean) { setServiceIds((current) => checked ? [...current, serviceId] : current.filter((id) => id !== serviceId)); }
  function closeDialog() { if (!saving) { setDialog(null); setSaveError(''); } }
  function selectService(serviceId: string) { setSelectedId(serviceId); if (window.matchMedia('(max-width: 959px)').matches) requestAnimationFrame(() => { detailPanel.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); detailPanel.current?.focus({ preventScroll: true }); }); }
  const recurringBlocked = kind === 'recurring' && legacyRights === null;
  const packQuantityOk = Number.isInteger(Number(packSessions)) && Number(packSessions) >= 1 && Number(packSessions) <= 100000;
  const packValidityOk = !packValidDays || (Number.isInteger(Number(packValidDays)) && Number(packValidDays) >= 1 && Number(packValidDays) <= 3660);
  const priceOk = !basePrice.trim() || (Number.isFinite(Number(basePrice.replace(',', '.'))) && Number(basePrice.replace(',', '.')) >= 0);
  const canSavePlan = !saving && Boolean(planName.trim()) && serviceIds.length > 0 && Boolean(kind) && !recurringBlocked && priceOk && (legacyRights !== null || (kind === 'session_pack' && packQuantityOk && packValidityOk)) && !(legacyRights === null && cadence === 'custom_period' && !periodDays);
  const serviceNameOf = (id: string) => services.find((item) => item.id === id)?.name ?? 'servicio';
  const includedNames = services.filter((item) => serviceIds.includes(item.id)).map((item) => item.name);
  const amountNumber = basePrice.trim() ? Number(basePrice.replace(',', '.')) : null;
  const planSummary = kind ? [
    kind === 'session_pack' ? 'Bono' : cadenceShortLabel(cadence, Number(periodDays) || null),
    kind === 'session_pack' ? (packQuantityOk && packSessions ? `${Number(packSessions)} ${Number(packSessions) === 1 ? 'sesión' : 'sesiones'}` : '') : legacyRights ? legacyRights.filter((right) => right.rightType !== 'service_access').map((right) => legacyRightLine(right, serviceNameOf)).join(' + ') : frequency ? frequencyShortLabel(frequency) : '',
    includedNames.join(', '),
    amountNumber !== null && Number.isFinite(amountNumber) ? euroLabel(amountNumber) : '',
  ].filter(Boolean).join(' · ') : '';

  const isSpacesScreen = section === 'areas';
  const isPlansScreen = section === 'plans';
  return <main className="services-v2" id={isSpacesScreen ? 'spaces' : isPlansScreen ? 'plans' : 'services'} data-2j-design="v2">
      <PageHeader title={isSpacesScreen ? 'Espacios' : isPlansScreen ? 'Planes y cuotas' : 'Servicios'} description={isSpacesScreen ? 'Gestiona los espacios del centro y consulta los servicios que se realizan en cada uno.' : isPlansScreen ? 'Administra las definiciones comerciales sin mezclar espacios y servicios.' : 'Gestiona las actividades del centro y sus planes comerciales.'} actions={catalogView === 'areas' ? canManageCatalog ? <Button variant="primary" icon={icons.Plus} onClick={openAreaDialog}>Nuevo espacio</Button> : undefined : catalogView === 'services' ? canManageCatalog ? <Button variant="primary" icon={icons.Plus} onClick={openServiceDialog}>Nuevo servicio</Button> : undefined : selected ? <Button variant="primary" icon={icons.Plus} onClick={openPlanDialog}>Nuevo plan</Button> : undefined} />
      {section === 'services' && canManageCatalog && <SegmentedControl label="Vistas de Servicios" value={catalogView} onChange={setCatalogView} options={[{ value: 'services', label: 'Servicios' }, { value: 'plans', label: 'Planes' }]} />}
      {catalogNotice && <p className="services-notice" role="status">{catalogNotice}</p>}
      {isPlansScreen ? (<section className="plan-cards-section" aria-label="Planes y cuotas">
        {planActionFeedback && <p className="services-notice" role="status">{planActionFeedback}</p>}
        {!canManageCatalog ? <div className="state-panel"><strong>Tu perfil no gestiona el catálogo de planes</strong><span>Pide ayuda a una persona con permiso de catálogo y precios.</span></div>
          : plansState === 'loading' || plansState === 'idle' ? <div className="state-panel" role="status"><span className="spinner"/>Cargando planes…</div>
          : plansState === 'error' ? <div className="state-panel error-panel" role="alert"><strong>No se pudieron cargar los planes</strong><span>{plansError}</span><button className="ui-button ui-button--secondary" onClick={() => void loadAllPlans()}>Reintentar</button></div>
          : plans.length === 0 ? <div className="state-panel"><strong>Aún no hay planes</strong><span>Los planes reúnen servicios y derechos en una definición versionada.</span>{selected && <Button variant="primary" onClick={openPlanDialog}>Crear primer plan</Button>}</div>
          : <PlanCatalog plans={plans} activatingPlanId={activatingPlanId} archivingPlanId={archivingPlanId} onActivate={plan=>void activatePlan(plan)} onVersion={openVersionDialog} onArchive={plan=>void archivePlan(plan)}/>}
      </section>) : catalogView === 'areas' ? (<section className="gym-areas" aria-label="Espacios del centro" aria-busy={areasLoading}>
        <div className="gym-section-heading"><div><h2>Espacios</h2><p>Instalaciones del centro y servicios asociados. La capacidad se define por sesión.</p></div><span className="count">{areas.length} {areas.length === 1 ? 'espacio' : 'espacios'}</span></div>
        {areaActionError && <div className="ui-form-error" role="alert">{areaActionError}</div>}
        {areaError ? <div className="state-panel error-panel" role="alert"><strong>No se pudieron cargar los espacios</strong><span>{areaError}</span><button className="ui-button ui-button--secondary" onClick={() => void refreshAreas()}>Reintentar</button></div> : areasLoading ? <div className="state-panel" role="status"><span className="spinner"/>Cargando espacios…</div> : areas.length === 0 ? <div className="state-panel"><strong>Aún no hay espacios configurados</strong><span>Crea un espacio para poder asociarle servicios.</span>{canManageCatalog && <button className="ui-button ui-button--secondary" onClick={openAreaDialog}>Crear primer espacio</button>}</div> : <div className="gym-area-grid">{areas.map((area) => { const related = services.filter((service) => service.areaId === area.id); return <article className="gym-area-card" key={area.id}><div className="gym-area-heading"><div><span className="eyebrow">ESPACIO ACTIVO</span><h3>{area.name}</h3></div>{canManageCatalog && <button className="ui-button ui-button--danger ui-button--sm" onClick={() => void archiveArea(area)}>Archivar</button>}</div><div className="gym-area-services"><strong>{related.length} {related.length === 1 ? 'servicio' : 'servicios'}</strong>{related.length ? <ul>{related.map((service) => <li key={service.id}><span>{service.name}</span><StatusChip tone={statusTone[service.status]}>{statusLabel[service.status]}</StatusChip></li>)}</ul> : <p>Sin servicios asociados.</p>}</div></article>; })}</div>}
      </section>) : (<section className="catalog" aria-label={catalogView === 'plans' ? 'Planes' : 'Servicios del centro'}>
        <div className="ui-card ui-card--pad-none service-panel"><div className="panel-heading"><div><h2>{catalogView === 'plans' ? 'Servicios' : 'Servicios activos y en borrador'}</h2><p>{catalogView === 'plans' ? 'Elige un servicio para consultar los planes que lo incluyen.' : 'Actividades disponibles y el área donde se realizan.'}</p></div><span className="count">{visible.length} {visible.length === 1 ? 'servicio' : 'servicios'}</span></div>
          <div className="toolbar"><SearchField label="Buscar servicio" placeholder="Buscar servicio" value={query} onChange={setQuery} /><label className="filter-label"><span>Área</span><select aria-label="Filtrar por área" value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}><option value="all">Todas</option>{areas.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
          {error ? <div className="state-panel error-panel" role="alert"><strong>No se pudo cargar el catálogo</strong><span>{error}</span><button className="ui-button ui-button--secondary" onClick={() => void refreshServices()}>Reintentar</button></div> : loading ? <div className="state-panel" role="status"><span className="spinner"/><span>Cargando servicios…</span></div> : visible.length === 0 ? <div className="state-panel"><span className="state-icon"><Icon name="layers" size={22}/></span><strong>{services.length ? 'Sin resultados' : 'Aún no hay servicios'}</strong><span>{services.length ? 'Prueba con otro nombre o área.' : 'Crea el primer servicio para preparar el catálogo.'}</span>{!services.length && <button className="ui-button ui-button--secondary" onClick={openServiceDialog}>Crear servicio</button>}</div> : <>
            <ul className="service-list" aria-label="Servicios">{visible.map((item) => <li key={item.id}><button type="button" className={`service-row ${item.id === selectedId ? 'selected' : ''}`} aria-pressed={item.id === selectedId} aria-controls="service-detail" onClick={() => selectService(item.id)}><span className="service-mark"><Icon name="grid" size={16}/></span><span className="service-row-copy"><strong>{item.name}</strong><small>{item.area}{canManageCatalog && item.status === 'active' && item.planCount === 0 && <> · <span className="service-warn">Sin planes vinculados</span></>}</small></span><StatusChip tone={statusTone[item.status]}>{statusLabel[item.status]}</StatusChip><Icon name="chevron" size={16}/></button></li>)}</ul>
          </>}
        </div>
        <section ref={detailPanel} className="ui-card ui-card--pad-lg detail-panel" id="service-detail" tabIndex={-1} aria-live="polite">{selected ? catalogView === 'services' ? <><div className="detail-heading"><div><div className="eyebrow">SERVICIO · {selected.area}</div><h2>{selected.name}</h2><p>Servicio del centro, realizado en un área.</p></div></div><dl className="gym-service-facts"><div><dt>Área</dt><dd>{selected.area}</dd></div><div><dt>Estado</dt><dd><StatusChip tone={statusTone[selected.status]}>{statusLabel[selected.status]}</StatusChip></dd></div></dl>{canManageCatalog && <p className="field-note">Los planes que incluyen este servicio se consultan en la pestaña Planes, sin mezclarlos con la operación diaria.</p>}</> : <><div className="detail-heading"><div><div className="eyebrow">PLANES · {selected.area}</div><h2>{selected.name}</h2><p>Planes que incluyen este servicio, separados de la actividad y del área.</p></div><button className="ui-button ui-button--secondary" onClick={openPlanDialog}><Icon name="plus"/> Nuevo plan</button></div>
           {planActionFeedback && <p className="form-note" role="status">{planActionFeedback}</p>}
           {plansState==='ready'&&plans.length>0&&<div className="plan-content"><PlanCatalog plans={plans} activatingPlanId={activatingPlanId} archivingPlanId={archivingPlanId} onActivate={plan=>void activatePlan(plan)} onVersion={openVersionDialog} onArchive={plan=>void archivePlan(plan)}/></div>}
           {plansState === 'loading' && <div className="detail-state" role="status"><span className="spinner"/> Cargando planes…</div>}
           {plansState === 'error' && <div className="detail-state detail-error" role="alert"><strong>No se pudieron cargar los planes</strong><span>{plansError}</span><button className="ui-button ui-button--secondary" onClick={() => void loadPlans(selected.id)}>Reintentar</button></div>}
           {plansState === 'ready' && plans.length === 0 && <div className="detail-state"><span className="state-icon"><Icon name="layers" size={20}/></span><strong>Aún no hay planes</strong><span>Un plan reúne servicios, frecuencia o sesiones y accesos en una definición versionada.</span><button className="ui-button ui-button--primary" onClick={openPlanDialog}>Crear primer plan</button></div>}
        </> : <div className="detail-state detail-placeholder"><span className="state-icon"><Icon name="layers" size={21}/></span><strong>Elige un servicio</strong><span>Verás aquí su área o los planes asociados según la pestaña.</span></div>}</section>
       </section>)}

    {dialog === 'area' && <Dialog titleId="area-dialog-title" onClose={closeDialog} opener={dialogOpener.current}><div className="eyebrow">ESPACIOS DEL CENTRO</div><h2 id="area-dialog-title">Nuevo espacio</h2><p>El espacio reúne los servicios que se realizan en esta instalación.</p><form onSubmit={createArea}><label>Nombre del espacio<input data-dialog-initial-focus required maxLength={100} placeholder="Ej. Sala norte" value={areaName} onChange={(event) => setAreaName(event.target.value)}/></label>{areaActionError && <div className="ui-form-error" role="alert">{areaActionError}</div>}<div className="ui-modal-actions"><button type="button" className="ui-button ui-button--secondary" onClick={closeDialog}>Cancelar</button><button className="ui-button ui-button--primary" disabled={saving || !areaName.trim()}>{saving ? 'Guardando…' : 'Crear espacio'}</button></div></form></Dialog>}
    {dialog === 'service' && <Dialog titleId="service-dialog-title" onClose={closeDialog} opener={dialogOpener.current}><div className="eyebrow">CATÁLOGO</div><h2 id="service-dialog-title">Nuevo servicio</h2><p>Añade una actividad disponible en un área del centro.</p><form onSubmit={createService}><label>Nombre<input data-dialog-initial-focus required maxLength={100} placeholder="Ej. Entrenamiento personal" value={name} onChange={(event) => setName(event.target.value)}/></label><label>Área<select required value={serviceAreaId} onChange={(event) => setServiceAreaId(event.target.value)}>{!areas.length && <option value="">{areaError || 'Cargando áreas…'}</option>}{areas.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{areaError && <small className="field-error">{areaError}</small>}</label><label>Estado<select required value={serviceStatus} onChange={(event) => setServiceStatus(event.target.value as Service['status'] | '')}><option value="">Selecciona un estado</option><option value="draft">Borrador</option><option value="active">Activo</option></select></label>{saveError && <div className="ui-form-error" role="alert">{saveError}</div>}<div className="ui-modal-actions"><button type="button" className="ui-button ui-button--secondary" onClick={closeDialog}>Cancelar</button><button className="ui-button ui-button--primary" disabled={saving || !areas.length}>{saving ? 'Guardando…' : 'Crear servicio'}</button></div></form></Dialog>}
    {dialog === 'plan' && selected && <Dialog titleId="plan-dialog-title" onClose={closeDialog} opener={dialogOpener.current} className="plan-dialog"><div className="eyebrow">DEFINICIÓN DEL PLAN</div><h2 id="plan-dialog-title">{editingPlanId?'Nueva versión de plan':'Nuevo plan'}</h2><p>{editingPlanId?'Los cambios se guardan como una nueva versión y conservan intactas las asignaciones existentes.':'Se guardará como borrador. Podrás activarlo desde la lista de planes cuando esté listo.'}</p><form onSubmit={createPlan}>
      <fieldset className="plan-block"><legend>Datos del plan</legend>
        <label>Nombre<input autoFocus data-dialog-initial-focus required maxLength={100} placeholder="Ej. Mensual 3 días" value={planName} onChange={(event) => setPlanName(event.target.value)}/></label>
        <label>Precio (€), opcional<input inputMode="decimal" placeholder="Sin precio definido" value={basePrice} onChange={(event)=>setBasePrice(event.target.value)}/></label><small className="field-note">Precio de catálogo informativo. El precio realmente vendido se congela en cada asignación.</small>
        <label>Tipo de plan<select required value={kind} disabled={Boolean(editingPlanId)} onChange={(event) => setKind(event.target.value as Plan['kind'] | '')}><option value="">Selecciona el tipo</option><option value="recurring">Plan recurrente</option><option value="session_pack">Bono de sesiones</option></select></label>
      </fieldset>
      <fieldset className="plan-block"><legend>Servicios incluidos</legend><div className="service-options">{services.filter((item) => item.status === 'active' || item.id === selected.id).map((item) => <label className="check-option" key={item.id}><input type="checkbox" checked={serviceIds.includes(item.id)} onChange={(event) => togglePlanService(item.id, event.target.checked)}/><span><strong>{item.name}</strong><small>Área · {item.area}{item.status === 'draft' ? ' · Borrador' : ''}</small></span></label>)}</div>{selected.status === 'draft' && serviceIds.includes(selected.id) && <p className="field-note">Este servicio está en borrador. El plan también seguirá en borrador hasta que todos sus servicios estén activos.</p>}{!serviceIds.length && <p className="field-note" role="status">Selecciona al menos un servicio para continuar.</p>}</fieldset>
      <fieldset className="plan-block"><legend>{kind === 'session_pack' ? 'Sesiones' : 'Frecuencia'}</legend>
        {!kind && <p className="field-note">Elige el tipo de plan para definir su frecuencia o sus sesiones.</p>}
        {kind === 'recurring' && legacyRights === null && <><label>Frecuencia<select required value={frequency} onChange={(event) => setFrequency(event.target.value)}><option value="">Selecciona la frecuencia</option>{frequencyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><small className="field-note">La cantidad de sesiones del periodo se calculará según la duración real del periodo.</small></>}
        {kind === 'recurring' && legacyRights !== null && <div className="plan-legacy-readout"><p className="field-note">Este plan usa el modelo anterior de cuotas. Se conserva tal como está.</p><ul>{legacyRights.filter((right) => right.rightType !== 'service_access').map((right, index) => <li key={index}>{legacyRightLine(right, serviceNameOf)}</li>)}{!legacyRights.some((right) => right.rightType !== 'service_access') && <li>Sin cuota: acceso a los servicios incluidos</li>}</ul></div>}
        {kind === 'session_pack' && legacyRights === null && <label>Número de sesiones<input required type="number" min="1" max="100000" step="1" placeholder="Ej. 10" value={packSessions} onChange={(event) => setPackSessions(event.target.value)}/></label>}
        {kind === 'session_pack' && legacyRights !== null && <div className="plan-legacy-readout"><p className="field-note">Este bono usa el modelo anterior de cuotas. Se conserva tal como está.</p><ul>{legacyRights.filter((right) => right.rightType !== 'service_access').map((right, index) => <li key={index}>{legacyRightLine(right, serviceNameOf)}</li>)}</ul></div>}
        {recurringBlocked && <div className="plan-notice" id="plan-blocked-note" role="status"><strong>El nuevo modelo de cuotas recurrentes se habilitará con 2J-098E.</strong><span>La generación de bolsas de sesiones todavía no está implementada, así que de momento no se puede guardar un plan recurrente nuevo.</span></div>}
      </fieldset>
      <fieldset className="plan-block"><legend>Accesos</legend><p className="field-note">Elige qué partes de la plataforma incluye este plan.</p>{(['reservations','training','nutrition','health'] as const).map((module)=>{const access=moduleAccesses.find(item=>item.module===module);return <div className="module-access-editor" key={module}><label className="check-option"><input type="checkbox" checked={Boolean(access)} onChange={(event)=>setModuleAccesses(current=>event.target.checked?[...current,{module,accessLevel:'full',capabilities:[]}]:current.filter(item=>item.module!==module))}/><span><strong>{moduleLabel[module]}</strong><small>{module==='training'||module==='health'?'El módulo mantiene sus propios datos.':module==='reservations'?'Reservar y gestionar sesiones.':'Acceso del ecosistema 2J.'}</small></span></label>{access&&<label>Acceso a {module==='training'?'Búnker':moduleLabel[module]}<select value={access.accessLevel} onChange={(event)=>setModuleAccesses(current=>current.map(item=>item.module===module?{...item,accessLevel:event.target.value as 'limited'|'full'}:item))}><option value="limited">Limitado</option><option value="full">Completo</option></select></label>}</div>})}</fieldset>
      {kind && <fieldset className="plan-block"><legend>Vigencia</legend>
        {kind === 'recurring' && legacyRights === null && <><label>Tipo de vigencia<select value={cadence} onChange={(event) => setCadence(event.target.value)}><option value="monthly">Mensual natural</option><option value="weekly">Semanal</option><option value="custom_period">Periodo personalizado</option></select></label>{cadence === 'custom_period' && <label>Duración de cada periodo (días)<input required type="number" min="1" max="3660" value={periodDays} onChange={(event) => setPeriodDays(event.target.value)}/></label>}</>}
        {kind === 'recurring' && legacyRights !== null && <p className="plan-readout">{cadenceShortLabel(cadence, Number(periodDays) || null)}</p>}
        {kind === 'session_pack' && legacyRights === null && <><label>Vigencia del bono (días), opcional<span className="input-suffix"><input type="number" min="1" max="3660" placeholder="Sin caducidad" value={packValidDays} onChange={(event) => setPackValidDays(event.target.value)}/><span>días</span></span></label>{packValidDays && <label>Inicio de vigencia<select value={packStartRule} onChange={(event) => setPackStartRule(event.target.value as 'purchase' | 'first_use')}><option value="purchase">En la compra</option><option value="first_use">En el primer uso</option></select></label>}</>}
        {kind === 'session_pack' && legacyRights !== null && <p className="plan-readout">Sin renovación</p>}
      </fieldset>}
      {kind && <div className="plan-preview"><span>Resumen del plan</span><p>{planSummary || 'Completa los datos para ver el resumen.'}</p></div>}
      {saveError && <div className="ui-form-error" role="alert">{saveError}</div>}<div className="ui-modal-actions"><button type="button" className="ui-button ui-button--secondary" onClick={closeDialog}>Cancelar</button><button className="ui-button ui-button--primary" disabled={!canSavePlan} aria-describedby={recurringBlocked ? 'plan-blocked-note' : undefined}>{saving?'Guardando…':editingPlanId?'Guardar nueva versión':'Crear borrador'}</button></div>
    </form></Dialog>}
  </main>;
}
