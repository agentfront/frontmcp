// auth/authorization/authorization.types.ts

import { z } from 'zod';
import { ProviderSnapshot } from '../session/session.types';
import { TransportSession, TransportProtocol } from '../session';
import type { AuthMode } from '../../common';

/**
 * User identity from authentication
 */
export interface AuthUser {
  /** Subject identifier */
  sub: string;
  /** Display name */
  name?: string;
  /** Email address */
  email?: string;
  /** Profile picture URL */
  picture?: string;
  /** Whether this is an anonymous user */
  anonymous?: boolean;
}

/**
 * Authorized tool entry
 */
export interface AuthorizedTool {
  /** Execution path: [appId, toolId] */
  executionPath: [appId: string, toolId: string];
  /** Required scopes for this tool */
  scopes?: string[];
  /** Additional tool metadata */
  details?: Record<string, unknown>;
}

/**
 * Authorized prompt entry
 */
export interface AuthorizedPrompt {
  /** Execution path: [appId, promptId] */
  executionPath: [appId: string, promptId: string];
  /** Required scopes for this prompt */
  scopes?: string[];
  /** Additional prompt metadata */
  details?: Record<string, unknown>;
}

/**
 * Authorization represents the authenticated user context.
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
 * Context for creating an authorization
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
  /** Authorized providers */
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

/**
 * LLM-safe session context (no tokens exposed)
 */
export interface LLMSafeAuthContext {
  /** Authorization ID */
  authorizationId: string;
  /** Session ID */
  sessionId: string;
  /** Auth mode */
  mode: AuthMode;
  /** Whether anonymous */
  isAnonymous: boolean;
  /** User (sub and name only) */
  user: { sub: string; name?: string };
  /** Granted scopes */
  scopes: string[];
  /** Authorized tool IDs */
  authorizedToolIds: string[];
  /** Authorized prompt IDs */
  authorizedPromptIds: string[];
}

// ============================================
// Zod Schemas
// ============================================

export const authUserSchema = z.object({
  sub: z.string(),
  name: z.string().optional(),
  email: z.string().email().optional(),
  picture: z.string().url().optional(),
  anonymous: z.boolean().optional(),
});

export const authorizedToolSchema = z.object({
  executionPath: z.tuple([z.string(), z.string()]),
  scopes: z.array(z.string()).optional(),
  details: z.record(z.unknown()).optional(),
});

export const authorizedPromptSchema = z.object({
  executionPath: z.tuple([z.string(), z.string()]),
  scopes: z.array(z.string()).optional(),
  details: z.record(z.unknown()).optional(),
});

export const authModeSchema = z.enum(['public', 'transparent', 'orchestrated']);

export const llmSafeAuthContextSchema = z.object({
  authorizationId: z.string(),
  sessionId: z.string(),
  mode: authModeSchema,
  isAnonymous: z.boolean(),
  user: z.object({
    sub: z.string(),
    name: z.string().optional(),
  }),
  scopes: z.array(z.string()),
  authorizedToolIds: z.array(z.string()),
  authorizedPromptIds: z.array(z.string()),
});

// ============================================
// Progressive/Incremental Authorization Types
// ============================================

/**
 * State of app authorization within a session.
 * Used for progressive authorization flow.
 */
export enum AppAuthState {
  /** App has been fully authorized with tokens stored */
  AUTHORIZED = 'authorized',
  /** User explicitly skipped this app during initial auth */
  SKIPPED = 'skipped',
  /** App authorization is pending (not yet presented to user) */
  PENDING = 'pending',
}

/**
 * App authorization record with state tracking.
 * Stored server-side, NOT in JWT.
 */
export interface AppAuthorizationRecord {
  /** App ID */
  appId: string;
  /** Current authorization state */
  state: AppAuthState;
  /** When the state was last changed (epoch ms) */
  stateChangedAt: number;
  /** Scopes granted for this app */
  grantedScopes?: string[];
  /** Auth provider ID used for this app */
  authProviderId?: string;
  /** Tool IDs accessible through this app authorization */
  toolIds: string[];
}

/**
 * Progressive auth session state.
 * Tracks which apps are authorized, skipped, or pending.
 * Stored server-side for security.
 */
export interface ProgressiveAuthState {
  /** App authorization records by app ID */
  apps: Record<string, AppAuthorizationRecord>;
  /** Apps authorized during initial auth */
  initiallyAuthorized: string[];
  /** Apps skipped during initial auth */
  initiallySkipped: string[];
}

/**
 * Zod schema for AppAuthState enum
 */
export const appAuthStateSchema = z.nativeEnum(AppAuthState);

/**
 * Zod schema for AppAuthorizationRecord
 */
export const appAuthorizationRecordSchema = z.object({
  appId: z.string(),
  state: appAuthStateSchema,
  stateChangedAt: z.number(),
  grantedScopes: z.array(z.string()).optional(),
  authProviderId: z.string().optional(),
  toolIds: z.array(z.string()),
});

/**
 * Zod schema for ProgressiveAuthState
 */
export const progressiveAuthStateSchema = z.object({
  apps: z.record(appAuthorizationRecordSchema),
  initiallyAuthorized: z.array(z.string()),
  initiallySkipped: z.array(z.string()),
});
