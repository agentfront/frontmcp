/**
 * @file token-factory.ts
 * @description JWT token factory for testing authentication
 */

import { SignJWT, generateKeyPair, exportJWK, type JWTPayload, type JWK } from 'jose';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface CreateTokenOptions {
  /** Subject (user ID) - required */
  sub: string;
  /** Issuer URL */
  iss?: string;
  /** Audience */
  aud?: string | string[];
  /** OAuth scopes */
  scopes?: string[];
  /** Expiration time in seconds from now (default: 3600) */
  exp?: number;
  /** Additional custom claims */
  claims?: Record<string, unknown>;
}

export interface TokenFactoryOptions {
  /** Default issuer URL */
  issuer?: string;
  /** Default audience */
  audience?: string;
}

// Type for crypto key
type CryptoKeyLike = CryptoKey | Uint8Array;

// ═══════════════════════════════════════════════════════════════════
// TOKEN FACTORY CLASS
// ═══════════════════════════════════════════════════════════════════

/**
 * Factory for creating JWT tokens for testing
 *
 * @example
 * ```typescript
 * const factory = new TestTokenFactory();
 *
 * // Create a token with claims
 * const token = await factory.createTestToken({
 *   sub: 'user-123',
 *   scopes: ['read', 'write'],
 * });
 *
 * // Create convenience tokens
 * const adminToken = await factory.createAdminToken();
 * const userToken = await factory.createUserToken();
 * ```
 */
export class TestTokenFactory {
  private readonly issuer: string;
  private readonly audience: string;
  private privateKey: CryptoKeyLike | null = null;
  private publicKey: CryptoKeyLike | null = null;
  private jwk: JWK | null = null;
  private keyId: string;

  constructor(options: TokenFactoryOptions = {}) {
    this.issuer = options.issuer ?? 'https://test.frontmcp.local';
    this.audience = options.audience ?? 'frontmcp-test';
    this.keyId = `test-key-${Date.now()}`;
  }

  /**
   * Initialize the key pair (called automatically on first use)
   */
  private async ensureKeys(): Promise<void> {
    if (this.privateKey && this.publicKey) return;

    // Generate RSA key pair
    const { publicKey, privateKey } = await generateKeyPair('RS256', {
      extractable: true,
    });

    this.privateKey = privateKey;
    this.publicKey = publicKey;

    // Export public key as JWK
    this.jwk = await exportJWK(publicKey);
    this.jwk.kid = this.keyId;
    this.jwk.use = 'sig';
    this.jwk.alg = 'RS256';
  }

  /**
   * Create a JWT token with the specified claims
   */
  async createTestToken(options: CreateTokenOptions): Promise<string> {
    await this.ensureKeys();

    const now = Math.floor(Date.now() / 1000);
    const exp = options.exp ?? 3600;

    const payload: JWTPayload = {
      iss: options.iss ?? this.issuer,
      sub: options.sub,
      aud: options.aud ?? this.audience,
      iat: now,
      exp: now + exp,
      scope: options.scopes?.join(' '),
      ...options.claims,
    };

    if (!this.privateKey) {
      throw new Error('Private key not initialized');
    }

    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid: this.keyId })
      .sign(this.privateKey);

    return token;
  }

  /**
   * Create an admin token with full access
   */
  async createAdminToken(sub = 'admin-001'): Promise<string> {
    return this.createTestToken({
      sub,
      scopes: ['admin:*', 'read', 'write', 'delete'],
      claims: {
        email: 'admin@test.local',
        name: 'Test Admin',
        role: 'admin',
      },
    });
  }

  /**
   * Create a regular user token
   */
  async createUserToken(sub = 'user-001', scopes = ['read', 'write']): Promise<string> {
    return this.createTestToken({
      sub,
      scopes,
      claims: {
        email: 'user@test.local',
        name: 'Test User',
        role: 'user',
      },
    });
  }

  /**
   * Create an anonymous user token
   */
  async createAnonymousToken(): Promise<string> {
    return this.createTestToken({
      sub: `anon:${Date.now()}`,
      scopes: ['anonymous'],
      claims: {
        name: 'Anonymous',
        role: 'anonymous',
      },
    });
  }

  /**
   * Create an expired token (for testing token expiration)
   */
  async createExpiredToken(options: Pick<CreateTokenOptions, 'sub'>): Promise<string> {
    await this.ensureKeys();

    const now = Math.floor(Date.now() / 1000);

    const payload: JWTPayload = {
      iss: this.issuer,
      sub: options.sub,
      aud: this.audience,
      iat: now - 7200, // 2 hours ago
      exp: now - 3600, // Expired 1 hour ago
    };

    if (!this.privateKey) {
      throw new Error('Private key not initialized');
    }

    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid: this.keyId })
      .sign(this.privateKey);

    return token;
  }

  /**
   * Create a token with an invalid signature (for testing signature validation)
   */
  createTokenWithInvalidSignature(options: Pick<CreateTokenOptions, 'sub'>): string {
    const now = Math.floor(Date.now() / 1000);

    // Create a fake JWT with an invalid signature
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: this.keyId })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        iss: this.issuer,
        sub: options.sub,
        aud: this.audience,
        iat: now,
        exp: now + 3600,
      }),
    ).toString('base64url');

    // Invalid signature (just random bytes)
    const signature = Buffer.from('invalid-signature-' + Date.now()).toString('base64url');

    return `${header}.${payload}.${signature}`;
  }

  /**
   * Get the public JWKS for verifying tokens
   */
  async getPublicJwks(): Promise<{ keys: JWK[] }> {
    await this.ensureKeys();
    if (!this.jwk) {
      throw new Error('JWK not initialized');
    }
    return {
      keys: [this.jwk],
    };
  }

  /**
   * Get the issuer URL
   */
  getIssuer(): string {
    return this.issuer;
  }

  /**
   * Get the audience
   */
  getAudience(): string {
    return this.audience;
  }
}
