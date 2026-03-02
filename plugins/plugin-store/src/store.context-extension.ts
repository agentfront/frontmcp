/**
 * Context Extension Types for StorePlugin
 *
 * Declares TypeScript types for `this.store` property
 * on ExecutionContextBase (ToolContext, AgentContext, etc.).
 *
 * The SDK handles the runtime installation via `contextExtensions` in plugin metadata.
 * This file only provides TypeScript type augmentation.
 *
 * @example
 * ```typescript
 * class MyTool extends ToolContext {
 *   async execute(input) {
 *     const count = this.store.get('counter', ['count']);
 *     this.store.set('counter', ['count'], (count as number) + 1);
 *   }
 * }
 * ```
 *
 * @packageDocumentation
 */

import type { StoreAccessor } from './providers/store-accessor.provider';
import { StoreAccessorToken } from './store.symbols';

// ─────────────────────────────────────────────────────────────────────────────
// Module Augmentation (TypeScript types for plugin developers)
// ─────────────────────────────────────────────────────────────────────────────

declare module '@frontmcp/sdk' {
  interface ExecutionContextBase {
    /**
     * Access the store accessor for reading/writing named stores.
     * Only available when StorePlugin is installed.
     *
     * @throws Error if StorePlugin is not installed
     */
    readonly store: StoreAccessor;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions (alternative API)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the StoreAccessor from an execution context.
 * Alternative to `this.store` for explicit function-style access.
 */
export function getStore<T extends { get: (token: unknown) => unknown }>(ctx: T): StoreAccessor {
  return ctx.get(StoreAccessorToken) as StoreAccessor;
}

/**
 * Try to get the StoreAccessor, returning undefined if not available.
 */
export function tryGetStore<T extends { tryGet?: (token: unknown) => unknown }>(ctx: T): StoreAccessor | undefined {
  if (typeof ctx.tryGet === 'function') {
    return ctx.tryGet(StoreAccessorToken) as StoreAccessor | undefined;
  }
  return undefined;
}
