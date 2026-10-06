import type { CallToolResult } from '@frontmcp/protocol';

import { PublicMcpError } from './mcp.error';

/**
 * A tool call made through a `connectOpenAI()` / `connectClaude()` / `connectLangChain()` /
 * `connectVercelAI()` client failed (`isError` in its result). Those formats have no place for the
 * flag, so the call rejects with this error: `message` is the tool's error text and `result` the raw
 * `CallToolResult`.
 */
export class ToolCallError extends PublicMcpError {
  readonly toolName: string;
  readonly result: CallToolResult;

  constructor(toolName: string, result: CallToolResult) {
    const text = result.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
    super(text || `Tool "${toolName}" failed`, 'TOOL_CALL_ERROR', 400);
    this.toolName = toolName;
    this.result = result;
  }
}
