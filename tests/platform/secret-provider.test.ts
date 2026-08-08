import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EnvSecretProvider, MissingSecretError, requireSecrets } from '../../src/platform/security/secret-provider.js';

describe('EnvSecretProvider', () => {
  it('reads a direct environment variable', () => {
    const provider = new EnvSecretProvider({ FOO: 'bar' });
    expect(provider.require('FOO')).toBe('bar');
    expect(provider.optional('MISSING')).toBeUndefined();
  });

  it('prefers a _FILE-mounted secret over a direct env var', () => {
    const dir = mkdtempSync(join(tmpdir(), 'secret-'));
    const filePath = join(dir, 'db-url');
    writeFileSync(filePath, 'postgresql://file-value\n');
    const provider = new EnvSecretProvider({ DATABASE_URL: 'ignored', DATABASE_URL_FILE: filePath });
    expect(provider.require('DATABASE_URL')).toBe('postgresql://file-value');
  });

  it('throws MissingSecretError with a named message when required and absent', () => {
    const provider = new EnvSecretProvider({});
    expect(() => provider.require('DATABASE_URL')).toThrow(MissingSecretError);
    expect(() => provider.require('DATABASE_URL')).toThrow(/DATABASE_URL/);
  });

  it('treats an empty string as unset', () => {
    const provider = new EnvSecretProvider({ FOO: '' });
    expect(provider.optional('FOO')).toBeUndefined();
  });

  it('defaults to process.env when no source is given', () => {
    const provider = new EnvSecretProvider();
    expect(provider.optional('__DEFINITELY_NOT_SET__')).toBeUndefined();
  });
});

describe('requireSecrets', () => {
  it('passes silently when all required secrets are present', () => {
    const provider = new EnvSecretProvider({ A: '1', B: '2' });
    expect(() => requireSecrets(provider, ['A', 'B'])).not.toThrow();
  });

  it('throws listing every missing secret by name', () => {
    const provider = new EnvSecretProvider({ A: '1' });
    expect(() => requireSecrets(provider, ['A', 'B', 'C'])).toThrow(/B, C/);
  });
});
