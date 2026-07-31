import { AggregateRoot, type Clock, type Result, invariant } from '../../../shared/domain/index.js';

export interface Quota {
  readonly hardLimit: number;
  readonly allowOverage: boolean;
}

export interface ReservationRequest {
  readonly tokens: number;
  readonly moneyMinorUnits: number;
  readonly toolCalls: number;
  readonly branches: number;
  readonly wallTimeMs: number;
  readonly concurrency: number;
}

export type UsageDimension = keyof ReservationRequest;

export interface Reservation {
  readonly id: string;
  readonly request: ReservationRequest;
  readonly consumed: Partial<Record<UsageDimension, number>>;
  readonly expiresAt: Date;
  readonly state: 'active' | 'released' | 'exhausted';
}

export interface UsageReceipt {
  readonly id: string;
  readonly reservationId: string;
  readonly dimension: UsageDimension;
  readonly quantity: number;
  readonly sourceReference: string;
  readonly occurredAt: Date;
}

export class Entitlement extends AggregateRoot {
  private readonly quotas = new Map<UsageDimension, Quota>();
  private readonly reservations = new Map<string, Reservation>();
  private readonly receipts = new Map<string, UsageReceipt>();
  public state: 'active' | 'grace' | 'suspended' = 'active';

  private constructor(
    id: string,
    tenantId: string,
    now: Date,
    readonly featureCodes: ReadonlySet<string>,
  ) {
    super(id, tenantId, 0, now, now);
  }

  static create(id: string, tenantId: string, featureCodes: readonly string[], clock: Clock): Entitlement {
    return new Entitlement(id, tenantId, clock.now(), new Set(featureCodes));
  }

  setQuota(dimension: UsageDimension, quota: Quota): Result<Entitlement> {
    if (quota.hardLimit < 0 || !Number.isFinite(quota.hardLimit)) {
      return { ok: false, error: invariant('Quota must be finite and non-negative') };
    }
    this.quotas.set(dimension, quota);
    return { ok: true, value: this };
  }

  reserve(id: string, request: ReservationRequest, expiresAt: Date, now = this.updatedAt): Result<Reservation> {
    const existing = this.reservations.get(id);
    if (existing !== undefined) {
      return JSON.stringify(existing.request) === JSON.stringify(request)
        ? { ok: true, value: existing }
        : { ok: false, error: { code: 'IDEMPOTENCY_CONFLICT', message: 'Reservation ID reused' } };
    }
    if (this.state !== 'active') return { ok: false, error: { code: 'ENTITLEMENT_REQUIRED', message: 'Commercial access is not active' } };
    if (expiresAt <= now) return { ok: false, error: invariant('Reservation expiry must be in the future') };
    for (const [reservationId, reservation] of this.reservations) {
      if (reservation.state === 'active' && reservation.expiresAt <= now) {
        this.reservations.set(reservationId, Object.freeze({ ...reservation, state: 'released' }));
      }
    }
    for (const [dimension, requested] of Object.entries(request) as [UsageDimension, number][]) {
      if (!Number.isSafeInteger(requested) || requested < 0) return { ok: false, error: invariant('Reservation values must be safe non-negative integers') };
      const quota = this.quotas.get(dimension);
      const reserved = [...this.reservations.values()]
        .filter(({ state }) => state === 'active')
        .reduce((sum, reservation) => sum + reservation.request[dimension], 0);
      if (quota === undefined || (!quota.allowOverage && reserved + requested > quota.hardLimit)) {
        return { ok: false, error: { code: 'QUOTA_EXHAUSTED', message: `${dimension} quota exhausted` } };
      }
    }
    const reservation: Reservation = Object.freeze({
      id,
      request: Object.freeze({ ...request }),
      consumed: Object.freeze({}),
      expiresAt,
      state: 'active',
    });
    this.reservations.set(id, reservation);
    return { ok: true, value: reservation };
  }

  consume(receipt: UsageReceipt): Result<Reservation> {
    const duplicate = this.receipts.get(receipt.id);
    if (duplicate !== undefined) {
      return JSON.stringify(duplicate) === JSON.stringify(receipt)
        ? { ok: true, value: this.reservations.get(receipt.reservationId)! }
        : { ok: false, error: { code: 'IDEMPOTENCY_CONFLICT', message: 'Usage receipt ID reused' } };
    }
    const reservation = this.reservations.get(receipt.reservationId);
    if (reservation?.state !== 'active') return { ok: false, error: { code: 'QUOTA_EXHAUSTED', message: 'Reservation is not active' } };
    const next = (reservation.consumed[receipt.dimension] ?? 0) + receipt.quantity;
    if (!Number.isSafeInteger(receipt.quantity) || receipt.quantity < 0 || next > reservation.request[receipt.dimension]
      || !/^[A-Za-z0-9][A-Za-z0-9:._/-]{0,199}$/.test(receipt.sourceReference)) {
      return { ok: false, error: { code: 'QUOTA_EXHAUSTED', message: 'Usage exceeds reservation' } };
    }
    const updated: Reservation = Object.freeze({
      ...reservation,
      consumed: Object.freeze({ ...reservation.consumed, [receipt.dimension]: next }),
    });
    this.reservations.set(reservation.id, updated);
    this.receipts.set(receipt.id, Object.freeze({ ...receipt }));
    return { ok: true, value: updated };
  }

  release(id: string): Result<Reservation> {
    const reservation = this.reservations.get(id);
    if (reservation === undefined) return { ok: false, error: { code: 'NOT_FOUND', message: 'Reservation not found' } };
    if (reservation.state !== 'active') return { ok: true, value: reservation };
    const released = Object.freeze({ ...reservation, state: 'released' as const });
    this.reservations.set(id, released);
    return { ok: true, value: released };
  }

  hasFeature(code: string): boolean {
    return this.state !== 'suspended' && this.featureCodes.has(code);
  }
}
