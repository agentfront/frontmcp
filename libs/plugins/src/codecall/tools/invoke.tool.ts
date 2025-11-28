// file: libs/plugins/src/codecall/tools/invoke.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  InvokeToolInput,
  invokeToolInputSchema,
  InvokeToolOutput,
  invokeToolOutputSchema,
  invokeToolDescription,
} from './invoke.schema';
import { isBlockedSelfReference } from '../security';

/**
 * Build an MCP error response in CallToolResult format.
 */
function buildErrorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

/**
 * InvokeTool allows direct tool invocation without running JavaScript code.
 * Returns the same CallToolResult format as a standard MCP tool call.
 *
 * Security Considerations:
 * - Self-reference blocking: Cannot invoke codecall:* tools
 * - All middleware (auth, PII, rate limiting) applies via normal tool execution
 */
@Tool({
  name: 'codecall:invoke',
  cache: {
    ttl: 0, // No caching - each invocation is unique
    slideWindow: false,
  },
  codecall: {
    enabledInCodeCall: false,
    visibleInListTools: true,
  },
  description: invokeToolDescription,
  inputSchema: invokeToolInputSchema,
  outputSchema: invokeToolOutputSchema,
})
export default class InvokeTool extends ToolContext {
  async execute(input: InvokeToolInput): Promise<InvokeToolOutput> {
    const { tool: toolName, input: toolInput } = input;

    // Security: Cannot invoke codecall:* tools to prevent recursion attacks
    if (isBlockedSelfReference(toolName)) {
      return buildErrorResult(
        `Tool "${toolName}" cannot be invoked directly. CodeCall tools are internal and not accessible via codecall:invoke.`,
      );
    }

    // Execute through the flow system - returns standard CallToolResult
    // Flow handles: findTool, validation, quota, middleware, execution, error formatting
    const request = {
      method: 'tools/call' as const,
      params: {
        name: toolName,
        arguments: toolInput,
      },
    };

    const ctx = {
      authInfo: this.authInfo,
    };

    // runFlow returns CallToolResult directly - no transformation needed
    const result = await this.scope.runFlow('tools:call-tool', { request, ctx });

    // Flow returns null if tool not found or other pre-execution errors
    if (!result) {
      return buildErrorResult(`Tool "${toolName}" not found. Use codecall:search to discover available tools.`);
    }

    return result;
  }
}
