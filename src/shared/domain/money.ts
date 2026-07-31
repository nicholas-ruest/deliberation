import { z } from 'zod';

export const Currency = z.string().regex(/^[A-Z]{3}$/);
export type Currency = z.infer<typeof Currency>;

export class Money {
  private constructor(
    readonly minorUnits: bigint,
    readonly currency: Currency,
  ) {}

  static of(minorUnits: bigint, currency: string): Money {
    return new Money(minorUnits, Currency.parse(currency));
  }

  add(other: Money): Money {
    if (other.currency !== this.currency) throw new Error('Currency mismatch');
    return Money.of(this.minorUnits + other.minorUnits, this.currency);
  }

  subtract(other: Money): Money {
    if (other.currency !== this.currency) throw new Error('Currency mismatch');
    return Money.of(this.minorUnits - other.minorUnits, this.currency);
  }
}
