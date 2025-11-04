
import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';
import initializeRequestHandler from './initialize-request.handler';
import initializedNotificationHandler from './Initialized-notification.hanlder';
import listToolsRequestHandler from './list-tools-request.handler';
import callToolRequestHandler from './call-tool-request.handler';

export function createMcpHandlers(options: McpHandlerOptions): McpHandler<any, any>[] {
  return [
    initializeRequestHandler(options),
    initializedNotificationHandler(options),
    listToolsRequestHandler(options),
    callToolRequestHandler(options),
  ];
}

// export function hookMcpHandlers(gateway: FrontMcpInterface, handlers: McpHandler[]): McpHandler[] {
//   return handlers;
// }
