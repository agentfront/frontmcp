import { z } from 'zod';
import { FrontMcpServer, ServerResponse } from '../../interfaces';

export type HttpOptions = {
  port?: number;
  /** MCP JSON-RPC entry ('' or '/mcp'); MUST match PRM resourcePath returned in well-known */
  entryPath?: string;

  hostFactory?: FrontMcpServer | ((config: HttpOptions) => FrontMcpServer);
};


export const httpOptionsSchema = z.object({
  port: z.number().optional().default(3001),
  entryPath: z.string().default(''),
  hostFactory: z.any().optional(),
});



export type HttpConfig = z.infer<typeof httpOptionsSchema>;