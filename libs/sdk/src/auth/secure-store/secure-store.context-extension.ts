/**
 * Secure-store Context Extension (#470)
 *
 * Module augmentation + context-extension configuration that adds
 * `this.secureStore` to ExecutionContextBase, mirroring `this.credentials`.
 *
 * `this.secureStore` exposes the general, session-scoped {@link SecureStoreAccessor}
 * so tools (and auth UI) can read/write arbitrary user-typed secrets keyed by
 * the configured scope (user / session / global), with the backing pluggable per
 * deployment (memory / sqlite / redis / a custom OS-keychain backend).
 */

import { SECURE_STORE_ACCESSOR, type SecureStoreAccessor } from '@frontmcp/auth';

import type { ContextExtension } from '../../common/metadata/plugin.metadata';

// ============================================
// Module Augmentation
// ============================================

declare module '../../common/interfaces/execution-context.interface' {
  interface ExecutionContextBase {
    /**
     * General session-scoped secure-secret store (#470). A typed accessor over a
     * pluggable backend for arbitrary user-typed secrets. Available in
     * `local`/`remote` auth modes.
     *
     * Distinct from {@link ExecutionContextBase.credentials}: `credentials` is the
     * OAuth-credential vault (resume URLs, per-authorize rotation); `secureStore`
     * is a general key→secret store with selectable backing.
     *
     * @example
     * ```typescript
     * @Tool({ name: 'save_api_key' })
     * class SaveApiKeyTool extends ToolContext {
     *   async execute(input: Input): Promise<Output> {
     *     await this.secureStore.set('stg.api-key', input.apiKey);
     *     const key = await this.secureStore.get<string>('stg.api-key');
     *     const keys = await this.secureStore.list();
     *     // …
     *   }
     * }
     * ```
     */
    readonly secureStore: SecureStoreAccessor;
  }
}

// ============================================
// Context Extension Configuration
// ============================================

/**
 * Context extension configuration for `this.secureStore`. Registers the lazy
 * getter on ExecutionContextBase.prototype; resolves {@link SECURE_STORE_ACCESSOR}
 * from the request scope.
 */
export const secureStoreContextExtension: ContextExtension = {
  property: 'secureStore',
  token: SECURE_STORE_ACCESSOR,
  errorMessage:
    'The secure store is not available. ' +
    "Ensure the server uses auth mode 'local' (or 'remote'); the secure store is enabled automatically there.",
};

// ============================================
// Helper Functions
// ============================================

/**
 * Get the {@link SecureStoreAccessor} from a context. Throws via the DI layer
 * when not configured (see {@link secureStoreContextExtension.errorMessage}).
 */
export function getSecureStore(ctx: { get: <T>(token: unknown) => T }): SecureStoreAccessor {
  return ctx.get(SECURE_STORE_ACCESSOR);
}

/**
 * Try to get the {@link SecureStoreAccessor}; returns undefined when not
 * available (graceful degradation).
 */
export function tryGetSecureStore(ctx: {
  tryGet: <T>(token: unknown) => T | undefined;
}): SecureStoreAccessor | undefined {
  return ctx.tryGet<SecureStoreAccessor>(SECURE_STORE_ACCESSOR);
}
