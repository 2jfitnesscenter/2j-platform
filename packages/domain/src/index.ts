export type DomainModule =
  | 'identity'
  | 'clients'
  | 'scheduling'
  | 'entitlements'
  | 'billing'
  | 'staff'
  | 'communications'
  | 'health-documents'
  | 'follow-up'
  | 'commerce'
  | 'configuration'
  | 'audit';

export type OpaqueId<Entity extends string> = string & { readonly __entity: Entity };

export interface DomainError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface UnitOfWork {
  run<Result>(operation: () => Promise<Result>): Promise<Result>;
}

export interface OutboxMessage {
  readonly id: string;
  readonly type: string;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** Persist this record in the same transaction as the domain state change. */
export interface OutboxWriter {
  append(message: OutboxMessage): Promise<void>;
}
