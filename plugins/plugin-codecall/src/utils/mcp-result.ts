// file: libs/plugins/src/codecall/utils/mcp-result.ts

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Extract the actual result from a CallToolResult.
 * MCP returns results wrapped in content array format.
 */
export function extractResultFromCallToolResult(mcpResult: CallToolResult): unknown {
  // MCP CallToolResult has { content: [...], isError?: boolean }
  if (mcpResult.isError) {
    // If it's an error, extract the error message from content
    const errorContent = mcpResult.content?.[0];
    if (errorContent && 'text' in errorContent) {
      throw new Error(errorContent.text);
    }
    throw new Error('Tool execution failed');
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

  // Return the raw content for complex results
  return content;
}
