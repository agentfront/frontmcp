// file: libs/browser/src/plugins/plugin-manager.ts
/**
 * Plugin manager for browser MCP server.
 *
 * Handles plugin registration, lifecycle, and dependency resolution.
 */

import type {
  BrowserMcpServer,
  BrowserToolDefinition,
  BrowserResourceDefinition,
  BrowserPromptDefinition,
} from '../server/browser-server';
import type { McpStore } from '../store';
import type { BrowserHookStage, BrowserPluginHooks } from './browser-hook.types';
import { createHookContext } from './browser-hook.types';
import type { BrowserPlugin, BrowserPluginContext, BrowserPluginType } from './browser-plugin.types';
import { normalizeToBrowserPlugin } from './browser-plugin.types';
import { HookPipeline } from './hook-pipeline';

/**
 * Options for creating a plugin manager.
 */
export interface PluginManagerOptions {
  /** Initial plugins to register */
  plugins?: BrowserPluginType[];

  /** Reference to the server (set later if not available at construction) */
  server?: BrowserMcpServer;

  /** Reference to the store */
  store?: McpStore<object>;
}

/**
 * Manages plugins for the browser MCP server.
 *
 * @example
 * ```typescript
 * const manager = new PluginManager({
 *   plugins: [loggingPlugin, cachePlugin],
 * });
 *
 * // Set server reference
 * manager.setServer(server);
 *
 * // Start all plugins
 * await manager.startAll();
 *
 * // Execute hooks during request handling
 * const ctx = await manager.executeHooks('willCallTool', method, params);
 * if (ctx._flowAction.type === 'respond') {
 *   return ctx._flowAction.result;
 * }
 * ```
 */
export class PluginManager {
  private plugins = new Map<string, BrowserPlugin>();
  private hookPipeline = new HookPipeline();
  private server?: BrowserMcpServer;
  private store?: McpStore<object>;
  private isStarted = false;

  constructor(options?: PluginManagerOptions) {
    this.server = options?.server;
    this.store = options?.store;

    // Register initial plugins
    if (options?.plugins) {
      for (const plugin of options.plugins) {
        this.registerSync(plugin);
      }
    }
  }

  /**
   * Set the server reference.
   * Required before calling lifecycle methods.
   */
  setServer(server: BrowserMcpServer): void {
    this.server = server;
  }

  /**
   * Set the store reference.
   */
  setStore(store: McpStore<object>): void {
    this.store = store;
  }

  /**
   * Register a plugin (sync version for constructor use).
   * Does not call onRegister lifecycle.
   */
  private registerSync(pluginType: BrowserPluginType): void {
    const plugin = normalizeToBrowserPlugin(pluginType);

    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }

    // Check dependencies
    if (plugin.dependencies) {
      for (const dep of plugin.dependencies) {
        if (!this.plugins.has(dep)) {
          throw new Error(`Plugin "${plugin.name}" requires "${dep}" which is not registered`);
        }
      }
    }

    this.plugins.set(plugin.name, plugin);
    this.registerHooks(plugin);
  }

  /**
   * Register a plugin.
   *
   * @param pluginType - Plugin to register (BrowserPlugin or SDK PluginType)
   */
  async register(pluginType: BrowserPluginType): Promise<void> {
    const plugin = normalizeToBrowserPlugin(pluginType);

    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }

    // Check dependencies
    if (plugin.dependencies) {
      for (const dep of plugin.dependencies) {
        if (!this.plugins.has(dep)) {
          throw new Error(`Plugin "${plugin.name}" requires "${dep}" which is not registered`);
        }
      }
    }

    this.plugins.set(plugin.name, plugin);
    this.registerHooks(plugin);

    // Call onRegister lifecycle
    if (plugin.onRegister) {
      await plugin.onRegister(this.createContext());
    }

    // If server is already started, call onStart
    if (this.isStarted && plugin.onStart) {
      await plugin.onStart(this.createContext());
    }
  }

  /**
   * Unregister a plugin.
   *
   * @param name - Plugin name to unregister
   */
  async unregister(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      return;
    }

    // Check if other plugins depend on this one
    for (const [otherName, otherPlugin] of this.plugins.entries()) {
      if (otherPlugin.dependencies?.includes(name)) {
        throw new Error(`Cannot unregister "${name}" - "${otherName}" depends on it`);
      }
    }

    // Call onStop if started
    if (this.isStarted && plugin.onStop) {
      await plugin.onStop(this.createContext());
    }

    // Call onUnregister
    if (plugin.onUnregister) {
      await plugin.onUnregister(this.createContext());
    }

    // Remove hooks and plugin
    this.hookPipeline.unregisterPlugin(name);
    this.plugins.delete(name);
  }

  /**
   * Get a registered plugin by name.
   */
  get<T extends BrowserPlugin>(name: string): T | undefined {
    return this.plugins.get(name) as T | undefined;
  }

  /**
   * Check if a plugin is registered.
   */
  has(name: string): boolean {
    return this.plugins.has(name);
  }

  /**
   * Get all registered plugins.
   */
  getAll(): BrowserPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Start all plugins.
   * Calls onStart lifecycle on each plugin.
   */
  async startAll(): Promise<void> {
    if (this.isStarted) {
      return;
    }

    for (const plugin of this.plugins.values()) {
      if (plugin.onStart) {
        await plugin.onStart(this.createContext());
      }
    }

    this.isStarted = true;
  }

  /**
   * Stop all plugins.
   * Calls onStop lifecycle on each plugin.
   */
  async stopAll(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    // Stop in reverse order of registration
    const plugins = Array.from(this.plugins.values()).reverse();
    for (const plugin of plugins) {
      if (plugin.onStop) {
        await plugin.onStop(this.createContext());
      }
    }

    this.isStarted = false;
  }

  /**
   * Collect all tools from registered plugins.
   */
  collectTools(): BrowserToolDefinition[] {
    const tools: BrowserToolDefinition[] = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.tools) {
        tools.push(...plugin.tools);
      }
    }
    return tools;
  }

  /**
   * Collect all resources from registered plugins.
   */
  collectResources(): BrowserResourceDefinition[] {
    const resources: BrowserResourceDefinition[] = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.resources) {
        resources.push(...plugin.resources);
      }
    }
    return resources;
  }

  /**
   * Collect all prompts from registered plugins.
   */
  collectPrompts(): BrowserPromptDefinition[] {
    const prompts: BrowserPromptDefinition[] = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.prompts) {
        prompts.push(...plugin.prompts);
      }
    }
    return prompts;
  }

  /**
   * Execute hooks for a stage.
   *
   * @param stage - The hook stage
   * @param method - The MCP method
   * @param params - Request parameters
   * @param result - Result (for 'did*' stages)
   * @param error - Error (for 'onError' stage)
   */
  async executeHooks<TParams, TResult>(
    stage: BrowserHookStage,
    method: string,
    params: TParams,
    result?: TResult,
    error?: Error,
  ) {
    if (!this.server) {
      throw new Error('Server not set on PluginManager');
    }

    const ctx = createHookContext<TParams, TResult>(stage, method, params, this.server, this.store, result, error);

    return this.hookPipeline.execute(ctx);
  }

  /**
   * Check if any hooks are registered for a stage.
   */
  hasHooks(stage: BrowserHookStage): boolean {
    return this.hookPipeline.hasHooks(stage);
  }

  /**
   * Register hooks from a plugin.
   */
  private registerHooks(plugin: BrowserPlugin): void {
    if (!plugin.hooks) {
      return;
    }

    const hookStages: (keyof BrowserPluginHooks)[] = [
      'willHandle',
      'didHandle',
      'willListTools',
      'didListTools',
      'willCallTool',
      'didCallTool',
      'willListResources',
      'didListResources',
      'willReadResource',
      'didReadResource',
      'willListPrompts',
      'didListPrompts',
      'willGetPrompt',
      'didGetPrompt',
      'onError',
    ];

    for (const stage of hookStages) {
      const hook = plugin.hooks[stage];
      if (hook) {
        // Cast to generic BrowserHook since we're storing in a unified registry
        this.hookPipeline.register(
          stage as BrowserHookStage,
          hook as (ctx: import('./browser-hook.types').BrowserHookContext) => void | Promise<void>,
          0, // Default priority
          plugin.name,
        );
      }
    }
  }

  /**
   * Create plugin context for lifecycle callbacks.
   */
  private createContext(): BrowserPluginContext {
    return {
      server: this.server!,
      store: this.store,
      getPlugin: <T extends BrowserPlugin>(name: string) => this.get<T>(name),
    };
  }
}
