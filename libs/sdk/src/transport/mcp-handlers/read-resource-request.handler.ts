// file: libs/sdk/src/transport/mcp-handlers/read-resource-request.handler.ts

import { ReadResourceRequestSchema, type ReadResourceRequest, type ReadResourceResult } from '@frontmcp/protocol';

import { ErrorHandler, isMrtrSignal } from '../../errors';
import { toReportedError, toSdkMcpError } from './mcp-error.utils';
import { type McpHandler, type McpHandlerOptions } from './mcp-handlers.types';

export default function readResourceRequestHandler({
  scope,
}: McpHandlerOptions): McpHandler<ReadResourceRequest, ReadResourceResult> {
  const logger = scope.logger.child('read-resource-request-handler');
  const errorHandler = new ErrorHandler({ logger });

  return {
    requestSchema: ReadResourceRequestSchema,
    handler: async (request: ReadResourceRequest, ctx) => {
      const uri = request.params?.uri || 'unknown';
      logger.info(`resources/read: ${uri}`);
      const start = Date.now();
      try {
        const result = await scope.runFlowForOutput('resources:read-resource', { request, ctx });
        logger.verbose('resources/read completed', { uri, durationMs: Date.now() - start });
        return result;
      } catch (e) {
        // MRTR signals are answered by the 2026-07-28 dispatcher, not reported as failures
        if (isMrtrSignal(e)) throw e;
        const failure = toReportedError(e);
        errorHandler.logError(failure, { flowName: 'resources:read-resource', uri });
        // Preserve structured JSON-RPC codes (e.g. AuthorityDeniedError -32003,
        // ResourceNotFoundError -32002) instead of letting the generic dispatch
        // flatten them to -32603 — mirrors the skills/load handler.
        throw toSdkMcpError(failure);
      }
    },
  };
}
