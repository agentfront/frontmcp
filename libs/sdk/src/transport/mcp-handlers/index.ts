import { McpHandlerOptions } from './mcp-handlers.types';
import initializeRequestHandler from './initialize-request.handler';
import initializedNotificationHandler from './Initialized-notification.hanlder';
import listToolsRequestHandler from './list-tools-request.handler';
import callToolRequestHandler from './call-tool-request.handler';
import listResourcesRequestHandler from './list-resources-request.handler';
import listResourceTemplatesRequestHandler from './list-resource-templates-request.handler';
import readResourceRequestHandler from './read-resource-request.handler';
import subscribeRequestHandler from './subscribe-request.handler';
import unsubscribeRequestHandler from './unsubscribe-request.handler';
import listPromptsRequestHandler from './list-prompts-request.handler';
import getPromptRequestHandler from './get-prompt-request.handler';
import completeRequestHandler from './complete-request.handler';
import loggingSetLevelRequestHandler from './logging-set-level-request.handler';
import rootsListChangedNotificationHandler from './roots-list-changed-notification.handler';

export function createMcpHandlers(options: McpHandlerOptions) {
  const toolsHandler = options.serverOptions?.capabilities?.tools
    ? [listToolsRequestHandler(options), callToolRequestHandler(options)]
    : [];
  const resourcesHandler = options.serverOptions?.capabilities?.resources
    ? [
        listResourcesRequestHandler(options),
        listResourceTemplatesRequestHandler(options),
        readResourceRequestHandler(options),
        subscribeRequestHandler(options),
        unsubscribeRequestHandler(options),
      ]
    : [];

  const promptsHandler = options.serverOptions?.capabilities?.prompts
    ? [listPromptsRequestHandler(options), getPromptRequestHandler(options)]
    : [];

  // Completion handler is available when prompts or resources are enabled
  // Per MCP spec, completion/complete supports both ref/prompt and ref/resource
  const completionHandler =
    options.serverOptions?.capabilities?.prompts || options.serverOptions?.capabilities?.resources
      ? [completeRequestHandler(options)]
      : [];

  // Logging handler is available when logging capability is enabled
  // Per MCP 2025-11-25 spec, servers MAY provide logging capability
  const loggingHandler = options.serverOptions?.capabilities?.logging ? [loggingSetLevelRequestHandler(options)] : [];

  return [
    initializeRequestHandler(options),
    initializedNotificationHandler(options),
    rootsListChangedNotificationHandler(options),
    ...toolsHandler,
    ...resourcesHandler,
    ...promptsHandler,
    ...completionHandler,
    ...loggingHandler,
  ];
}

// export function hookMcpHandlers(gateway: FrontMcpInterface, handlers: McpHandler[]): McpHandler[] {
//   return handlers;
// }
