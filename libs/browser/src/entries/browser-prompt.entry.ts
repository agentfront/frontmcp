// file: libs/browser/src/entries/browser-prompt.entry.ts
/**
 * Browser-specific PromptEntry extension.
 *
 * Extends SDK's PromptEntry with browser-specific methods for accessing
 * Valtio stores for reactive prompt data.
 *
 * @example
 * ```typescript
 * import { BrowserPromptEntry } from '@frontmcp/browser';
 *
 * class GreetPrompt extends BrowserPromptEntry {
 *   static metadata = {
 *     name: 'greet',
 *     description: 'Generate a personalized greeting',
 *     arguments: [
 *       { name: 'name', description: 'Name to greet', required: true },
 *     ],
 *   };
 *
 *   async execute(args: { name: string }) {
 *     // Access reactive store for user preferences
 *     const store = this.tryGetStore<AppState>();
 *     const style = store?.state.greetingStyle ?? 'formal';
 *
 *     return {
 *       messages: [{
 *         role: 'user',
 *         content: { type: 'text', text: `Generate a ${style} greeting for ${args.name}` },
 *       }],
 *     };
 *   }
 * }
 * ```
 */

import { PromptEntry } from '@frontmcp/sdk/core';
import type { PromptMetadata } from '@frontmcp/sdk/core';
import type { BrowserStore } from './browser-tool.entry';

/**
 * Browser-specific PromptEntry extension.
 *
 * Provides access to:
 * - Valtio reactive stores via `getStore<T>()`
 * - Store subscriptions for reactive updates
 */
export abstract class BrowserPromptEntry extends PromptEntry {
  /**
   * Storage for browser-specific context.
   * Set by BrowserMcpServer during prompt registration.
   */
  private _browserContext?: {
    store?: BrowserStore<object>;
  };

  /**
   * Set browser context. Called by BrowserMcpServer during registration.
   * @internal
   */
  setBrowserContext(context: { store?: BrowserStore<object> }): void {
    this._browserContext = context;
  }

  /**
   * Get the Valtio reactive store with typed state.
   *
   * @template T - The state type for the store
   * @returns The reactive store instance
   * @throws Error if store is not available in current context
   *
   * @example
   * ```typescript
   * interface AppState {
   *   greetingStyle: 'formal' | 'casual';
   *   userName: string;
   * }
   *
   * async execute(args: Args) {
   *   const store = this.getStore<AppState>();
   *   return {
   *     messages: [{
   *       role: 'user',
   *       content: { type: 'text', text: `Greet ${store.state.userName}` },
   *     }],
   *   };
   * }
   * ```
   */
  getStore<T extends object>(): BrowserStore<T> {
    if (!this._browserContext?.store) {
      throw new Error('Store not available. Ensure prompt is registered with BrowserMcpServer.');
    }
    return this._browserContext.store as BrowserStore<T>;
  }

  /**
   * Try to get the store, returning undefined if not available.
   *
   * @template T - The state type for the store
   * @returns The reactive store instance or undefined
   */
  tryGetStore<T extends object>(): BrowserStore<T> | undefined {
    return this._browserContext?.store as BrowserStore<T> | undefined;
  }

  /**
   * Check if browser context is available.
   *
   * @returns True if running in browser context with store
   */
  hasBrowserContext(): boolean {
    return this._browserContext !== undefined;
  }
}

/**
 * Type helper for browser prompt metadata.
 */
export type BrowserPromptMetadata = PromptMetadata;
