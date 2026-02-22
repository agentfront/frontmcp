import { GetPromptRequestSchema, GetPromptRequest, GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';

export default function getPromptRequestHandler({
  scope,
}: McpHandlerOptions): McpHandler<GetPromptRequest, GetPromptResult> {
  const logger = scope.logger.child('get-prompt-request-handler');

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
        logger.error('prompts/get failed', {
          prompt: promptName,
          error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : e,
        });
        throw e;
      }
    },
  };
}
