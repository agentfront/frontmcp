/**
 * SendElicitationResult System Tool
 *
 * System tool for submitting user responses for pending elicitation requests.
 * Used as a fallback for MCP clients that don't support the standard elicitation protocol.
 *
 * Flow:
 * 1. Tool calls elicit() -> client doesn't support elicitation -> ElicitationFallbackRequired thrown
 * 2. CallToolFlow catches error, stores pending context, returns instructions to LLM
 * 3. LLM asks user for input, then calls this tool with the response
 * 4. This tool stores the resolved result and re-invokes the original tool
 * 5. Original tool's elicit() returns the pre-resolved result immediately
 */

import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Tool, ToolContext } from '../common';
import type { ElicitResult, ElicitStatus } from './elicitation.types';
import type { Scope } from '../scope';

const inputSchema = {
  elicitId: z.string().describe('The elicitation ID from the pending request'),
  action: z.enum(['accept', 'cancel', 'decline']).describe('User action: accept (submit), cancel, or decline'),
  content: z.unknown().optional().describe('User response content (required for accept action)'),
};

/** Input type for sendElicitationResult tool */
type SendElicitationResultInput = z.input<z.ZodObject<typeof inputSchema>>;

/**
 * System tool for submitting elicitation results.
 *
 * This tool is automatically registered for clients that don't support
 * the standard MCP elicitation protocol. When a tool calls elicit() and
 * the client doesn't support it, the framework returns instructions to
 * the LLM. The LLM collects user input and calls this tool to continue.
 *
 * @internal This is a system tool, not meant for direct use by developers.
 */
@Tool({
  name: 'sendElicitationResult',
  description:
    'Submit user response for a pending elicitation request. ' +
    'Use this after collecting user input for a tool that requested elicitation. ' +
    'Actions: "accept" (user submitted response), "cancel" (user cancelled), "decline" (user declined to answer).',
  inputSchema,
  // Hidden by default, only shown to clients that don't support elicitation
  hideFromDiscovery: true,
})
export class SendElicitationResultTool extends ToolContext<typeof inputSchema> {
  async execute(input: SendElicitationResultInput): Promise<CallToolResult> {
    const { elicitId, action, content } = input;

    this.logger.info('sendElicitationResult: processing', { elicitId, action });

    // Cast scope to Scope type to access elicitationStore
    const scope = this.scope as unknown as Scope;

    // Guard: ensure scope and elicitationStore exist
    if (!scope?.elicitationStore) {
      this.logger.error('sendElicitationResult: scope or elicitationStore not available');
      return {
        content: [
          {
            type: 'text',
            text: 'Error: Elicitation store not available. Server may not be properly configured.',
          },
        ],
        isError: true,
      };
    }

    // Get pending fallback context
    const pending = await scope.elicitationStore.getPendingFallback(elicitId);
    if (!pending) {
      this.logger.warn('sendElicitationResult: no pending elicitation found', { elicitId });
      return {
        content: [
          {
            type: 'text',
            text: `Error: No pending elicitation found for ID: ${elicitId}. The request may have expired or already been processed.`,
          },
        ],
        isError: true,
      };
    }

    // Check expiration
    if (Date.now() > pending.expiresAt) {
      await scope.elicitationStore.deletePendingFallback(elicitId);
      this.logger.warn('sendElicitationResult: elicitation expired', { elicitId });
      return {
        content: [
          {
            type: 'text',
            text: `Error: Elicitation request has expired. Please try the original operation again.`,
          },
        ],
        isError: true,
      };
    }

    // Build elicit result
    const elicitResult: ElicitResult<unknown> = {
      status: action as ElicitStatus,
      ...(action === 'accept' && content !== undefined && { content }),
    };

    // Store resolved result for re-invocation (pass sessionId for encryption support)
    await scope.elicitationStore.setResolvedResult(elicitId, elicitResult, pending.sessionId);

    // Clean up pending fallback
    await scope.elicitationStore.deletePendingFallback(elicitId);

    this.logger.info('sendElicitationResult: re-invoking original tool', {
      elicitId,
      toolName: pending.toolName,
    });

    // Inject pre-resolved result into context for re-invocation
    const ctx = this.tryGetContext();
    if (ctx) {
      ctx.setPreResolvedElicitResult(elicitResult);
    }

    try {
      // Re-invoke the original tool using the flow
      // The pre-resolved result is in the async context, so the tool's elicit()
      // will return it immediately instead of throwing ElicitationFallbackRequired
      const toolResult = await scope.runFlowForOutput('tools:call-tool', {
        request: {
          method: 'tools/call',
          params: {
            name: pending.toolName,
            arguments: pending.toolInput as Record<string, unknown> | undefined,
          },
        },
        // Pass the context for auth info and request ID (used for elicitation routing)
        ctx: this.tryGetContext() ?? { authInfo: this.getAuthInfo() },
      });

      this.logger.info('sendElicitationResult: original tool completed', {
        elicitId,
        toolName: pending.toolName,
      });

      // Publish the result to notify any waiting requests (distributed mode)
      // This allows the original request on a different node to receive the result
      await scope.elicitationStore.publishFallbackResult(elicitId, pending.sessionId, {
        success: true,
        result: toolResult,
      });

      // Clean up resolved result
      await scope.elicitationStore.deleteResolvedResult(elicitId);

      return toolResult;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Publish the error to notify any waiting requests (distributed mode)
      await scope.elicitationStore.publishFallbackResult(elicitId, pending.sessionId, {
        success: false,
        error: errorMessage,
      });

      // Clean up resolved result on error
      await scope.elicitationStore.deleteResolvedResult(elicitId);

      this.logger.error('sendElicitationResult: original tool failed', {
        elicitId,
        toolName: pending.toolName,
        error: errorMessage,
      });

      return {
        content: [
          {
            type: 'text',
            text: `Error re-invoking ${pending.toolName}: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  }
}

/**
 * Check if a tool name is the sendElicitationResult system tool.
 */
export function isSendElicitationResultTool(toolName: string): boolean {
  return toolName === 'sendElicitationResult';
}
