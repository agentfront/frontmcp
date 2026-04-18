import { ListTasksRequestSchema, type ListTasksRequest, type ListTasksResult } from '@frontmcp/protocol';

import { toSdkMcpError } from './mcp-error.utils';
import { type McpHandler, type McpHandlerOptions } from './mcp-handlers.types';

export default function tasksListRequestHandler({
  scope,
}: McpHandlerOptions): McpHandler<ListTasksRequest, ListTasksResult> {
  const logger = scope.logger.child('tasks-list-request-handler');
  return {
    requestSchema: ListTasksRequestSchema,
    handler: async (request, ctx) => {
      logger.verbose('tasks/list');
      try {
        const result = await scope.runFlowForOutput('tasks:list', { request, ctx });
        return result as unknown as ListTasksResult;
      } catch (e) {
        logger.error('tasks/list failed', { error: e instanceof Error ? e.message : e });
        throw toSdkMcpError(e);
      }
    },
  } satisfies McpHandler<ListTasksRequest, ListTasksResult>;
}
