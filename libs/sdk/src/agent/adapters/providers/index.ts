/**
 * LLM Provider Factories
 *
 * Creates adapters based on provider configuration using the official SDKs.
 * OpenAI and Anthropic are supported via optional peer dependencies.
 */

export * from './types';

import {
  AgentLlmAdapter,
  AgentPrompt,
  AgentToolDefinition,
  AgentCompletionOptions,
  AgentCompletion,
  AgentCompletionChunk,
} from '../../../common';
import { LlmAdapterError } from '../base.adapter';
import { OpenAIAdapter } from '../openai.adapter';
import { AnthropicAdapter } from '../anthropic.adapter';
import type { LlmProvider, ProviderCommonOptions } from './types';

/**
 * Options for creating a provider-based adapter.
 */
export interface CreateProviderAdapterOptions extends ProviderCommonOptions {
  /** The LLM provider to use. */
  provider: LlmProvider;
  /** The model identifier (e.g., 'gpt-4o', 'claude-sonnet-4-20250514'). */
  model: string;
  /** API key for the provider. */
  apiKey: string;
  /**
   * Custom base URL for the API endpoint.
   * Useful for OpenAI-compatible providers (Groq, Mistral, etc.).
   */
  baseUrl?: string;
}

/**
 * Create an adapter for the specified provider.
 */
export async function createProviderAdapter(options: CreateProviderAdapterOptions): Promise<AgentLlmAdapter> {
  return createProviderAdapterSync(options);
}

/**
 * Create an adapter synchronously.
 * Used internally by the adapter factory for synchronous contexts.
 */
export function createProviderAdapterSync(options: CreateProviderAdapterOptions): AgentLlmAdapter {
  // For providers that need deferred init (e.g. dynamic import), use DeferredProviderAdapter
  return new DeferredProviderAdapter(options);
}

/**
 * Create the actual adapter instance for a provider.
 */
function createAdapterForProvider(options: CreateProviderAdapterOptions): AgentLlmAdapter {
  const { provider, model, apiKey, baseUrl, temperature, maxTokens } = options;

  switch (provider) {
    case 'openai':
      return new OpenAIAdapter({
        model,
        apiKey,
        baseUrl,
        temperature,
        maxTokens,
      });

    case 'anthropic':
      return new AnthropicAdapter({
        model,
        apiKey,
        baseUrl,
        temperature,
        maxTokens,
      });

    default:
      throw new LlmAdapterError(
        `Unknown provider: ${provider}. Supported providers: openai, anthropic.\n\n` +
          'For other providers (Google, Mistral, Groq, etc.), use one of:\n' +
          '  - OpenAI adapter with baseUrl (most providers are OpenAI-compatible)\n' +
          '  - Custom AgentLlmAdapter implementation\n',
        'config',
        'unknown_provider',
      );
  }
}

/**
 * A deferred adapter that initializes the real adapter on first use.
 */
class DeferredProviderAdapter implements AgentLlmAdapter {
  private _adapter: AgentLlmAdapter | null = null;

  constructor(private readonly options: CreateProviderAdapterOptions) {}

  private getAdapter(): AgentLlmAdapter {
    if (this._adapter) {
      return this._adapter;
    }
    this._adapter = createAdapterForProvider(this.options);
    return this._adapter;
  }

  async completion(
    prompt: AgentPrompt,
    tools?: AgentToolDefinition[],
    options?: AgentCompletionOptions,
  ): Promise<AgentCompletion> {
    return this.getAdapter().completion(prompt, tools, options);
  }

  async *streamCompletion(
    prompt: AgentPrompt,
    tools?: AgentToolDefinition[],
    options?: AgentCompletionOptions,
  ): AsyncGenerator<AgentCompletionChunk> {
    const adapter = this.getAdapter();
    if (adapter.streamCompletion) {
      yield* adapter.streamCompletion(prompt, tools, options);
    } else {
      // Fallback to non-streaming
      const result = await adapter.completion(prompt, tools, options);

      if (result.toolCalls) {
        for (const toolCall of result.toolCalls) {
          yield {
            type: 'tool_call' as const,
            toolCall: { id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments },
          };
        }
      }

      if (result.content) {
        yield { type: 'content' as const, content: result.content };
      }

      yield { type: 'done' as const, completion: result };
    }
  }
}
