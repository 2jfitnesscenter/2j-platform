import React from 'react';
import { Button, Card, CardHeader, EmptyState, PageHeader, StatusChip, icons } from '@2j/ui';

const apiUrl = import.meta.env?.VITE_API_URL ?? 'http://127.0.0.1:3100';

const denominations = [
  ['coin_0_01', 'Monedas de 1 céntimo', 1], ['coin_0_02', 'Monedas de 2 céntimos', 2], ['coin_0_05', 'Monedas de 5 céntimos', 5], ['coin_0_10', 'Monedas de 10 céntimos', 10],
  ['coin_0_20', 'Monedas de 20 céntimos', 20], ['coin_0_50', 'Monedas de 50 céntimos', 50], ['coin_1', 'Monedas de 1 €', 100], ['coin_2', 'Monedas de 2 €', 200],
  ['bill_5', 'Billetes de 5 €', 500], ['bill_10', 'Billetes de 10 €', 1000], ['bill_20', 'Billetes de 20 €', 2000], ['bill_50', 'Billetes de 50 €', 5000],
  ['bill_100', 'Billetes de 100 €', 10000], ['bill_200', 'Billetes de 200 €', 20000], ['bill_500', 'Billetes de 500 €', 50000],
] as const;
type DenominationKey = typeof denominations[number][0];

type RegisterCode = 'bunker' | 'sala';
type Register = { id: string; code: RegisterCode; name: string; available: boolean; ownCustody: boolean; sessionId: string | null };
type SessionStatus = 'open' | 'closed' | 'late_close';
type TodaySession = { id: string; registerCode: RegisterCode | null; status: SessionStatus; openedAt: string; closedAt: string | null; openingCents?: number; expectedCents?: number; countedCents?: number | null; differenceCents?: number | null };
type SessionRow = { id: string; registerCode: RegisterCode | null; registerName: string; localDate: string; status: SessionStatus; openedAt: string; closedAt: string | null; openedByName: string | null; closedByName: string | null; openingCents?: number; expectedCents?: number; countedCents?: number | null; differenceCents?: number | null };
type DayRow = { date: string; sessions: number; openCount: number; closed: boolean; expectedCents?: number; countedCents?: number | null; differenceCents?: number | null };
type Report = { from: string; to: string; items: SessionRow[]; days: DayRow[]; truncated: boolean };
type DenominationCount = Partial<Record<DenominationKey, number>> | null;
type CashMovement = { id: string; kind: string; amountCents: number; method?: string | null; occurredAt: string; concept?: string | null; reason?: string | null; status?: string | null; hasReceipt?: boolean };
type CashHandover = { id: string; outgoingDenominations: DenominationCount; incomingDenominations: DenominationCount; completedAt: string | null; mismatch: boolean | null; createdAt: string };
type DailyRegisterDetail = { id?: string; registerCode: RegisterCode | null; registerName: string; localDate: string; status: SessionStatus; openingDenominations?: DenominationCount; countedDenominations?: DenominationCount; movements: CashMovement[]; handovers?: CashHandover[] };
type DailyDetail = { items: DailyRegisterDetail[]; total?: { expectedCents: number; countedCents: number | null; differenceCents: number | null; balanced: boolean | null } };
type Loaded = { registers: Register[]; today: TodaySession[]; report: Report; daily: DailyDetail; ownerView: boolean };
type LoadState = { status: 'loading' } | { status: 'ready'; data: Loaded } | { status: 'denied' } | { status: 'error' };

const euro = (cents: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const timeFmt = new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
const formatDay = (isoDate: string) => dayFmt.format(new Date(`${isoDate}T00:00:00Z`));
const formatTime = (iso: string | null) => (iso ? timeFmt.format(new Date(iso)) : '—');
const statusText: Record<SessionStatus, string> = { open: 'Abierta', closed: 'Cerrada', late_close: 'Cerrada tarde' };
const errorText: Record<string, string> = {
  clock_in_required: 'Ficha tu entrada antes de abrir la caja.',
  already_holds_register: 'Ya tienes otra caja a tu cargo.',
  cash_already_open: 'Esa caja ya está abierta.',
  cash_register_already_used_today: 'Esa caja ya tuvo su sesión de hoy (una sesión por caja y día).',
  cash_session_previous_day_requires_owner_resolution: 'Hay una caja abierta de un día anterior. El propietario debe resolverla primero.',
  cash_legacy_session_requires_owner_resolution: 'Hay una caja anterior sin registro asignado. El propietario debe resolverla primero.',
  staff_account_unlinked: 'Tu cuenta no está vinculada a una ficha de equipo.',
  cash_outflow_approval_pending: 'Hay un gasto o retirada pendiente de aprobación del propietario.',
  cash_custodian_required: 'Solo quien tiene la caja a su cargo puede cerrarla.',
  cash_custodian_not_clocked_in: 'Ficha tu entrada antes de cerrar la caja.',
  cash_already_closed: 'Esa caja ya está cerrada.',
};
async function readJson(response: Response) { try { return await response.json(); } catch { return {}; } }
const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Atlantic/Canary' });
const validCount = (value: string | undefined) => /^(0|[1-9]\d{0,6})$/.test(value ?? '');

function DifferenceChip({ cents }: { cents: number | null | undefined }) {
  if (cents == null) return <span className="caja-muted">Pendiente</span>;
  if (cents === 0) return <StatusChip tone="success" icon={null}>Cuadra</StatusChip>;
  return <StatusChip tone="danger" icon={null}>{cents > 0 ? '+' : ''}{euro(cents)}</StatusChip>;
}

const movementLabels: Record<string, string> = { payment: 'Cobro', refund: 'Devolución', store_sale: 'Venta en tienda', store_sale_refund: 'Devolución de tienda', annulment: 'Anulación de tienda', expense: 'Gasto', withdrawal: 'Retirada', adjustment: 'Ajuste', cash_sale_annulment: 'Anulación de tienda' };
const paymentMethodLabels: Record<string, string> = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', bank_transfer: 'Transferencia bancaria', other: 'Otro medio' };
const movementTime = (iso: string) => timeFmt.format(new Date(iso));
const isOutflow = (kind: string) => ['refund', 'store_sale_refund', 'annulment', 'expense', 'withdrawal', 'cash_sale_annulment'].includes(kind);

function DenominationBreakdown({ title, counts }: { title: string; counts?: DenominationCount | undefined }) {
  if (!counts) return null;
  const entries = denominations.flatMap(([key, label]) => Number(counts[key] ?? 0) > 0 ? [`${label}: ${counts[key]}`] : []);
  return <details className="caja-denomination-detail"><summary>{title}</summary>{entries.length ? <ul>{entries.map(entry => <li key={entry}>{entry}</li>)}</ul> : <p className="caja-muted">Sin unidades contadas.</p>}</details>;
}

function CashMovementList({ movements }: { movements: CashMovement[] }) {
  if (!movements.length) return <p className="caja-muted">Sin movimientos registrados durante esta custodia.</p>;
  return <ol className="caja-movements">{movements.map((movement, index) => <li key={movement.id || `${movement.occurredAt}-${index}`}>
    <time dateTime={movement.occurredAt}>{movementTime(movement.occurredAt)}</time>
    <span><strong>{movementLabels[movement.kind] ?? 'Movimiento de caja'}</strong>{movement.concept ? ` · ${movement.concept}` : ''}{movement.reason ? ` · ${movement.reason}` : ''}{movement.method ? ` · ${paymentMethodLabels[movement.method] ?? 'Otro medio'}` : ''}{movement.hasReceipt ? ' · Justificante adjunto' : ''}{movement.status === 'pending_owner_approval' ? ' · Solicitud pendiente de aprobación' : movement.status === 'rejected' ? ' · Solicitud rechazada' : ''}</span>
    <strong>{movement.status === 'pending_owner_approval' || movement.status === 'rejected' ? '' : isOutflow(movement.kind) ? '−' : '+'}{euro(Number(movement.amountCents))}</strong>
  </li>)}</ol>;
}

function CountForm({ mode, registerName, busy, error, onSubmit, onCancel }: { mode: 'open' | 'close'; registerName: string; busy: boolean; error: string; onSubmit: (counts: Record<DenominationKey, number>) => void; onCancel: () => void }) {
  const [values, setValues] = React.useState<Record<string, string>>({});
  const valid = denominations.every(([key]) => validCount(values[key]));
  const total = valid ? denominations.reduce((sum, [key, , cents]) => sum + Number(values[key]) * cents, 0) : 0;
  const titleId = `caja-count-${mode}`;
  return <form className="caja-count" aria-labelledby={titleId} onSubmit={event => { event.preventDefault(); if (!valid) return; onSubmit(Object.fromEntries(denominations.map(([key]) => [key, Number(values[key])])) as Record<DenominationKey, number>); }}>
    <h3 id={titleId}>{mode === 'open' ? `Abrir ${registerName}` : `Cerrar ${registerName}`}</h3>
    <p className="caja-muted">{mode === 'open' ? 'Cuenta el fondo inicial por denominación.' : 'Recuento a ciegas: cuenta lo que hay por denominación. No verás el importe esperado.'} Usa 0 si no tienes ninguna.</p>
    <div className="caja-denominations">{denominations.map(([key, label], index) => <label key={key}>{label}
      <input inputMode="numeric" autoFocus={index === 0} value={values[key] ?? ''} onChange={event => setValues(current => ({ ...current, [key]: event.target.value.trim() }))} aria-invalid={values[key] !== undefined && !validCount(values[key])} /></label>)}</div>
    {mode === 'open' && valid && <p className="caja-total">Fondo contado: <strong>{euro(total)}</strong></p>}
    {error && <p className="caja-error" role="alert">{error}</p>}
    <div className="caja-actions"><Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancelar</Button><Button type="submit" variant="primary" loading={busy} disabled={!valid}>{mode === 'open' ? 'Abrir caja' : 'Cerrar caja'}</Button></div>
  </form>;
}

export function CajaPage() {
  const [state, setState] = React.useState<LoadState>({ status: 'loading' });
  const [registerFilter, setRegisterFilter] = React.useState<'all' | RegisterCode>('all');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [dialog, setDialog] = React.useState<{ mode: 'open' | 'close'; register: Register } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [dialogError, setDialogError] = React.useState('');
  const [feedback, setFeedback] = React.useState('');

  const load = React.useCallback(async () => {
    try {
      const query = new URLSearchParams();
      if (registerFilter !== 'all') query.set('registerCode', registerFilter);
      if (from) query.set('from', from);
      if (to) query.set('to', to);
      const suffix = query.toString() ? `?${query.toString()}` : '';
      const capsRes = await fetch(`${apiUrl}/api/session/capabilities`);
      if (!capsRes.ok) throw new Error('capabilities');
      const caps = await capsRes.json();
      const ownerView = caps.ownerPanel === true;
      const [registersRes, todayRes, reportRes, dailyRes] = await Promise.all([
        fetch(`${apiUrl}/api/economics/cash/registers`), fetch(`${apiUrl}/api/economics/cash/today`),
        fetch(`${apiUrl}/api/economics/cash/sessions${suffix}`),
        fetch(`${apiUrl}/api/economics/cash/${ownerView ? 'day' : 'today'}`),
      ]);
      if ([registersRes, todayRes, reportRes, dailyRes].some(res => res.status === 401 || res.status === 403)) { setState({ status: 'denied' }); return; }
      if (![registersRes, todayRes, reportRes, dailyRes].every(res => res.ok)) throw new Error('load');
      const [registers, todayBody, report, dailyBody] = await Promise.all([registersRes.json(), todayRes.json(), reportRes.json(), dailyRes.json()]);
      const dailyItems = ownerView ? (dailyBody.registers ?? []) : (dailyBody.session ? [dailyBody.session] : []);
      setState({ status: 'ready', data: { registers: registers.items ?? [], today: todayBody.items ?? [], report, daily: { items: dailyItems, total: ownerView ? dailyBody.total : undefined }, ownerView } });
    } catch { setState({ status: 'error' }); }
  }, [registerFilter, from, to]);
  React.useEffect(() => { void load(); }, [load]);

  async function submitCount(counts: Record<DenominationKey, number>) {
    if (!dialog) return;
    setBusy(true); setDialogError('');
    try {
      const response = dialog.mode === 'open'
        ? await fetch(`${apiUrl}/api/economics/cash/open`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ registerCode: dialog.register.code, openingDenominations: counts }) })
        : await fetch(`${apiUrl}/api/economics/cash/${dialog.register.sessionId}/close`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ countedDenominations: counts }) });
      const body = await readJson(response);
      if (!response.ok) { setDialogError(errorText[body.error as string] ?? body.message ?? 'No se pudo completar la operación. Inténtalo de nuevo.'); return; }
      setFeedback(dialog.mode === 'open' ? `${dialog.register.name} abierta.` : `${dialog.register.name} cerrada. El recuento queda registrado.`);
      setDialog(null);
      await load();
    } catch { setDialogError('No se pudo conectar con el servidor.'); } finally { setBusy(false); }
  }

  const header = <PageHeader title="Caja" description="Dos cajas físicas, Búnker y Sala: una sesión por caja y día, abierta y cerrada con recuento por denominación." actions={<Button icon={icons.RefreshCw} onClick={() => void load()}>Actualizar</Button>} />;
  const shell = (content: React.ReactNode) => <main className="summary caja-page" id="caja" data-2j-design="v2">{header}{content}</main>;
  if (state.status === 'loading') return shell(<Card className="summary-state" role="status"><span className="spinner" /> Cargando la caja…</Card>);
  if (state.status === 'error') return shell(<Card className="summary-state summary-error" role="alert"><strong>No se pudo cargar la caja</strong><Button onClick={() => void load()}>Reintentar</Button></Card>);
  if (state.status === 'denied') return shell(<Card><EmptyState icon={icons.ShieldCheck} title="Tu perfil no gestiona la caja">Pide acceso a quien administre los perfiles del equipo.</EmptyState></Card>);

  const { registers, today: todaySessions, report, daily, ownerView } = state.data;
  const hasOwnCustody = registers.some(register => register.ownCustody);
  const panels: Array<{ code: RegisterCode; name: string }> = [{ code: 'bunker', name: 'Búnker' }, { code: 'sala', name: 'Sala' }];
  return shell(<>
    {feedback && <div className="form-feedback" role="status">{feedback}</div>}
    <section className="caja-registers" aria-label="Sesión de cada caja">
      {panels.map(({ code, name }) => {
        const register = registers.find(row => row.code === code);
        const session = todaySessions.find(row => row.registerCode === code);
        const open = !!register && !register.available;
        const closedToday = !open && ((!!session && session.status !== 'open') || report.items.some(row => row.registerCode === code && row.localDate === todayIso() && row.status !== 'open'));
        return <Card key={code} as="article" className="caja-register" aria-labelledby={`caja-${code}-title`}>
          <CardHeader title={name} titleId={`caja-${code}-title`} level={2} actions={<StatusChip tone={open ? 'success' : 'neutral'} icon={null}>{open ? (register?.ownCustody ? 'Abierta · a tu cargo' : 'Abierta') : closedToday ? 'Cerrada hoy' : 'Sin abrir'}</StatusChip>} />
          {session && <p className="caja-muted">Abierta a las {formatTime(session.openedAt)}{session.closedAt ? ` · cerrada a las ${formatTime(session.closedAt)}` : ''}</p>}
          {ownerView && session?.expectedCents != null && <dl className="caja-figures"><div><dt>Fondo</dt><dd>{euro(session.openingCents ?? 0)}</dd></div><div><dt>Esperado</dt><dd>{euro(session.expectedCents)}</dd></div>{session.status !== 'open' && <div><dt>Diferencia</dt><dd><DifferenceChip cents={session.differenceCents} /></dd></div>}</dl>}
          {!ownerView && open && <p className="caja-muted">Recuento a ciegas: el importe esperado y la diferencia no se muestran al cajero.</p>}
          <div className="caja-actions">
            {register?.ownCustody && register.sessionId && <Button variant="primary" icon={icons.LogOut} onClick={() => { setFeedback(''); setDialogError(''); setDialog({ mode: 'close', register }); }}>Cerrar caja</Button>}
            {register && register.available && !hasOwnCustody && !closedToday && <Button variant="primary" icon={icons.LogIn} onClick={() => { setFeedback(''); setDialogError(''); setDialog({ mode: 'open', register }); }}>Abrir caja</Button>}
            {register && open && !register.ownCustody && <span className="caja-muted">Otra persona tiene esta caja a su cargo.</span>}
          </div>
        </Card>;
      })}
    </section>
    {dialog && <Card as="section" className="caja-count-card"><CountForm mode={dialog.mode} registerName={dialog.register.name} busy={busy} error={dialogError} onSubmit={counts => void submitCount(counts)} onCancel={() => setDialog(null)} /></Card>}

    <Card as="section" aria-labelledby="caja-daily-title" padding="none" className="summary-card">
      <div className="summary-card-head"><CardHeader title="Informe diario" titleId="caja-daily-title" description={ownerView ? 'Totales por día de las dos cajas. La diferencia solo aparece con el día cerrado.' : 'Sesiones por día. Los importes y la diferencia son solo del propietario.'} /></div>
      {report.days.length === 0 ? <EmptyState icon={icons.Wallet} title="Sin sesiones en este rango">Cuando se abra una caja aparecerá aquí.</EmptyState> :
        <div className="timeclock-table-wrap"><table className="timeclock-table caja-table"><thead><tr><th>Día</th><th>Sesiones</th><th>Estado</th>{ownerView && <><th>Esperado</th><th>Contado</th><th>Diferencia</th></>}</tr></thead>
          <tbody>{report.days.map(day => <tr key={day.date}><td>{formatDay(day.date)}</td><td>{day.sessions}</td><td><StatusChip tone={day.closed ? 'neutral' : 'success'} icon={null}>{day.closed ? 'Cerrado' : `${day.openCount} abierta${day.openCount === 1 ? '' : 's'}`}</StatusChip></td>
            {ownerView && <><td>{euro(day.expectedCents ?? 0)}</td><td>{day.countedCents == null ? '—' : euro(day.countedCents)}</td><td><DifferenceChip cents={day.differenceCents} /></td></>}</tr>)}</tbody></table></div>}
    </Card>

    <Card as="section" aria-labelledby="caja-sessions-title" padding="none" className="summary-card">
      <div className="summary-card-head"><CardHeader title="Sesiones por caja" titleId="caja-sessions-title" description={ownerView ? 'Todas las sesiones del rango.' : 'Solo las sesiones en las que has tenido la caja a tu cargo.'} /></div>
      <div className="caja-filters">
        <label>Caja<select value={registerFilter} onChange={event => setRegisterFilter(event.target.value as 'all' | RegisterCode)}><option value="all">Todas</option><option value="bunker">Búnker</option><option value="sala">Sala</option></select></label>
        <label>Desde<input type="date" value={from} max={to || todayIso()} onChange={event => setFrom(event.target.value)} /></label>
        <label>Hasta<input type="date" value={to} max={todayIso()} onChange={event => setTo(event.target.value)} /></label>
        {(from || to || registerFilter !== 'all') && <Button variant="ghost" size="sm" onClick={() => { setFrom(''); setTo(''); setRegisterFilter('all'); }}>Quitar filtros</Button>}
      </div>
      {report.items.length === 0 ? <EmptyState icon={icons.Wallet} title="Sin sesiones">No hay sesiones de caja para este filtro.</EmptyState> :
        <div className="timeclock-table-wrap"><table className="timeclock-table caja-table"><thead><tr><th>Día</th><th>Caja</th><th>Estado</th><th>Apertura</th><th>Cierre</th><th>Abre</th><th>Cierra</th>{ownerView && <><th>Fondo</th><th>Esperado</th><th>Contado</th><th>Diferencia</th></>}</tr></thead>
          <tbody>{report.items.map(row => <tr key={row.id}><td>{formatDay(row.localDate)}</td><td>{row.registerName}</td><td><StatusChip tone={row.status === 'open' ? 'success' : 'neutral'} icon={null}>{statusText[row.status]}</StatusChip></td><td>{formatTime(row.openedAt)}</td><td>{formatTime(row.closedAt)}</td><td>{row.openedByName ?? '—'}</td><td>{row.closedByName ?? '—'}</td>
            {ownerView && <><td>{euro(row.openingCents ?? 0)}</td><td>{euro(row.expectedCents ?? 0)}</td><td>{row.countedCents == null ? '—' : euro(row.countedCents)}</td><td><DifferenceChip cents={row.differenceCents} /></td></>}</tr>)}</tbody></table></div>}
      {report.truncated && <p className="caja-muted caja-note">Se muestran las 200 sesiones más recientes; acota el rango para ver el resto.</p>}
    </Card>

    <Card as="section" aria-labelledby="caja-detail-title" className="caja-daily-detail">
      <CardHeader title="Movimientos y recuentos de hoy" titleId="caja-detail-title" description={ownerView ? 'Detalle de ambas cajas, incluidos recuentos, traspasos, gastos y retiradas.' : 'Movimientos realizados durante tu custodia. El importe esperado y la diferencia permanecen ocultos.'} />
      {ownerView && daily.total && <dl className="caja-day-total"><div><dt>Esperado</dt><dd>{euro(daily.total.expectedCents)}</dd></div><div><dt>Contado</dt><dd>{daily.total.countedCents == null ? 'Pendiente de cierre' : euro(daily.total.countedCents)}</dd></div><div><dt>Cuadre</dt><dd><DifferenceChip cents={daily.total.differenceCents}/></dd></div></dl>}
      {daily.items.length === 0 ? <EmptyState icon={icons.Wallet} title="Sin actividad de caja hoy">Cuando tengas una caja a tu cargo, sus movimientos aparecerán aquí.</EmptyState> :
        <div className="caja-daily-registers">{daily.items.map((register, index) => <article className="caja-daily-register" key={register.id ?? register.registerCode ?? index}>
          <div className="caja-daily-register-heading"><div><h3>{register.registerName}</h3><p className="caja-muted">{register.status === 'open' ? 'Abierta' : statusText[register.status]}</p></div></div>
          {(ownerView || register.countedDenominations) && <div className="caja-denomination-breakdowns">
            <DenominationBreakdown title="Fondo de apertura · por denominación" counts={register.openingDenominations}/>
            <DenominationBreakdown title="Recuento de cierre · por denominación" counts={register.countedDenominations}/>
          </div>}
          <h4>Movimientos</h4>
          <CashMovementList movements={register.movements ?? []}/>
          {ownerView && (register.handovers?.length ?? 0) > 0 && <div className="caja-handovers"><h4>Traspasos de custodia</h4>{register.handovers!.map(handover => <article key={handover.id} className="caja-handover">
            <div><strong>{handover.completedAt ? 'Traspaso completado' : 'Traspaso pendiente'}</strong><time dateTime={handover.completedAt ?? handover.createdAt}>{movementTime(handover.completedAt ?? handover.createdAt)}</time></div>
            {handover.mismatch && <StatusChip tone="danger" icon={null}>Incidencia: recuentos distintos</StatusChip>}
            <DenominationBreakdown title="Recuento de salida" counts={handover.outgoingDenominations}/>
            <DenominationBreakdown title="Recuento de entrada" counts={handover.incomingDenominations}/>
          </article>)}</div>}
        </article>)}</div>}
    </Card>
  </>);
}
