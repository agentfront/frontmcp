// auth/session/token.refresh.ts
import type { ProviderSnapshot } from './session.types';
import type { TokenStore, TokenVault } from '@frontmcp/auth';
import { base64urlDecode } from '@frontmcp/utils';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type TokenRefreshCtx = {
  /** The provider we’re refreshing for. */
  providerId: string;

  /** Caller-provided session facade (only what a refresher may need). */
  session: {
    id: string;
    scopeId: string;
    /** Current snapshot (mutable by the session after refresh). */
    authorizedProviders: Record<string, ProviderSnapshot>;
    /** Optional helper if the refresher wants to call other providers. */
    getToken?: (pid: string, opts?: { refreshSkewSec?: number; forceRefresh?: boolean }) => Promise<string | undefined>;
  };

  /** Current access token (if known); may be undefined/expired. */
  accessToken?: string;

  /**
   * Refresh token (if accessible by the embedding mode).
   * For `ref` mode this is usually `undefined`; the refresher should use `store`/`vault`.
   */
  refreshToken?: string;

  /** The snapshot we’re refreshing (same as authorizedProviders[providerId]). */
  snapshot: ProviderSnapshot;

  /**
   * External storage interfaces, present for `ref` mode to avoid revealing plaintext tokens.
   * - `store` holds opaque encrypted blobs
   * - `vault` handles AEAD encryption/decryption of secrets
   */
  store?: TokenStore;
  vault?: TokenVault;
};

export type TokenRefreshResult = {
  /** New access token (if rotated). */
  accessToken?: string;
  /** New refresh token (optional). */
  refreshToken?: string;
  /** New absolute expiry (seconds since epoch preferred; ms also accepted). */
  exp: number;
  /** Optional opaque payload returned by the AS (id_token claims, etc.). */
  payload?: Record<string, unknown>;
};

export type TokenRefresher = (ctx: TokenRefreshCtx) => Promise<TokenRefreshResult>;

// -----------------------------------------------------------------------------
// Expiry helpers
// -----------------------------------------------------------------------------

/** Convert seconds/ms epoch or Date to epoch seconds. */
export function toEpochSeconds(exp?: number | Date): number | undefined {
  if (exp == null) return undefined;
  if (exp instanceof Date) return Math.floor(exp.getTime() / 1000);
  // Heuristic: treat large numbers as ms
  return exp > 1e12 ? Math.floor(exp / 1000) : Math.floor(exp);
}

/** Returns true if `exp` will occur within `skewSec` from now (or already past). */
export function isSoonExpiring(exp?: number | Date, skewSec = 60): boolean {
  const expSec = toEpochSeconds(exp);
  if (expSec == null) return false;
  const now = Math.floor(Date.now() / 1000);
  return expSec <= now + Math.max(0, skewSec);
}

/**
 * Synchronous check against a provider snapshot’s `exp` field.
 * Note: In `ref` mode the exact expiry may live in the store; this helper
 * intentionally remains synchronous and only uses the snapshot’s `exp`.
 */
export function isSoonExpiringProvider(
  sessionLike: { authorizedProviders: Record<string, ProviderSnapshot> },
  providerId: string,
  skewSec = 60,
): boolean {
  const snap = sessionLike.authorizedProviders[providerId];
  if (!snap) return false;
  return isSoonExpiring(snap.exp, skewSec);
}

// -----------------------------------------------------------------------------
// Optional utility: derive exp from JWT (unsigned decode)
// -----------------------------------------------------------------------------

/** Best-effort extraction of `exp` from a JWT without verification. */
export function tryJwtExp(token?: string): number | undefined {
  if (!token) return undefined;
  const parts = token.split('.');
  if (parts.length < 2) return undefined;
  try {
    const json = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[1])));
    const e = json?.exp;
    return typeof e === 'number' ? toEpochSeconds(e) : undefined;
  } catch {
    return undefined;
  }
}
