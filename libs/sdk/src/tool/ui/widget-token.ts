/**
 * Widget Token Utilities
 *
 * Generates and validates short-lived tokens for authenticated widget operations.
 * These tokens allow widgets to perform operations like callTool while protecting
 * against unauthorized access.
 *
 * Token format: Base64-encoded JSON with HMAC signature
 * Token lifetime: 5-10 minutes (configurable)
 */

import { createHmac, randomBytes } from 'crypto';

/**
 * Default token TTL: 5 minutes
 */
const DEFAULT_TOKEN_TTL_MS = 5 * 60 * 1000;

/**
 * Maximum token TTL: 30 minutes
 */
const MAX_TOKEN_TTL_MS = 30 * 60 * 1000;

/**
 * Widget token payload
 */
export interface WidgetTokenPayload {
  /** Tool name this token is valid for */
  toolName: string;
  /** Request ID this token was generated for */
  requestId: string;
  /** Session ID (optional, for session-bound tokens) */
  sessionId?: string;
  /** Token scope (read = view only, write = can call tools) */
  scope: 'read' | 'write';
  /** Token expiration timestamp (Unix ms) */
  expiresAt: number;
  /** Token issued at timestamp (Unix ms) */
  issuedAt: number;
}

/**
 * Options for generating a widget token
 */
export interface GenerateWidgetTokenOptions {
  /** Tool name the token is valid for */
  toolName: string;
  /** Request ID */
  requestId: string;
  /** Session ID (optional) */
  sessionId?: string;
  /** Token scope (default: 'read') */
  scope?: 'read' | 'write';
  /** Token TTL in milliseconds (default: 5 minutes, max: 30 minutes) */
  ttl?: number;
}

/**
 * Result of token validation
 */
export interface ValidateWidgetTokenResult {
  /** Whether the token is valid */
  valid: boolean;
  /** Decoded payload if valid */
  payload?: WidgetTokenPayload;
  /** Error message if invalid */
  error?: string;
}

/**
 * Widget token manager.
 *
 * Provides token generation and validation for widget authentication.
 * Uses HMAC-SHA256 for signature verification.
 *
 * @example
 * ```typescript
 * const tokenManager = new WidgetTokenManager('your-secret-key');
 *
 * // Generate a token
 * const token = tokenManager.generate({
 *   toolName: 'get_weather',
 *   requestId: 'abc123',
 *   scope: 'read',
 * });
 *
 * // Validate a token
 * const result = tokenManager.validate(token);
 * if (result.valid) {
 *   console.log('Tool:', result.payload.toolName);
 * }
 * ```
 */
export class WidgetTokenManager {
  private readonly secret: Buffer;

  /**
   * Create a new WidgetTokenManager.
   *
   * @param secret - Secret key for signing tokens (min 32 bytes recommended)
   */
  constructor(secret: string | Buffer) {
    if (typeof secret === 'string') {
      this.secret = Buffer.from(secret, 'utf-8');
    } else {
      this.secret = secret;
    }

    if (this.secret.length < 16) {
      throw new Error('Widget token secret must be at least 16 bytes');
    }
  }

  /**
   * Generate a widget token.
   *
   * @param options - Token generation options
   * @returns Encoded token string
   */
  generate(options: GenerateWidgetTokenOptions): string {
    const { toolName, requestId, sessionId, scope = 'read', ttl = DEFAULT_TOKEN_TTL_MS } = options;

    // Clamp TTL to max
    const effectiveTtl = Math.min(ttl, MAX_TOKEN_TTL_MS);
    const now = Date.now();

    const payload: WidgetTokenPayload = {
      toolName,
      requestId,
      sessionId,
      scope,
      issuedAt: now,
      expiresAt: now + effectiveTtl,
    };

    // Encode payload
    const payloadJson = JSON.stringify(payload);
    const payloadBase64 = Buffer.from(payloadJson, 'utf-8').toString('base64url');

    // Generate signature
    const signature = this.sign(payloadBase64);

    // Combine: payload.signature
    return `${payloadBase64}.${signature}`;
  }

  /**
   * Validate a widget token.
   *
   * @param token - Token string to validate
   * @returns Validation result with payload if valid
   */
  validate(token: string): ValidateWidgetTokenResult {
    if (!token || typeof token !== 'string') {
      return { valid: false, error: 'Invalid token format' };
    }

    // Split token
    const parts = token.split('.');
    if (parts.length !== 2) {
      return { valid: false, error: 'Invalid token format' };
    }

    const [payloadBase64, providedSignature] = parts;

    // Verify signature
    const expectedSignature = this.sign(payloadBase64);
    if (!this.secureCompare(providedSignature, expectedSignature)) {
      return { valid: false, error: 'Invalid token signature' };
    }

    // Decode payload
    let payload: WidgetTokenPayload;
    try {
      const payloadJson = Buffer.from(payloadBase64, 'base64url').toString('utf-8');
      payload = JSON.parse(payloadJson);
    } catch {
      return { valid: false, error: 'Invalid token payload' };
    }

    // Validate required fields
    if (!payload.toolName || !payload.requestId || !payload.expiresAt) {
      return { valid: false, error: 'Missing required token fields' };
    }

    // Check expiration
    if (Date.now() > payload.expiresAt) {
      return { valid: false, error: 'Token expired' };
    }

    return { valid: true, payload };
  }

  /**
   * Create a signed widget URL with embedded token.
   *
   * @param baseUrl - Base URL for the widget
   * @param options - Token generation options
   * @returns URL with token query parameter
   */
  createSignedUrl(baseUrl: string, options: GenerateWidgetTokenOptions): string {
    const token = this.generate(options);
    const url = new URL(baseUrl);
    url.searchParams.set('token', token);
    url.searchParams.set('requestId', options.requestId);
    return url.toString();
  }

  /**
   * Sign a payload with HMAC-SHA256.
   */
  private sign(data: string): string {
    const hmac = createHmac('sha256', this.secret);
    hmac.update(data);
    return hmac.digest('base64url');
  }

  /**
   * Constant-time string comparison to prevent timing attacks.
   */
  private secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }
}

/**
 * Generate a random secret key for widget token signing.
 *
 * @param bytes - Number of bytes (default: 32)
 * @returns Base64-encoded secret key
 */
export function generateWidgetSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64');
}

/**
 * Create a default widget token manager using environment variable.
 *
 * Uses `FRONTMCP_WIDGET_SECRET` env var, or generates a random secret
 * if not set (with a warning).
 */
export function createDefaultTokenManager(): WidgetTokenManager {
  let secret = process.env['FRONTMCP_WIDGET_SECRET'];

  if (!secret) {
    // Generate ephemeral secret (tokens won't survive restart)
    secret = generateWidgetSecret();
    console.warn(
      '[FrontMCP] No FRONTMCP_WIDGET_SECRET set, using ephemeral secret. ' +
        'Widget tokens will be invalidated on server restart.',
    );
  }

  return new WidgetTokenManager(secret);
}
