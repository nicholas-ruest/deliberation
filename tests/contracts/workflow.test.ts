import { describe, expect, it, vi } from 'vitest';
import { DurableWorkflow, InMemoryWorkflowStore, type WorkflowStep } from '../../src/platform/workflows/index.js';

describe('durable workflow', () => {
  it('retries transient work and progresses without duplicate successful steps', async () => {
    let attempt = 0;
    const execute = vi.fn(async () => {
      attempt += 1;
      return attempt === 1
        ? { ok: false as const, error: { code: 'DEPENDENCY_UNAVAILABLE' as const, message: 'retry', retryable: true } }
        : { ok: true as const, value: undefined };
    });
    const step: WorkflowStep<{ value: number }> = { name: 'external', execute };
    const engine = new DurableWorkflow(new InMemoryWorkflowStore(), [step], {
      maximumAttempts: 3,
      initialDelayMs: 1,
      maximumDelayMs: 10,
      jitterRatio: 0,
    });
    expect((await engine.start('workflow', 'tenant', { value: 1 })).ok).toBe(true);
    expect((await engine.tick('workflow')).ok).toBe(true);
    expect((await engine.tick('workflow')).ok).toBe(true);
    const completed = await engine.tick('workflow');
    expect(completed.ok && completed.value.status).toBe('succeeded');
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
