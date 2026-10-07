export type ApprovedRole = 'admin' | 'trainer' | 'reception-management' | 'accountant';

export interface AuthorizationContext {
  readonly actorId: string;
  readonly role: ApprovedRole;
  readonly deniedPermissions?: readonly string[];
}

export const rolePermissions: Readonly<Record<ApprovedRole, readonly string[]>> = {
  admin: ['*'],
  trainer: ['clients.read', 'health.read', 'training.read', 'calendar.read', 'communication.read', 'timeclock.read'],
  'reception-management': ['clients.read', 'calendar.read', 'reservations.manage', 'billing.read-basic', 'timeclock.read'],
  accountant: [],
};

/** Deny-by-default. Client visibility must never replace this server check. */
export function can(context: AuthorizationContext, permission: string): boolean {
  if (context.deniedPermissions?.includes(permission)) return false;
  return rolePermissions[context.role]?.some((grant) => grant === '*' || grant === permission) ?? false;
}

export function requirePermission(context: AuthorizationContext, permission: string): void {
  if (!can(context, permission)) {
    const error = new Error('Forbidden') as Error & { statusCode: number; code: string };
    error.statusCode = 403;
    error.code = 'FORBIDDEN';
    throw error;
  }
}
