export type ApprovedRole = 'admin' | 'trainer' | 'reception-management' | 'accountant' | 'owner';

export interface AuthorizationContext {
  readonly actorId: string;
  readonly personId?: string;
  readonly role: ApprovedRole;
  readonly deniedPermissions?: readonly string[];
  readonly explicitPermissions?: readonly string[];
}

export declare const rolePermissions: Readonly<Record<ApprovedRole, readonly string[]>>;
export declare const knownPermissions: ReadonlySet<string>;
export declare function can(context: AuthorizationContext, permission: string): boolean;
export declare function requirePermission(context: AuthorizationContext, permission: string): void;
