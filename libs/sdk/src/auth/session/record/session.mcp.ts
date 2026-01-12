import { BaseCreateCtx, Session } from './session.base';

interface McpSessionCreateCtx extends BaseCreateCtx {
  apps: string[];
}

/**
 * Represents an MCP session created from a verified authorization.
 * The session holds user identity, claims, and authorized entities (apps, tools, resources).
 */
export class McpSession extends Session {
  readonly mode = 'mcp';
  constructor(ctx: McpSessionCreateCtx) {
    super(ctx as any);
  }

  override getToken(): Promise<string> | string {
    return this.token;
  }
}
