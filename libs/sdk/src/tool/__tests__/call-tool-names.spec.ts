import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { App, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { connect } from '../../direct/connect';
import { type DirectMcpServer } from '../../direct/direct.types';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

@Tool({ name: 'get_ticket', inputSchema: { id: z.string() } })
class GetTicketTool extends ToolContext {
  async execute(input: { id: string }) {
    return { id: input.id, title: 'Printer on fire' };
  }
}

@Tool({ name: 'mail.send', inputSchema: {} })
class MailSendTool extends ToolContext {
  async execute() {
    return { sent: true };
  }
}

@Tool({ name: 'call_by_name', inputSchema: { name: z.string() } })
class CallByNameTool extends ToolContext {
  async execute(input: { name: string }) {
    const result = await this.callTool(input.name, input.name.includes('ticket') ? { id: 'T-1' } : {});
    return { result: result.structuredContent };
  }
}

@Tool({ name: 'purge_tickets', inputSchema: {}, visibility: 'internal' })
class PurgeTicketsTool extends ToolContext {
  async execute() {
    return { purged: true };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [GetTicketTool, MailSendTool, CallByNameTool, PurgeTicketsTool] })
class DeskApp {}

const serverConfig: FrontMcpConfigInput = {
  info: { name: 'call-tool-names', version: '1.0.0' },
  apps: [DeskApp],
  logging: { level: LogLevel.Off },
};

describe('this.callTool() tool names', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect(serverConfig);
  });

  afterAll(async () => {
    await server.dispose();
  });

  it.each([['get_ticket'], ['desk:get_ticket'], ['desk.get_ticket'], ['desk.get-ticket']])(
    'finds a tool called %s',
    async (name) => {
      const result = await server.callTool('call_by_name', { name });

      expect(result.structuredContent).toEqual({ result: { id: 'T-1', title: 'Printer on fire' } });
    },
  );

  it('still finds a tool whose own name has a dot', async () => {
    const result = await server.callTool('call_by_name', { name: 'mail.send' });

    expect(result.structuredContent).toEqual({ result: { sent: true } });
  });
});

describe('tools/call tool names', () => {
  it.each([['get_ticket'], ['desk:get_ticket'], ['desk.get_ticket'], ['desk.get-ticket']])(
    'finds a tool called %s, as this.callTool() does',
    async (name) => {
      const client = await connect(serverConfig);
      const result = (await client.callTool(name, { id: 'T-1' })) as { structuredContent?: unknown };
      await client.close();

      expect(result.structuredContent).toEqual({ id: 'T-1', title: 'Printer on fire' });
    },
  );

  it('still answers an internal tool called owner.name like an unknown tool', async () => {
    const client = await connect(serverConfig);
    const result = (await client.callTool('desk.purge_tickets', {})) as { isError?: boolean; content?: unknown };
    await client.close();

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('not found');
  });
});
