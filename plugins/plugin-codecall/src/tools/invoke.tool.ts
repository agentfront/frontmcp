// file: libs/plugins/src/codecall/tools/invoke.tool.ts
import type { CallToolResult } from '@frontmcp/protocol';
import { Tool, ToolContext } from '@frontmcp/sdk';

import CodeCallConfig from '../providers/code-call.config';
import { checkCodeCallToolAccess, isBlockedSelfReference } from '../security';
import {
  invokeToolDescription,
  InvokeToolInput,
  invokeToolInputSchema,
  InvokeToolOutput,
  invokeToolOutputSchema,
} from './invoke.schema';

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
 * - Shares the CodeCall access policy with `codecall:execute`, so a tool withheld from
 *   scripts is not reachable by naming it here instead (GHSA-6w3j-82v5-6qrr)
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

    // The same policy `codecall:execute` applies, plus the `directCalls` options. Without
    // it this tool is a plain proxy over the whole registry, and every CodeCall restriction
    // an operator configured is bypassed by invoking the tool directly.
    // One message for "denied" and for "no such tool": distinguishing them would turn this
    // tool into an existence oracle for the tools the policy hides from codecall:search.
    const decision = checkCodeCallToolAccess(this.scope, this.get(CodeCallConfig), toolName, { directCall: true });
    if (!decision.allowed) {
      return buildErrorResult(`Tool "${toolName}" is not available. Use codecall:search to discover available tools.`);
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
