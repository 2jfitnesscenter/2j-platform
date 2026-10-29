export type ApprovedRole = 'admin' | 'trainer' | 'reception-management' | 'accountant';

export interface AuthorizationContext {
  readonly actorId: string;
  readonly role: ApprovedRole;
  readonly deniedPermissions?: readonly string[];
  /** Explicit grants supplied only by a trusted server-side authorization resolver. */
  readonly explicitPermissions?: readonly string[];
}

export const rolePermissions: Readonly<Record<ApprovedRole, readonly string[]>> = {
  admin: ['*'],
  trainer: ['clients.read', 'health.read', 'training.read', 'calendar.read', 'communication.read', 'communication.send', 'communication.internal_notes.read', 'communication.internal_notes.write', 'forms.read', 'forms.assign', 'forms.review', 'consents.read', 'documents.read', 'followup.read', 'followup.manage', 'timeclock.read', 'timeclock.self', 'billing.cash.manage', 'reservations.manage', 'reservations.attendance', 'scheduling.override_capacity', 'billing.validate_transfer', 'billing.debt.override', 'staff.read', 'staff.schedule.read', 'staff.absence.read', 'entitlements.read', 'entitlements.recurrence.manage'],
  'reception-management': ['clients.read', 'calendar.read', 'communication.read', 'communication.send', 'forms.read', 'forms.assign', 'consents.read', 'documents.read', 'followup.read', 'reservations.manage', 'billing.read-basic', 'timeclock.read', 'staff.read', 'staff.profile.sensitive.read', 'staff.schedule.read', 'staff.schedule.manage', 'staff.absence.read', 'staff.absence.manage', 'staff.substitution.manage', 'timeclock.self', 'entitlements.read', 'entitlements.manage', 'entitlements.renew', 'entitlements.pause', 'entitlements.cancel'],
  accountant: ['billing.read-basic', 'billing.read-tax', 'billing.export'],
};

/** Registry of operation identifiers known to the server. New operations must be reviewed here before use. */
export const knownPermissions: ReadonlySet<string> = new Set([
  'clients.read', 'clients.manage', 'health.read', 'training.read', 'calendar.read', 'communication.read', 'communication.send', 'communication.manage_templates', 'communication.internal_notes.read', 'communication.internal_notes.write', 'forms.read', 'forms.manage', 'forms.assign', 'forms.review', 'forms.responses.sensitive.read', 'consents.read', 'consents.manage', 'consents.accept.assisted', 'followup.read', 'followup.manage', 'documents.read', 'documents.manage', 'documents.requirement.override', 'news.read', 'news.manage', 'timeclock.read',
  'reservations.manage', 'reservations.attendance', 'billing.read-basic', 'billing.payments.manage', 'billing.cash.manage', 'billing.cash.adjust', 'billing.invoices.manage', 'billing.read-tax', 'billing.write-tax', 'billing.export', 'billing.validate_transfer', 'billing.debt.override', 'scheduling.override_capacity',
  'entitlements.read', 'entitlements.manage', 'entitlements.adjust', 'entitlements.cancel', 'entitlements.pause', 'entitlements.renew', 'entitlements.recurrence.manage', 'catalog.pricing.manage', 'store.catalog.read', 'store.catalog.manage', 'store.inventory.read', 'store.inventory.manage', 'store.sales.read', 'store.sales.create', 'store.sales.void', 'staff.read', 'staff.profile.sensitive.read', 'staff.audit.read', 'staff.manage', 'staff.schedule.read', 'staff.schedule.manage', 'staff.schedule.override', 'staff.absence.read', 'staff.absence.manage', 'staff.substitution.manage', 'staff.shifts.read', 'staff.shifts.manage', 'center.hours.manage', 'timeclock.self', 'timeclock.manage', 'timeclock.audit', 'staff.timeclock.correct', 'identity.people.manage', 'member.pilot.booking.manage', 'settings.manage', 'training.suspension.manage', 'owner.panel.read',
]);

/** Deny-by-default. Client visibility must never replace this server check. */
export function can(context: AuthorizationContext, permission: string): boolean {
  if (!knownPermissions.has(permission)) return false;
  if (context.deniedPermissions?.includes(permission)) return false;
  // Owner-only access must never be implied by the generic admin wildcard.
  if (['owner.panel.read', 'center.hours.manage', 'staff.shifts.manage', 'staff.shifts.read'].includes(permission)) return context.explicitPermissions?.includes(permission) ?? false;
  // Explicit grants come only from the trusted server-side resolver and allow
  // narrow operational permissions without widening a role's default profile.
  if (context.explicitPermissions?.includes(permission)) return true;
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
