/**
 * CIMD (Client ID Metadata Documents) Service
 *
 * Core service for resolving and validating OAuth Client ID Metadata Documents.
 *
 * @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document-00
 */
import type { CimdLogger } from './cimd.logger';
import { noopLogger } from './cimd.logger';
import { CimdCache, type CimdCacheBackend } from './cimd.cache';
import {
  CimdFetchError,
  CimdValidationError,
  CimdClientIdMismatchError,
  CimdResponseTooLargeError,
  RedirectUriMismatchError,
} from './cimd.errors';
import {
  clientMetadataDocumentSchema,
  cimdConfigSchema,
  cimdCacheConfigSchema,
  cimdSecurityConfigSchema,
  cimdNetworkConfigSchema,
  type ClientMetadataDocument,
  type CimdConfig,
  type CimdConfigInput,
  type CimdResolutionResult,
  type CimdCacheConfig,
  type CimdSecurityConfig,
  type CimdNetworkConfig,
} from './cimd.types';
import { isCimdClientId, validateClientIdUrl, hasOnlyLocalhostRedirectUris } from './cimd.validator';

/**
 * CIMD Service for resolving and validating client metadata documents.
 *
 * Following the JwksService pattern for HTTP fetching with caching.
 */
export class CimdService {
  private readonly config: CimdConfig;
  private readonly cacheConfig: CimdCacheConfig;
  private readonly securityConfig: CimdSecurityConfig;
  private readonly networkConfig: CimdNetworkConfig;
  private readonly cache: CimdCacheBackend;
  private readonly logger: CimdLogger;

  /**
   * Whether CIMD is enabled.
   */
  get enabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Create a new CIMD service.
   *
   * @param logger - Optional logger. If not provided, logging is disabled.
   * @param config - Optional configuration.
   */
  constructor(logger?: CimdLogger, config?: Partial<CimdConfigInput>) {
    this.logger = (logger ?? noopLogger).child('CimdService');

    // Parse and validate configuration
    this.config = cimdConfigSchema.parse(config ?? {});
    this.cacheConfig = cimdCacheConfigSchema.parse(this.config.cache ?? {});
    this.securityConfig = cimdSecurityConfigSchema.parse(this.config.security ?? {});
    this.networkConfig = cimdNetworkConfigSchema.parse(this.config.network ?? {});

    // Initialize cache
    this.cache = new CimdCache(this.cacheConfig);

    this.logger.debug('CimdService initialized', {
      enabled: this.config.enabled,
      cacheDefaultTtlMs: this.cacheConfig.defaultTtlMs,
      networkTimeoutMs: this.networkConfig.timeoutMs,
    });

    // Warn if allowInsecureForTesting is enabled
    if (this.securityConfig.allowInsecureForTesting) {
      this.logger.warn(
        'CIMD allowInsecureForTesting is enabled. ' +
          'HTTP is allowed for localhost CIMD URLs. ' +
          'This should NEVER be enabled in production!',
      );
    }
  }

  /**
   * Check if a client_id is a CIMD URL.
   *
   * @param clientId - The client_id to check
   * @returns true if this is a CIMD client_id (HTTPS URL with path, or HTTP for localhost when testing)
   */
  isCimdClientId(clientId: string): boolean {
    return isCimdClientId(clientId, this.securityConfig.allowInsecureForTesting);
  }

  /**
   * Resolve a client_id to its metadata document.
   *
   * If the client_id is a CIMD URL, this fetches and validates the metadata document.
   * Non-CIMD client IDs return a result with isCimdClient: false.
   *
   * @param clientId - The client_id to resolve
   * @returns Resolution result with metadata if available
   */
  async resolveClientMetadata(clientId: string): Promise<CimdResolutionResult> {
    // Check if this is a CIMD client_id
    if (!this.isCimdClientId(clientId)) {
      return {
        isCimdClient: false,
        fromCache: false,
      };
    }

    // Validate the URL (throws on error)
    validateClientIdUrl(clientId, this.securityConfig);

    // Check cache first
    const cached = await this.cache.get(clientId);
    if (cached) {
      this.logger.debug(`Cache hit for CIMD client: ${clientId}`);
      return {
        isCimdClient: true,
        metadata: cached.document,
        fromCache: true,
        expiresAt: cached.expiresAt,
        etag: cached.etag,
        lastModified: cached.lastModified,
      };
    }

    // Fetch the document
    this.logger.info(`Fetching CIMD document: ${clientId}`);
    const { document, headers } = await this.fetchMetadataDocument(clientId);

    // Validate the document
    this.validateDocument(clientId, document);

    // Warn about localhost-only redirect URIs
    if (this.securityConfig.warnOnLocalhostRedirects && hasOnlyLocalhostRedirectUris(document.redirect_uris)) {
      this.logger.warn(`CIMD client "${clientId}" has only localhost redirect URIs - this may be a development client`);
    }

    // Cache the result
    await this.cache.set(clientId, document, headers);
    const entry = await this.cache.get(clientId);

    return {
      isCimdClient: true,
      metadata: document,
      fromCache: false,
      expiresAt: entry?.expiresAt,
      etag: entry?.etag,
      lastModified: entry?.lastModified,
    };
  }

  /**
   * Validate that a redirect_uri is registered for the client.
   *
   * @param redirectUri - The redirect_uri from the authorization request
   * @param metadata - The client's metadata document
   * @throws RedirectUriMismatchError if the redirect_uri is not registered
   */
  validateRedirectUri(redirectUri: string, metadata: ClientMetadataDocument): void {
    // Normalize for comparison
    const normalizedRequestUri = normalizeRedirectUri(redirectUri);
    const normalizedAllowed = metadata.redirect_uris.map(normalizeRedirectUri);

    if (!normalizedAllowed.includes(normalizedRequestUri)) {
      throw new RedirectUriMismatchError(metadata.client_id, redirectUri, metadata.redirect_uris);
    }
  }

  /**
   * Clear the cache for a specific client or all clients.
   *
   * @param clientId - Optional client_id to clear; clears all if not provided
   */
  async clearCache(clientId?: string): Promise<void> {
    if (clientId) {
      await this.cache.delete(clientId);
      this.logger.debug(`Cache cleared for: ${clientId}`);
    } else {
      await this.cache.clear();
      this.logger.debug('Cache cleared');
    }
  }

  /**
   * Get cache statistics.
   */
  async getCacheStats(): Promise<{ size: number }> {
    return {
      size: await this.cache.size(),
    };
  }

  /**
   * Fetch a metadata document from a CIMD URL.
   *
   * Following the JwksService.fetchJson() pattern.
   */
  private async fetchMetadataDocument(clientId: string): Promise<{ document: unknown; headers: Headers }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.networkConfig.timeoutMs);

    try {
      // Check for conditional request headers
      const conditionalHeaders = await this.cache.getConditionalHeaders(clientId);
      const originalOrigin = new URL(clientId).origin;
      const maxRedirects = this.networkConfig.maxRedirects;

      let currentUrl = clientId;
      let redirectCount = 0;
      let isFirstRequest = true;

      while (true) {
        const headers: Record<string, string> = {
          Accept: 'application/json',
        };
        if (isFirstRequest && conditionalHeaders) {
          Object.assign(headers, conditionalHeaders);
        }

        const response = await fetch(currentUrl, {
          method: 'GET',
          headers,
          signal: controller.signal,
          redirect: 'manual',
        });

        // Handle 304 Not Modified
        if (response.status === 304) {
          const staleEntry = await this.cache.getStale(clientId);
          if (staleEntry) {
            await this.cache.revalidate(clientId, response.headers);
            this.logger.debug(`CIMD document not modified: ${clientId}`);
            return {
              document: staleEntry.document,
              headers: response.headers,
            };
          }
          // No cached entry to revalidate, treat as error
          throw new CimdFetchError(clientId, '304 Not Modified but no cached entry', {
            httpStatus: 304,
          });
        }

        // Handle redirects based on policy
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) {
            throw new CimdFetchError(clientId, 'Redirect response missing Location header', {
              httpStatus: response.status,
            });
          }

          const nextUrl = new URL(location, currentUrl).toString();
          const redirectPolicy = this.networkConfig.redirectPolicy;

          if (redirectPolicy === 'deny') {
            throw new CimdFetchError(
              clientId,
              `CIMD fetch redirected to "${nextUrl}" but redirects are disabled. ` +
                'Host the metadata at the client_id URL or set auth.cimd.network.redirectPolicy to "same-origin" or "allow".',
              { httpStatus: response.status },
            );
          }

          if (redirectPolicy === 'same-origin') {
            const nextOrigin = new URL(nextUrl).origin;
            if (nextOrigin !== originalOrigin) {
              throw new CimdFetchError(
                clientId,
                `CIMD fetch redirected to "${nextUrl}" which is not the same origin as "${originalOrigin}". ` +
                  'Host the metadata at the client_id URL or set auth.cimd.network.redirectPolicy to "allow".',
                { httpStatus: response.status },
              );
            }
          }

          // Validate redirect target against security policy
          validateClientIdUrl(nextUrl, this.securityConfig);

          redirectCount += 1;
          if (redirectCount > maxRedirects) {
            throw new CimdFetchError(
              clientId,
              `CIMD fetch exceeded max redirects (${maxRedirects}). ` +
                'Host the metadata at the client_id URL or increase auth.cimd.network.maxRedirects.',
            );
          }

          this.logger.warn(`CIMD redirect ${redirectCount}/${maxRedirects}: ${currentUrl} -> ${nextUrl}`);
          currentUrl = nextUrl;
          isFirstRequest = false;
          continue;
        }

        if (!response.ok) {
          throw new CimdFetchError(clientId, `HTTP ${response.status} ${response.statusText}`, {
            httpStatus: response.status,
          });
        }

        // Check Content-Length header
        const contentLength = response.headers.get('content-length');
        if (contentLength) {
          const length = parseInt(contentLength, 10);
          if (!isNaN(length) && length > this.networkConfig.maxResponseSizeBytes) {
            throw new CimdResponseTooLargeError(clientId, this.networkConfig.maxResponseSizeBytes, length);
          }
        }

        // Read response with size limit
        const text = await this.readResponseWithLimit(response, this.networkConfig.maxResponseSizeBytes, clientId);

        // Parse JSON
        let document: unknown;
        try {
          document = JSON.parse(text);
        } catch (e) {
          throw new CimdFetchError(clientId, 'Invalid JSON response', {
            originalError: e instanceof Error ? e : new Error(String(e)),
          });
        }

        return { document, headers: response.headers };
      }
    } catch (error) {
      if (error instanceof CimdFetchError || error instanceof CimdResponseTooLargeError) {
        throw error;
      }

      // Handle abort/timeout
      if (error instanceof Error && error.name === 'AbortError') {
        throw new CimdFetchError(clientId, 'Request timeout', {
          originalError: error,
        });
      }

      throw new CimdFetchError(clientId, error instanceof Error ? error.message : 'Unknown error', {
        originalError: error instanceof Error ? error : undefined,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Read response body with size limit.
   */
  private async readResponseWithLimit(response: Response, maxBytes: number, clientId: string): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) {
      // Fallback: use arrayBuffer to check size
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > maxBytes) {
        throw new CimdResponseTooLargeError(clientId, maxBytes, buffer.byteLength);
      }
      return new TextDecoder().decode(buffer);
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        totalBytes += value.length;
        if (totalBytes > maxBytes) {
          throw new CimdResponseTooLargeError(clientId, maxBytes, totalBytes);
        }

        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    // Combine chunks and decode
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    return new TextDecoder().decode(combined);
  }

  /**
   * Validate a fetched document against the schema.
   *
   * @param clientId - The URL from which the document was fetched
   * @param document - The document to validate
   */
  private validateDocument(clientId: string, document: unknown): asserts document is ClientMetadataDocument {
    // Parse with Zod schema
    const result = clientMetadataDocumentSchema.safeParse(document);

    if (!result.success) {
      const errors = result.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
        return `${path}${issue.message}`;
      });
      throw new CimdValidationError(clientId, errors);
    }

    // Verify client_id matches the URL
    if (result.data.client_id !== clientId) {
      throw new CimdClientIdMismatchError(clientId, result.data.client_id);
    }
  }
}

/**
 * Normalize a redirect_uri for comparison.
 *
 * Removes trailing slashes and normalizes case for scheme/host.
 */
function normalizeRedirectUri(uri: string): string {
  try {
    const url = new URL(uri);
    // Normalize scheme and host to lowercase, but preserve path case
    let normalized = `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}`;
    normalized += url.pathname.replace(/\/+$/, '') || '/';
    if (url.search) normalized += url.search;
    return normalized;
  } catch {
    // If not a valid URL, return as-is
    return uri;
  }
}
