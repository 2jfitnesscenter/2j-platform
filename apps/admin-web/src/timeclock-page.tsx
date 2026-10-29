import React from 'react';
import { Button, Card, CardHeader, EmptyState, Icon, PageHeader, StatusChip, icons } from '@2j/ui';
import { clearDeepLink, readDeepLink } from './deep-link.js';

const apiUrl = import.meta.env?.VITE_API_URL ?? 'http://127.0.0.1:3100';

type ClockEvent = { id: string; eventType: 'clock_in' | 'clock_out'; effectiveOccurredAt: string; origin: string };
type SelfClock = { openShift: boolean; lastEvent: { eventType: 'clock_in' | 'clock_out'; occurredAt: string } | null; history: ClockEvent[] };
type LoadState = { status: 'loading' } | { status: 'ready'; data: SelfClock } | { status: 'unlinked' } | { status: 'denied' } | { status: 'error'; message: string };

const time = new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', hour: '2-digit', minute: '2-digit' });
const isoDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit' });
const shortDate = new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', day: 'numeric', month: 'short', year: 'numeric' });
const originLabel: Record<string, string> = { web: 'Panel web', staff_app: 'Móvil' };

type Shift = { id: string; day: string; startedAt: string; endedAt: string | null; origin: string };
/** Empareja cada entrada con la siguiente salida (como la tabla del prototipo). Una entrada sin salida es una jornada abierta; nunca se inventa la hora de salida (D123). */
function toShifts(events: ClockEvent[]): Shift[] {
  const ordered = [...events].sort((a, b) => Date.parse(a.effectiveOccurredAt) - Date.parse(b.effectiveOccurredAt));
  const shifts: Shift[] = [];
  for (const event of ordered) {
    if (event.eventType === 'clock_in') shifts.push({ id: event.id, day: isoDate.format(new Date(event.effectiveOccurredAt)), startedAt: event.effectiveOccurredAt, endedAt: null, origin: event.origin });
    else { const open = shifts[shifts.length - 1]; if (open && open.endedAt === null) open.endedAt = event.effectiveOccurredAt; }
  }
  return shifts.reverse();
}

async function readJson(response: Response) { try { return await response.json(); } catch { return {}; } }

/**
 * Fichaje (paridad visual 6, referencia: TimeClock.jsx). Estado de la jornada propia, fichar entrada/salida y «Mis fichajes».
 * D121: lista cronológica con filtro de fechas, sin totales ni comparativas (por eso no se repiten las horas acumuladas del prototipo).
 * Los registros no se pueden editar aquí; la corrección con motivo es de otra pantalla.
 */
export function TimeClockPage() {
  const [state, setState] = React.useState<LoadState>({ status: 'loading' });
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState('');
  const [error, setError] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const pendingToggle = React.useRef(readDeepLink(['intent'] as const).intent === 'toggle');
  React.useEffect(() => { clearDeepLink(['intent']); }, []);

  const load = React.useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/timeclock/self`);
      if (response.status === 404) { setState({ status: 'unlinked' }); return; }
      if (response.status === 403 || response.status === 401) { setState({ status: 'denied' }); return; }
      if (!response.ok) throw new Error(String(response.status));
      setState({ status: 'ready', data: await response.json() as SelfClock });
    } catch (caught) {
      setState({ status: 'error', message: caught instanceof Error ? caught.message : 'No se pudo cargar el fichaje.' });
    }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  async function punch(kind: 'clock-in' | 'clock-out') {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`${apiUrl}/api/timeclock/${kind}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ origin: 'web' }) });
      if (!response.ok) { const body = await readJson(response) as { error?: string }; throw new Error(body.error === 'shift_already_open' ? 'Ya tienes una jornada abierta.' : body.error === 'no_open_shift' ? 'No tienes una jornada abierta.' : body.error === 'cash_register_must_be_closed_or_handed_over' ? 'Antes de fichar la salida, cierra la caja o entrégasela a otra persona que ya haya fichado.' : 'No se pudo fichar. Inténtalo de nuevo.'); }
      setNotice(kind === 'clock-in' ? 'Entrada registrada.' : 'Salida registrada.');
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No se pudo fichar.'); } finally { setBusy(false); }
  }

  React.useEffect(() => {
    if (state.status !== 'ready' || !pendingToggle.current) return;
    pendingToggle.current = false;
    void punch(state.data.openShift ? 'clock-out' : 'clock-in');
  }, [state]);

  const header = <PageHeader title="Fichaje" description="Registro horario del equipo en hora de Canarias. Los fichajes quedan registrados y no se pueden borrar." actions={<Button icon={icons.RefreshCw} onClick={() => void load()}>Actualizar</Button>} />;
  if (state.status === 'loading') return <main className="summary timeclock-page" id="timeclock" data-2j-design="v2">{header}<Card className="summary-state" role="status"><span className="spinner" /> Cargando tu fichaje…</Card></main>;
  if (state.status === 'error') return <main className="summary timeclock-page" id="timeclock" data-2j-design="v2">{header}<Card className="summary-state summary-error" role="alert"><strong>No se pudo cargar el fichaje</strong><Button onClick={() => void load()}>Reintentar</Button></Card></main>;
  if (state.status === 'unlinked' || state.status === 'denied') return <main className="summary timeclock-page" id="timeclock" data-2j-design="v2">{header}<Card><EmptyState icon={icons.ShieldCheck} title={state.status === 'unlinked' ? 'Tu cuenta no está vinculada a una ficha de profesional' : 'Tu perfil no puede fichar'} role="status">{state.status === 'unlinked' ? 'Pide a Administración que vincule tu cuenta para poder fichar.' : 'Pide ayuda a una persona con permiso de fichaje.'}</EmptyState></Card></main>;

  const { data } = state;
  const shifts = toShifts(data.history);
  const filtered = shifts.filter((shift) => (!from || shift.day >= from) && (!to || shift.day <= to));
  const lastTime = data.lastEvent ? time.format(new Date(data.lastEvent.occurredAt)) : null;

  return <main className="summary timeclock-page" id="timeclock" data-2j-design="v2">
    {header}
    {notice && <div className="client-feedback" role="status"><Icon icon={icons.CircleCheck} size={20} />{notice}</div>}
    {error && <div className="form-error" role="alert">{error}</div>}
    <Card as="section" aria-labelledby="timeclock-state-title">
      <CardHeader title={data.openShift ? 'Jornada en curso' : 'Sin jornada abierta'} titleId="timeclock-state-title" level={2}
        description={data.openShift && lastTime ? `Entrada fichada a las ${lastTime}. Ficha la salida al terminar.` : 'Ficha tu entrada al empezar.'}
        actions={<span className="timeclock-head-actions"><StatusChip tone={data.openShift ? 'success' : 'neutral'} icon={null}>{data.openShift ? 'Abierta' : 'Cerrada'}</StatusChip>
          {data.openShift
            ? <Button variant="primary" icon={icons.LogOut} loading={busy} onClick={() => void punch('clock-out')}>Fichar salida</Button>
            : <Button variant="primary" icon={icons.LogIn} loading={busy} onClick={() => void punch('clock-in')}>Fichar entrada</Button>}</span>} />
    </Card>
    <Card as="section" padding="none" className="summary-card" aria-labelledby="timeclock-history-title">
      <div className="summary-card-head"><CardHeader title="Mis fichajes" titleId="timeclock-history-title" description="Del más reciente al más antiguo." /></div>
      <div className="timeclock-filter">
        <label>Desde<input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>Hasta<input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} /></label>
        {(from || to) && <Button variant="ghost" size="sm" onClick={() => { setFrom(''); setTo(''); }}>Quitar filtro</Button>}
      </div>
      {filtered.length === 0
        ? <div className="summary-empty"><span className="summary-empty-icon"><Icon icon={icons.Clock} size={24} /></span><strong>{shifts.length === 0 ? 'Aún no has fichado' : 'Sin fichajes en estas fechas'}</strong><span>{shifts.length === 0 ? 'Cuando fiches entrada o salida aparecerá aquí.' : 'Cambia o quita el filtro para ver más.'}</span></div>
        : <div className="timeclock-table-wrap"><table className="timeclock-table"><caption className="sr-only">Mis fichajes, del más reciente al más antiguo</caption>
          <thead><tr><th scope="col">Día</th><th scope="col">Entrada</th><th scope="col">Salida</th><th scope="col">Estado</th></tr></thead>
          <tbody>{filtered.map((shift) => <tr key={shift.id}>
            <th scope="row">{shortDate.format(new Date(shift.startedAt))}</th>
            <td><time dateTime={shift.startedAt}>{time.format(new Date(shift.startedAt))}</time><small>{originLabel[shift.origin] ?? shift.origin}</small></td>
            <td>{shift.endedAt ? <time dateTime={shift.endedAt}>{time.format(new Date(shift.endedAt))}</time> : <span aria-label="Sin salida registrada">—</span>}</td>
            <td><StatusChip tone={shift.endedAt ? 'neutral' : 'success'} icon={null}>{shift.endedAt ? 'Cerrado' : 'Abierto'}</StatusChip></td>
          </tr>)}</tbody></table></div>}
    </Card>
  </main>;
}
