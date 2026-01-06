/**
 * Context Extension Types for RememberPlugin
 *
 * Declares TypeScript types for `this.remember` property
 * on ExecutionContextBase (ToolContext, AgentContext, etc.).
 *
 * The SDK handles the runtime installation via `contextExtensions` in plugin metadata.
 * This file only provides TypeScript type augmentation.
 *
 * @example
 * ```typescript
 * // When RememberPlugin is installed, you can use:
 * class MyTool extends ToolContext {
 *   async execute(input) {
 *     // Direct property access (throws if plugin not installed)
 *     await this.remember.set('key', 'value');
 *     const val = await this.remember.get('key');
 *   }
 * }
 * ```
 *
 * @packageDocumentation
 */

import type { RememberAccessor } from './providers/remember-accessor.provider';
import { RememberAccessorToken } from './remember.symbols';

// ─────────────────────────────────────────────────────────────────────────────
// Module Augmentation (TypeScript types for plugin developers)
// ─────────────────────────────────────────────────────────────────────────────

declare module '@frontmcp/sdk' {
  interface ExecutionContextBase {
    /**
     * Access the remember accessor for storing/retrieving session memory.
     * Only available when RememberPlugin is installed.
     *
     * @throws Error if RememberPlugin is not installed
     *
     * @example
     * ```typescript
     * await this.remember.set('theme', 'dark');
     * const theme = await this.remember.get('theme');
     * ```
     */
    readonly remember: RememberAccessor;
  }

  // PromptContext doesn't extend ExecutionContextBase, so we need separate augmentation
  interface PromptContext {
    /**
     * Access the remember accessor for storing/retrieving session memory.
     * Only available when RememberPlugin is installed.
     */
    readonly remember: RememberAccessor;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions (alternative API)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the RememberAccessor from an execution context.
 * Alternative to `this.remember` for explicit function-style access.
 *
 * @throws Error if RememberPlugin is not installed
 */
export function getRemember<T extends { get: (token: unknown) => unknown }>(ctx: T): RememberAccessor {
  return ctx.get(RememberAccessorToken) as RememberAccessor;
}

/**
 * Try to get the RememberAccessor, returning undefined if not available.
 * Use this for graceful degradation when the plugin might not be installed.
 */
export function tryGetRemember<T extends { tryGet?: (token: unknown) => unknown }>(
  ctx: T,
): RememberAccessor | undefined {
  if (typeof ctx.tryGet === 'function') {
    return ctx.tryGet(RememberAccessorToken) as RememberAccessor | undefined;
  }
  return undefined;
}
