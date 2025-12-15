import { Resource, ResourceContext, MCP_ERROR_CODES } from '@frontmcp/sdk';
import { z } from 'zod';

const outputSchema = z.object({
  errorCodes: z.array(
    z.object({
      name: z.string(),
      code: z.number(),
      description: z.string(),
    }),
  ),
});

@Resource({
  uri: 'errors://codes',
  name: 'MCP Error Codes',
  description: 'List of all MCP error codes',
  mimeType: 'application/json',
})
export default class ErrorCodesResource extends ResourceContext<Record<string, never>, z.infer<typeof outputSchema>> {
  async execute(): Promise<z.infer<typeof outputSchema>> {
    return {
      errorCodes: [
        {
          name: 'RESOURCE_NOT_FOUND',
          code: MCP_ERROR_CODES.RESOURCE_NOT_FOUND,
          description: 'Resource not found (-32002)',
        },
        {
          name: 'INVALID_REQUEST',
          code: MCP_ERROR_CODES.INVALID_REQUEST,
          description: 'Invalid request (-32600)',
        },
        {
          name: 'METHOD_NOT_FOUND',
          code: MCP_ERROR_CODES.METHOD_NOT_FOUND,
          description: 'Method not found (-32601)',
        },
        {
          name: 'INVALID_PARAMS',
          code: MCP_ERROR_CODES.INVALID_PARAMS,
          description: 'Invalid params (-32602)',
        },
        {
          name: 'INTERNAL_ERROR',
          code: MCP_ERROR_CODES.INTERNAL_ERROR,
          description: 'Internal error (-32603)',
        },
        {
          name: 'PARSE_ERROR',
          code: MCP_ERROR_CODES.PARSE_ERROR,
          description: 'Parse error (-32700)',
        },
      ],
    };
  }
}
