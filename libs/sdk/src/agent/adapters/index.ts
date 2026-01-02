/**
 * LLM adapters for FrontMCP agents.
 *
 * FrontMCP uses LangChain as the standard adapter layer for LLM integration.
 * This provides:
 * - Consistent API across all providers (OpenAI, Anthropic, Google, Mistral, etc.)
 * - Built-in retry logic and error handling
 * - Streaming support
 * - Tool/function calling support
 * - Token counting and usage tracking
 *
 * @example Using with OpenAI
 * ```typescript
 * import { ChatOpenAI } from '@langchain/openai';
 * import { LangChainAdapter } from '@frontmcp/sdk';
 *
 * @Agent({
 *   name: 'my-agent',
 *   llm: {
 *     adapter: new LangChainAdapter({
 *       model: new ChatOpenAI({
 *         model: 'gpt-4-turbo',
 *         openAIApiKey: process.env.OPENAI_API_KEY,
 *       }),
 *     }),
 *   },
 * })
 * ```
 *
 * @example Using built-in shorthand
 * ```typescript
 * @Agent({
 *   name: 'my-agent',
 *   llm: {
 *     adapter: 'langchain',
 *     provider: 'openai',
 *     model: 'gpt-4-turbo',
 *     apiKey: { env: 'OPENAI_API_KEY' },
 *   },
 * })
 * ```
 */

// Base adapter utilities
export {
  BaseLlmAdapter,
  BaseLlmAdapterConfig,
  LlmAdapterError,
  LlmRateLimitError,
  LlmContextLengthError,
} from './base.adapter';

// LangChain adapter (primary adapter)
export { LangChainAdapter, LangChainAdapterConfig } from './langchain.adapter';

// Adapter factory
export {
  createAdapter,
  CreateAdapterOptions,
  ConfigResolver,
  ProviderResolver,
  resolveApiKey,
  resolveStringValue,
  isBuiltinConfig,
  isAdapterConfig,
  isTokenConfig,
  isAdapterInstance,
} from './adapter.factory';

// Re-export core LLM types for convenience
export {
  AgentLlmAdapter,
  AgentPrompt,
  AgentMessage,
  AgentCompletion,
  AgentCompletionChunk,
  AgentToolCall,
  AgentToolDefinition,
  AgentCompletionOptions,
  LLM_ADAPTER,
} from '../../common/interfaces/llm-adapter.interface';
