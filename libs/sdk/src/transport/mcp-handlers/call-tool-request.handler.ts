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
    handler: async (request: CallToolRequest, ctx) =>{

      const result = await scope.runFlowForOutput('tools:call-tool', {request, ctx})
      console.log(result)
      return result;
    }
  } satisfies McpHandler<CallToolRequest, CallToolResult>

}
