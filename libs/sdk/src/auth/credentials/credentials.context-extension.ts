/**
 * Credentials Context Extension (Checkpoint 3b)
 *
 * Module augmentation + context-extension configuration that adds
 * `this.credentials` to ExecutionContextBase, mirroring `this.authProviders`
 * and `this.orchestration`.
 *
 * `this.credentials` exposes the per-session, encrypted {@link CredentialsAccessor}
 * so tools can read credentials a local `authenticate()` verifier persisted, and
 * ask the agent to connect a missing credential mid-session via a
 * framework-signed resume URL.
 */

import { CREDENTIALS_ACCESSOR, type CredentialsAccessor } from '@frontmcp/auth';

import type { ContextExtension } from '../../common/metadata/plugin.metadata';

// ============================================
// Module Augmentation
// ============================================

declare module '../../common/interfaces/execution-context.interface' {
  interface ExecutionContextBase {
    /**
     * Access per-session credentials persisted by a local `authenticate()`
     * verifier (Checkpoint 3b). Only available in `local`/`remote` auth modes.
     *
     * @example
     * ```typescript
     * @Tool({ name: 'call_acme' })
     * class CallAcmeTool extends ToolContext {
     *   async execute(input: Input): Promise<Output> {
     *     // Read a stored credential for the current session's subject
     *     const cred = await this.credentials.get('acme');
     *     if (!cred) {
     *       // Ask the user to connect it mid-session via a signed resume URL
     *       const res = await this.credentials.requireConnect({ key: 'acme' });
     *       if (!res.connected) {
     *         return { needsConnect: res.resumeUrl };
     *       }
     *     }
     *     // use cred.secret / cred.metadata …
     *   }
     * }
     * ```
     */
    readonly credentials: CredentialsAccessor;
  }
}

// ============================================
// Context Extension Configuration
// ============================================

/**
 * Context extension configuration for `this.credentials`. Registers the lazy
 * getter on ExecutionContextBase.prototype; resolves {@link CREDENTIALS_ACCESSOR}
 * from the request scope.
 */
export const credentialsContextExtension: ContextExtension = {
  property: 'credentials',
  token: CREDENTIALS_ACCESSOR,
  errorMessage:
    'Per-session credentials are not available. ' +
    "Ensure the server uses auth mode 'local' (or 'remote'); credentials are persisted by a local authenticate() verifier.",
};

// ============================================
// Helper Functions
// ============================================

/**
 * Get the {@link CredentialsAccessor} from a context. Throws via the DI layer
 * when not configured (see {@link credentialsContextExtension.errorMessage}).
 */
export function getCredentials(ctx: { get: <T>(token: unknown) => T }): CredentialsAccessor {
  return ctx.get(CREDENTIALS_ACCESSOR);
}

/**
 * Try to get the {@link CredentialsAccessor}; returns undefined when not
 * available (graceful degradation).
 */
export function tryGetCredentials(ctx: {
  tryGet: <T>(token: unknown) => T | undefined;
}): CredentialsAccessor | undefined {
  return ctx.tryGet<CredentialsAccessor>(CREDENTIALS_ACCESSOR);
}
