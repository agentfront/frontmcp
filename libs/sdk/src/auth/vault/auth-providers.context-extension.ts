/**
 * AuthProviders Context Extension
 *
 * Provides module augmentation and context extension configuration
 * for adding `this.authProviders` to ExecutionContextBase.
 */

import type { ContextExtension } from '../../common/metadata/plugin.metadata';
import { AUTH_PROVIDERS_ACCESSOR, AuthProvidersAccessor } from './auth-providers.accessor';
import { AuthProvidersNotConfiguredError } from '../../errors/auth-internal.errors';

// ============================================
// Module Augmentation
// ============================================

/**
 * Module augmentation to add type safety for this.authProviders
 */
declare module '../../common/interfaces/execution-context.interface' {
  interface ExecutionContextBase {
    /**
     * Access auth providers for credential retrieval.
     *
     * @example
     * ```typescript
     * @Tool({ name: 'my_tool' })
     * class MyTool extends ToolContext {
     *   async execute(input: Input): Promise<Output> {
     *     // Get a specific credential
     *     const github = await this.authProviders.get('github');
     *
     *     // Get headers for HTTP requests
     *     const headers = await this.authProviders.headers('github');
     *
     *     // Check if credential is available
     *     if (await this.authProviders.has('jira')) {
     *       const jira = await this.authProviders.get('jira');
     *     }
     *
     *     // Force refresh a credential
     *     const refreshed = await this.authProviders.refresh('github');
     *   }
     * }
     * ```
     */
    readonly authProviders: AuthProvidersAccessor;
  }
}

// Note: PromptContext augmentation is handled separately if needed
// The main augmentation for ExecutionContextBase covers most use cases

// ============================================
// Context Extension Configuration
// ============================================

/**
 * Context extension configuration for authProviders.
 * Used to register the lazy getter on ExecutionContextBase.prototype.
 */
export const authProvidersContextExtension: ContextExtension = {
  property: 'authProviders',
  token: AUTH_PROVIDERS_ACCESSOR,
  errorMessage:
    'AuthProviders vault is not configured. ' +
    'Ensure AuthProvidersVault is enabled in your FrontMcp configuration with registered providers.',
};

// ============================================
// Helper Functions
// ============================================

/**
 * Get AuthProvidersAccessor from context.
 * Throws if not available.
 *
 * @param ctx - Execution context
 * @returns AuthProvidersAccessor
 * @throws Error if AuthProviders not configured
 */
export function getAuthProviders(ctx: { get: <T>(token: unknown) => T }): AuthProvidersAccessor {
  try {
    return ctx.get(AUTH_PROVIDERS_ACCESSOR);
  } catch (error) {
    throw new AuthProvidersNotConfiguredError();
  }
}

/**
 * Try to get AuthProvidersAccessor from context.
 * Returns undefined if not available (graceful degradation).
 *
 * @param ctx - Execution context
 * @returns AuthProvidersAccessor or undefined
 */
export function tryGetAuthProviders(ctx: { get: <T>(token: unknown) => T }): AuthProvidersAccessor | undefined {
  try {
    return ctx.get(AUTH_PROVIDERS_ACCESSOR);
  } catch {
    return undefined;
  }
}
