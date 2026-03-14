/**
 * AI SDK integration types.
 *
 * Platform-specific tool call types are re-exported from @frontmcp/utils.
 * SDK-dependent types (tool shapes, hook return types) remain here.
 */

import type { OpenAITool, ClaudeTool, LangChainTool, VercelAITools, LLMPlatform, CallToolResult } from '@frontmcp/sdk';
import type {
  OpenAIToolCallItem as _OpenAIToolCallItem,
  ClaudeToolUseBlock as _ClaudeToolUseBlock,
  VercelToolCallInfo as _VercelToolCallInfo,
} from '@frontmcp/utils';

// Re-export platform types from @frontmcp/utils for backward compatibility
export type OpenAIToolCallItem = _OpenAIToolCallItem;
export type ClaudeToolUseBlock = _ClaudeToolUseBlock;
export type VercelToolCallInfo = _VercelToolCallInfo;

/**
 * Formatted tool result — local union matching SDK's FormattedToolResult.
 * Synced with: libs/sdk/src/direct/llm-platform.ts FormattedToolResult
 * @see libs/react/src/ai/__tests__/types-compat.spec.ts for drift guard
 */
export type FormattedToolResult =
  | string
  | Record<string, unknown>
  | Array<{ type: string; text: string }>
  | CallToolResult['content']
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
// Hook return types
// ─────────────────────────────────────────────────────────────────────────────

export interface UseAIToolsResult<P extends LLMPlatform> {
  tools: PlatformToolsMap[P] | null;
  callTool: (name: string, args?: Record<string, unknown>) => Promise<FormattedToolResult>;
  loading: boolean;
  error: Error | null;
}
