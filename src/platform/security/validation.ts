import { z } from 'zod';
import type { Result } from '../../shared/domain/result.js';

export type TrustBoundary = 'prompt' | 'retrieved-content' | 'model-output' | 'connector-schema' | 'connector-result';

export interface Validated<T> {
  readonly boundary: TrustBoundary;
  readonly value: T;
  readonly contentHash: string;
}

export class BoundaryValidator {
  validate<T>(
    boundary: TrustBoundary,
    schema: z.ZodType<T>,
    candidate: unknown,
    contentHash: string,
  ): Result<Validated<T>> {
    const parsed = schema.safeParse(candidate);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: 'CONTENT_REJECTED',
          message: `Untrusted ${boundary} failed validation`,
          details: { issues: parsed.error.issues.map(({ path, code }) => ({ path, code })) },
        },
      };
    }
    return { ok: true, value: { boundary, value: parsed.data, contentHash } };
  }
}

export const SafeGeneratedText = z.object({
  text: z.string().max(200_000),
  citations: z.array(z.string().uuid()).max(500),
  requestedToolCalls: z.never().optional(),
});
