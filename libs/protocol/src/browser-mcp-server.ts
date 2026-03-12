// Stub for MCP Server in browser builds

export class Server {
  constructor(_info?: unknown, _options?: unknown) {
    throw new Error('MCP Server is not available in browser environments');
  }
}

export interface ServerOptions {
  capabilities?: Record<string, unknown>;
  instructions?: string;
  serverInfo?: { name: string; version: string };
}
