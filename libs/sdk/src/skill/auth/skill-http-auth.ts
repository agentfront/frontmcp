// file: libs/sdk/src/skill/auth/skill-http-auth.ts

/**
 * Authentication validation for skills HTTP endpoints.
 *
 * Supports multiple authentication modes:
 * - public: No authentication required
 * - api-key: API key in X-API-Key header or Authorization: ApiKey <key>
 * - bearer: JWT token validated against configured issuer using JWKS
 *
 * @module skill/auth/skill-http-auth
 */

import { timingSafeEqual } from '@frontmcp/utils';

import {
  authInfoFromAuthorization,
  isPublicMode,
  type FrontMcpLogger,
  type ScopeEntry,
  type ServerRequest,
} from '../../common';
import type { SkillsConfigOptions } from '../../common/types/options/skills-http';

/**
 * Request context for auth validation.
 */
export interface SkillHttpAuthContext {
  /** Request headers (lowercase keys) */
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Result of auth validation.
 */
export interface SkillHttpAuthResult {
  /** Whether the request is authorized */
  authorized: boolean;
  /** Error message if not authorized */
  error?: string;
  /** HTTP status code for the error response */
  statusCode?: number;
}

/**
 * Options for creating SkillHttpAuthValidator.
 */
export interface SkillHttpAuthValidatorOptions {
  /** Skills configuration with auth settings */
  skillsConfig: SkillsConfigOptions;
  /** Optional logger for debugging */
  logger?: FrontMcpLogger;
}

/**
 * Validator for skills HTTP endpoint authentication.
 *
 * Implements authentication validation based on SkillsConfigAuthMode:
 * - public: No validation, all requests pass
 * - api-key: Validates API key from X-API-Key header or Authorization: ApiKey <key>
 * - bearer: Validates JWT token using JWKS from configured issuer
 *
 * @example
 * ```typescript
 * const validator = new SkillHttpAuthValidator({
 *   skillsConfig: { auth: 'api-key', apiKeys: ['sk-xxx'] },
 *   logger,
 * });
 *
 * const result = await validator.validate({ headers: req.headers });
 * if (!result.authorized) {
 *   res.status(result.statusCode ?? 401).json({ error: result.error });
 *   return;
 * }
 * ```
 */
export class SkillHttpAuthValidator {
  private readonly skillsConfig: SkillsConfigOptions;
  private readonly logger?: FrontMcpLogger;

  constructor(options: SkillHttpAuthValidatorOptions) {
    this.skillsConfig = options.skillsConfig;
    this.logger = options.logger;
  }

  /**
   * Validate auth for a request.
   *
   * @param ctx - Request context with headers
   * @returns Auth result with authorized flag and optional error
   */
  async validate(ctx: SkillHttpAuthContext): Promise<SkillHttpAuthResult> {
    const mode = this.skillsConfig.auth ?? 'inherit';

    switch (mode) {
      case 'public':
        return { authorized: true };

      case 'inherit':
        // The server's own auth needs the whole request, not just headers: authorizeSkillHttpRequest()
        // applies it. Refuse here rather than let a caller of this validator serve the endpoint open.
        this.logger?.error(
          '"inherit" skills HTTP auth is applied by authorizeSkillHttpRequest(), not by this validator',
        );
        return { authorized: false, error: 'Server misconfiguration', statusCode: 500 };

      case 'api-key':
        return this.validateApiKey(ctx);

      case 'bearer':
        return this.validateBearer(ctx);

      default:
        this.logger?.error(`unknown skills HTTP auth mode "${String(mode)}"`);
        return { authorized: false, error: 'Server misconfiguration', statusCode: 500 };
    }
  }

  /**
   * Validate API key authentication.
   *
   * Accepts API key in:
   * - X-API-Key header
   * - Authorization header as `ApiKey <key>`
   *
   * Uses timing-safe comparison to prevent timing attacks.
   */
  private validateApiKey(ctx: SkillHttpAuthContext): SkillHttpAuthResult {
    const apiKeys = this.skillsConfig.apiKeys ?? [];

    if (apiKeys.length === 0) {
      this.logger?.error('api-key auth mode requires apiKeys to be configured');
      return {
        authorized: false,
        error: 'Server misconfiguration',
        statusCode: 500,
      };
    }

    // Get header values (case-insensitive)
    const authHeader = this.getHeader(ctx.headers, 'authorization');
    const apiKeyHeader = this.getHeader(ctx.headers, 'x-api-key');

    // Check X-API-Key header first using timing-safe comparison
    if (apiKeyHeader && this.timingSafeIncludes(apiKeys, apiKeyHeader)) {
      return { authorized: true };
    }

    // Check Authorization: ApiKey <key> format
    if (authHeader?.startsWith('ApiKey ')) {
      const key = authHeader.slice(7);
      if (this.timingSafeIncludes(apiKeys, key)) {
        return { authorized: true };
      }
    }

    return {
      authorized: false,
      error: 'Invalid or missing API key',
      statusCode: 401,
    };
  }

  /**
   * Check if any key in the list matches the candidate using timing-safe comparison.
   * This prevents timing attacks that could reveal information about valid API keys.
   */
  private timingSafeIncludes(keys: string[], candidate: string): boolean {
    const encoder = new TextEncoder();
    const candidateBytes = encoder.encode(candidate);

    // We must check all keys to ensure constant-time behavior
    // Even if we find a match, continue checking to prevent timing leaks
    let found = false;
    for (const key of keys) {
      const keyBytes = encoder.encode(key);
      // Only compare if lengths match (length difference is not timing-sensitive)
      if (keyBytes.length === candidateBytes.length) {
        try {
          if (timingSafeEqual(keyBytes, candidateBytes)) {
            found = true;
          }
        } catch {
          // Should not happen since we checked lengths, but handle gracefully
        }
      }
    }
    return found;
  }

  /**
   * Validate Bearer token (JWT) authentication.
   *
   * Uses JWKS from the configured issuer to validate the JWT.
   * Validates issuer and optionally audience claims. `exp` is required, as for
   * every other bearer token FrontMCP accepts: a token without it never expires.
   */
  private async validateBearer(ctx: SkillHttpAuthContext): Promise<SkillHttpAuthResult> {
    const jwtConfig = this.skillsConfig.jwt;

    if (!jwtConfig?.issuer) {
      this.logger?.error('bearer auth mode requires jwt.issuer to be configured');
      return {
        authorized: false,
        error: 'Server misconfiguration',
        statusCode: 500,
      };
    }

    const authHeader = this.getHeader(ctx.headers, 'authorization');

    if (!authHeader?.startsWith('Bearer ')) {
      return {
        authorized: false,
        error: 'Missing Bearer token',
        statusCode: 401,
      };
    }

    const token = authHeader.slice(7);

    try {
      // Lazy import jose to avoid bundling when not used
      const { jwtVerify, createRemoteJWKSet } = await import('jose');

      const jwksUrl = jwtConfig.jwksUrl ?? `${jwtConfig.issuer}/.well-known/jwks.json`;
      const JWKS = createRemoteJWKSet(new URL(jwksUrl));

      const { payload } = await jwtVerify(token, JWKS, {
        issuer: jwtConfig.issuer,
        audience: jwtConfig.audience,
        requiredClaims: ['exp'],
      });

      this.logger?.verbose('JWT validated successfully', { sub: payload.sub });
      return { authorized: true };
    } catch (error) {
      this.logger?.warn('JWT validation failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        authorized: false,
        error: 'Invalid JWT token',
        statusCode: 401,
      };
    }
  }

  /**
   * Get a header value from the headers object.
   * Performs case-insensitive header name lookup per HTTP spec.
   * Handles both string and string[] values.
   */
  private getHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
    const lowerName = name.toLowerCase();
    // Find the header key case-insensitively
    const key = Object.keys(headers).find((k) => k.toLowerCase() === lowerName);
    const value = key ? headers[key] : undefined;
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  }
}

/** The outcome of {@link authorizeSkillHttpRequest}. */
export type SkillHttpAccess =
  | {
      allowed: true;
      /** What the skill `authorities` are evaluated against; empty (anonymous) when nothing identifies the caller. */
      authInfo: Record<string, unknown>;
    }
  | { allowed: false; status: number; error: string; headers?: Record<string, string> };

/**
 * Decide whether a request may use the skills HTTP endpoints, by `skillsConfig.auth`:
 * - `'inherit'` (the default): the server's own auth, the same `session:verify` flow the MCP
 *   endpoint runs. A public server lets everyone in; any other mode needs the credential it
 *   asks for, and the verified caller's claims are what skill `authorities` are evaluated against.
 * - `'public'`: everyone, anonymously.
 * - `'api-key'` / `'bearer'`: the endpoint's own credential; skill `authorities` see an anonymous caller.
 *
 * @param scope - The scope serving the request; its auth options and `session:verify` flow apply for `'inherit'`
 * @param skillsConfig - The server's `skillsConfig`
 * @param request - The incoming HTTP request
 * @param logger - Optional logger
 * @returns Whether the request may proceed, with the caller's auth info, or the HTTP denial to send
 */
export async function authorizeSkillHttpRequest(
  scope: ScopeEntry,
  skillsConfig: SkillsConfigOptions | undefined,
  request: ServerRequest,
  logger?: FrontMcpLogger,
): Promise<SkillHttpAccess> {
  const mode = skillsConfig?.auth ?? 'inherit';

  if (mode === 'inherit') {
    const authOptions = scope.auth?.options;
    if (!authOptions || isPublicMode(authOptions)) return { allowed: true, authInfo: {} };

    const verified = await scope.runFlow('session:verify', { request: request as unknown as Record<string, unknown> });
    if (verified?.kind === 'authorized') {
      return { allowed: true, authInfo: { ...authInfoFromAuthorization(verified.authorization) } };
    }
    const challenge = verified?.prmMetadataHeader;
    const headers = challenge ? { 'WWW-Authenticate': challenge } : undefined;
    return verified?.kind === 'forbidden'
      ? { allowed: false, status: 403, error: 'Insufficient scope', headers }
      : { allowed: false, status: 401, error: 'Authentication required', headers };
  }

  const validator = createSkillHttpAuthValidator(skillsConfig, logger);
  if (!validator) return { allowed: true, authInfo: {} }; // auth: 'public'
  const result = await validator.validate({
    headers: request.headers as Record<string, string | string[] | undefined>,
  });
  return result.authorized
    ? { allowed: true, authInfo: {} }
    : { allowed: false, status: result.statusCode ?? 401, error: result.error ?? 'Unauthorized' };
}

/**
 * Create a skill HTTP auth validator from config.
 *
 * Returns null only for `auth: 'public'`. `'inherit'` (the default, also when `auth` is unset)
 * applies the server's own auth, which needs the whole request: use {@link authorizeSkillHttpRequest};
 * the validator returned for it refuses every request.
 *
 * Code that read a `null` validator as "no auth needed" (which `inherit` and an unset `auth` used to
 * return) must switch to {@link authorizeSkillHttpRequest}, which covers every mode:
 *
 * @example
 * ```typescript
 * const access = await authorizeSkillHttpRequest(scope, skillsConfig, request, logger);
 * if (!access.allowed) {
 *   return new Response(access.error, { status: access.status, headers: access.headers });
 * }
 * // access.authInfo is the verified caller, for evaluating skill `authorities`
 * ```
 *
 * @param skillsConfig - Skills configuration
 * @param logger - Optional logger
 * @returns Validator instance or null
 */
export function createSkillHttpAuthValidator(
  skillsConfig: SkillsConfigOptions | undefined,
  logger?: FrontMcpLogger,
): SkillHttpAuthValidator | null {
  if (skillsConfig?.auth === 'public') {
    return null; // No validation needed
  }

  return new SkillHttpAuthValidator({
    skillsConfig: { ...skillsConfig, auth: skillsConfig?.auth ?? 'inherit' },
    logger,
  });
}
