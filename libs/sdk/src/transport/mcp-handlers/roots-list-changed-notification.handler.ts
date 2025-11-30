import { RootsListChangedNotificationSchema, Result } from '@modelcontextprotocol/sdk/types.js';
import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';
import type { RootsListChangedNotification } from '@modelcontextprotocol/sdk/types.js';

/**
 * Handler for `notifications/roots/list_changed` notification from the client.
 *
 * Per MCP 2025-11-25 spec, this notification is sent by clients that support
 * roots to indicate that the list of roots has changed. When received, the
 * server should invalidate any cached roots and optionally re-fetch them.
 */
export default function rootsListChangedNotificationHandler({
  scope,
}: McpHandlerOptions): McpHandler<RootsListChangedNotification, Result> {
  return {
    requestSchema: RootsListChangedNotificationSchema,
    handler: async (request, ctx): Promise<Result> => {
      const sessionId = ctx.authInfo?.sessionId;
      if (sessionId) {
        // Invalidate cached roots for this session
        scope.notifications.invalidateRootsCache(sessionId);
      }
      // Notifications don't return a response body
      return {};
    },
  };
}
