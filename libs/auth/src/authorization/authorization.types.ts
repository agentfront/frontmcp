/**
 * Authorization Types
 *
 * Core types for authorization, user identity, and progressive auth.
 * These types are portable and can be used across different implementations.
 */

import { z } from 'zod';

// ============================================
// Auth Mode
// ============================================

/**
 * Authentication mode determining how tokens are handled
 */
export type AuthMode = 'public' | 'transparent' | 'orchestrated';

/**
 * Zod schema for AuthMode
 */
export const authModeSchema = z.enum(['public', 'transparent', 'orchestrated']);

// ============================================
// User Identity
// ============================================

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
 * Zod schema for AuthUser
 */
export const authUserSchema = z.object({
  sub: z.string(),
  name: z.string().optional(),
  email: z.string().email().optional(),
  picture: z.string().url().optional(),
  anonymous: z.boolean().optional(),
});

// ============================================
// Authorized Tools and Prompts
// ============================================

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
 * Zod schema for AuthorizedTool
 */
export const authorizedToolSchema = z.object({
  executionPath: z.tuple([z.string(), z.string()]),
  scopes: z.array(z.string()).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

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
 * Zod schema for AuthorizedPrompt
 */
export const authorizedPromptSchema = z.object({
  executionPath: z.tuple([z.string(), z.string()]),
  scopes: z.array(z.string()).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

// ============================================
// LLM-Safe Context
// ============================================

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

/**
 * Zod schema for LLMSafeAuthContext
 */
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
 * Zod schema for AppAuthState enum
 */
export const appAuthStateSchema = z.nativeEnum(AppAuthState);

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
 * Zod schema for ProgressiveAuthState
 */
export const progressiveAuthStateSchema = z.object({
  apps: z.record(z.string(), appAuthorizationRecordSchema),
  initiallyAuthorized: z.array(z.string()),
  initiallySkipped: z.array(z.string()),
});

// ============================================
// Authorization Create Context (without SDK deps)
// ============================================

/**
 * Context for creating an authorization (portable version)
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
