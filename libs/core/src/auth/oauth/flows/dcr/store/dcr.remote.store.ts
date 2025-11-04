import { DcrClientMetadata } from '../dcr.types';
import { DcrStoreInterface, ManagedClient } from './dcr.store.types';

export type RemoteDcrStoreOptions = { baseUrl: string; apiKey?: string };
export default class RemoteDcrStore implements DcrStoreInterface {
  constructor(private readonly opts: RemoteDcrStoreOptions) {
  }

  private async call<T>(path: string, init: RequestInit): Promise<T> {
    const res = await fetch(`${this.opts.baseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
        ...(init.headers || {}),
      },
    });
    if (!res.ok) throw new Error(`remote_error:${res.status}`);
    return (await res.json()) as T;
  }

  async create(input: {
    client_id: string;
    client_secret?: string;
    metadata: DcrClientMetadata;
    owner: { org_id: string; user_id?: string };
    secret_expires_at?: string | null;
  }): Promise<ManagedClient> {
    return this.call<ManagedClient>('/dcr/clients', { method: 'POST', body: JSON.stringify(input) });
  }

  async get(client_id: string): Promise<ManagedClient | null> {
    try {
      return await this.call<ManagedClient>(`/dcr/clients/${client_id}`, { method: 'GET' });
    } catch (e: any) {
      if (String(e.message).includes('404')) return null;
      throw e;
    }
  }

  async update(
    client_id: string,
    patch: Partial<{ metadata: DcrClientMetadata; client_secret?: string; secret_expires_at?: string | null }>,
  ): Promise<ManagedClient> {
    return this.call<ManagedClient>(`/dcr/clients/${client_id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }

  async delete(client_id: string): Promise<void> {
    await this.call<void>(`/dcr/clients/${client_id}`, { method: 'DELETE' });
  }
}
