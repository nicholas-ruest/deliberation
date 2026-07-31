import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const Claims = z.object({
  tenantId: z.string().uuid(),
  subjectId: z.string().uuid(),
  audience: z.string().min(1),
  actions: z.array(z.string()).min(1),
  resources: z.array(z.string()).min(1),
  purpose: z.string().min(1),
  budget: z.record(z.string(), z.number().nonnegative()),
  workflowId: z.string().uuid(),
  generation: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
});
export type CapabilityClaims = z.infer<typeof Claims>;

export class CapabilityTokenService {
  constructor(private readonly signingKey: Uint8Array) {}

  issue(claims: CapabilityClaims): string {
    const payload = Buffer.from(JSON.stringify(Claims.parse(claims))).toString('base64url');
    return `${payload}.${this.sign(payload)}`;
  }

  verify(token: string, audience: string, nowEpochSeconds: number): CapabilityClaims {
    const [payload, signature, extra] = token.split('.');
    if (payload === undefined || signature === undefined || extra !== undefined) throw new Error('Malformed capability token');
    const expected = Buffer.from(this.sign(payload));
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new Error('Invalid capability signature');
    const claims = Claims.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    if (claims.audience !== audience || claims.expiresAt <= nowEpochSeconds) throw new Error('Expired or wrong-audience capability');
    return claims;
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.signingKey).update(payload).digest('base64url');
  }
}
