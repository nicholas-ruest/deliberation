import type { Result } from '../../shared/domain/result.js';
import type { FrozenRunManifest, PlanningBudget, ScenarioTree } from '../domain/entities/scenario-tree.js';

export interface StartRunRequest {
  readonly workflowId: string;
  readonly tenantId: string;
  readonly caseId: string;
  readonly revision: number;
  readonly rootBranchId: string;
  readonly budget: PlanningBudget;
}

export interface StartRunDependencies {
  validateDeliberation(request: StartRunRequest): Promise<Result<{ readonly revisionHash: string }>>;
  authorize(request: StartRunRequest): Promise<Result<{ readonly policyVersion: string; readonly safetyCaseVersion: string }>>;
  reserve(request: StartRunRequest): Promise<Result<{ readonly reservationId: string }>>;
  releaseReservation(reservationId: string): Promise<Result<void>>;
  freezeInputs(request: StartRunRequest): Promise<Result<Omit<FrozenRunManifest, 'deliberationRevisionHash' | 'policyVersion' | 'safetyCaseVersion' | 'reservationId'>>>;
  createTree(request: StartRunRequest, manifest: FrozenRunManifest): Promise<Result<ScenarioTree>>;
}

export class StartRunSaga {
  constructor(private readonly dependencies: StartRunDependencies) {}

  async execute(request: StartRunRequest): Promise<Result<ScenarioTree>> {
    const deliberation = await this.dependencies.validateDeliberation(request);
    if (!deliberation.ok) return deliberation;
    const authorization = await this.dependencies.authorize(request);
    if (!authorization.ok) return authorization;
    const reservation = await this.dependencies.reserve(request);
    if (!reservation.ok) return reservation;
    const frozen = await this.dependencies.freezeInputs(request);
    if (!frozen.ok) {
      await this.dependencies.releaseReservation(reservation.value.reservationId);
      return frozen;
    }
    const manifest: FrozenRunManifest = Object.freeze({
      deliberationRevisionHash: deliberation.value.revisionHash,
      policyVersion: authorization.value.policyVersion,
      safetyCaseVersion: authorization.value.safetyCaseVersion,
      reservationId: reservation.value.reservationId,
      ...frozen.value,
    });
    const tree = await this.dependencies.createTree(request, manifest);
    if (!tree.ok) {
      await this.dependencies.releaseReservation(reservation.value.reservationId);
      return tree;
    }
    return tree;
  }
}
