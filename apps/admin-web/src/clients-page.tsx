import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';

type Client = { id: string; firstName: string; lastName: string; email: string | null; phone: string | null; status: 'active' | 'archived'; createdAt: string; updatedAt?: string };
type ClientSection = { id: string; label: string; source: string; access: 'available' | 'forbidden'; dataState: 'ready' | 'not_connected' };
type ClientEvent = { id: string; eventType: string; actorId: string; occurredAt: string };
type ClientProfile = { client: Client; capabilities: { manage: boolean }; summary: { activePlan: null; availableSessions: null; lastActivityAt: null; adherence: null; unpaidBalance: null; nextReservationAt: null }; sections: ClientSection[]; history: ClientEvent[] };
type ClientList = { items: Client[]; capabilities: { manage: boolean } };

const apiUrl = import.meta.env?.VITE_API_URL ?? 'http://127.0.0.1:3100';
const statusLabel = { active: 'Activo', archived: 'Archivado' };
const emptyStates: Record<string, string> = {
  reservations: 'Las reservas aparecerán aquí cuando el módulo de Calendario esté integrado.',
  payments: 'Los cobros y saldos se mostrarán aquí cuando se implemente el módulo de Pagos.',
  training: 'El entrenamiento sigue teniendo su fuente de verdad en 2J Fitness App y El Búnker.',
  progress: 'El progreso se consultará desde la fuente existente de entrenamiento; esta ficha no duplica esos datos.',
  health: 'La información de salud se conectará desde su fuente autorizada y seguirá protegida por permisos.',
  documents: 'Los documentos y formularios se conectarán desde el módulo de documentos con sus permisos propios.',
  messages: 'El historial de mensajes aparecerá cuando se integre el módulo de Comunicación.',
};

function ClientIcon({ name }: { name: 'people' | 'search' | 'arrow' | 'close' | 'plus' | 'calendar' }) {
  const paths = {
    people: <><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.4-3.1 2.2-4.7 5.5-4.7s5.1 1.6 5.5 4.7M16 5.4a3 3 0 0 1 0 5.8m1.6 3.3c1.8.8 2.8 2.2 3 4.5"/></>,
    search: <><circle cx="10.8" cy="10.8" r="6.3"/><path d="m15.4 15.4 4.1 4.1"/></>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>, close: <path d="m6 6 12 12M18 6 6 18"/>, plus: <path d="M12 5v14M5 12h14"/>, calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
  };
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function displayName(client: Client) { return `${client.firstName} ${client.lastName}`; }
function dateLabel(value: string) { return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(new Date(value)); }

export function ClientsPage() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [list, setList] = useState<ClientList>({ items: [], capabilities: { manage: false } });
  const [listState, setListState] = useState<'loading' | 'ready' | 'error' | 'unauthorized'>('loading');
  const [listError, setListError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [profileState, setProfileState] = useState<'idle' | 'loading' | 'ready' | 'error' | 'unauthorized'>('idle');
  const [profileError, setProfileError] = useState('');
  const [activeSection, setActiveSection] = useState('summary');
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const opener = useRef<HTMLElement | null>(null);
  const createNameRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const savingRef = useRef(saving);
  savingRef.current = saving;

  useEffect(() => {
    let current = true;
    setListState('loading');
    const params = new URLSearchParams({ status, limit: '100' });
    if (query.trim()) params.set('q', query.trim());
    void fetch(`${apiUrl}/api/clients?${params}`)
      .then(async (response) => ({ response, data: await response.json().catch(() => ({})) }))
      .then(({ response, data }) => {
        if (!current) return;
        if (response.status === 401) { setListState('unauthorized'); return; }
        if (response.status === 403) throw new Error('Tu rol no tiene permiso para consultar los datos personales de clientes.');
        if (!response.ok) throw new Error(data.message ?? 'No se pudo cargar el listado de clientes.');
        setList(data as ClientList);
        setListState('ready');
        setListError('');
      })
      .catch((error: unknown) => { if (current) { setListError(error instanceof Error ? error.message : 'No se pudo cargar el listado.'); setListState('error'); } });
    return () => { current = false; };
  }, [query, status, refreshKey]);

  useEffect(() => {
    let current = true;
    if (!selectedId) { setProfile(null); setProfileState('idle'); return () => { current = false; }; }
    setProfileState('loading');
    void fetch(`${apiUrl}/api/clients/${selectedId}`)
      .then(async (response) => ({ response, data: await response.json().catch(() => ({})) }))
      .then(({ response, data }) => {
        if (!current) return;
        if (response.status === 401) { setProfileState('unauthorized'); return; }
        if (response.status === 403) throw new Error('Tu rol no tiene permiso para consultar esta ficha.');
        if (!response.ok) throw new Error(data.message ?? 'No se pudo cargar la ficha del cliente.');
        setProfile(data as ClientProfile);
        setProfileState('ready');
        setProfileError('');
      })
      .catch((error: unknown) => { if (current) { setProfileError(error instanceof Error ? error.message : 'No se pudo cargar la ficha.'); setProfileState('error'); } });
    return () => { current = false; };
  }, [selectedId]);

  useEffect(() => {
    if (!showCreate) return;
    createNameRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savingRef.current) { setShowCreate(false); setSaveError(''); return; }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); if (opener.current?.isConnected) opener.current.focus(); };
  }, [showCreate]);

  const activeSectionData = useMemo(() => profile?.sections.find((section) => section.id === activeSection) ?? null, [profile, activeSection]);

  async function createClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setSaveError('');
    try {
      const response = await fetch(`${apiUrl}/api/clients`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ firstName: form.get('firstName'), lastName: form.get('lastName'), email: form.get('email'), phone: form.get('phone') }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(response.status === 403 ? 'Tu rol no puede dar de alta clientes.' : result.message ?? 'No se pudo guardar el cliente.');
      setShowCreate(false);
      setQuery('');
      setStatus('active');
      setSelectedId(result.id);
      setActiveSection('summary');
      setRefreshKey((value) => value + 1);
    } catch (error) { setSaveError(error instanceof Error ? error.message : 'No se pudo guardar el cliente.'); }
    finally { setSaving(false); }
  }

  async function archiveClient() {
    if (!profile) return;
    try {
      const response = await fetch(`${apiUrl}/api/clients/${profile.client.id}/archive`, { method: 'PATCH' });
      if (!response.ok) { setProfileError(response.status === 403 ? 'Tu rol no puede archivar clientes.' : 'No se pudo archivar el cliente.'); return; }
      setSelectedId(null);
      setRefreshKey((value) => value + 1);
    } catch { setProfileError('No se pudo conectar para archivar el cliente.'); }
  }

  return <div className="shell">
    <aside className="sidebar"><a className="brand" href="#services" aria-label="2J Platform, inicio"><span className="brand-mark">2J</span><span className="brand-copy">FITNESS CENTER<small>OPERACIONES</small></span></a><div className="nav-label">GESTIÓN</div><nav aria-label="Gestión"><a className="nav-item" href="#services">Servicios y planes</a><a className="nav-item active" href="#clients" aria-current="page"><ClientIcon name="people"/> Clientes</a><span className="nav-item unavailable">Calendario <span className="coming-soon">Próximamente</span></span></nav><div className="sidebar-footer"><span className="status-dot"/> Datos protegidos por permisos del servidor</div></aside>
    <main className="main" id="clients"><header className="topbar"><div className="crumb">Gestión <ClientIcon name="arrow"/> Clientes</div><div className="local-pill"><span className="status-dot"/> Entorno local</div></header>
      <section className="page-heading"><div><div className="eyebrow">RELACIÓN CON CLIENTES</div><h1>Clientes 360</h1><p>Una ficha clara para la información operativa del centro.</p></div>{list.capabilities.manage && <button className="button primary" onClick={(event) => { opener.current = event.currentTarget; setShowCreate(true); }}><ClientIcon name="plus"/> Nuevo cliente</button>}</section>
      <section className="clients-layout" aria-label="Gestión de clientes">
        <section className="panel clients-list-panel" aria-label="Listado de clientes"><div className="panel-heading"><div><h2>Clientes</h2><p>Busca por nombre o datos de contacto.</p></div><span className="count">{listState === 'ready' ? list.items.length : '—'}</span></div>
          <div className="toolbar client-toolbar"><label className="search"><ClientIcon name="search"/><span className="sr-only">Buscar cliente</span><input aria-label="Buscar cliente" placeholder="Nombre, email o teléfono" value={query} onChange={(event) => setQuery(event.target.value)}/></label><label className="filter-label"><span>Estado</span><select aria-label="Filtrar clientes por estado" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="active">Activos</option><option value="archived">Archivados</option></select></label></div>
          {listState === 'loading' && <div className="state-panel" role="status"><span className="spinner"/><span>Cargando clientes…</span></div>}
          {listState === 'unauthorized' && <div className="state-panel error-panel" role="alert"><strong>Acceso no disponible</strong><span>La API no ha establecido una sesión autorizada para consultar datos personales.</span></div>}
          {listState === 'error' && <div className="state-panel error-panel" role="alert"><strong>No se pudo cargar la lista</strong><span>{listError}</span><button className="button secondary" onClick={() => setRefreshKey((value) => value + 1)}>Reintentar</button></div>}
          {listState === 'ready' && list.items.length === 0 && <div className="state-panel"><span className="state-icon"><ClientIcon name="people"/></span><strong>{query ? 'Sin resultados' : status === 'active' ? 'Aún no hay clientes' : 'No hay clientes archivados'}</strong><span>{query ? 'Prueba con otro nombre o dato de contacto.' : status === 'active' && list.capabilities.manage ? 'Registra un cliente para iniciar su ficha 360.' : 'Los perfiles se conservarán aquí cuando se archiven.'}</span>{!query && status === 'active' && list.capabilities.manage && <button className="button secondary" onClick={(event) => { opener.current = event.currentTarget; setShowCreate(true); }}>Crear primer cliente</button>}</div>}
          {listState === 'ready' && list.items.length > 0 && <div className="client-rows" role="list" aria-label="Resultados de clientes">{list.items.map((client) => <div role="listitem" key={client.id}><button className={`client-row ${client.id === selectedId ? 'selected' : ''}`} aria-pressed={client.id === selectedId} onClick={() => { setSelectedId(client.id); setActiveSection('summary'); }}><span className="client-avatar" aria-hidden="true">{client.firstName.slice(0, 1)}{client.lastName.slice(0, 1)}</span><span className="client-row-copy"><strong>{displayName(client)}</strong><span>{client.email ?? client.phone ?? 'Sin datos de contacto'}</span></span><span className={`badge ${client.status}`}>{statusLabel[client.status]}</span></button></div>)}</div>}
        </section>
        <section className="panel client-detail-panel" aria-label="Ficha 360 del cliente">{profileState === 'idle' && <div className="detail-state detail-placeholder"><span className="state-icon"><ClientIcon name="people"/></span><strong>Elige un cliente</strong><span>Su resumen e historial aparecerán aquí.</span></div>}
          {profileState === 'loading' && <div className="detail-state" role="status"><span className="spinner"/><span>Cargando ficha…</span></div>}
          {profileState === 'unauthorized' && <div className="detail-state detail-error" role="alert"><strong>Acceso no disponible</strong><span>Tu sesión no tiene autorización para consultar esta ficha.</span></div>}
          {profileState === 'error' && <div className="detail-state detail-error" role="alert"><strong>No se pudo cargar la ficha</strong><span>{profileError}</span></div>}
          {profileState === 'ready' && profile && <><header className="client-profile-heading"><span className="client-avatar large" aria-hidden="true">{profile.client.firstName.slice(0, 1)}{profile.client.lastName.slice(0, 1)}</span><div className="client-profile-title"><div className="eyebrow">FICHA DEL CLIENTE</div><h2>{displayName(profile.client)}</h2><p>Alta {dateLabel(profile.client.createdAt)}</p></div><span className={`badge ${profile.client.status}`}>{statusLabel[profile.client.status]}</span>{profile.capabilities.manage && profile.client.status === 'active' && <button className="text-button archive-client" onClick={() => void archiveClient()}>Archivar</button>}</header>
            <nav className="client-tabs" aria-label="Secciones del cliente" role="tablist">{profile.sections.map((section) => <button key={section.id} role="tab" id={`client-tab-${section.id}`} aria-selected={activeSection === section.id} aria-controls="client-section-panel" disabled={section.access === 'forbidden'} className={activeSection === section.id ? 'selected' : ''} onClick={() => setActiveSection(section.id)}>{section.label}</button>)}</nav>
            <section className="client-section-panel" id="client-section-panel" role="tabpanel" aria-labelledby={`client-tab-${activeSection}`}>
              {activeSectionData?.access === 'forbidden' && <div className="detail-state"><strong>Permiso necesario</strong><span>Tu rol no tiene acceso a esta sección. El control se aplica en el servidor.</span></div>}
              {activeSection === 'summary' && <div className="client-summary"><div className="summary-title"><div><div className="eyebrow">RESUMEN OPERATIVO</div><h3>Datos del perfil</h3></div><span className="source-pill">Datos de Clientes 360</span></div><div className="client-contact-grid"><div><span>Email</span><strong>{profile.client.email ?? 'No indicado'}</strong></div><div><span>Teléfono</span><strong>{profile.client.phone ?? 'No indicado'}</strong></div><div><span>Estado</span><strong>{statusLabel[profile.client.status]}</strong></div><div><span>Última actividad</span><strong>Pendiente de conectar</strong></div></div><div className="client-summary-cards">{[['Plan activo', 'Se mostrará al integrar Planes/Derechos'], ['Saldo y bonos', 'Se consultará desde la fuente de derechos'], ['Próxima reserva', 'Pendiente del módulo de Calendario'], ['Adherencia', 'Sin fórmula de producto definida']].map(([title, copy]) => <article key={title}><span>{title}</span><strong>—</strong><small>{copy}</small></article>)}</div></div>}
              {activeSection === 'history' && <div className="client-history"><div className="summary-title"><div><div className="eyebrow">REGISTRO DEL PERFIL</div><h3>Historial del cliente</h3></div></div>{profile.history.length ? <ol>{profile.history.map((event) => <li key={event.id}><span className="history-dot"/><div><strong>{event.eventType === 'client.created' ? 'Cliente dado de alta' : 'Cliente archivado'}</strong><span>{dateLabel(event.occurredAt)} · {event.actorId}</span></div></li>)}</ol> : <div className="detail-state"><span className="state-icon"><ClientIcon name="calendar"/></span><strong>Aún no hay actividad</strong><span>Los cambios del perfil quedarán registrados aquí.</span></div>}</div>}
              {activeSection !== 'summary' && activeSection !== 'history' && <div className="module-placeholder"><span className="state-icon">{activeSection === 'reservations' ? <ClientIcon name="calendar"/> : <ClientIcon name="people"/>}</span><div><div className="eyebrow">FUENTE: {activeSectionData?.source}</div><h3>{activeSectionData?.label}</h3><p>{emptyStates[activeSection] ?? 'Este módulo todavía no está conectado.'}</p></div><span className="module-state">Pendiente de integrar</span></div>}
            </section>
          </>}
        </section>
      </section>
      <footer className="footer-note">2J Platform <span>·</span> Clientes 360</footer>
    </main>
    {showCreate && <div className="backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setShowCreate(false); }}><section ref={dialogRef} className="dialog" role="dialog" aria-modal="true" aria-labelledby="new-client-title"><button className="icon-button dialog-close" aria-label="Cerrar diálogo" onClick={() => { if (!saving) { setShowCreate(false); setSaveError(''); } }}><ClientIcon name="close"/></button><div className="eyebrow">CLIENTES 360</div><h2 id="new-client-title">Nuevo cliente</h2><p>Guarda los datos básicos. La ficha conserva el historial y no almacena información clínica.</p><form onSubmit={(event) => void createClient(event)}><label>Nombre<input ref={createNameRef} name="firstName" required maxLength={80} autoComplete="given-name"/></label><label>Apellidos<input name="lastName" required maxLength={100} autoComplete="family-name"/></label><label>Email (opcional)<input name="email" type="email" maxLength={254} autoComplete="email"/></label><label>Teléfono (opcional)<input name="phone" type="tel" maxLength={40} autoComplete="tel"/></label>{saveError && <div className="form-error" role="alert">{saveError}</div>}<div className="dialog-actions"><button type="button" className="button secondary" disabled={saving} onClick={() => setShowCreate(false)}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? 'Guardando…' : 'Crear cliente'}</button></div></form></section></div>}
  </div>;
}
