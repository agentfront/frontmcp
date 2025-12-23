/**
 * Platform Adapters Module
 *
 * Exports all platform adapters and the default registration function.
 *
 * @packageDocumentation
 */
export { BaseAdapter, DEFAULT_CAPABILITIES, DEFAULT_SAFE_AREA } from './base-adapter';
export { OpenAIAdapter, createOpenAIAdapter } from './openai.adapter';
export { ExtAppsAdapter, createExtAppsAdapter, type ExtAppsAdapterConfig } from './ext-apps.adapter';
export { ClaudeAdapter, createClaudeAdapter } from './claude.adapter';
export { GeminiAdapter, createGeminiAdapter } from './gemini.adapter';
export { GenericAdapter, createGenericAdapter } from './generic.adapter';
/**
 * Register all built-in adapters with the default registry.
 * Called automatically when importing from '@frontmcp/ui/bridge'.
 *
 * Adapter priority order:
 * 1. OpenAI (100) - ChatGPT Apps SDK
 * 2. ext-apps (80) - SEP-1865 protocol
 * 3. Claude (60) - Anthropic Claude
 * 4. Gemini (40) - Google Gemini
 * 5. Generic (0) - Fallback
 */
export declare function registerBuiltInAdapters(): void;
//# sourceMappingURL=index.d.ts.map
