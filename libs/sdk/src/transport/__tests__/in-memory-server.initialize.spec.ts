/**
 * `createInMemoryServer()` (what `connect()` runs on) answers `initialize` with the server's instructions and
 * `info.title`, as the Node HTTP server does.
 */
import 'reflect-metadata';

import { Client } from '@frontmcp/protocol';

import { App, LogLevel, Tool, ToolContext } from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { type Scope } from '../../scope/scope.instance';
import { createInMemoryServer } from '../in-memory-server';

@Tool({ name: 'search_tickets', inputSchema: {} })
class SearchTickets extends ToolContext {
  async execute() {
    return 'none';
  }
}

@App({ id: 'desk', name: 'Desk', tools: [SearchTickets] })
class DeskApp {}

describe('createInMemoryServer initialize', () => {
  it("sends the server's instructions and info.title", async () => {
    const instance = await FrontMcpInstance.createForGraph({
      info: { name: 'help-desk', title: 'Help Desk', version: '1.0.0' },
      instructions: 'Find tickets with search_tickets first.',
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
    });
    const scope = instance.getScopes()[0] as Scope;
    const server = await createInMemoryServer(scope);
    const client = new Client({ name: 'test-client', version: '1.0.0' });

    await client.connect(server.clientTransport);

    expect(client.getInstructions()).toContain('Find tickets with search_tickets first.');
    expect(client.getServerVersion()?.title).toBe('Help Desk');
    await client.close();
    await server.close();
    await scope.dispose();
  });
});
