/**
 * AuthProviders Vault - Core Type Definitions
 *
 * Types for credential management, provider configuration, and vault operations.
 */

import { z } from 'zod';
import type { Credential } from '../session/authorization-vault';
import type { AuthorizationVault } from '../session/authorization-vault';

// ============================================
// Credential Scope
// ============================================

/**
 * Credential scope determines caching and storage behavior.
 *
 * - `global`: Shared across all sessions and users. Stored with global key.
 * - `user`: Scoped to a specific user. Persists across sessions for same user.
 * - `session`: Scoped to a specific session. Lost when session ends.
 */
export type CredentialScope = 'global' | 'user' | 'session';

export const credentialScopeSchema = z.enum(['global', 'user', 'session']);

// ============================================
// Loading Strategy
// ============================================

/**
 * Loading strategy determines when credentials are acquired.
 *
 * - `eager`: Load at session initialization (blocking)
 * - `lazy`: Load on first access (non-blocking init)
 */
export type LoadingStrategy = 'eager' | 'lazy';

export const loadingStrategySchema = z.enum(['eager', 'lazy']);

// ============================================
// Get Credential Options
// ============================================

/**
 * Options for credential retrieval
 */
export interface GetCredentialOptions {
  /** Force refresh even if cached and valid */
  forceRefresh?: boolean;
  /** Required scopes (for OAuth providers) */
  scopes?: string[];
  /** Timeout for credential acquisition in ms */
  timeout?: number;
}

export const getCredentialOptionsSchema = z
  .object({
    forceRefresh: z.boolean().optional(),
    scopes: z.array(z.string()).optional(),
    timeout: z.number().positive().optional(),
  })
  .strict();

// ============================================
// Resolved Credential
// ============================================

/**
 * Resolved credential with metadata
 */
export interface ResolvedCredential<T extends Credential = Credential> {
  /** The credential data */
  credential: T;
  /** Provider ID that provided this credential */
  providerId: string;
  /** When the credential was acquired (epoch ms) */
  acquiredAt: number;
  /** When the credential expires (epoch ms, if applicable) */
  expiresAt?: number;
  /** Whether the credential is currently valid */
  isValid: boolean;
  /** Scope the credential was resolved at */
  scope: CredentialScope;
}

// ============================================
// Credential Factory Context
// ============================================

/**
 * Context passed to credential factories
 */
export interface CredentialFactoryContext {
  /** Current session ID */
  sessionId: string;
  /** User subject identifier (from JWT sub claim) */
  userSub?: string;
  /** User email */
  userEmail?: string;
  /** User name */
  userName?: string;
  /** App ID requesting the credential */
  appId?: string;
  /** Tool ID requesting the credential (if available) */
  toolId?: string;
  /** Existing credential (for refresh operations) */
  existingCredential?: Credential;
  /** Authorization vault for storage operations */
  vault: AuthorizationVault;
  /** Custom metadata passed during provider registration */
  metadata?: Record<string, unknown>;
}

// ============================================
// Credential Factory
// ============================================

/**
 * Credential factory function type.
 * Called to acquire new credentials or refresh existing ones.
 */
export type CredentialFactory<T extends Credential = Credential> = (
  context: CredentialFactoryContext,
) => Promise<T | null>;

/**
 * Credential refresh function type.
 * Called specifically for credential rotation/refresh.
 */
export type CredentialRefreshFn<T extends Credential = Credential> = (
  context: CredentialFactoryContext & { existingCredential: T },
) => Promise<T | null>;

/**
 * Headers generator function type.
 * Converts a credential to HTTP headers.
 */
export type CredentialHeadersFn<T extends Credential = Credential> = (credential: T) => Record<string, string>;

// ============================================
// Credential Provider Config
// ============================================

/**
 * Configuration for registering a credential provider
 */
export interface CredentialProviderConfig<T extends Credential = Credential> {
  /** Unique provider name (e.g., 'github', 'openai', 'aws') */
  name: string;

  /** Human-readable description */
  description?: string;

  /** Credential scope - determines storage and caching behavior */
  scope: CredentialScope;

  /** Loading strategy - when to acquire credentials */
  loading: LoadingStrategy;

  /** TTL in milliseconds for cached credentials (0 = no TTL, use credential expiry) */
  cacheTtl?: number;

  /**
   * Factory function to acquire credentials.
   * Called on first access (lazy) or session init (eager).
   */
  factory: CredentialFactory<T>;

  /**
   * Optional refresh function for credential rotation.
   * If not provided, factory is called on refresh.
   */
  refresh?: CredentialRefreshFn<T>;

  /**
   * Optional headers generator from credential.
   * If not provided, uses default header generation logic.
   */
  toHeaders?: CredentialHeadersFn<T>;

  /** Custom metadata to pass to factory */
  metadata?: Record<string, unknown>;

  /** Required for this provider to be available (default: false) */
  required?: boolean;
}

export const credentialProviderConfigSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    scope: credentialScopeSchema,
    loading: loadingStrategySchema,
    cacheTtl: z.number().nonnegative().optional(),
    factory: z.function(),
    refresh: z.function().optional(),
    toHeaders: z.function().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    required: z.boolean().optional(),
  })
  .strict();

// ============================================
// Auth Provider Mapping (for Tool decorator)
// ============================================

/**
 * Auth provider mapping for tool metadata.
 * Used in @Tool({ authProviders: [...] }) decorator.
 */
export interface AuthProviderMapping {
  /** Provider name */
  name: string;
  /** Whether credential is required (default: true) */
  required?: boolean;
  /** Required scopes for OAuth providers */
  scopes?: string[];
  /** Alias to use when injecting (for multiple providers) */
  alias?: string;
}

export const authProviderMappingSchema = z.union([
  z.string(),
  z
    .object({
      name: z.string().min(1),
      required: z.boolean().optional().default(true),
      scopes: z.array(z.string()).optional(),
      alias: z.string().optional(),
    })
    .strict(),
]);

// ============================================
// Cache Entry
// ============================================

/**
 * Internal cache entry structure
 */
export interface CredentialCacheEntry<T extends Credential = Credential> {
  /** The resolved credential */
  resolved: ResolvedCredential<T>;
  /** Cache insertion timestamp */
  cachedAt: number;
  /** Cache TTL in ms (0 = no TTL) */
  ttl: number;
}

// ============================================
// Vault Storage Key
// ============================================

/**
 * Vault storage key components
 */
export interface VaultStorageKey {
  /** Credential scope */
  scope: CredentialScope;
  /** Provider name */
  providerId: string;
  /** Session ID (for session scope) */
  sessionId?: string;
  /** User ID (for user scope) */
  userId?: string;
}

// ============================================
// Auth Providers Vault Options
// ============================================

/**
 * Configuration options for AuthProviders vault
 */
export interface AuthProvidersVaultOptions {
  /** Enable AuthProvidersVault (default: true if any providers registered) */
  enabled?: boolean;

  /** Use shared storage with AuthorizationVault (default: true) */
  useSharedStorage?: boolean;

  /** Custom namespace for credential storage (default: 'authproviders:') */
  namespace?: string;

  /** Default TTL for cached credentials in ms (default: 3600000 = 1 hour) */
  defaultCacheTtl?: number;

  /** Maximum credentials per session (default: 100) */
  maxCredentialsPerSession?: number;

  /** Credential providers to register */
  providers?: CredentialProviderConfig[];
}

export const authProvidersVaultOptionsSchema = z
  .object({
    enabled: z.boolean().optional(),
    useSharedStorage: z.boolean().optional().default(true),
    namespace: z.string().optional().default('authproviders:'),
    defaultCacheTtl: z.number().nonnegative().optional().default(3600000),
    maxCredentialsPerSession: z.number().positive().optional().default(100),
    providers: z.array(credentialProviderConfigSchema).optional(),
  })
  .strict();

// ============================================
// Events
// ============================================

/**
 * Credential event types
 */
export type CredentialEventType = 'acquired' | 'refreshed' | 'invalidated' | 'expired' | 'error';

/**
 * Credential event payload
 */
export interface CredentialEvent {
  type: CredentialEventType;
  providerId: string;
  scope: CredentialScope;
  sessionId?: string;
  userId?: string;
  timestamp: number;
  error?: Error;
}
