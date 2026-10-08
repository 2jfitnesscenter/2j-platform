export type ApprovedRole = 'admin' | 'trainer' | 'reception-management' | 'accountant';

export interface AuthorizationContext {
  readonly actorId: string;
  readonly role: ApprovedRole;
  readonly deniedPermissions?: readonly string[];
}

export const rolePermissions: Readonly<Record<ApprovedRole, readonly string[]>> = {
  admin: ['*'],
  trainer: ['clients.read', 'health.read', 'training.read', 'calendar.read', 'communication.read', 'timeclock.read', 'reservations.manage', 'reservations.attendance'],
  'reception-management': ['clients.read', 'calendar.read', 'reservations.manage', 'billing.read-basic', 'timeclock.read'],
  accountant: [],
};

/** Registry of operation identifiers known to the server. New operations must be reviewed here before use. */
export const knownPermissions: ReadonlySet<string> = new Set([
  'clients.read', 'clients.manage', 'health.read', 'training.read', 'calendar.read', 'communication.read', 'timeclock.read',
  'reservations.manage', 'reservations.attendance', 'billing.read-basic', 'billing.validate_transfer', 'scheduling.override_capacity',
  'staff.timeclock.correct', 'settings.manage',
]);

/** Deny-by-default. Client visibility must never replace this server check. */
export function can(context: AuthorizationContext, permission: string): boolean {
  if (!knownPermissions.has(permission)) return false;
  if (context.deniedPermissions?.includes(permission)) return false;
  if (!Object.hasOwn(rolePermissions, context.role)) return false;
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
