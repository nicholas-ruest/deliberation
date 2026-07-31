export type DomainErrorCode =
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INVARIANT_VIOLATION'
  | 'PERMISSION_DENIED'
  | 'OBLIGATION_REQUIRED'
  | 'RISK_NOT_SUPPORTED'
  | 'ENTITLEMENT_REQUIRED'
  | 'QUOTA_EXHAUSTED'
  | 'CAPACITY_UNAVAILABLE'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'DEADLINE_EXCEEDED'
  | 'CONTENT_REJECTED'
  | 'DATA_RESTRICTED'
  | 'ABSTAINED'
  | 'INTERNAL';

export interface DomainError {
  readonly code: DomainErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly retryable?: boolean;
}

export type Result<T, E = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = <E extends DomainError>(error: E): Result<never, E> => ({
  ok: false,
  error,
});

export const invariant = (message: string, details?: Readonly<Record<string, unknown>>): DomainError => ({
  code: 'INVARIANT_VIOLATION',
  message,
  ...(details === undefined ? {} : { details }),
});
