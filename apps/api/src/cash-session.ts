/** Locks and validates the only shift that may receive a collection today. */
export async function lockOpenCashSession(tx: any) {
  const [session] = await tx`SELECT id,local_date=(now() AT TIME ZONE 'Atlantic/Canary')::date AS "isToday"
    FROM economic_cash_sessions WHERE status='open' ORDER BY opened_at LIMIT 1 FOR UPDATE`;
  if (!session) return { ok: false as const, error: 'cash_session_required' as const };
  if (!session.isToday) return { ok: false as const, error: 'cash_session_previous_day_requires_owner_resolution' as const };
  return { ok: true as const, id: String(session.id) };
}

export const previousDayCashSessionMessage = 'Hay una caja abierta de un día anterior. El propietario debe resolverla antes de registrar cobros o anulaciones.';
