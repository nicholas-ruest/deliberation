import { z } from 'zod';

const Id = z.string().uuid();
const Instant = z.string().datetime({ offset: true });

export const CommandEnvelopeSchema = z.object({
  commandId: Id,
  commandType: z.string().min(1).max(160),
  schemaVersion: z.number().int().positive(),
  tenantId: Id,
  principalId: Id,
  subjectSessionEpoch: z.number().int().nonnegative(),
  resourceId: Id.optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
  idempotencyKey: z.string().min(8).max(200),
  correlationId: Id,
  causationId: Id.optional(),
  purpose: z.string().min(1).max(100),
  riskTier: z.enum(['low', 'moderate', 'high', 'prohibited']),
  requestedAt: Instant,
  deadline: Instant,
  payload: z.unknown(),
});

export type CommandEnvelope<T = unknown> = Omit<
  z.infer<typeof CommandEnvelopeSchema>,
  'payload'
> & { readonly payload: T };

export const DomainEventEnvelopeSchema = z.object({
  eventId: Id,
  eventType: z.string().min(1).max(160),
  schemaVersion: z.number().int().positive(),
  tenantId: Id,
  aggregateType: z.string().min(1).max(100),
  aggregateId: Id,
  aggregateVersion: z.number().int().positive(),
  occurredAt: Instant,
  recordedAt: Instant,
  actorId: Id,
  correlationId: Id,
  causationId: Id.optional(),
  purpose: z.string().min(1).max(100),
  policyDecisionRef: Id.optional(),
  dataClassification: z.enum(['public', 'internal', 'confidential', 'restricted']),
  payload: z.record(z.string(), z.unknown()),
});

export type DomainEventEnvelope<T extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>> =
  Omit<z.infer<typeof DomainEventEnvelopeSchema>, 'payload'> & { readonly payload: T };

export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly detail?: string;
  readonly correlationId: string;
  readonly incidentId?: string;
  readonly violations?: readonly { field: string; code: string }[];
  readonly retryAfter?: number;
}

export type OperationState = 'accepted' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired';

export interface Operation {
  readonly id: string;
  readonly tenantId: string;
  readonly type: string;
  readonly resourceRef?: string;
  readonly state: OperationState;
  readonly progress?: { readonly completedUnits?: number; readonly totalUnits?: number; readonly phase?: string };
  readonly acceptedAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly cancellable: boolean;
  readonly resultRef?: string;
  readonly error?: ProblemDetails;
  readonly retryAfter?: number;
  readonly version: number;
}
