import {
  CallToolRequestSchema,
  CallToolResultSchema,
  type CallToolRequest,
  type CallToolResult,
} from '@frontmcp/protocol';

import { FlowControl } from '../../common';
import {
  formatMcpErrorResponse,
  InternalMcpError,
  TaskAugmentationNotSupportedError,
  TaskAugmentationRequiredError,
  ToolCredentialsRequiredError,
} from '../../errors';
import { toSdkMcpError } from './mcp-error.utils';
import { type McpHandler, type McpHandlerOptions } from './mcp-handlers.types';

export default function callToolRequestHandler({
  scope,
}: McpHandlerOptions): McpHandler<CallToolRequest, CallToolResult> {
  const logger = scope.logger.child('call-tool-request-handler');

  return {
    requestSchema: CallToolRequestSchema,
    handler: async (request: CallToolRequest, ctx) => {
      const toolName = request.params?.name || 'unknown';
      logger.info(`tools/call: ${toolName}`);
      const start = Date.now();

      try {
        // Issue #417 — tag the call ctx with `surface: 'mcp'` so per-call
        // surface filtering in the tool flow knows which transport this
        // request came from. Tools that opt into `availableWhen: {
        // surface: ['cli'] }` (or any surface other than mcp) are then
        // blocked at the call boundary with a structured error.
        const taggedCtx = { ...(ctx as Record<string, unknown>), surface: 'mcp' };
        const result = await scope.runFlowForOutput('tools:call-tool', { request, ctx: taggedCtx });
        logger.verbose('tools/call completed', { tool: toolName, durationMs: Date.now() - start });
        return result;
      } catch (e) {
        // FlowControl is a control flow mechanism, not an error - handle silently
        if (e instanceof FlowControl) {
          if (e.type === 'respond') {
            // Validate output using MCP schema
            const parseResult = CallToolResultSchema.safeParse(e.output);
            if (parseResult.success) {
              return parseResult.data;
            }
            logger.error('FlowControl.respond has invalid output', {
              tool: toolName,
              validationErrors: parseResult.error.issues,
            });
            return formatMcpErrorResponse(new InternalMcpError('FlowControl output is not a valid CallToolResult'));
          }
          // #369 — for `fail`, propagate the original error (set by FlowControl.fail)
          // so PublicMcpError.message/code reach the client intact instead of being
          // flattened to the "Flow ended with: fail" sentinel. Mirrors the unwrap
          // already in `direct-server.ts:125-128` so both transport paths agree.
          if (e.type === 'fail') {
            const original = (e as { originalError?: unknown }).originalError;
            if (original !== undefined) {
              return formatMcpErrorResponse(original);
            }
          }
          // For handled, next, abort (and `fail` with no original error) — return appropriate response
          logger.warn(`FlowControl ended with type: ${e.type}`, { tool: toolName, type: e.type, output: e.output });
          return formatMcpErrorResponse(new InternalMcpError(`Flow ended with: ${e.type}`));
        }

        // Task augmentation rejections are protocol-level errors per MCP spec §Tool-Level
        // Negotiation — emit them as JSON-RPC errors (not CallToolResult with isError).
        if (e instanceof TaskAugmentationNotSupportedError || e instanceof TaskAugmentationRequiredError) {
          throw toSdkMcpError(e);
        }

        // The tool-level credential gate is an authorization failure: emit it as a
        // JSON-RPC -32001 (MCP UNAUTHORIZED) error carrying { tool, providers,
        // authUrl } in `data` (not a CallToolResult with isError), so clients can
        // react structurally and surface the connect/authorize URL.
        if (e instanceof ToolCredentialsRequiredError) {
          throw toSdkMcpError(e);
        }

        // Log detailed error info
        logger.error('CallTool Failed', {
          tool: toolName,
          error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : e,
        });
        return formatMcpErrorResponse(e);
      }
    },
  } satisfies McpHandler<CallToolRequest, CallToolResult>;
}
