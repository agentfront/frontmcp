import { SetLevelRequestSchema, type EmptyResult, type SetLevelRequest } from '@frontmcp/protocol';

import { toSdkMcpError } from './mcp-error.utils';
import { type McpHandler, type McpHandlerOptions } from './mcp-handlers.types';
import { withMcpSurface } from './mcp-surface';

/**
 * Handler for the logging/setLevel MCP request: runs the `logging:set-level` flow.
 * Per MCP 2025-11-25 spec, this allows clients to set the minimum log level
 * for log messages sent via notifications/message.
 */
export default function LoggingSetLevelRequestHandler({ scope }: McpHandlerOptions) {
  return {
    requestSchema: SetLevelRequestSchema,
    handler: async (request: SetLevelRequest, ctx): Promise<EmptyResult> => {
      try {
        return await scope.runFlowForOutput('logging:set-level', { request, ctx: withMcpSurface(scope, ctx) });
      } catch (error) {
        throw toSdkMcpError(error);
      }
    },
  } satisfies McpHandler<SetLevelRequest, EmptyResult>;
}
