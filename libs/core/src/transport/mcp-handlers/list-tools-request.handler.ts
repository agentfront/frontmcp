import {
  ListToolsRequestSchema,
  ListToolsResultSchema,
  ListToolsRequest,
  ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js';
import { McpHandler, McpHandlerOptions } from './mcp-handlers.types';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';

const isListToolsRequest = (request: any): boolean => {
  return ListToolsRequestSchema.safeParse(request).success;
};
export default function ListToolsRequestHandler({
                                                  scope,
                                                }: McpHandlerOptions): McpHandler<ListToolsRequest, ListToolsResult> {
  return {
    when: isListToolsRequest,
    requestSchema: ListToolsRequestSchema,
    responseSchema: ListToolsResultSchema,
    handler: async (request: ListToolsRequest, ctx): Promise<ListToolsResult> => {
      const tools = scope.tools.map(tool => {

        const inputSchema = tool.metadata.rawInputSchema ?? zodToJsonSchema(z.object(tool.metadata.inputSchema)) as any;

        return {
          name: tool.metadata.name,
          title: tool.metadata.name,
          description: tool.metadata.description,
          inputSchema,
          annotations: tool.metadata.annotations,
        } satisfies ListToolsResult['tools'][number]
      });
      return { tools };
    },
  };
}
