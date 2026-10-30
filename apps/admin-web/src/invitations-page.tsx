import React from 'react';
import { apiFetch } from './api-fetch.js';
import { Button, Card, CardHeader, EmptyState, PageHeader, StatusChip, icons } from '@2j/ui';
import { Modal } from './modal.js';

const api = import.meta.env?.VITE_API_URL ?? 'http://localhost:3100';
type ReviewStatus = 'open' | 'approved' | 'rejected' | 'dismissed';
type ReviewCase = {
  id: string;
  personId: string;
  reason: string;
  memberNote: string | null;
  status: ReviewStatus;
  createdAt: string;
  person?: { displayName: string };
  resolution?: { verificationMethod: string | null; resolvedAt: string | null };
};
type ReviewEvent = { action: string; actor: string; occurredAt: string };
type Detail = { v: 1; case: ReviewCase; events: ReviewEvent[] };
type LoadState = 'loading' | 'ready' | 'denied' | 'error';
type Action = 'approve' | 'reject' | 'dismiss';

const reasonLabels: Record<string, string> = {
  lost_passkey: 'Ha perdido el dispositivo de acceso',
  no_access_to_training_account: 'No puede acceder a su cuenta de Búnker',
  proof_failed: 'No pudo completar la verificación',
  other: 'Otro motivo',
};
const statusLabels: Record<ReviewStatus, string> = { open: 'Pendiente', approved: 'Revisada para vincular', rejected: 'Rechazada', dismissed: 'Descartada' };
const eventLabels: Record<string, string> = { opened: 'Solicitud recibida', approved: 'Aprobada para vincular', rejected: 'Rechazada', dismissed: 'Descartada' };
const dateTime = new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', dateStyle: 'medium', timeStyle: 'short' });

/** Bandeja real de revisiones H13 existentes. No crea invitaciones ni activa cuentas en Búnker. */
export function InvitationsPage() {
  const [items, setItems] = React.useState<ReviewCase[]>([]);
  const [filter, setFilter] = React.useState<'open' | 'all'>('open');
  const [state, setState] = React.useState<LoadState>('loading');
  const [error, setError] = React.useState('');
  const [selected, setSelected] = React.useState<ReviewCase | null>(null);
  const [detail, setDetail] = React.useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [action, setAction] = React.useState<Action | null>(null);
  const [note, setNote] = React.useState('');
  const [trainingUserId, setTrainingUserId] = React.useState('');
  const [verification, setVerification] = React.useState<'in_person' | 'other_verified'>('in_person');
  const [busy, setBusy] = React.useState(false);
  const [feedback, setFeedback] = React.useState('');
  const [dialogError, setDialogError] = React.useState('');

  const load = React.useCallback(async () => {
    setState('loading'); setError('');
    try {
      const response = await apiFetch(`${api}/api/platform/v1/training-link-review?status=${filter}&limit=50`, { cache: 'no-store' });
      if (response.status === 401 || response.status === 403) { setState('denied'); return; }
      if (response.status === 423) { setState('error'); setError('La revisión de vínculos está desactivada en este entorno.'); return; }
      if (!response.ok) throw new Error('No se pudieron cargar las solicitudes.');
      const body = await response.json() as { v: 1; cases: ReviewCase[] };
      setItems(body.cases); setState('ready');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No se pudieron cargar las solicitudes.'); setState('error'); }
  }, [filter]);

  React.useEffect(() => { void load(); }, [load]);

  async function openDetail(item: ReviewCase) {
    setSelected(item); setDetail(null); setDetailLoading(true); setFeedback('');
    try {
      const response = await apiFetch(`${api}/api/platform/v1/training-link-review/${item.id}`, { cache: 'no-store' });
      if (response.status === 401 || response.status === 403) throw new Error('Tu perfil ya no puede consultar esta solicitud.');
      if (!response.ok) throw new Error('No se pudo abrir el detalle.');
      setDetail(await response.json() as Detail);
    } catch (caught) { setFeedback(caught instanceof Error ? caught.message : 'No se pudo abrir el detalle.'); }
    finally { setDetailLoading(false); }
  }

  function startAction(next: Action) {
    if (!selected || selected.status !== 'open') return;
    setAction(next); setNote(''); setTrainingUserId(''); setDialogError('');
  }

  async function resolve(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !action || note.trim().length < 10 || (action === 'approve' && !trainingUserId.trim())) return;
    setBusy(true); setDialogError('');
    try {
      const response = await apiFetch(`${api}/api/platform/v1/training-link-review/${selected.id}/resolve`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, note: note.trim(), ...(action === 'approve' ? { trainingUserId: trainingUserId.trim(), verification: { method: verification } } : {}) }),
      });
      if (response.status === 409) throw new Error('La solicitud ya cambió o la identidad indicada ya está vinculada. Actualiza la bandeja.');
      if (response.status === 401 || response.status === 403) throw new Error('Tu perfil no puede resolver esta solicitud.');
      if (!response.ok) throw new Error('No se pudo guardar la resolución. Comprueba la nota y vuelve a intentarlo.');
      setAction(null); setFeedback(action === 'approve' ? 'Revisión aprobada y auditada. Esto no crea la cuenta ni activa el acceso a Búnker.' : action === 'reject' ? 'Solicitud rechazada y auditada.' : 'Solicitud descartada y auditada.');
      await load();
      const refreshed = await apiFetch(`${api}/api/platform/v1/training-link-review/${selected.id}`, { cache: 'no-store' });
      if (refreshed.ok) setDetail(await refreshed.json() as Detail);
    } catch (caught) { setDialogError(caught instanceof Error ? caught.message : 'No se pudo guardar la resolución.'); }
    finally { setBusy(false); }
  }

  return <main className="summary invitations-page app-page" id="invitations" data-2j-design="v2">
    <PageHeader title="Invitaciones" description="Revisa solicitudes de vinculación de personas ya registradas en Platform." actions={<Button icon={icons.RefreshCw} loading={state === 'loading'} onClick={() => void load()}>Actualizar</Button>} />
    <Card className="invitations-boundary" role="note"><strong>Alcance actual</strong><span>Esta bandeja registra revisiones H13. No envía invitaciones, no crea cuentas en Búnker y una aprobación no activa el vínculo ni el acceso.</span><span>La activación asistida con confirmación de Búnker sigue <b>No conectada</b>.</span></Card>
    <section className="invitations-layout" aria-label="Bandeja de vinculaciones">
      <Card as="section" padding="none" className="summary-card invitations-list" aria-labelledby="invitations-list-title">
        <div className="summary-card-head"><CardHeader title="Solicitudes" titleId="invitations-list-title" description="Revisiones de acceso a una cuenta Búnker existente." actions={state === 'ready' ? <StatusChip tone="neutral" icon={null}>{items.length}</StatusChip> : null} /></div>
        <div className="invitations-filter"><label>Mostrar<select aria-label="Filtrar solicitudes" value={filter} onChange={event => setFilter(event.target.value as 'open' | 'all')}><option value="open">Pendientes</option><option value="all">Todas</option></select></label></div>
        {(state === 'loading') && <div className="summary-state" role="status"><span className="spinner" /> Cargando solicitudes…</div>}
        {state === 'denied' && <div className="summary-empty" role="alert"><strong>Tu perfil no puede revisar vinculaciones</strong><span>Esta información está reservada a personal autorizado para gestionar identidades.</span></div>}
        {state === 'error' && <div className="summary-state summary-error" role="alert"><strong>No se pudo cargar la bandeja</strong><span>{error}</span><Button onClick={() => void load()}>Reintentar</Button></div>}
        {state === 'ready' && items.length === 0 && <EmptyState icon={icons.UserRound} title={filter === 'open' ? 'No hay solicitudes pendientes' : 'Aún no hay solicitudes'}>Las solicitudes nuevas aparecerán aquí cuando una persona pida revisión desde su cuenta.</EmptyState>}
        {state === 'ready' && items.length > 0 && <ul className="summary-list invitations-items" aria-label="Solicitudes de vinculación">{items.map(item => <li key={item.id}><button type="button" className={`invitations-item ${selected?.id === item.id ? 'is-selected' : ''}`} onClick={() => void openDetail(item)} aria-current={selected?.id === item.id ? 'true' : undefined}><span className="invitations-item-copy"><strong>{item.person?.displayName || 'Persona Platform'}</strong><small>{reasonLabels[item.reason] ?? 'Motivo de revisión'}</small><time dateTime={item.createdAt}>{dateTime.format(new Date(item.createdAt))}</time></span><StatusChip tone={item.status === 'open' ? 'warning' : item.status === 'approved' ? 'success' : 'neutral'} icon={null}>{statusLabels[item.status]}</StatusChip></button></li>)}</ul>}
      </Card>
      <Card as="section" padding="none" className="summary-card invitations-detail" aria-labelledby="invitations-detail-title">
        <div className="summary-card-head"><CardHeader title="Detalle de revisión" titleId="invitations-detail-title" description="El motivo y las acciones quedan registrados en auditoría." /></div>
        {!selected && <EmptyState icon={icons.ShieldCheck} title="Selecciona una solicitud">La revisión requiere comprobar la titularidad por un canal verificado; no se busca por correo ni teléfono.</EmptyState>}
        {selected && <div className="invitations-detail-body">
          {detailLoading && <p role="status">Cargando detalle…</p>}
          {feedback && <p className="invitations-feedback" role="status">{feedback}</p>}
          {!detailLoading && detail && <>
            <dl className="invitations-facts"><div><dt>Persona</dt><dd>{detail.case.person?.displayName || 'Persona Platform'}</dd></div><div><dt>Motivo</dt><dd>{reasonLabels[detail.case.reason] ?? 'Motivo no reconocido'}</dd></div><div><dt>Estado</dt><dd>{statusLabels[detail.case.status]}</dd></div><div><dt>Recibida</dt><dd>{dateTime.format(new Date(detail.case.createdAt))}</dd></div></dl>
            {detail.case.memberNote && <section className="invitations-member-note"><h3>Nota de la persona</h3><p>{detail.case.memberNote}</p></section>}
            {detail.events.length > 0 && <section className="invitations-history"><h3>Historial</h3><ol>{detail.events.map((event, index) => <li key={`${event.action}-${event.occurredAt}-${index}`}><strong>{eventLabels[event.action] ?? 'Actualización registrada'}</strong><time dateTime={event.occurredAt}>{dateTime.format(new Date(event.occurredAt))}</time></li>)}</ol></section>}
            {detail.case.status === 'open' && <div className="invitations-actions"><Button variant="primary" onClick={() => startAction('approve')}>Aprobar revisión</Button><Button variant="secondary" onClick={() => startAction('reject')}>Rechazar</Button><Button variant="ghost" onClick={() => startAction('dismiss')}>Descartar</Button></div>}
          </>}
        </div>}
      </Card>
    </section>
    {action && selected && <Modal titleId="invitations-resolve-title" title={action === 'approve' ? 'Aprobar revisión' : action === 'reject' ? 'Rechazar solicitud' : 'Descartar solicitud'} description={action === 'approve' ? 'Confirma la comprobación de titularidad. Esta aprobación no enlaza ni activa la cuenta de Búnker.' : 'La resolución quedará registrada y no se podrá cambiar desde esta solicitud.'} onClose={() => setAction(null)} closeDisabled={busy}>
      <form className="invitations-resolve-form" onSubmit={resolve}>
        {action === 'approve' && <><label>Identificador de la cuenta Búnker verificada<input data-modal-initial-focus autoComplete="off" value={trainingUserId} onChange={event => setTrainingUserId(event.target.value)} maxLength={200} required /></label><label>Comprobación<select value={verification} onChange={event => setVerification(event.target.value as typeof verification)}><option value="in_person">Comprobación presencial</option><option value="other_verified">Otro canal verificado</option></select></label><p className="invitations-form-note">No uses correo, teléfono ni nombre para buscar o emparejar la cuenta. El vínculo H13 bilateral aún no está conectado.</p></>}
        <label>Motivo de la decisión (mínimo 10 caracteres)<textarea data-modal-initial-focus={action === 'approve' ? undefined : true} value={note} onChange={event => setNote(event.target.value)} minLength={10} maxLength={500} required /></label>
        {dialogError && <p className="invitations-error" role="alert">{dialogError}</p>}
        <div className="invitations-dialog-actions"><Button variant="ghost" type="button" disabled={busy} onClick={() => setAction(null)}>Cancelar</Button><Button variant="primary" type="submit" loading={busy} disabled={busy || note.trim().length < 10 || (action === 'approve' && !trainingUserId.trim())}>{busy ? 'Guardando…' : 'Guardar resolución'}</Button></div>
      </form>
    </Modal>}
  </main>;
}
