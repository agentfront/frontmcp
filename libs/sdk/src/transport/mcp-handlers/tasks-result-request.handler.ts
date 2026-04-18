import { GetTaskPayloadRequestSchema, type GetTaskPayloadRequest, type GetTaskPayloadResult } from '@frontmcp/protocol';

import { toSdkMcpError } from './mcp-error.utils';
import { type McpHandler, type McpHandlerOptions } from './mcp-handlers.types';

export default function tasksResultRequestHandler({
  scope,
}: McpHandlerOptions): McpHandler<GetTaskPayloadRequest, GetTaskPayloadResult> {
  const logger = scope.logger.child('tasks-result-request-handler');
  return {
    requestSchema: GetTaskPayloadRequestSchema,
    handler: async (request, ctx) => {
      logger.verbose(`tasks/result: ${request.params?.taskId}`);
      try {
        const result = await scope.runFlowForOutput('tasks:result', { request, ctx });
        return result as unknown as GetTaskPayloadResult;
      } catch (e) {
        logger.error('tasks/result failed', { error: e instanceof Error ? e.message : e });
        throw toSdkMcpError(e);
      }
    },
  } satisfies McpHandler<GetTaskPayloadRequest, GetTaskPayloadResult>;
}
