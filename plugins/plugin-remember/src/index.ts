/**
 * RememberPlugin - Stateful Session Memory for FrontMCP
 *
 * Provides encrypted, session-scoped storage with human-friendly API.
 * Enables LLMs and tools to "remember" things across sessions.
 *
 * @example
 * ```typescript
 * import { RememberPlugin } from '@frontmcp/plugins/remember';
 *
 * // Configure the plugin
 * @FrontMcp({
 *   plugins: [
 *     RememberPlugin.init({
 *       type: 'memory',
 *       tools: { enabled: true },
 *     }),
 *   ],
 * })
 * class MyServer {}
 *
 * // Use in a tool - this.remember is available when plugin is installed
 * class MyTool extends ToolContext {
 *   async execute(input) {
 *     // Direct property access (throws if plugin not installed)
 *     await this.remember.set('key', 'value');
 *     const value = await this.remember.get('key');
 *
 *     // Check if something is remembered
 *     if (await this.remember.knows('onboarding_complete')) {
 *       // Skip onboarding
 *     }
 *
 *     // Forget something
 *     await this.remember.forget('temp_data');
 *   }
 * }
 * ```
 *
 * @packageDocumentation
 */

// Main plugin (export both default and named for consistency with other plugins)
export { default, default as RememberPlugin } from './remember.plugin';

// Symbols (DI tokens)
export { RememberStoreToken, RememberConfigToken, RememberAccessorToken } from './remember.symbols';

// Types
export type {
  RememberScope,
  RememberEntry,
  RememberPluginOptions,
  RememberPluginOptionsInput,
  RememberSetOptions,
  RememberGetOptions,
  RememberForgetOptions,
  RememberKnowsOptions,
  RememberListOptions,
  BrandedPayload,
  ApprovalPayload,
  PreferencePayload,
  CachePayload,
  StatePayload,
  ConversationPayload,
  CustomPayload,
  PayloadBrandType,
} from './remember.types';

// Brand helper
export { brand } from './remember.types';

// Providers
export type { RememberStoreInterface } from './providers/remember-store.interface';
export { RememberAccessor } from './providers/remember-accessor.provider';
export { default as RememberMemoryProvider } from './providers/remember-memory.provider';
export { default as RememberRedisProvider } from './providers/remember-redis.provider';
export { default as RememberVercelKvProvider } from './providers/remember-vercel-kv.provider';

// Tools
export { RememberThisTool, RecallTool, ForgetTool, ListMemoriesTool } from './tools';

// Context Extension Types & Helper Functions
// TypeScript types for this.remember are declared in remember.context-extension.ts
// SDK handles runtime installation via contextExtensions in plugin metadata
export { getRemember, tryGetRemember } from './remember.context-extension';

// For tool approval workflows, use @frontmcp/plugin-approval
