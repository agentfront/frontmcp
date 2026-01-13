/**
 * JWKS Module
 *
 * JSON Web Key Set management for JWT signing and verification.
 */

// Types
export type { JwksServiceOptions, ProviderVerifyRef, VerifyResult, DevKeyPersistenceOptions } from './jwks.types';

// Service
export { JwksService } from './jwks.service';

// Utils
export { trimSlash, normalizeIssuer, decodeJwtPayloadSafe } from './jwks.utils';

/**
 * Dev Key Persistence (DEPRECATED)
 *
 * These exports are deprecated. Use `createKeyPersistence` from `@frontmcp/utils` instead.
 * They are kept for backwards compatibility and will be removed in a future major version.
 *
 * @deprecated Use `createKeyPersistence` from `@frontmcp/utils` instead.
 */
export {
  isDevKeyPersistenceEnabled,
  resolveKeyPath,
  loadDevKey,
  saveDevKey,
  deleteDevKey,
} from './dev-key-persistence';
/** @deprecated Use `AsymmetricKeyData` from `@frontmcp/utils` instead. */
export type { DevKeyData } from './dev-key-persistence';
