import type { DomainError, Result } from '../../shared/domain/result.js';

export interface PromptCompressionResult {
  readonly original: string;
  readonly compressed: string;
  readonly originalTokens: number;
  readonly compressedTokens: number;
}

/**
 * A pre-request utility, not a step inside `ModelGateway`: `ModelGateway.route()`/`invoke()`
 * only ever see an already-hashed `promptTemplateId`/`promptTemplateHash`, never raw prompt
 * text (see `ModelRequest` in `model-gateway.ts`), so there is no point inside the gateway
 * itself where a compression step could run. The caller that constructs a `ModelRequest` from a
 * prompt template is the one that calls `PromptCompressor.compress()` first, if the selected
 * route's `acceptsCompressedPrompt` allows it, and records both the original and compressed
 * `promptTemplateHash` in its own audit trail per ADR-010's reproducibility-manifest
 * requirement. This is a narrower, more accurate integration point than ADR-039's original
 * text suggested; the ADR's intent (opt-in compression, reproducible either way) is unchanged.
 */
export interface PromptCompressor {
  compress(text: string, instructions?: string): Promise<Result<PromptCompressionResult>>;
}

/**
 * Calls the real SynthLang sidecar (`scripts/synthlang-sidecar/server.py`) over HTTP. The
 * sidecar wraps the real `synthlang` PyPI package and requires its own adopter-supplied
 * `OPENAI_API_KEY` — this class never sees, holds, or forwards that key; it only ever gets a
 * fail-closed 503 back if the sidecar isn't configured, which it surfaces as
 * `DEPENDENCY_UNAVAILABLE`, the same code every other unqualified/unreachable dependency in
 * this platform returns.
 */
export class SynthLangCompressor implements PromptCompressor {
  constructor(
    private readonly sidecarUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async compress(text: string, instructions?: string): Promise<Result<PromptCompressionResult>> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.sidecarUrl}/compress`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, ...(instructions === undefined ? {} : { instructions }) }),
      });
    } catch {
      return denied('SynthLang sidecar unreachable', true);
    }
    if (response.status === 503) return denied('SynthLang sidecar is not configured', true);
    if (!response.ok) return denied(`SynthLang sidecar returned ${response.status}`, false);
    const body = (await response.json()) as Partial<PromptCompressionResult>;
    if (typeof body.compressed !== 'string' || typeof body.original !== 'string'
      || typeof body.originalTokens !== 'number' || typeof body.compressedTokens !== 'number') {
      return { ok: false, error: { code: 'CONTENT_REJECTED', message: 'SynthLang sidecar returned a malformed response' } };
    }
    return { ok: true, value: body as PromptCompressionResult };
  }
}

function denied(message: string, retryable: boolean): Result<never, DomainError> {
  return { ok: false, error: { code: 'DEPENDENCY_UNAVAILABLE', message, retryable } };
}
