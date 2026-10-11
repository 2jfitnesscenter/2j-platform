import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { describePlan, kindLabel, periodLabel, rightLabel, statusLabel } from './product-copy.js';

type Area = { id: string; name: string };
type Service = { id: string; name: string; area: string; areaId: string; status: 'active' | 'draft'; planCount: number; rightCount: number; updatedAt: string };
type Right = { id: string; rightType: string; serviceId: string | null; quotaScope: 'shared' | 'per_service' | null; quantity: number | null; period: string | null; periodMode: 'calendar' | 'rolling' | null; timezone: string | null; validDays: number | null; validDaysStartRule: 'purchase' | 'first_use' | null };
type Module = {module:'reservations'|'training'|'nutrition'|'health';accessLevel:'limited'|'full';capabilities:string[]};
type Plan = { id: string; name: string; kind: 'recurring' | 'session_pack'; renewalCadence: string | null; periodDays: number | null; status: 'active' | 'draft' | 'archived'; basePriceCents?:number|null; modules?:Module[]; services: { id: string; name: string; area: string }[]; rights: Right[] };
type RightDraft = { rightType: 'service_access' | 'sessions_quota' | 'period_quota'; serviceId: string; quotaScope: 'shared' | 'per_service'; quantity: string; period: 'week' | 'month' | 'plan_period'; periodMode: 'calendar' | 'rolling' | null; validDays: string; validDaysStartRule: 'purchase' | 'first_use' };
const apiUrl = import.meta.env?.VITE_API_URL ?? 'http://127.0.0.1:3100';

function Icon({ name, size = 18 }: { name: 'grid' | 'search' | 'plus' | 'arrow' | 'close' | 'layers' | 'shield' | 'chevron'; size?: number }) {
  const paths: Record<typeof name, React.ReactNode> = {
    grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></>,
    search: <><circle cx="10.8" cy="10.8" r="6.3"/><path d="m15.4 15.4 4.1 4.1"/></>, plus: <path d="M12 5v14M5 12h14"/>, arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>, close: <path d="m6 6 12 12M18 6 6 18"/>, layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>, shield: <><path d="M12 3 19 6v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3Z"/><path d="m9 12 2 2 4-4"/></>, chevron: <path d="m9 18 6-6-6-6"/>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

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
  return <div className="backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialogRef} className={`dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}><button className="icon-button dialog-close" aria-label="Cerrar diálogo" onClick={onClose}><Icon name="close"/></button>{children}</section></div>;
}

function emptyRight(serviceId: string): RightDraft {
  return { rightType: 'service_access', serviceId, quotaScope: 'shared', quantity: '', period: 'month', periodMode: 'calendar', validDays: '', validDaysStartRule: 'purchase' };
}

export function ServicesPage() {
  const [areas, setAreas] = useState<Area[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [query, setQuery] = useState('');
  const [areaFilter, setAreaFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [areaError, setAreaError] = useState('');
  const [dialog, setDialog] = useState<'service' | 'plan' | null>(null);
  const dialogOpener = useRef<HTMLElement | null>(null);
  const planIdempotencyKey = useRef<string | null>(null);
  const detailPanel = useRef<HTMLElement>(null);
  const [name, setName] = useState('');
  const [serviceAreaId, setServiceAreaId] = useState('');
  const [serviceStatus, setServiceStatus] = useState<Service['status'] | ''>('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansState, setPlansState] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle');
  const [plansError, setPlansError] = useState('');
  const [activatingPlanId, setActivatingPlanId] = useState<string | null>(null);
  const [planActionFeedback, setPlanActionFeedback] = useState('');
  const [planName, setPlanName] = useState('');
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [kind, setKind] = useState<Plan['kind'] | ''>('');
  const [cadence, setCadence] = useState('');
  const [periodDays, setPeriodDays] = useState('');
  const [rights, setRights] = useState<RightDraft[]>([]);
  const [basePrice, setBasePrice] = useState('');
  const [moduleAccesses,setModuleAccesses]=useState<Module[]>([]);
  const [editingPlanId,setEditingPlanId]=useState<string|null>(null);

  const selected = services.find((service) => service.id === selectedId) ?? null;
  const visible = useMemo(() => services.filter((item) => item.name.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')) && (areaFilter === 'all' || item.areaId === areaFilter)), [services, query, areaFilter]);

  async function refreshAreas() {
    try { const response = await fetch(`${apiUrl}/api/areas`); if (!response.ok) throw new Error(); const rows = await response.json() as Area[]; setAreas(rows); if (!serviceAreaId && rows[0]) setServiceAreaId(rows[0].id); }
    catch { setAreaError('No se pudieron cargar las áreas del centro.'); }
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
    setPlansState('loading'); setPlansError('');
    try {
      const response = await fetch(`${apiUrl}/api/services/${serviceId}/plans`);
      if (!response.ok) throw new Error();
      const rows = await response.json() as Plan[]; setPlans(rows); setPlansState('ready');
    } catch { setPlans([]); setPlansError('No se pudieron cargar los planes de este servicio.'); setPlansState('error'); }
  }
  async function activatePlan(plan: Plan) {
    if (plan.status !== 'draft' || activatingPlanId || !selectedId) return;
    if (!window.confirm('Al activar el plan, esta versión quedará disponible para asignarla a clientes.')) return;
    setActivatingPlanId(plan.id); setPlanActionFeedback('');
    try {
      const response = await fetch(`${apiUrl}/api/plans/${plan.id}/activate`, { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? ({ service_not_active: 'Activa todos los servicios incluidos antes de activar este plan.', plan_not_found: 'No se encontró el plan.' } as Record<string, string>)[body.error] ?? 'No se pudo activar el plan.');
      setPlanActionFeedback('Plan activado y disponible para asignarlo a clientes.');
      await loadPlans(selectedId);
    } catch (cause) { setPlanActionFeedback(cause instanceof Error ? cause.message : 'No se pudo activar el plan.'); }
    finally { setActivatingPlanId(null); }
  }
  useEffect(() => { void refreshAreas(); void refreshServices(); }, []);
  useEffect(() => { if (selectedId) void loadPlans(selectedId); else { setPlans([]); setPlansState('idle'); } }, [selectedId]);

  function openServiceDialog(event?: React.MouseEvent<HTMLButtonElement>) { dialogOpener.current = event?.currentTarget ?? document.activeElement as HTMLElement; setSaveError(''); setDialog('service'); }
  function openPlanDialog(event?: React.MouseEvent<HTMLButtonElement>) {
    if (!selected) return;
    dialogOpener.current = event?.currentTarget ?? document.activeElement as HTMLElement;
    planIdempotencyKey.current = crypto.randomUUID();
    setSaveError(''); setEditingPlanId(null);setPlanName(''); setKind(''); setCadence(''); setPeriodDays(''); setServiceIds([selected.id]); setRights([emptyRight(selected.id)]);setBasePrice('');setModuleAccesses([]); setDialog('plan');
  }
  function openVersionDialog(plan:Plan,event:React.MouseEvent<HTMLButtonElement>){dialogOpener.current=event.currentTarget;planIdempotencyKey.current=crypto.randomUUID();setEditingPlanId(plan.id);setSaveError('');setPlanName(plan.name);setKind(plan.kind);setCadence(plan.renewalCadence??'');setPeriodDays(plan.periodDays?String(plan.periodDays):'');setServiceIds(plan.services.map(item=>item.id));setRights(plan.rights.map(right=>({rightType:right.rightType as RightDraft['rightType'],serviceId:right.serviceId??'',quotaScope:right.quotaScope??'shared',quantity:right.quantity?String(right.quantity):'',period:(right.period??'month') as RightDraft['period'],periodMode:right.periodMode??'calendar',validDays:right.validDays?String(right.validDays):'',validDaysStartRule:right.validDaysStartRule??'purchase'})));setBasePrice(plan.basePriceCents==null?'':(plan.basePriceCents/100).toFixed(2));setModuleAccesses(plan.modules??[]);setDialog('plan');}
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
  async function createPlan(event: React.FormEvent) {
    event.preventDefault(); if (!planName.trim() || !kind || !serviceIds.length || rights.some((right) => right.rightType !== 'service_access' && !right.quantity)) return;
    setSaving(true); setSaveError('');
    const amount=basePrice.trim()?Number(basePrice.replace(',','.')):null;
    if(amount!==null&&(!Number.isFinite(amount)||amount<0||amount>1_000_000_000))return;
    const body = { name: planName.trim(), serviceIds, kind, basePriceCents:amount===null?null:Math.round(amount*100),modules:moduleAccesses, ...(kind === 'recurring' ? { renewalCadence: cadence, ...(cadence === 'custom_period' ? { periodDays: Number(periodDays) } : {}) } : {}), rights: rights.map(toRightPayload) };
    try {
      const response = await fetch(`${apiUrl}/api/plans${editingPlanId?`/${editingPlanId}/versions`:''}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': planIdempotencyKey.current ?? crypto.randomUUID() }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message ?? (result.error === 'conflict' ? 'Ya existe un plan con ese nombre.' : 'No se pudo guardar el plan.'));
      const planServiceIds = (result.services as Plan['services'] | undefined)?.map((item) => item.id) ?? [];
      const serviceId = selectedId && planServiceIds.includes(selectedId) ? selectedId : planServiceIds[0] ?? selectedId;
      const [rows] = await Promise.all([refreshServices(), serviceId ? loadPlans(serviceId) : Promise.resolve()]);
      if (rows && serviceId) setSelectedId(rows.find((item) => item.id === serviceId)?.id ?? null);
      setDialog(null);
      planIdempotencyKey.current = null;
      setEditingPlanId(null);
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : 'No se pudo guardar el plan.'); }
    finally { setSaving(false); }
  }
  function updateRight(index: number, patch: Partial<RightDraft>) { setRights((items) => items.map((item, position) => position === index ? { ...item, ...patch } : item)); }
  function togglePlanService(serviceId: string, checked: boolean) {
    setServiceIds((current) => checked ? [...current, serviceId] : current.filter((id) => id !== serviceId));
    if (!checked) setRights((items) => items.map((right) => right.serviceId === serviceId ? { ...right, serviceId: '' } : right));
  }
  function closeDialog() { if (!saving) { setDialog(null); setSaveError(''); } }
  function selectService(serviceId: string) { setSelectedId(serviceId); if (window.matchMedia('(max-width: 959px)').matches) requestAnimationFrame(() => { detailPanel.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); detailPanel.current?.focus({ preventScroll: true }); }); }
  const summaryPlan = kind ? { kind, renewalCadence: kind === 'recurring' ? cadence || null : null, periodDays: cadence === 'custom_period' ? Number(periodDays) || null : null, rights: rights.map((right) => ({ rightType: right.rightType, serviceId: right.rightType !== 'service_access' && right.quotaScope === 'shared' ? null : right.serviceId || null, quotaScope: right.quotaScope, quantity: Number(right.quantity) || null, period: right.period, periodMode: right.periodMode })) } as Pick<Plan, 'kind' | 'renewalCadence' | 'periodDays' | 'rights'> : null;
  const missingSessionPackQuota = kind === 'session_pack' && !rights.some((right) => right.rightType === 'sessions_quota');
  const incompleteRights = rights.some((right) => (right.rightType === 'service_access' && !right.serviceId) || (right.rightType !== 'service_access' && !right.quantity) || (right.quotaScope === 'per_service' && !right.serviceId));

  return <div className="shell">
    <aside className="sidebar"><a className="brand" href="#services" aria-label="2J Platform, inicio"><span className="brand-mark">2J</span><span className="brand-copy">FITNESS CENTER<small>OPERACIONES</small></span></a><div className="nav-label">GESTIÓN</div><nav aria-label="Gestión"><a className="nav-item active" href="#services" aria-current="page"><Icon name="grid"/> Servicios y planes</a><a className="nav-item" href="#clients">Clientes</a><a className="nav-item" href="#calendar">Calendario</a><a className="nav-item" href="#economics">Pagos</a><a className="nav-item" href="#staff">Equipo</a><a className="nav-item" href="#communications">Comunicación</a></nav></aside>
    <main className="main" id="services"><header className="topbar"><div className="crumb">Gestión <Icon name="chevron" size={14}/> Servicios y planes</div><div className="local-pill"><span className="status-dot"/> Entorno local</div></header>
      <section className="page-heading"><div><div className="eyebrow">CATÁLOGO DEL CENTRO</div><h1>Servicios y planes</h1><p>Organiza la oferta y define con claridad qué incluye cada plan.</p></div><button className="button primary" onClick={openServiceDialog}><Icon name="plus"/> Nuevo servicio</button></section>
      <section className="catalog" aria-label="Catálogo de servicios">
        <div className="panel service-panel"><div className="panel-heading"><div><h2>Servicios</h2><p>Selecciona uno para revisar sus planes y derechos.</p></div><span className="count">{visible.length} {visible.length === 1 ? 'servicio' : 'servicios'}</span></div>
          <div className="toolbar"><label className="search"><Icon name="search" size={17}/><span className="sr-only">Buscar servicio</span><input aria-label="Buscar servicio" placeholder="Buscar servicio" value={query} onChange={(event) => setQuery(event.target.value)}/></label><label className="filter-label"><span>Área</span><select aria-label="Filtrar por área" value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}><option value="all">Todas</option>{areas.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
          {error ? <div className="state-panel error-panel" role="alert"><strong>No se pudo cargar el catálogo</strong><span>{error}</span><button className="button secondary" onClick={() => void refreshServices()}>Reintentar</button></div> : loading ? <div className="state-panel" role="status"><span className="spinner"/><span>Cargando servicios…</span></div> : visible.length === 0 ? <div className="state-panel"><span className="state-icon"><Icon name="layers" size={22}/></span><strong>{services.length ? 'Sin resultados' : 'Aún no hay servicios'}</strong><span>{services.length ? 'Prueba con otro nombre o área.' : 'Crea el primer servicio para preparar el catálogo.'}</span>{!services.length && <button className="button secondary" onClick={openServiceDialog}>Crear servicio</button>}</div> : <>
            <div className="desktop-list"><table><thead><tr><th>Servicio</th><th>Área</th><th>Planes</th><th>Estado</th></tr></thead><tbody>{visible.map((item) => <tr key={item.id} className={item.id === selectedId ? 'selected-row' : ''}><td><button className="service-select" aria-pressed={item.id === selectedId} aria-controls="service-detail" onClick={() => selectService(item.id)}><span className="service-mark"><Icon name="grid" size={16}/></span><span>{item.name}</span></button></td><td>{item.area}</td><td>{item.planCount}</td><td><span className={`badge ${item.status}`}>{statusLabel[item.status]}</span></td></tr>)}</tbody></table></div>
            <div className="mobile-list">{visible.map((item) => <button key={item.id} className={`service-card ${item.id === selectedId ? 'selected' : ''}`} aria-pressed={item.id === selectedId} aria-controls="service-detail" onClick={() => selectService(item.id)}><span className="service-mark"><Icon name="grid" size={16}/></span><span className="mobile-card-copy"><strong>{item.name}</strong><span>{item.area} · {item.planCount} {item.planCount === 1 ? 'plan' : 'planes'}</span></span><span className={`badge ${item.status}`}>{statusLabel[item.status]}</span></button>)}</div>
          </>}
        </div>
        <section ref={detailPanel} className="panel detail-panel" id="service-detail" tabIndex={-1} aria-live="polite">{selected ? <><div className="detail-heading"><div><div className="eyebrow">{selected.area}</div><h2>{selected.name}</h2><p>Planes asociados y derechos incluidos.</p></div><button className="button secondary" onClick={openPlanDialog}><Icon name="plus"/> Nuevo plan</button></div>
          <div className="plan-content">{planActionFeedback && <p className="form-note" role="status">{planActionFeedback}</p>}{plansState === 'loading' ? <div className="detail-state" role="status"><span className="spinner"/> Cargando planes…</div> : plansState === 'error' ? <div className="detail-state detail-error" role="alert"><strong>No se pudieron cargar los planes</strong><span>{plansError}</span><button className="button secondary" onClick={() => void loadPlans(selected.id)}>Reintentar</button></div> : plans.length === 0 ? <div className="detail-state"><span className="state-icon"><Icon name="layers" size={20}/></span><strong>Aún no hay planes</strong><span>Los planes reúnen servicios y derechos en una definición versionada.</span><button className="button primary" onClick={openPlanDialog}>Crear primer plan</button></div> : <div className="plan-list">{plans.map((plan) => <article className="plan-card" key={plan.id}><div className="plan-card-heading"><div><span className="plan-kind">{kindLabel[plan.kind]}</span><h3>{plan.name}</h3></div><span className={`badge ${plan.status}`}>{statusLabel[plan.status]}</span></div>{plan.basePriceCents!=null&&<div className="plan-catalog-price">Precio base · {new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(plan.basePriceCents/100)}</div>}<div className="associated-services" aria-label="Servicios incluidos">{plan.services.map((item) => <span className="service-chip" key={item.id}>{item.name}<span>{item.area}</span></span>)}</div><div className="rights-block"><div className="rights-title"><Icon name="shield" size={16}/> Derechos</div><ul>{plan.rights.map((right) => <li key={right.id}><span>{rightLabel[right.rightType] ?? 'Derecho'}</span><strong>{right.rightType === 'service_access' ? right.serviceId ? plan.services.find((service) => service.id === right.serviceId)?.name ?? 'Servicio' : 'Destino sin especificar' : right.rightType === 'sessions_quota' ? right.quotaScope === 'shared' ? `${right.quantity} sesiones compartidas` : `${right.quantity} sesiones para ${plan.services.find((service) => service.id === right.serviceId)?.name ?? 'el servicio seleccionado'}` : `${right.quantity} accesos / ${periodLabel[right.period ?? ''] ?? 'periodo'}${right.period === 'plan_period' ? ' del plan' : ` · ${right.periodMode === 'calendar' ? 'calendario' : 'móvil'}`}${right.quotaScope === 'per_service' ? ` · ${plan.services.find((service) => service.id === right.serviceId)?.name ?? 'servicio'}` : ''}`}</strong>{right.validDays && <small>Caduca {right.validDays} días desde {right.validDaysStartRule === 'purchase' ? 'la compra' : 'el primer uso'}</small>}</li>)}</ul></div>{Boolean(plan.modules?.length)&&<div className="rights-block module-rights"><div className="rights-title"><Icon name="layers" size={16}/> Accesos a módulos</div><ul>{plan.modules?.map(access=><li key={access.module}><span>{{reservations:'Reservas',training:'Training',nutrition:'Nutrición',health:'Health'}[access.module]}</span><strong>{access.accessLevel==='full'?'Completo':'Limitado'}{access.capabilities.length?` · ${access.capabilities.length} capacidades`:''}</strong></li>)}</ul></div>}{plan.status==='draft'&&<button className="button primary" disabled={activatingPlanId!==null} onClick={()=>void activatePlan(plan)}>{activatingPlanId===plan.id?'Activando…':'Activar plan'}</button>}{plan.status!=='archived'&&<button className="button secondary catalog-version-button" onClick={(event)=>openVersionDialog(plan,event)}>Crear nueva versión</button>}</article>)}</div>}</div>
        </> : <div className="detail-state detail-placeholder"><span className="state-icon"><Icon name="layers" size={21}/></span><strong>Elige un servicio</strong><span>Su información y planes aparecerán aquí.</span></div>}</section>
      </section>
      <footer className="footer-note">2J Platform <span>·</span> Catálogo de servicios</footer>
    </main>

    {dialog === 'service' && <Dialog titleId="service-dialog-title" onClose={closeDialog} opener={dialogOpener.current}><div className="eyebrow">CATÁLOGO</div><h2 id="service-dialog-title">Nuevo servicio</h2><p>Añade una actividad disponible en un área del centro.</p><form onSubmit={createService}><label>Nombre<input data-dialog-initial-focus required maxLength={100} placeholder="Ej. Entrenamiento personal" value={name} onChange={(event) => setName(event.target.value)}/></label><label>Área<select required value={serviceAreaId} onChange={(event) => setServiceAreaId(event.target.value)}>{!areas.length && <option value="">{areaError || 'Cargando áreas…'}</option>}{areas.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{areaError && <small className="field-error">{areaError}</small>}</label><label>Estado<select required value={serviceStatus} onChange={(event) => setServiceStatus(event.target.value as Service['status'] | '')}><option value="">Selecciona un estado</option><option value="draft">Borrador</option><option value="active">Activo</option></select></label>{saveError && <div className="form-error" role="alert">{saveError}</div>}<div className="dialog-actions"><button type="button" className="button secondary" onClick={closeDialog}>Cancelar</button><button className="button primary" disabled={saving || !areas.length}>{saving ? 'Guardando…' : 'Crear servicio'}</button></div></form></Dialog>}
    {dialog === 'plan' && selected && <Dialog titleId="plan-dialog-title" onClose={closeDialog} opener={dialogOpener.current} className="plan-dialog"><div className="eyebrow">DEFINICIÓN DEL PLAN</div><h2 id="plan-dialog-title">{editingPlanId?'Nueva versión de plan':'Nuevo plan'}</h2><p>{editingPlanId?'Los cambios se guardan como una nueva versión y conservan intactas las asignaciones existentes.':'Se guardará como borrador con derechos, módulos y precio de catálogo opcional.'}</p><form onSubmit={createPlan}>
      <label>Nombre del plan<input autoFocus data-dialog-initial-focus required maxLength={100} placeholder="Ej. Funcional 3 días" value={planName} onChange={(event) => setPlanName(event.target.value)}/></label>
      <label>Precio base (€), opcional<input inputMode="decimal" placeholder="Sin precio definido" value={basePrice} onChange={(event)=>setBasePrice(event.target.value)}/><small className="field-note">Precio de catálogo informativo. El precio realmente vendido se congela en cada asignación.</small></label>
      <fieldset><legend>Servicios incluidos</legend><div className="service-options">{services.filter((item) => item.status === 'active' || item.id === selected.id).map((item) => <label className="check-option" key={item.id}><input type="checkbox" checked={serviceIds.includes(item.id)} onChange={(event) => togglePlanService(item.id, event.target.checked)}/><span><strong>{item.name}</strong><small>{item.area}{item.status === 'draft' ? ' · Borrador' : ''}</small></span></label>)}</div>{selected.status === 'draft' && serviceIds.includes(selected.id) && <p className="field-note">Este servicio está en borrador. El plan también seguirá en borrador hasta que todos sus servicios estén activos.</p>}{!serviceIds.length && <p className="field-note" role="status">Selecciona al menos un servicio para continuar.</p>}</fieldset>
      <label>Tipo de producto<select required value={kind} onChange={(event) => { const nextKind = event.target.value as Plan['kind'] | ''; setKind(nextKind); if (nextKind === 'session_pack') { setCadence(''); setRights((current) => [{ ...current[0] ?? emptyRight(selected.id), rightType: 'sessions_quota', quotaScope: 'shared', quantity: '' }]); } }}><option value="">Selecciona el tipo</option><option value="recurring">Plan recurrente</option><option value="session_pack">Bono de sesiones</option></select></label>
      {kind === 'recurring' && <><label>Renovación<select required value={cadence} onChange={(event) => setCadence(event.target.value)}><option value="">Selecciona la renovación</option><option value="weekly">Cada semana</option><option value="monthly">Cada mes</option><option value="custom_period">Periodo personalizado</option></select></label>{cadence === 'custom_period' && <label>Duración de cada periodo (días)<input required type="number" min="1" max="3660" value={periodDays} onChange={(event) => setPeriodDays(event.target.value)}/></label>}</>}
      <fieldset><legend>Derechos incluidos</legend>{rights.map((right, index) => <div className="right-editor" key={index}><div className="right-editor-heading"><strong>Derecho {index + 1}</strong>{rights.length > 1 && <button type="button" className="text-button" onClick={() => setRights((items) => items.filter((_, position) => position !== index))}>Quitar</button>}</div><label>Qué incluye<select value={right.rightType} onChange={(event) => updateRight(index, { rightType: event.target.value as RightDraft['rightType'] })}><option value="service_access">Acceso a un servicio</option><option value="sessions_quota">Límite de sesiones</option>{kind !== 'session_pack' && <option value="period_quota">Cuota por periodo</option>}</select></label>{(right.rightType === 'service_access' || right.quotaScope === 'per_service') && <label>{right.rightType === 'service_access' ? 'Servicio de acceso' : 'Servicio de destino'}<select required={right.rightType === 'service_access' || right.quotaScope === 'per_service'} value={right.serviceId} onChange={(event) => updateRight(index, { serviceId: event.target.value })}><option value="">Selecciona un servicio del plan</option>{services.filter((item) => serviceIds.includes(item.id)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}{right.rightType !== 'service_access' && right.quotaScope === 'shared' && <p className="field-note">Una bolsa compartida para todos los servicios incluidos.</p>}
        {right.rightType !== 'service_access' && <><label>Alcance de la cuota<select value={right.quotaScope} onChange={(event) => { const scope = event.target.value as RightDraft['quotaScope']; updateRight(index, { quotaScope: scope, serviceId: scope === 'shared' ? '' : serviceIds.includes(right.serviceId) ? right.serviceId : serviceIds[0] ?? '' }); }}><option value="shared">Una cuota compartida</option><option value="per_service">Esta cantidad por servicio</option></select></label><label>{right.rightType === 'sessions_quota' ? 'Número de sesiones' : 'Número de accesos'}<input required type="number" min="1" max="100000" value={right.quantity} onChange={(event) => updateRight(index, { quantity: event.target.value })}/></label></>}
        {right.rightType === 'period_quota' && <><label>Periodo<select value={right.period} onChange={(event) => updateRight(index, { period: event.target.value as RightDraft['period'], periodMode: event.target.value === 'plan_period' ? null : right.periodMode ?? 'calendar' })}><option value="week">Semana</option><option value="month">Mes</option><option value="plan_period">Periodo de renovación del plan</option></select></label>{right.period !== 'plan_period' && <><label>Cómo se cuenta<select value={right.periodMode ?? 'calendar'} onChange={(event) => updateRight(index, { periodMode: event.target.value as RightDraft['periodMode'] })}><option value="calendar">Periodo de calendario</option><option value="rolling">Periodo móvil</option></select></label><p className="field-note">Los periodos siguen la hora local del centro.</p></>}</>}
        <label>Caducidad adicional (opcional)<span className="input-suffix"><input type="number" min="1" max="3660" placeholder="Sin caducidad" value={right.validDays} onChange={(event) => updateRight(index, { validDays: event.target.value })}/><span>días</span></span></label>{right.validDays && <label>La caducidad empieza<select value={right.validDaysStartRule} onChange={(event) => updateRight(index, { validDaysStartRule: event.target.value as RightDraft['validDaysStartRule'] })}><option value="purchase">En la compra</option><option value="first_use">En el primer uso</option></select></label>}</div>)}<button type="button" className="text-button add-right" onClick={() => setRights((items) => [...items, emptyRight(selected.id)])}><Icon name="plus" size={15}/> Añadir otro derecho</button></fieldset>
      <fieldset><legend>Accesos a módulos</legend><p className="field-note">Se guardan como derechos del producto. Training y Health conservan sus sistemas actuales; aquí solo se concede el acceso.</p>{(['reservations','training','nutrition','health'] as const).map((module)=>{const access=moduleAccesses.find(item=>item.module===module);return <div className="module-access-editor" key={module}><label className="check-option"><input type="checkbox" checked={Boolean(access)} onChange={(event)=>setModuleAccesses(current=>event.target.checked?[...current,{module,accessLevel:'full',capabilities:[]}]:current.filter(item=>item.module!==module))}/><span><strong>{{reservations:'Reservas',training:'Training',nutrition:'Nutrición',health:'Health'}[module]}</strong><small>{module==='training'||module==='health'?'El módulo mantiene sus propios datos.':'Acceso del ecosistema 2J.'}</small></span></label>{access&&<label>Nivel de acceso<select value={access.accessLevel} onChange={(event)=>setModuleAccesses(current=>current.map(item=>item.module===module?{...item,accessLevel:event.target.value as 'limited'|'full'}:item))}><option value="limited">Limitado</option><option value="full">Completo</option></select></label>}</div>})}</fieldset>
      {missingSessionPackQuota && <p className="field-note" role="status">Un bono de sesiones debe incluir una cantidad concreta de sesiones.</p>}{summaryPlan && <div className="plan-preview"><span>Resumen del plan</span><p>{describePlan(summaryPlan)}</p></div>}
      {saveError && <div className="form-error" role="alert">{saveError}</div>}<div className="dialog-actions"><button type="button" className="button secondary" onClick={closeDialog}>Cancelar</button><button className="button primary" disabled={saving || !serviceIds.length || !kind || missingSessionPackQuota || incompleteRights || (kind === 'recurring' && !cadence) || (cadence === 'custom_period' && !periodDays)}>{saving?'Guardando…':editingPlanId?'Guardar nueva versión':'Crear borrador'}</button></div>
    </form></Dialog>}
  </div>;
}
