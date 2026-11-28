/**
 * Session utilities
 */

export { TinyTtlCache } from './tiny-ttl-cache';
export {
  isJwt,
  getTokenSignatureFingerprint,
  deriveTypedUser,
  anonymousCallerClaims,
  extractBearerToken,
  type AnonymousCallerClaimsOptions,
} from './auth-token.utils';
export {
  detectPrincipal,
  isAuthPrincipal,
  resolvePrincipal,
  type AuthPrincipal,
  type PrincipalKind,
  type PrincipalResolver,
} from './principal';
export {
  getKey,
  encryptJson,
  decryptSessionJson,
  safeDecrypt,
  resetCachedKey,
  isSessionSecretConfigured,
} from './session-crypto.utils';
