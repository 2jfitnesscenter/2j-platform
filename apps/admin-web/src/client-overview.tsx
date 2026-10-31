import * as React from 'react';
import { Card, CardHeader, IconButton, icons } from '@2j/ui';

const ZONE = 'Atlantic/Canary';

type Period = { id: string; startsOn: string; endsOn: string | null; sessionsGranted: number | null; balance: number };
type Right = { rightType: string; serviceName: string | null; quantity: number | null; quantityRule?: string | null; balance?: number | null; periods?: Period[] };
export type OverviewAssignment = { id: string; planName: string; endsOn: string | null; derivedStatus: string; rights: Right[] };
export type OverviewReservation = { id: string; status: string; startsAt: string; sessionStatus: string; serviceName: string; areaName: string };

const dayKey = (value: Date | string) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
const timeLabel = (value: string) => new Intl.DateTimeFormat('es-ES', { timeZone: ZONE, hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const shortDate = (iso: string) => new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));

export type Counter = { id: string; label: string; plan: string; unlimited: boolean; available: number; granted: number | null; until: string | null };

/**
 * Contadores de «Saldo de cuota»: solo lo que ya devuelve el API (saldo del derecho o de la bolsa del periodo vigente).
 * No calcula renovaciones ni fechas: eso es de A71 (Platform).
 */
export function balanceCounters(assignments: OverviewAssignment[], today = dayKey(new Date())): Counter[] {
  const counters: Counter[] = [];
  for (const assignment of assignments.filter((item) => item.derivedStatus === 'active' || item.derivedStatus === 'paused')) {
    assignment.rights.forEach((right, index) => {
      if (right.rightType !== 'sessions_quota') return;
      const label = right.serviceName ?? 'Sesiones';
      const id = `${assignment.id}-${index}`;
      if (right.quantityRule === 'unlimited') { counters.push({ id, label, plan: assignment.planName, unlimited: true, available: 0, granted: null, until: assignment.endsOn }); return; }
      const periods = right.periods ?? [];
      const current = periods.find((period) => period.startsOn <= today && (period.endsOn === null || today <= period.endsOn)) ?? null;
      if (current) { counters.push({ id, label, plan: assignment.planName, unlimited: false, available: current.balance, granted: current.sessionsGranted, until: current.endsOn ?? assignment.endsOn }); return; }
      if (periods.length > 0) return; // bolsas por periodo, pero ninguna vigente hoy: no se inventa saldo
      if (right.balance == null) return;
      counters.push({ id, label, plan: assignment.planName, unlimited: false, available: right.balance, granted: right.quantity, until: assignment.endsOn });
    });
  }
  return counters;
}

export function BalanceCards({ assignments }: { assignments: OverviewAssignment[] }) {
  const counters = balanceCounters(assignments);
  return <Card as="section" aria-labelledby="client-balance-title"><CardHeader title="Saldo de cuota" titleId="client-balance-title" level={3} />
    {counters.length === 0 ? <p className="client-muted">Sin cuota con sesiones activa.</p> : <ul className="client-balance-list">{counters.map((counter) => {
      const ratio = counter.granted && counter.granted > 0 ? Math.max(0, Math.min(1, counter.available / counter.granted)) : null;
      return <li key={counter.id} className="client-balance">
        <span className="client-balance-label">{counter.label}</span>
        {counter.unlimited ? <strong className="client-balance-value">Sin límite</strong> : <strong className="client-balance-value">{Math.max(0, counter.available)} <small>{counter.available === 1 ? 'sesión disponible' : 'sesiones disponibles'}{counter.granted != null ? ` de ${counter.granted}` : ''}</small></strong>}
        {ratio !== null && <span className="client-balance-bar" role="progressbar" aria-label={`Saldo de ${counter.label}`} aria-valuemin={0} aria-valuemax={counter.granted ?? 0} aria-valuenow={Math.max(0, counter.available)}><span style={{ width: `${Math.round(ratio * 100)}%` }} /></span>}
        <span className="client-balance-detail">{counter.plan}{counter.until ? ` · hasta ${shortDate(counter.until)}` : ''}</span>
      </li>;
    })}</ul>}
  </Card>;
}

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const STATUS_LABEL: Record<string, string> = { reserved: 'Reservada', attended: 'Asistió', no_show: 'No asistió' };
const SHOWN = Object.keys(STATUS_LABEL);

type Cell = { key: string; day: number } | null;
/** Rejilla de un mes (lunes primero) con huecos al principio; pura, para poder probarla. */
export function monthGrid(year: number, month: number): Cell[] {
  const first = new Date(Date.UTC(year, month, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: Cell[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= days; day += 1) cells.push({ key: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`, day });
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function MonthCalendar({ reservations, now = new Date() }: { reservations: OverviewReservation[]; now?: Date }) {
  const todayKey = dayKey(now);
  const [cursor, setCursor] = React.useState(() => ({ year: Number(todayKey.slice(0, 4)), month: Number(todayKey.slice(5, 7)) - 1 }));
  const [selected, setSelected] = React.useState<string | null>(null);
  const byDay = React.useMemo(() => {
    const map = new Map<string, OverviewReservation[]>();
    for (const reservation of reservations) {
      if (!SHOWN.includes(reservation.status) || reservation.sessionStatus === 'cancelled') continue;
      const key = dayKey(reservation.startsAt);
      map.set(key, [...(map.get(key) ?? []), reservation]);
    }
    for (const list of map.values()) list.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    return map;
  }, [reservations]);
  const cells = monthGrid(cursor.year, cursor.month);
  const title = new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(cursor.year, cursor.month, 1)));
  const move = (delta: number) => { setSelected(null); setCursor((current) => { const date = new Date(Date.UTC(current.year, current.month + delta, 1)); return { year: date.getUTCFullYear(), month: date.getUTCMonth() }; }); };
  const picked = selected ? byDay.get(selected) ?? [] : [];
  const monthPrefix = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}-`;
  const monthTotal = [...byDay].filter(([key]) => key.startsWith(monthPrefix)).reduce((sum, [, list]) => sum + list.length, 0);

  return <Card as="section" aria-labelledby="client-calendar-title"><CardHeader title="Calendario del mes" titleId="client-calendar-title" level={3} description="Reservas del cliente (las 100 más recientes)." />
    <div className="client-cal-nav">
      <IconButton size="sm" icon={icons.ChevronLeft} label="Mes anterior" onClick={() => move(-1)} />
      <strong className="client-cal-title" role="status" aria-live="polite">{title}</strong>
      <IconButton size="sm" icon={icons.ChevronRight} label="Mes siguiente" onClick={() => move(1)} />
    </div>
    <div className="client-cal-grid" role="grid" aria-labelledby="client-calendar-title">
      <div role="row" className="client-cal-row">{WEEKDAYS.map((name) => <span key={name} role="columnheader" className="client-cal-head">{name}</span>)}</div>
      {Array.from({ length: cells.length / 7 }, (_, week) => <div role="row" className="client-cal-row" key={week}>{cells.slice(week * 7, week * 7 + 7).map((cell, index) => {
        if (!cell) return <span role="gridcell" key={`e${week}-${index}`} className="client-cal-empty" />;
        const list = byDay.get(cell.key) ?? [];
        const label = `${cell.day} de ${title.replace(/ de \d+$/, '')}${list.length ? `: ${list.length} ${list.length === 1 ? 'reserva' : 'reservas'}` : ''}`;
        return <span role="gridcell" key={cell.key}><button type="button" className={`client-cal-day${list.length ? ' has-bookings' : ''}${cell.key === todayKey ? ' is-today' : ''}${cell.key === selected ? ' is-selected' : ''}`} aria-label={label} aria-pressed={cell.key === selected} disabled={list.length === 0} onClick={() => setSelected(cell.key === selected ? null : cell.key)}>{cell.day}{list.length > 0 && <i aria-hidden="true">{list.length}</i>}</button></span>;
      })}</div>)}
    </div>
    {monthTotal === 0 && <p className="client-muted">Sin reservas este mes.</p>}
    {picked.length > 0 && <ul className="client-mini-list" aria-label="Reservas del día">{picked.map((reservation) => <li key={reservation.id}><strong>{timeLabel(reservation.startsAt)} · {reservation.serviceName}</strong><span>{reservation.areaName} · {STATUS_LABEL[reservation.status]}</span></li>)}</ul>}
  </Card>;
}
