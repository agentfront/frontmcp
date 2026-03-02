/**
 * @frontmcp/plugin-remember - Browser Entry Point
 *
 * Provides the browser-compatible subset of the remember plugin.
 * Only memory-based storage is available in the browser — Redis and Vercel KV are excluded.
 *
 * @packageDocumentation
 */

// Main plugin
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

// Providers (memory only for browser)
export type { RememberStoreInterface } from './providers/remember-store.interface';
export { RememberAccessor } from './providers/remember-accessor.provider';
export { default as RememberMemoryProvider } from './providers/remember-memory.provider';

// Tools
export { RememberThisTool, RecallTool, ForgetTool, ListMemoriesTool } from './tools';

// Context Extension Types & Helper Functions
export { getRemember, tryGetRemember } from './remember.context-extension';
