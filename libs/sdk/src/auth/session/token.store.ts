// auth/session/token.store.ts
import { randomUUID } from '@frontmcp/utils';
import type { EncBlob } from './token.vault';

export type SecretRecord = {
  id: string; // opaque reference id
  blob: EncBlob; // encrypted token
  updatedAt: number; // ms
};

export interface TokenStore {
  /** Create or overwrite a blob under a stable id. */
  put(id: string, blob: EncBlob): Promise<void>;
  /** Fetch encrypted blob by id. */
  get(id: string): Promise<SecretRecord | undefined>;
  /** Delete a reference. */
  del(id: string): Promise<void>;
  /** Allocate a new id (opaque). */
  allocId(): string;
}

/** In-memory reference store (dev/test). */
export class MemoryTokenStore implements TokenStore {
  private m = new Map<string, SecretRecord>();
  allocId() {
    return randomUUID();
  }
  async put(id: string, blob: EncBlob) {
    this.m.set(id, { id, blob, updatedAt: Date.now() });
  }
  async get(id: string) {
    return this.m.get(id);
  }
  async del(id: string) {
    this.m.delete(id);
  }
}

/** Redis (sketch) — replace `any` with your redis client type. */
export class RedisTokenStore implements TokenStore {
  constructor(private readonly redis: any, private readonly ns = 'tok:') {}
  allocId() {
    return randomUUID();
  }
  key(id: string) {
    return `${this.ns}${id}`;
  }

  async put(id: string, blob: EncBlob) {
    const rec = JSON.stringify({ id, blob, updatedAt: Date.now() });
    // Optional: set EX by blob.exp if you want Redis eviction at token expiry
    await this.redis.set(this.key(id), rec);
  }

  async get(id: string) {
    const raw = await this.redis.get(this.key(id));
    if (!raw) return undefined;
    return JSON.parse(raw) as SecretRecord;
  }

  async del(id: string) {
    await this.redis.del(this.key(id));
  }
}
