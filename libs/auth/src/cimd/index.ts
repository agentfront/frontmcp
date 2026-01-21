/**
 * CIMD (Client ID Metadata Documents) Module
 *
 * OAuth Client ID Metadata Documents support per
 * draft-ietf-oauth-client-id-metadata-document-00
 *
 * @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document-00
 */

// ============================================
// Logger
// ============================================
export { type CimdLogger, noopLogger } from './cimd.logger';

// ============================================
// Types
// ============================================
export {
  // Schemas
  clientMetadataDocumentSchema,
  cimdCacheConfigSchema,
  cimdRedisCacheConfigSchema,
  cimdSecurityConfigSchema,
  cimdNetworkConfigSchema,
  cimdConfigSchema,
  // Types
  type ClientMetadataDocument,
  type ClientMetadataDocumentInput,
  type CimdCacheConfig,
  type CimdRedisCacheConfig,
  type CimdSecurityConfig,
  type CimdNetworkConfig,
  type CimdConfig,
  type CimdConfigInput,
  type CimdResolutionResult,
} from './cimd.types';

// ============================================
// Errors
// ============================================
export {
  CimdError,
  InvalidClientIdUrlError,
  CimdFetchError,
  CimdValidationError,
  CimdClientIdMismatchError,
  CimdSecurityError,
  RedirectUriMismatchError,
  CimdResponseTooLargeError,
  CimdDisabledError,
} from './cimd.errors';

// ============================================
// Validator
// ============================================
export {
  isCimdClientId,
  validateClientIdUrl,
  checkSsrfProtection,
  hasOnlyLocalhostRedirectUris,
} from './cimd.validator';

// ============================================
// Cache
// ============================================
export {
  // Classes
  InMemoryCimdCache,
  CimdCache, // Backwards compatibility alias
  // Factory
  createCimdCache,
  // Functions
  extractCacheHeaders,
  parseCacheHeaders,
  // Types
  type CimdCacheBackend,
  type CimdCacheEntry,
  type CimdCacheTtlConfig,
  type CacheableHeaders,
} from './cimd.cache';

// Redis cache (separate export for lazy loading)
export { RedisCimdCache } from './cimd-redis.cache';

// ============================================
// Service
// ============================================
export { CimdService } from './cimd.service';
