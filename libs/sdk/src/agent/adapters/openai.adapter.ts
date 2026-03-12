/**
 * OpenAI LLM Adapter
 *
 * Wraps the official `openai` npm package for direct integration.
 * The `openai` package must be installed as a peer dependency.
 *
 * Supports two OpenAI API modes:
 * - **`'chat'`** (default): Chat Completions API (`/v1/chat/completions`)
 * - **`'responses'`**: Responses API (`/v1/responses`)
 *
 * @example Chat Completions API (default)
 * ```typescript
 * const adapter = new OpenAIAdapter({ model: 'gpt-4o', apiKey: 'sk-...' });
 * ```
 *
 * @example Responses API
 * ```typescript
 * const adapter = new OpenAIAdapter({ model: 'gpt-4o', apiKey: 'sk-...', api: 'responses' });
 * ```
 *
 * @example Using with pre-configured client
 * ```typescript
 * import OpenAI from 'openai';
 * const adapter = new OpenAIAdapter({ model: 'gpt-4o', client: new OpenAI({ apiKey: 'sk-...' }) });
 * ```
 *
 * @example Using with OpenAI-compatible APIs (Groq, Mistral, etc.)
 * ```typescript
 * const adapter = new OpenAIAdapter({
 *   model: 'llama-3.1-70b-versatile',
 *   apiKey: process.env.GROQ_API_KEY,
 *   baseUrl: 'https://api.groq.com/openai/v1',
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
// OpenAI API mode
// ============================================================================

/**
 * Which OpenAI API to use.
 * - `'chat'`: Chat Completions API (`client.chat.completions.create`)
 * - `'responses'`: Responses API (`client.responses.create`)
 */
export type OpenAIApiMode = 'chat' | 'responses';

// ============================================================================
// Types for the OpenAI SDK (duck-typed to avoid import dependency)
// ============================================================================

interface OpenAIClient {
  chat: {
    completions: {
      create(params: OpenAIChatParams & { stream?: false }): Promise<OpenAIChatCompletion>;
      create(params: OpenAIChatParams & { stream: true }): Promise<OpenAIChatStream>;
      create(params: OpenAIChatParams): Promise<OpenAIChatCompletion | OpenAIChatStream>;
    };
  };
  responses: {
    create(params: OpenAIResponsesParams & { stream?: false }): Promise<OpenAIResponseObject>;
    create(params: OpenAIResponsesParams & { stream: true }): Promise<OpenAIResponsesStream>;
    create(params: OpenAIResponsesParams): Promise<OpenAIResponseObject | OpenAIResponsesStream>;
  };
}

// ── Chat Completions API types ──────────────────────────────────────────────

interface OpenAIChatParams {
  model: string;
  messages: OpenAIChatMessage[];
  tools?: OpenAIChatTool[];
  tool_choice?: string | { type: 'function'; function: { name: string } };
  temperature?: number;
  max_tokens?: number;
  stop?: string[];
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
}

type OpenAIChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    }
  | { role: 'tool'; content: string; tool_call_id: string };

interface OpenAIChatTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIChatCompletion {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIChatStream {
  [Symbol.asyncIterator](): AsyncIterator<OpenAIChatStreamChunk>;
}

interface OpenAIChatStreamChunk {
  choices: Array<{
    delta: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  } | null;
}

// ── Responses API types ─────────────────────────────────────────────────────

interface OpenAIResponsesParams {
  model: string;
  input: OpenAIResponsesInput[];
  tools?: OpenAIResponsesTool[];
  tool_choice?: string | { type: 'function'; name: string };
  temperature?: number;
  max_output_tokens?: number;
  stream?: boolean;
  instructions?: string;
}

type OpenAIResponsesInput =
  | { role: 'developer'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string };

interface OpenAIResponsesTool {
  type: 'function';
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

interface OpenAIResponseOutputItem {
  type: string;
  // message output
  role?: string;
  content?: Array<{ type: string; text: string }>;
  // function_call output
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  status?: string;
}

interface OpenAIResponseObject {
  id: string;
  output: OpenAIResponseOutputItem[];
  status: string;
  incomplete_details?: { reason: string } | null;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIResponsesStream {
  [Symbol.asyncIterator](): AsyncIterator<OpenAIResponsesStreamEvent>;
}

interface OpenAIResponsesStreamEvent {
  type: string;
  // For response.output_text.delta
  delta?: string;
  output_index?: number;
  // For response.function_call_arguments.done
  name?: string;
  call_id?: string;
  arguments?: string;
  // For response.output_item.added / done
  item?: OpenAIResponseOutputItem;
  // For response.completed
  response?: OpenAIResponseObject;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration for the OpenAI adapter.
 * Provide either `apiKey` (adapter creates client) or `client` (pre-configured).
 *
 * The `api` option selects which OpenAI API to use:
 * - `'chat'` (default): Chat Completions API
 * - `'responses'`: Responses API
 */
export type OpenAIAdapterConfig =
  | (BaseLlmAdapterConfig & { client?: never; api?: OpenAIApiMode })
  | {
      model: string;
      client: OpenAIClient;
      api?: OpenAIApiMode;
      temperature?: number;
      maxTokens?: number;
      timeout?: number;
      maxRetries?: number;
    };

// ============================================================================
// OpenAI Adapter
// ============================================================================

export class OpenAIAdapter extends BaseLlmAdapter implements AgentLlmAdapter {
  private client: OpenAIClient | undefined;
  private readonly providedClient: OpenAIClient | undefined;
  private readonly apiMode: OpenAIApiMode;

  constructor(config: OpenAIAdapterConfig) {
    // If client is provided, we don't need apiKey validation from BaseLlmAdapter
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
    this.apiMode = config.api ?? 'chat';
  }

  private getClient(): OpenAIClient {
    if (this.providedClient) {
      return this.providedClient;
    }
    if (this.client) {
      return this.client;
    }

    let OpenAI: new (config: Record<string, unknown>) => OpenAIClient;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('openai');
      OpenAI = mod.default ?? mod;
    } catch {
      throw new LlmAdapterError(
        'The "openai" package is not installed.\n\n' +
          'To use the OpenAI adapter, install it:\n\n' +
          '  npm install openai\n' +
          '  # or\n' +
          '  yarn add openai\n',
        'openai',
        'missing_dependency',
      );
    }

    const clientConfig: Record<string, unknown> = {
      apiKey: this.config.apiKey,
      timeout: this.config.timeout,
      maxRetries: this.config.maxRetries,
      dangerouslyAllowBrowser: true,
    };
    if (this.config.baseUrl) {
      clientConfig['baseURL'] = this.config.baseUrl;
    }

    this.client = new OpenAI(clientConfig);
    return this.client;
  }

  async completion(
    prompt: AgentPrompt,
    tools?: AgentToolDefinition[],
    options?: AgentCompletionOptions,
  ): Promise<AgentCompletion> {
    const merged = this.mergeOptions(options);

    if (this.apiMode === 'responses') {
      return this.completionViaResponses(prompt, tools, merged);
    }
    return this.completionViaChat(prompt, tools, merged);
  }

  override async *streamCompletion(
    prompt: AgentPrompt,
    tools?: AgentToolDefinition[],
    options?: AgentCompletionOptions,
  ): AsyncGenerator<AgentCompletionChunk> {
    const merged = this.mergeOptions(options);

    if (this.apiMode === 'responses') {
      yield* this.streamViaResponses(prompt, tools, merged);
    } else {
      yield* this.streamViaChat(prompt, tools, merged);
    }
  }

  // ============================================================================
  // Chat Completions API
  // ============================================================================

  private async completionViaChat(
    prompt: AgentPrompt,
    tools: AgentToolDefinition[] | undefined,
    options: AgentCompletionOptions,
  ): Promise<AgentCompletion> {
    const params = this.buildChatParams(prompt, tools, options, false);

    return this.withRetry(async () => {
      try {
        const response = (await this.getClient().chat.completions.create(params)) as OpenAIChatCompletion;
        return this.parseChatResponse(response);
      } catch (error) {
        throw this.wrapError(error);
      }
    });
  }

  private async *streamViaChat(
    prompt: AgentPrompt,
    tools: AgentToolDefinition[] | undefined,
    options: AgentCompletionOptions,
  ): AsyncGenerator<AgentCompletionChunk> {
    const params = this.buildChatParams(prompt, tools, options, true);

    let content = '';
    const toolCallsMap = new Map<number, { id: string; name: string; args: string }>();
    let finishReason: AgentCompletion['finishReason'] = 'stop';
    let usage: AgentCompletion['usage'];

    try {
      const stream = (await this.getClient().chat.completions.create(params)) as OpenAIChatStream;

      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        if (!choice) continue;

        // Handle content delta
        if (choice.delta.content) {
          content += choice.delta.content;
          yield { type: 'content', content: choice.delta.content };
        }

        // Handle tool call deltas
        if (choice.delta.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            const existing = toolCallsMap.get(tc.index) ?? { id: '', name: '', args: '' };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) existing.args += tc.function.arguments;
            toolCallsMap.set(tc.index, existing);

            if (existing.id) {
              yield {
                type: 'tool_call',
                toolCall: { id: existing.id, name: existing.name, arguments: {} },
              };
            }
          }
        }

        // Handle finish reason
        if (choice.finish_reason) {
          finishReason = this.mapChatFinishReason(choice.finish_reason);
        }

        // Handle usage (often in last chunk with stream_options)
        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          };
        }
      }

      // Build final tool calls
      const toolCalls = this.buildToolCallsFromMap(toolCallsMap);

      if (toolCalls.length > 0) {
        finishReason = 'tool_calls';
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
  // Responses API
  // ============================================================================

  private async completionViaResponses(
    prompt: AgentPrompt,
    tools: AgentToolDefinition[] | undefined,
    options: AgentCompletionOptions,
  ): Promise<AgentCompletion> {
    const params = this.buildResponsesParams(prompt, tools, options, false);

    return this.withRetry(async () => {
      try {
        const client = this.getClient();
        if (!client.responses) {
          throw new LlmAdapterError(
            'The OpenAI client does not support the Responses API.\n' +
              'Upgrade the "openai" package to v4.85+ or use api: \'chat\' instead.',
            'openai',
            'unsupported_api',
          );
        }
        const response = (await client.responses.create(params)) as OpenAIResponseObject;
        return this.parseResponsesResponse(response);
      } catch (error) {
        throw this.wrapError(error);
      }
    });
  }

  private async *streamViaResponses(
    prompt: AgentPrompt,
    tools: AgentToolDefinition[] | undefined,
    options: AgentCompletionOptions,
  ): AsyncGenerator<AgentCompletionChunk> {
    const params = this.buildResponsesParams(prompt, tools, options, true);

    let content = '';
    const toolCallsMap = new Map<number, { id: string; name: string; args: string }>();
    let finishReason: AgentCompletion['finishReason'] = 'stop';
    let usage: AgentCompletion['usage'];

    try {
      const client = this.getClient();
      if (!client.responses) {
        throw new LlmAdapterError(
          'The OpenAI client does not support the Responses API.\n' +
            'Upgrade the "openai" package to v4.85+ or use api: \'chat\' instead.',
          'openai',
          'unsupported_api',
        );
      }
      const stream = (await client.responses.create(params)) as OpenAIResponsesStream;

      for await (const event of stream) {
        switch (event.type) {
          case 'response.output_text.delta':
            if (event.delta) {
              content += event.delta;
              yield { type: 'content', content: event.delta };
            }
            break;

          case 'response.function_call_arguments.delta': {
            const idx = event.output_index ?? 0;
            const existing = toolCallsMap.get(idx) ?? { id: '', name: '', args: '' };
            if (event.delta) existing.args += event.delta;
            toolCallsMap.set(idx, existing);
            break;
          }

          case 'response.output_item.added':
            if (event.item?.type === 'function_call') {
              const idx = event.output_index ?? 0;
              const entry = toolCallsMap.get(idx) ?? { id: '', name: '', args: '' };
              if (event.item.call_id) entry.id = event.item.call_id;
              if (event.item.name) entry.name = event.item.name;
              toolCallsMap.set(idx, entry);

              if (entry.id) {
                yield {
                  type: 'tool_call',
                  toolCall: { id: entry.id, name: entry.name, arguments: {} },
                };
              }
            }
            break;

          case 'response.function_call_arguments.done': {
            const idx = event.output_index ?? 0;
            const entry = toolCallsMap.get(idx) ?? { id: '', name: '', args: '' };
            if (event.call_id) entry.id = event.call_id;
            if (event.name) entry.name = event.name;
            if (event.arguments) entry.args = event.arguments;
            toolCallsMap.set(idx, entry);
            break;
          }

          case 'response.completed':
            if (event.response) {
              finishReason = this.mapResponsesStatus(event.response.status, event.response.incomplete_details?.reason);
              if (event.response.usage) {
                usage = {
                  promptTokens: event.response.usage.input_tokens,
                  completionTokens: event.response.usage.output_tokens,
                  totalTokens: event.response.usage.total_tokens,
                };
              }
            }
            break;
        }
      }

      const toolCalls = this.buildToolCallsFromMap(toolCallsMap);
      if (toolCalls.length > 0) {
        finishReason = 'tool_calls';
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
  // Internal: Chat Completions Params / Parse
  // ============================================================================

  private buildChatParams(
    prompt: AgentPrompt,
    tools: AgentToolDefinition[] | undefined,
    options: AgentCompletionOptions,
    stream: boolean,
  ): OpenAIChatParams {
    const params: OpenAIChatParams = {
      model: this.config.model,
      messages: this.buildChatMessages(prompt.messages, prompt.system) as OpenAIChatMessage[],
      stream,
    };

    if (options.temperature !== undefined) params.temperature = options.temperature;
    if (options.maxTokens !== undefined) params.max_tokens = options.maxTokens;
    if (options.stopSequences?.length) params.stop = options.stopSequences;

    if (tools?.length) {
      params.tools = this.formatChatTools(tools) as OpenAIChatTool[];
    }

    if (stream) {
      params.stream_options = { include_usage: true };
    }

    if (options.toolChoice) {
      if (options.toolChoice === 'auto' || options.toolChoice === 'none' || options.toolChoice === 'required') {
        params.tool_choice = options.toolChoice;
      } else if (typeof options.toolChoice === 'object' && 'name' in options.toolChoice) {
        params.tool_choice = { type: 'function', function: { name: options.toolChoice.name } };
      }
    }

    return params;
  }

  private buildChatMessages(messages: AgentMessage[], system?: string): unknown[] {
    const result: unknown[] = [];

    if (system) {
      result.push({ role: 'system', content: system });
    }

    for (const msg of messages) {
      result.push(this.formatMessage(msg));
    }
    return result;
  }

  private formatChatTools(tools: AgentToolDefinition[]): unknown[] {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  private parseChatResponse(response: OpenAIChatCompletion): AgentCompletion {
    const choice = response.choices?.[0];

    if (!choice) {
      throw new LlmAdapterError('OpenAI returned no choices', 'openai', 'empty_response');
    }

    const completion: AgentCompletion = {
      content: choice.message.content,
      finishReason: this.mapChatFinishReason(choice.finish_reason),
    };

    if (response.usage) {
      completion.usage = {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      };
    }

    if (choice.message.tool_calls?.length) {
      completion.toolCalls = choice.message.tool_calls.map((tc) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          // Keep empty args on malformed JSON
        }
        return { id: tc.id, name: tc.function.name, arguments: args };
      });
      completion.finishReason = 'tool_calls';
    }

    return completion;
  }

  private mapChatFinishReason(reason?: string): AgentCompletion['finishReason'] {
    if (!reason) return 'stop';
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      case 'tool_calls':
        return 'tool_calls';
      case 'content_filter':
        return 'content_filter';
      default:
        return 'stop';
    }
  }

  // ============================================================================
  // Internal: Responses API Params / Parse
  // ============================================================================

  private buildResponsesParams(
    prompt: AgentPrompt,
    tools: AgentToolDefinition[] | undefined,
    options: AgentCompletionOptions,
    stream: boolean,
  ): OpenAIResponsesParams {
    const params: OpenAIResponsesParams = {
      model: this.config.model,
      input: this.buildResponsesInput(prompt.messages, prompt.system),
      stream,
    };

    if (options.temperature !== undefined) params.temperature = options.temperature;
    if (options.maxTokens !== undefined) params.max_output_tokens = options.maxTokens;

    if (tools?.length) {
      params.tools = this.formatResponsesTools(tools);
    }

    if (options.toolChoice) {
      if (options.toolChoice === 'auto' || options.toolChoice === 'none' || options.toolChoice === 'required') {
        params.tool_choice = options.toolChoice;
      } else if (typeof options.toolChoice === 'object' && 'name' in options.toolChoice) {
        params.tool_choice = { type: 'function', name: options.toolChoice.name };
      }
    }

    return params;
  }

  private buildResponsesInput(messages: AgentMessage[], system?: string): OpenAIResponsesInput[] {
    const result: OpenAIResponsesInput[] = [];

    if (system) {
      result.push({ role: 'developer', content: system });
    }

    for (const msg of messages) {
      switch (msg.role) {
        case 'system':
          result.push({ role: 'developer', content: msg.content ?? '' });
          break;
        case 'user':
          result.push({ role: 'user', content: msg.content ?? '' });
          break;
        case 'assistant':
          if (msg.toolCalls?.length) {
            for (const tc of msg.toolCalls) {
              result.push({
                type: 'function_call',
                call_id: tc.id,
                name: tc.name,
                arguments: JSON.stringify(tc.arguments),
              });
            }
          }
          if (msg.content) {
            result.push({ role: 'assistant', content: msg.content });
          }
          break;
        case 'tool':
          result.push({
            type: 'function_call_output',
            call_id: msg.toolCallId ?? '',
            output: msg.content ?? '',
          });
          break;
        default:
          result.push({ role: 'user', content: msg.content ?? '' });
      }
    }

    return result;
  }

  private formatResponsesTools(tools: AgentToolDefinition[]): OpenAIResponsesTool[] {
    return tools.map((tool) => ({
      type: 'function' as const,
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  private parseResponsesResponse(response: OpenAIResponseObject): AgentCompletion {
    let content: string | null = null;
    const toolCalls: AgentToolCall[] = [];

    for (const item of response.output) {
      if (item.type === 'message' && item.content) {
        const textParts = item.content.filter((c) => c.type === 'output_text');
        if (textParts.length > 0) {
          content = textParts.map((p) => p.text).join('');
        }
      } else if (item.type === 'function_call' && item.call_id && item.name) {
        let args: Record<string, unknown> = {};
        if (item.arguments) {
          try {
            args = JSON.parse(item.arguments);
          } catch {
            // Keep empty args
          }
        }
        toolCalls.push({ id: item.call_id, name: item.name, arguments: args });
      }
    }

    let finishReason = this.mapResponsesStatus(response.status, response.incomplete_details?.reason);
    if (toolCalls.length > 0) {
      finishReason = 'tool_calls';
    }

    const completion: AgentCompletion = { content, finishReason };
    if (toolCalls.length > 0) completion.toolCalls = toolCalls;

    if (response.usage) {
      completion.usage = {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.total_tokens,
      };
    }

    return completion;
  }

  private mapResponsesStatus(status?: string, incompleteReason?: string): AgentCompletion['finishReason'] {
    if (status === 'incomplete') {
      if (incompleteReason === 'max_output_tokens') return 'length';
      if (incompleteReason === 'content_filter') return 'content_filter';
      return 'length';
    }
    if (status === 'failed') return 'stop';
    return 'stop'; // 'completed' → stop
  }

  // ============================================================================
  // Shared Internal Methods
  // ============================================================================

  protected formatMessage(message: AgentMessage): unknown {
    switch (message.role) {
      case 'system':
        return { role: 'system', content: message.content ?? '' };
      case 'user':
        return { role: 'user', content: message.content ?? '' };
      case 'assistant': {
        const assistantMsg: Record<string, unknown> = {
          role: 'assistant',
          content: message.content,
        };
        if (message.toolCalls?.length) {
          assistantMsg['tool_calls'] = message.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          }));
        }
        return assistantMsg;
      }
      case 'tool':
        return {
          role: 'tool',
          content: message.content ?? '',
          tool_call_id: message.toolCallId,
        };
      default:
        return { role: message.role, content: message.content ?? '' };
    }
  }

  protected formatTools(tools: AgentToolDefinition[]): unknown[] {
    if (this.apiMode === 'responses') {
      return this.formatResponsesTools(tools);
    }
    return this.formatChatTools(tools);
  }

  protected parseResponse(response: unknown): AgentCompletion {
    if (this.apiMode === 'responses') {
      return this.parseResponsesResponse(response as OpenAIResponseObject);
    }
    return this.parseChatResponse(response as OpenAIChatCompletion);
  }

  private buildToolCallsFromMap(
    toolCallsMap: Map<number, { id: string; name: string; args: string }>,
  ): AgentToolCall[] {
    const toolCalls: AgentToolCall[] = [];
    for (const [, tc] of toolCallsMap) {
      if (tc.id && tc.name) {
        let args: Record<string, unknown> = {};
        if (tc.args) {
          try {
            args = JSON.parse(tc.args);
          } catch {
            // Keep empty args
          }
        }
        toolCalls.push({ id: tc.id, name: tc.name, arguments: args });
      }
    }
    return toolCalls;
  }

  private wrapError(error: unknown): LlmAdapterError {
    if (error instanceof LlmAdapterError) return error;

    const err = error instanceof Error ? error : new Error(String(error));
    const message = err.message;
    const statusCode = (error as { status?: number })?.status;

    if (statusCode === 429 || message.includes('rate limit')) {
      return new LlmAdapterError(message, 'openai', 'rate_limit', 429, error);
    }
    if (statusCode === 401 || message.includes('invalid api key') || message.includes('Unauthorized')) {
      return new LlmAdapterError(message, 'openai', 'authentication', 401, error);
    }
    if (message.includes('context_length_exceeded') || message.includes('maximum context length')) {
      return new LlmAdapterError(message, 'openai', 'context_length_exceeded', 400, error);
    }
    if (statusCode === 404 || message.includes('model_not_found')) {
      return new LlmAdapterError(message, 'openai', 'model_not_found', 404, error);
    }

    return new LlmAdapterError(message, 'openai', undefined, statusCode, error);
  }
}
