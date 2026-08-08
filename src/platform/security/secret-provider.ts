import { readFileSync } from 'node:fs';

export interface SecretProvider {
  optional(name: string): string | undefined;
  require(name: string): string;
}

export class MissingSecretError extends Error {
  constructor(readonly secretName: string) {
    super(`Required configuration "${secretName}" is not set. Set the ${secretName} environment ` +
      `variable, or ${secretName}_FILE to a mounted secret file, before starting outside demo mode.`);
    this.name = 'MissingSecretError';
  }
}

/**
 * Reads secrets from the environment, or from a file when `${name}_FILE` points at a mounted
 * secret (the common Docker/Kubernetes secret-volume convention). This project does not operate
 * a secrets manager for adopters; this is the seam an adopter's own Vault/KMS/CSI driver plugs
 * into, and the fail-closed check that refuses to start silently unconfigured.
 */
export class EnvSecretProvider implements SecretProvider {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  optional(name: string): string | undefined {
    const filePath = this.env[`${name}_FILE`];
    if (filePath !== undefined && filePath.length > 0) {
      const contents = readFileSync(filePath, 'utf8').trim();
      return contents.length === 0 ? undefined : contents;
    }
    const value = this.env[name];
    return value === undefined || value.length === 0 ? undefined : value;
  }

  require(name: string): string {
    const value = this.optional(name);
    if (value === undefined) throw new MissingSecretError(name);
    return value;
  }
}

/**
 * Enumerates required configuration up front and fails with one clear, named error instead of
 * letting the process start and fail later on an obscure undefined access.
 */
export function requireSecrets(provider: SecretProvider, names: readonly string[]): void {
  const missing = names.filter((name) => provider.optional(name) === undefined);
  if (missing.length > 0) {
    throw new Error(`Missing required configuration before startup: ${missing.join(', ')}`);
  }
}
