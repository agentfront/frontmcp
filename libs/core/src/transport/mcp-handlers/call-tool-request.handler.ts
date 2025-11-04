import {
  CallToolRequestSchema,
  CallToolRequest,
  CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import {McpHandler, McpHandlerOptions} from './mcp-handlers.types';

export default function callToolRequestHandler(
  {scope}: McpHandlerOptions,
): McpHandler<CallToolRequest, CallToolResult> {
  return {
    requestSchema: CallToolRequestSchema,
    handler: async function (request: CallToolRequest, ctx): Promise<CallToolResult> {

      // const tool = scope.tools.find(tool => tool.metadata.name === request.params.name);
      // if (!tool) {
      //   throw new Error('Tool not found');
      // }

      return {
        content: [{
          type: 'text',
          text: 'tesintg',
        }],
      };
      // const { params } = request;
      // const [appName, ...toolNameNest] = params.name.split(':');
      //
      // const toolName = toolNameNest.join('');
      // let tool: ToolRecordImpl | undefined;
      // const toolApp = options.scope.apps.find((app) => app.id === appName);
      // if (toolApp) {
      //   tool = toolApp.tools.getTool(toolName) || toolApp.tools.getTool(params.name);
      // }
      // if (!tool) {
      //   if (options.scope.apps.some((app) => app.id === appName)) {
      //     const toolApp = options.scope.apps.find((app) => app.id === appName);
      //     tool = toolApp?.tools.getTool(params.name);
      //   }
      // }
      //
      // if (tool) {
      //   try {
      //     const toolExecutor = ToolExecuteFlow.create({
      //       scope: options.scope,
      //       providerGettersOptions: {
      //         before: [scoped.request([[AuthScope, options.scope]])],
      //       },
      //     });
      //     const result = await toolExecutor.run({ tool, payload: params, authInfo } as any);
      //
      //     return {
      //       content: [
      //         {
      //           type: 'text',
      //           text: JSON.stringify(result),
      //         },
      //       ],
      //     };
      //   } catch (e) {
      //     console.error(e);
      //   }
      // }
      // throw new Error('Tool not found');
    },
  };
}
