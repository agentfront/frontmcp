// file: libs/browser/src/plugins/index.ts
/**
 * Browser plugin system for @frontmcp/browser.
 *
 * Provides a plugin architecture for extending the browser MCP server
 * with custom tools, resources, prompts, and request lifecycle hooks.
 *
 * @example Basic plugin
 * ```typescript
 * import { BrowserPlugin } from '@frontmcp/browser';
 *
 * const loggingPlugin: BrowserPlugin = {
 *   name: 'logging',
 *   description: 'Logs all MCP requests/responses',
 *   hooks: {
 *     willHandle: (ctx) => {
 *       console.log('Request:', ctx.method, ctx.params);
 *     },
 *     didHandle: (ctx) => {
 *       console.log('Response:', ctx.result);
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
 *
 * @example Caching plugin
 * ```typescript
 * function createCachePlugin(ttl = 60000): BrowserPlugin {
 *   const cache = new Map<string, { value: unknown; expires: number }>();
 *
 *   return {
 *     name: 'cache',
 *     hooks: {
 *       willCallTool: (ctx) => {
 *         const key = `${ctx.params.name}:${JSON.stringify(ctx.params.arguments)}`;
 *         const cached = cache.get(key);
 *         if (cached && cached.expires > Date.now()) {
 *           ctx.respond(cached.value);
 *         }
 *       },
 *       didCallTool: (ctx) => {
 *         if (!ctx.error) {
 *           const key = `${ctx.params.name}:${JSON.stringify(ctx.params.arguments)}`;
 *           cache.set(key, { value: ctx.result, expires: Date.now() + ttl });
 *         }
 *       },
 *     },
 *   };
 * }
 * ```
 *
 * @packageDocumentation
 */

// Hook types
export type {
  BrowserHookStage,
  BrowserHook,
  BrowserHookContext,
  BrowserHookRegistration,
  BrowserPluginHooks,
  HookFlowAction,
} from './browser-hook.types';

export { createHookContext } from './browser-hook.types';

// Plugin types
export type {
  BrowserPlugin,
  BrowserPluginContext,
  BrowserPluginFactory,
  BrowserPluginType,
} from './browser-plugin.types';

export { isBrowserPlugin, isSDKPluginType, normalizeToBrowserPlugin } from './browser-plugin.types';

// Hook pipeline
export { HookPipeline } from './hook-pipeline';

// Plugin manager
export { PluginManager } from './plugin-manager';
export type { PluginManagerOptions } from './plugin-manager';
