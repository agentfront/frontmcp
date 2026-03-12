/**
 * LLM adapters for FrontMCP agents.
 *
 * FrontMCP provides direct adapters for OpenAI and Anthropic SDKs.
 * For other providers, implement the `AgentLlmAdapter` interface
 * or use the OpenAI adapter with a custom `baseUrl` (most providers
 * are OpenAI-compatible).
 *
 * @example Using built-in shorthand
 * ```typescript
 * @Agent({
 *   name: 'my-agent',
 *   llm: {
 *     provider: 'openai',
 *     model: 'gpt-4o',
 *     apiKey: { env: 'OPENAI_API_KEY' },
 *   },
 * })
 * ```
 *
 * @example Using OpenAI adapter directly
 * ```typescript
 * import { OpenAIAdapter } from '@frontmcp/sdk';
 *
 * @Agent({
 *   name: 'my-agent',
 *   llm: {
 *     adapter: new OpenAIAdapter({
 *       model: 'gpt-4o',
 *       apiKey: process.env.OPENAI_API_KEY,
 *     }),
 *   },
 * })
 * ```
 *
 * @example Using Anthropic adapter directly
 * ```typescript
 * import { AnthropicAdapter } from '@frontmcp/sdk';
 *
 * @Agent({
 *   name: 'my-agent',
 *   llm: {
 *     adapter: new AnthropicAdapter({
 *       model: 'claude-sonnet-4-20250514',
 *       apiKey: process.env.ANTHROPIC_API_KEY,
 *     }),
 *   },
 * })
 * ```
 */

// Base adapter utilities
export { BaseLlmAdapter, LlmAdapterError, LlmRateLimitError, LlmContextLengthError } from './base.adapter';
export type { BaseLlmAdapterConfig } from './base.adapter';

// OpenAI adapter
export { OpenAIAdapter } from './openai.adapter';
export type { OpenAIAdapterConfig, OpenAIApiMode } from './openai.adapter';

// Anthropic adapter
export { AnthropicAdapter } from './anthropic.adapter';
export type { AnthropicAdapterConfig } from './anthropic.adapter';

// Adapter factory
export {
  createAdapter,
  resolveApiKey,
  resolveStringValue,
  isBuiltinConfig,
  isAdapterConfig,
  isTokenConfig,
  isAdapterInstance,
} from './adapter.factory';
export type { CreateAdapterOptions, ConfigResolver, ProviderResolver } from './adapter.factory';

// Re-export core LLM types for convenience
export { LLM_ADAPTER } from '../../common/interfaces/llm-adapter.interface';
export type {
  AgentLlmAdapter,
  AgentPrompt,
  AgentMessage,
  AgentCompletion,
  AgentCompletionChunk,
  AgentToolCall,
  AgentToolDefinition,
  AgentCompletionOptions,
} from '../../common/interfaces/llm-adapter.interface';
