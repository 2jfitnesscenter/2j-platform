export interface SessionVersionStore {
  currentVersion(subjectId: string): Promise<number>;
}

export interface SessionClaims {
  readonly subjectId: string;
  readonly sessionVersion: number;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

/** Rejects expired, malformed, or revoked sessions; token verification happens before this check. */
export async function isSessionCurrent(claims: SessionClaims, store: SessionVersionStore, nowSeconds: number): Promise<boolean> {
  if (!claims.subjectId || !Number.isSafeInteger(claims.sessionVersion) || !Number.isSafeInteger(claims.issuedAt) || !Number.isSafeInteger(claims.expiresAt)) return false;
  if (claims.issuedAt > nowSeconds || claims.expiresAt <= nowSeconds || claims.expiresAt <= claims.issuedAt) return false;
  return claims.sessionVersion === await store.currentVersion(claims.subjectId);
}
