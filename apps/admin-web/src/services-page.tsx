import { useEffect, useMemo, useState } from 'react';

type Service = { id: string; name: string; area: string; status: 'active' | 'draft'; planCount: number; entitlementCount: number; updatedAt: string };
type Plan = { id: string; name: string; billingCadence: string; priceMinor: number | null; status: string; rights: { id: string; rightType: string; quantity: number | null; period: string | null }[] };
const apiUrl = import.meta.env?.VITE_API_URL ?? 'http://127.0.0.1:3100';
function describeRight(right: Plan['rights'][number]) {
  if (right.rightType === 'service_access') return 'Acceso al servicio';
  if (!right.period) return `${right.quantity} sesiones incluidas`;
  const periods: Record<string, string> = { week: 'semana', month: 'mes', plan_period: 'duración del plan' };
  return `${right.quantity} accesos/${periods[right.period] ?? right.period}`;
}

export function ServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [query, setQuery] = useState('');
  const [area, setArea] = useState('Todas las áreas');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(false);
  const [name, setName] = useState('');
  const [serviceArea, setServiceArea] = useState('La Sala');
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Service | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planDialog, setPlanDialog] = useState(false);
  const [planName, setPlanName] = useState('');
  const [quota, setQuota] = useState('');
  const [cadence, setCadence] = useState('');
  const [rightType, setRightType] = useState('');
  const [rightPeriod, setRightPeriod] = useState('');

  async function refresh() {
    setLoading(true); setError('');
    try { const response = await fetch(`${apiUrl}/api/services`); if (!response.ok) throw new Error('No se pudieron cargar los servicios.'); setServices(await response.json() as Service[]); }
    catch { setError('No hay conexión con la API local. Comprueba que la base de datos y el servidor estén iniciados.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => { if (!selected) { setPlans([]); return; } void fetch(`${apiUrl}/api/services/${selected.id}/plans`).then((response) => response.ok ? response.json() as Promise<Plan[]> : []).then(setPlans).catch(() => setPlans([])); }, [selected]);
  const areas = useMemo(() => ['Todas las áreas', ...new Set(services.map((item) => item.area))], [services]);
  const visible = services.filter((item) => item.name.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')) && (area === 'Todas las áreas' || item.area === area));

  async function createService(event: React.FormEvent) {
    event.preventDefault(); if (!name.trim()) return; setSaving(true);
    try { const response = await fetch(`${apiUrl}/api/services`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name.trim(), area: serviceArea }) }); if (!response.ok) throw new Error(); setName(''); setDialog(false); await refresh(); }
    catch { setError('No se pudo guardar el servicio. Revisa el servidor e inténtalo de nuevo.'); }
    finally { setSaving(false); }
  }
  async function createPlan(event: React.FormEvent) {
    event.preventDefault(); if (!selected || !planName.trim()) return; setSaving(true);
    const count = Number(quota);
    const rights = rightType === 'service_access' ? [{ rightType }] : [{ rightType, quantity: count, ...(rightType === 'period_quota' ? { period: rightPeriod } : {}) }];
    try { const response = await fetch(`${apiUrl}/api/services/${selected.id}/plans`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: planName.trim(), billingCadence: cadence, rights }) }); if (!response.ok) throw new Error(); setPlanDialog(false); setPlanName(''); setQuota(''); setCadence(''); setRightType(''); setRightPeriod(''); await refresh(); }
    catch { setError('No se pudo guardar el plan. Revisa el servidor e inténtalo de nuevo.'); }
    finally { setSaving(false); }
  }

  return <div className="shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark">2J</span><span>FITNESS CENTER<small>OPERACIONES</small></span></div><div className="nav-label">GESTIÓN</div><nav><a className="nav-item active" href="#services"><span>◈</span> Servicios y planes</a><a className="nav-item muted" href="#clients" aria-disabled="true"><span>◎</span> Clientes <em>Próximamente</em></a><a className="nav-item muted" href="#calendar" aria-disabled="true"><span>▦</span> Calendario <em>Próximamente</em></a></nav><div className="sidebar-footer"><span className="status-dot"/> Entorno local <small>Sin conexión a producción</small></div></aside>
    <main className="main" id="services"><header className="topbar"><div className="crumb">Gestión <span>/</span> Servicios y planes</div><div className="local-pill"><span className="status-dot"/> Local</div></header>
      <section className="page-heading"><div><div className="eyebrow">CONFIGURACIÓN DEL NEGOCIO</div><h1>Servicios y planes</h1><p>Define qué ofrece el centro y qué derechos incluye cada plan.</p></div><button className="button primary" onClick={() => setDialog(true)}><span aria-hidden="true">＋</span> Nuevo servicio</button></section>
      <section className="metric-row" aria-label="Resumen"><article className="metric"><span className="metric-icon green">◈</span><div><small>SERVICIOS ACTIVOS</small><strong>{services.filter((item) => item.status === 'active').length}</strong></div></article><article className="metric"><span className="metric-icon">▤</span><div><small>PLANES CONFIGURADOS</small><strong>{services.reduce((sum, item) => sum + item.planCount, 0)}</strong></div></article><article className="metric"><span className="metric-icon">◇</span><div><small>DERECHOS DEFINIDOS</small><strong>{services.reduce((sum, item) => sum + item.entitlementCount, 0)}</strong></div></article><div className="metric-note"><span>ⓘ</span> Los derechos no gestionan cobros ni renovaciones automáticas.</div></section>
      <section className="panel"><div className="panel-heading"><div><h2>Catálogo de servicios</h2><p>Servicios disponibles para configurar planes y derechos.</p></div><span className="count">{visible.length} {visible.length === 1 ? 'servicio' : 'servicios'}</span></div>
        <div className="toolbar"><label className="search"><span>⌕</span><input aria-label="Buscar servicio" placeholder="Buscar servicio..." value={query} onChange={(event) => setQuery(event.target.value)}/></label><label className="filter-label"><span>Área</span><select value={area} onChange={(event) => setArea(event.target.value)}>{areas.map((item) => <option key={item}>{item}</option>)}</select></label></div>
        {error && <div className="notice error" role="alert">{error}<button className="link-button" onClick={() => void refresh()}>Reintentar</button></div>}
        {loading ? <div className="empty"><span className="spinner"/> Cargando catálogo…</div> : !error && visible.length === 0 ? <div className="empty"><span className="empty-icon">◈</span><strong>{services.length === 0 ? 'Empieza por crear un servicio' : 'No hay resultados'}</strong><span>{services.length === 0 ? 'Los servicios organizan la oferta del centro y sus derechos.' : 'Prueba con otro nombre o área.'}</span>{services.length === 0 && <button className="button secondary" onClick={() => setDialog(true)}>Crear primer servicio</button>}</div> : <div className="table-wrap"><table><thead><tr><th>SERVICIO</th><th>ÁREA</th><th>PLANES</th><th>DERECHOS</th><th>ESTADO</th><th>ACTUALIZADO</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>{visible.map((item) => <tr key={item.id}><td><div className="service-cell"><span className="service-icon">◈</span><button className="service-link" onClick={() => setSelected(item)}>{item.name}</button></div></td><td>{item.area}</td><td>{item.planCount}</td><td>{item.entitlementCount}</td><td><span className={`badge ${item.status}`}>{item.status === 'active' ? 'Activo' : 'Borrador'}</span></td><td className="date">{new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(item.updatedAt))}</td><td><button className="more" aria-label={`Más opciones para ${item.name}`}>···</button></td></tr>)}</tbody></table></div>}
        {selected && <section className="plans-panel"><div className="panel-heading"><div><div className="eyebrow">{selected.area.toUpperCase()}</div><h2>Planes de {selected.name}</h2><p>Configura modalidades y derechos asociados. Los planes nuevos se crean en borrador.</p></div><button className="button secondary" onClick={() => setPlanDialog(true)}>＋ Nuevo plan</button></div>{plans.length === 0 ? <div className="plans-empty">Todavía no hay planes para este servicio.</div> : <div className="plan-list">{plans.map((plan) => <article className="plan-card" key={plan.id}><span className="service-icon">▤</span><div className="plan-info"><strong>{plan.name}</strong><small>{plan.billingCadence === 'monthly' ? 'Mensual' : plan.billingCadence} · {plan.rights.map(describeRight).join(' · ')}</small></div><span className="badge draft">Borrador</span></article>)}</div>}</section>}
      </section><footer className="footer-note">2J Platform <span>·</span> Servicios, planes y derechos <span>·</span> Fase inicial</footer>
    </main>
    {dialog && <div className="backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(false); }}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button className="dialog-close" aria-label="Cerrar" onClick={() => setDialog(false)}>×</button><div className="eyebrow">CATÁLOGO</div><h2 id="dialog-title">Nuevo servicio</h2><p>Añade un servicio para configurar sus planes y derechos.</p><form onSubmit={createService}><label>Nombre del servicio<input autoFocus required maxLength={100} placeholder="Ej. Entrenamiento personal" value={name} onChange={(event) => setName(event.target.value)}/></label><label>Área<select value={serviceArea} onChange={(event) => setServiceArea(event.target.value)}><option>La Sala</option><option>El Estudio</option><option>Entrenamiento personal</option><option>Otro</option></select></label><div className="dialog-actions"><button type="button" className="button secondary" onClick={() => setDialog(false)}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? 'Guardando…' : 'Crear servicio'}</button></div></form></section></div>}
    {planDialog && <div className="backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPlanDialog(false); }}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="plan-dialog-title"><button className="dialog-close" aria-label="Cerrar" onClick={() => setPlanDialog(false)}>×</button><div className="eyebrow">{selected?.name.toUpperCase()}</div><h2 id="plan-dialog-title">Nuevo plan</h2><p>Elige modalidad y derecho. No se asignan precios ni reglas por defecto.</p><form onSubmit={createPlan}><label>Nombre del plan<input autoFocus required maxLength={100} placeholder="Ej. Sala 8 sesiones" value={planName} onChange={(event) => setPlanName(event.target.value)}/></label><label>Modalidad<select required value={cadence} onChange={(event) => setCadence(event.target.value)}><option value="">Selecciona una modalidad</option><option value="monthly">Recurrente mensual</option><option value="weekly">Recurrente semanal</option><option value="session_pack">Bono de sesiones</option><option value="period">Periodo definido</option></select></label><label>Derecho incluido<select required value={rightType} onChange={(event) => setRightType(event.target.value)}><option value="">Selecciona un derecho</option><option value="service_access">Acceso al servicio</option><option value="period_quota">Cuota por periodo</option><option value="sessions_quota">Bono de sesiones</option></select></label>{rightType && rightType !== 'service_access' && <label>{rightType === 'sessions_quota' ? 'Número de sesiones' : 'Número de accesos'}<input required type="number" min="1" max="1000" value={quota} onChange={(event) => setQuota(event.target.value)}/></label>}{rightType === 'period_quota' && <label>Periodo de la cuota<select required value={rightPeriod} onChange={(event) => setRightPeriod(event.target.value)}><option value="">Selecciona un periodo</option><option value="week">Semana</option><option value="month">Mes</option><option value="plan_period">Duración del plan</option></select></label>}<div className="notice info">Los planes se guardan como borrador y no activan cobros.</div><div className="dialog-actions"><button type="button" className="button secondary" onClick={() => setPlanDialog(false)}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? 'Guardando…' : 'Crear plan'}</button></div></form></section></div>}
  </div>;
}
