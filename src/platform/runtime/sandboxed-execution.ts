import type { Result } from '../../shared/domain/result.js';

/**
 * ADR-040 contract surface only. No sandbox substrate implements this yet; the
 * dispatch mechanism (process, VM, or syscall boundary) is deliberately undecided,
 * so the only adapter here refuses every request.
 */

export type SandboxedWorkKind = 'connector-tool-call' | 'scenario-branch-rollout';

export interface SandboxCapabilityToken {
  /** Short-lived, capability-scoped token per ADR-017; never a worker-wide credential. */
  readonly value: string;
  readonly capabilities: readonly string[];
  readonly expiresAt: Date;
}

export interface SandboxBudget {
  readonly wallClockMillis: number;
  readonly costMinorUnits: number;
}

export interface SandboxedExecutionRequest {
  readonly workId: string;
  readonly kind: SandboxedWorkKind;
  readonly tenantId: string;
  readonly region: string;
  readonly token: SandboxCapabilityToken;
  readonly budget: SandboxBudget;
  readonly input: unknown;
}

/**
 * Why the boundary ended the unit of work. `not-qualified` is the substrate
 * refusing to accept work at all; the rest are terminations by the boundary and
 * are reported in addition to, not instead of, the caller's own budget/lease checks.
 */
export type SandboxTerminationReason =
  | 'not-qualified'
  | 'budget-exceeded'
  | 'capability-violation'
  | 'crash';

export interface SandboxTermination {
  readonly reason: SandboxTerminationReason;
  readonly workId: string;
  readonly detail: string;
}

export interface SandboxedExecutionOutcome<TOutput> {
  readonly workId: string;
  readonly output: TOutput;
  readonly consumed: SandboxBudget;
}

export interface SandboxedExecutionPort {
  /** Dispatches one bounded unit of work into an isolated execution boundary. */
  execute<TOutput>(
    request: SandboxedExecutionRequest,
  ): Promise<Result<SandboxedExecutionOutcome<TOutput>, SandboxTermination>>;
}

/**
 * Resolved implementation today. Mirrors `denyUnqualifiedDependencies`: the safe
 * default is refusal, so no call site can silently believe work was isolated.
 */
export const denyUnqualifiedSandbox: SandboxedExecutionPort = {
  execute: async (request) => ({
    ok: false,
    error: {
      reason: 'not-qualified',
      workId: request.workId,
      detail: 'No sandboxed execution substrate is qualified; work was not dispatched or executed',
    },
  }),
};
