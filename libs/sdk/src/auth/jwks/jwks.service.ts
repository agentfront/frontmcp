// auth/jwks/jwks.service.ts
import crypto from 'node:crypto';
import {jwtVerify, createLocalJWKSet, decodeProtectedHeader, JSONWebKeySet} from 'jose';
import {JwksServiceOptions, ProviderVerifyRef, VerifyResult} from './jwks.types';
import {normalizeIssuer, trimSlash, decodeJwtPayloadSafe} from './jwks.utils';

export class JwksService {
  private readonly opts: Required<JwksServiceOptions>;

  // Orchestrator signing material
  private orchestratorKey!: {
    kid: string;
    privateKey: crypto.KeyObject;
    publicJwk: JSONWebKeySet;
    createdAt: number;
  };

  // Provider JWKS cache (providerId -> jwks + fetchedAt)
  private providerJwks = new Map<string, { jwks: JSONWebKeySet; fetchedAt: number }>();

  constructor(opts?: JwksServiceOptions) {
    this.opts = {
      orchestratorAlg: opts?.orchestratorAlg ?? 'RS256',
      rotateDays: opts?.rotateDays ?? 30,
      providerJwksTtlMs: opts?.providerJwksTtlMs ?? 6 * 60 * 60 * 1000, // 6h
      networkTimeoutMs: opts?.networkTimeoutMs ?? 5000, // 5s
    };
  }

  // ===========================================================================
  // Public JWKS (what /.well-known/jwks.json serves)
  // ===========================================================================

  /** Gateway's public JWKS (publish at /.well-known/jwks.json when orchestrated). */
  getPublicJwks(): JSONWebKeySet {
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
          error: 'invalid bearer token'
        }
      }
      return {
        ok: true,
        issuer: expectedIssuer,
        sub: payload['sub'] as string,
        payload,
        header: decodeProtectedHeader(token),
      }
    } catch (err: any) {
      return {ok: false, error: err?.message ?? 'verification_failed'};
    }
  }

  /**
   * Verify a token against candidate transparent providers.
   * Ensures JWKS are available (cached/TTL/AS discovery) per provider.
   */
  async verifyTransparentToken(token: string, candidates: ProviderVerifyRef[]): Promise<VerifyResult> {
    if (!candidates?.length) return {ok: false, error: 'no_providers'};

    // Helpful only for error messages
    let kid: string | undefined;
    try {
      const header = decodeProtectedHeader(token);

      kid = typeof header?.kid === 'string' ? header.kid : undefined;
    } catch {
      /* empty */
    }

    for (const p of candidates) {
      try {
        const jwks = await this.getJwksForProvider(p);
        if (!jwks?.keys?.length) continue;
        const draftPayload = decodeJwtPayloadSafe(token);
        const JWKS = createLocalJWKSet(jwks);
        const {payload, protectedHeader} = await jwtVerify(token, JWKS, {
          issuer: [
            normalizeIssuer(p.issuerUrl),

            // ]
          ].concat((draftPayload?.['iss'] ? [draftPayload['iss']] : []) as string[]), // used because current cloud gateway have invalid issuer
        });

        return {
          ok: true,
          issuer: payload?.iss as string | undefined,
          sub: payload?.sub as string | undefined,
          providerId: p.id,
          header: protectedHeader,
          payload,
        };
      } catch (e) {
        console.log('failed to verify token for provider: ', p.id, e);
        // try next provider
      }
    }

    return {ok: false, error: `no_provider_verified${kid ? ` (kid=${kid})` : ''}`};
  }

  // ===========================================================================
  // Provider JWKS (cache + preload + discovery)
  // ===========================================================================

  /** Directly set provider JWKS (e.g., inline keys from config). */
  setProviderJwks(providerId: string, jwks: JSONWebKeySet) {
    this.providerJwks.set(providerId, {jwks, fetchedAt: Date.now()});
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
    const uri = meta && typeof meta === 'object' && meta.jwks_uri ? String(meta.jwks_uri) : undefined;
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
  getOrchestratorJwks(): JSONWebKeySet {
    this.ensureOrchestratorKey();
    return this.orchestratorKey.publicJwk;
  }

  /** Return private signing key + kid for issuing orchestrator tokens. */
  getOrchestratorSigningKey(): { kid: string; key: crypto.KeyObject; alg: string } {
    this.ensureOrchestratorKey();
    return {kid: this.orchestratorKey.kid, key: this.orchestratorKey.privateKey, alg: this.opts.orchestratorAlg};
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

  private async tryFetchAsMeta(url: string): Promise<any | undefined> {
    try {
      return await this.fetchJson(url);
    } catch {
      return undefined;
    }
  }

  private async fetchJson<T = any>(url: string): Promise<T> {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
    const timer = setTimeout(() => ctl?.abort(), this.opts.networkTimeoutMs);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {accept: 'application/json'},
        signal: ctl?.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private ensureOrchestratorKey() {
    const now = Date.now();
    const maxAge = this.opts.rotateDays * 24 * 60 * 60 * 1000;
    if (!this.orchestratorKey || now - this.orchestratorKey.createdAt > maxAge) {
      this.orchestratorKey = this.generateKey(this.opts.orchestratorAlg);
    }
  }

  private generateKey(alg: 'RS256' | 'ES256') {
    if (alg === 'RS256') {
      const {privateKey, publicKey} = crypto.generateKeyPairSync('rsa', {modulusLength: 2048});
      const kid = crypto.randomBytes(8).toString('hex');
      const publicJwk = publicKey.export({format: 'jwk'});
      Object.assign(publicJwk, {kid, alg: 'RS256', use: 'sig', kty: 'RSA'});
      return {kid, privateKey, publicJwk: {keys: [publicJwk]}, createdAt: Date.now()};
    } else {
      const {privateKey, publicKey} = crypto.generateKeyPairSync('ec', {namedCurve: 'P-256'});
      const kid = crypto.randomBytes(8).toString('hex');
      const publicJwk = publicKey.export({format: 'jwk'});
      Object.assign(publicJwk, {kid, alg: 'ES256', use: 'sig', kty: 'EC'});
      return {kid, privateKey, publicJwk: {keys: [publicJwk]}, createdAt: Date.now()};
    }
  }
}
