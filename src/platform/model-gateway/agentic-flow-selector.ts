import { CostOptimalRouter } from 'agentic-flow/router/cost-optimal';
import type { ModelRequest, ModelRoute, ModelSelector } from './model-gateway.js';

/**
 * Wraps agentic-flow's CostOptimalRouter (ADR-036) as a ModelSelector. It may
 * only choose AMONG the routes ModelGateway.route() has already filtered for
 * policy compliance (task, region, risk tier, restricted-data, cost ceiling)
 * — it never sees, and cannot propose, a route outside that set. ModelGateway
 * re-validates the selection is actually a member of the compliant set before
 * using it, so a bug or an unexpected response from this dependency cannot
 * smuggle in an unapproved route; it can only fail closed to the existing
 * static-priority behavior.
 *
 * No labelled (query -> quality) examples exist yet, so every call exercises
 * the router's documented cold-start path: with zero examples per candidate it
 * falls back to a stable, deterministic pick rather than a real quality
 * prediction. The vector passed to the router is a coarse deterministic
 * feature encoding of the request (task, risk tier, restricted-data flag, cost
 * ceiling), not a semantic embedding — real tuning would feed labelled eval
 * examples and a proper embedder; that is future work, not part of this ADR.
 */
export class AgenticFlowCostOptimalSelector implements ModelSelector {
  select(candidates: readonly ModelRoute[], request: ModelRequest): ModelRoute | undefined {
    if (candidates.length === 0) return undefined;
    const byId = new Map(candidates.map((route) => [routeId(route), route] as const));
    const router = CostOptimalRouter.fromCandidates(
      candidates.map((route) => ({ id: routeId(route), costPerMTok: route.maximumCostMinorUnits, examples: [] })),
    );
    const decision = router.route(featureVector(request));
    return byId.get(decision.id);
  }
}

function routeId(route: ModelRoute): string {
  return `${route.providerId}:${route.immutableModelId}`;
}

const TASKS: readonly string[] = ['generation', 'embedding', 'reranking', 'structured-evaluation'];
const RISK_TIERS: readonly string[] = ['low', 'moderate', 'high'];

function featureVector(request: ModelRequest): number[] {
  return [
    TASKS.indexOf(request.task),
    RISK_TIERS.indexOf(request.riskTier),
    request.containsRestrictedData ? 1 : 0,
    request.maximumCostMinorUnits,
  ];
}
