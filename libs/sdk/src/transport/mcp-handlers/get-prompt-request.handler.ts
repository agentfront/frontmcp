import { GetPromptRequestSchema, type GetPromptRequest, type GetPromptResult } from '@frontmcp/protocol';

import { ErrorHandler, isMrtrSignal } from '../../errors';
import { toReportedError, toSdkMcpError } from './mcp-error.utils';
import { type McpHandler, type McpHandlerOptions } from './mcp-handlers.types';

export default function getPromptRequestHandler({
  scope,
}: McpHandlerOptions): McpHandler<GetPromptRequest, GetPromptResult> {
  const logger = scope.logger.child('get-prompt-request-handler');
  const errorHandler = new ErrorHandler({ logger });

  return {
    requestSchema: GetPromptRequestSchema,
    handler: async (request: GetPromptRequest, ctx) => {
      const promptName = request.params?.name || 'unknown';
      logger.info(`prompts/get: ${promptName}`);
      const start = Date.now();
      try {
        const result = await scope.runFlowForOutput('prompts:get-prompt', { request, ctx });
        logger.verbose('prompts/get completed', { prompt: promptName, durationMs: Date.now() - start });
        return result;
      } catch (e) {
        // MRTR signals are answered by the 2026-07-28 dispatcher, not reported as failures
        if (isMrtrSignal(e)) throw e;
        const failure = toReportedError(e);
        errorHandler.logError(failure, { flowName: 'prompts:get-prompt', prompt: promptName });
        throw toSdkMcpError(failure);
      }
    },
  };
}
