import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Result } from '../../shared/domain/result.js';

export type ModelTask = 'generation' | 'embedding' | 'reranking' | 'structured-evaluation';
export type ModelRiskTier = 'low' | 'moderate' | 'high' | 'prohibited';

export interface ModelRoute {
  readonly providerId: string;
  readonly immutableModelId: string;
  readonly tasks: readonly ModelTask[];
  readonly regions: readonly string[];
  readonly maximumRiskTier: Exclude<ModelRiskTier, 'prohibited'>;
  readonly permitsRestrictedData: boolean;
  readonly maximumCostMinorUnits: number;
  readonly priority: number;
}

export interface RoutingPolicy {
  readonly id: string;
  readonly version: number;
  readonly routes: readonly ModelRoute[];
}

export interface ModelRequest {
  readonly task: ModelTask;
  readonly tenantId: string;
  readonly region: string;
  readonly riskTier: Exclude<ModelRiskTier, 'prohibited'>;
  readonly containsRestrictedData: boolean;
  readonly maximumCostMinorUnits: number;
  readonly promptTemplateId: string;
  readonly promptTemplateHash: string;
  readonly parameters: Readonly<Record<string, number | string | boolean>>;
  readonly input: unknown;
  readonly evidenceManifest: readonly string[];
  readonly toolManifest: readonly string[];
  readonly safetyConfigurationHash: string;
}

export interface ModelProviderResponse {
  readonly output: unknown;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number; readonly costMinorUnits: number };
  readonly providerRequestId: string;
  readonly seed?: number;
}

export interface ModelProviderPort {
  invoke(modelId: string, request: ModelRequest): Promise<ModelProviderResponse>;
}

export interface GeneratedArtifact {
  readonly routingPolicyId: string;
  readonly routingPolicyVersion: number;
  readonly providerId: string;
  readonly immutableModelId: string;
  readonly promptTemplateHash: string;
  readonly parameters: Readonly<Record<string, number | string | boolean>>;
  readonly evidenceManifest: readonly string[];
  readonly toolManifest: readonly string[];
  readonly safetyConfigurationHash: string;
  readonly usage: ModelProviderResponse['usage'];
  readonly providerRequestId: string;
  readonly producedAt: Date;
  readonly outputHash: string;
  readonly output: unknown;
  readonly seed?: number;
}

const riskOrder: Record<Exclude<ModelRiskTier, 'prohibited'>, number> = { low: 0, moderate: 1, high: 2 };

export class ModelGateway {
  constructor(
    private readonly policy: RoutingPolicy,
    private readonly providers: ReadonlyMap<string, ModelProviderPort>,
  ) {}

  route(request: ModelRequest): Result<ModelRoute> {
    const route = [...this.policy.routes]
      .filter(({ tasks }) => tasks.includes(request.task))
      .filter(({ regions }) => regions.includes(request.region))
      .filter(({ maximumRiskTier }) => riskOrder[request.riskTier] <= riskOrder[maximumRiskTier])
      .filter(({ permitsRestrictedData }) => !request.containsRestrictedData || permitsRestrictedData)
      .filter(({ maximumCostMinorUnits }) => maximumCostMinorUnits <= request.maximumCostMinorUnits)
      .sort((a, b) => b.priority - a.priority)[0];
    return route === undefined
      ? { ok: false, error: { code: 'RISK_NOT_SUPPORTED', message: 'No policy-compliant immutable model route exists' } }
      : { ok: true, value: route };
  }

  async invoke(request: ModelRequest, outputSchema: z.ZodType): Promise<Result<GeneratedArtifact>> {
    const routed = this.route(request);
    if (!routed.ok) return routed;
    if (/^(latest|stable|default)$/i.test(routed.value.immutableModelId)) {
      return { ok: false, error: { code: 'INVARIANT_VIOLATION', message: 'Mutable model aliases are forbidden' } };
    }
    const provider = this.providers.get(routed.value.providerId);
    if (provider === undefined) return { ok: false, error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Provider unavailable', retryable: true } };
    const response = await provider.invoke(routed.value.immutableModelId, request);
    const parsed = outputSchema.safeParse(response.output);
    if (!parsed.success) return { ok: false, error: { code: 'CONTENT_REJECTED', message: 'Provider output failed schema validation' } };
    return {
      ok: true,
      value: {
        routingPolicyId: this.policy.id,
        routingPolicyVersion: this.policy.version,
        providerId: routed.value.providerId,
        immutableModelId: routed.value.immutableModelId,
        promptTemplateHash: request.promptTemplateHash,
        parameters: request.parameters,
        evidenceManifest: request.evidenceManifest,
        toolManifest: request.toolManifest,
        safetyConfigurationHash: request.safetyConfigurationHash,
        usage: response.usage,
        providerRequestId: response.providerRequestId,
        producedAt: new Date(),
        outputHash: createHash('sha256').update(JSON.stringify(parsed.data)).digest('hex'),
        output: parsed.data,
        ...(response.seed === undefined ? {} : { seed: response.seed }),
      },
    };
  }
}
