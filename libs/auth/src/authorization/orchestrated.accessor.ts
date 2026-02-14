/**
 * OrchestratedAuthAccessor - Interface for accessing orchestrated authorization
 *
 * This interface provides the runtime API for tools to access upstream provider
 * tokens in orchestrated mode. It supports:
 * - Token retrieval by provider ID
 * - App token retrieval for progressive auth
 * - Automatic token refresh
 * - Authorization checks
 */

import { Token } from '@frontmcp/di';
import { OrchestratedAuthNotAvailableError } from '../errors/auth-internal.errors';

/**
 * OrchestratedAuthAccessor - Runtime accessor for orchestrated authorization.
 *
 * Available in tool execution via `this.orchestration`:
 * ```typescript
 * @Tool({ name: 'my_tool' })
 * class MyTool extends ToolContext {
 *   async execute(input: Input) {
 *     // Get upstream provider token
 *     const githubToken = await this.orchestration.getToken('github');
 *
 *     // Check if provider is authorized
 *     const hasSlack = await this.orchestration.hasProvider('slack');
 *
 *     // Get app-specific token (progressive auth)
 *     const jiraToken = await this.orchestration.getAppToken('jira');
 *   }
 * }
 * ```
 */
export interface OrchestratedAuthAccessor {
  /**
   * Get access token for an upstream provider.
   *
   * @param providerId - Provider ID (e.g., 'github', 'slack')
   * @returns Access token string
   * @throws Error if provider not authorized or token unavailable
   *
   * @example
   * ```typescript
   * const token = await this.orchestration.getToken('github');
   * const response = await fetch('https://api.github.com/user', {
   *   headers: { Authorization: `Bearer ${token}` },
   * });
   * ```
   */
  getToken(providerId?: string): Promise<string>;

  /**
   * Try to get access token, returning null if not available.
   *
   * @param providerId - Provider ID
   * @returns Access token or null
   */
  tryGetToken(providerId?: string): Promise<string | null>;

  /**
   * Get access token for a specific app (progressive authorization).
   *
   * @param appId - App ID
   * @returns Access token or null if app not authorized
   */
  getAppToken(appId: string): Promise<string | null>;

  /**
   * Check if a provider is authorized.
   *
   * @param providerId - Provider ID
   * @returns true if provider has tokens stored
   */
  hasProvider(providerId: string): boolean;

  /**
   * Get all authorized provider IDs.
   */
  getProviderIds(): string[];

  /**
   * Check if an app is authorized.
   *
   * @param appId - App ID
   * @returns true if app is authorized
   */
  isAppAuthorized(appId: string): boolean;

  /**
   * Get all authorized app IDs.
   */
  getAllAuthorizedAppIds(): string[];

  /**
   * Get tool IDs authorized through a specific app.
   *
   * @param appId - App ID
   * @returns Tool IDs or undefined if app not authorized
   */
  getAppToolIds(appId: string): string[] | undefined;

  /**
   * Get the primary provider ID (default for getToken).
   */
  readonly primaryProviderId?: string;

  /**
   * Get the issuer (local orchestrator).
   */
  readonly issuer?: string;

  /**
   * Get authorization ID.
   */
  readonly authorizationId: string;

  /**
   * Check if user is authenticated (not anonymous).
   */
  readonly isAuthenticated: boolean;
}

/**
 * DI Token for OrchestratedAuthAccessor
 */
export const ORCHESTRATED_AUTH_ACCESSOR = Symbol.for(
  'frontmcp:ORCHESTRATED_AUTH_ACCESSOR',
) as Token<OrchestratedAuthAccessor>;

/**
 * Null implementation for when orchestrated auth is not available.
 */
export class NullOrchestratedAuthAccessor implements OrchestratedAuthAccessor {
  readonly primaryProviderId = undefined;
  readonly issuer = undefined;
  readonly authorizationId = 'null';
  readonly isAuthenticated = false;

  async getToken(providerId?: string): Promise<string> {
    throw new OrchestratedAuthNotAvailableError();
  }

  async tryGetToken(providerId?: string): Promise<string | null> {
    return null;
  }

  async getAppToken(appId: string): Promise<string | null> {
    return null;
  }

  hasProvider(providerId: string): boolean {
    return false;
  }

  getProviderIds(): string[] {
    return [];
  }

  isAppAuthorized(appId: string): boolean {
    return false;
  }

  getAllAuthorizedAppIds(): string[] {
    return [];
  }

  getAppToolIds(appId: string): string[] | undefined {
    return undefined;
  }
}

/**
 * Adapter that wraps OrchestratedAuthorization as OrchestratedAuthAccessor.
 */
export class OrchestratedAuthAccessorAdapter implements OrchestratedAuthAccessor {
  constructor(
    private readonly authorization: {
      readonly id: string;
      readonly isAnonymous: boolean;
      readonly primaryProviderId?: string;
      readonly issuer?: string;
      hasProvider(providerId: string): boolean;
      getProviderIds(): string[];
      getToken(providerId?: string): Promise<string>;
      getAppToken(appId: string): Promise<string | null>;
      isAppAuthorized(appId: string): boolean;
      getAllAuthorizedAppIds(): string[];
      getAppToolIds(appId: string): string[] | undefined;
    },
  ) {}

  get primaryProviderId(): string | undefined {
    return this.authorization.primaryProviderId;
  }

  get issuer(): string | undefined {
    return this.authorization.issuer;
  }

  get authorizationId(): string {
    return this.authorization.id;
  }

  get isAuthenticated(): boolean {
    return !this.authorization.isAnonymous;
  }

  async getToken(providerId?: string): Promise<string> {
    return this.authorization.getToken(providerId);
  }

  async tryGetToken(providerId?: string): Promise<string | null> {
    try {
      return await this.authorization.getToken(providerId);
    } catch {
      return null;
    }
  }

  async getAppToken(appId: string): Promise<string | null> {
    return this.authorization.getAppToken(appId);
  }

  hasProvider(providerId: string): boolean {
    return this.authorization.hasProvider(providerId);
  }

  getProviderIds(): string[] {
    return this.authorization.getProviderIds();
  }

  isAppAuthorized(appId: string): boolean {
    return this.authorization.isAppAuthorized(appId);
  }

  getAllAuthorizedAppIds(): string[] {
    return this.authorization.getAllAuthorizedAppIds();
  }

  getAppToolIds(appId: string): string[] | undefined {
    return this.authorization.getAppToolIds(appId);
  }
}
