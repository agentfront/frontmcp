import {
  AgentLlmAdapter,
  AgentPrompt,
  AgentMessage,
  AgentCompletion,
  AgentCompletionChunk,
  AgentToolDefinition,
  AgentCompletionOptions,
} from '../../common';

// ============================================================================
// Common Configuration Types
// ============================================================================

/**
 * Base configuration for all LLM adapters.
 */
export interface BaseLlmAdapterConfig {
  /**
   * Model identifier (e.g., 'gpt-4-turbo', 'claude-3-opus-20240229').
   */
  model: string;

  /**
   * API key for authentication.
   */
  apiKey: string;

  /**
   * Optional base URL for custom endpoints.
   */
  baseUrl?: string;

  /**
   * Default temperature for generations (0-2).
   */
  temperature?: number;

  /**
   * Default maximum tokens for responses.
   */
  maxTokens?: number;

  /**
   * Request timeout in milliseconds.
   * @default 60000
   */
  timeout?: number;

  /**
   * Maximum number of retries for failed requests.
   * @default 3
   */
  maxRetries?: number;
}

// ============================================================================
// Base Adapter Class
// ============================================================================

/**
 * Abstract base class for LLM adapters with common functionality.
 *
 * Provides:
 * - Configuration management
 * - Retry logic
 * - Error handling
 * - Tool formatting utilities
 */
export abstract class BaseLlmAdapter implements AgentLlmAdapter {
  protected readonly config: Required<Pick<BaseLlmAdapterConfig, 'model' | 'apiKey' | 'timeout' | 'maxRetries'>> &
    Omit<BaseLlmAdapterConfig, 'model' | 'apiKey' | 'timeout' | 'maxRetries'>;

  constructor(config: BaseLlmAdapterConfig) {
    // Validate required fields
    if (!config.model || typeof config.model !== 'string' || config.model.trim() === '') {
      throw new LlmAdapterError('model is required and must be a non-empty string', 'config', 'invalid_config');
    }
    if (!config.apiKey || typeof config.apiKey !== 'string' || config.apiKey.trim() === '') {
      throw new LlmAdapterError('apiKey is required and must be a non-empty string', 'config', 'invalid_config');
    }

    // Validate numeric constraints
    const timeout = config.timeout ?? 60000;
    const maxRetries = config.maxRetries ?? 3;
    if (timeout <= 0) {
      throw new LlmAdapterError('timeout must be a positive number', 'config', 'invalid_config');
    }
    if (maxRetries < 0) {
      throw new LlmAdapterError('maxRetries must be non-negative', 'config', 'invalid_config');
    }

    this.config = {
      ...config,
      timeout,
      maxRetries,
    };
  }

  /**
   * Generate a completion from the LLM.
   */
  abstract completion(
    prompt: AgentPrompt,
    tools?: AgentToolDefinition[],
    options?: AgentCompletionOptions,
  ): Promise<AgentCompletion>;

  /**
   * Stream a completion from the LLM.
   * Default implementation wraps non-streaming completion.
   */
  async *streamCompletion(
    prompt: AgentPrompt,
    tools?: AgentToolDefinition[],
    options?: AgentCompletionOptions,
  ): AsyncGenerator<AgentCompletionChunk> {
    // Default implementation: wrap non-streaming
    const result = await this.completion(prompt, tools, options);
    yield { type: 'done', completion: result };
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Format messages for the provider's API.
   */
  protected formatMessages(messages: AgentMessage[]): unknown[] {
    return messages.map((msg) => this.formatMessage(msg));
  }

  /**
   * Format a single message for the provider's API.
   * Override in subclasses for provider-specific formatting.
   */
  protected abstract formatMessage(message: AgentMessage): unknown;

  /**
   * Format tools for the provider's API.
   * Override in subclasses for provider-specific formatting.
   */
  protected abstract formatTools(tools: AgentToolDefinition[]): unknown[];

  /**
   * Parse the provider's response into AgentCompletion format.
   */
  protected abstract parseResponse(response: unknown): AgentCompletion;

  /**
   * Execute with retry logic.
   */
  protected async withRetry<T>(fn: () => Promise<T>, retries = this.config.maxRetries): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on certain errors
        if (this.isNonRetryableError(lastError)) {
          throw lastError;
        }

        // Wait before retrying (exponential backoff)
        if (attempt < retries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          await this.sleep(delay);
        }
      }
    }

    throw lastError ?? new Error('Unknown error during retry');
  }

  /**
   * Check if an error should not be retried.
   */
  protected isNonRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes('invalid api key') ||
      message.includes('authentication') ||
      message.includes('unauthorized') ||
      message.includes('invalid_request') ||
      message.includes('context_length_exceeded')
    );
  }

  /**
   * Sleep for a duration.
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Merge options with defaults.
   */
  protected mergeOptions(options?: AgentCompletionOptions): AgentCompletionOptions {
    return {
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      ...options,
    };
  }
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error thrown when an LLM adapter encounters an error.
 */
export class LlmAdapterError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly code?: string,
    public readonly statusCode?: number,
    public readonly raw?: unknown,
  ) {
    super(message);
    this.name = 'LlmAdapterError';
  }
}

/**
 * Error thrown when rate limited by the provider.
 */
export class LlmRateLimitError extends LlmAdapterError {
  constructor(provider: string, public readonly retryAfter?: number, raw?: unknown) {
    super(`Rate limited by ${provider}`, provider, 'rate_limit', 429, raw);
    this.name = 'LlmRateLimitError';
  }
}

/**
 * Error thrown when context length is exceeded.
 */
export class LlmContextLengthError extends LlmAdapterError {
  constructor(provider: string, raw?: unknown) {
    super(`Context length exceeded for ${provider}`, provider, 'context_length_exceeded', 400, raw);
    this.name = 'LlmContextLengthError';
  }
}
