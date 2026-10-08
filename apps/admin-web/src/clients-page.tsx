import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';

type Client = { id: string; firstName: string; lastName: string; email: string | null; phone: string | null; status: 'active' | 'archived'; createdAt: string; updatedAt?: string };
type ClientSection = { id: string; label: string; sourceLabel: string; access: 'available' | 'forbidden'; dataState: 'ready' | 'not_connected' };
type ClientEvent = { id: string; eventType: string; actorLabel: string; occurredAt: string };
type ClientReservation = { id: string; status: 'reserved' | 'attended' | 'no_show' | 'cancelled'; startsAt: string; durationMinutes: number; sessionStatus: 'scheduled' | 'cancelled'; serviceName: string; areaName: string };
type ClientProfile = { client: Client; capabilities: { manage: boolean }; summary: Record<string, { access: 'available' | 'forbidden'; dataState: string; data: unknown }>; sections: ClientSection[]; history: ClientEvent[]; reservations: ClientReservation[] };
type ClientList = { items: Client[]; capabilities: { manage: boolean }; hasMore: boolean; nextCursor: string | null };

const apiUrl = import.meta.env?.VITE_API_URL ?? 'http://127.0.0.1:3100';
const statusLabel = { active: 'Activo', archived: 'Archivado' };
const emptyStates: Record<string, string> = {
  reservations: 'Las reservas aparecerán aquí cuando se integre Calendario.',
  payments: 'Los cobros se consultarán desde Pagos y con sus permisos propios.',
  training: 'El entrenamiento mantiene su fuente de verdad en 2J Fitness App y El Búnker.',
  progress: 'El progreso se consultará desde la fuente existente de entrenamiento.',
  health: 'La información de salud seguirá protegida por sus permisos específicos.',
  documents: 'Los documentos se conectarán desde su módulo y con autorización propia.',
  messages: 'La comunicación aparecerá aquí cuando su módulo esté integrado.',
};
const sectionLabels: Record<string, string> = {
  reservations: 'Reservas', payments: 'Pagos', training: 'Entrenamiento', progress: 'Progreso', health: 'Salud', documents: 'Documentos', messages: 'Mensajes',
};

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
  const [activeSection, setActiveSection] = useState('summary');
  const [showCreate, setShowCreate] = useState(false);
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

  const activeSectionData = useMemo(() => profile?.sections.find((section) => section.id === activeSection) ?? null, [profile, activeSection]);

  async function createClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true); setSaveError('');
    createKeyRef.current ??= createIdempotencyKey();
    try {
      const response = await fetch(`${apiUrl}/api/clients`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': createKeyRef.current }, body: JSON.stringify({ firstName: form.get('firstName'), lastName: form.get('lastName'), email: form.get('email'), phone: form.get('phone') }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(response.status === 403 ? 'Tu perfil no puede dar de alta clientes.' : result.message ?? 'No se pudo guardar el cliente.');
      createKeyRef.current = null;
      setShowCreate(false); setQuery(''); setDebouncedQuery(''); setStatus('active');
      setSelectedId(result.id); setActiveSection('summary'); setRefreshKey((value) => value + 1);
    } catch (error) { setSaveError(error instanceof Error ? error.message : 'No se pudo guardar el cliente.'); }
    finally { setSaving(false); }
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
    const sections = profile?.sections ?? [];
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

  return <div className="shell">
    <aside className="sidebar"><a className="brand" href="#services" aria-label="2J Platform, inicio"><span className="brand-mark">2J</span><span className="brand-copy">FITNESS CENTER<small>OPERACIONES</small></span></a><div className="nav-label">GESTIÓN</div><nav aria-label="Gestión"><a className="nav-item" href="#services">Servicios y planes</a><a className="nav-item active" href="#clients" aria-current="page"><ClientIcon name="people"/> Clientes</a><a className="nav-item" href="#calendar">Calendario</a></nav><div className="sidebar-footer"><span className="status-dot"/> Datos protegidos por permisos</div></aside>
    <main className="main" id="clients"><header className="topbar"><div className="crumb">Gestión <ClientIcon name="arrow"/> Clientes</div><div className="local-pill"><span className="status-dot"/> Entorno local</div></header>
      <section className="page-heading"><div><div className="eyebrow">RELACIÓN CON CLIENTES</div><h1>Clientes 360</h1><p>Datos de contacto y estado de cada cliente, según tus permisos.</p></div>{list.capabilities.manage && <button className="button primary" onClick={(event) => { opener.current = event.currentTarget; createKeyRef.current = createIdempotencyKey(); setShowCreate(true); }}><ClientIcon name="plus"/> Nuevo cliente</button>}</section>
      <section className="clients-layout" aria-label="Gestión de clientes">
        <section className="panel clients-list-panel" aria-label="Listado de clientes" aria-busy={listBusy || loadingMore}><div className="panel-heading"><div><h2>Clientes</h2><p>Busca por nombre o datos de contacto.</p></div><span className="count" aria-hidden="true">{listState === 'ready' ? `${list.items.length}${list.hasMore ? '+' : ''}` : '—'}</span></div>
          <div className="toolbar client-toolbar"><label className="search"><ClientIcon name="search"/><span className="sr-only">Buscar cliente</span><input aria-label="Buscar cliente" placeholder="Nombre, email o teléfono" value={query} onChange={(event) => setQuery(event.target.value)}/></label><label className="filter-label"><span>Estado</span><select aria-label="Filtrar clientes por estado" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="active">Activos</option><option value="archived">Archivados</option></select></label></div>
          <div className="sr-only" role="status" aria-live="polite">{listState === 'ready' ? `${list.items.length} clientes${list.hasMore ? '. Hay más resultados disponibles.' : ''}` : ''}</div>
          {listBusy && <div className="list-refresh-status" role="status"><span className="spinner"/> Actualizando resultados…</div>}
          {listState === 'loading' && <div className="state-panel" role="status"><span className="spinner"/><span>Cargando clientes…</span></div>}
          {listState === 'unauthorized' && <div className="state-panel error-panel" role="alert"><strong>Acceso no disponible</strong><span>Tu sesión no permite consultar los datos de clientes.</span></div>}
          {listState === 'error' && <div className="state-panel error-panel" role="alert"><strong>No se pudo cargar la lista</strong><span>{listError}</span><button className="button secondary" onClick={() => void loadClients(null, false)}>Reintentar</button></div>}
          {(listState === 'ready' || (listState === 'error' && list.items.length > 0)) && list.items.length === 0 && <div className="state-panel"><span className="state-icon"><ClientIcon name="people"/></span><strong>{debouncedQuery ? 'Sin resultados' : status === 'active' ? 'Aún no hay clientes' : 'No hay clientes archivados'}</strong><span>{debouncedQuery ? 'Prueba con otro nombre o dato de contacto.' : status === 'active' && list.capabilities.manage ? 'Registra un cliente para iniciar su ficha 360.' : 'Los perfiles archivados se conservan aquí.'}</span>{!debouncedQuery && status === 'active' && list.capabilities.manage && <button className="button secondary" onClick={(event) => { opener.current = event.currentTarget; createKeyRef.current = createIdempotencyKey(); setShowCreate(true); }}>Crear primer cliente</button>}</div>}
          {(listState === 'ready' || (listState === 'error' && list.items.length > 0)) && list.items.length > 0 && <><div className="client-rows" role="list" aria-label="Resultados de clientes">{list.items.map((client) => <div role="listitem" key={client.id}><button className={`client-row ${client.id === selectedId ? 'selected' : ''}`} aria-pressed={client.id === selectedId} onClick={() => { setSelectedId(client.id); setActiveSection('summary'); setArchiveFeedback(''); }}><span className="client-avatar" aria-hidden="true">{client.firstName.slice(0, 1)}{client.lastName.slice(0, 1)}</span><span className="client-row-copy"><strong>{displayName(client)}</strong><span>{client.email ?? client.phone ?? 'Sin datos de contacto'}</span></span><span className={`badge ${client.status}`}>{statusLabel[client.status]}</span><ClientIcon name="chevron"/></button></div>)}</div>{list.hasMore && <div className="load-more-row"><button className="button secondary" disabled={loadingMore || listBusy} onClick={() => list.nextCursor && void loadClients(list.nextCursor, true)}>{loadingMore ? 'Cargando…' : 'Cargar más clientes'}</button><span>Mostrando {list.items.length} clientes</span></div>}</>}
        </section>
        <section ref={profilePanelRef} className="panel client-detail-panel" aria-label="Ficha 360 del cliente">{profileState === 'idle' && <div className="detail-state detail-placeholder"><span className="state-icon"><ClientIcon name="people"/></span><strong>Elige un cliente</strong><span>Su resumen e historial aparecerán aquí.</span></div>}
          {profileState === 'loading' && <div className="detail-state" role="status"><span className="spinner"/><span>Cargando ficha…</span></div>}
          {profileState === 'unauthorized' && <div className="detail-state detail-error" role="alert"><strong>Acceso no disponible</strong><span>Tu sesión no tiene autorización para consultar esta ficha.</span></div>}
          {profileState === 'error' && <div className="detail-state detail-error" role="alert"><strong>No se pudo cargar la ficha</strong><span>{profileError}</span><button className="button secondary" onClick={() => setProfileRetry((value) => value + 1)}>Reintentar ficha</button></div>}
          {profileState === 'ready' && profile && <><header className="client-profile-heading"><span className="client-avatar large" aria-hidden="true">{profile.client.firstName.slice(0, 1)}{profile.client.lastName.slice(0, 1)}</span><div className="client-profile-title"><div className="eyebrow">FICHA DEL CLIENTE</div><h2 ref={profileTitleRef} tabIndex={-1}>{displayName(profile.client)}</h2><p>Alta {dateLabel(profile.client.createdAt)}</p></div><span className={`badge ${profile.client.status}`}>{statusLabel[profile.client.status]}</span>{profile.capabilities.manage && profile.client.status === 'active' && <button className="text-button archive-client" onClick={(event) => { archiveOpener.current = event.currentTarget; setArchiveError(''); setShowArchiveConfirm(true); }}>Archivar</button>}</header>
            {archiveFeedback && <div className="archive-feedback" role="status">{archiveFeedback}</div>}
            <nav className="client-tabs" aria-label="Secciones del cliente" role="tablist" aria-orientation="horizontal">{profile.sections.map((section) => <button key={section.id} ref={(node) => { if (node) tabsRef.current.set(section.id, node); }} type="button" role="tab" id={`client-tab-${section.id}`} aria-selected={activeSection === section.id} aria-label={`${section.label}${section.dataState === 'not_connected' ? ', pendiente de integrar' : ''}${section.access === 'forbidden' ? ', permiso necesario' : ''}`} aria-controls="client-section-panel" tabIndex={activeSection === section.id ? 0 : -1} className={activeSection === section.id ? 'selected' : ''} onClick={() => setActiveSection(section.id)} onKeyDown={(event) => handleTabKey(event, section.id)}>{section.label}{section.dataState === 'not_connected' && <span className="pending-dot" aria-hidden="true" title="Pendiente de integrar"/>}</button>)}</nav>
            <section className="client-section-panel" id="client-section-panel" role="tabpanel" aria-labelledby={`client-tab-${activeSection}`} tabIndex={0}>
              {activeSectionData?.access === 'forbidden' && <div className="detail-state" role="status"><strong>Esta sección requiere otro permiso</strong><span>Solo mostraremos sus datos cuando tu perfil tenga autorización para este módulo.</span></div>}
              {activeSection === 'summary' && activeSectionData?.access === 'available' && <div className="client-summary"><div className="summary-title"><div><div className="eyebrow">RESUMEN OPERATIVO</div><h3>Datos del perfil</h3></div><span className="source-pill">Clientes 360</span></div><p className="pii-context">Los datos de contacto se muestran solo a perfiles autorizados.</p><div className="client-contact-grid"><div><span>Email</span><strong>{profile.client.email ?? 'No indicado'}</strong></div><div><span>Teléfono</span><strong>{profile.client.phone ?? 'No indicado'}</strong></div><div><span>Estado</span><strong>{statusLabel[profile.client.status]}</strong></div><div><span>Alta</span><strong>{dateLabel(profile.client.createdAt)}</strong></div></div><div className="summary-connection"><span className="state-icon"><ClientIcon name="people"/></span><div><strong>Perfil conectado</strong><p>Reservas, planes, pagos y el resto de módulos aparecerán cuando estén integrados con sus permisos propios.</p></div></div></div>}
              {activeSection === 'history' && activeSectionData?.access === 'available' && <div className="client-history"><div className="summary-title"><div><div className="eyebrow">REGISTRO DEL PERFIL</div><h3>Historial del cliente</h3></div></div>{profile.history.length ? <ol>{profile.history.map((event) => <li key={event.id}><span className="history-dot"/><div><strong>{event.eventType === 'client.created' ? 'Cliente dado de alta' : 'Cliente archivado'}</strong><span>{dateLabel(event.occurredAt)} · {event.actorLabel || 'Equipo 2J'}</span></div></li>)}</ol> : <div className="detail-state"><span className="state-icon"><ClientIcon name="calendar"/></span><strong>Aún no hay actividad</strong><span>Los cambios del perfil quedarán registrados aquí.</span></div>}</div>}
              {activeSection === 'reservations' && activeSectionData?.access === 'available' && <div className="client-history"><div className="summary-title"><div><div className="eyebrow">CALENDARIO</div><h3>Reservas del cliente</h3></div><span className="source-pill">Mismo perfil · ID de cliente</span></div>{profile.reservations?.length ? <ol>{profile.reservations.map((reservation) => <li key={reservation.id}><span className="history-dot"/><div><strong>{reservation.serviceName} · {reservation.status === 'reserved' ? 'Reservado' : reservation.status === 'attended' ? 'Asistió' : reservation.status === 'no_show' ? 'No-show' : 'Cancelado'}</strong><span>{new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(reservation.startsAt))} · {reservation.areaName}{reservation.sessionStatus === 'cancelled' ? ' · Sesión cancelada' : ''}</span></div></li>)}</ol> : <div className="detail-state"><span className="state-icon"><ClientIcon name="calendar"/></span><strong>Sin reservas todavía</strong><span>Las próximas reservas del cliente aparecerán aquí.</span></div>}</div>}
              {activeSection !== 'summary' && activeSection !== 'history' && activeSection !== 'reservations' && activeSectionData?.access === 'available' && <div className="module-placeholder"><span className="state-icon"><ClientIcon name="people"/></span><div><div className="eyebrow">{activeSectionData?.sourceLabel}</div><h3>{sectionLabels[activeSection] ?? activeSectionData?.label}</h3><p>{emptyStates[activeSection] ?? 'Este módulo se conectará con sus permisos propios.'}</p></div><span className="module-state">Pendiente de integrar</span></div>}
            </section>
          </>}
        </section>
      </section>
      <footer className="footer-note">2J Platform <span>·</span> Clientes 360</footer>
    </main>
    {showCreate && <div className="backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setShowCreate(false); }}><section ref={dialogRef} className="dialog" role="dialog" aria-modal="true" aria-labelledby="new-client-title"><button className="icon-button dialog-close" aria-label="Cerrar diálogo" disabled={saving} onClick={() => { setShowCreate(false); setSaveError(''); }}><ClientIcon name="close"/></button><div className="eyebrow">CLIENTES 360</div><h2 id="new-client-title">Nuevo cliente</h2><p>Guarda los datos básicos. No se añade información clínica ni de pagos.</p><form onSubmit={(event) => void createClient(event)}><label>Nombre<input ref={createNameRef} name="firstName" required maxLength={80} autoComplete="given-name"/></label><label>Apellidos<input name="lastName" required maxLength={100} autoComplete="family-name"/></label><label>Email (opcional)<input name="email" type="email" maxLength={254} autoComplete="email"/></label><label>Teléfono (opcional)<input name="phone" type="tel" maxLength={40} autoComplete="tel"/></label>{saveError && <div className="form-error" role="alert">{saveError}</div>}<div className="dialog-actions"><button type="button" className="button secondary" disabled={saving} onClick={() => setShowCreate(false)}>Cancelar</button><button className="button primary" disabled={saving}>{saving ? 'Guardando…' : 'Crear cliente'}</button></div></form></section></div>}
    {showArchiveConfirm && <div className="backdrop archive-backdrop"><section ref={archiveDialogRef} className="dialog archive-dialog" role="alertdialog" aria-modal="true" aria-labelledby="archive-client-title" aria-describedby="archive-client-description"><div className="eyebrow">ACCIÓN SOBRE EL PERFIL</div><h2 id="archive-client-title">¿Archivar este cliente?</h2><p id="archive-client-description">El perfil y su historial se conservarán. El cliente dejará de aparecer en la lista de activos.</p>{archiveError && <div className="form-error" role="alert">{archiveError}</div>}<div className="dialog-actions"><button ref={archiveCancelRef} type="button" className="button secondary" disabled={archiving} onClick={() => setShowArchiveConfirm(false)}>Cancelar</button><button type="button" className="button danger" disabled={archiving} onClick={() => void archiveClient()}>{archiving ? 'Archivando…' : 'Archivar cliente'}</button></div></section></div>}
  </div>;
}
