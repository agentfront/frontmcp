// file: libs/browser/src/plugins/hook-pipeline.ts
/**
 * Hook execution pipeline for browser MCP server.
 *
 * Manages the registration and execution of plugin hooks
 * with priority-based ordering.
 */

import type { BrowserHookStage, BrowserHookRegistration, BrowserHookContext, BrowserHook } from './browser-hook.types';

/**
 * Manages hook registrations and executes them in priority order.
 */
export class HookPipeline {
  private hooks = new Map<BrowserHookStage, BrowserHookRegistration[]>();

  /**
   * Register a hook for a stage.
   *
   * @param stage - The hook stage
   * @param hook - The hook function
   * @param priority - Priority (higher = runs first for 'will*', last for 'did*')
   * @param pluginName - Name of the plugin registering this hook
   */
  register<TParams = unknown, TResult = unknown>(
    stage: BrowserHookStage,
    hook: BrowserHook<TParams, TResult>,
    priority: number,
    pluginName: string,
  ): void {
    const registrations = this.hooks.get(stage) ?? [];
    registrations.push({
      stage,
      hook: hook as BrowserHook,
      priority,
      pluginName,
    });

    // Sort by priority
    // For 'will*' stages: higher priority runs first
    // For 'did*' stages: higher priority runs last
    const isWillStage = stage.startsWith('will');
    registrations.sort((a, b) => {
      if (isWillStage) {
        return b.priority - a.priority; // Descending for will
      }
      return a.priority - b.priority; // Ascending for did
    });

    this.hooks.set(stage, registrations);
  }

  /**
   * Unregister all hooks from a plugin.
   *
   * @param pluginName - Name of the plugin to remove hooks for
   */
  unregisterPlugin(pluginName: string): void {
    for (const [stage, registrations] of this.hooks.entries()) {
      const filtered = registrations.filter((r) => r.pluginName !== pluginName);
      if (filtered.length > 0) {
        this.hooks.set(stage, filtered);
      } else {
        this.hooks.delete(stage);
      }
    }
  }

  /**
   * Execute all hooks for a stage.
   *
   * Hooks are executed in priority order. Execution stops if a hook
   * calls `ctx.respond()` or `ctx.abort()`.
   *
   * @param ctx - The hook context
   * @returns The final flow action (continue, respond, or abort)
   */
  async execute<TParams, TResult>(
    ctx: BrowserHookContext<TParams, TResult>,
  ): Promise<BrowserHookContext<TParams, TResult>> {
    const registrations = this.hooks.get(ctx.stage);

    if (!registrations || registrations.length === 0) {
      return ctx;
    }

    for (const registration of registrations) {
      try {
        await registration.hook(ctx as BrowserHookContext);

        // Check if hook changed the flow
        if (ctx._flowAction.type !== 'continue') {
          break;
        }
      } catch (error) {
        // Hook threw an error - convert to abort
        ctx.abort(error instanceof Error ? error : new Error(String(error)));
        break;
      }
    }

    return ctx;
  }

  /**
   * Check if any hooks are registered for a stage.
   */
  hasHooks(stage: BrowserHookStage): boolean {
    const registrations = this.hooks.get(stage);
    return registrations !== undefined && registrations.length > 0;
  }

  /**
   * Get the number of hooks registered for a stage.
   */
  hookCount(stage: BrowserHookStage): number {
    return this.hooks.get(stage)?.length ?? 0;
  }

  /**
   * Get all registered stages.
   */
  getRegisteredStages(): BrowserHookStage[] {
    return Array.from(this.hooks.keys());
  }

  /**
   * Clear all hooks.
   */
  clear(): void {
    this.hooks.clear();
  }
}
