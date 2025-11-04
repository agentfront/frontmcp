import { DcrClientMetadata } from '../dcr.types';
import { DcrStoreInterface, ManagedClient } from './dcr.store.types';

export default class MemoryDcrStore implements DcrStoreInterface {
  private map = new Map<string, ManagedClient>();

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
    this.map.set(rec.client_id, rec);
    return rec;
  }

  async get(client_id: string): Promise<ManagedClient | null> {
    return this.map.get(client_id) ?? null;
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
    this.map.set(client_id, rec);
    return rec;
  }

  async delete(client_id: string): Promise<void> {
    this.map.delete(client_id);
  }
}
