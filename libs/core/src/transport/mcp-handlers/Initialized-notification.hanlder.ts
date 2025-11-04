import {
  isInitializedNotification,
  InitializedNotificationSchema,
  InitializeResultSchema,
  InitializedNotification,
  Result,
} from '@modelcontextprotocol/sdk/types.js';
import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';

export default function initializedNotificationHandler(
  options: McpHandlerOptions
): McpHandler<InitializedNotification> {
  return {
    when: isInitializedNotification,
    requestSchema: InitializedNotificationSchema,
    responseSchema: InitializeResultSchema,
    handler: async (request: InitializedNotification, ctx): Promise<Result> => {
      // check session
      return {};
    },
  };
}
