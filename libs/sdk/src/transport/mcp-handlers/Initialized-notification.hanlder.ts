import { InitializedNotificationSchema, InitializedNotification, Result } from '@modelcontextprotocol/sdk/types.js';
import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';

export default function initializedNotificationHandler(
  options: McpHandlerOptions,
): McpHandler<InitializedNotification, Result> {
  return {
    requestSchema: InitializedNotificationSchema,
    handler: async (request: InitializedNotification, ctx): Promise<Result> => {
      // check session
      return {};
    },
  };
}
