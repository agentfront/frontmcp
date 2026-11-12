/**
 * A call to a direct server is its own request with the caller it names, also when it is made
 * while another request runs (from a tool, a route handler or a job of the embedding app).
 */
import 'reflect-metadata';

import { App, LogLevel, Tool, ToolContext } from '../../common';
import { FrontMcpContextStorage } from '../../context/frontmcp-context-storage';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

@Tool({ name: 'whoami', inputSchema: {} })
class WhoAmITool extends ToolContext {
  async execute() {
    return { sub: this.getAuthInfo().user?.sub, sessionId: this.context.sessionId };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [WhoAmITool] })
class DeskApp {}

describe('a direct call made inside another request', () => {
  it('runs as the caller the call names, not as the request around it', async () => {
    const direct = await FrontMcpInstance.createDirect({
      info: { name: 'nested-direct', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
    });
    try {
      const outer = {
        sessionId: 'outer-session',
        scopeId: 'outer',
        authInfo: { user: { iss: 'x', sub: 'outer-user' } },
      };

      const result = await new FrontMcpContextStorage().run(outer, () =>
        direct.callTool('whoami', {}, { authContext: { user: { sub: 'inner-user' }, sessionId: 'inner-session' } }),
      );

      expect(result.structuredContent).toEqual({ sub: 'inner-user', sessionId: 'inner-session' });
    } finally {
      await direct.dispose();
    }
  });
});
