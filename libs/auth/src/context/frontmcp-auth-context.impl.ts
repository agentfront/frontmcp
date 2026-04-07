/**
 * FrontMcpAuthContextImpl — Concrete implementation of FrontMcpAuthContext.
 *
 * Takes raw auth info and an optional AuthoritiesClaimsMapping, resolves
 * roles/permissions using the same `resolveDotPath` utility used by the
 * authorities engine, and exposes convenience query methods.
 */

import type { AuthoritiesClaimsMapping } from '../authorities/authorities.profiles';
import { resolveDotPath } from '../authorities/authorities.context';
import type { FrontMcpAuthContext, FrontMcpAuthUser } from './frontmcp-auth-context';

/**
 * Minimal shape of incoming auth info that FrontMcpAuthContextImpl accepts.
 * Intentionally loose so it can accept both MCP SDK AuthInfo shapes and
 * FrontMCP's own future FrontMcpAuthInfo.
 */
export interface AuthContextSourceInfo {
  /** OAuth token (if present) */
  token?: string;
  /** Client ID */
  clientId?: string;
  /** OAuth scopes */
  scopes?: string[];
  /** Token expiry (epoch seconds) */
  expiresAt?: number;
  /** User object — shape varies by IdP */
  user?: {
    sub?: string;
    name?: string;
    email?: string;
    picture?: string;
    roles?: string[];
    permissions?: string[];
    [key: string]: unknown;
  };
  /** Session ID (string or nested object with `id` field) */
  sessionId?: string;
  /** Extended claims / metadata */
  extra?: Record<string, unknown>;
  /** Allow additional top-level keys for forward-compat */
  [key: string]: unknown;
}

/**
 * Coerce a value into a readonly string array.
 * Handles: string[] (filter non-strings), string (space-split), other (empty).
 */
function toStringArray(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  if (typeof value === 'string') {
    return value.split(/\s+/).filter(Boolean);
  }
  return [];
}

/**
 * Concrete implementation of {@link FrontMcpAuthContext}.
 *
 * Constructed via {@link buildAuthContext} factory — not intended for direct instantiation
 * by application code (though it is exported for testing purposes).
 */
export class FrontMcpAuthContextImpl implements FrontMcpAuthContext {
  readonly user: FrontMcpAuthUser;
  readonly isAnonymous: boolean;
  readonly mode: string;
  readonly sessionId: string;
  readonly scopes: readonly string[];
  readonly claims: Readonly<Record<string, unknown>>;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];

  constructor(
    source: AuthContextSourceInfo,
    claimsMapping?: AuthoritiesClaimsMapping,
  ) {
    // -- User identity -------------------------------------------------
    const rawUser = source.user ?? {};
    const sub = claimsMapping?.userId
      ? String(resolveDotPath(this.buildRawClaims(source), claimsMapping.userId) ?? rawUser.sub ?? '')
      : String(rawUser.sub ?? '');

    this.user = Object.freeze({
      sub,
      name: rawUser.name,
      email: rawUser.email,
      picture: rawUser.picture,
    });

    // -- Anonymous detection -------------------------------------------
    this.isAnonymous = sub === '' || sub.startsWith('anon:');

    // -- Mode ----------------------------------------------------------
    const extraAuth = source.extra?.['authorization'] as Record<string, unknown> | undefined;
    this.mode = String(
      source.extra?.['authMode'] ??
      extraAuth?.['mode'] ??
      (source.extra?.['isPublic'] === true || (rawUser as Record<string, unknown>)['anonymous'] === true ? 'public' : 'authenticated'),
    );

    // -- Session ID ----------------------------------------------------
    this.sessionId = typeof source.sessionId === 'string'
      ? source.sessionId
      : '';

    // -- Scopes --------------------------------------------------------
    this.scopes = Object.freeze(
      Array.isArray(source.scopes) ? source.scopes.filter((s): s is string => typeof s === 'string') : [],
    );

    // -- Claims --------------------------------------------------------
    const rawClaims = this.buildRawClaims(source);
    this.claims = Object.freeze({ ...rawClaims });

    // -- Roles ---------------------------------------------------------
    if (claimsMapping?.roles) {
      this.roles = Object.freeze([...toStringArray(resolveDotPath(rawClaims, claimsMapping.roles))]);
    } else {
      this.roles = Object.freeze([...toStringArray(
        (rawUser as Record<string, unknown>)['roles'] ??
        (extraAuth?.['scopes'] as unknown) ??
        [],
      )]);
    }

    // -- Permissions ---------------------------------------------------
    if (claimsMapping?.permissions) {
      this.permissions = Object.freeze([...toStringArray(resolveDotPath(rawClaims, claimsMapping.permissions))]);
    } else {
      this.permissions = Object.freeze([...toStringArray(
        (rawUser as Record<string, unknown>)['permissions'] ?? [],
      )]);
    }
  }

  // -- Query methods -------------------------------------------------

  hasRole(role: string): boolean {
    return this.roles.includes(role);
  }

  hasPermission(permission: string): boolean {
    return this.permissions.includes(permission);
  }

  hasScope(scope: string): boolean {
    return this.scopes.includes(scope);
  }

  hasAllScopes(scopes: readonly string[]): boolean {
    return scopes.every((s) => this.scopes.includes(s));
  }

  // -- Internal helpers ----------------------------------------------

  /**
   * Build the merged raw claims map from user fields + extra.authorization.claims.
   * Mirrors the logic in AuthoritiesContextBuilder.build().
   */
  private buildRawClaims(source: AuthContextSourceInfo): Record<string, unknown> {
    const rawUser = source.user ?? {};
    const extraAuth = source.extra?.['authorization'] as Record<string, unknown> | undefined;
    const authorizationClaims = (extraAuth?.['claims'] as Record<string, unknown>) ?? {};
    return {
      ...authorizationClaims,
      ...rawUser,
    };
  }
}
