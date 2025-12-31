import {
  AgentLlmAdapter,
  AgentPrompt,
  AgentMessage,
  AgentCompletion,
  AgentCompletionChunk,
  AgentToolCall,
  AgentToolDefinition,
  AgentCompletionOptions,
} from '../../common/interfaces/llm-adapter.interface';
import { LlmAdapterError } from './base.adapter';

// ============================================================================
// LangChain Types (minimal interface for duck-typing)
// ============================================================================

/**
 * Minimal interface matching LangChain's BaseChatModel.
 * This allows any LangChain model to be used without importing @langchain/core.
 */
export interface LangChainChatModel {
  invoke(messages: LangChainMessage[], options?: LangChainInvokeOptions): Promise<LangChainAIMessage>;

  stream?(messages: LangChainMessage[], options?: LangChainInvokeOptions): AsyncGenerator<LangChainStreamChunk>;

  /**
   * Bind tools to the model. Returns a new model instance with tools bound.
   * This is the preferred way to add tools in LangChain.
   */
  bindTools?(tools: LangChainTool[]): LangChainChatModel;
}

interface LangChainMessage {
  _getType(): string;
}

interface LangChainInvokeOptions {
  tools?: LangChainTool[];
  tool_choice?: string | { type: string; function?: { name: string } };
}

interface LangChainTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

interface LangChainAIMessage {
  content: string;
  tool_calls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>;
  response_metadata?: {
    finish_reason?: string;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };
}

interface LangChainStreamChunk {
  content?: string;
  tool_calls?: Array<{
    id?: string;
    name?: string;
    args?: Record<string, unknown>;
  }>;
  tool_call_chunks?: Array<{
    id?: string;
    name?: string;
    args?: string;
    index?: number;
  }>;
  response_metadata?: Record<string, unknown>;
}

// ============================================================================
// LangChain Message Classes (dynamically imported)
// ============================================================================

/**
 * Cached message classes from @langchain/core.
 */
let messageClasses: {
  SystemMessage: new (content: string) => LangChainMessage;
  HumanMessage: new (content: string) => LangChainMessage;
  AIMessage: new (fields: {
    content: string;
    tool_calls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  }) => LangChainMessage;
  ToolMessage: new (fields: { content: string; tool_call_id: string; name?: string }) => LangChainMessage;
} | null = null;

/**
 * Load LangChain message classes dynamically.
 */
async function loadMessageClasses(): Promise<typeof messageClasses> {
  if (messageClasses) return messageClasses;

  try {
    const core = await import('@langchain/core/messages');
    messageClasses = {
      SystemMessage: core.SystemMessage,
      HumanMessage: core.HumanMessage,
      AIMessage: core.AIMessage,
      ToolMessage: core.ToolMessage,
    };
    return messageClasses;
  } catch {
    // Fallback to duck-typed messages if @langchain/core is not available
    return null;
  }
}

/**
 * Create LangChain-compatible message objects.
 * Uses actual LangChain classes if available, otherwise falls back to duck-typed objects.
 */
function createSystemMessage(content: string, classes: typeof messageClasses): LangChainMessage {
  if (classes) {
    return new classes.SystemMessage(content);
  }
  return {
    _getType: () => 'system',
    content,
    lc_serializable: true,
    response_metadata: {},
  } as unknown as LangChainMessage;
}

function createHumanMessage(content: string, classes: typeof messageClasses): LangChainMessage {
  if (classes) {
    return new classes.HumanMessage(content);
  }
  return {
    _getType: () => 'human',
    content,
    lc_serializable: true,
    response_metadata: {},
  } as unknown as LangChainMessage;
}

function createAIMessage(
  content: string | null,
  toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> | undefined,
  classes: typeof messageClasses,
): LangChainMessage {
  if (classes) {
    return new classes.AIMessage({ content: content ?? '', tool_calls: toolCalls });
  }
  const msg: Record<string, unknown> = {
    _getType: () => 'ai',
    content: content ?? '',
    lc_serializable: true,
    response_metadata: {},
  };
  if (toolCalls) {
    msg['tool_calls'] = toolCalls;
  }
  return msg as unknown as LangChainMessage;
}

function createToolMessage(
  content: string,
  toolCallId: string,
  name: string | undefined,
  classes: typeof messageClasses,
): LangChainMessage {
  if (classes) {
    return new classes.ToolMessage({ content, tool_call_id: toolCallId, name });
  }
  return {
    _getType: () => 'tool',
    content,
    tool_call_id: toolCallId,
    name,
    lc_serializable: true,
    response_metadata: {},
  } as unknown as LangChainMessage;
}

// ============================================================================
// LangChain Adapter Configuration
// ============================================================================

/**
 * Configuration for the LangChain adapter.
 */
export interface LangChainAdapterConfig {
  /**
   * A LangChain chat model instance.
   * Can be any model from @langchain/openai, @langchain/anthropic, etc.
   *
   * @example
   * ```typescript
   * import { ChatOpenAI } from '@langchain/openai';
   * const model = new ChatOpenAI({ model: 'gpt-4-turbo' });
   * const adapter = new LangChainAdapter({ model });
   * ```
   */
  model: LangChainChatModel;

  /**
   * Default temperature for generations.
   */
  temperature?: number;

  /**
   * Default maximum tokens for responses.
   */
  maxTokens?: number;
}

// ============================================================================
// LangChain Adapter
// ============================================================================

/**
 * LLM adapter that wraps any LangChain chat model.
 *
 * This adapter provides a unified interface for all LangChain-compatible models,
 * including OpenAI, Anthropic, Google, Mistral, and many others.
 *
 * Benefits of using LangChain:
 * - Consistent API across all providers
 * - Built-in retry logic and error handling
 * - Streaming support
 * - Tool/function calling support
 * - Token counting and usage tracking
 *
 * @example Using with OpenAI
 * ```typescript
 * import { ChatOpenAI } from '@langchain/openai';
 *
 * const adapter = new LangChainAdapter({
 *   model: new ChatOpenAI({
 *     model: 'gpt-4-turbo',
 *     openAIApiKey: process.env.OPENAI_API_KEY,
 *   }),
 * });
 * ```
 *
 * @example Using with Anthropic
 * ```typescript
 * import { ChatAnthropic } from '@langchain/anthropic';
 *
 * const adapter = new LangChainAdapter({
 *   model: new ChatAnthropic({
 *     model: 'claude-3-opus-20240229',
 *     anthropicApiKey: process.env.ANTHROPIC_API_KEY,
 *   }),
 * });
 * ```
 *
 * @example Using with OpenRouter (via OpenAI SDK)
 * ```typescript
 * import { ChatOpenAI } from '@langchain/openai';
 *
 * const adapter = new LangChainAdapter({
 *   model: new ChatOpenAI({
 *     model: 'anthropic/claude-3-opus',
 *     openAIApiKey: process.env.OPENROUTER_API_KEY,
 *     configuration: {
 *       baseURL: 'https://openrouter.ai/api/v1',
 *     },
 *   }),
 * });
 * ```
 */
export class LangChainAdapter implements AgentLlmAdapter {
  private readonly model: LangChainChatModel;
  private readonly temperature?: number;
  private readonly maxTokens?: number;

  constructor(config: LangChainAdapterConfig) {
    this.model = config.model;
    this.temperature = config.temperature;
    this.maxTokens = config.maxTokens;
  }

  /**
   * Generate a completion using the LangChain model.
   */
  async completion(
    prompt: AgentPrompt,
    tools?: AgentToolDefinition[],
    options?: AgentCompletionOptions,
  ): Promise<AgentCompletion> {
    // Load LangChain message classes for proper message construction
    const classes = await loadMessageClasses();
    const messages = this.buildMessages(prompt, classes);
    const langChainTools = this.buildTools(tools);

    try {
      // Debug: log invoke options if DEBUG_LANGCHAIN is set
      if (process.env['DEBUG_LANGCHAIN']) {
        console.log('[LangChain] Messages:', JSON.stringify(messages, null, 2));
        console.log('[LangChain] Tools:', JSON.stringify(langChainTools, null, 2));
      }

      // Use bindTools if available (preferred LangChain pattern), otherwise pass tools in invoke options
      let model = this.model;
      let invokeOptions: LangChainInvokeOptions | undefined;

      if (langChainTools && langChainTools.length > 0) {
        if (model.bindTools) {
          // Preferred: bind tools to model
          model = model.bindTools(langChainTools);
        } else {
          // Fallback: pass tools in invoke options (older LangChain versions)
          invokeOptions = { tools: langChainTools };
        }
      }

      // Add tool_choice to invoke options if specified
      if (options?.toolChoice) {
        invokeOptions = invokeOptions ?? {};
        if (options.toolChoice === 'auto') {
          invokeOptions.tool_choice = 'auto';
        } else if (options.toolChoice === 'none') {
          invokeOptions.tool_choice = 'none';
        } else if (options.toolChoice === 'required') {
          invokeOptions.tool_choice = 'required';
        } else if (typeof options.toolChoice === 'object' && 'name' in options.toolChoice) {
          invokeOptions.tool_choice = {
            type: 'function',
            function: { name: options.toolChoice.name },
          };
        }
      }

      const response = await model.invoke(messages, invokeOptions);

      // Guard against undefined response (can happen with invalid API keys or network errors)
      if (!response) {
        throw new LlmAdapterError(
          'LLM returned no response. Check your API key and network connection.',
          'langchain',
          'empty_response',
        );
      }

      return this.parseResponse(response);
    } catch (error) {
      // Debug: log the raw error before wrapping
      if (process.env['DEBUG_LANGCHAIN']) {
        console.error('[LangChain] Raw error:', error);
      }
      throw this.wrapError(error);
    }
  }

  /**
   * Stream a completion using the LangChain model.
   */
  async *streamCompletion(
    prompt: AgentPrompt,
    tools?: AgentToolDefinition[],
    options?: AgentCompletionOptions,
  ): AsyncGenerator<AgentCompletionChunk> {
    // Check if the model supports streaming
    if (!this.model.stream) {
      // Fallback to non-streaming
      const result = await this.completion(prompt, tools, options);
      yield { type: 'done', completion: result };
      return;
    }

    const messages = this.buildMessages(prompt);
    const langChainTools = this.buildTools(tools);

    // Use bindTools if available (preferred LangChain pattern)
    let model = this.model;
    let invokeOptions: LangChainInvokeOptions | undefined;

    if (langChainTools && langChainTools.length > 0) {
      if (model.bindTools) {
        model = model.bindTools(langChainTools);
      } else {
        invokeOptions = { tools: langChainTools };
      }
    }

    // Add tool_choice to invoke options if specified
    if (options?.toolChoice) {
      invokeOptions = invokeOptions ?? {};
      if (options.toolChoice === 'auto') {
        invokeOptions.tool_choice = 'auto';
      } else if (options.toolChoice === 'none') {
        invokeOptions.tool_choice = 'none';
      } else if (options.toolChoice === 'required') {
        invokeOptions.tool_choice = 'required';
      } else if (typeof options.toolChoice === 'object' && 'name' in options.toolChoice) {
        invokeOptions.tool_choice = {
          type: 'function',
          function: { name: options.toolChoice.name },
        };
      }
    }

    let content = '';
    const toolCallsMap = new Map<number, Partial<AgentToolCall> & { rawArgs?: string }>();
    let finishReason: AgentCompletion['finishReason'] = 'stop';

    try {
      const stream = model.stream!(messages, invokeOptions);

      for await (const chunk of stream) {
        // Handle content
        if (chunk.content) {
          const text = typeof chunk.content === 'string' ? chunk.content : String(chunk.content);
          content += text;
          yield { type: 'content', content: text };
        }

        // Handle tool call chunks (streaming format)
        if (chunk.tool_call_chunks) {
          for (const tc of chunk.tool_call_chunks) {
            const index = tc.index ?? 0;
            const existing = toolCallsMap.get(index) ?? {};

            if (tc.id) existing.id = tc.id;
            if (tc.name) existing.name = tc.name;
            if (tc.args) {
              existing.rawArgs = (existing.rawArgs ?? '') + tc.args;
            }

            toolCallsMap.set(index, existing);

            if (existing.id) {
              yield {
                type: 'tool_call',
                toolCall: { id: existing.id, name: existing.name, arguments: {} },
              };
            }
          }
        }

        // Handle complete tool calls (non-streaming format)
        if (chunk.tool_calls) {
          for (let i = 0; i < chunk.tool_calls.length; i++) {
            const tc = chunk.tool_calls[i];
            if (tc.id && tc.name) {
              toolCallsMap.set(i, {
                id: tc.id,
                name: tc.name,
                arguments: tc.args ?? {},
              });
            }
          }
        }

        // Check for finish reason
        if (chunk.response_metadata) {
          const metadata = chunk.response_metadata;
          if (metadata['finish_reason']) {
            finishReason = this.mapFinishReason(metadata['finish_reason'] as string);
          }
        }
      }

      // Build tool calls from accumulated data
      const toolCalls: AgentToolCall[] = [];
      for (const [, tc] of toolCallsMap) {
        if (tc.id && tc.name) {
          let args = tc.arguments ?? {};
          if (tc.rawArgs) {
            try {
              args = JSON.parse(tc.rawArgs);
            } catch {
              // Keep empty args if parsing fails
            }
          }
          toolCalls.push({
            id: tc.id,
            name: tc.name,
            arguments: args,
          });
        }
      }

      // Determine finish reason based on tool calls
      if (toolCalls.length > 0) {
        finishReason = 'tool_calls';
      }

      // Build final completion
      const completion: AgentCompletion = {
        content: content || null,
        finishReason,
      };

      if (toolCalls.length > 0) {
        completion.toolCalls = toolCalls;
      }

      yield { type: 'done', completion };
    } catch (error) {
      throw this.wrapError(error);
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Build LangChain messages from AgentPrompt.
   */
  private buildMessages(prompt: AgentPrompt): LangChainMessage[] {
    const messages: LangChainMessage[] = [];

    // Add system message if present
    if (prompt.system) {
      messages.push(createSystemMessage(prompt.system));
    }

    // Add conversation messages
    for (const msg of prompt.messages) {
      switch (msg.role) {
        case 'user':
          messages.push(createHumanMessage(msg.content ?? ''));
          break;

        case 'assistant':
          if (msg.toolCalls && msg.toolCalls.length > 0) {
            messages.push(
              createAIMessage(
                msg.content,
                msg.toolCalls.map((tc) => ({
                  id: tc.id,
                  name: tc.name,
                  args: tc.arguments,
                })),
              ),
            );
          } else {
            messages.push(createAIMessage(msg.content, undefined));
          }
          break;

        case 'tool':
          if (msg.toolCallId) {
            messages.push(createToolMessage(msg.content ?? '', msg.toolCallId, msg.name));
          }
          break;

        case 'system':
          // System messages in conversation (rare, but handle it)
          messages.push(createSystemMessage(msg.content ?? ''));
          break;
      }
    }

    return messages;
  }

  /**
   * Build LangChain tool definitions from AgentToolDefinition[].
   */
  private buildTools(tools?: AgentToolDefinition[]): LangChainTool[] | undefined {
    if (!tools || tools.length === 0) {
      return undefined;
    }

    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  /**
   * Parse LangChain response into AgentCompletion.
   */
  private parseResponse(response: LangChainAIMessage): AgentCompletion {
    const completion: AgentCompletion = {
      content: response.content || null,
      finishReason: this.mapFinishReason(response.response_metadata?.finish_reason),
    };

    // Handle usage
    if (response.response_metadata?.usage) {
      const usage = response.response_metadata.usage;
      completion.usage = {
        promptTokens: usage.prompt_tokens ?? 0,
        completionTokens: usage.completion_tokens ?? 0,
        totalTokens: usage.total_tokens,
      };
    }

    // Handle tool calls
    if (response.tool_calls && response.tool_calls.length > 0) {
      completion.toolCalls = response.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.args,
      }));
      completion.finishReason = 'tool_calls';
    }

    return completion;
  }

  /**
   * Map provider finish reason to AgentCompletion finish reason.
   */
  private mapFinishReason(reason?: string): AgentCompletion['finishReason'] {
    if (!reason) return 'stop';

    switch (reason.toLowerCase()) {
      case 'stop':
      case 'end_turn':
      case 'stop_sequence':
        return 'stop';
      case 'length':
      case 'max_tokens':
        return 'length';
      case 'tool_calls':
      case 'tool_use':
      case 'function_call':
        return 'tool_calls';
      case 'content_filter':
        return 'content_filter';
      default:
        return 'stop';
    }
  }

  /**
   * Wrap errors in LlmAdapterError.
   */
  private wrapError(error: unknown): LlmAdapterError {
    if (error instanceof LlmAdapterError) {
      return error;
    }

    const err = error instanceof Error ? error : new Error(String(error));
    const message = err.message;

    // Try to detect specific error types
    if (message.includes('rate limit') || message.includes('429')) {
      return new LlmAdapterError(message, 'langchain', 'rate_limit', 429);
    }

    if (message.includes('context length') || message.includes('too long')) {
      return new LlmAdapterError(message, 'langchain', 'context_length_exceeded', 400);
    }

    if (message.includes('invalid api key') || message.includes('unauthorized') || message.includes('Unauthorized')) {
      return new LlmAdapterError(message, 'langchain', 'authentication', 401);
    }

    // LangChain internal error when response metadata is undefined (usually due to API errors)
    if (message.includes("'in' operator") && message.includes('undefined')) {
      return new LlmAdapterError(
        'LLM provider returned invalid response. This usually indicates an authentication error or API issue. Check your API key.',
        'langchain',
        'invalid_response',
        401,
      );
    }

    return new LlmAdapterError(message, 'langchain');
  }
}
