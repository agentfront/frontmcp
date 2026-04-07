/**
 * Fetch Credential Middleware
 *
 * Middleware that intercepts fetch init options to resolve and inject
 * upstream provider credentials. The auth provider decides HOW to apply
 * credentials — Bearer header, API key header, query parameter, basic auth, etc.
 *
 * Standard `RequestCredentials` strings ('include', 'same-origin', 'omit')
 * are passed through unchanged.
 */

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * Resolves an access token for a named upstream provider.
 */
export interface TokenAccessor {
  getToken(providerId: string): Promise<string | null>;
}

/**
 * Describes how to apply a credential to an outgoing request.
 * Each auth provider type can implement its own strategy.
 */
export interface CredentialApplier {
  /**
   * Apply the credential to the request.
   *
   * @param token - The credential value (token, API key, etc.)
   * @param url - The target URL
   * @param init - The current RequestInit (headers, etc.)
   * @returns Modified RequestInit with credential applied
   */
  apply(token: string, url: string, init: RequestInit): RequestInit;
}

/**
 * Built-in applier: injects `Authorization: Bearer <token>` header.
 */
export const bearerApplier: CredentialApplier = {
  apply(token: string, _url: string, init: RequestInit): RequestInit {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return { ...init, headers };
  },
};

/**
 * Built-in applier: injects a custom header with the token value.
 * Used for API keys (e.g., `X-API-Key: <token>`).
 */
export function headerApplier(headerName: string, prefix?: string): CredentialApplier {
  return {
    apply(token: string, _url: string, init: RequestInit): RequestInit {
      const headers = new Headers(init.headers);
      headers.set(headerName, prefix ? `${prefix} ${token}` : token);
      return { ...init, headers };
    },
  };
}

/**
 * Built-in applier: injects the token as a query parameter.
 */
export function queryApplier(paramName: string): CredentialApplier {
  return {
    apply(token: string, url: string, init: RequestInit): RequestInit {
      const urlObj = new URL(url);
      urlObj.searchParams.set(paramName, token);
      // Return init unchanged — the caller must use the modified URL
      // We store the modified URL in a custom field
      return { ...init, _resolvedUrl: urlObj.toString() } as RequestInit;
    },
  };
}

/**
 * Built-in applier: injects `Authorization: Basic <base64(user:pass)>` header.
 */
export const basicApplier: CredentialApplier = {
  apply(token: string, _url: string, init: RequestInit): RequestInit {
    const headers = new Headers(init.headers);
    // Token is expected to be "user:password" format
    const encoded = typeof btoa === 'function' ? btoa(token) : Buffer.from(token).toString('base64');
    headers.set('Authorization', `Basic ${encoded}`);
    return { ...init, headers };
  },
};

/**
 * Extended credentials that reference a named auth provider.
 */
export interface FrontMcpCredentials {
  /** Provider name to resolve token from vault */
  provider: string;
}

/**
 * Extended RequestInit that accepts either standard `RequestCredentials`
 * strings or a `FrontMcpCredentials` object with a provider reference.
 */
export type FrontMcpFetchInit = Omit<RequestInit, 'credentials'> & {
  credentials?: FrontMcpCredentials | RequestCredentials;
};

// ---------------------------------------------------------------------------
// Type Guard
// ---------------------------------------------------------------------------

function isFrontMcpCredentials(
  creds: FrontMcpCredentials | RequestCredentials,
): creds is FrontMcpCredentials {
  return typeof creds === 'object' && creds !== null && 'provider' in creds;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Middleware that resolves upstream provider tokens and delegates to
 * the provider's CredentialApplier to inject them into outgoing requests.
 *
 * By default, uses `bearerApplier` (Authorization: Bearer header).
 * Providers can register custom appliers for API keys, query params, basic auth, etc.
 *
 * @example
 * ```typescript
 * const middleware = new FetchCredentialMiddleware(tokenAccessor, {
 *   github: bearerApplier,
 *   stripe: headerApplier('Authorization', 'Bearer'),
 *   maps: queryApplier('key'),
 * });
 * ```
 */
export class FetchCredentialMiddleware {
  private readonly appliers: Map<string, CredentialApplier>;

  constructor(
    private readonly tokenAccessor: TokenAccessor,
    appliers?: Record<string, CredentialApplier>,
  ) {
    this.appliers = new Map(Object.entries(appliers ?? {}));
  }

  /**
   * Inspect the `credentials` field. If it references a named provider,
   * resolve the token and delegate to the provider's applier.
   */
  async applyCredentials(url: string, init: FrontMcpFetchInit): Promise<RequestInit> {
    const creds = init.credentials;

    // No credentials or standard string → pass through
    if (!creds || typeof creds === 'string') {
      return init as RequestInit;
    }

    if (!isFrontMcpCredentials(creds)) {
      return init as RequestInit;
    }

    // Resolve token from vault
    const token = await this.tokenAccessor.getToken(creds.provider);
    if (!token) {
      const { credentials: _removed, ...rest } = init;
      return rest;
    }

    // Get the provider's applier (default: Bearer header)
    const applier = this.appliers.get(creds.provider) ?? bearerApplier;

    // Remove custom credentials field before applying
    const { credentials: _removed, ...cleanInit } = init;

    // Let the provider decide how to inject the credential
    return applier.apply(token, url, cleanInit);
  }
}
