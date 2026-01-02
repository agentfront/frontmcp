// ============================================================================
// Injection Token
// ============================================================================

/**
 * Injection token for the LLM adapter.
 * Use this to inject a custom LLM adapter via the provider system.
 *
 * @example
 * ```typescript
 * @Agent({
 *   name: 'my-agent',
 *   llm: LLM_ADAPTER,  // Use injected adapter
 *   providers: [
 *     { provide: LLM_ADAPTER, useFactory: () => new OpenAIAdapter(...) },
 *   ],
 * })
 * ```
 */
export const LLM_ADAPTER = Symbol.for('frontmcp:LLM_ADAPTER') as symbol & { __type: AgentLlmAdapter };

// ============================================================================
// Core Types
// ============================================================================

/**
 * Represents a message in the agent conversation.
 */
export interface AgentMessage {
  /**
   * Role of the message sender.
   */
  role: 'user' | 'assistant' | 'tool' | 'system';

  /**
   * Text content of the message (null if only tool calls).
   */
  content: string | null;

  /**
   * Tool calls made by the assistant (only for assistant messages).
   */
  toolCalls?: AgentToolCall[];

  /**
   * ID of the tool call this message is responding to (only for tool messages).
   */
  toolCallId?: string;

  /**
   * Name of the tool (only for tool messages).
   */
  name?: string;
}

/**
 * Represents a tool call made by the LLM.
 */
export interface AgentToolCall {
  /**
   * Unique identifier for this tool call.
   */
  id: string;

  /**
   * Name of the tool to call.
   */
  name: string;

  /**
   * Arguments to pass to the tool.
   */
  arguments: Record<string, unknown>;
}

/**
 * Represents a tool definition for the LLM.
 */
export interface AgentToolDefinition {
  /**
   * Name of the tool.
   */
  name: string;

  /**
   * Description of what the tool does.
   */
  description?: string;

  /**
   * JSON Schema describing the tool's parameters.
   */
  parameters: Record<string, unknown>;

  /**
   * Whether this tool requires user confirmation before execution.
   */
  requiresConfirmation?: boolean;
}

/**
 * Prompt to send to the LLM.
 */
export interface AgentPrompt {
  /**
   * System instructions for the LLM.
   */
  system?: string;

  /**
   * Conversation history.
   */
  messages: AgentMessage[];
}

/**
 * Options for LLM completion requests.
 */
export interface AgentCompletionOptions {
  /**
   * Temperature for generation (0-2).
   * Lower values make output more deterministic.
   */
  temperature?: number;

  /**
   * Maximum tokens to generate.
   */
  maxTokens?: number;

  /**
   * Stop sequences to end generation.
   */
  stopSequences?: string[];

  /**
   * Whether to force a tool call.
   */
  toolChoice?: 'auto' | 'required' | 'none' | { name: string };

  /**
   * Additional provider-specific options.
   */
  [key: string]: unknown;
}

/**
 * Result from an LLM completion request.
 */
export interface AgentCompletion {
  /**
   * Text content of the response (null if only tool calls).
   */
  content: string | null;

  /**
   * Tool calls requested by the LLM.
   */
  toolCalls?: AgentToolCall[];

  /**
   * Reason the generation stopped.
   */
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter';

  /**
   * Token usage statistics.
   */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens?: number;
  };

  /**
   * Raw response from the LLM provider (for debugging/advanced use).
   */
  raw?: unknown;
}

/**
 * Chunk from a streaming LLM completion.
 */
export interface AgentCompletionChunk {
  /**
   * Type of chunk.
   */
  type: 'content' | 'tool_call' | 'done';

  /**
   * Partial content (for 'content' type).
   */
  content?: string;

  /**
   * Partial tool call (for 'tool_call' type).
   */
  toolCall?: Partial<AgentToolCall> & { id: string };

  /**
   * Full completion (for 'done' type).
   */
  completion?: AgentCompletion;
}

// ============================================================================
// Adapter Interface
// ============================================================================

/**
 * Abstract adapter interface for LLM integration.
 *
 * Implement this interface to connect agents to different LLM providers
 * like OpenAI, Anthropic, LangChain, or custom solutions.
 *
 * @example
 * ```typescript
 * class MyAdapter implements AgentLlmAdapter {
 *   async completion(prompt, tools, options) {
 *     // Call your LLM provider
 *     return { content: 'Hello!', finishReason: 'stop' };
 *   }
 *
 *   async *streamCompletion(prompt, tools, options) {
 *     yield { type: 'content', content: 'Hello' };
 *     yield { type: 'content', content: '!' };
 *     yield { type: 'done', completion: { content: 'Hello!', finishReason: 'stop' } };
 *   }
 * }
 * ```
 */
export interface AgentLlmAdapter {
  /**
   * Generate a completion from the LLM.
   *
   * @param prompt - The prompt to send (system + messages)
   * @param tools - Available tools the LLM can call
   * @param options - Completion options (temperature, maxTokens, etc.)
   * @returns The LLM's response
   */
  completion(
    prompt: AgentPrompt,
    tools?: AgentToolDefinition[],
    options?: AgentCompletionOptions,
  ): Promise<AgentCompletion>;

  /**
   * Stream a completion from the LLM.
   *
   * @param prompt - The prompt to send (system + messages)
   * @param tools - Available tools the LLM can call
   * @param options - Completion options (temperature, maxTokens, etc.)
   * @returns AsyncGenerator yielding completion chunks
   */
  streamCompletion?(
    prompt: AgentPrompt,
    tools?: AgentToolDefinition[],
    options?: AgentCompletionOptions,
  ): AsyncGenerator<AgentCompletionChunk>;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Type guard to check if an adapter supports streaming.
 */
export function supportsStreaming(
  adapter: AgentLlmAdapter,
): adapter is AgentLlmAdapter & Required<Pick<AgentLlmAdapter, 'streamCompletion'>> {
  return typeof adapter.streamCompletion === 'function';
}
