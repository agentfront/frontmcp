/**
 * AI SDK integration types.
 *
 * All types are defined locally — no AI SDK dependencies.
 */

import type { OpenAITool, ClaudeTool, LangChainTool, VercelAITools, LLMPlatform } from '@frontmcp/sdk';

/**
 * Formatted tool result — union matching SDK's FormattedToolResult.
 * Defined locally to avoid dependency on unexported SDK internal type.
 */
// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
export type FormattedToolResult =
  | string
  | unknown
  | Array<{ type: string; text: string }>
  | { content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }> }
  | { text?: string[]; images?: Array<{ data: string; mimeType: string }> };

// ─────────────────────────────────────────────────────────────────────────────
// MCP tool shape (matches Tool from @modelcontextprotocol/sdk — avoid direct dep)
// ─────────────────────────────────────────────────────────────────────────────

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform → tool-type mapping (generic hook type narrowing)
// ─────────────────────────────────────────────────────────────────────────────

export type PlatformToolsMap = {
  openai: OpenAITool[];
  claude: ClaudeTool[];
  langchain: LangChainTool[];
  'vercel-ai': VercelAITools;
  raw: McpToolInfo[];
};

// ─────────────────────────────────────────────────────────────────────────────
// AI SDK callback types (defined locally — no AI SDK dep)
// ─────────────────────────────────────────────────────────────────────────────

export interface VercelToolCallInfo {
  toolCallId: string;
  toolName: string;
  args: unknown;
}

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

// ─────────────────────────────────────────────────────────────────────────────
// Hook return types
// ─────────────────────────────────────────────────────────────────────────────

export interface UseAIToolsResult<P extends LLMPlatform> {
  tools: PlatformToolsMap[P] | null;
  callTool: (name: string, args: Record<string, unknown>) => Promise<FormattedToolResult>;
  loading: boolean;
  error: Error | null;
}

export interface UseVercelAIResult {
  tools: VercelAITools | null;
  onToolCall: (info: VercelToolCallInfo) => Promise<unknown>;
  loading: boolean;
  error: Error | null;
}

export interface UseOpenAIToolsResult {
  tools: OpenAITool[] | null;
  handleToolCalls: (
    toolCalls: OpenAIToolCallItem[],
  ) => Promise<Array<{ role: 'tool'; tool_call_id: string; content: string }>>;
  loading: boolean;
  error: Error | null;
}

export interface UseClaudeToolsResult {
  tools: ClaudeTool[] | null;
  handleToolUse: (
    toolUseBlocks: ClaudeToolUseBlock[],
  ) => Promise<Array<{ type: 'tool_result'; tool_use_id: string; content: string }>>;
  loading: boolean;
  error: Error | null;
}
