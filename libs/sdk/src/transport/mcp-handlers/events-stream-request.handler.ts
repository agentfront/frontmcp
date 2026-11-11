import {
  MCP_20260728_META,
  StreamEventsRequestSchema,
  type StreamEventsRequest,
  type StreamEventsResult,
} from '@frontmcp/protocol';
import { awaitOutsideRequest } from '@frontmcp/utils';

import { type EventStreamNotification } from '../../event/stream/event-stream';
import { toSdkMcpError } from './mcp-error.utils';
import { type McpHandler, type McpHandlerOptions } from './mcp-handlers.types';
import { withMcpSurface } from './mcp-surface';

/**
 * `events/stream` (MCP Events, SEP-3415) over a session or stdio: the request stays open, its notifications are sent
 * as they come, and its result is the final frame, once the client cancelled it or the server ended the stream.
 */
export default function eventsStreamRequestHandler({
  scope,
}: McpHandlerOptions): McpHandler<StreamEventsRequest, StreamEventsResult> {
  const logger = scope.logger.child('events-stream-request-handler');

  return {
    requestSchema: StreamEventsRequestSchema,
    handler: async (request: StreamEventsRequest, ctx) => {
      logger.verbose(`events/stream requested for "${request.params.name}"`);
      let opened;
      try {
        opened = await scope.runFlowForOutput('events:stream', {
          request,
          ctx: withMcpSurface(scope, ctx),
          requestId: ctx.requestId,
          signal: ctx.signal,
        });
      } catch (error) {
        throw toSdkMcpError(error);
      }
      const notifications: AsyncIterator<EventStreamNotification> = opened.stream[Symbol.asyncIterator]();
      try {
        for (;;) {
          // Waiting for the next notification lets other requests take their turn in a browser without AsyncContext
          const next = await awaitOutsideRequest(notifications.next());
          if (next.done) break;
          await ctx.sendNotification(next.value as never);
        }
      } finally {
        opened.stream.close();
      }
      return { _meta: { [MCP_20260728_META.subscriptionId]: ctx.requestId } };
    },
  };
}
