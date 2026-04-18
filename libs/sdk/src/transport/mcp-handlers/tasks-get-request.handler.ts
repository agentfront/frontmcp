import { GetTaskRequestSchema, type GetTaskRequest, type GetTaskResult } from '@frontmcp/protocol';

import { toSdkMcpError } from './mcp-error.utils';
import { type McpHandler, type McpHandlerOptions } from './mcp-handlers.types';

export default function tasksGetRequestHandler({
  scope,
}: McpHandlerOptions): McpHandler<GetTaskRequest, GetTaskResult> {
  const logger = scope.logger.child('tasks-get-request-handler');
  return {
    requestSchema: GetTaskRequestSchema,
    handler: async (request, ctx) => {
      logger.verbose(`tasks/get: ${request.params?.taskId}`);
      try {
        const result = await scope.runFlowForOutput('tasks:get', { request, ctx });
        return result as unknown as GetTaskResult;
      } catch (e) {
        logger.error('tasks/get failed', { error: e instanceof Error ? e.message : e });
        throw toSdkMcpError(e);
      }
    },
  } satisfies McpHandler<GetTaskRequest, GetTaskResult>;
}
