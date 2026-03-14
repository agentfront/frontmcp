/**
 * LLM platform tool call types.
 *
 * Defines the input/output shapes for processing tool calls across
 * different AI SDK platforms (OpenAI, Claude, Vercel AI).
 */

/** Generic function signature for executing an MCP tool. */
export type CallToolFn = (name: string, args?: Record<string, unknown>) => Promise<unknown>;

// ─────────────────────────────────────────────────────────────────────────────
// Platform-specific input types
// ─────────────────────────────────────────────────────────────────────────────

export interface OpenAIToolCallItem {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ClaudeToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface VercelToolCallInfo {
  toolCallId: string;
  toolName: string;
  args: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform-specific output types
// ─────────────────────────────────────────────────────────────────────────────

export interface OpenAIToolResponse {
  role: 'tool';
  tool_call_id: string;
  content: string;
}

export interface ClaudeToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapped types for generic function overloads
// ─────────────────────────────────────────────────────────────────────────────

export type PlatformToolCallsInput = {
  openai: OpenAIToolCallItem[];
  claude: ClaudeToolUseBlock[];
  'vercel-ai': VercelToolCallInfo;
};

export type PlatformToolCallsOutput = {
  openai: OpenAIToolResponse[];
  claude: ClaudeToolResultBlock[];
  'vercel-ai': unknown;
};

export type SupportedPlatform = keyof PlatformToolCallsInput;
