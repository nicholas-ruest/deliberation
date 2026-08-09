import { z } from 'zod';
import type { EpistemicClass } from '../../src/evidence/domain/entities/evidence-record.js';
import type { ModelTask } from '../../src/platform/model-gateway/model-gateway.js';

/**
 * ADR-044's pass/fail bar, as a pure function over already-collected compressed/uncompressed
 * pairs. Deliberately side-effect free and independent of the sidecar so the bar itself can be
 * unit-tested on synthetic pairs (`tests/platform/synthlang-compression-evaluation.test.ts`)
 * without an API key, exactly as `computeCalibration` is testable without a provider.
 *
 * Shape mirrors `src/learning/domain/services/calibration.ts`: a cohort minimum below which the
 * answer is `undefined` (inconclusive) rather than a lenient pass, aggregate statistics over the
 * cohort, and a hard throw on inputs that are not numerically meaningful. The statistics differ
 * because the question differs -- calibration compares predicted probability against observed
 * outcome; this compares two text variants on cost and on content preservation.
 */

/** ADR-005 classes whose content asserts something about the world a decision may rely on. */
export const MATERIAL_EPISTEMIC_CLASSES: ReadonlySet<EpistemicClass> = new Set<EpistemicClass>([
  'observed-fact',
  'user-assertion',
  'external-claim',
]);

/**
 * Thresholds. These are judgment calls, stated here so pass/fail is not invented at the moment
 * someone runs the evaluation (ADR-044's whole point). Each is defensible, none is sacred; change
 * them by editing this file in a reviewed change, never by arguing with a printed report.
 *
 * - `MINIMUM_COHORT = 10`: fewer pairs than this cannot distinguish a real effect from the
 *   idiosyncrasies of two or three prompt shapes. Matches `computeCalibration`'s treatment of a
 *   thin cohort as inconclusive rather than passing.
 * - `MINIMUM_MEAN_TOKEN_SAVINGS = 0.15`: compression must earn its keep. Adopting it costs a
 *   qualified external dependency (ADR-031), a Python sidecar with its own API key, and a second
 *   `promptTemplateHash` recorded in every reproducibility manifest (ADR-010). Under ~15% mean
 *   input-token savings that overhead is not repaid, and the measured delta is also close to the
 *   spread between different providers' tokenizers on the same text -- so a smaller "win" is not
 *   reliably a win at all.
 * - `MATERIAL_PRESERVATION_FLOOR = 1`: zero tolerance. ADR-044 step 4 is explicit that quality
 *   regression on any material claim category fails the gate and that token savings do not offset
 *   a correctness regression on a consequential decision input. One dropped identifier, date,
 *   amount, jurisdiction, or negation in an `observed-fact`/`user-assertion`/`external-claim`
 *   prompt is exactly that regression.
 * - `NON_MATERIAL_PRESERVATION_FLOOR = 0.9`: estimates, assumptions, model inferences, and
 *   simulated results still carry hedges and interval bounds worth keeping, but losing one span
 *   in a narrative framing prompt does not corrupt a recorded claim. A tenth of the anchors is a
 *   deliberate, small allowance rather than a free pass.
 * - `MINIMUM_MEAN_PRESERVATION = 0.95`: catches broad shallow erosion that stays just above every
 *   individual floor.
 * - Any single pair whose compressed variant is not smaller than the original fails outright: a
 *   "compression" that inflates a prompt shape is a cost regression on that shape, and averaging
 *   it away against wins elsewhere would hide it.
 */
export const MINIMUM_COHORT = 10;
export const MINIMUM_MEAN_TOKEN_SAVINGS = 0.15;
export const MATERIAL_PRESERVATION_FLOOR = 1;
export const NON_MATERIAL_PRESERVATION_FLOOR = 0.9;
export const MINIMUM_MEAN_PRESERVATION = 0.95;

export const fixtureSetSchema = z.object({
  schemaVersion: z.literal(1),
  provenance: z.record(z.string(), z.string()),
  prompts: z.array(z.object({
    id: z.string().min(1),
    task: z.enum(['generation', 'embedding', 'reranking', 'structured-evaluation']),
    epistemicClass: z.enum([
      'observed-fact', 'user-assertion', 'external-claim', 'estimate',
      'assumption', 'model-inference', 'simulated-result',
    ]),
    prompt: z.string().min(1),
    mustPreserve: z.array(z.string().min(1)).min(1),
  })).min(1),
});

export type FixturePrompt = z.infer<typeof fixtureSetSchema>['prompts'][number];

export interface CompressionSample {
  readonly promptId: string;
  readonly task: ModelTask;
  readonly epistemicClass: EpistemicClass;
  readonly original: string;
  readonly compressed: string;
  readonly originalTokens: number;
  readonly compressedTokens: number;
  readonly mustPreserve: readonly string[];
}

export interface SampleScore {
  readonly promptId: string;
  readonly epistemicClass: EpistemicClass;
  readonly material: boolean;
  readonly tokenSavings: number;
  readonly preservation: number;
  readonly preservationFloor: number;
  readonly lostAnchors: readonly string[];
}

export interface CompressionQualityResult {
  readonly count: number;
  readonly meanTokenSavings: number;
  readonly meanPreservation: number;
  readonly worstPreservation: number;
  readonly samples: readonly SampleScore[];
  readonly failures: readonly string[];
  readonly passed: boolean;
}

/** Case- and whitespace-insensitive so reflowing or recasing a span is not counted as losing it. */
export function normalizeForAnchorMatch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function findLostAnchors(compressed: string, mustPreserve: readonly string[]): readonly string[] {
  const haystack = normalizeForAnchorMatch(compressed);
  return mustPreserve.filter((anchor) => !haystack.includes(normalizeForAnchorMatch(anchor)));
}

/** A fixture whose anchor does not occur in its own prompt can never be satisfied. */
export function fixtureAnchorDefects(prompts: readonly FixturePrompt[]): readonly string[] {
  return prompts.flatMap((prompt) =>
    findLostAnchors(prompt.prompt, prompt.mustPreserve).map(
      (anchor) => `${prompt.id}: mustPreserve anchor ${JSON.stringify(anchor)} does not occur in its own prompt text`,
    ));
}

function scoreSample(sample: CompressionSample): SampleScore {
  if (!Number.isFinite(sample.originalTokens) || sample.originalTokens <= 0
    || !Number.isFinite(sample.compressedTokens) || sample.compressedTokens < 0) {
    throw new Error(`Token counts must be positive and finite (${sample.promptId})`);
  }
  const material = MATERIAL_EPISTEMIC_CLASSES.has(sample.epistemicClass);
  const lostAnchors = findLostAnchors(sample.compressed, sample.mustPreserve);
  return {
    promptId: sample.promptId,
    epistemicClass: sample.epistemicClass,
    material,
    tokenSavings: (sample.originalTokens - sample.compressedTokens) / sample.originalTokens,
    preservation: (sample.mustPreserve.length - lostAnchors.length) / sample.mustPreserve.length,
    preservationFloor: material ? MATERIAL_PRESERVATION_FLOOR : NON_MATERIAL_PRESERVATION_FLOOR,
    lostAnchors,
  };
}

/**
 * Returns `undefined` when the cohort is too thin to judge -- an inconclusive evaluation, which
 * ADR-044 treats as "not a pass", never as a pass.
 */
export function evaluateCompressionQuality(
  samples: readonly CompressionSample[],
  minimumCohort: number = MINIMUM_COHORT,
): CompressionQualityResult | undefined {
  if (samples.length < minimumCohort) return undefined;
  const scores = samples.map(scoreSample);
  const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
  const meanTokenSavings = mean(scores.map((score) => score.tokenSavings));
  const meanPreservation = mean(scores.map((score) => score.preservation));
  const failures: string[] = [];

  for (const score of scores) {
    if (score.preservation < score.preservationFloor) {
      failures.push(
        `${score.promptId} (${score.epistemicClass}, ${score.material ? 'material' : 'non-material'}): `
        + `preservation ${score.preservation.toFixed(3)} below floor ${score.preservationFloor.toFixed(2)}; `
        + `lost ${score.lostAnchors.map((anchor) => JSON.stringify(anchor)).join(', ')}`,
      );
    }
    if (score.tokenSavings <= 0) {
      failures.push(
        `${score.promptId}: compression did not reduce token count (savings ${(score.tokenSavings * 100).toFixed(1)}%)`,
      );
    }
  }
  if (meanTokenSavings < MINIMUM_MEAN_TOKEN_SAVINGS) {
    failures.push(
      `mean token savings ${(meanTokenSavings * 100).toFixed(1)}% below the required `
      + `${(MINIMUM_MEAN_TOKEN_SAVINGS * 100).toFixed(0)}%`,
    );
  }
  if (meanPreservation < MINIMUM_MEAN_PRESERVATION) {
    failures.push(
      `mean content preservation ${(meanPreservation * 100).toFixed(1)}% below the required `
      + `${(MINIMUM_MEAN_PRESERVATION * 100).toFixed(0)}%`,
    );
  }

  return {
    count: scores.length,
    meanTokenSavings,
    meanPreservation,
    worstPreservation: Math.min(...scores.map((score) => score.preservation)),
    samples: scores,
    failures,
    passed: failures.length === 0,
  };
}
