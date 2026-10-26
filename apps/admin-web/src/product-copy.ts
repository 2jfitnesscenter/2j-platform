export type PlanKind = 'recurring' | 'session_pack';
export type PlanStatus = 'active' | 'draft' | 'archived';
export type ProductRightCopy = {
  rightType: string;
  serviceId: string | null;
  quotaScope: 'shared' | 'per_service' | null;
  quantity: number | null;
  period: string | null;
  periodMode: 'calendar' | 'rolling' | null;
};

export const statusLabel: Record<PlanStatus, string> = { active: 'Activo', draft: 'Borrador', archived: 'Archivado' };
export const kindLabel: Record<PlanKind, string> = { recurring: 'Plan recurrente', session_pack: 'Bono de sesiones' };
export const cadenceLabel: Record<string, string> = { weekly: 'Renovación semanal', monthly: 'Renovación mensual', custom_period: 'Renovación por periodo' };
export const periodLabel: Record<string, string> = { week: 'semana', month: 'mes', plan_period: 'periodo del plan' };
export const rightLabel: Record<string, string> = { service_access: 'Acceso al servicio', sessions_quota: 'Sesiones', period_quota: 'Accesos por periodo' };
export const moduleLabel: Record<string, string> = { reservations: 'Reservas', training: 'Búnker / Training', nutrition: 'Nutrición', health: 'Health' };

/** Weekly frequency of a recurring plan. It is NOT a weekly limit: the sessions of the period come from the real length of the period (2J-098E), so nothing is computed here. */
export const frequencyOptions = [1, 2, 3, 4, 5].map((days) => ({ value: String(days), label: `${days} ${days === 1 ? 'día' : 'días'} / semana` })).concat([{ value: 'unlimited', label: 'Sin límite' }]);
export const frequencyShortLabel = (value: string) => (value === 'unlimited' ? 'Sin límite' : `${value} ${value === '1' ? 'día' : 'días'}/semana`);
export const cadenceShortLabel = (cadence: string, periodDays: number | null) => (cadence === 'monthly' ? 'Mensual' : cadence === 'weekly' ? 'Semanal' : periodDays ? `Cada ${periodDays} días` : 'Periodo personalizado');
export const euroLabel = (amount: number) => `${new Intl.NumberFormat('es-ES', { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 }).format(amount)} €`;
/** A session pack the new form can represent exactly: one shared sessions quota plus plain access to each service. */
export function isSessionPackShaped(plan: { kind: PlanKind; rights: { rightType: string; quotaScope: string | null }[] }) {
  const quotas = plan.rights.filter((right) => right.rightType !== 'service_access');
  return plan.kind === 'session_pack' && quotas.length === 1 && quotas[0]!.rightType === 'sessions_quota' && quotas[0]!.quotaScope === 'shared';
}

export function describePlan(plan: { kind: PlanKind; renewalCadence: string | null; periodDays: number | null; rights: ProductRightCopy[] }) {
  const cadence = plan.renewalCadence ? cadenceLabel[plan.renewalCadence] ?? 'Renovación configurada' : 'Sin renovación';
  const validity = plan.periodDays ? `cada ${plan.periodDays} días` : cadence.toLocaleLowerCase('es');
  const rights = plan.rights.map((right) => {
    const target = right.serviceId ? 'servicio seleccionado' : null;
    if (right.rightType === 'service_access') return target ? `Acceso a ${target}` : 'Acceso sin destino especificado';
    if (right.rightType === 'sessions_quota') return `${right.quantity} sesiones ${right.quotaScope === 'shared' ? 'compartidas' : 'por servicio'}`;
    const period = periodLabel[right.period ?? ''] ?? 'periodo';
    const mode = right.period === 'plan_period' ? '' : ` (${right.periodMode === 'calendar' ? 'calendario' : 'móvil'})`;
    return `${right.quantity} accesos por ${period}${mode}`;
  }).join(' y ');
  return `${kindLabel[plan.kind]}: ${validity}; incluye ${rights || 'derechos por definir'}.`;
}
