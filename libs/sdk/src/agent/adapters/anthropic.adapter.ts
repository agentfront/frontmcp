/**
 * Anthropic LLM Adapter
 *
 * Wraps the official `@anthropic-ai/sdk` npm package for direct integration.
 * The `@anthropic-ai/sdk` package must be installed as a peer dependency.
 *
 * @example Using with API key
 * ```typescript
 * const adapter = new AnthropicAdapter({ model: 'claude-sonnet-4-6', apiKey: 'sk-ant-...' });
 * ```
 *
 * @example Using with pre-configured client
 * ```typescript
 * import Anthropic from '@anthropic-ai/sdk';
 * const adapter = new AnthropicAdapter({
 *   model: 'claude-sonnet-4-6',
 *   client: new Anthropic({ apiKey: 'sk-ant-...' }),
 * });
 * ```
 */

import {
  AgentLlmAdapter,
  AgentPrompt,
  AgentMessage,
  AgentCompletion,
  AgentCompletionChunk,
  AgentToolCall,
  AgentToolDefinition,
  AgentCompletionOptions,
} from '../../common';
import { BaseLlmAdapter, BaseLlmAdapterConfig, LlmAdapterError } from './base.adapter';

// ============================================================================
// Types for the Anthropic SDK (duck-typed to avoid import dependency)
// ============================================================================

interface AnthropicClient {
  messages: {
    create(params: AnthropicCreateParams & { stream?: false }): Promise<AnthropicMessage>;
    create(params: AnthropicCreateParams & { stream: true }): Promise<AnthropicStream>;
    create(params: AnthropicCreateParams): Promise<AnthropicMessage | AnthropicStream>;
  };
}

interface AnthropicCreateParams {
  model: string;
  messages: AnthropicMessageParam[];
  system?: string;
  tools?: AnthropicTool[];
  tool_choice?: { type: 'auto' | 'any' | 'tool'; name?: string };
  temperature?: number;
  max_tokens: number;
  stop_sequences?: string[];
  stream?: boolean;
}

type AnthropicMessageParam =
  | { role: 'user'; content: string | AnthropicContentBlock[] }
  | { role: 'assistant'; content: string | AnthropicContentBlock[] };

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicMessage {
  content: AnthropicContentBlock[];
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface AnthropicStream {
  [Symbol.asyncIterator](): AsyncIterator<AnthropicStreamEvent>;
}

type AnthropicStreamEvent =
  | { type: 'message_start'; message: { usage: { input_tokens: number; output_tokens: number } } }
  | { type: 'content_block_start'; index: number; content_block: AnthropicContentBlock }
  | { type: 'content_block_delta'; index: number; delta: AnthropicDelta }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason: string }; usage?: { output_tokens: number } }
  | { type: 'message_stop' };

type AnthropicDelta = { type: 'text_delta'; text: string } | { type: 'input_json_delta'; partial_json: string };

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration for the Anthropic adapter.
 * Provide either `apiKey` (adapter creates client) or `client` (pre-configured).
 */
export type AnthropicAdapterConfig =
  | (BaseLlmAdapterConfig & { client?: never })
  | {
      model: string;
      client: AnthropicClient;
      temperature?: number;
      maxTokens?: number;
      timeout?: number;
      maxRetries?: number;
    };

// ============================================================================
// Anthropic Adapter
// ============================================================================

const DEFAULT_MAX_TOKENS = 4096;

export class AnthropicAdapter extends BaseLlmAdapter implements AgentLlmAdapter {
  private client: AnthropicClient | undefined;
  private readonly providedClient: AnthropicClient | undefined;

  constructor(config: AnthropicAdapterConfig) {
    if ('client' in config && config.client) {
      super({
        model: config.model,
        apiKey: '__client_provided__',
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        timeout: config.timeout,
        maxRetries: config.maxRetries,
      });
      this.providedClient = config.client;
    } else {
      super(config as BaseLlmAdapterConfig);
    }
  }

  private async getClient(): Promise<AnthropicClient> {
    if (this.providedClient) {
      return this.providedClient;
    }
    if (this.client) {
      return this.client;
    }

    let Anthropic: new (config: Record<string, unknown>) => AnthropicClient;
    try {
      const mod = await import('@anthropic-ai/sdk');
      Anthropic = ((mod as Record<string, unknown>)['default'] as typeof Anthropic) ?? mod;
    } catch {
      throw new LlmAdapterError(
        'The "@anthropic-ai/sdk" package is not installed.\n\n' +
          'To use the Anthropic adapter, install it:\n\n' +
          '  npm install @anthropic-ai/sdk\n' +
          '  # or\n' +
          '  yarn add @anthropic-ai/sdk\n',
        'anthropic',
        'missing_dependency',
      );
    }

    const clientConfig: Record<string, unknown> = {
      apiKey: this.config.apiKey,
      timeout: this.config.timeout,
      maxRetries: this.config.maxRetries,
    };
    if (this.config.baseUrl) {
      clientConfig['baseURL'] = this.config.baseUrl;
    }

    this.client = new Anthropic(clientConfig);
    return this.client;
  }

  async completion(
    prompt: AgentPrompt,
    tools?: AgentToolDefinition[],
    options?: AgentCompletionOptions,
  ): Promise<AgentCompletion> {
    const merged = this.mergeOptions(options);
    const params = this.buildParams(prompt, tools, merged, false);

    return this.withRetry(async () => {
      try {
        const client = await this.getClient();
        const response = (await client.messages.create(params)) as AnthropicMessage;
        return this.parseResponse(response);
      } catch (error) {
        throw this.wrapError(error);
      }
    });
  }

  override async *streamCompletion(
    prompt: AgentPrompt,
    tools?: AgentToolDefinition[],
    options?: AgentCompletionOptions,
  ): AsyncGenerator<AgentCompletionChunk> {
    const merged = this.mergeOptions(options);
    const params = this.buildParams(prompt, tools, merged, true);

    let content = '';
    const toolCalls: AgentToolCall[] = [];
    let currentToolIndex = -1;
    let currentToolArgs = '';
    let finishReason: AgentCompletion['finishReason'] = 'stop';
    let usage: AgentCompletion['usage'];

    try {
      const client = await this.getClient();
      const stream = (await client.messages.create(params)) as AnthropicStream;

      for await (const event of stream) {
        switch (event.type) {
          case 'message_start':
            if (event.message.usage) {
              usage = {
                promptTokens: event.message.usage.input_tokens,
                completionTokens: event.message.usage.output_tokens,
                totalTokens: event.message.usage.input_tokens + event.message.usage.output_tokens,
              };
            }
            break;

          case 'content_block_start':
            if (event.content_block.type === 'tool_use') {
              currentToolIndex = toolCalls.length;
              currentToolArgs = '';
              toolCalls.push({
                id: event.content_block.id,
                name: event.content_block.name,
                arguments: {},
              });
              yield {
                type: 'tool_call',
                toolCall: { id: event.content_block.id, name: event.content_block.name, arguments: {} },
              };
            }
            break;

          case 'content_block_delta':
            if (event.delta.type === 'text_delta') {
              content += event.delta.text;
              yield { type: 'content', content: event.delta.text };
            } else if (event.delta.type === 'input_json_delta') {
              currentToolArgs += event.delta.partial_json;
            }
            break;

          case 'content_block_stop':
            if (currentToolIndex >= 0) {
              if (currentToolArgs) {
                try {
                  toolCalls[currentToolIndex].arguments = JSON.parse(currentToolArgs);
                } catch {
                  toolCalls[currentToolIndex].arguments = {};
                }
              } else {
                toolCalls[currentToolIndex].arguments = {};
              }
              currentToolIndex = -1;
              currentToolArgs = '';
            }
            break;

          case 'message_delta':
            if (event.delta.stop_reason) {
              finishReason = this.mapStopReason(event.delta.stop_reason);
            }
            if (event.usage) {
              if (usage) {
                usage.completionTokens = event.usage.output_tokens;
                usage.totalTokens = usage.promptTokens + event.usage.output_tokens;
              }
            }
            break;
        }
      }

      const completion: AgentCompletion = {
        content: content || null,
        finishReason,
      };
      if (toolCalls.length > 0) completion.toolCalls = toolCalls;
      if (usage) completion.usage = usage;

      yield { type: 'done', completion };
    } catch (error) {
      throw this.wrapError(error);
    }
  }

  // ============================================================================
  // Internal Methods
  // ============================================================================

  private buildParams(
    prompt: AgentPrompt,
    tools: AgentToolDefinition[] | undefined,
    options: AgentCompletionOptions,
    stream: boolean,
  ): AnthropicCreateParams {
    const params: AnthropicCreateParams = {
      model: this.config.model,
      messages: this.formatAnthropicMessages(prompt.messages) as AnthropicMessageParam[],
      max_tokens: options.maxTokens ?? this.config.maxTokens ?? DEFAULT_MAX_TOKENS,
      stream,
    };

    if (prompt.system) {
      params.system = prompt.system;
    }
    if (options.temperature !== undefined) params.temperature = options.temperature;
    if (options.stopSequences?.length) params.stop_sequences = options.stopSequences;

    if (tools?.length) {
      params.tools = this.formatTools(tools) as AnthropicTool[];
    }

    if (options.toolChoice) {
      if (options.toolChoice === 'auto') {
        params.tool_choice = { type: 'auto' };
      } else if (options.toolChoice === 'required') {
        params.tool_choice = { type: 'any' };
      } else if (options.toolChoice === 'none') {
        // Anthropic doesn't have a 'none' tool_choice; omit tools instead
        delete params.tools;
      } else if (typeof options.toolChoice === 'object' && 'name' in options.toolChoice) {
        params.tool_choice = { type: 'tool', name: options.toolChoice.name };
      }
    }

    return params;
  }

  private formatAnthropicMessages(messages: AgentMessage[]): unknown[] {
    const result: unknown[] = [];

    for (const msg of messages) {
      switch (msg.role) {
        case 'system':
          throw new LlmAdapterError(
            'Anthropic does not support system messages mid-conversation. ' +
              'Use the top-level systemInstructions instead.',
            'anthropic',
            'invalid_message',
          );

        case 'user':
          result.push({ role: 'user', content: msg.content ?? '' });
          break;

        case 'assistant': {
          const blocks: AnthropicContentBlock[] = [];
          if (msg.content) {
            blocks.push({ type: 'text', text: msg.content });
          }
          if (msg.toolCalls?.length) {
            for (const tc of msg.toolCalls) {
              blocks.push({
                type: 'tool_use',
                id: tc.id,
                name: tc.name,
                input: tc.arguments,
              });
            }
          }
          result.push({
            role: 'assistant',
            content:
              blocks.length === 1 && blocks[0].type === 'text'
                ? (blocks[0] as { type: 'text'; text: string }).text
                : blocks,
          });
          break;
        }

        case 'tool':
          if (!msg.toolCallId) {
            throw new LlmAdapterError('Tool message is missing required toolCallId', 'anthropic', 'invalid_request');
          }
          // Tool results in Anthropic go as user messages with tool_result content
          result.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: msg.toolCallId,
                content: msg.content ?? '',
              },
            ],
          });
          break;
      }
    }

    return result;
  }

  protected formatMessage(message: AgentMessage): unknown {
    // Delegated to formatAnthropicMessages for proper content block handling
    return { role: message.role, content: message.content ?? '' };
  }

  protected formatTools(tools: AgentToolDefinition[]): unknown[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }

  protected parseResponse(response: unknown): AgentCompletion {
    const res = response as AnthropicMessage;

    let textContent = '';
    const toolCalls: AgentToolCall[] = [];

    for (const block of res.content) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input,
        });
      }
    }

    const completion: AgentCompletion = {
      content: textContent || null,
      finishReason: this.mapStopReason(res.stop_reason),
    };

    if (res.usage) {
      completion.usage = {
        promptTokens: res.usage.input_tokens,
        completionTokens: res.usage.output_tokens,
        totalTokens: res.usage.input_tokens + res.usage.output_tokens,
      };
    }

    if (toolCalls.length > 0) {
      completion.toolCalls = toolCalls;
      completion.finishReason = 'tool_calls';
    }

    return completion;
  }

  private mapStopReason(reason: string | null): AgentCompletion['finishReason'] {
    if (!reason) return 'stop';
    switch (reason) {
      case 'end_turn':
      case 'stop_sequence':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'tool_use':
        return 'tool_calls';
      default:
        return 'stop';
    }
  }

  private wrapError(error: unknown): LlmAdapterError {
    if (error instanceof LlmAdapterError) return error;

    const err = error instanceof Error ? error : new Error(String(error));
    const message = err.message;
    const statusCode = (error as { status?: number })?.status;

    if (statusCode === 429 || message.includes('rate limit')) {
      return new LlmAdapterError(message, 'anthropic', 'rate_limit', 429, error);
    }
    if (statusCode === 401 || message.includes('invalid x-api-key') || message.includes('authentication')) {
      return new LlmAdapterError(message, 'anthropic', 'authentication', 401, error);
    }
    if (message.includes('context length') || message.includes('too many tokens')) {
      return new LlmAdapterError(message, 'anthropic', 'context_length_exceeded', 400, error);
    }
    if (statusCode === 404 || message.includes('model_not_found')) {
      return new LlmAdapterError(message, 'anthropic', 'model_not_found', 404, error);
    }

    return new LlmAdapterError(message, 'anthropic', undefined, statusCode, error);
  }
}
