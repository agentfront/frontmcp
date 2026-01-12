import { BaseCreateCtx, Session } from './session.base';

/**
 * Represents an MCP session created from a verified authorization.
 * The session holds user identity, claims, and authorized entities (apps, tools, resources).
 */
export class McpSession extends Session {
  readonly mode = 'mcp';
  constructor(ctx: BaseCreateCtx) {
    super(ctx);
  }

  override getToken(): Promise<string> | string {
    return this.token;
  }
}
