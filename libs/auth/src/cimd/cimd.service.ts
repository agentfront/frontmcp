/**
 * CIMD (Client ID Metadata Documents) Service
 *
 * Core service for resolving and validating OAuth Client ID Metadata Documents.
 *
 * @see https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document-00
 */
import type { JSONWebKeySet } from 'jose';

import { isRedirectResponse } from '@frontmcp/utils';

import { verifyClientAssertion, type ClientAssertionCheck } from './cimd-client-assertion';
import { createCimdCache, extractCacheHeaders, parseCacheHeaders, type CimdCacheBackend } from './cimd.cache';
import {
  CimdClientAssertionError,
  CimdClientIdMismatchError,
  CimdFetchError,
  CimdResponseTooLargeError,
  CimdSecurityError,
  CimdValidationError,
  InvalidClientIdUrlError,
  RedirectUriMismatchError,
} from './cimd.errors';
import { noopLogger, type CimdLogger } from './cimd.logger';
import {
  cimdCacheConfigSchema,
  cimdConfigSchema,
  cimdNetworkConfigSchema,
  cimdSecurityConfigSchema,
  clientJwksSchema,
  clientMetadataDocumentSchema,
  type CimdCacheConfig,
  type CimdConfig,
  type CimdConfigInput,
  type CimdNetworkConfig,
  type CimdResolutionResult,
  type CimdSecurityConfig,
  type ClientMetadataDocument,
} from './cimd.types';
import {
  assertHostNotSsrf,
  blocksPrivateAddressesFor,
  hasOnlyLocalhostRedirectUris,
  isCimdClientId,
  validateClientIdUrl,
} from './cimd.validator';

/** How many `jwks_uri` key sets are kept in memory; the oldest goes first. */
const MAX_CACHED_KEY_SETS = 500;

/** How soon a key set may be fetched again for an assertion naming a key it lacks (a rotation). */
const KEY_SET_REFRESH_COOLDOWN_MS = 30_000;

interface CachedKeySet {
  keys: JSONWebKeySet;
  fetchedAt: number;
  expiresAt: number;
}

type FetchedJson =
  | { notModified: true; headers: Headers }
  | { notModified: false; document: unknown; headers: Headers };

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
  private cacheBackend?: Promise<CimdCacheBackend>;
  private readonly keySets = new Map<string, CachedKeySet>();
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
   * Create the cache now (connecting to Redis with `cache.type: 'redis'`), so a misconfigured or
   * unreachable cache fails at startup rather than on the first CIMD client.
   */
  async initialize(): Promise<void> {
    await this.cache();
  }

  /**
   * The cache `cache.type` selects, created once through the `createCimdCache` factory. A failed
   * creation is retried on the next use.
   */
  private cache(): Promise<CimdCacheBackend> {
    if (!this.cacheBackend) {
      this.cacheBackend = createCimdCache(this.cacheConfig).catch((error: unknown) => {
        this.cacheBackend = undefined;
        throw error;
      });
    }
    return this.cacheBackend;
  }

  /** Close the cache's connection (Redis with `cache.type: 'redis'`), if one was created. */
  async dispose(): Promise<void> {
    const backend = this.cacheBackend;
    this.cacheBackend = undefined;
    if (!backend) return;
    const createdBackend = await backend.catch(() => undefined);
    await createdBackend?.close?.();
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
    const cache = await this.cache();
    const cached = await cache.get(clientId);
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

    // Validate the document, and keep the parsed one: it carries the schema's defaults
    const metadata = this.validateDocument(clientId, document);

    // Warn about localhost-only redirect URIs
    if (this.securityConfig.warnOnLocalhostRedirects && hasOnlyLocalhostRedirectUris(metadata.redirect_uris)) {
      this.logger.warn(`CIMD client "${clientId}" has only localhost redirect URIs - this may be a development client`);
    }

    // Cache the result
    await cache.set(clientId, metadata, headers);
    const entry = await cache.get(clientId);

    return {
      isCimdClient: true,
      metadata,
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
   * Check that this server can honor the client as its document declares it: it authenticates at the token
   * endpoint with `none`, or with `private_key_jwt` and exactly one of `jwks` / `jwks_uri` (a public document holds
   * no shared secret, so `client_secret_*` is refused), and it uses the authorization code grant with
   * `response_type=code`.
   *
   * @param metadata - The client's metadata document
   * @throws CimdValidationError naming each declaration this server cannot honor
   */
  assertSupportedClient(metadata: ClientMetadataDocument): void {
    const problems: string[] = [];
    const method = metadata.token_endpoint_auth_method;
    if (method === 'private_key_jwt') {
      problems.push(...this.keySourceProblems(metadata));
    } else if (method !== 'none') {
      problems.push(`token_endpoint_auth_method "${method}" is not supported, only "none" or "private_key_jwt"`);
    }
    if (!metadata.grant_types.includes('authorization_code')) {
      problems.push('grant_types must include "authorization_code"');
    }
    if (!metadata.response_types.includes('code')) {
      problems.push('response_types must include "code"');
    }
    if (problems.length > 0) {
      throw new CimdValidationError(metadata.client_id, problems);
    }
  }

  /**
   * Authenticate a `private_key_jwt` client by its assertion (RFC 7523): see {@link verifyClientAssertion}.
   *
   * @param metadata - The client's metadata document, which declares `private_key_jwt`
   * @param check - The token request's assertion, the audiences it may name, and the `jti` store
   * @throws CimdClientAssertionError when the assertion is missing or refused
   * @throws CimdFetchError, CimdResponseTooLargeError or CimdSecurityError when `jwks_uri` can't be fetched
   */
  async verifyClientAssertion(metadata: ClientMetadataDocument, check: ClientAssertionCheck): Promise<void> {
    await verifyClientAssertion({
      ...check,
      clientId: metadata.client_id,
      keys: (refresh) => this.clientKeys(metadata, refresh),
    });
  }

  /**
   * The client's keys: its inline `jwks`, or the key set at its `jwks_uri`, fetched like the document itself
   * (SSRF guard, redirect policy, timeout, size limit) and cached for the TTL its cache headers give, within
   * `cache.minTtlMs` and `cache.maxTtlMs`. With `refresh`, a cached key set at least
   * {@link KEY_SET_REFRESH_COOLDOWN_MS} old is fetched again.
   */
  private async clientKeys(metadata: ClientMetadataDocument, refresh: boolean): Promise<JSONWebKeySet> {
    if (metadata.jwks) return metadata.jwks as JSONWebKeySet;
    const jwksUri = metadata.jwks_uri;
    if (!jwksUri) throw new CimdClientAssertionError(metadata.client_id, 'no_keys');

    const now = Date.now();
    const cached = this.keySets.get(jwksUri);
    const reusable =
      cached && cached.expiresAt > now && (!refresh || now - cached.fetchedAt < KEY_SET_REFRESH_COOLDOWN_MS);
    if (reusable) return cached.keys;

    validateClientIdUrl(jwksUri, this.securityConfig);
    const fetched = await this.fetchJson(jwksUri);
    if (fetched.notModified) throw new CimdFetchError(jwksUri, '304 Not Modified to an unconditional request');
    const parsed = clientJwksSchema.safeParse(fetched.document);
    if (!parsed.success) throw new CimdValidationError(jwksUri, ['jwks_uri did not return a JSON Web Key Set']);

    const { ttlMs } = parseCacheHeaders(extractCacheHeaders(fetched.headers), this.cacheConfig);
    this.keySets.delete(jwksUri);
    this.keySets.set(jwksUri, { keys: parsed.data as JSONWebKeySet, fetchedAt: now, expiresAt: now + ttlMs });
    if (this.keySets.size > MAX_CACHED_KEY_SETS) {
      const oldest = this.keySets.keys().next().value;
      if (oldest !== undefined) this.keySets.delete(oldest);
    }
    return parsed.data as JSONWebKeySet;
  }

  /** Why a `private_key_jwt` document's keys can't be used: neither or both of `jwks` / `jwks_uri`, or a bad URI. */
  private keySourceProblems(metadata: ClientMetadataDocument): string[] {
    if (!metadata.jwks === !metadata.jwks_uri) {
      return ['token_endpoint_auth_method "private_key_jwt" needs exactly one of "jwks" or "jwks_uri"'];
    }
    if (!metadata.jwks_uri) return [];
    try {
      validateClientIdUrl(metadata.jwks_uri, this.securityConfig);
      return [];
    } catch (error) {
      if (error instanceof InvalidClientIdUrlError) return [`jwks_uri is not allowed: ${error.reason}`];
      if (error instanceof CimdSecurityError) return [`jwks_uri is not allowed: ${error.securityReason}`];
      throw error;
    }
  }

  /**
   * Clear the cache for a specific client or all clients.
   *
   * @param clientId - Optional client_id to clear; clears all if not provided
   */
  async clearCache(clientId?: string): Promise<void> {
    const cache = await this.cache();
    if (clientId) {
      await cache.delete(clientId);
      this.logger.debug(`Cache cleared for: ${clientId}`);
    } else {
      await cache.clear();
      this.logger.debug('Cache cleared');
    }
  }

  /**
   * Get cache statistics.
   */
  async getCacheStats(): Promise<{ size: number }> {
    const cache = await this.cache();
    return {
      size: await cache.size(),
    };
  }

  /**
   * Fetch a metadata document from a CIMD URL, revalidating a cached one with a conditional request.
   */
  private async fetchMetadataDocument(clientId: string): Promise<{ document: unknown; headers: Headers }> {
    const cache = await this.cache();
    const conditionalHeaders = await cache.getConditionalHeaders(clientId);
    const fetched = await this.fetchJson(clientId, conditionalHeaders);
    if (!fetched.notModified) return fetched;

    const staleEntry = await cache.getStale(clientId);
    if (!staleEntry) {
      throw new CimdFetchError(clientId, '304 Not Modified but no cached entry', { httpStatus: 304 });
    }
    await cache.revalidate(clientId, fetched.headers);
    this.logger.debug(`CIMD document not modified: ${clientId}`);
    return { document: staleEntry.document, headers: fetched.headers };
  }

  /**
   * Fetch a JSON document (a client metadata document or a client's `jwks_uri`) with the SSRF guard on every hop,
   * the redirect policy, the timeout and the size limit. `url` names the document in every error.
   *
   * Following the JwksService.fetchJson() pattern.
   */
  private async fetchJson(url: string, conditionalHeaders?: Record<string, string>): Promise<FetchedJson> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.networkConfig.timeoutMs);

    try {
      const originalOrigin = new URL(url).origin;
      const maxRedirects = this.networkConfig.maxRedirects;

      let currentUrl = url;
      let redirectCount = 0;
      let isFirstRequest = true;

      while (true) {
        // SSRF guard (DNS-aware): resolve the current host and reject if it (or
        // any resolved address) is internal. Runs for the initial URL AND every
        // redirect hop, immediately before the fetch, so an attacker-supplied
        // host cannot reach cloud-metadata / private addresses via a
        // DNS record or a 3xx to an internal target. `validateClientIdUrl`
        // (literal-IP checks) already ran for the initial URL and each redirect
        // target; this adds the resolved-address check. Skipped for a localhost
        // host under allowInsecureForTesting, and when blockPrivateIPs is off.
        const hostname = new URL(currentUrl).hostname;
        if (blocksPrivateAddressesFor(hostname, this.securityConfig)) {
          await assertHostNotSsrf(hostname, url);
        }

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

        if (response.status === 304) {
          return { notModified: true, headers: response.headers };
        }

        // Handle redirects based on policy (an opaque redirect has no readable Location and is refused)
        if (isRedirectResponse(response)) {
          const location = response.headers.get('location');
          if (!location) {
            throw new CimdFetchError(url, 'Redirect response missing Location header', {
              httpStatus: response.status,
            });
          }

          const nextUrl = new URL(location, currentUrl).toString();
          const redirectPolicy = this.networkConfig.redirectPolicy;

          if (redirectPolicy === 'deny') {
            throw new CimdFetchError(
              url,
              `CIMD fetch redirected to "${nextUrl}" but redirects are disabled. ` +
                'Host the metadata at the client_id URL or set auth.cimd.network.redirectPolicy to "same-origin" or "allow".',
              { httpStatus: response.status },
            );
          }

          if (redirectPolicy === 'same-origin') {
            const nextOrigin = new URL(nextUrl).origin;
            if (nextOrigin !== originalOrigin) {
              throw new CimdFetchError(
                url,
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
              url,
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
          throw new CimdFetchError(url, `HTTP ${response.status} ${response.statusText}`, {
            httpStatus: response.status,
          });
        }

        // Check Content-Length header
        const contentLength = response.headers.get('content-length');
        if (contentLength) {
          const length = parseInt(contentLength, 10);
          if (!isNaN(length) && length > this.networkConfig.maxResponseSizeBytes) {
            throw new CimdResponseTooLargeError(url, this.networkConfig.maxResponseSizeBytes, length);
          }
        }

        // Read response with size limit
        const text = await this.readResponseWithLimit(response, this.networkConfig.maxResponseSizeBytes, url);

        // Parse JSON
        let document: unknown;
        try {
          document = JSON.parse(text);
        } catch (e) {
          throw new CimdFetchError(url, 'Invalid JSON response', {
            originalError: e instanceof Error ? e : new Error(String(e)),
          });
        }

        return { notModified: false, document, headers: response.headers };
      }
    } catch (error) {
      if (
        error instanceof CimdFetchError ||
        error instanceof CimdResponseTooLargeError ||
        error instanceof CimdSecurityError
      ) {
        // Propagate SSRF blocks verbatim (do not re-wrap as a generic fetch error).
        throw error;
      }

      // Handle abort/timeout
      if (error instanceof Error && error.name === 'AbortError') {
        throw new CimdFetchError(url, 'Request timeout', {
          originalError: error,
        });
      }

      throw new CimdFetchError(url, error instanceof Error ? error.message : 'Unknown error', {
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
   * @returns The parsed document, with the schema's defaults for the fields it leaves out
   */
  private validateDocument(clientId: string, document: unknown): ClientMetadataDocument {
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

    return result.data;
  }
}

/**
 * Loopback interface hostnames per RFC 8252 §7.3. A native app's redirect
 * to one of these uses an ephemeral, OS-assigned port that the client cannot
 * register ahead of time, so the authorization server MUST compare the
 * redirect_uri ignoring the port for these hosts.
 *
 * Node's `URL.hostname` keeps the brackets on IPv6 literals (`[::1]`), so the
 * bracketed form is included alongside the bare form for robustness.
 */
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

/**
 * Whether a hostname (as returned by `URL.hostname`) refers to the loopback
 * interface per RFC 8252 §7.3. Handles the bracketed IPv6 form `[::1]`.
 */
function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());
}

/**
 * Normalize a redirect_uri for comparison.
 *
 * Removes trailing slashes and normalizes case for scheme/host.
 *
 * RFC 8252 §7.3: for loopback redirects (`127.0.0.1`, `[::1]`, `localhost`)
 * the port is OS-assigned and ephemeral, so it is dropped from the normalized
 * form — scheme + loopback host + path must match, but the port may differ.
 * Non-loopback hosts keep their port (exact match).
 */
function normalizeRedirectUri(uri: string): string {
  try {
    const url = new URL(uri);
    // Normalize scheme and host to lowercase, but preserve path case.
    // For loopback hosts, drop the port (RFC 8252 §7.3) by comparing only the
    // hostname, so `127.0.0.1:1234` ≡ `127.0.0.1:5678` and `[::1]:1234` ≡
    // `[::1]:5678`. Non-loopback hosts keep their `host` (port included).
    const host = isLoopbackHostname(url.hostname) ? url.hostname.toLowerCase() : url.host.toLowerCase();
    let normalized = `${url.protocol.toLowerCase()}//${host}`;
    normalized += url.pathname.replace(/\/+$/, '') || '/';
    if (url.search) normalized += url.search;
    return normalized;
  } catch {
    // If not a valid URL, return as-is
    return uri;
  }
}
