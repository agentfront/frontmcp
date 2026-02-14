/**
 * Orchestrated Auth Context Extension
 *
 * Provides module augmentation and context extension configuration
 * for adding `this.orchestration` to ExecutionContextBase.
 *
 * This extension allows tools to access upstream provider tokens
 * in orchestrated authentication mode.
 */

import type { ContextExtension } from '../../common/metadata/plugin.metadata';
import {
  ORCHESTRATED_AUTH_ACCESSOR,
  type OrchestratedAuthAccessor,
  NullOrchestratedAuthAccessor,
} from '@frontmcp/auth';

// ============================================
// Module Augmentation
// ============================================

/**
 * Module augmentation to add type safety for this.orchestration
 */
declare module '../../common/interfaces/execution-context.interface' {
  interface ExecutionContextBase {
    /**
     * Access orchestrated authorization for upstream provider tokens.
     *
     * Only available in orchestrated authentication mode when the user
     * has completed multi-provider authentication.
     *
     * @example
     * ```typescript
     * @Tool({ name: 'github_repos' })
     * class GitHubReposTool extends ToolContext {
     *   async execute(input: Input): Promise<Output> {
     *     // Get upstream GitHub token
     *     const token = await this.orchestration.getToken('github');
     *
     *     // Use token to call GitHub API
     *     const response = await fetch('https://api.github.com/user/repos', {
     *       headers: { Authorization: `Bearer ${token}` },
     *     });
     *
     *     return { repos: await response.json() };
     *   }
     * }
     * ```
     *
     * @example Multiple providers
     * ```typescript
     * @Tool({ name: 'sync_issues' })
     * class SyncIssuesTool extends ToolContext {
     *   async execute(input: Input): Promise<Output> {
     *     // Check which providers are authorized
     *     if (this.orchestration.hasProvider('github') &&
     *         this.orchestration.hasProvider('jira')) {
     *       const githubToken = await this.orchestration.getToken('github');
     *       const jiraToken = await this.orchestration.getToken('jira');
     *
     *       // Sync issues between GitHub and Jira
     *     }
     *   }
     * }
     * ```
     *
     * @example Progressive authorization
     * ```typescript
     * @Tool({ name: 'slack_send' })
     * class SlackSendTool extends ToolContext {
     *   async execute(input: Input): Promise<Output> {
     *     // Check if Slack app is authorized
     *     if (!this.orchestration.isAppAuthorized('slack')) {
     *       // Trigger progressive auth
     *       throw new AuthorizationRequiredError('slack');
     *     }
     *
     *     const token = await this.orchestration.getAppToken('slack');
     *     // Send message to Slack
     *   }
     * }
     * ```
     */
    readonly orchestration: OrchestratedAuthAccessor;
  }
}

// ============================================
// Context Extension Configuration
// ============================================

/**
 * Context extension configuration for orchestration.
 * Used to register the lazy getter on ExecutionContextBase.prototype.
 *
 * When the accessor is not available (not orchestrated mode, or
 * user not authenticated), the property will throw an error with
 * the specified errorMessage. Use getOrchestration() helper for
 * graceful fallback to NullOrchestratedAuthAccessor.
 */
export const orchestratedAuthContextExtension: ContextExtension = {
  property: 'orchestration',
  token: ORCHESTRATED_AUTH_ACCESSOR,
  errorMessage:
    'Orchestrated authorization not available. ' +
    'Ensure your server is configured with orchestrated mode and the user has completed authentication.',
};

// ============================================
// Helper Functions
// ============================================

/**
 * Get OrchestratedAuthAccessor from context.
 * Returns null accessor if not available (graceful degradation).
 *
 * @param ctx - Execution context
 * @returns OrchestratedAuthAccessor (may be NullOrchestratedAuthAccessor)
 */
export function getOrchestration(ctx: {
  get: <T>(token: unknown) => T;
  tryGet: <T>(token: unknown) => T | undefined;
}): OrchestratedAuthAccessor {
  const accessor = ctx.tryGet<OrchestratedAuthAccessor>(ORCHESTRATED_AUTH_ACCESSOR);
  return accessor ?? new NullOrchestratedAuthAccessor();
}

/**
 * Check if orchestrated auth is available and user is authenticated.
 *
 * @param ctx - Execution context
 * @returns true if orchestrated auth is available with authenticated user
 */
export function hasOrchestration(ctx: { tryGet: <T>(token: unknown) => T | undefined }): boolean {
  const accessor = ctx.tryGet<OrchestratedAuthAccessor>(ORCHESTRATED_AUTH_ACCESSOR);
  return accessor !== undefined && accessor.isAuthenticated;
}
