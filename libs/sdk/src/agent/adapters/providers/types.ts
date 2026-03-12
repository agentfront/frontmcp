/**
 * LLM Provider Types and Model Definitions
 */

// ============================================================================
// Provider Types
// ============================================================================

/**
 * Supported LLM providers.
 *
 * For other providers (Google, Mistral, Groq, etc.), use one of:
 * - OpenAI adapter with `baseUrl` (most are OpenAI-compatible)
 * - Custom `AgentLlmAdapter` implementation
 */
export type LlmProvider = 'openai' | 'anthropic';

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
