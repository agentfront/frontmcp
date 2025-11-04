import { JSONWebKeySet } from 'jose';

export type JwksServiceOptions = {
  orchestratorAlg?: 'RS256' | 'ES256';
  rotateDays?: number;
  /** TTL (ms) for cached provider JWKS before attempting refresh. Default: 6h */
  providerJwksTtlMs?: number;
  /** Timeout (ms) for network metadata/JWKS fetches. Default: 5s */
  networkTimeoutMs?: number;
};

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
  header?: any;
  payload?: any;
  error?: string;
};
