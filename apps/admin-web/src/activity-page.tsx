import React from 'react';
import { Button, Card, CardHeader, Icon, PageHeader, SegmentedControl, StatusChip, icons } from '@2j/ui';
import { useCommandCenter } from './app-shell.js';
import { AttentionCard, attentionOf } from './command-center.js';

const apiUrl = import.meta.env?.VITE_API_URL ?? 'http://127.0.0.1:3100';

type AuditItem = { id: string; area: 'economy' | 'staff' | 'calendar' | 'communication' | 'store'; occurredAt: string; actorId: string; action: string; resourceType: string };
type Cursor = { beforeAt: string; beforeId: string };
type AuditState = { status: 'idle' | 'loading' | 'ready' | 'denied' | 'error'; items: AuditItem[]; cursor: Cursor | null; loadingMore: boolean };

const areaLabels: Record<AuditItem['area'], string> = { economy: 'Economía', staff: 'Equipo', calendar: 'Agenda', communication: 'Comunicación', store: 'Tienda' };
const stamp = new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Actividad (paridad visual 4): pestañas Avisos y Auditoría. Avisos reutiliza lo que ya calcula el Resumen; Auditoría lee el registro append-only. */
export function ActivityPage() {
  const { data, state, error, reload } = useCommandCenter();
  const [tab, setTab] = React.useState<'alerts' | 'audit'>('alerts');
  const [audit, setAudit] = React.useState<AuditState>({ status: 'idle', items: [], cursor: null, loadingMore: false });
  const [term, setTerm] = React.useState('');

  const loadAudit = React.useCallback(async (cursor: Cursor | null) => {
    setAudit((previous) => cursor ? { ...previous, loadingMore: true } : { status: 'loading', items: [], cursor: null, loadingMore: false });
    try {
      const params = new URLSearchParams({ limit: '40' });
      if (cursor) { params.set('beforeAt', cursor.beforeAt); params.set('beforeId', cursor.beforeId); }
      const response = await fetch(`${apiUrl}/api/activity/audit?${params}`);
      if (response.status === 403) { setAudit({ status: 'denied', items: [], cursor: null, loadingMore: false }); return; }
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json() as { items: AuditItem[]; nextCursor: Cursor | null };
      setAudit((previous) => ({ status: 'ready', items: cursor ? [...previous.items, ...body.items] : body.items, cursor: body.nextCursor, loadingMore: false }));
    } catch {
      setAudit((previous) => cursor ? { ...previous, loadingMore: false } : { status: 'error', items: [], cursor: null, loadingMore: false });
    }
  }, []);

  React.useEffect(() => { if (tab === 'audit' && audit.status === 'idle') void loadAudit(null); }, [tab, audit.status, loadAudit]);

  const refresh = () => { void reload(); if (tab === 'audit') void loadAudit(null); };
  const description = 'Avisos operativos y registro de auditoría del centro.';
  const rows = data ? attentionOf(data).rows : [];
  const needle = term.trim().toLowerCase();
  const visible = needle ? audit.items.filter((item) => `${item.action} ${item.resourceType} ${areaLabels[item.area]}`.toLowerCase().includes(needle)) : audit.items;

  return <main className="summary activity-page" id="activity" data-2j-design="v2">
    <PageHeader title="Actividad" description={description} actions={<Button icon={icons.RefreshCw} loading={state === 'loading'} onClick={refresh}>Actualizar</Button>} />
    <div className="activity-tabs"><SegmentedControl label="Vista de actividad" value={tab} onChange={setTab} options={[{ value: 'alerts', label: 'Avisos' }, { value: 'audit', label: 'Auditoría' }]} /></div>

    {tab === 'alerts' && (data
      ? <AttentionCard rows={rows} title="Avisos" />
      : state === 'error'
        ? <Card className="summary-state summary-error" role="alert"><strong>No se pudieron cargar los avisos</strong><span>{error}</span><Button onClick={() => void reload()}>Reintentar</Button></Card>
        : <Card className="summary-state" role="status"><span className="spinner" /> Preparando los avisos…</Card>)}

    {tab === 'audit' && <Card as="section" padding="none" className="summary-card" aria-labelledby="activity-audit-title">
      <div className="summary-card-head"><CardHeader title="Auditoría" titleId="activity-audit-title" description="Quién hizo qué y cuándo. Solo se muestra la acción y el tipo de registro, nunca el contenido." actions={audit.status === 'ready' ? <StatusChip tone="neutral" icon={null}>{visible.length}</StatusChip> : null} /></div>
      {audit.status === 'ready' && audit.items.length > 0 && <div className="activity-filter"><label>Filtrar por acción<input type="search" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="payment, cash, session…" /></label></div>}
      {(audit.status === 'idle' || audit.status === 'loading') && <div className="summary-state" role="status"><span className="spinner" /> Cargando el registro…</div>}
      {audit.status === 'denied' && <div className="summary-empty" role="alert"><span className="summary-empty-icon"><Icon icon={icons.ShieldCheck} size={24} /></span><strong>Tu perfil no puede consultar la auditoría.</strong><span>Pide ayuda a una persona con permiso de auditoría.</span></div>}
      {audit.status === 'error' && <div className="summary-state summary-error" role="alert"><strong>No se pudo cargar el registro</strong><Button onClick={() => void loadAudit(null)}>Reintentar</Button></div>}
      {audit.status === 'ready' && (audit.items.length === 0
        ? <div className="summary-empty"><span className="summary-empty-icon"><Icon icon={icons.Activity} size={24} /></span><strong>Sin registros todavía</strong><span>Las acciones importantes quedan registradas aquí automáticamente.</span></div>
        : <ul className="summary-list activity-audit-list" aria-label="Registro de auditoría">{visible.map((item) => <li key={item.id}>
          <div className="summary-row activity-audit-row">
            <span className="summary-row-copy"><strong><code>{item.action}</code></strong><small>{areaLabels[item.area]} · {item.resourceType} · {item.actorId}</small></span>
            <time dateTime={item.occurredAt}>{stamp.format(new Date(item.occurredAt))}</time>
          </div>
        </li>)}{visible.length === 0 && <li className="summary-row"><span className="summary-row-copy"><small>Ninguna acción coincide con «{term.trim()}».</small></span></li>}</ul>)}
      {audit.status === 'ready' && audit.cursor && <div className="activity-more"><Button variant="ghost" loading={audit.loadingMore} onClick={() => void loadAudit(audit.cursor)}>Cargar más</Button></div>}
    </Card>}
  </main>;
}
