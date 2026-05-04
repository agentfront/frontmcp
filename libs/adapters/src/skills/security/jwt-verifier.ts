// file: plugins/plugin-skilled-openapi/src/security/jwt-verifier.ts
//
// Bundle-push channel JWT verifier. Wraps libs/auth's JwksService and adds
// the RFC 8707 / 2026-03-15 MCP-spec checks the spec mandates:
//
//   - `aud` must match the configured bundleId / audience
//   - `resource` claim (RFC 8707) must match the configured FrontMCP resource
//   - issuer must match `expectedIssuer`
//   - optional role claim must include `frontmcp:cloud:push` (or whatever
//     scope the customer's deployment requires)
//
// Verification produces a structured result; callers (the SaaS-pull source
// and the future webhook route) MUST refuse on `ok: false`.

import { JwksService, type ProviderVerifyRef, type VerifyResult } from '@frontmcp/auth';
import type { FrontMcpLogger } from '@frontmcp/sdk';

export interface BundlePushJwtVerifierOptions {
  /** SaaS issuer URL (matched against `iss`). */
  expectedIssuer: string;
  /** Audience the token must encode (RFC 8707 `aud` claim). */
  expectedAudience: string;
  /**
   * RFC 8707 resource indicator the token must encode (matches the FrontMCP
   * server's canonical URL). MCP spec 2026-03-15 mandates this on every JWT.
   */
  expectedResource: string;
  /** JWKS endpoint URL of the SaaS issuer. */
  jwksUri: string;
  /** Required role claim values; the token must contain at least one. */
  requiredRoles?: string[];
  /** Required scope claim values; the token must contain at least one. */
  requiredScopes?: string[];
}

export interface PushJwtVerifyResult {
  ok: boolean;
  reason?: string;
  payload?: Record<string, unknown>;
}

const DEFAULT_REQUIRED_ROLES = ['frontmcp:cloud:push'];

export class BundlePushJwtVerifier {
  private readonly providerRef: ProviderVerifyRef;
  private readonly jwks: JwksService;

  constructor(
    private readonly options: BundlePushJwtVerifierOptions,
    private readonly logger: FrontMcpLogger,
    jwks?: JwksService,
  ) {
    this.jwks = jwks ?? new JwksService({});
    this.providerRef = {
      id: 'skilled-openapi-cloud-push',
      issuerUrl: options.expectedIssuer,
      jwksUri: options.jwksUri,
    };
  }

  /**
   * Verify a SaaS-issued bearer token. Returns ok=true only if signature,
   * issuer, audience, RFC 8707 resource indicator, and role claims all check.
   */
  async verify(token: string): Promise<PushJwtVerifyResult> {
    if (!token || typeof token !== 'string') {
      return { ok: false, reason: 'token missing' };
    }

    let res: VerifyResult;
    try {
      res = await this.jwks.verifyTransparentToken(token, [this.providerRef]);
    } catch (e) {
      this.logger.debug(`[skilled-openapi] jwt verify threw: ${(e as Error).message}`);
      return { ok: false, reason: `verify failed: ${(e as Error).message}` };
    }
    if (!res.ok || !res.payload) {
      return { ok: false, reason: res.error ?? 'signature verify failed' };
    }

    const payload = res.payload;

    // Audience: support both string and string[] per RFC 7519.
    const aud = payload['aud'];
    const audValues = Array.isArray(aud) ? aud : aud !== undefined ? [aud] : [];
    if (!audValues.includes(this.options.expectedAudience)) {
      return { ok: false, reason: `aud mismatch (expected "${this.options.expectedAudience}")` };
    }

    // RFC 8707 resource indicator: same encoding (single string or string[]).
    const resource = payload['resource'];
    const resValues = Array.isArray(resource) ? resource : resource !== undefined ? [resource] : [];
    if (!resValues.includes(this.options.expectedResource)) {
      return {
        ok: false,
        reason: `RFC 8707 resource indicator mismatch (expected "${this.options.expectedResource}")`,
      };
    }

    // Roles: support `roles` claim (array or space-delimited string).
    const requiredRoles = this.options.requiredRoles ?? DEFAULT_REQUIRED_ROLES;
    if (requiredRoles.length > 0 && !this.matchesAny(payload['roles'], requiredRoles)) {
      return { ok: false, reason: `missing required role (need one of ${requiredRoles.join(', ')})` };
    }

    // Scopes: optional second gate.
    if (this.options.requiredScopes && this.options.requiredScopes.length > 0) {
      if (!this.matchesAny(payload['scope'] ?? payload['scp'], this.options.requiredScopes)) {
        return {
          ok: false,
          reason: `missing required scope (need one of ${this.options.requiredScopes.join(', ')})`,
        };
      }
    }

    return { ok: true, payload };
  }

  private matchesAny(claim: unknown, required: string[]): boolean {
    const have: string[] = Array.isArray(claim)
      ? claim.filter((v): v is string => typeof v === 'string')
      : typeof claim === 'string'
        ? claim.split(/\s+/).filter(Boolean)
        : [];
    return required.some((r) => have.includes(r));
  }
}
