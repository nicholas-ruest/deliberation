import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const OpaqueId = z.string().uuid();
export type OpaqueId = z.infer<typeof OpaqueId>;

export interface IdGenerator {
  next(): string;
}

export class UuidGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}
