import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Result } from '../../shared/domain/result.js';
import type { ConnectorRegistration, CapabilityClass } from '../domain/entities/connector-registration.js';
import { denyUnqualifiedDependencies, type DependencyEligibilityPort } from './dependency-eligibility.js';

export interface ConnectorPolicyDecision {
  readonly effect: 'allow' | 'deny' | 'allow-with-obligations';
  readonly obligations: readonly string[];
  readonly policySetId: string;
  readonly policyVersion: number;
}

export interface ConnectorInvocation {
  readonly tenantId: string;
  readonly capability: string;
  readonly schemaHash: string;
  readonly capabilityClass: CapabilityClass;
  readonly targetHost: string;
  readonly purpose: string;
  readonly input: unknown;
  readonly humanApprovalReference?: string;
  readonly region?: string;
  readonly dataClass?: string;
  readonly dependencyDriftFingerprint?: string;
}

export interface ConnectorClient {
  call(capability: string, input: unknown): Promise<unknown>;
}

export interface ConnectorResultEvidence {
  readonly epistemicClass: 'external-claim';
  readonly connectorId: string;
  readonly capability: string;
  readonly schemaHash: string;
  readonly outputHash: string;
  readonly output: unknown;
}

export class ConnectorGateway {
  private readonly generations = new Map<string, number>();

  constructor(
    private readonly registration: ConnectorRegistration,
    private readonly client: ConnectorClient,
    private readonly eligibility: DependencyEligibilityPort = denyUnqualifiedDependencies,
  ) {}

  async invoke(
    invocation: ConnectorInvocation,
    policy: ConnectorPolicyDecision,
    outputSchema: z.ZodType,
  ): Promise<Result<ConnectorResultEvidence>> {
    const generation = this.generations.get(this.registration.id) ?? 0;
    const qualificationGeneration = this.eligibility.generation(this.registration.id);
    if (invocation.tenantId !== this.registration.tenantId || policy.effect === 'deny') {
      return { ok: false, error: { code: 'PERMISSION_DENIED', message: 'Connector policy denied' } };
    }
    const capability = this.registration.authorizeCapability(
      invocation.capability,
      invocation.schemaHash,
      invocation.capabilityClass,
    );
    if (!capability.ok) return capability;
    if (!this.registration.permitsHost(invocation.targetHost)) {
      return { ok: false, error: { code: 'PERMISSION_DENIED', message: 'Egress host denied' } };
    }
    const dependencyUse = {
        dependencyId: this.registration.id,
        immutableVersion: invocation.schemaHash,
        region: invocation.region ?? '',
        dataClass: invocation.dataClass ?? 'internal',
        purpose: invocation.purpose,
        driftFingerprint: invocation.dependencyDriftFingerprint ?? '',
    };
    const qualified = this.eligibility.authorize(dependencyUse);
    if (!qualified.ok) return { ok: false, error: qualified.error };
    if (invocation.capabilityClass === 'write'
      && (invocation.humanApprovalReference === undefined || !policy.obligations.includes('human-review'))) {
      return { ok: false, error: { code: 'OBLIGATION_REQUIRED', message: 'Consequential write requires human review' } };
    }
    const output = await this.client.call(invocation.capability, invocation.input);
    if ((this.generations.get(this.registration.id) ?? 0) !== generation || this.registration.state === 'quarantined') {
      return { ok: false, error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Connector result fenced by quarantine' } };
    }
    const requalified = this.eligibility.authorize(dependencyUse);
    if (!requalified.ok || this.eligibility.generation(this.registration.id) !== qualificationGeneration) {
      return { ok: false, error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Connector result fenced by qualification change' } };
    }
    const parsed = outputSchema.safeParse(output);
    if (!parsed.success) return { ok: false, error: { code: 'CONTENT_REJECTED', message: 'Connector output failed validation' } };
    return {
      ok: true,
      value: {
        epistemicClass: 'external-claim',
        connectorId: this.registration.id,
        capability: invocation.capability,
        schemaHash: invocation.schemaHash,
        outputHash: createHash('sha256').update(JSON.stringify(parsed.data)).digest('hex'),
        output: parsed.data,
      },
    };
  }

  quarantine(): void {
    this.registration.quarantine();
    this.generations.set(this.registration.id, (this.generations.get(this.registration.id) ?? 0) + 1);
  }
}
