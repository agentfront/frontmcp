/**
 * Each request a `connect()` client sends through `createInMemoryServer()` is marked as its own request, so the flow
 * registry gives it a context of its own with this server's caller, also when the client calls while another request
 * runs.
 */
import 'reflect-metadata';

import { Client } from '@frontmcp/protocol/client';

import { App, LogLevel, Tool, ToolContext } from '../../common';
import { FrontMcpContextStorage } from '../../context/frontmcp-context-storage';
import FlowRegistry from '../../flows/flow.registry';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { type Scope } from '../../scope/scope.instance';
import { createInMemoryServer } from '../in-memory-server';

@Tool({ name: 'whoami', inputSchema: {} })
class WhoAmITool extends ToolContext {
  async execute() {
    return 'me';
  }
}

@App({ id: 'desk', name: 'Desk', tools: [WhoAmITool] })
class DeskApp {}

describe('createInMemoryServer requests', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reach the flow registry marked as their own request, also inside another request', async () => {
    const instance = await FrontMcpInstance.createForGraph({
      info: { name: 'own-request', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
    });
    const scope = instance.getScopes()[0] as Scope;
    const server = await createInMemoryServer(scope, { authInfo: { user: { iss: 'x', sub: 'inner-user' } } });
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(server.clientTransport);
    const runFlow = jest.spyOn(FlowRegistry.prototype, 'runFlow');
    const outer = { sessionId: 'outer-session', scopeId: 'outer', authInfo: { user: { iss: 'x', sub: 'outer-user' } } };

    try {
      await new FrontMcpContextStorage().run(outer, () => client.callTool({ name: 'whoami', arguments: {} }));

      const callTool = runFlow.mock.calls.find(([name]) => name === 'tools:call-tool');
      expect((callTool?.[1] as { ctx?: { ownRequest?: unknown } } | undefined)?.ctx?.ownRequest).toBe(true);
    } finally {
      await client.close();
      await server.close();
      await scope.dispose();
    }
  });
});
