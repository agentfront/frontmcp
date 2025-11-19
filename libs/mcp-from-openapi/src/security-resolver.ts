import type { ParameterMapper, SecurityParameterInfo } from './types';

/**
 * Context for resolving security parameters
 * Frameworks should implement this interface based on their auth system
 */
export interface SecurityContext {
  /**
   * JWT/Bearer token
   */
  jwt?: string;

  /**
   * Basic auth credentials (base64 encoded "username:password")
   */
  basic?: string;

  /**
   * Digest auth credentials
   * Object with username, password, realm, nonce, etc.
   */
  digest?: DigestAuthCredentials;

  /**
   * API key (single key for backward compatibility)
   */
  apiKey?: string;

  /**
   * Multiple API keys by name
   * Use this when API requires different keys for different purposes
   * @example { 'X-API-Key': 'key1', 'X-Client-Id': 'client123' }
   */
  apiKeys?: Record<string, string>;

  /**
   * OAuth2 access token
   */
  oauth2Token?: string;

  /**
   * Client certificate for mutual TLS (mTLS)
   */
  clientCertificate?: ClientCertificate;

  /**
   * Private key for signature-based auth (HMAC, AWS Signature V4, etc.)
   */
  privateKey?: string;

  /**
   * Public key (if needed for verification)
   */
  publicKey?: string;

  /**
   * HMAC secret for HMAC-based authentication
   */
  hmacSecret?: string;

  /**
   * AWS credentials for AWS Signature V4
   */
  awsCredentials?: AWSCredentials;

  /**
   * Custom headers for proprietary authentication
   * @example { 'X-Custom-Auth': 'custom-value' }
   */
  customHeaders?: Record<string, string>;

  /**
   * Session cookies
   */
  cookies?: Record<string, string>;

  /**
   * Custom resolver for framework-specific auth
   * @param security - Security parameter info from mapper
   * @returns The auth value to use, or undefined if not available
   */
  customResolver?: (security: SecurityParameterInfo) => string | Promise<string | undefined>;

  /**
   * Signature generator for signature-based auth
   * @param data - Data to sign (typically the request)
   * @param security - Security parameter info
   * @returns The signature or signed value
   */
  signatureGenerator?: (data: SignatureData, security: SecurityParameterInfo) => string | Promise<string>;
}

/**
 * Digest authentication credentials
 */
export interface DigestAuthCredentials {
  username: string;
  password: string;
  realm?: string;
  nonce?: string;
  uri?: string;
  qop?: string;
  nc?: string;
  cnonce?: string;
  response?: string;
  opaque?: string;
}

/**
 * Client certificate for mTLS
 */
export interface ClientCertificate {
  /**
   * Certificate in PEM format
   */
  cert: string;

  /**
   * Private key in PEM format
   */
  key: string;

  /**
   * Passphrase for encrypted key
   */
  passphrase?: string;

  /**
   * CA certificates
   */
  ca?: string | string[];
}

/**
 * AWS credentials for Signature V4
 */
export interface AWSCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region?: string;
  service?: string;
}

/**
 * Data to be signed for signature-based auth
 */
export interface SignatureData {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  timestamp?: number;
}

/**
 * Resolved security parameters ready to be added to HTTP request
 */
export interface ResolvedSecurity {
  /**
   * Headers to add to the request
   */
  headers: Record<string, string>;

  /**
   * Query parameters to add to the request
   */
  query: Record<string, string>;

  /**
   * Cookie values to add to the request
   */
  cookies: Record<string, string>;

  /**
   * Client certificate for mTLS (if applicable)
   */
  clientCertificate?: ClientCertificate;

  /**
   * Whether signature-based auth is required
   * If true, you need to call signRequest() before sending
   */
  requiresSignature?: boolean;

  /**
   * Signature metadata (if signature-based auth is used)
   */
  signatureInfo?: {
    scheme: string;
    algorithm?: string;
  };
}

/**
 * Security resolver that maps OpenAPI security requirements to actual auth values
 *
 * This helper handles security parameters from any OpenAPI spec, regardless of
 * custom naming (BearerAuth, JWT, Authorization, etc.). It uses the mapper's
 * security metadata to determine the auth type and format.
 *
 * @example
 * ```typescript
 * // In FrontMCP
 * const resolver = new SecurityResolver();
 * const resolved = resolver.resolve(tool.mapper, {
 *   jwt: context.authInfo.jwt,
 *   apiKey: process.env.API_KEY
 * });
 *
 * // Use resolved.headers in HTTP request
 * fetch(url, { headers: { ...resolved.headers, ...otherHeaders } });
 * ```
 *
 * @example
 * ```typescript
 * // Custom resolver for framework-specific auth
 * const resolved = resolver.resolve(tool.mapper, {
 *   customResolver: (security) => {
 *     if (security.type === 'http' && security.httpScheme === 'bearer') {
 *       return myFramework.getAuthToken();
 *     }
 *     return undefined;
 *   }
 * });
 * ```
 */
export class SecurityResolver {
  /**
   * Resolve security parameters from mapper entries
   *
   * @param mappers - Parameter mappers from the tool definition
   * @param context - Security context with auth values or custom resolver
   * @returns Resolved headers, query params, and cookies with auth applied
   */
  async resolve(mappers: ParameterMapper[], context: SecurityContext): Promise<ResolvedSecurity> {
    const resolved: ResolvedSecurity = {
      headers: {},
      query: {},
      cookies: {},
    };

    // Add client certificate if available (for mTLS)
    if (context.clientCertificate) {
      resolved.clientCertificate = context.clientCertificate;
    }

    // Check if signature-based auth is needed
    let requiresSignature = false;
    let signatureScheme: string | undefined;

    for (const mapper of mappers) {
      // Skip non-security parameters
      if (!mapper.security) {
        continue;
      }

      // Check for signature-based auth
      if (this.isSignatureBasedAuth(mapper.security)) {
        requiresSignature = true;
        signatureScheme = mapper.security.scheme;
        // Signature will be added later by signRequest()
        continue;
      }

      // Try to resolve the auth value
      const authValue = await this.resolveAuthValue(mapper.security, context);
      if (!authValue) {
        // Auth value not available - skip this security requirement
        // Framework may want to throw an error or log a warning
        continue;
      }

      // Apply to the correct location
      const headerName = mapper.key;

      if (mapper.type === 'header') {
        resolved.headers[headerName] = authValue;
      } else if (mapper.type === 'query') {
        resolved.query[headerName] = authValue;
      } else if (mapper.type === 'cookie') {
        resolved.cookies[headerName] = authValue;
      }
    }

    // Add context cookies if available
    if (context.cookies) {
      resolved.cookies = { ...resolved.cookies, ...context.cookies };
    }

    // Add signature metadata if needed
    if (requiresSignature) {
      resolved.requiresSignature = true;
      resolved.signatureInfo = {
        scheme: signatureScheme || 'unknown',
      };
    }

    return resolved;
  }

  /**
   * Check if security scheme requires request signing
   */
  private isSignatureBasedAuth(security: SecurityParameterInfo): boolean {
    // Check for schemes that typically require signing
    const signatureSchemes = ['aws4', 'hmac', 'signature', 'hawk', 'custom-signature'];
    return signatureSchemes.some(scheme =>
      security.scheme.toLowerCase().includes(scheme)
    );
  }

  /**
   * Resolve the actual auth value based on security type
   */
  private async resolveAuthValue(
    security: SecurityParameterInfo,
    context: SecurityContext
  ): Promise<string | undefined> {
    // Try custom resolver first
    if (context.customResolver) {
      const customValue = await context.customResolver(security);
      if (customValue !== undefined) {
        return customValue;
      }
    }

    // Handle standard security types
    if (security.type === 'http') {
      return this.resolveHttpAuth(security, context);
    } else if (security.type === 'apiKey') {
      return this.resolveApiKey(security, context);
    } else if (security.type === 'oauth2' || security.type === 'openIdConnect') {
      return this.resolveOAuth2(security, context);
    }

    return undefined;
  }

  /**
   * Resolve HTTP authentication (bearer, basic, digest, etc.)
   */
  private resolveHttpAuth(
    security: SecurityParameterInfo,
    context: SecurityContext
  ): string | undefined {
    const scheme = security.httpScheme?.toLowerCase() || 'bearer';

    switch (scheme) {
      case 'bearer':
        return this.resolveBearerAuth(context);

      case 'basic':
        return this.resolveBasicAuth(context);

      case 'digest':
        return this.resolveDigestAuth(context);

      case 'hoba':
      case 'mutual':
      case 'negotiate':
      case 'vapid':
      case 'scram':
        // These schemes typically require custom implementation
        // Try custom headers or signature generator
        return this.resolveCustomHttpScheme(scheme, security, context);

      default:
        // Unknown scheme - try custom resolver
        return undefined;
    }
  }

  /**
   * Resolve Bearer token authentication
   */
  private resolveBearerAuth(context: SecurityContext): string | undefined {
    const token = context.jwt;
    if (!token) return undefined;
    return `Bearer ${token}`;
  }

  /**
   * Resolve Basic authentication
   */
  private resolveBasicAuth(context: SecurityContext): string | undefined {
    const credentials = context.basic;
    if (!credentials) return undefined;
    return `Basic ${credentials}`;
  }

  /**
   * Resolve Digest authentication
   */
  private resolveDigestAuth(context: SecurityContext): string | undefined {
    const digest = context.digest;
    if (!digest) return undefined;

    // Build digest auth header
    const parts: string[] = [
      `username="${digest.username}"`,
      digest.realm ? `realm="${digest.realm}"` : '',
      digest.nonce ? `nonce="${digest.nonce}"` : '',
      digest.uri ? `uri="${digest.uri}"` : '',
      digest.response ? `response="${digest.response}"` : '',
      digest.opaque ? `opaque="${digest.opaque}"` : '',
      digest.qop ? `qop=${digest.qop}` : '',
      digest.nc ? `nc=${digest.nc}` : '',
      digest.cnonce ? `cnonce="${digest.cnonce}"` : '',
    ].filter(Boolean);

    return `Digest ${parts.join(', ')}`;
  }

  /**
   * Resolve custom HTTP authentication schemes
   */
  private resolveCustomHttpScheme(
    scheme: string,
    security: SecurityParameterInfo,
    context: SecurityContext
  ): string | undefined {
    // Try custom headers first
    const headerKey = security.apiKeyName || `X-${scheme.toUpperCase()}`;
    if (context.customHeaders?.[headerKey]) {
      return context.customHeaders[headerKey];
    }

    // Unknown scheme
    return undefined;
  }

  /**
   * Resolve API key authentication
   */
  private resolveApiKey(
    security: SecurityParameterInfo,
    context: SecurityContext
  ): string | undefined {
    // Try named API keys first (for multiple keys)
    if (context.apiKeys && security.apiKeyName) {
      const key = context.apiKeys[security.apiKeyName];
      if (key) return key;
    }

    // Try custom headers (for proprietary auth headers like X-Custom-Auth)
    if (context.customHeaders && security.apiKeyName) {
      const header = context.customHeaders[security.apiKeyName];
      if (header) return header;
    }

    // Fall back to single apiKey (backward compatibility)
    return context.apiKey;
  }

  /**
   * Resolve OAuth2/OpenID Connect authentication
   */
  private resolveOAuth2(
    security: SecurityParameterInfo,
    context: SecurityContext
  ): string | undefined {
    const token = context.oauth2Token;
    if (!token) return undefined;

    // OAuth2 tokens are typically formatted as "Bearer {token}"
    return `Bearer ${token}`;
  }

  /**
   * Check if any security requirements are missing from context
   *
   * @param mappers - Parameter mappers from the tool definition
   * @param context - Security context with auth values
   * @returns Array of missing security scheme names
   */
  async checkMissingSecurity(
    mappers: ParameterMapper[],
    context: SecurityContext
  ): Promise<string[]> {
    const missing: string[] = [];

    for (const mapper of mappers) {
      if (!mapper.security) continue;

      const authValue = await this.resolveAuthValue(mapper.security, context);
      if (!authValue) {
        missing.push(mapper.security.scheme);
      }
    }

    return missing;
  }

  /**
   * Sign a request for signature-based authentication
   *
   * Use this when resolved.requiresSignature is true.
   * This method will call the signatureGenerator from context to sign the request.
   *
   * @param mappers - Parameter mappers from the tool definition
   * @param signatureData - Request data to sign
   * @param context - Security context with signature generator
   * @returns Headers with signature added
   *
   * @example
   * ```typescript
   * const resolved = resolver.resolve(tool.mapper, context);
   * if (resolved.requiresSignature) {
   *   const signedHeaders = await resolver.signRequest(
   *     tool.mapper,
   *     { method: 'GET', url: 'https://api.example.com/data', headers: resolved.headers },
   *     context
   *   );
   *   // Use signedHeaders in request
   * }
   * ```
   */
  async signRequest(
    mappers: ParameterMapper[],
    signatureData: SignatureData,
    context: SecurityContext
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = { ...signatureData.headers };

    if (!context.signatureGenerator) {
      throw new Error('Signature-based auth required but no signatureGenerator provided');
    }

    for (const mapper of mappers) {
      if (!mapper.security || !this.isSignatureBasedAuth(mapper.security)) {
        continue;
      }

      // Call signature generator
      const signature = await context.signatureGenerator(signatureData, mapper.security);

      // Add signature to appropriate location
      if (mapper.type === 'header') {
        headers[mapper.key] = signature;
      }
      // Note: Query/cookie signatures would be handled differently
    }

    return headers;
  }
}

/**
 * Create a basic security context from common auth sources
 *
 * @example
 * ```typescript
 * const context = createSecurityContext({
 *   jwt: process.env.JWT_TOKEN,
 *   apiKey: process.env.API_KEY
 * });
 * ```
 */
export function createSecurityContext(
  auth: Partial<SecurityContext>
): SecurityContext {
  return {
    jwt: auth.jwt,
    basic: auth.basic,
    apiKey: auth.apiKey,
    oauth2Token: auth.oauth2Token,
    customResolver: auth.customResolver,
  };
}
