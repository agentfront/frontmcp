/**
 * CIMD (Client ID Metadata Documents) Type Definitions
 *
 * Implements OAuth Client ID Metadata Documents per
 * draft-ietf-oauth-client-id-metadata-document-00
 *
 * @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document-00
 */
import { z } from 'zod';

// ============================================
// CLIENT METADATA DOCUMENT SCHEMA
// ============================================

/**
 * OAuth Client Metadata Document schema.
 *
 * When a client_id is an HTTPS URL, this document is fetched from that URL
 * and contains the client's OAuth metadata.
 *
 * Per RFC 7591 (OAuth 2.0 Dynamic Client Registration) and CIMD spec.
 */
export const clientMetadataDocumentSchema = z.object({
  // REQUIRED per CIMD spec
  /**
   * Client identifier - MUST match the URL from which this document was fetched.
   */
  client_id: z.string().url(),

  /**
   * Human-readable name of the client.
   */
  client_name: z.string().min(1),

  /**
   * Array of redirect URIs for authorization responses.
   * At least one is required.
   */
  redirect_uris: z.array(z.string().url()).min(1),

  // OPTIONAL per RFC 7591
  /**
   * Token endpoint authentication method.
   * @default 'none'
   */
  token_endpoint_auth_method: z
    .enum(['none', 'client_secret_basic', 'client_secret_post', 'private_key_jwt'])
    .default('none'),

  /**
   * OAuth grant types the client can use.
   * @default ['authorization_code']
   */
  grant_types: z.array(z.string()).default(['authorization_code']),

  /**
   * OAuth response types the client can request.
   * @default ['code']
   */
  response_types: z.array(z.string()).default(['code']),

  /**
   * URL of the client's home page.
   */
  client_uri: z.string().url().optional(),

  /**
   * URL of the client's logo image.
   */
  logo_uri: z.string().url().optional(),

  /**
   * URL of the client's JWKS (for private_key_jwt).
   */
  jwks_uri: z.string().url().optional(),

  /**
   * Inline JWKS (for private_key_jwt).
   */
  jwks: z
    .object({
      keys: z.array(z.record(z.string(), z.unknown())),
    })
    .optional(),

  /**
   * URL of the client's terms of service.
   */
  tos_uri: z.string().url().optional(),

  /**
   * URL of the client's privacy policy.
   */
  policy_uri: z.string().url().optional(),

  /**
   * Requested OAuth scopes.
   */
  scope: z.string().optional(),

  /**
   * Array of contact emails for the client.
   */
  contacts: z.array(z.string().email()).optional(),

  /**
   * Software statement (signed JWT).
   */
  software_statement: z.string().optional(),

  /**
   * Unique identifier for the client software.
   */
  software_id: z.string().optional(),

  /**
   * Version of the client software.
   */
  software_version: z.string().optional(),
});

export type ClientMetadataDocument = z.infer<typeof clientMetadataDocumentSchema>;
export type ClientMetadataDocumentInput = z.input<typeof clientMetadataDocumentSchema>;

// ============================================
// CIMD SERVICE CONFIGURATION
// ============================================

/**
 * Redis configuration for CIMD cache.
 */
export const cimdRedisCacheConfigSchema = z.object({
  /**
   * Redis connection URL.
   * e.g., "redis://user:pass@host:6379/0"
   */
  url: z.string().optional(),

  /**
   * Redis host.
   */
  host: z.string().optional(),

  /**
   * Redis port.
   * @default 6379
   */
  port: z.number().optional(),

  /**
   * Redis password.
   */
  password: z.string().optional(),

  /**
   * Redis database number.
   * @default 0
   */
  db: z.number().optional(),

  /**
   * Enable TLS for Redis connection.
   * @default false
   */
  tls: z.boolean().optional(),

  /**
   * Key prefix for CIMD cache entries.
   * @default 'cimd:'
   */
  keyPrefix: z.string().default('cimd:'),
});

export type CimdRedisCacheConfig = z.infer<typeof cimdRedisCacheConfigSchema>;

/**
 * Cache configuration for CIMD service.
 */
export const cimdCacheConfigSchema = z.object({
  /**
   * Cache storage type.
   * - 'memory': In-memory cache (default, suitable for dev/single-instance)
   * - 'redis': Redis-backed cache (for production/distributed deployments)
   * @default 'memory'
   */
  type: z.enum(['memory', 'redis']).default('memory'),

  /**
   * Default TTL for cached metadata documents.
   * @default 3600000 (1 hour)
   */
  defaultTtlMs: z.number().min(0).default(3600_000),

  /**
   * Maximum TTL (even if server suggests longer).
   * @default 86400000 (24 hours)
   */
  maxTtlMs: z.number().min(0).default(86400_000),

  /**
   * Minimum TTL (even if server suggests shorter).
   * @default 60000 (1 minute)
   */
  minTtlMs: z.number().min(0).default(60_000),

  /**
   * Redis configuration (required when type is 'redis').
   */
  redis: cimdRedisCacheConfigSchema.optional(),
});

export type CimdCacheConfig = z.infer<typeof cimdCacheConfigSchema>;

/**
 * Security configuration for CIMD service.
 */
export const cimdSecurityConfigSchema = z.object({
  /**
   * Block fetching from private/internal IP addresses (SSRF protection).
   * @default true
   */
  blockPrivateIPs: z.boolean().default(true),

  /**
   * Explicit list of allowed domains.
   * If set, only these domains can host CIMD documents.
   */
  allowedDomains: z.array(z.string()).optional(),

  /**
   * Explicit list of blocked domains.
   * These domains cannot host CIMD documents.
   */
  blockedDomains: z.array(z.string()).optional(),

  /**
   * Warn when a client has only localhost redirect URIs.
   * @default true
   */
  warnOnLocalhostRedirects: z.boolean().default(true),

  /**
   * Allow HTTP (instead of HTTPS) for localhost CIMD URLs.
   *
   * **WARNING: This is for testing purposes only. Never enable in production!**
   *
   * When enabled, permits HTTP URLs for localhost CIMD client IDs during testing.
   * The CIMD spec requires HTTPS, but e2e test servers typically use HTTP.
   *
   * @default false
   */
  allowInsecureForTesting: z.boolean().default(false),
});

export type CimdSecurityConfig = z.infer<typeof cimdSecurityConfigSchema>;

/**
 * Network configuration for CIMD service.
 */
export const cimdNetworkConfigSchema = z.object({
  /**
   * Request timeout in milliseconds.
   * @default 5000 (5 seconds)
   */
  timeoutMs: z.number().min(100).default(5000),

  /**
   * Maximum response body size in bytes.
   * @default 65536 (64KB)
   */
  maxResponseSizeBytes: z.number().min(1024).default(65536),
});

export type CimdNetworkConfig = z.infer<typeof cimdNetworkConfigSchema>;

/**
 * Full CIMD service configuration schema.
 */
export const cimdConfigSchema = z.object({
  /**
   * Enable CIMD support.
   * @default true
   */
  enabled: z.boolean().default(true),

  /**
   * Cache configuration.
   */
  cache: cimdCacheConfigSchema.optional(),

  /**
   * Security configuration.
   */
  security: cimdSecurityConfigSchema.optional(),

  /**
   * Network configuration.
   */
  network: cimdNetworkConfigSchema.optional(),
});

export type CimdConfig = z.infer<typeof cimdConfigSchema>;
export type CimdConfigInput = z.input<typeof cimdConfigSchema>;

// ============================================
// CIMD RESOLUTION RESULT
// ============================================

/**
 * Result of resolving a client_id to its metadata document.
 */
export interface CimdResolutionResult {
  /**
   * Whether this client_id is a CIMD URL.
   */
  isCimdClient: boolean;

  /**
   * The resolved metadata document (if isCimdClient is true).
   */
  metadata?: ClientMetadataDocument;

  /**
   * Whether the result came from cache.
   */
  fromCache: boolean;

  /**
   * When the cached entry expires (if cached).
   */
  expiresAt?: number;

  /**
   * HTTP ETag for conditional requests.
   */
  etag?: string;

  /**
   * HTTP Last-Modified header value.
   */
  lastModified?: string;
}
