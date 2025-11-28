import { McpHandlerOptions } from './mcp-handlers.types';
import initializeRequestHandler from './initialize-request.handler';
import initializedNotificationHandler from './Initialized-notification.hanlder';
import listToolsRequestHandler from './list-tools-request.handler';
import callToolRequestHandler from './call-tool-request.handler';
import listResourcesRequestHandler from './list-resources-request.handler';
import listResourceTemplatesRequestHandler from './list-resource-templates-request.handler';
import readResourceRequestHandler from './read-resource-request.handler';
import listPromptsRequestHandler from './list-prompts-request.handler';
import getPromptRequestHandler from './get-prompt-request.handler';

export function createMcpHandlers(options: McpHandlerOptions) {
  const toolsHandler = options.serverOptions?.capabilities?.tools
    ? [listToolsRequestHandler(options), callToolRequestHandler(options)]
    : [];
  const resourcesHandler = options.serverOptions?.capabilities?.resources
    ? [
        listResourcesRequestHandler(options),
        listResourceTemplatesRequestHandler(options),
        readResourceRequestHandler(options),
      ]
    : [];

  const promptsHandler = options.serverOptions?.capabilities?.prompts
    ? [listPromptsRequestHandler(options), getPromptRequestHandler(options)]
    : [];
  return [
    initializeRequestHandler(options),
    initializedNotificationHandler(options),
    ...toolsHandler,
    ...resourcesHandler,
    ...promptsHandler,
  ];
}

// export function hookMcpHandlers(gateway: FrontMcpInterface, handlers: McpHandler[]): McpHandler[] {
//   return handlers;
// }
