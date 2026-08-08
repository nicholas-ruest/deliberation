import { createPublicKey } from 'node:crypto';
import { z } from 'zod';
import type { TrustedIssuer } from './trusted-identity.js';
import type { SecretProvider } from './secret-provider.js';

const TrustedIssuerConfigSchema = z.object({
  issuer: z.string().min(1),
  audiences: z.array(z.string().min(1)).min(1),
  keys: z.array(z.object({ kid: z.string().min(1), publicKeyPem: z.string().min(1) })).min(1),
});

const TrustedIssuersConfigSchema = z.array(TrustedIssuerConfigSchema).min(1);

export class InvalidTrustedIssuerConfigError extends Error {
  constructor(cause: unknown) {
    super(`IDENTITY_TRUSTED_ISSUERS is set but is not valid: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'InvalidTrustedIssuerConfigError';
  }
}

/**
 * Loads the adopter-supplied identity issuer/key configuration that TrustedIdentityVerifier
 * checks every request against. This project does not operate an identity provider — the
 * issuer, audience, and public keys below are the adopter's own OIDC/SAML/workload-identity
 * source. Returns undefined only when nothing at all is configured, so the caller (an
 * entrypoint) can decide how to fail closed.
 */
export function loadTrustedIssuers(provider: SecretProvider): ReadonlyMap<string, TrustedIssuer> | undefined {
  const raw = provider.optional('IDENTITY_TRUSTED_ISSUERS');
  if (raw === undefined) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new InvalidTrustedIssuerConfigError(cause);
  }
  const config = TrustedIssuersConfigSchema.safeParse(parsed);
  if (!config.success) throw new InvalidTrustedIssuerConfigError(config.error);

  const issuers = new Map<string, TrustedIssuer>();
  for (const entry of config.data) {
    const keys = new Map<string, string>();
    for (const key of entry.keys) {
      try {
        createPublicKey(key.publicKeyPem);
      } catch (cause) {
        throw new InvalidTrustedIssuerConfigError(`issuer "${entry.issuer}" key "${key.kid}": ${cause instanceof Error ? cause.message : String(cause)}`);
      }
      keys.set(key.kid, key.publicKeyPem);
    }
    issuers.set(entry.issuer, { issuer: entry.issuer, audiences: entry.audiences, keys });
  }
  return issuers;
}
