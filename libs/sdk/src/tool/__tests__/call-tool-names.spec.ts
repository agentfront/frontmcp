import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { App, LogLevel, Tool, ToolContext } from '../../common';
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

@App({ id: 'desk', name: 'Desk', tools: [GetTicketTool, MailSendTool, CallByNameTool] })
class DeskApp {}

describe('this.callTool() tool names', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'call-tool-names', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
    });
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
