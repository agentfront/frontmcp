import { McpHandlerOptions } from './mcp-handlers.types';
import initializeRequestHandler from './initialize-request.handler';
import initializedNotificationHandler from './Initialized-notification.hanlder';
import listToolsRequestHandler from './list-tools-request.handler';
import callToolRequestHandler from './call-tool-request.handler';
import listResourcesRequestHandler from './list-resources-request.handler';
import listResourceTemplatesRequestHandler from './list-resource-templates-request.handler';
import readResourceRequestHandler from './read-resource-request.handler';

export function createMcpHandlers(options: McpHandlerOptions) {
  return [
    initializeRequestHandler(options),
    initializedNotificationHandler(options),

    ...(options.serverOptions?.capabilities?.tools
      ? [listToolsRequestHandler(options), callToolRequestHandler(options)]
      : []),
    ...(options.serverOptions?.capabilities?.resources
      ? [
          listResourcesRequestHandler(options),
          listResourceTemplatesRequestHandler(options),
          readResourceRequestHandler(options),
        ]
      : []),
  ];
}

// export function hookMcpHandlers(gateway: FrontMcpInterface, handlers: McpHandler[]): McpHandler[] {
//   return handlers;
// }
