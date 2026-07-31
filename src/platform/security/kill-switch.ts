export type DependencyClass = 'model-provider' | 'connector' | 'branch-memory' | 'learning-engine';

export interface KillSwitchDecision {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly generation: number;
}

export class KillSwitchRegistry {
  private readonly states = new Map<string, { enabled: boolean; reason?: string; generation: number }>();

  disable(dependencyClass: DependencyClass, id: string, reason: string): number {
    const key = `${dependencyClass}:${id}`;
    const previous = this.states.get(key);
    const generation = (previous?.generation ?? 0) + 1;
    this.states.set(key, { enabled: false, reason, generation });
    return generation;
  }

  enable(dependencyClass: DependencyClass, id: string): number {
    const key = `${dependencyClass}:${id}`;
    const generation = (this.states.get(key)?.generation ?? 0) + 1;
    this.states.set(key, { enabled: true, generation });
    return generation;
  }

  decide(dependencyClass: DependencyClass, id: string): KillSwitchDecision {
    const state = this.states.get(`${dependencyClass}:${id}`);
    if (state === undefined || state.enabled) return { allowed: true, generation: state?.generation ?? 0 };
    return {
      allowed: false,
      generation: state.generation,
      ...(state.reason === undefined ? {} : { reason: state.reason }),
    };
  }
}
