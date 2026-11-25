/** `this.reportRecordsChanged(n)` reaches only the in-process dispatcher that set `onRecordsChanged`. */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { App, LogLevel, Tool, ToolContext } from '../../../common';
import { type DirectMcpServer } from '../../../direct/direct.types';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';

@Tool({ name: 'archive_tickets', inputSchema: { counts: z.array(z.number()) } })
class ArchiveTicketsTool extends ToolContext {
  async execute({ counts }: { counts: number[] }) {
    for (const count of counts) this.reportRecordsChanged(count);
    return { archived: true };
  }
}

/** Dispatches `archive_tickets` in process, as CodeCall does, and returns what it heard. */
@Tool({ name: 'count_archived', inputSchema: { counts: z.array(z.number()) } })
class CountArchivedTool extends ToolContext {
  async execute({ counts }: { counts: number[] }) {
    const reported: number[] = [];
    await this.scope.runFlow('tools:call-tool', {
      request: { method: 'tools/call', params: { name: 'archive_tickets', arguments: { counts } } },
      ctx: { authInfo: this.authInfo, onRecordsChanged: (count: number) => reported.push(count) },
    } as never);
    return { reported };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [ArchiveTicketsTool, CountArchivedTool] })
class DeskApp {}

describe('this.reportRecordsChanged() in a tool', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'tool-records-changed', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  it('tells the dispatcher that set onRecordsChanged each count the tool reports', async () => {
    const result = await server.callTool('count_archived', { counts: [2, 0, 3] });

    expect(result.structuredContent).toEqual({ reported: [2, 0, 3] });
  });

  it('is ignored on a call a client made directly', async () => {
    const result = await server.callTool('archive_tickets', { counts: [5] });

    expect(result.structuredContent).toEqual({ archived: true });
  });
});
