/**
 * CIMD (Client ID Metadata Documents) Module
 *
 * Re-exports from @frontmcp/auth for backward compatibility.
 *
 * @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document-00
 */

// ============================================
// Re-export everything from @frontmcp/auth
// ============================================
export {
  // Logger
  type CimdLogger,
  noopLogger,
  // Types & Schemas
  clientMetadataDocumentSchema,
  cimdCacheConfigSchema,
  cimdSecurityConfigSchema,
  cimdNetworkConfigSchema,
  cimdConfigSchema,
  type ClientMetadataDocument,
  type ClientMetadataDocumentInput,
  type CimdCacheConfig,
  type CimdSecurityConfig,
  type CimdNetworkConfig,
  type CimdConfig,
  type CimdConfigInput,
  type CimdResolutionResult,
  // Errors
  CimdError,
  InvalidClientIdUrlError,
  CimdFetchError,
  CimdValidationError,
  CimdClientIdMismatchError,
  CimdSecurityError,
  RedirectUriMismatchError,
  CimdResponseTooLargeError,
  CimdDisabledError,
  // Validator
  isCimdClientId,
  validateClientIdUrl,
  checkSsrfProtection,
  hasOnlyLocalhostRedirectUris,
  // Cache
  CimdCache,
  extractCacheHeaders,
  parseCacheHeaders,
  type CimdCacheEntry,
  type CacheableHeaders,
  // Service
  CimdService,
} from '@frontmcp/auth';

// ============================================
// SDK-specific: Dependency Injection Token
// ============================================

/**
 * Provider token for dependency injection.
 * This is SDK-specific and not included in @frontmcp/auth.
 */
export const CimdServiceToken = Symbol('CimdService');
