import type { TransactionSql } from 'postgres';

/** Server-owned port for the future client entitlement / available-balance module. */
export interface BookingEligibilityRequest {
  readonly tx: TransactionSql<Record<string, unknown>>;
  readonly clientId: string;
  readonly serviceId: string;
  readonly startsAt: string;
}

export type BookingEligibilityResult =
  | { readonly eligible: true; readonly entitlementId: string; readonly planId?: string }
  | { readonly eligible: false; readonly reason: 'entitlement_required' | 'entitlement_unavailable' };

export type BookingEligibilityResolver = (request: BookingEligibilityRequest) => Promise<BookingEligibilityResult>;

/** Fail closed until client-plan assignments and balances are available to the server. */
export const unavailableBookingEligibility: BookingEligibilityResolver = async () => ({ eligible: false, reason: 'entitlement_unavailable' });
