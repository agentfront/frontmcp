// file: libs/plugins/src/codecall/utils/mcp-result.ts

import type { CallToolResult } from '@frontmcp/protocol';
import { PublicMcpError } from '@frontmcp/sdk';

import { toPlainJson } from './plain-json';

/**
 * Extract the actual result from a CallToolResult.
 * MCP returns results wrapped in content array format.
 */
export function extractResultFromCallToolResult(mcpResult: CallToolResult): unknown {
  // MCP CallToolResult has { content: [...], isError?: boolean }
  if (mcpResult.isError) {
    // The result's text is what an MCP client was told, so it stays public, under the result's own code.
    const errorContent = mcpResult.content?.[0];
    const message = errorContent && 'text' in errorContent ? errorContent.text : 'Tool execution failed';
    const code = mcpResult._meta?.['code'];
    throw new PublicMcpError(message, typeof code === 'string' ? code : 'TOOL_ERROR_RESULT');
  }

  // For successful results, try to extract the actual data
  const content = mcpResult.content;
  if (!content || content.length === 0) {
    return undefined;
  }

  // If there's a single text content, try to parse as JSON
  if (content.length === 1 && content[0].type === 'text') {
    try {
      return JSON.parse(content[0].text);
    } catch {
      return content[0].text;
    }
  }

  // Complex results come back as a plain-JSON projection of the content array, or undefined
  // when the content has no JSON representation.
  return toPlainJson(content);
}
