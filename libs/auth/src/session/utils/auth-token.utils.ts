// session/utils/auth-token.utils.ts
import { UserClaim } from '../../common/session.types';
import { sha256Base64url } from '@frontmcp/utils';

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
    sub: extractClaimValue(claims, 'sub', isString) ?? '',
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
  const m = header.match(/^\s*Bearer\s+(\S+)\s*$/i);
  return m ? m[1] : undefined;
}
