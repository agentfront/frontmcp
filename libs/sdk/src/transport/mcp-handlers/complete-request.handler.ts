import { CompleteRequestSchema, CompleteRequest, CompleteResult } from '@modelcontextprotocol/sdk/types.js';
import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';

export default function completeRequestHandler({
  scope,
}: McpHandlerOptions): McpHandler<CompleteRequest, CompleteResult> {
  const logger = scope.logger.child('complete-request-handler');

  return {
    requestSchema: CompleteRequestSchema,
    handler: async (request: CompleteRequest, ctx) => {
      logger.verbose('completion/complete requested');
      const start = Date.now();
      try {
        const result = await scope.runFlowForOutput('completion:complete', { request, ctx });
        logger.verbose('completion/complete completed', { durationMs: Date.now() - start });
        return result;
      } catch (e) {
        logger.error('completion/complete failed', {
          error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : e,
        });
        throw e;
      }
    },
  };
}
