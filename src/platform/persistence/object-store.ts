import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import type { Result } from '../../shared/domain/result.js';

export interface ArtifactMetadata {
  readonly tenantId: string;
  readonly purpose: string;
  readonly sensitivity: 'confidential' | 'restricted';
  readonly retentionPolicyId: string;
}

export interface ArtifactReference {
  readonly objectId: string;
  readonly contentHash: string;
  readonly bytes: number;
  readonly keyVersion: string;
}

export interface ImmutableObjectStore {
  put(content: Uint8Array, metadata: ArtifactMetadata): Promise<Result<ArtifactReference>>;
  get(reference: ArtifactReference, tenantId: string, purpose: string): Promise<Result<Uint8Array>>;
  erase(reference: ArtifactReference, tenantId: string): Promise<Result<void>>;
}

interface StoredObject {
  readonly metadata: ArtifactMetadata;
  readonly nonce: Buffer;
  readonly tag: Buffer;
  readonly ciphertext: Buffer;
}

export class EncryptedInMemoryObjectStore implements ImmutableObjectStore {
  private readonly objects = new Map<string, StoredObject>();

  constructor(
    private readonly encryptionKey: Buffer,
    private readonly keyVersion = 'local-test-v1',
  ) {
    if (encryptionKey.byteLength !== 32) throw new Error('AES-256 key must be 32 bytes');
  }

  static forTests(): EncryptedInMemoryObjectStore {
    return new EncryptedInMemoryObjectStore(randomBytes(32));
  }

  async put(content: Uint8Array, metadata: ArtifactMetadata): Promise<Result<ArtifactReference>> {
    const contentHash = createHash('sha256').update(content).digest('hex');
    const objectId = createHash('sha256')
      .update(`${metadata.tenantId}:${metadata.purpose}:${contentHash}`)
      .digest('hex');
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, nonce);
    cipher.setAAD(Buffer.from(`${metadata.tenantId}:${objectId}`));
    const ciphertext = Buffer.concat([cipher.update(content), cipher.final()]);
    this.objects.set(objectId, { metadata, nonce, tag: cipher.getAuthTag(), ciphertext });
    return { ok: true, value: { objectId, contentHash, bytes: content.byteLength, keyVersion: this.keyVersion } };
  }

  async get(reference: ArtifactReference, tenantId: string, purpose: string): Promise<Result<Uint8Array>> {
    const stored = this.objects.get(reference.objectId);
    if (stored === undefined || stored.metadata.tenantId !== tenantId || stored.metadata.purpose !== purpose) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Artifact not found' } };
    }
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, stored.nonce);
    decipher.setAAD(Buffer.from(`${tenantId}:${reference.objectId}`));
    decipher.setAuthTag(stored.tag);
    return { ok: true, value: Buffer.concat([decipher.update(stored.ciphertext), decipher.final()]) };
  }

  async erase(reference: ArtifactReference, tenantId: string): Promise<Result<void>> {
    const stored = this.objects.get(reference.objectId);
    if (stored !== undefined && stored.metadata.tenantId !== tenantId) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Artifact not found' } };
    }
    this.objects.delete(reference.objectId);
    return { ok: true, value: undefined };
  }
}
