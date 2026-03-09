// auth/jwks/jwks.service.ts
import { jwtVerify, createLocalJWKSet, decodeProtectedHeader, JSONWebKeySet, JWK } from 'jose';
import { bytesToHex, randomBytes, rsaVerify, createKeyPersistence, KeyPersistence } from '@frontmcp/utils';
import { JwksServiceOptions, ProviderVerifyRef, VerifyResult } from './jwks.types';
import { normalizeIssuer, trimSlash, decodeJwtPayloadSafe } from './jwks.utils';
import type { AuthLogger } from '../common/auth-logger.interface';
import { noopAuthLogger } from '../common/auth-logger.interface';

// Warning message for weak RSA keys (shown only once per provider)
const WEAK_KEY_WARNING = `
⚠️  SECURITY WARNING: OAuth provider is using an RSA key smaller than 2048 bits.
    This is considered insecure and should be updated.
    Please contact your OAuth provider to upgrade their signing keys.
    Verification will proceed but with reduced security guarantees.
`;

export class JwksService {
  private readonly opts: Required<Omit<JwksServiceOptions, 'logger'>>;

  private readonly logger: AuthLogger;
  private warnedProviders = new Set<string>();

  // Orchestrator signing material
  private orchestratorKey!: {
    kid: string;
    privateKey: import('node:crypto').KeyObject;
    publicJwk: JSONWebKeySet;
    createdAt: number;
  };

  // Provider JWKS cache (providerId -> jwks + fetchedAt)
  private providerJwks = new Map<string, { jwks: JSONWebKeySet; fetchedAt: number }>();

  // Track if key has been initialized (for async loading)
  private keyInitialized = false;
  // Promise guard to prevent concurrent key generation
  private keyInitPromise: Promise<void> | undefined;
  // KeyPersistence instance for unified key storage
  private keyPersistence?: KeyPersistence;

  constructor(opts?: JwksServiceOptions) {
    this.logger = opts?.logger ?? noopAuthLogger;
    this.opts = {
      orchestratorAlg: opts?.orchestratorAlg ?? 'RS256',
      rotateDays: opts?.rotateDays ?? 30,
      providerJwksTtlMs: opts?.providerJwksTtlMs ?? 6 * 60 * 60 * 1000, // 6h
      networkTimeoutMs: opts?.networkTimeoutMs ?? 5000, // 5s
    };
  }

  // ===========================================================================
  // Key Persistence Helpers
  // ===========================================================================

  /**
   * Check if key persistence should be enabled.
   * Enabled in development by default, disabled in production unless forceEnable.
   */
  private shouldEnablePersistence(): boolean {
    const isProd = process.env['NODE_ENV'] === 'production';
    return !isProd;
  }

  /**
   * Get or create the KeyPersistence instance.
   * Returns null if persistence is disabled.
   */
  private async getKeyPersistence(): Promise<KeyPersistence | null> {
    if (!this.shouldEnablePersistence()) return null;
    if (!this.keyPersistence) {
      this.keyPersistence = await createKeyPersistence({
        baseDir: '.frontmcp/keys',
      });
    }
    return this.keyPersistence;
  }

  // ===========================================================================
  // Public JWKS (what /.well-known/jwks.json serves)
  // ===========================================================================

  /** Gateway's public JWKS (publish at /.well-known/jwks.json when orchestrated). */
  async getPublicJwks(): Promise<JSONWebKeySet> {
    return this.getOrchestratorJwks();
  }

  // ===========================================================================
  // Scope-aware verification API
  // ===========================================================================

  /** Verify a token issued by the gateway itself (orchestrated mode). */
  async verifyGatewayToken(token: string, expectedIssuer: string): Promise<VerifyResult> {
    try {
      // TODO: add support for local/remote proxy mode
      //       current implementation for anonymous mode only

      // const jwks = this.getPublicJwks();
      // const JWKS = createLocalJWKSet(jwks);
      // const {payload, protectedHeader} = await jwtVerify(token, JWKS, {
      //   issuer: normalizeIssuer(expectedIssuer),
      // });
      // return {
      //   ok: true,
      //   issuer: payload?.iss as string | undefined,
      //   sub: payload?.sub as string | undefined,
      //   header: protectedHeader,
      //   payload,
      // };

      const payload = decodeJwtPayloadSafe(token);
      if (!payload) {
        return {
          ok: false,
          error: 'invalid bearer token',
        };
      }
      return {
        ok: true,
        issuer: expectedIssuer,
        sub: payload['sub'] as string,
        payload,
        header: decodeProtectedHeader(token),
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'verification_failed';
      return { ok: false, error: message };
    }
  }

  /**
   * Verify a token against candidate transparent providers.
   * Ensures JWKS are available (cached/TTL/AS discovery) per provider.
   */
  async verifyTransparentToken(token: string, candidates: ProviderVerifyRef[]): Promise<VerifyResult> {
    if (!candidates?.length) return { ok: false, error: 'no_providers' };

    // Helpful only for error messages
    let kid: string | undefined;
    try {
      const header = decodeProtectedHeader(token);

      kid = typeof header?.kid === 'string' ? header.kid : undefined;
    } catch {
      /* empty */
    }

    for (const p of candidates) {
      let jwks: JSONWebKeySet | undefined;
      try {
        jwks = await this.getJwksForProvider(p);
        if (!jwks?.keys?.length) continue;
        const draftPayload = decodeJwtPayloadSafe(token);
        const JWKS = createLocalJWKSet(jwks);
        const { payload, protectedHeader } = await jwtVerify(token, JWKS, {
          issuer: [normalizeIssuer(p.issuerUrl)].concat(
            (draftPayload?.['iss'] ? [draftPayload['iss']] : []) as string[],
          ), // used because current cloud gateway have invalid issuer
        });

        return {
          ok: true,
          issuer: payload?.iss as string | undefined,
          sub: payload?.sub as string | undefined,
          providerId: p.id,
          header: protectedHeader,
          payload,
        };
      } catch (e: unknown) {
        // Check for weak RSA key error from jose library
        if (this.isWeakKeyError(e)) {
          const fallbackJwks = jwks ?? (await this.getJwksForProvider(p));
          if (fallbackJwks?.keys?.length) {
            const fallbackResult = await this.verifyWithWeakKey(token, fallbackJwks, p);
            if (fallbackResult.ok) {
              return fallbackResult;
            }
          }
        }
        this.logger.debug('[JwksService] Failed to verify token for provider: %s', p.id, e);
        // try next provider
      }
    }

    return { ok: false, error: `no_provider_verified${kid ? ` (kid=${kid})` : ''}` };
  }

  /**
   * Check if the error is due to weak RSA key (< 2048 bits)
   */
  private isWeakKeyError(error: unknown): boolean {
    // NOTE: This is a best-effort fallback keyed off `jose` error message text.
    // If `jose` changes this message format in a future major version, update this matcher and its tests.
    const message =
      typeof error === 'object' &&
      error !== null &&
      'message' in error &&
      typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : String(error);
    return message.includes('modulusLength') && message.includes('2048');
  }

  /**
   * Fallback verification for providers using RSA keys smaller than 2048 bits.
   * Logs a security warning but allows verification to proceed.
   */
  private async verifyWithWeakKey(
    token: string,
    jwks: JSONWebKeySet,
    provider: ProviderVerifyRef,
  ): Promise<VerifyResult> {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return { ok: false, error: 'invalid_token_format' };
      }

      const [headerB64, payloadB64, signatureB64] = parts;
      const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));

      // Find matching key
      const matchingKey = this.findMatchingKey(jwks, header);
      if (!matchingKey) {
        return { ok: false, error: 'no_matching_key' };
      }

      // Verify signature using Node's crypto (via @frontmcp/utils).
      // NOTE: This fallback intentionally duplicates a small subset of `jose` verification behavior (tested with `jose@^6`).
      // - `jose` rejects weak RSA keys (<2048) by design; this provides a controlled fallback for OAuth providers still using smaller keys.
      // - RSA-PSS verification requires explicit padding/saltLength options (not supported via digest names like "RSA-PSS-SHA256").
      const signatureInput = `${headerB64}.${payloadB64}`;
      const signature = Buffer.from(signatureB64, 'base64url');

      const jwtAlg = typeof header.alg === 'string' ? header.alg : undefined;
      if (!jwtAlg) {
        return { ok: false, error: 'missing_alg' };
      }

      const isValid = rsaVerify(jwtAlg, Buffer.from(signatureInput), matchingKey as unknown as JsonWebKey, signature);

      if (!isValid) {
        return { ok: false, error: 'signature_invalid' };
      }

      // Validate issuer
      const payloadIssuerRaw = typeof payload.iss === 'string' ? payload.iss : undefined;
      if (!payloadIssuerRaw) {
        return { ok: false, error: 'issuer_mismatch' };
      }
      const trustedIssuers = new Set([normalizeIssuer(provider.issuerUrl)]);
      const payloadIssuer = normalizeIssuer(payloadIssuerRaw);
      if (!trustedIssuers.has(payloadIssuer)) {
        return { ok: false, error: 'issuer_mismatch' };
      }

      // Check expiration
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        return { ok: false, error: 'token_expired' };
      }

      // Emit warning (once per provider)
      if (!this.warnedProviders.has(provider.id)) {
        this.warnedProviders.add(provider.id);
        this.logger.warn(WEAK_KEY_WARNING);
        this.logger.warn('    Provider: %s (%s)', provider.id, provider.issuerUrl);
      }

      return {
        ok: true,
        issuer: payload.iss as string | undefined,
        sub: payload.sub as string | undefined,
        providerId: provider.id,
        header,
        payload,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown';
      return { ok: false, error: `weak_key_verification_failed: ${message}` };
    }
  }

  /**
   * Find a matching key from JWKS based on token header
   */
  private findMatchingKey(jwks: JSONWebKeySet, header: { kid?: string; alg?: string }): JWK | undefined {
    // First try exact kid match
    if (header.kid) {
      const byKid = jwks.keys.find((k) => k.kid === header.kid);
      if (byKid) return byKid;
    }

    // Fall back to matching by algorithm
    if (header.alg) {
      const byAlg = jwks.keys.find((k) => k.alg === header.alg || (k.kty === 'RSA' && header.alg?.startsWith('RS')));
      if (byAlg) return byAlg;
    }

    // Last resort: return first RSA key
    return jwks.keys.find((k) => k.kty === 'RSA');
  }

  // ===========================================================================
  // Provider JWKS (cache + preload + discovery)
  // ===========================================================================

  /** Directly set provider JWKS (e.g., inline keys from config). */
  setProviderJwks(providerId: string, jwks: JSONWebKeySet) {
    this.providerJwks.set(providerId, { jwks, fetchedAt: Date.now() });
  }

  /**
   * Ensure JWKS for a provider:
   *   1) inline jwks (if provided) → cache & return
   *   2) cached & fresh (TTL)      → return
   *   3) explicit jwksUri          → fetch, cache, return
   *   4) discover jwks_uri via AS  → fetch AS metadata, then jwks_uri, cache, return
   */
  async getJwksForProvider(ref: ProviderVerifyRef): Promise<JSONWebKeySet | undefined> {
    // Inline keys win
    if (ref.jwks?.keys?.length) {
      this.setProviderJwks(ref.id, ref.jwks);
      return ref.jwks;
    }

    // Cache hit and fresh?
    const cached = this.providerJwks.get(ref.id);
    if (cached && Date.now() - cached.fetchedAt < this.opts.providerJwksTtlMs) {
      return cached.jwks;
    }

    // If we have a jwksUri, try it
    if (ref.jwksUri) {
      const fromUri = await this.tryFetchJwks(ref.id, ref.jwksUri);
      if (fromUri?.keys?.length) return fromUri;
    }

    // Discover via AS .well-known
    const issuer = trimSlash(ref.issuerUrl);
    const meta = await this.tryFetchAsMeta(`${issuer}/.well-known/oauth-authorization-server`);
    const uri = meta && typeof meta === 'object' && meta['jwks_uri'] ? String(meta['jwks_uri']) : undefined;
    if (uri) {
      const fromMeta = await this.tryFetchJwks(ref.id, uri);
      if (fromMeta?.keys?.length) return fromMeta;
    }

    return cached?.jwks; // return stale if we had anything, else undefined
  }

  // ===========================================================================
  // Orchestrator keys (generation/rotation)
  // ===========================================================================

  /** Return the orchestrator public JWKS (generates/rotates as needed). */
  async getOrchestratorJwks(): Promise<JSONWebKeySet> {
    await this.ensureOrchestratorKey();
    return this.orchestratorKey.publicJwk;
  }

  /** Return private signing key + kid for issuing orchestrator tokens. */
  async getOrchestratorSigningKey(): Promise<{ kid: string; key: import('node:crypto').KeyObject; alg: string }> {
    await this.ensureOrchestratorKey();
    return { kid: this.orchestratorKey.kid, key: this.orchestratorKey.privateKey, alg: this.opts.orchestratorAlg };
  }

  // ===========================================================================
  // Internals (fetch, rotation, helpers)
  // ===========================================================================

  private async tryFetchJwks(providerId: string, uri: string): Promise<JSONWebKeySet | undefined> {
    try {
      const jwks = await this.fetchJson<JSONWebKeySet>(uri);
      if (jwks?.keys?.length) {
        this.setProviderJwks(providerId, jwks);
        return jwks;
      }
    } catch {
      /* empty */
    }
    return undefined;
  }

  private async tryFetchAsMeta(url: string): Promise<Record<string, unknown> | undefined> {
    try {
      return await this.fetchJson(url);
    } catch {
      return undefined;
    }
  }

  private async fetchJson<T = unknown>(url: string): Promise<T> {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
    const timer = setTimeout(() => ctl?.abort(), this.opts.networkTimeoutMs);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: ctl?.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private async ensureOrchestratorKey() {
    const now = Date.now();
    const maxAge = this.opts.rotateDays * 24 * 60 * 60 * 1000;

    // If key exists and not expired, use it
    if (this.orchestratorKey && now - this.orchestratorKey.createdAt <= maxAge) {
      return;
    }

    // Use promise guard to prevent concurrent key generation (race condition fix)
    if (this.keyInitPromise) {
      await this.keyInitPromise;
      return;
    }

    // Create promise guard and initialize key
    this.keyInitPromise = this.initializeOrchestratorKey(now, maxAge);
    try {
      await this.keyInitPromise;
    } finally {
      // Clear promise guard after initialization to allow future rotation
      this.keyInitPromise = undefined;
    }
  }

  private async initializeOrchestratorKey(now: number, maxAge: number) {
    // Try to load persisted key (in development mode)
    const persistence = await this.getKeyPersistence();

    if (persistence && !this.keyInitialized) {
      this.keyInitialized = true;
      const loaded = await persistence.getAsymmetric('jwks-orchestrator');

      if (loaded && now - loaded.createdAt <= maxAge) {
        // Validate algorithm matches config
        if (loaded.alg !== this.opts.orchestratorAlg) {
          this.logger.warn(
            "[JwksService] Persisted key algorithm (%s) doesn't match config (%s), generating new key",
            loaded.alg,
            this.opts.orchestratorAlg,
          );
        } else {
          // Reconstruct KeyObject from JWK
          try {
            const { createPrivateKey } = require('node:crypto') as typeof import('node:crypto');
            const privateKey = createPrivateKey({
              key: loaded.privateKey as import('node:crypto').JsonWebKey,
              format: 'jwk',
            });
            this.orchestratorKey = {
              kid: loaded.kid,
              privateKey,
              publicJwk: loaded.publicJwk,
              createdAt: loaded.createdAt,
            };
            return;
          } catch (error) {
            this.logger.warn(
              '[JwksService] Failed to load persisted key: %s, generating new key',
              (error as Error).message,
            );
          }
        }
      }
    }

    // Generate new key
    this.orchestratorKey = this.generateKey(this.opts.orchestratorAlg);
    this.keyInitialized = true;

    // Save if persistence enabled
    if (persistence) {
      try {
        await persistence.set({
          type: 'asymmetric',
          kid: this.orchestratorKey.kid,
          alg: this.opts.orchestratorAlg,
          privateKey: this.orchestratorKey.privateKey.export({ format: 'jwk' }) as JsonWebKey,
          publicJwk: this.orchestratorKey.publicJwk,
          createdAt: this.orchestratorKey.createdAt,
          version: 1,
        });
      } catch (error) {
        this.logger.warn('[JwksService] Failed to persist dev key: %s', (error as Error).message);
      }
    }
  }

  private generateKey(alg: 'RS256' | 'ES256') {
    const { generateKeyPairSync } = require('node:crypto') as typeof import('node:crypto');
    if (alg === 'RS256') {
      const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const kid = bytesToHex(randomBytes(8));
      const publicJwk = publicKey.export({ format: 'jwk' });
      Object.assign(publicJwk, { kid, alg: 'RS256', use: 'sig', kty: 'RSA' });
      return { kid, privateKey, publicJwk: { keys: [publicJwk] }, createdAt: Date.now() };
    } else {
      const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const kid = bytesToHex(randomBytes(8));
      const publicJwk = publicKey.export({ format: 'jwk' });
      Object.assign(publicJwk, { kid, alg: 'ES256', use: 'sig', kty: 'EC' });
      return { kid, privateKey, publicJwk: { keys: [publicJwk] }, createdAt: Date.now() };
    }
  }
}
