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

import type { FrontMcpLogger } from '../../common';
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
        // inherit means use server's default auth - flows handle this
        return { authorized: true };

      case 'api-key':
        return this.validateApiKey(ctx);

      case 'bearer':
        return this.validateBearer(ctx);

      default:
        // Unknown mode - default to allowed (inherit behavior)
        return { authorized: true };
    }
  }

  /**
   * Validate API key authentication.
   *
   * Accepts API key in:
   * - X-API-Key header
   * - Authorization header as `ApiKey <key>`
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

    // Check X-API-Key header first
    if (apiKeyHeader && apiKeys.includes(apiKeyHeader)) {
      return { authorized: true };
    }

    // Check Authorization: ApiKey <key> format
    if (authHeader?.startsWith('ApiKey ')) {
      const key = authHeader.slice(7);
      if (apiKeys.includes(key)) {
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
   * Validate Bearer token (JWT) authentication.
   *
   * Uses JWKS from the configured issuer to validate the JWT.
   * Validates issuer and optionally audience claims.
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
   * Handles both string and string[] values.
   */
  private getHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
    const value = headers[name] ?? headers[name.toLowerCase()];
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  }
}

/**
 * Create a skill HTTP auth validator from config.
 *
 * Returns null if no validation is needed (public or inherit mode).
 *
 * @param skillsConfig - Skills configuration
 * @param logger - Optional logger
 * @returns Validator instance or null
 */
export function createSkillHttpAuthValidator(
  skillsConfig: SkillsConfigOptions | undefined,
  logger?: FrontMcpLogger,
): SkillHttpAuthValidator | null {
  if (!skillsConfig?.auth || skillsConfig.auth === 'public' || skillsConfig.auth === 'inherit') {
    return null; // No validation needed
  }

  return new SkillHttpAuthValidator({ skillsConfig, logger });
}
