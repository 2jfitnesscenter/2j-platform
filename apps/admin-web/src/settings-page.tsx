import { apiFetch } from './api-fetch.js';
import React from 'react';
import { Button, Card, CardHeader, EmptyState, PageHeader, StatusChip, Tabs, icons } from '@2j/ui';
import { InvoiceSettingsPanel } from './invoice-ui.js';

const apiUrl = import.meta.env?.VITE_API_URL ?? 'http://localhost:3100';

type Profile = { id: string; label: string; wildcard: boolean; permissionCount: number | null; groups: Array<{ id: string; label: string; permissions: string[] }> };
type Overview = {
  timezone: string;
  payments: { dueDay: number; graceDays: number; timezone: string; debtBlocksNewReservations: boolean; fiscalLegalGateOpen: boolean; documentRetentionMonths: number | null; methods: string[] } | null;
  profiles: Profile[];
  integrations: Record<string, boolean>;
};
type LoadState = { status: 'loading' } | { status: 'ready'; data: Overview } | { status: 'denied' } | { status: 'error' };

const TABS = [
  { id: 'center', label: 'Centro' }, { id: 'operations', label: 'Horario y turnos' }, { id: 'appearance', label: 'Apariencia' }, { id: 'booking', label: 'Reservas' }, { id: 'payments', label: 'Pagos' },
  { id: 'invoicing', label: 'Facturación' }, { id: 'store', label: 'Tienda' }, { id: 'permissions', label: 'Permisos' }, { id: 'integrations', label: 'Integraciones' },
];
const methodLabel: Record<string, string> = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', direct_debit: 'Domiciliación', other: 'Otro' };
const integrationLabel: Record<string, string> = {
  trainingSso: 'Acceso único con Búnker (SSO)', trainingServiceCalls: 'Llamadas de servicio a Búnker', trainingLinking: 'Vinculación de clientes con Búnker', trainingSignals: 'Señales de entrenamiento',
  trainingProvisioning: 'Alta automática en Búnker', push: 'Notificaciones push', passkeys: 'Acceso con llaves de acceso (passkeys)', memberAuthPilot: 'Acceso de clientes (piloto)', memberBookingPilot: 'Reservas de clientes (piloto)',
};

type CenterProfile = { businessName: string; contactEmail: string | null; contactPhone: string | null; address: string | null; city: string | null; postalCode: string | null };

function CenterProfileSettings({ timezone, onOpenOperations }: { timezone: string; onOpenOperations: () => void }) {
  const empty: CenterProfile = { businessName: '', contactEmail: null, contactPhone: null, address: null, city: null, postalCode: null };
  const [profile, setProfile] = React.useState<CenterProfile>(empty);
  const [state, setState] = React.useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [saving, setSaving] = React.useState(false);
  const [feedback, setFeedback] = React.useState('');
  React.useEffect(() => {
    const controller = new AbortController();
    void apiFetch(`${apiUrl}/api/admin/center-profile`, { signal: controller.signal }).then(async response => {
      if (response.status === 401 || response.status === 403) { setState('denied'); return; }
      if (!response.ok) throw new Error('load_failed');
      const body = await response.json() as { profile: CenterProfile | null };
      setProfile(body.profile ?? empty); setState('ready');
    }).catch(error => { if ((error as Error).name !== 'AbortError') setState('error'); });
    return () => controller.abort();
  }, []);
  const change = (field: keyof CenterProfile, value: string) => setProfile(current => ({ ...current, [field]: value || null }));
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setFeedback('');
    try {
      const response = await apiFetch(`${apiUrl}/api/admin/center-profile`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(profile) });
      if (response.status === 401 || response.status === 403) { setState('denied'); return; }
      if (!response.ok) throw new Error('save_failed');
      const body = await response.json() as { profile: CenterProfile };
      setProfile(body.profile); setFeedback('Datos guardados. El cambio queda registrado en la auditoría.');
    } catch { setFeedback('No se pudieron guardar los datos del centro. Revisa los campos e inténtalo de nuevo.'); }
    finally { setSaving(false); }
  };
  if (state === 'loading') return <div className="summary-state" role="status"><span className="spinner" /> Cargando datos del centro…</div>;
  if (state === 'denied') return <EmptyState icon={icons.ShieldCheck} title="Tu perfil no puede editar los datos del centro" role="status">La autorización se valida en el servidor.</EmptyState>;
  if (state === 'error') return <div className="summary-state summary-error" role="alert"><strong>No se pudieron cargar los datos del centro</strong><Button onClick={() => window.location.reload()}>Reintentar</Button></div>;
  return <>
    <div className="settings-notice is-connected" role="note"><StatusChip tone="success" icon={null}>Conectado</StatusChip><span>Los cambios se guardan en Platform y quedan auditados. No incluye datos fiscales.</span></div>
    <form className="settings-grid" onSubmit={save}>
      <label className="settings-field">Nombre comercial<input aria-label="Nombre comercial" maxLength={120} required value={profile.businessName} onChange={event => change('businessName', event.target.value)} /></label>
      <label className="settings-field">Teléfono<input aria-label="Teléfono" inputMode="tel" maxLength={80} value={profile.contactPhone ?? ''} onChange={event => change('contactPhone', event.target.value)} /></label>
      <label className="settings-field">Correo de contacto<input aria-label="Correo de contacto" type="email" maxLength={254} value={profile.contactEmail ?? ''} onChange={event => change('contactEmail', event.target.value)} /></label>
      <label className="settings-field wide">Dirección<input aria-label="Dirección" maxLength={400} value={profile.address ?? ''} onChange={event => change('address', event.target.value)} /></label>
      <label className="settings-field">Ciudad<input aria-label="Ciudad" maxLength={200} value={profile.city ?? ''} onChange={event => change('city', event.target.value)} /></label>
      <label className="settings-field">Código postal<input aria-label="Código postal" maxLength={40} value={profile.postalCode ?? ''} onChange={event => change('postalCode', event.target.value)} /></label>
      <div className="settings-inline-actions"><Button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar datos del centro'}</Button>{feedback && <span role="status">{feedback}</span>}</div>
    </form>
    <h3 className="settings-subtitle">Zona horaria</h3>
    <dl className="settings-list"><ReadOnlyRow label="Zona horaria" value={<>{timezone} <StatusChip tone="success" icon={null}>Conectado</StatusChip></>} detail="Las reglas del centro usan siempre la hora de Canarias." /></dl>
    <p className="settings-hint">El horario de apertura y los turnos asignados se gestionan en la pestaña Horario y turnos.</p>
    <Button variant="secondary" onClick={onOpenOperations}>Abrir Horario y turnos</Button>
  </>;
}

type OpeningInterval = { id: string; weekday: number; opensAt: string; closesAt: string; validFrom: string; validUntil: string | null; status: string };
type Shift = { id: string; professionalId: string; displayName: string; localDate: string; startsAt: string; endsAt: string; status: string };
type Professional = { id: string; displayName: string };
type Coverage = { openingIntervals: Array<{ startsAt: string; endsAt: string }>; assignedShifts: Array<{ id: string; displayName: string; startsAt: string; endsAt: string }>; staffingGaps: Array<{ startsAt: string; endsAt: string }>; cashCustody: { status: string; reason: string; recordedSessions: Array<{ id: string; status: string; openedAt: string; closedAt: string | null }> } };
const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
function canaryDate() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function localTime(value: string) { return new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)); }
function OperationsSettings() {
  const [intervals, setIntervals] = React.useState<OpeningInterval[]>([]);
  const [professionals, setProfessionals] = React.useState<Professional[]>([]);
  const [shifts, setShifts] = React.useState<Shift[]>([]);
  const [coverage, setCoverage] = React.useState<Coverage | null>(null);
  const [effectiveFrom, setEffectiveFrom] = React.useState(canaryDate);
  const [shiftDate, setShiftDate] = React.useState(canaryDate);
  const [professionalId, setProfessionalId] = React.useState('');
  const [startsAt, setStartsAt] = React.useState('09:00');
  const [endsAt, setEndsAt] = React.useState('13:00');
  const [state, setState] = React.useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [saving, setSaving] = React.useState(false);
  const [feedback, setFeedback] = React.useState('');
  const load = React.useCallback(async () => {
    setState('loading');
    try {
      const [hoursResponse, staffResponse, shiftsResponse, coverageResponse] = await Promise.all([
        fetch(`${apiUrl}/api/center/opening-hours?date=${effectiveFrom}`), fetch(`${apiUrl}/api/staff`),
        fetch(`${apiUrl}/api/center/shifts?from=${shiftDate}&to=${shiftDate}`), fetch(`${apiUrl}/api/center/coverage?date=${shiftDate}`),
      ]);
      if ([hoursResponse, shiftsResponse, coverageResponse].some(response => response.status === 401 || response.status === 403)) { setState('denied'); return; }
      if (![hoursResponse, staffResponse, shiftsResponse, coverageResponse].every(response => response.ok)) throw new Error('load_failed');
      const [hours, staff, dayShifts, dayCoverage] = await Promise.all([hoursResponse.json(), staffResponse.json(), shiftsResponse.json(), coverageResponse.json()]);
      setIntervals(hours.intervals as OpeningInterval[]); setProfessionals(staff as Professional[]); setShifts(dayShifts.shifts as Shift[]); setCoverage(dayCoverage as Coverage); setState('ready');
    } catch { setState('error'); }
  }, [effectiveFrom, shiftDate]);
  React.useEffect(() => { void load(); }, [load]);
  const updateInterval = (index: number, key: 'opensAt' | 'closesAt', value: string) => setIntervals(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
  const saveHours = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setFeedback('');
    try {
      const response = await fetch(`${apiUrl}/api/center/opening-hours`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ effectiveFrom, intervals: intervals.map(({ weekday, opensAt, closesAt }) => ({ weekday, opensAt, closesAt })) }) });
      if (!response.ok) throw new Error(String(response.status));
      setFeedback('Horario guardado. El cambio queda auditado y entra en vigor en la fecha indicada.'); await load();
    } catch { setFeedback('No se pudo guardar el horario. Revisa los tramos y vuelve a intentarlo.'); }
    finally { setSaving(false); }
  };
  const addShift = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setFeedback('');
    try {
      const response = await fetch(`${apiUrl}/api/center/shifts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ professionalId, localDate: shiftDate, startsAt, endsAt }) });
      if (!response.ok) throw new Error(String(response.status));
      setFeedback('Turno asignado y auditado.'); await load();
    } catch { setFeedback('No se pudo asignar el turno. Comprueba que no se solape con otro.'); }
    finally { setSaving(false); }
  };
  const cancelShift = async (id: string) => {
    setSaving(true); setFeedback('');
    try { const response = await fetch(`${apiUrl}/api/center/shifts/${id}/cancel`, { method: 'PATCH' }); if (!response.ok) throw new Error(); setFeedback('Turno cancelado y auditado.'); await load(); }
    catch { setFeedback('No se pudo cancelar el turno.'); } finally { setSaving(false); }
  };
  if (state === 'loading') return <div className="summary-state" role="status"><span className="spinner" /> Cargando horario y turnos…</div>;
  if (state === 'denied') return <EmptyState icon={icons.ShieldCheck} title="Solo el propietario puede gestionar horario y turnos" role="status">La autorización se valida en el servidor.</EmptyState>;
  if (state === 'error') return <div className="summary-state summary-error" role="alert"><strong>No se pudo cargar la operación del centro</strong><Button onClick={() => void load()}>Reintentar</Button></div>;
  return <div className="settings-operations">
    <div className="settings-notice is-connected" role="note"><StatusChip tone="success" icon={null}>Conectado</StatusChip><span>Zona horaria Atlantic/Canary. Los turnos planifican cobertura; nunca crean ni modifican fichajes.</span></div>
    <form onSubmit={saveHours} className="settings-operation-form">
      <h3 className="settings-subtitle">Horario de apertura del centro</h3>
      <label className="settings-field">Editar horario vigente en<input type="date" value={effectiveFrom} onChange={event => setEffectiveFrom(event.target.value)} required /></label>
      <p className="settings-hint">Al seleccionar una fecha se carga solo el horario vigente ese día. El cambio respeta los periodos futuros ya programados.</p>
      {intervals[0] && <p role="status">Periodo seleccionado: desde {intervals[0].validFrom}{intervals[0].validUntil ? ` hasta ${intervals[0].validUntil}` : ' sin fecha de fin'}. Los cambios empiezan el {effectiveFrom} y terminan antes del siguiente periodo programado.</p>}
      {!intervals.length && <p role="status">No hay un horario configurado para el {effectiveFrom}. Puedes crear uno para esa fecha.</p>}
      {intervals.map((interval, index) => <div className="settings-row" key={interval.id || `${interval.weekday}-${index}`}>
        <strong>{WEEKDAYS[interval.weekday]}</strong><label>Abre<input aria-label={`${WEEKDAYS[interval.weekday]} abre`} type="time" value={interval.opensAt} onChange={event => updateInterval(index, 'opensAt', event.target.value)} required /></label><label>Cierra<input aria-label={`${WEEKDAYS[interval.weekday]} cierra`} type="time" value={interval.closesAt} onChange={event => updateInterval(index, 'closesAt', event.target.value)} required /></label>
        <Button type="button" variant="secondary" onClick={() => setIntervals(current => current.filter((_, itemIndex) => itemIndex !== index))}>Quitar tramo</Button>
      </div>)}
      <div className="settings-inline-actions"><select aria-label="Día para añadir tramo" id="opening-weekday"><option value="1">Lunes</option>{WEEKDAYS.map((day, index) => index !== 1 && <option key={day} value={index}>{day}</option>)}</select><Button type="button" variant="secondary" onClick={() => { const select = document.getElementById('opening-weekday') as HTMLSelectElement | null; const weekday = Number(select?.value ?? 1); setIntervals(current => [...current, { id: '', weekday, opensAt: '09:00', closesAt: '17:00', validFrom: effectiveFrom, validUntil: null, status: 'active' }].sort((a, b) => a.weekday - b.weekday || a.opensAt.localeCompare(b.opensAt))); }}>Añadir tramo</Button><Button type="submit" disabled={saving}>Guardar horario</Button></div>
    </form>
    <form onSubmit={addShift} className="settings-operation-form">
      <h3 className="settings-subtitle">Asignar turno</h3>
      <div className="settings-grid"><label className="settings-field">Profesional<select value={professionalId} onChange={event => setProfessionalId(event.target.value)} required><option value="">Selecciona</option>{professionals.map(person => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select></label><label className="settings-field">Fecha<input type="date" value={shiftDate} onChange={event => setShiftDate(event.target.value)} required /></label><label className="settings-field">Desde<input type="time" value={startsAt} onChange={event => setStartsAt(event.target.value)} required /></label><label className="settings-field">Hasta<input type="time" value={endsAt} onChange={event => setEndsAt(event.target.value)} required /></label></div><Button type="submit" disabled={saving || !professionalId}>Asignar turno</Button>
    </form>
    <section aria-label="Cobertura del centro"><h3 className="settings-subtitle">Cobertura · {shiftDate}</h3><label className="settings-field">Día consultado<input type="date" value={shiftDate} onChange={event => setShiftDate(event.target.value)} /></label>
      {coverage?.openingIntervals.map((item, index) => <p key={index}>Abierto {localTime(item.startsAt)}–{localTime(item.endsAt)}</p>)}
      {coverage?.staffingGaps.length ? <div role="status"><strong>Huecos de turnos asignados</strong>{coverage.staffingGaps.map((gap, index) => <p key={index}>{localTime(gap.startsAt)}–{localTime(gap.endsAt)}</p>)}</div> : <p role="status">Sin huecos de cobertura asignada.</p>}
      <ul>{shifts.map(shift => <li key={shift.id}>{shift.displayName} · {localTime(shift.startsAt)}–{localTime(shift.endsAt)} {shift.status === 'scheduled' && <Button variant="secondary" disabled={saving} onClick={() => void cancelShift(shift.id)}>Cancelar turno</Button>}</li>)}</ul>
      <div className="settings-notice" role="note"><strong>Custodia de caja incompleta:</strong> aún no se registran traspasos A39–A44, así que Platform no afirma quién tuvo la caja durante cada intervalo. {coverage?.cashCustody.recordedSessions.length ?? 0} sesión(es) de caja registradas.</div>
    </section>
    {feedback && <p role="status" aria-live="polite">{feedback}</p>}
  </div>;
}

function ReadOnlyRow({ label, value, detail }: { label: string; value: React.ReactNode; detail?: string }) {
  return <div className="settings-row"><dt>{label}</dt><dd>{value}{detail && <small>{detail}</small>}</dd></div>;
}

/**
 * Configuración (paridad visual 11, referencia: Settings.jsx de Base44). Centro usa la API auditada existente; las reglas de reservas y el catálogo
 * siguen siendo propiedad de sus módulos. Los tokens de marca se mantienen globales y las reglas económicas continúan en solo lectura.
 */
export function SettingsPage() {
  const [tab, setTab] = React.useState('center');
  const [state, setState] = React.useState<LoadState>({ status: 'loading' });
  const load = React.useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await apiFetch(`${apiUrl}/api/settings/overview`, signal ? { signal } : undefined);
      if (response.status === 403 || response.status === 401) { setState({ status: 'denied' }); return; }
      if (!response.ok) throw new Error(String(response.status));
      setState({ status: 'ready', data: await response.json() as Overview });
    } catch (caught) { if ((caught as Error).name !== 'AbortError') setState({ status: 'error' }); }
  }, []);
  React.useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  const header = <PageHeader title="Configuración" description="Datos del centro conectados; las reglas de reservas siguen configurándose por servicio." />;
  if (state.status === 'denied') return <main className="summary settings-page" id="settings" data-2j-design="v2">{header}<Card><EmptyState icon={icons.ShieldCheck} title="Tu perfil no puede consultar la configuración" role="status">Solo Administración puede ver esta pantalla.</EmptyState></Card></main>;
  const data = state.status === 'ready' ? state.data : null;

  const body = (() => {
    if (state.status === 'loading') return <div className="summary-state" role="status"><span className="spinner" /> Cargando la configuración…</div>;
    if (state.status === 'error' || !data) return <div className="summary-state summary-error" role="alert"><strong>No se pudo cargar la configuración</strong><Button onClick={() => { setState({ status: 'loading' }); void load(); }}>Reintentar</Button></div>;
    const payments = data.payments;
    switch (tab) {
      case 'operations': return <OperationsSettings />;
      case 'invoicing': return <InvoiceSettingsPanel />;
      case 'center': return <CenterProfileSettings timezone={data.timezone} onOpenOperations={() => setTab('operations')} />;
      case 'appearance': return <>
        <div className="settings-notice is-connected" role="note"><StatusChip tone="success" icon={null}>Identidad 2J</StatusChip><span>La aplicación utiliza los tokens oficiales de 2J. Los colores corporativos no se editan por centro.</span></div>
        <div className="settings-preview" aria-label="Paleta oficial de 2J"><span className="settings-swatch" style={{ background: 'var(--color-accent)' }} /><span className="settings-swatch" style={{ background: 'var(--color-ink)' }} /><span>Grafito · Lima #A4D65E</span></div>
        <p className="settings-hint">El logo y las imágenes se administran en sus módulos privados. No se aceptan URLs externas ni se guardan archivos en el repositorio.</p></>;
      case 'booking': return <>
        <div className="settings-notice is-connected" role="note"><StatusChip tone="success" icon={null}>Reglas por servicio</StatusChip><span>El plazo y la política de cancelación se configuran en cada servicio. Esta pantalla no crea reglas globales ni duplica esa configuración.</span></div>
        <a className="settings-link" href="#services">Abrir Servicios para gestionar las reglas de reserva</a></>;
      case 'payments': return payments ? <>
        <div className="settings-notice is-connected" role="note"><StatusChip tone="success" icon={null}>Conectado</StatusChip><span>Estas reglas son las que aplica Economía hoy. Aquí solo se consultan; para cambiarlas hace falta un cambio aprobado por el propietario.</span></div>
        <dl className="settings-list">
          <ReadOnlyRow label="Día límite de pago" value={`Día ${payments.dueDay} de cada mes`} detail="La deuda bloquea la reserva desde las 00:00 del día siguiente (hora de Canarias)." />
          <ReadOnlyRow label="Días de gracia" value={String(payments.graceDays)} />
          <ReadOnlyRow label="Deuda bloquea nuevas reservas" value={payments.debtBlocksNewReservations ? 'Sí' : 'No'} />
          <ReadOnlyRow label="Puerta fiscal" value={payments.fiscalLegalGateOpen ? 'Abierta' : 'Cerrada'} detail="Mientras esté cerrada no se emiten facturas desde Platform." />
          <ReadOnlyRow label="Conservación de documentos" value={payments.documentRetentionMonths == null ? 'Sin definir' : `${payments.documentRetentionMonths} meses`} />
          <ReadOnlyRow label="Métodos de pago" value={<span className="settings-chips">{payments.methods.map((method) => <StatusChip key={method} tone="neutral" icon={null}>{methodLabel[method] ?? method}</StatusChip>)}</span>} />
        </dl></> : <EmptyState icon={icons.Wallet} title="Sin reglas de pago configuradas" role="status">Economía aún no tiene sus reglas iniciales.</EmptyState>;
      case 'store': return <>
        <div className="settings-notice is-connected" role="note"><StatusChip tone="success" icon={null}>Catálogo conectado</StatusChip><span>Productos, variantes, inventario y ventas se gestionan en Tienda.</span></div>
        <a className="settings-link" href="#store">Abrir Tienda para gestionar el catálogo</a>
        <p className="settings-hint">La configuración de stock no muestra un umbral editable hasta que exista una regla aprobada y guardada por Platform.</p></>;
      case 'permissions': return <>
        <div className="settings-notice is-connected" role="note"><StatusChip tone="success" icon={null}>Conectado</StatusChip><span>Los permisos van por perfiles, nunca por persona. Estos perfiles se leen de la configuración real; cambiarlos requiere aprobación del propietario.</span></div>
        <div className="settings-profiles">{data.profiles.map((profile) => <Card as="section" key={profile.id} className="settings-profile" aria-label={`Perfil ${profile.label}`}>
          <CardHeader title={profile.label} level={3} description={profile.wildcard ? 'Acceso completo' : `${profile.permissionCount} permisos`} />
          {profile.wildcard ? <p className="settings-hint">Puede hacerlo todo, salvo lo que exija una autorización explícita.</p>
            : <ul className="settings-groups">{profile.groups.map((group) => <li key={group.id}><strong>{group.label}</strong><span>{group.permissions.length} {group.permissions.length === 1 ? 'permiso' : 'permisos'}</span></li>)}</ul>}
        </Card>)}</div></>;
      default: return <>
        <div className="settings-notice is-connected" role="note"><StatusChip tone="success" icon={null}>Conectado</StatusChip><span>Solo se muestra si cada integración está activada o no. No se enseña ninguna clave ni dirección.</span></div>
        <ul className="settings-integrations">{Object.entries(integrationLabel).map(([key, label]) => <li key={key}><span>{label}</span><StatusChip tone={data.integrations[key] ? 'success' : 'neutral'} icon={null}>{data.integrations[key] ? 'Activada' : 'Desactivada'}</StatusChip></li>)}</ul>
        <p className="settings-hint">Para avisos y recordatorios, ve a <a href="#notification-settings">Ajustes de avisos</a>.</p></>;
    }
  })();

  return <main className="summary settings-page" id="settings" data-2j-design="v2">
    {header}
    <Card as="section" padding="none" className="summary-card" aria-label="Ajustes">
      <Tabs label="Secciones de configuración" items={TABS} value={tab} onChange={setTab} panelId="settings-panel" idPrefix="settings-tab" />
      <section className="settings-panel" id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${tab}`} tabIndex={0}>{body}</section>
    </Card>
  </main>;
}
