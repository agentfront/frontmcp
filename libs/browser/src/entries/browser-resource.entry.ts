// file: libs/browser/src/entries/browser-resource.entry.ts
/**
 * Browser-specific ResourceEntry extension.
 *
 * Extends SDK's ResourceEntry with browser-specific methods for accessing
 * Valtio stores for reactive resource content.
 *
 * @example
 * ```typescript
 * import { BrowserResourceEntry } from '@frontmcp/browser';
 *
 * class ConfigResource extends BrowserResourceEntry {
 *   static metadata = {
 *     name: 'config',
 *     uri: 'app://config',
 *     description: 'Application configuration',
 *     mimeType: 'application/json',
 *   };
 *
 *   async read() {
 *     // Access reactive store for live config
 *     const store = this.getStore<AppState>();
 *     return {
 *       contents: [{
 *         uri: 'app://config',
 *         mimeType: 'application/json',
 *         text: JSON.stringify(store.state.config),
 *       }],
 *     };
 *   }
 * }
 * ```
 */

import { ResourceEntry } from '@frontmcp/sdk/core';
import type { ResourceMetadata, ResourceTemplateMetadata } from '@frontmcp/sdk/core';
import type { BrowserStore } from './browser-tool.entry';

/**
 * Browser-specific ResourceEntry extension.
 *
 * Provides access to:
 * - Valtio reactive stores via `getStore<T>()`
 * - Store subscriptions for reactive updates
 */
export abstract class BrowserResourceEntry extends ResourceEntry {
  /**
   * Storage for browser-specific context.
   * Set by BrowserMcpServer during resource registration.
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
   *   config: AppConfig;
   *   user: User | null;
   * }
   *
   * async read() {
   *   const store = this.getStore<AppState>();
   *   return {
   *     contents: [{
   *       uri: this.metadata.uri,
   *       mimeType: 'application/json',
   *       text: JSON.stringify(store.state.config),
   *     }],
   *   };
   * }
   * ```
   */
  getStore<T extends object>(): BrowserStore<T> {
    if (!this._browserContext?.store) {
      throw new Error('Store not available. Ensure resource is registered with BrowserMcpServer.');
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

  /**
   * Subscribe to store changes for a specific key.
   *
   * This is useful for resources that need to emit change notifications
   * when their underlying data changes.
   *
   * @template T - The state type for the store
   * @template K - The key type
   * @param key - The key to subscribe to
   * @param callback - Callback when the value changes
   * @returns Unsubscribe function
   * @throws Error if store is not available
   */
  subscribeToStoreKey<T extends object, K extends keyof T>(key: K, callback: (value: T[K]) => void): () => void {
    const store = this.getStore<T>();
    return store.subscribeKey(key, callback);
  }

  /**
   * Create a JSON content response from any serializable value.
   *
   * @param uri - The resource URI
   * @param data - The data to serialize
   * @returns Resource content object
   */
  protected createJsonContent(
    uri: string,
    data: unknown,
  ): {
    uri: string;
    mimeType: string;
    text: string;
  } {
    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(data, null, 2),
    };
  }

  /**
   * Create a text content response.
   *
   * @param uri - The resource URI
   * @param text - The text content
   * @param mimeType - Optional MIME type (defaults to text/plain)
   * @returns Resource content object
   */
  protected createTextContent(
    uri: string,
    text: string,
    mimeType = 'text/plain',
  ): {
    uri: string;
    mimeType: string;
    text: string;
  } {
    return {
      uri,
      mimeType,
      text,
    };
  }
}

/**
 * Type helper for browser resource metadata.
 */
export type BrowserResourceMetadata = ResourceMetadata;

/**
 * Type helper for browser resource template metadata.
 */
export type BrowserResourceTemplateMetadata = ResourceTemplateMetadata;
