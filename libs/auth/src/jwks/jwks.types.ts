import { JSONWebKeySet } from 'jose';
import { DevKeyPersistenceOptions } from './dev-key-persistence';
import type { AuthLogger } from '../common/auth-logger.interface';

export type JwksServiceOptions = {
  orchestratorAlg?: 'RS256' | 'ES256';
  rotateDays?: number;
  /** TTL (ms) for cached provider JWKS before attempting refresh. Default: 6h */
  providerJwksTtlMs?: number;
  /** Timeout (ms) for network metadata/JWKS fetches. Default: 5s */
  networkTimeoutMs?: number;
  /**
   * Options for dev key persistence (development mode only by default).
   * When enabled, keys are saved to a file and reloaded on server restart.
   */
  devKeyPersistence?: DevKeyPersistenceOptions;
  /** Optional logger. If not provided, logging is disabled. */
  logger?: AuthLogger;
};

export type { DevKeyPersistenceOptions };

/** Rich descriptor used by verification & fetching */
export type ProviderVerifyRef = {
  id: string;
  issuerUrl: string; // upstream issuer (e.g., https://idp.example.com)
  jwksUri?: string; // optional explicit JWKS uri
  jwks?: JSONWebKeySet; // optional inline keys (prioritized)
};

export type VerifyResult = {
  ok: boolean;
  issuer?: string;
  sub?: string;
  providerId?: string;
  header?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  error?: string;
};
