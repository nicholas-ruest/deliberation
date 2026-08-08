import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EnvSecretProvider } from '../../src/platform/security/secret-provider.js';
import { InvalidTrustedIssuerConfigError, loadTrustedIssuers } from '../../src/platform/security/trusted-identity-config.js';

const { publicKey } = generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

describe('loadTrustedIssuers', () => {
  it('returns undefined when unconfigured', () => {
    expect(loadTrustedIssuers(new EnvSecretProvider({}))).toBeUndefined();
  });

  it('parses a valid issuer/key configuration', () => {
    const config = JSON.stringify([{
      issuer: 'https://idp.example.com',
      audiences: ['deliberation-api'],
      keys: [{ kid: 'key-1', publicKeyPem: publicKey }],
    }]);
    const issuers = loadTrustedIssuers(new EnvSecretProvider({ IDENTITY_TRUSTED_ISSUERS: config }));
    expect(issuers?.get('https://idp.example.com')?.audiences).toEqual(['deliberation-api']);
    expect(issuers?.get('https://idp.example.com')?.keys.get('key-1')).toBe(publicKey);
  });

  it('rejects malformed JSON', () => {
    expect(() => loadTrustedIssuers(new EnvSecretProvider({ IDENTITY_TRUSTED_ISSUERS: '{not json' })))
      .toThrow(InvalidTrustedIssuerConfigError);
  });

  it('rejects a schema-invalid configuration', () => {
    expect(() => loadTrustedIssuers(new EnvSecretProvider({ IDENTITY_TRUSTED_ISSUERS: '[{}]' })))
      .toThrow(InvalidTrustedIssuerConfigError);
  });

  it('rejects an invalid public key PEM', () => {
    const config = JSON.stringify([{ issuer: 'x', audiences: ['a'], keys: [{ kid: 'k', publicKeyPem: 'not-a-key' }] }]);
    expect(() => loadTrustedIssuers(new EnvSecretProvider({ IDENTITY_TRUSTED_ISSUERS: config })))
      .toThrow(InvalidTrustedIssuerConfigError);
  });
});
