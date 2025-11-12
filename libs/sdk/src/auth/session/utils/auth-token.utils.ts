// auth/session/utils/auth-token.utils.ts
import { UserClaim } from '../../../common';

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
    return token.split('.')[2]!;
  }
  const crypto = require('crypto') as typeof import('crypto');
  const digest = crypto.createHash('sha256').update(token).digest('base64');
  return digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** Safely extracts a claim value if it matches the expected type */
function extractClaimValue<T>(
  claims: Record<string, any>,
  key: string,
  validator: (value: any) => value is T,
): T | undefined {
  const value = claims[key];
  return validator(value) ? value : undefined;
}

/** Type guards for claim validation */
const isString = (value: any): value is string => typeof value === 'string';
const isNumber = (value: any): value is number => typeof value === 'number';
const isStringOrStringArray = (value: any): value is string | string[] =>
  typeof value === 'string' || Array.isArray(value);

/** Best-effort typed user derivation from claims */
export function deriveTypedUser(claims: Record<string, any>): UserClaim {
  return {
    ...claims,
    iss: extractClaimValue(claims, 'iss', isString)!,
    sid: extractClaimValue(claims, 'sid', isString),
    sub: extractClaimValue(claims, 'sub', isString)!,
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

export function extractBearerToken(header?: string): string | undefined {
  if (!header) return undefined;
  const m = header.match(/^\s*Bearer\s+(.+)\s*$/i);
  return m ? m[1].trim() : undefined;
}
