import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  evaluateCompressionQuality,
  fixtureAnchorDefects,
  fixtureSetSchema,
  MINIMUM_COHORT,
  type CompressionSample,
} from '../../scripts/synthlang-evaluation/compression-quality.js';

function runEvaluation(env: Readonly<Record<string, string>>): { status: number | null; output: string } {
  const base = { ...process.env };
  delete base['SYNTHLANG_SIDECAR_URL'];
  delete base['SYNTHLANG_SIDECAR_URL_FILE'];
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/evaluate-synthlang-compression.ts'], {
    cwd: process.cwd(),
    env: { ...base, ...env },
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/** A pair that clears every bar, used as the base for one-variable-at-a-time failures. */
function passingSample(index: number, overrides: Partial<CompressionSample> = {}): CompressionSample {
  return {
    promptId: `p-${index}`,
    task: 'generation',
    epistemicClass: 'observed-fact',
    original: 'Record DR-4471 closed on 2026-07-14 in region EU-1 with no outstanding objection.',
    compressed: 'DR-4471 closed 2026-07-14 EU-1 no objection',
    originalTokens: 100,
    compressedTokens: 70,
    mustPreserve: ['DR-4471', '2026-07-14', 'EU-1'],
    ...overrides,
  };
}

const cohort = (overrides: Partial<CompressionSample> = {}, count = MINIMUM_COHORT): CompressionSample[] =>
  Array.from({ length: count }, (_unused, index) => passingSample(index, overrides));

describe('ADR-044 evaluation script in an environment with no configured sidecar', () => {
  it('skips cleanly and exits 0 when SYNTHLANG_SIDECAR_URL is unset', () => {
    const { status, output } = runEvaluation({});
    expect(status).toBe(0);
    expect(output).toContain('evaluation skipped: SynthLang sidecar not configured');
  });

  it('skips cleanly and exits 0 when a sidecar URL is set but nothing is listening', () => {
    // The real DEPENDENCY_UNAVAILABLE path: a configured URL whose sidecar has no API key, or
    // is not running, is an environment fact and must not be reported as a quality failure.
    const { status, output } = runEvaluation({
      SYNTHLANG_SIDECAR_URL: 'http://127.0.0.1:1',
      SYNTHLANG_IMMUTABLE_VERSION: 'synthlang@0.1.4',
    });
    expect(status).toBe(0);
    expect(output).toContain('evaluation skipped: SynthLang sidecar not configured');
  });

  it('refuses to run against an unnamed sidecar version', () => {
    const { status, output } = runEvaluation({ SYNTHLANG_SIDECAR_URL: 'http://127.0.0.1:1' });
    expect(status).toBe(1);
    expect(output).toContain('SYNTHLANG_IMMUTABLE_VERSION');
  });
});

describe('ADR-044 held-out fixture set', () => {
  const path = fileURLToPath(new URL('../fixtures/synthlang-evaluation/prompts.json', import.meta.url));
  const fixtures = fixtureSetSchema.parse(JSON.parse(readFileSync(path, 'utf8')));

  it('every anchor occurs in its own prompt, so a perfect score is attainable', () => {
    expect(fixtureAnchorDefects(fixtures.prompts)).toEqual([]);
  });

  it('covers every ModelTask and every EpistemicClass and clears the cohort minimum', () => {
    expect(fixtures.prompts.length).toBeGreaterThanOrEqual(MINIMUM_COHORT);
    expect(new Set(fixtures.prompts.map(({ task }) => task))).toEqual(
      new Set(['generation', 'embedding', 'reranking', 'structured-evaluation']),
    );
    expect(new Set(fixtures.prompts.map(({ epistemicClass }) => epistemicClass)).size).toBe(7);
    expect(new Set(fixtures.prompts.map(({ id }) => id)).size).toBe(fixtures.prompts.length);
  });
});

describe('ADR-044 pass/fail bar', () => {
  it('passes a cohort with real savings and every anchor preserved', () => {
    const result = evaluateCompressionQuality(cohort());
    expect(result?.passed).toBe(true);
    expect(result?.count).toBe(MINIMUM_COHORT);
    expect(result?.meanTokenSavings).toBeCloseTo(0.3, 10);
    expect(result?.meanPreservation).toBe(1);
  });

  it('is inconclusive rather than passing below the minimum cohort', () => {
    expect(evaluateCompressionQuality(cohort({}, MINIMUM_COHORT - 1))).toBeUndefined();
  });

  it('fails when a single material prompt loses one anchor, however small the loss', () => {
    const samples = cohort();
    samples[0] = passingSample(0, { compressed: 'closed 2026-07-14 EU-1 no objection' });
    const result = evaluateCompressionQuality(samples);
    expect(result?.passed).toBe(false);
    expect(result?.failures.join('\n')).toContain('"DR-4471"');
    // 1/30 anchors lost across the cohort still clears the 95% mean bar: the material floor,
    // not the aggregate, is what catches it -- ADR-044 step 4's whole point.
    expect(result?.meanPreservation).toBeGreaterThan(0.95);
  });

  it('tolerates a loss at the non-material floor that the same loss on a material prompt fails', () => {
    const eroded = {
      original: 'Demand rises 18% in Q4 2026 with an 80% interval of 9% to 27%; this is an estimate, '
        + 'not an outcome, and the interval must travel with the point value.',
      compressed: 'demand rises +18% Q4 2026, 80% interval 9% to 27%, an estimate; '
        + 'the interval travels with the point value',
      mustPreserve: ['demand', 'rises', '18%', 'Q4 2026', '80% interval', '9% to 27%',
        'an estimate', 'not an outcome', 'the interval', 'point value'],
    };
    const withClass = (epistemicClass: CompressionSample['epistemicClass']) => {
      const samples = cohort();
      samples[0] = passingSample(0, { epistemicClass, ...eroded });
      return evaluateCompressionQuality(samples);
    };

    const tolerated = withClass('estimate');
    expect(tolerated?.worstPreservation).toBeCloseTo(0.9, 10);
    expect(tolerated?.passed).toBe(true);
    expect(withClass('observed-fact')?.passed).toBe(false);
  });

  it('fails a non-material prompt once the loss passes its floor', () => {
    const samples = cohort();
    samples[0] = passingSample(0, {
      epistemicClass: 'assumption',
      compressed: 'closed',
      mustPreserve: ['DR-4471', '2026-07-14', 'EU-1'],
    });
    const result = evaluateCompressionQuality(samples);
    expect(result?.passed).toBe(false);
    expect(result?.failures.join('\n')).toContain('non-material');
  });

  it('fails when savings are real but too thin to repay the dependency', () => {
    const result = evaluateCompressionQuality(cohort({ compressedTokens: 95 }));
    expect(result?.passed).toBe(false);
    expect(result?.failures.join('\n')).toContain('below the required 15%');
  });

  it('fails a single prompt shape that the compressor inflates, without averaging it away', () => {
    const samples = cohort();
    samples[0] = passingSample(0, { originalTokens: 100, compressedTokens: 130 });
    const result = evaluateCompressionQuality(samples);
    expect(result?.passed).toBe(false);
    expect(result?.meanTokenSavings).toBeGreaterThan(0.15);
    expect(result?.failures.join('\n')).toContain('did not reduce token count');
  });

  it('fails on broad shallow erosion that stays inside every individual floor', () => {
    // Every prompt non-material and losing exactly one of ten anchors: 90% each, at the floor,
    // so no per-sample failure fires -- the 95% aggregate bar is what catches the erosion.
    const result = evaluateCompressionQuality(cohort({
      epistemicClass: 'model-inference',
      compressed: 'a b c d e f g h i',
      mustPreserve: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
    }));
    expect(result?.passed).toBe(false);
    expect(result?.meanPreservation).toBeCloseTo(0.9, 10);
    expect(result?.failures).toHaveLength(1);
    expect(result?.failures[0]).toContain('mean content preservation');
  });

  it('matches anchors across recasing and reflowing rather than counting them lost', () => {
    const result = evaluateCompressionQuality(cohort({
      compressed: 'dr-4471\n  closed   2026-07-14\teu-1',
    }));
    expect(result?.passed).toBe(true);
  });

  it('throws on token counts that cannot be compared', () => {
    expect(() => evaluateCompressionQuality(cohort({ originalTokens: 0 }))).toThrow('Token counts must be positive');
  });
});
