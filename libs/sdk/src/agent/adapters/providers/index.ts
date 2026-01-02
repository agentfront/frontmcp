/**
 * LLM Provider Factories
 *
 * Auto-creates LangChain adapters based on provider configuration.
 * OpenAI and Anthropic are included by default, other providers use dynamic imports.
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
import { LangChainAdapter, LangChainChatModel } from '../langchain.adapter';
import type { LlmProvider, ProviderCommonOptions } from './types';

// Static imports for built-in providers (OpenAI and Anthropic)
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';

/**
 * Options for creating a provider-based adapter.
 */
export interface CreateProviderAdapterOptions extends ProviderCommonOptions {
  /** The LLM provider to use. */
  provider: LlmProvider;
  /** The model identifier (e.g., 'gpt-4-turbo', 'claude-3-opus'). */
  model: string;
  /** API key for the provider. */
  apiKey: string;
  /**
   * Custom base URL for the API endpoint.
   * **Note: Only supported for OpenAI provider.** This option is silently ignored for other providers.
   * Use this for OpenAI-compatible APIs or self-hosted endpoints.
   */
  baseUrl?: string;
}

/**
 * Provider package mapping for optional providers (dynamic import).
 */
const OPTIONAL_PROVIDER_PACKAGES: Partial<
  Record<LlmProvider, { package: string; className: string; apiKeyProp: string }>
> = {
  google: { package: '@langchain/google-genai', className: 'ChatGoogleGenerativeAI', apiKeyProp: 'apiKey' },
  mistral: { package: '@langchain/mistralai', className: 'ChatMistralAI', apiKeyProp: 'apiKey' },
  groq: { package: '@langchain/groq', className: 'ChatGroq', apiKeyProp: 'apiKey' },
};

/**
 * Dynamically import an optional LangChain provider package.
 */
async function importOptionalProvider(provider: LlmProvider): Promise<Record<string, unknown>> {
  const providerInfo = OPTIONAL_PROVIDER_PACKAGES[provider];
  if (!providerInfo) {
    throw new LlmAdapterError(`Provider ${provider} is not available for dynamic import`, 'config', 'unknown_provider');
  }

  try {
    return await import(providerInfo.package);
  } catch {
    throw new LlmAdapterError(
      `LangChain provider package not installed.\n\n` +
        `To use the '${provider}' provider, install the required package:\n\n` +
        `  npm install ${providerInfo.package}\n` +
        `  # or\n` +
        `  yarn add ${providerInfo.package}\n\n` +
        `Then you can use:\n` +
        `  llm: {\n` +
        `    provider: '${provider}',\n` +
        `    model: 'your-model',\n` +
        `    apiKey: { env: 'YOUR_API_KEY' },\n` +
        `  }`,
      'config',
      'missing_provider_package',
    );
  }
}

/**
 * Create a LangChain adapter for the specified provider.
 * OpenAI and Anthropic are built-in, other providers require package installation.
 */
export async function createProviderAdapter(options: CreateProviderAdapterOptions): Promise<AgentLlmAdapter> {
  const { provider, model, apiKey, baseUrl, temperature, maxTokens } = options;

  let chatModel: LangChainChatModel;

  switch (provider) {
    case 'openai': {
      const config: Record<string, unknown> = {
        model,
        openAIApiKey: apiKey,
      };
      if (temperature !== undefined) config['temperature'] = temperature;
      if (maxTokens !== undefined) config['maxTokens'] = maxTokens;
      if (baseUrl) config['configuration'] = { baseURL: baseUrl };
      chatModel = new ChatOpenAI(config) as unknown as LangChainChatModel;
      break;
    }

    case 'anthropic': {
      const config: Record<string, unknown> = {
        model,
        anthropicApiKey: apiKey,
      };
      if (temperature !== undefined) config['temperature'] = temperature;
      if (maxTokens !== undefined) config['maxTokens'] = maxTokens;
      chatModel = new ChatAnthropic(config) as unknown as LangChainChatModel;
      break;
    }

    case 'google':
    case 'mistral':
    case 'groq': {
      // Dynamic import for optional providers
      const providerInfo = OPTIONAL_PROVIDER_PACKAGES[provider]!;
      const providerModule = await importOptionalProvider(provider);
      const ChatModelClass = providerModule[providerInfo.className] as new (config: Record<string, unknown>) => unknown;

      if (!ChatModelClass) {
        throw new LlmAdapterError(
          `Could not find ${providerInfo.className} in ${providerInfo.package}`,
          'config',
          'missing_class',
        );
      }

      const config: Record<string, unknown> = {
        model,
        [providerInfo.apiKeyProp]: apiKey,
      };
      if (temperature !== undefined) config['temperature'] = temperature;
      if (maxTokens !== undefined) {
        config[provider === 'google' ? 'maxOutputTokens' : 'maxTokens'] = maxTokens;
      }

      chatModel = new ChatModelClass(config) as LangChainChatModel;
      break;
    }

    default:
      throw new LlmAdapterError(
        `Unknown provider: ${provider}. Supported providers: openai, anthropic, google, mistral, groq`,
        'config',
        'unknown_provider',
      );
  }

  return new LangChainAdapter({ model: chatModel });
}

/**
 * Synchronous version that throws if provider needs async loading.
 * Used internally by the adapter factory for synchronous contexts.
 */
export function createProviderAdapterSync(options: CreateProviderAdapterOptions): AgentLlmAdapter {
  // For now, we'll create a deferred adapter that initializes on first use
  // This allows synchronous creation while still supporting dynamic imports
  return new DeferredProviderAdapter(options);
}

/**
 * A deferred adapter that initializes the real adapter on first use.
 */
class DeferredProviderAdapter implements AgentLlmAdapter {
  private _adapter: AgentLlmAdapter | null = null;
  private _initPromise: Promise<AgentLlmAdapter> | null = null;

  constructor(private readonly options: CreateProviderAdapterOptions) {}

  private async getAdapter(): Promise<AgentLlmAdapter> {
    if (this._adapter) {
      return this._adapter;
    }

    if (!this._initPromise) {
      this._initPromise = createProviderAdapter(this.options).then((adapter) => {
        this._adapter = adapter;
        return adapter;
      });
    }

    return this._initPromise;
  }

  async completion(
    prompt: AgentPrompt,
    tools?: AgentToolDefinition[],
    options?: AgentCompletionOptions,
  ): Promise<AgentCompletion> {
    const adapter = await this.getAdapter();
    return adapter.completion(prompt, tools, options);
  }

  async *streamCompletion(
    prompt: AgentPrompt,
    tools?: AgentToolDefinition[],
    options?: AgentCompletionOptions,
  ): AsyncGenerator<AgentCompletionChunk> {
    const adapter = await this.getAdapter();
    if (adapter.streamCompletion) {
      yield* adapter.streamCompletion(prompt, tools, options);
    } else {
      // Fallback to non-streaming - yield chunks in sequence
      const result = await adapter.completion(prompt, tools, options);

      // Yield tool calls
      if (result.toolCalls) {
        for (const toolCall of result.toolCalls) {
          yield {
            type: 'tool_call' as const,
            toolCall: { id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments },
          };
        }
      }

      // Yield content if any
      if (result.content) {
        yield {
          type: 'content' as const,
          content: result.content,
        };
      }

      // Yield done with full completion
      yield {
        type: 'done' as const,
        completion: result,
      };
    }
  }
}
