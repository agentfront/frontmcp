import type { JSONWebKeySet } from 'jose';

import type { AuthLogger } from '../common/auth-logger.interface';

export type JwksServiceOptions = {
  orchestratorAlg?: 'RS256' | 'ES256';
  rotateDays?: number;
  /** TTL (ms) for cached provider JWKS before attempting refresh. Default: 6h */
  providerJwksTtlMs?: number;
  /** Timeout (ms) for network metadata/JWKS fetches. Default: 5s */
  networkTimeoutMs?: number;
  /** Optional logger. If not provided, logging is disabled. */
  logger?: AuthLogger;
};

/** Rich descriptor used by verification & fetching */
export type ProviderVerifyRef = {
  id: string;
  issuerUrl: string; // upstream issuer (e.g., https://idp.example.com)
  /**
   * Additional `iss` claim values to trust beyond `issuerUrl`. Explicit
   * allowlist for deployments where tokens are minted with an issuer that
   * differs from the JWKS host (e.g. an auth gateway that rewrites the
   * issuer). SECURITY: entries are trusted verbatim — populate only from
   * static configuration, never from request or token data.
   */
  additionalIssuers?: string[];
  /**
   * When `false`, DISABLE issuer (`iss`) validation entirely for this provider
   * — any token signed by a key in the JWKS is accepted regardless of issuer.
   * Defaults to enabled (issuer is validated). SECURITY: a deliberate opt-out
   * for trusted gateways whose re-minted issuer cannot be enumerated with
   * `additionalIssuers`; never enable it based on request or token data.
   */
  verifyIssuer?: boolean;
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
