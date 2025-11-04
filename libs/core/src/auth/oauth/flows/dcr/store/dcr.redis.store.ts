import { Redis, RedisOptions } from 'ioredis';
import { DcrClientMetadata } from '../dcr.types';
import { DcrStoreInterface, ManagedClient } from './dcr.store.types';

export type RedisClient = {
  client: Redis;
  namespace: string;
};
export type RedisDcStoreOptions = RedisOptions | RedisClient;
export default class RedisDcrStore implements DcrStoreInterface {
  private readonly ns: string = '';
  private readonly redis: Redis;

  constructor(options: RedisDcStoreOptions) {
    if (options && 'client' in options) {
      this.redis = options.client;
      this.ns = options.namespace.endsWith(':') ? options.namespace : options.namespace + ':';
      return;
    }
    this.redis = new Redis(options);
  }

  private key(id: string) {
    return `${this.ns}${id}`;
  }

  async create(input: {
    client_id: string;
    client_secret?: string;
    metadata: DcrClientMetadata;
    owner: ManagedClient['owner'];
    secret_expires_at?: string | null;
  }): Promise<ManagedClient> {
    const now = Date.now();
    const rec: ManagedClient = {
      client_id: input.client_id,
      client_secret: input.client_secret,
      metadata: input.metadata,
      owner: input.owner,
      secret_expires_at: input.secret_expires_at ?? null,
      created_at: now,
      updated_at: now,
    };
    await this.redis.set(this.key(rec.client_id), JSON.stringify(rec));
    return rec;
  }

  async get(client_id: string): Promise<ManagedClient | null> {
    const raw = await this.redis.get(this.key(client_id));
    return raw ? (JSON.parse(raw) as ManagedClient) : null;
  }

  async update(
    client_id: string,
    patch: Partial<{ metadata: DcrClientMetadata; client_secret?: string; secret_expires_at?: string | null }>,
  ): Promise<ManagedClient> {
    const rec = await this.get(client_id);
    if (!rec) throw new Error('not_found');
    if (patch.metadata) rec.metadata = patch.metadata;
    if (patch.client_secret !== undefined) rec.client_secret = patch.client_secret;
    if (patch.secret_expires_at !== undefined) rec.secret_expires_at = patch.secret_expires_at ?? null;
    rec.updated_at = Date.now();
    await this.redis.set(this.key(client_id), JSON.stringify(rec));
    return rec;
  }

  async delete(client_id: string): Promise<void> {
    await this.redis.del(this.key(client_id));
  }
}
