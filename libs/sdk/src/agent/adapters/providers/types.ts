/**
 * LLM Provider Types and Model Definitions
 */

// ============================================================================
// Provider Types
// ============================================================================

/**
 * Supported LLM providers.
 */
export type LlmProvider = 'openai' | 'anthropic' | 'google' | 'mistral' | 'groq';

/**
 * Supported adapter types.
 * Currently only 'langchain' is supported, but this can be extended.
 */
export type LlmAdapterType = 'langchain';

// ============================================================================
// Model Types
// ============================================================================

export type OpenAIModel = string;
export type AnthropicModel = string;
export type GoogleModel = string;
export type MistralModel = string;
export type GroqModel = string;

/**
 * Model type based on provider.
 */
export type ModelForProvider<P extends LlmProvider> = string;

// ============================================================================
// Provider Configuration Types
// ============================================================================

/**
 * Common options for all providers.
 */
export interface ProviderCommonOptions {
  temperature?: number;
  maxTokens?: number;
}

/**
 * Options for creating an OpenAI adapter.
 */
export interface OpenAIProviderOptions extends ProviderCommonOptions {
  model: string;
  apiKey: string;
  baseUrl?: string;
}

/**
 * Options for creating an Anthropic adapter.
 */
export interface AnthropicProviderOptions extends ProviderCommonOptions {
  model: string;
  apiKey: string;
}

/**
 * Options for creating a Google adapter.
 */
export interface GoogleProviderOptions extends ProviderCommonOptions {
  model: string;
  apiKey: string;
}

/**
 * Options for creating a Mistral adapter.
 */
export interface MistralProviderOptions extends ProviderCommonOptions {
  model: string;
  apiKey: string;
}

/**
 * Options for creating a Groq adapter.
 */
export interface GroqProviderOptions extends ProviderCommonOptions {
  model: string;
  apiKey: string;
}
