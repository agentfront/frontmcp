// file: libs/browser/src/plugins/browser-plugin.types.ts
/**
 * Browser plugin types that extend SDK plugin system.
 *
 * This provides a simplified plugin interface for browser while
 * maintaining compatibility with SDK plugin patterns.
 */

import type { PluginMetadata, PluginType } from '@frontmcp/sdk/core';
import type {
  BrowserMcpServer,
  BrowserToolDefinition,
  BrowserResourceDefinition,
  BrowserPromptDefinition,
} from '../server/browser-server';
import type { McpStore } from '../store';
import type { BrowserPluginHooks } from './browser-hook.types';

/**
 * Context available to plugins during lifecycle.
 */
export interface BrowserPluginContext {
  /** Reference to the MCP server */
  readonly server: BrowserMcpServer;

  /** Reference to the store (if configured) */
  readonly store?: McpStore<object>;

  /**
   * Get another registered plugin by name.
   * Useful for plugin dependencies.
   */
  getPlugin<T extends BrowserPlugin>(name: string): T | undefined;
}

/**
 * Browser-specific plugin interface.
 *
 * Plugins can provide tools, resources, prompts, lifecycle hooks,
 * and intercept the MCP request/response cycle.
 *
 * @example Simple plugin
 * ```typescript
 * const loggingPlugin: BrowserPlugin = {
 *   name: 'logging',
 *   description: 'Logs all MCP requests',
 *   hooks: {
 *     willHandle: (ctx) => {
 *       console.log('Request:', ctx.method, ctx.params);
 *     },
 *   },
 * };
 * ```
 *
 * @example Plugin with tools
 * ```typescript
 * const greetPlugin: BrowserPlugin = {
 *   name: 'greet',
 *   tools: [{
 *     name: 'greet',
 *     description: 'Greet someone',
 *     inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
 *     handler: async (args) => `Hello, ${args.name}!`,
 *   }],
 * };
 * ```
 */
export interface BrowserPlugin {
  /**
   * Unique plugin name.
   * Used for identification and dependency resolution.
   */
  readonly name: string;

  /**
   * Optional description of what the plugin does.
   */
  readonly description?: string;

  /**
   * Optional version string.
   */
  readonly version?: string;

  /**
   * Plugin dependencies (other plugin names that must be loaded first).
   */
  readonly dependencies?: string[];

  /**
   * Tools provided by this plugin.
   */
  tools?: BrowserToolDefinition[];

  /**
   * Resources provided by this plugin.
   */
  resources?: BrowserResourceDefinition[];

  /**
   * Prompts provided by this plugin.
   */
  prompts?: BrowserPromptDefinition[];

  /**
   * Lifecycle hooks for intercepting MCP requests.
   */
  hooks?: BrowserPluginHooks;

  /**
   * Called when the plugin is registered with the server.
   * Use for initialization that doesn't require the server to be started.
   */
  onRegister?(context: BrowserPluginContext): void | Promise<void>;

  /**
   * Called when the server starts.
   * Use for initialization that requires the server to be running.
   */
  onStart?(context: BrowserPluginContext): void | Promise<void>;

  /**
   * Called when the server stops.
   * Use for cleanup.
   */
  onStop?(context: BrowserPluginContext): void | Promise<void>;

  /**
   * Called when the plugin is unregistered.
   * Use for final cleanup.
   */
  onUnregister?(context: BrowserPluginContext): void | Promise<void>;
}

/**
 * Factory function for creating plugins with configuration.
 *
 * @example
 * ```typescript
 * function createCachePlugin(options: { ttl: number }): BrowserPlugin {
 *   const cache = new Map();
 *   return {
 *     name: 'cache',
 *     hooks: {
 *       willCallTool: (ctx) => {
 *         const cached = cache.get(ctx.params.name);
 *         if (cached) ctx.respond(cached);
 *       },
 *     },
 *   };
 * }
 * ```
 */
export type BrowserPluginFactory<TOptions = unknown> = (options: TOptions) => BrowserPlugin;

/**
 * Plugin registration type - can be a plugin object, class, or factory result.
 */
export type BrowserPluginType = BrowserPlugin | PluginType;

/**
 * Checks if a value is a BrowserPlugin object.
 */
export function isBrowserPlugin(value: unknown): value is BrowserPlugin {
  return (
    typeof value === 'object' && value !== null && 'name' in value && typeof (value as BrowserPlugin).name === 'string'
  );
}

/**
 * Checks if a value is an SDK PluginType (class with @Plugin decorator).
 */
export function isSDKPluginType(value: unknown): value is PluginType {
  // SDK plugins are typically classes or objects with 'provide' property
  return typeof value === 'function' || (typeof value === 'object' && value !== null && 'provide' in value);
}

/**
 * Normalize a plugin to BrowserPlugin format.
 * Handles SDK PluginType conversion.
 */
export function normalizeToBrowserPlugin(plugin: BrowserPluginType): BrowserPlugin {
  if (isBrowserPlugin(plugin)) {
    return plugin;
  }

  // Handle SDK plugin types
  if (typeof plugin === 'function') {
    // Class with @Plugin decorator
    const metadata = extractPluginMetadata(plugin);
    const instance = new (plugin as new () => unknown)();

    return {
      name: metadata?.name ?? plugin.name,
      description: metadata?.description,
      tools: metadata?.tools as BrowserToolDefinition[] | undefined,
      resources: metadata?.resources as BrowserResourceDefinition[] | undefined,
      prompts: metadata?.prompts as BrowserPromptDefinition[] | undefined,
      // Copy lifecycle methods if they exist on the instance
      onRegister: (instance as BrowserPlugin).onRegister?.bind(instance),
      onStart: (instance as BrowserPlugin).onStart?.bind(instance),
      onStop: (instance as BrowserPlugin).onStop?.bind(instance),
      onUnregister: (instance as BrowserPlugin).onUnregister?.bind(instance),
    };
  }

  if ('provide' in plugin && 'useValue' in plugin) {
    // Value plugin type
    const value = (plugin as { useValue: unknown }).useValue;
    if (isBrowserPlugin(value as unknown)) {
      return value as unknown as BrowserPlugin;
    }
  }

  throw new Error(`Cannot normalize plugin: ${JSON.stringify(plugin)}`);
}

/**
 * Extract PluginMetadata from a class decorated with @Plugin.
 */
function extractPluginMetadata(cls: Function): PluginMetadata | undefined {
  try {
    // Try to get metadata via reflect-metadata
    const name = Reflect.getMetadata('frontmcp:plugin:name', cls);
    if (name) {
      return {
        name,
        description: Reflect.getMetadata('frontmcp:plugin:description', cls),
        tools: Reflect.getMetadata('frontmcp:plugin:tools', cls),
        resources: Reflect.getMetadata('frontmcp:plugin:resources', cls),
        prompts: Reflect.getMetadata('frontmcp:plugin:prompts', cls),
        providers: Reflect.getMetadata('frontmcp:plugin:providers', cls),
      };
    }
  } catch {
    // reflect-metadata not available
  }

  return undefined;
}
