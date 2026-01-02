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
