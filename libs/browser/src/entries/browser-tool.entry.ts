// file: libs/browser/src/entries/browser-tool.entry.ts
/**
 * Browser-specific ToolEntry extension.
 *
 * Extends SDK's ToolEntry with browser-specific methods for accessing
 * Valtio stores, component registries, and renderer registries.
 *
 * @example
 * ```typescript
 * import { BrowserToolEntry } from '@frontmcp/browser';
 * import { z } from 'zod';
 *
 * class MyTool extends BrowserToolEntry<typeof inputSchema, typeof outputSchema> {
 *   static metadata = {
 *     name: 'my-tool',
 *     description: 'A browser-native tool',
 *     inputSchema: z.object({ query: z.string() }),
 *   };
 *
 *   async execute(input: { query: string }) {
 *     // Access reactive store
 *     const store = this.getStore<AppState>();
 *     store.lastQuery = input.query;
 *
 *     return { result: 'success' };
 *   }
 * }
 * ```
 */

import { ToolEntry } from '@frontmcp/sdk/core';
import type { ToolMetadata, ToolInputType, ToolOutputType } from '@frontmcp/sdk/core';

// Forward declare types for browser context
// These are minimal interfaces - the actual implementations are in ./registry and ./store
interface BrowserStoreMinimal<T extends object = object> {
  state: T;
  getSnapshot(): T;
  subscribe(listener: (state: T) => void): () => void;
  subscribeKey<K extends keyof T>(key: K, listener: (value: T[K]) => void): () => void;
}

interface ComponentRegistryMinimal {
  register(name: string, component: unknown): void;
  get(name: string): unknown | undefined;
  has(name: string): boolean;
  list(): string[];
}

interface RendererRegistryMinimal {
  register(name: string, renderer: unknown): void;
  get(name: string): unknown | undefined;
  has(name: string): boolean;
  list(): string[];
}

// Export BrowserStore for use by other entries
// ComponentRegistry and RendererRegistry are NOT exported here as they are exported from ./registry
export type BrowserStore<T extends object = object> = BrowserStoreMinimal<T>;
type ComponentRegistry = ComponentRegistryMinimal;
type RendererRegistry = RendererRegistryMinimal;

export interface UIResourceOptions {
  component: string;
  props?: Record<string, unknown>;
  renderer?: string;
}

/**
 * Browser-specific ToolEntry extension.
 *
 * Provides access to:
 * - Valtio reactive stores via `getStore<T>()`
 * - Component registries via `getComponentRegistry()`
 * - Renderer registries via `getRendererRegistry()`
 * - UI resource creation via `createUIResource()`
 */
export abstract class BrowserToolEntry<
  InSchema extends ToolInputType = ToolInputType,
  OutSchema extends ToolOutputType = ToolOutputType,
> extends ToolEntry<InSchema, OutSchema> {
  /**
   * Storage for browser-specific context.
   * Set by BrowserMcpServer during tool registration.
   */
  private _browserContext?: {
    store?: BrowserStore<object>;
    componentRegistry?: ComponentRegistry;
    rendererRegistry?: RendererRegistry;
  };

  /**
   * Set browser context. Called by BrowserMcpServer during registration.
   * @internal
   */
  setBrowserContext(context: {
    store?: BrowserStore<object>;
    componentRegistry?: ComponentRegistry;
    rendererRegistry?: RendererRegistry;
  }): void {
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
   *   count: number;
   *   items: string[];
   * }
   *
   * async execute(input: Input) {
   *   const store = this.getStore<AppState>();
   *   store.state.count++;
   *   return { count: store.state.count };
   * }
   * ```
   */
  getStore<T extends object>(): BrowserStore<T> {
    if (!this._browserContext?.store) {
      throw new Error('Store not available. Ensure tool is registered with BrowserMcpServer.');
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
   * Get the component registry for UI component access.
   *
   * @returns The component registry instance
   * @throws Error if component registry is not available
   */
  getComponentRegistry(): ComponentRegistry {
    if (!this._browserContext?.componentRegistry) {
      throw new Error('Component registry not available. Ensure tool is registered with BrowserMcpServer.');
    }
    return this._browserContext.componentRegistry;
  }

  /**
   * Try to get the component registry, returning undefined if not available.
   *
   * @returns The component registry instance or undefined
   */
  tryGetComponentRegistry(): ComponentRegistry | undefined {
    return this._browserContext?.componentRegistry;
  }

  /**
   * Get the renderer registry for output rendering.
   *
   * @returns The renderer registry instance
   * @throws Error if renderer registry is not available
   */
  getRendererRegistry(): RendererRegistry {
    if (!this._browserContext?.rendererRegistry) {
      throw new Error('Renderer registry not available. Ensure tool is registered with BrowserMcpServer.');
    }
    return this._browserContext.rendererRegistry;
  }

  /**
   * Try to get the renderer registry, returning undefined if not available.
   *
   * @returns The renderer registry instance or undefined
   */
  tryGetRendererRegistry(): RendererRegistry | undefined {
    return this._browserContext?.rendererRegistry;
  }

  /**
   * Create a UI resource reference from a component.
   *
   * This is a convenience method for creating structured output that
   * can be rendered by the UI layer.
   *
   * @param options - UI resource options
   * @returns UI resource reference object
   *
   * @example
   * ```typescript
   * async execute(input: Input) {
   *   return this.createUIResource({
   *     component: 'DataTable',
   *     props: { data: input.items, columns: ['name', 'value'] },
   *     renderer: 'html',
   *   });
   * }
   * ```
   */
  createUIResource(options: UIResourceOptions): {
    type: 'ui-resource';
    component: string;
    props: Record<string, unknown>;
    renderer?: string;
  } {
    return {
      type: 'ui-resource',
      component: options.component,
      props: options.props ?? {},
      renderer: options.renderer,
    };
  }

  /**
   * Check if browser context is available.
   *
   * @returns True if running in browser context with store/registries
   */
  hasBrowserContext(): boolean {
    return this._browserContext !== undefined;
  }
}

/**
 * Type helper for browser tool metadata.
 */
export type BrowserToolMetadata<
  InSchema extends ToolInputType = ToolInputType,
  OutSchema extends ToolOutputType = ToolOutputType,
> = ToolMetadata<InSchema, OutSchema>;
