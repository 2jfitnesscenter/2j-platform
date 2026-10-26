import React from 'react';
import { Button, Card, CardHeader, EmptyState, PageHeader, StatusChip, Tabs, icons } from '@2j/ui';

const apiUrl = import.meta.env?.VITE_API_URL ?? 'http://127.0.0.1:3100';

type Profile = { id: string; label: string; wildcard: boolean; permissionCount: number | null; groups: Array<{ id: string; label: string; permissions: string[] }> };
type Overview = {
  timezone: string;
  payments: { dueDay: number; graceDays: number; timezone: string; debtBlocksNewReservations: boolean; fiscalLegalGateOpen: boolean; documentRetentionMonths: number | null; methods: string[] } | null;
  profiles: Profile[];
  integrations: Record<string, boolean>;
};
type LoadState = { status: 'loading' } | { status: 'ready'; data: Overview } | { status: 'denied' } | { status: 'error' };

const TABS = [
  { id: 'center', label: 'Centro' }, { id: 'appearance', label: 'Apariencia' }, { id: 'booking', label: 'Reservas' }, { id: 'payments', label: 'Pagos' },
  { id: 'store', label: 'Tienda' }, { id: 'permissions', label: 'Permisos' }, { id: 'integrations', label: 'Integraciones' },
];
const methodLabel: Record<string, string> = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', direct_debit: 'Domiciliación', other: 'Otro' };
const integrationLabel: Record<string, string> = {
  trainingSso: 'Acceso único con Búnker (SSO)', trainingServiceCalls: 'Llamadas de servicio a Búnker', trainingLinking: 'Vinculación de clientes con Búnker', trainingSignals: 'Señales de entrenamiento',
  trainingProvisioning: 'Alta automática en Búnker', push: 'Notificaciones push', passkeys: 'Acceso con llaves de acceso (passkeys)', memberAuthPilot: 'Acceso de clientes (piloto)', memberBookingPilot: 'Reservas de clientes (piloto)',
};

/** Aviso visible en toda sección cuyos ajustes aún no tienen API: nada de lo que se ve en ella se guarda. */
function NotConnected({ children }: { children?: React.ReactNode }) {
  return <div className="settings-notice" role="note"><StatusChip tone="warning" icon={null}>No conectado</StatusChip><span><strong>No conectado: estos ajustes todavía no se guardan.</strong> {children}</span></div>;
}
function Field({ label, value, hint, wide }: { label: string; value?: string; hint?: string; wide?: boolean }) {
  return <label className={wide ? 'settings-field is-wide' : 'settings-field'}>{label}<input type="text" disabled defaultValue={value ?? ''} aria-disabled="true" />{hint && <small>{hint}</small>}</label>;
}
function ReadOnlyRow({ label, value, detail }: { label: string; value: React.ReactNode; detail?: string }) {
  return <div className="settings-row"><dt>{label}</dt><dd>{value}{detail && <small>{detail}</small>}</dd></div>;
}

/**
 * Configuración (paridad visual 11, referencia: Settings.jsx de Base44). Solo lectura: lo que Platform ya gobierna (reglas de pago, perfiles, estado de
 * integraciones) se muestra con datos reales; el resto de pestañas es solo interfaz y lo dice de forma visible. No hay botón de guardar.
 */
export function SettingsPage() {
  const [tab, setTab] = React.useState('center');
  const [state, setState] = React.useState<LoadState>({ status: 'loading' });
  const load = React.useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`${apiUrl}/api/settings/overview`, signal ? { signal } : undefined);
      if (response.status === 403 || response.status === 401) { setState({ status: 'denied' }); return; }
      if (!response.ok) throw new Error(String(response.status));
      setState({ status: 'ready', data: await response.json() as Overview });
    } catch (caught) { if ((caught as Error).name !== 'AbortError') setState({ status: 'error' }); }
  }, []);
  React.useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  const header = <PageHeader title="Configuración" description="Reglas del centro. De momento solo se consultan: ningún ajuste de esta pantalla se puede guardar." />;
  if (state.status === 'denied') return <main className="summary settings-page" id="settings" data-2j-design="v2">{header}<Card><EmptyState icon={icons.ShieldCheck} title="Tu perfil no puede consultar la configuración" role="status">Solo Administración puede ver esta pantalla.</EmptyState></Card></main>;
  const data = state.status === 'ready' ? state.data : null;

  const body = (() => {
    if (state.status === 'loading') return <div className="summary-state" role="status"><span className="spinner" /> Cargando la configuración…</div>;
    if (state.status === 'error' || !data) return <div className="summary-state summary-error" role="alert"><strong>No se pudo cargar la configuración</strong><Button onClick={() => { setState({ status: 'loading' }); void load(); }}>Reintentar</Button></div>;
    const payments = data.payments;
    switch (tab) {
      case 'center': return <>
        <NotConnected>Los datos del centro y el horario son una maqueta.</NotConnected>
        <div className="settings-grid"><Field label="Nombre comercial" value="2J Fitness Center" /><Field label="Teléfono" /><Field label="Correo de contacto" /><Field label="Dirección" wide /><Field label="Ciudad" /><Field label="Código postal" /></div>
        <h3 className="settings-subtitle">Horario y agenda</h3>
        <dl className="settings-list"><ReadOnlyRow label="Zona horaria" value={<>{data.timezone} <StatusChip tone="success" icon={null}>Conectado</StatusChip></>} detail="Fija para todo el centro; las horas se muestran siempre en hora de Canarias." /></dl>
        <div className="settings-grid"><Field label="Hora de apertura" /><Field label="Hora de cierre" /><Field label="Antelación máxima de reserva (días)" /></div>
        <p className="settings-hint">Los datos fiscales (razón social, CIF/NIF, serie y pie de factura) no están aquí: la puerta fiscal sigue cerrada.</p></>;
      case 'appearance': return <>
        <NotConnected>El logo y los colores son una maqueta.</NotConnected>
        <div className="settings-grid"><Field label="Logo (URL)" wide /><Field label="Color de acento" value="#B7F000" /><Field label="Color de fondo" value="#1B1D1F" /></div>
        <div className="settings-preview" aria-label="Vista previa de ejemplo"><span className="settings-swatch" style={{ background: '#B7F000' }} /><span className="settings-swatch" style={{ background: '#1B1D1F' }} /><span>Vista previa de ejemplo</span></div></>;
      case 'booking': return <>
        <NotConnected>Cada servicio ya tiene sus propias reglas de reserva; esta pantalla no las sustituye.</NotConnected>
        <div className="settings-grid"><Field label="Horas mínimas para cancelar" /><Field label="Lista de espera" value="Activada" /></div>
        <ul className="settings-switches"><li><input type="checkbox" disabled aria-label="La cancelación tardía consume sesión" /> La cancelación tardía consume sesión</li><li><input type="checkbox" disabled aria-label="La no asistencia consume sesión" /> La no asistencia consume sesión</li></ul></>;
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
        <NotConnected>El catálogo de la tienda se gestiona desde Tienda.</NotConnected>
        <div className="settings-grid"><Field label="Categorías activas" /><Field label="Avisar cuando el stock baje de" /></div></>;
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
