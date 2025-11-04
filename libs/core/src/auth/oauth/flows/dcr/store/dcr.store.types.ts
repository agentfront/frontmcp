import { DcrClientMetadata } from '../dcr.types';

export abstract class DcrStoreInterface {
  abstract create(input: {
    client_id: string;
    client_secret?: string;
    metadata: DcrClientMetadata;
    owner: { org_id: string; user_id?: string };
    secret_expires_at?: string | null;
  }): Promise<ManagedClient>;

  abstract get(client_id: string): Promise<ManagedClient | null>;

  abstract update(
    client_id: string,
    patch: Partial<{ metadata: DcrClientMetadata; client_secret?: string; secret_expires_at?: string | null }>,
  ): Promise<ManagedClient>;

  abstract delete(client_id: string): Promise<void>;
}

export interface ManagedClient {
  client_id: string;
  client_secret?: string | null; // absent for private_key_jwt
  metadata: DcrClientMetadata;
  owner: { org_id: string; user_id: string };

  created_at?: number; // epoch seconds
  updated_at?: number; // epoch seconds

  secret_expires_at: string | null;
  // Extend with provider-specific fields as needed
  [k: string]: unknown;
}
