import type { Result } from '../../shared/domain/result.js';

export interface ExternalIdentity {
  readonly provider: string;
  readonly issuer: string;
  readonly subject: string;
  readonly tenantHint?: string;
  readonly displayAttributes: Readonly<Record<string, string>>;
}

export interface FederationPort {
  readonly protocol: 'oidc' | 'saml';
  validate(assertion: string, expectedAudience: string, now: Date): Promise<Result<ExternalIdentity>>;
}

export interface ScimUser {
  readonly externalId: string;
  readonly active: boolean;
  readonly displayName?: string;
  readonly groups: readonly string[];
}

export interface ScimPort {
  parseUser(payload: unknown): Result<ScimUser>;
  acknowledge(externalId: string, internalPrincipalId: string, version: string): Promise<Result<void>>;
}

export interface IdentityMapping {
  readonly tenantId: string;
  readonly principalId: string;
  readonly provider: string;
  readonly issuer: string;
  readonly subject: string;
}

export interface IdentityAntiCorruptionLayer {
  map(identity: ExternalIdentity): Promise<Result<IdentityMapping>>;
}
