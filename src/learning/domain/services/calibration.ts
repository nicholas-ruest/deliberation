export interface CalibrationPair {
  readonly probability: number;
  readonly observed: 0 | 1;
}

export interface CalibrationResult {
  readonly count: number;
  readonly brierScore: number;
  readonly meanPredicted: number;
  readonly observedRate: number;
}

export function computeCalibration(pairs: readonly CalibrationPair[], minimumCohort: number): CalibrationResult | undefined {
  if (pairs.length < minimumCohort) return undefined;
  if (pairs.some(({ probability }) => !Number.isFinite(probability) || probability < 0 || probability > 1)) {
    throw new Error('Probabilities must be bounded');
  }
  return {
    count: pairs.length,
    brierScore: pairs.reduce((sum, pair) => sum + (pair.probability - pair.observed) ** 2, 0) / pairs.length,
    meanPredicted: pairs.reduce((sum, pair) => sum + pair.probability, 0) / pairs.length,
    observedRate: pairs.reduce((sum, pair) => sum + pair.observed, 0) / pairs.length,
  };
}
