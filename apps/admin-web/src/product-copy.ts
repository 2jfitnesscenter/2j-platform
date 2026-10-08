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
export const rightLabel: Record<string, string> = { service_access: 'Acceso al servicio', sessions_quota: 'Límite de sesiones', period_quota: 'Cuota por periodo' };

export function describePlan(plan: { kind: PlanKind; renewalCadence: string | null; periodDays: number | null; rights: ProductRightCopy[] }) {
  const cadence = plan.renewalCadence ? cadenceLabel[plan.renewalCadence] ?? 'Renovación configurada' : 'Sin renovación';
  const validity = plan.periodDays ? `cada ${plan.periodDays} días` : cadence.toLocaleLowerCase('es');
  const rights = plan.rights.map((right) => {
    const target = right.serviceId ? 'servicio seleccionado' : 'servicios incluidos';
    if (right.rightType === 'service_access') return `Acceso a ${target}`;
    if (right.rightType === 'sessions_quota') return `${right.quantity} sesiones ${right.quotaScope === 'shared' ? 'compartidas' : 'por servicio'}`;
    const period = periodLabel[right.period ?? ''] ?? 'periodo';
    const mode = right.period === 'plan_period' ? '' : ` (${right.periodMode === 'calendar' ? 'calendario' : 'móvil'})`;
    return `${right.quantity} accesos por ${period}${mode}`;
  }).join(' y ');
  return `${kindLabel[plan.kind]}: ${validity}; incluye ${rights || 'derechos por definir'}.`;
}
