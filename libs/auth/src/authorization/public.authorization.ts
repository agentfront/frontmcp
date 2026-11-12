// auth/authorization/public.authorization.ts

import { randomUUID } from '@frontmcp/utils';

import { TokenNotAvailableError } from '../errors/auth-internal.errors';
import { AuthorizationBase } from './authorization.class';
import type { AuthMode, AuthorizationCreateCtx, AuthUser } from './authorization.types';

/**
 * Context for creating a PublicAuthorization
 */
export interface PublicAuthorizationCreateCtx {
  /**
   * Anonymous user's identifier prefix
   * @default 'anon'
   */
  prefix?: string;

  /**
   * Anonymous scopes granted to the user
   * @default ['anonymous']
   */
  scopes?: string[];

  /**
   * Session TTL in milliseconds
   * @default 3600000 (1 hour)
   */
  ttlMs?: number;

  /**
   * Issuer identifier for the anonymous JWT
   */
  issuer?: string;

  /**
   * Allowed tools for anonymous access
   * If 'all', all tools are allowed
   */
  allowedTools?: 'all' | string[];

  /**
   * Allowed prompts for anonymous access
   * If 'all', all prompts are allowed
   */
  allowedPrompts?: 'all' | string[];
}

/**
 * PublicAuthorization - Authorization for public/anonymous access mode
 *
 * In public mode:
 * - No authentication is required
 * - Anonymous sessions are auto-generated
 * - getToken() throws - anonymous users cannot access provider tokens
 * - Ideal for development, docs, public wikis, and read-only resources
 */
export class PublicAuthorization extends AuthorizationBase {
  readonly mode: AuthMode = 'public';

  /**
   * Issuer identifier for the anonymous authorization
   */
  readonly issuer?: string;

  readonly #allTools: boolean;
  readonly #allPrompts: boolean;

  private constructor(ctx: AuthorizationCreateCtx & { issuer?: string; allTools: boolean; allPrompts: boolean }) {
    super(ctx);
    this.issuer = ctx.issuer;
    this.#allTools = ctx.allTools;
    this.#allPrompts = ctx.allPrompts;
  }

  /**
   * Create a new PublicAuthorization for anonymous access
   *
   * @param ctx - Creation context with optional configuration
   * @returns A new PublicAuthorization instance
   *
   * @example
   * ```typescript
   * const auth = PublicAuthorization.create({
   *   scopes: ['read', 'anonymous'],
   *   ttlMs: 3600000,
   *   allowedTools: ['search', 'get-docs'],
   * });
   * ```
   */
  static create(ctx: PublicAuthorizationCreateCtx = {}): PublicAuthorization {
    const {
      prefix = 'anon',
      scopes = ['anonymous'],
      ttlMs = 3600000, // 1 hour default
      issuer,
      allowedTools = 'all',
      allowedPrompts = 'all',
    } = ctx;

    // Generate anonymous user identity
    const uuid = randomUUID();
    const sub = `${prefix}:${uuid}`;

    const user: AuthUser = {
      sub,
      name: 'Anonymous',
      anonymous: true,
    };

    // Calculate expiration
    const expiresAt = ttlMs ? Date.now() + ttlMs : undefined;

    // Build authorized tools map
    const authorizedTools: AuthorizationCreateCtx['authorizedTools'] = {};
    const authorizedToolIds: string[] = [];
    if (allowedTools !== 'all' && Array.isArray(allowedTools)) {
      for (const toolId of allowedTools) {
        authorizedTools[toolId] = {
          executionPath: ['public', toolId],
        };
        authorizedToolIds.push(toolId);
      }
    }

    // Build authorized prompts map
    const authorizedPrompts: AuthorizationCreateCtx['authorizedPrompts'] = {};
    const authorizedPromptIds: string[] = [];
    if (allowedPrompts !== 'all' && Array.isArray(allowedPrompts)) {
      for (const promptId of allowedPrompts) {
        authorizedPrompts[promptId] = {
          executionPath: ['public', promptId],
        };
        authorizedPromptIds.push(promptId);
      }
    }

    return new PublicAuthorization({
      id: sub,
      isAnonymous: true,
      user,
      scopes,
      expiresAt,
      issuer,
      allTools: allowedTools === 'all',
      allPrompts: allowedPrompts === 'all',
      authorizedTools: allowedTools === 'all' ? undefined : authorizedTools,
      authorizedToolIds: allowedTools === 'all' ? undefined : authorizedToolIds,
      authorizedPrompts: allowedPrompts === 'all' ? undefined : authorizedPrompts,
      authorizedPromptIds: allowedPrompts === 'all' ? undefined : authorizedPromptIds,
    });
  }

  /**
   * Anonymous users cannot access provider tokens
   *
   * @throws TokenNotAvailableError always - anonymous users do not have provider tokens
   */
  async getToken(_providerId?: string): Promise<string> {
    throw new TokenNotAvailableError(
      'PublicAuthorization: Anonymous users cannot access provider tokens. ' +
        'Use transparent or orchestrated mode for token access.',
    );
  }

  /**
   * Check if all tools are allowed (`allowedTools: 'all'`); an empty list allows none
   */
  get allowsAllTools(): boolean {
    return this.#allTools;
  }

  /**
   * Check if all prompts are allowed (`allowedPrompts: 'all'`); an empty list allows none
   */
  get allowsAllPrompts(): boolean {
    return this.#allPrompts;
  }

  /**
   * Override canAccessTool to support 'all' mode
   */
  override canAccessTool(toolId: string): boolean {
    if (this.allowsAllTools) {
      return true;
    }
    return super.canAccessTool(toolId);
  }

  /**
   * Override canAccessPrompt to support 'all' mode
   */
  override canAccessPrompt(promptId: string): boolean {
    if (this.allowsAllPrompts) {
      return true;
    }
    return super.canAccessPrompt(promptId);
  }
}
