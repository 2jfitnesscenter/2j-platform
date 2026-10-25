import { z } from 'zod';

export const cashDenominationKeys = [
  'coin_0_01', 'coin_0_02', 'coin_0_05', 'coin_0_10', 'coin_0_20', 'coin_0_50', 'coin_1', 'coin_2',
  'bill_5', 'bill_10', 'bill_20', 'bill_50', 'bill_100', 'bill_200', 'bill_500',
] as const;

const denominationCents: Record<(typeof cashDenominationKeys)[number], number> = {
  coin_0_01: 1, coin_0_02: 2, coin_0_05: 5, coin_0_10: 10, coin_0_20: 20, coin_0_50: 50,
  coin_1: 100, coin_2: 200, bill_5: 500, bill_10: 1000, bill_20: 2000, bill_50: 5000,
  bill_100: 10000, bill_200: 20000, bill_500: 50000,
};

export const cashDenominationsSchema = z.object(Object.fromEntries(cashDenominationKeys.map(key => [key, z.number().int().min(0).max(1_000_000)]))).strict();
export type CashDenominations = z.infer<typeof cashDenominationsSchema>;

export function cashDenominationsToCents(count: CashDenominations): number {
  return cashDenominationKeys.reduce((total, key) => total + count[key]! * denominationCents[key], 0);
}

/** Locks and validates the only shift that may receive a collection today. */
export async function lockOpenCashSession(tx: any) {
  const [session] = await tx`SELECT id,local_date=(now() AT TIME ZONE 'Atlantic/Canary')::date AS "isToday"
    FROM economic_cash_sessions WHERE status='open' ORDER BY opened_at LIMIT 1 FOR UPDATE`;
  if (!session) return { ok: false as const, error: 'cash_session_required' as const };
  if (!session.isToday) return { ok: false as const, error: 'cash_session_previous_day_requires_owner_resolution' as const };
  return { ok: true as const, id: String(session.id) };
}

export const previousDayCashSessionMessage = 'Hay una caja abierta de un día anterior. El propietario debe resolverla antes de registrar cobros o anulaciones.';
