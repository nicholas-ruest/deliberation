import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SynthLangCompressor } from '../src/platform/model-gateway/synthlang-compressor.js';
import { EnvSecretProvider } from '../src/platform/security/secret-provider.js';
import {
  evaluateCompressionQuality,
  fixtureAnchorDefects,
  fixtureSetSchema,
  MINIMUM_MEAN_PRESERVATION,
  MINIMUM_MEAN_TOKEN_SAVINGS,
  type CompressionSample,
} from './synthlang-evaluation/compression-quality.js';

/**
 * ADR-044's held-out compression evaluation, run deliberately by a person against a real
 * SynthLang sidecar. It is NOT a required CI gate: no key, no sidecar, no verdict. An
 * environment that legitimately has no `OPENAI_API_KEY` (this repository's own CI, every
 * contributor sandbox) must not be told the evaluation failed -- it did not run.
 *
 *   SYNTHLANG_SIDECAR_URL=http://127.0.0.1:8137 \
 *   SYNTHLANG_IMMUTABLE_VERSION=synthlang@0.1.4 \
 *   npm run evaluate:synthlang-compression
 *
 * A pass is evidence for exactly one `immutableProviderVersion` (ADR-031, ADR-044 step 5), which
 * is why the version must be named before the run rather than read off the report afterwards.
 */

const secrets = new EnvSecretProvider();
const sidecarUrl = secrets.optional('SYNTHLANG_SIDECAR_URL');
if (sidecarUrl === undefined) {
  console.log('evaluation skipped: SynthLang sidecar not configured '
    + '(set SYNTHLANG_SIDECAR_URL, and give the sidecar its own OPENAI_API_KEY, to run it).');
  process.exit(0);
}

const immutableVersion = secrets.optional('SYNTHLANG_IMMUTABLE_VERSION');
if (immutableVersion === undefined) {
  console.error('SYNTHLANG_IMMUTABLE_VERSION must name the exact sidecar/package version under '
    + 'evaluation: a result that is not bound to one is not qualification evidence (ADR-031, ADR-044).');
  process.exit(1);
}

const fixturePath = process.env['SYNTHLANG_EVALUATION_FIXTURES']
  ?? fileURLToPath(new URL('../tests/fixtures/synthlang-evaluation/prompts.json', import.meta.url));
const fixtures = fixtureSetSchema.parse(JSON.parse(await readFile(fixturePath, 'utf8')));
const defects = fixtureAnchorDefects(fixtures.prompts);
if (defects.length > 0) {
  console.error(`Fixture set is malformed:\n${defects.join('\n')}`);
  process.exit(1);
}

const compressor = new SynthLangCompressor(sidecarUrl);
const samples: CompressionSample[] = [];
for (const fixture of fixtures.prompts) {
  const result = await compressor.compress(fixture.prompt);
  if (!result.ok) {
    // The sidecar being unconfigured or unreachable is an environment fact, not a quality
    // verdict -- the same DEPENDENCY_UNAVAILABLE every other unqualified dependency returns.
    if (result.error.code === 'DEPENDENCY_UNAVAILABLE') {
      console.log(`evaluation skipped: SynthLang sidecar not configured (${result.error.message}).`);
      process.exit(0);
    }
    console.error(`Compression failed for ${fixture.id}: ${result.error.code} ${result.error.message}`);
    process.exit(1);
  }
  samples.push({
    promptId: fixture.id,
    task: fixture.task,
    epistemicClass: fixture.epistemicClass,
    original: result.value.original,
    compressed: result.value.compressed,
    originalTokens: result.value.originalTokens,
    compressedTokens: result.value.compressedTokens,
    mustPreserve: fixture.mustPreserve,
  });
}

const evaluation = evaluateCompressionQuality(samples);
if (evaluation === undefined) {
  console.error(`Inconclusive: ${samples.length} pairs is below the minimum cohort. Not a pass.`);
  process.exit(1);
}

console.log(`SynthLang held-out compression evaluation (ADR-044) — version ${immutableVersion}`);
console.log(`fixtures: ${fixturePath} (${fixtures.provenance['origin'] ?? 'unknown origin'})`);
for (const sample of evaluation.samples) {
  console.log(
    `  ${sample.promptId.padEnd(32)} ${sample.material ? 'material    ' : 'non-material'} `
    + `savings ${(sample.tokenSavings * 100).toFixed(1).padStart(6)}%  `
    + `preservation ${(sample.preservation * 100).toFixed(1).padStart(6)}%`
    + (sample.lostAnchors.length === 0 ? '' : `  lost: ${sample.lostAnchors.join(' | ')}`),
  );
}
console.log(
  `cohort ${evaluation.count}  mean savings ${(evaluation.meanTokenSavings * 100).toFixed(1)}% `
  + `(bar ${(MINIMUM_MEAN_TOKEN_SAVINGS * 100).toFixed(0)}%)  `
  + `mean preservation ${(evaluation.meanPreservation * 100).toFixed(1)}% `
  + `(bar ${(MINIMUM_MEAN_PRESERVATION * 100).toFixed(0)}%)  `
  + `worst preservation ${(evaluation.worstPreservation * 100).toFixed(1)}%`,
);

if (!evaluation.passed) {
  console.error(`FAIL — SynthLang stays below \`eligible\`; no route may set acceptsCompressedPrompt.\n`
    + evaluation.failures.map((failure) => `  - ${failure}`).join('\n'));
  process.exit(1);
}
console.log(`PASS — evidence supports moving SynthLang toward \`eligible\` for ${immutableVersion} only; `
  + 'a version bump re-opens this gate (ADR-044 step 5).');
