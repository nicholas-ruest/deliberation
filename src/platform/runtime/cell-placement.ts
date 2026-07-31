import type { Result } from '../../shared/domain/result.js';

export interface CellAssignment {
  readonly cellId: string;
  readonly region: string;
  readonly tenantId: string;
}

export class CellPlacementGuard {
  constructor(private readonly assignments: ReadonlyMap<string, CellAssignment>) {}

  authorize(tenantId: string, cellId: string, region: string): Result<CellAssignment> {
    const assignment = this.assignments.get(tenantId);
    if (assignment === undefined) {
      return { ok: false, error: { code: 'PERMISSION_DENIED', message: 'Tenant has no trusted cell assignment' } };
    }
    if (assignment.cellId !== cellId || assignment.region !== region || assignment.tenantId !== tenantId) {
      return { ok: false, error: { code: 'PERMISSION_DENIED', message: 'Cross-cell or cross-region execution denied' } };
    }
    return { ok: true, value: assignment };
  }
}
