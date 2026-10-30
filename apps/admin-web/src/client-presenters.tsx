import { StatusChip, type StatusTone } from '@2j/ui';

/** Presentation helpers for Clientes / Cliente 360 (Design System V2). Pure mapping of values the API already returns. */

export const SECTION_ORDER = ['summary', 'plans', 'reservations', 'payments', 'purchases', 'training', 'documents', 'messages', 'followup', 'history'] as const;

/** Approved copy (PP-04 / "Plan y sesiones"): technical words such as rights or entitlements never reach the UI. */
export const SECTION_LABEL: Record<string, string> = {
  summary: 'Resumen', reservations: 'Reservas', plans: 'Plan y sesiones', payments: 'Pagos', purchases: 'Compras',
  training: 'Evolución',
  documents: 'Documentos', messages: 'Mensajes', followup: 'Seguimiento', history: 'Historial',
};

export function ClientAvatar({ firstName, lastName, size = 'md' }: { firstName: string; lastName: string; size?: 'md' | 'lg' }) {
  return <span className={`client-avatar ${size === 'lg' ? 'is-lg' : ''}`} aria-hidden="true">{firstName.slice(0, 1)}{lastName.slice(0, 1)}</span>;
}

export function euros(cents: number) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

type Chip = { tone: StatusTone; label: string };

const planStatusMap: Record<string, Chip> = {
  active: { tone: 'success', label: 'Activa' },
  paused: { tone: 'warning', label: 'En pausa' },
  scheduled: { tone: 'info', label: 'Programada' },
  expired: { tone: 'neutral', label: 'Vencida' },
  cancelled: { tone: 'neutral', label: 'Cancelada' },
  exhausted: { tone: 'neutral', label: 'Bono agotado' },
};
export function planStatusChip(status: string) {
  const chip = planStatusMap[status] ?? { tone: 'neutral' as const, label: status };
  return <StatusChip tone={chip.tone}>{chip.label}</StatusChip>;
}

/** Plan state of the person (PP-04): only derived from the plan assignments the profile already carries. */
export function clientPlanChip(plans: Array<{ derivedStatus: string }> | null) {
  if (!plans) return null;
  let chip: Chip;
  if (plans.some((plan) => plan.derivedStatus === 'active')) chip = { tone: 'success', label: 'Plan activo' };
  else if (plans.some((plan) => plan.derivedStatus === 'paused')) chip = { tone: 'warning', label: 'Plan en pausa' };
  else if (plans.some((plan) => plan.derivedStatus === 'scheduled')) chip = { tone: 'info', label: 'Plan programado' };
  else if (plans.some((plan) => plan.derivedStatus === 'exhausted')) chip = { tone: 'neutral', label: 'Bono agotado' };
  else if (plans.length > 0) chip = { tone: 'neutral', label: 'Plan vencido' };
  else chip = { tone: 'neutral', label: 'Sin plan' };
  return <StatusChip tone={chip.tone}>{chip.label}</StatusChip>;
}

const reservationMap: Record<string, Chip> = {
  reserved: { tone: 'info', label: 'Reservada' },
  attended: { tone: 'success', label: 'Asistió' },
  no_show: { tone: 'danger', label: 'No-show' },
  cancelled: { tone: 'neutral', label: 'Cancelada' },
  cancelled_late: { tone: 'warning', label: 'Cancelación tardía' },
  cancelled_by_center: { tone: 'neutral', label: 'Cancelada por el centro' },
};
export function reservationChip(status: string) {
  const chip = reservationMap[status] ?? { tone: 'neutral' as const, label: status };
  return <StatusChip tone={chip.tone}>{chip.label}</StatusChip>;
}

const chargeMap: Record<string, Chip> = {
  pending: { tone: 'warning', label: 'Pendiente' },
  unpaid: { tone: 'danger', label: 'Vencido' },
  paid: { tone: 'success', label: 'Pagado' },
  refunded: { tone: 'neutral', label: 'Devuelto' },
  exempt: { tone: 'neutral', label: 'Exento' },
  void: { tone: 'neutral', label: 'Anulado' },
};
export function chargeChip(status: string) {
  const chip = chargeMap[status] ?? { tone: 'neutral' as const, label: status };
  return <StatusChip tone={chip.tone}>{chip.label}</StatusChip>;
}

export type PlanRightLike = { rightType: string; serviceName: string | null; quantity: number | null; period: string | null; balance?: number | null };
/** User-facing line for what a plan grants. */
export function rightLine(right: PlanRightLike) {
  const service = right.serviceName ? ` · ${right.serviceName}` : '';
  if (right.rightType === 'service_access') return `Acceso${service}`;
  if (right.rightType === 'sessions_quota') return `${right.quantity} sesiones${service}${right.balance != null ? ` · ${right.balance} restantes` : ''}`;
  return `${right.quantity} ${right.period === 'week' ? 'por semana' : right.period === 'month' ? 'por mes' : 'por periodo'}${service}`;
}

export function reservationRightsLabel(rights: string[]) {
  return rights.map((right) => right === 'sessions_quota' ? 'Bono de sesiones' : right === 'period_quota' ? 'Límite periódico' : 'Acceso').join(', ');
}
