/** A dispatcher's `beforeExecute` and `onRecordsChanged` hear a call's start and its `this.reportRecordsChanged(n)`. */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { App, FlowHooksOf, LogLevel, Plugin, Tool, ToolContext, type FlowCtxOf } from '../../../common';
import { type DirectMcpServer } from '../../../direct/direct.types';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';

const ToolHook = FlowHooksOf('tools:call-tool');
const heard: string[] = [];

@Tool({ name: 'archive_tickets', inputSchema: { counts: z.array(z.number()) } })
class ArchiveTicketsTool extends ToolContext {
  async execute({ counts }: { counts: number[] }) {
    heard.push('executed');
    for (const count of counts) this.reportRecordsChanged(count);
    return { archived: true };
  }
}

@Tool({ name: 'cached_tickets', inputSchema: {} })
class CachedTicketsTool extends ToolContext {
  async execute() {
    heard.push('executed');
    return { cached: false };
  }
}

/** Dispatches a tool in process, as CodeCall does, and returns what its context's dispatcher members heard. */
@Tool({
  name: 'dispatch',
  inputSchema: { name: z.string(), counts: z.array(z.number()).optional(), refuse: z.boolean().optional() },
})
class DispatchTool extends ToolContext {
  async execute({ name, counts, refuse }: { name: string; counts?: number[]; refuse?: boolean }) {
    const beforeExecute = async () => {
      heard.push('started');
      if (refuse) throw new Error('refused before the tool ran');
    };
    const outcome = await this.scope
      .runFlow('tools:call-tool', {
        request: { method: 'tools/call', params: { name, arguments: counts ? { counts } : {} } },
        ctx: { authInfo: this.authInfo, beforeExecute, onRecordsChanged: (count: number) => heard.push(`${count}`) },
      } as never)
      .then(
        () => 'ok',
        (error: Error) => error.message,
      );
    return { outcome, heard: [...heard] };
  }
}

@Plugin({ name: 'cache-probe' })
class CacheProbe {
  @ToolHook.Will('execute', { filter: (flowCtx) => flowCtx.state.tool?.name === 'cached_tickets' })
  answerFromCache(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    flowCtx.state.required.toolContext.respond({ cached: true });
  }
}

@App({ id: 'desk', name: 'Desk', plugins: [CacheProbe], tools: [ArchiveTicketsTool, CachedTicketsTool, DispatchTool] })
class DeskApp {}

describe("a dispatcher's beforeExecute and onRecordsChanged", () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'tool-records-changed', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
    });
  });

  beforeEach(() => {
    heard.length = 0;
  });

  afterAll(async () => {
    await server.dispose();
  });

  it('hears the start of execute() once, then each count the tool reports', async () => {
    const result = await server.callTool('dispatch', { name: 'archive_tickets', counts: [2, 0, 3] });

    expect(result.structuredContent).toEqual({ outcome: 'ok', heard: ['started', 'executed', '2', '0', '3'] });
  });

  it('stops the call before the tool runs when beforeExecute throws', async () => {
    const result = await server.callTool('dispatch', { name: 'archive_tickets', counts: [5], refuse: true });

    expect(result.structuredContent).toEqual({ outcome: 'refused before the tool ran', heard: ['started'] });
  });

  it('is not told of a call a hook answered before execute()', async () => {
    const result = await server.callTool('dispatch', { name: 'cached_tickets' });

    expect(result.structuredContent).toEqual({ outcome: 'ok', heard: [] });
  });

  it('is ignored on a call a client made directly', async () => {
    const result = await server.callTool('archive_tickets', { counts: [5] });

    expect(result.structuredContent).toEqual({ archived: true });
    expect(heard).toEqual(['executed']);
  });
});
