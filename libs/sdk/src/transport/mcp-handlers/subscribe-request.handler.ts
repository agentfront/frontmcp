import { SubscribeRequestSchema, type EmptyResult, type SubscribeRequest } from '@frontmcp/protocol';

import { toSdkMcpError } from './mcp-error.utils';
import { type McpHandler, type McpHandlerOptions } from './mcp-handlers.types';
import { withMcpSurface } from './mcp-surface';

/**
 * Handler for the resources/subscribe MCP request: runs the `resources:subscribe` flow.
 * Per MCP 2025-11-25 spec, this allows clients to subscribe to receive
 * notifications when a specific resource changes.
 */
export default function SubscribeRequestHandler({ scope }: McpHandlerOptions) {
  return {
    requestSchema: SubscribeRequestSchema,
    handler: async (request: SubscribeRequest, ctx): Promise<EmptyResult> => {
      try {
        return await scope.runFlowForOutput('resources:subscribe', { request, ctx: withMcpSurface(scope, ctx) });
      } catch (error) {
        throw toSdkMcpError(error);
      }
    },
  } satisfies McpHandler<SubscribeRequest, EmptyResult>;
}
