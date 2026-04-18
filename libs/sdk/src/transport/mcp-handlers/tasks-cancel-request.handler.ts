import { CancelTaskRequestSchema, type CancelTaskRequest, type CancelTaskResult } from '@frontmcp/protocol';

import { toSdkMcpError } from './mcp-error.utils';
import { type McpHandler, type McpHandlerOptions } from './mcp-handlers.types';

export default function tasksCancelRequestHandler({
  scope,
}: McpHandlerOptions): McpHandler<CancelTaskRequest, CancelTaskResult> {
  const logger = scope.logger.child('tasks-cancel-request-handler');
  return {
    requestSchema: CancelTaskRequestSchema,
    handler: async (request, ctx) => {
      logger.info(`tasks/cancel: ${request.params?.taskId}`);
      try {
        const result = await scope.runFlowForOutput('tasks:cancel', { request, ctx });
        return result as unknown as CancelTaskResult;
      } catch (e) {
        logger.error('tasks/cancel failed', { error: e instanceof Error ? e.message : e });
        throw toSdkMcpError(e);
      }
    },
  } satisfies McpHandler<CancelTaskRequest, CancelTaskResult>;
}
