import React from 'react';
import { Icon, icons } from '@2j/ui';

export type AttendanceStatus = 'attended' | 'no_show' | 'reserved';

/**
 * Pase de lista (D77, D218, D224): ✓ asistió y ✗ no asistió; un toque guarda al instante y pulsar el estado ya elegido no hace nada.
 * Una reserva ya marcada ofrece además «Reabrir reserva» (vuelve a estado reservado).
 */
export function AttendanceToggle({ status, name, busy, onSet }: {
  status: string;
  name: string;
  busy: boolean;
  onSet: (status: AttendanceStatus) => void;
}) {
  const marked = status === 'attended' || status === 'no_show';
  return <span className="attendance-toggle" role="group" aria-label={`Asistencia de ${name}`}>
    <button type="button" className="attendance-btn is-present" aria-pressed={status === 'attended'} aria-label="Asistió" title="Asistió"
      disabled={busy || status === 'attended'} onClick={() => onSet('attended')}><Icon icon={icons.Check} size={20} /></button>
    <button type="button" className="attendance-btn is-absent" aria-pressed={status === 'no_show'} aria-label="No asistió" title="No asistió"
      disabled={busy || status === 'no_show'} onClick={() => onSet('no_show')}><Icon icon={icons.X} size={20} /></button>
    {marked && <button type="button" className="attendance-btn is-reopen" aria-label="Reabrir reserva" title="Reabrir reserva"
      disabled={busy} onClick={() => onSet('reserved')}><Icon icon={icons.RotateCcw} size={16} /></button>}
  </span>;
}
