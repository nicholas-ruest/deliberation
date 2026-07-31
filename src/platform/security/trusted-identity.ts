import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import type { Result } from '../../shared/domain/result.js';

export interface TrustedIssuer {
  readonly issuer: string;
  readonly audiences: readonly string[];
  readonly keys: ReadonlyMap<string, string | KeyObject>;
}

export interface VerifiedIdentity {
  readonly issuer: string;
  readonly principalId: string;
  readonly tenantId: string;
  readonly audience: string;
  readonly sessionEpoch: number;
  readonly tokenId: string;
  readonly expiresAt: number;
}

export interface ReplayStore {
  consume(tokenId: string, expiresAt: number): boolean;
}

export class MemoryReplayStore implements ReplayStore {
  private readonly consumed = new Map<string, number>();
  consume(tokenId: string, expiresAt: number): boolean {
    const now = Math.floor(Date.now() / 1000);
    for (const [id, expiry] of this.consumed) if (expiry <= now) this.consumed.delete(id);
    if (this.consumed.has(tokenId)) return false;
    this.consumed.set(tokenId, expiresAt);
    return true;
  }
}

export class TrustedIdentityVerifier {
  constructor(
    private readonly issuers: ReadonlyMap<string, TrustedIssuer>,
    private readonly replay: ReplayStore,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  verify(token: string, expectedAudience: string): Result<VerifiedIdentity> {
    const [encodedHeader, encodedPayload, encodedSignature, extra] = token.split('.');
    if (encodedHeader === undefined || encodedPayload === undefined || encodedSignature === undefined || extra !== undefined) {
      return denied('Malformed identity token');
    }
    try {
      const header = JSON.parse(decode(encodedHeader)) as { alg?: string; kid?: string };
      const claims = JSON.parse(decode(encodedPayload)) as Record<string, unknown>;
      if (header.alg !== 'EdDSA' || typeof header.kid !== 'string') return denied('Token algorithm denied');
      const issuer = typeof claims['iss'] === 'string' ? this.issuers.get(claims['iss']) : undefined;
      const key = issuer?.keys.get(header.kid);
      if (issuer === undefined || issuer.issuer !== claims['iss'] || key === undefined
        || !issuer.audiences.includes(expectedAudience)) return denied('Untrusted issuer or audience');
      const signature = Buffer.from(encodedSignature, 'base64url');
      if (!verify(null, Buffer.from(`${encodedHeader}.${encodedPayload}`), typeof key === 'string' ? createPublicKey(key) : key, signature)) {
        return denied('Invalid token signature');
      }
      const audience = claims['aud'];
      const now = this.now();
      if (audience !== expectedAudience || typeof claims['exp'] !== 'number' || typeof claims['iat'] !== 'number'
        || claims['exp'] <= now || claims['iat'] > now + 30 || claims['exp'] - claims['iat'] > 900
        || ('nbf' in claims && typeof claims['nbf'] !== 'number')
        || (typeof claims['nbf'] === 'number' && claims['nbf'] > now)
        || typeof claims['sub'] !== 'string' || typeof claims['tenant_id'] !== 'string'
        || claims['sub'].length === 0 || claims['tenant_id'].length === 0
        || !Number.isSafeInteger(claims['session_epoch']) || (claims['session_epoch'] as number) < 0
        || typeof claims['jti'] !== 'string' || claims['jti'].length === 0) return denied('Invalid identity claims');
      if (!this.replay.consume(`${claims['iss']}:${claims['jti']}`, claims['exp'])) return denied('Replayed identity token');
      return { ok: true, value: {
        issuer: claims['iss'] as string, principalId: claims['sub'], tenantId: claims['tenant_id'],
        audience, sessionEpoch: claims['session_epoch'] as number, tokenId: claims['jti'], expiresAt: claims['exp'],
      } };
    } catch {
      return denied('Invalid identity token');
    }
  }
}

export interface WorkloadIdentity {
  readonly service: string;
  readonly cellId: string;
  readonly audience: string;
}

export const authorizeWorkload = (
  identity: WorkloadIdentity,
  expected: WorkloadIdentity,
): Result<WorkloadIdentity> =>
  identity.service === expected.service && identity.cellId === expected.cellId && identity.audience === expected.audience
    ? { ok: true, value: identity }
    : denied('Workload service, cell, or audience mismatch');

const decode = (value: string): string => Buffer.from(value, 'base64url').toString('utf8');
const denied = (message: string): Result<never> => ({ ok: false, error: { code: 'PERMISSION_DENIED', message } });
