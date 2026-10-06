// session/utils/auth-token.utils.ts
import { sha256Base64url } from '@frontmcp/utils';

import { type UserClaim } from '../../common/session.types';

export function isJwt(token: string | undefined): boolean {
  if (!token) return false;
  return token.split('.').length === 3;
}

/**
 * If the token is a JWT, returns the raw signature segment (3rd part) as base64url.
 * Otherwise, returns a stable SHA-256(base64url) fingerprint of the whole token,
 * so we can still bind a session id to "this Authorization" deterministically.
 */
export function getTokenSignatureFingerprint(token: string): string {
  if (isJwt(token)) {
    const sig = token.split('.')[2];
    if (sig) return sig;
  }
  return sha256Base64url(token);
}

/** Safely extracts a claim value if it matches the expected type */
function extractClaimValue<T>(
  claims: Record<string, unknown>,
  key: string,
  validator: (value: unknown) => value is T,
): T | undefined {
  const value = claims[key];
  return validator(value) ? value : undefined;
}

/** Type guards for claim validation */
const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number';
const isStringOrStringArray = (value: unknown): value is string | string[] =>
  typeof value === 'string' || Array.isArray(value);

/** Best-effort typed user derivation from claims */
export function deriveTypedUser(claims: Record<string, unknown>): UserClaim {
  return {
    ...claims,
    iss: extractClaimValue(claims, 'iss', isString) ?? '',
    sid: extractClaimValue(claims, 'sid', isString),
    // RFC 9068 §2.2: a client-credentials token names the client as its subject; some IdPs only put it in client_id / azp
    sub:
      extractClaimValue(claims, 'sub', isString) ??
      extractClaimValue(claims, 'client_id', isString) ??
      extractClaimValue(claims, 'azp', isString) ??
      '',
    exp: extractClaimValue(claims, 'exp', isNumber),
    iat: extractClaimValue(claims, 'iat', isNumber),
    aud: extractClaimValue(claims, 'aud', isStringOrStringArray),
    email: extractClaimValue(claims, 'email', isString),
    preferred_username: extractClaimValue(claims, 'preferred_username', isString),
    username: extractClaimValue(claims, 'username', isString),
    name: extractClaimValue(claims, 'name', isString),
    picture: extractClaimValue(claims, 'picture', isString),
  };
}

/** What identifies an anonymous or static-key caller in its claims. */
export interface AnonymousCallerClaimsOptions {
  /** Issuer of the claims (the server that identifies the caller). */
  issuer: string;
  /** Scopes granted to the caller. Default: `['anonymous']`. */
  scopes?: string[];
  /**
   * Explicit subject. Static mode names the configured token that was presented; without it the
   * caller is anonymous and gets `anon:<anonymousId>`.
   */
  subject?: string;
}

/**
 * The claims of an anonymous or static-key caller (public mode, transparent anonymous access, a
 * static key): `sub` is the given subject or `anon:<anonymousId>`, and `scope` the granted scopes.
 */
export function anonymousCallerClaims(
  options: AnonymousCallerClaimsOptions,
  anonymousId: string,
): { sub: string; iss: string; name: string; scope: string } {
  const { issuer, scopes = ['anonymous'], subject } = options;
  return {
    sub: subject ?? `anon:${anonymousId}`,
    iss: issuer,
    name: subject ? 'Static token' : 'Anonymous',
    scope: scopes.join(' '),
  };
}

export function extractBearerToken(header?: string): string | undefined {
  if (!header) return undefined;
  const m = header.match(/^\s*Bearer\s+(\S+)\s*$/i);
  return m ? m[1] : undefined;
}
