/**
 * LLM Provider Factories
 *
 * Auto-creates LangChain adapters based on provider configuration.
 * Uses dynamic imports to only load providers when needed.
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

/**
 * Options for creating a provider-based adapter.
 */
export interface CreateProviderAdapterOptions extends ProviderCommonOptions {
  provider: LlmProvider;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

/**
 * Provider package mapping.
 */
const PROVIDER_PACKAGES: Record<LlmProvider, { package: string; className: string; apiKeyProp: string }> = {
  openai: { package: '@langchain/openai', className: 'ChatOpenAI', apiKeyProp: 'openAIApiKey' },
  anthropic: { package: '@langchain/anthropic', className: 'ChatAnthropic', apiKeyProp: 'anthropicApiKey' },
  google: { package: '@langchain/google-genai', className: 'ChatGoogleGenerativeAI', apiKeyProp: 'apiKey' },
  mistral: { package: '@langchain/mistralai', className: 'ChatMistralAI', apiKeyProp: 'apiKey' },
  groq: { package: '@langchain/groq', className: 'ChatGroq', apiKeyProp: 'apiKey' },
};

/**
 * Dynamically import a LangChain provider package.
 */
async function importProvider(provider: LlmProvider): Promise<Record<string, unknown>> {
  const providerInfo = PROVIDER_PACKAGES[provider];

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
 * Uses dynamic imports to only load the provider package when needed.
 */
export async function createProviderAdapter(options: CreateProviderAdapterOptions): Promise<AgentLlmAdapter> {
  const { provider, model, apiKey, baseUrl, temperature, maxTokens } = options;

  const providerInfo = PROVIDER_PACKAGES[provider];
  if (!providerInfo) {
    throw new LlmAdapterError(
      `Unknown provider: ${provider}. Supported providers: ${Object.keys(PROVIDER_PACKAGES).join(', ')}`,
      'config',
      'unknown_provider',
    );
  }

  // Dynamically import the provider package
  const providerModule = await importProvider(provider);
  const ChatModelClass = providerModule[providerInfo.className] as new (config: Record<string, unknown>) => unknown;

  if (!ChatModelClass) {
    throw new LlmAdapterError(
      `Could not find ${providerInfo.className} in ${providerInfo.package}`,
      'config',
      'missing_class',
    );
  }

  // Build the configuration object
  const config: Record<string, unknown> = {
    model,
    [providerInfo.apiKeyProp]: apiKey,
  };

  if (temperature !== undefined) {
    config['temperature'] = temperature;
  }

  if (maxTokens !== undefined) {
    // Different providers use different property names
    if (provider === 'google') {
      config['maxOutputTokens'] = maxTokens;
    } else {
      config['maxTokens'] = maxTokens;
    }
  }

  if (baseUrl && provider === 'openai') {
    config['configuration'] = { baseURL: baseUrl };
  }

  // Create the chat model instance
  const chatModel = new ChatModelClass(config);

  // Wrap in LangChainAdapter
  return new LangChainAdapter({ model: chatModel as LangChainChatModel });
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
