import { UnsubscribeRequestSchema, type EmptyResult, type UnsubscribeRequest } from '@frontmcp/protocol';

import { toSdkMcpError } from './mcp-error.utils';
import { type McpHandler, type McpHandlerOptions } from './mcp-handlers.types';
import { withMcpSurface } from './mcp-surface';

/**
 * Handler for the resources/unsubscribe MCP request: runs the `resources:unsubscribe` flow.
 * Per MCP 2025-11-25 spec, this allows clients to unsubscribe from
 * receiving notifications about a specific resource.
 */
export default function UnsubscribeRequestHandler({ scope }: McpHandlerOptions) {
  return {
    requestSchema: UnsubscribeRequestSchema,
    handler: async (request: UnsubscribeRequest, ctx): Promise<EmptyResult> => {
      try {
        return await scope.runFlowForOutput('resources:unsubscribe', { request, ctx: withMcpSurface(scope, ctx) });
      } catch (error) {
        throw toSdkMcpError(error);
      }
    },
  } satisfies McpHandler<UnsubscribeRequest, EmptyResult>;
}
