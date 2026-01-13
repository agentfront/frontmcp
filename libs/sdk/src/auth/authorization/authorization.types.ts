// auth/authorization/authorization.types.ts

// Re-export all portable types from @frontmcp/auth
export {
  type AuthMode,
  type AuthUser,
  type AuthorizedTool,
  type AuthorizedPrompt,
  type LLMSafeAuthContext,
  type AppAuthorizationRecord,
  type ProgressiveAuthState,
  type AuthorizationCreateCtx as BaseAuthorizationCreateCtx,
  AppAuthState,
  authModeSchema,
  authUserSchema,
  authorizedToolSchema,
  authorizedPromptSchema,
  llmSafeAuthContextSchema,
  appAuthStateSchema,
  appAuthorizationRecordSchema,
  progressiveAuthStateSchema,
} from '@frontmcp/auth';

// SDK-specific imports
import type { ProviderSnapshot } from '../session/session.types';
import type { TransportSession, TransportProtocol } from '../session';
import type { AuthMode, AuthUser, AuthorizedTool, AuthorizedPrompt } from '@frontmcp/auth';

// ============================================
// SDK-specific Types (require TransportSession/ProviderSnapshot)
// ============================================

/**
 * Authorization represents the authenticated user context (SDK-specific).
 * Created from JWT verification, independent of transport.
 * One authorization can have multiple transport sessions.
 */
export interface Authorization {
  /** Unique authorization ID (derived from token signature) */
  readonly id: string;

  /** Auth mode that created this authorization */
  readonly mode: AuthMode;

  /** Whether this is an anonymous/public authorization */
  readonly isAnonymous: boolean;

  /** User identity */
  readonly user: AuthUser;

  /** JWT claims */
  readonly claims?: Record<string, unknown>;

  /** Token expiration (epoch ms) */
  readonly expiresAt?: number;

  /** Granted scopes */
  readonly scopes: string[];

  /** Authorized providers (for orchestrated mode) */
  readonly authorizedProviders: Record<string, ProviderSnapshot>;

  /** Authorized provider IDs */
  readonly authorizedProviderIds: string[];

  /** Authorized apps */
  readonly authorizedApps: Record<string, { id: string; toolIds: string[] }>;

  /** Authorized app IDs */
  readonly authorizedAppIds: string[];

  /** Authorized tools */
  readonly authorizedTools: Record<string, AuthorizedTool>;

  /** Authorized tool IDs */
  readonly authorizedToolIds: string[];

  /** Authorized prompts */
  readonly authorizedPrompts: Record<string, AuthorizedPrompt>;

  /** Authorized prompt IDs */
  readonly authorizedPromptIds: string[];

  /** Authorized resources */
  readonly authorizedResources: string[];

  /**
   * Get access token for a provider (orchestrated mode)
   * @param providerId - Provider ID, defaults to primary
   */
  getToken(providerId?: string): Promise<string>;

  /**
   * Create a new transport session for this authorization
   * @param protocol - Transport protocol (sse, streamable-http, etc.)
   * @param fingerprint - Optional client fingerprint for tracking
   */
  createTransportSession(protocol: TransportProtocol, fingerprint?: string): TransportSession;

  /**
   * Get existing transport session by ID
   * @param sessionId - Session ID to retrieve
   */
  getTransportSession(sessionId: string): TransportSession | undefined;

  /**
   * Check if a scope is granted
   * @param scope - Scope to check
   */
  hasScope(scope: string): boolean;

  /**
   * Check if all scopes are granted
   * @param scopes - Scopes to check
   */
  hasAllScopes(scopes: string[]): boolean;

  /**
   * Check if any scope is granted
   * @param scopes - Scopes to check
   */
  hasAnyScope(scopes: string[]): boolean;

  /**
   * Check if a tool is authorized
   * @param toolId - Tool ID to check
   */
  canAccessTool(toolId: string): boolean;

  /**
   * Check if a prompt is authorized
   * @param promptId - Prompt ID to check
   */
  canAccessPrompt(promptId: string): boolean;
}

/**
 * Context for creating an authorization (SDK-specific, includes ProviderSnapshot)
 */
export interface AuthorizationCreateCtx {
  /** Unique ID (typically token signature fingerprint) */
  id: string;
  /** Whether this is anonymous */
  isAnonymous: boolean;
  /** User identity */
  user: AuthUser;
  /** JWT claims */
  claims?: Record<string, unknown>;
  /** Token expiration (epoch ms) */
  expiresAt?: number;
  /** Granted scopes */
  scopes?: string[];
  /** The original token (for transparent mode) */
  token?: string;
  /** Authorized providers (SDK-specific, uses ProviderSnapshot) */
  authorizedProviders?: Record<string, ProviderSnapshot>;
  /** Authorized provider IDs */
  authorizedProviderIds?: string[];
  /** Authorized apps */
  authorizedApps?: Record<string, { id: string; toolIds: string[] }>;
  /** Authorized app IDs */
  authorizedAppIds?: string[];
  /** Authorized tools */
  authorizedTools?: Record<string, AuthorizedTool>;
  /** Authorized tool IDs */
  authorizedToolIds?: string[];
  /** Authorized prompts */
  authorizedPrompts?: Record<string, AuthorizedPrompt>;
  /** Authorized prompt IDs */
  authorizedPromptIds?: string[];
  /** Authorized resources */
  authorizedResources?: string[];
}
