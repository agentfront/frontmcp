/**
 * `this.respond(value)` in a tool ends the call with `value` as the tool's output: it is finalized as
 * a returned value is, checked against `outputSchema` and built into `content` and `structuredContent`.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { App, FlowHooksOf, LogLevel, Plugin, Tool, ToolContext, type FlowCtxOf } from '../../../common';
import { type DirectMcpServer } from '../../../direct/direct.types';
import { InvalidOutputError } from '../../../errors';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';

const ToolHook = FlowHooksOf('tools:call-tool');
const outputsSeenAfterExecute: unknown[] = [];

@Tool({ name: 'greet', inputSchema: {}, outputSchema: { hello: z.number() } })
class GreetTool extends ToolContext {
  async execute() {
    return this.respond({ hello: 1, internalNote: 'not for the client' } as { hello: number });
  }
}

@Tool({ name: 'close_ticket', inputSchema: {}, outputSchema: 'string' })
class CloseTicketTool extends ToolContext {
  async execute() {
    return this.respond('Closed');
  }
}

@Tool({ name: 'count_tickets', inputSchema: {}, outputSchema: { count: z.number() } })
class CountTicketsTool extends ToolContext {
  async execute() {
    return this.respond({ count: 'three' } as unknown as { count: number });
  }
}

@Tool({ name: 'describe_ticket', inputSchema: {} })
class DescribeTicketTool extends ToolContext {
  async execute() {
    return this.respond({ id: 'T-1' });
  }
}

@Tool({ name: 'list_tickets', inputSchema: {}, outputSchema: { count: z.number() } })
class ListTicketsTool extends ToolContext {
  async execute() {
    return this.respond({
      content: [{ type: 'text', text: 'T-1: Cannot log in' }],
      structuredContent: { count: 1 },
    } as unknown as { count: number });
  }
}

@Tool({ name: 'get_cached_status', inputSchema: {}, outputSchema: { status: z.string() } })
class GetCachedStatusTool extends ToolContext {
  async execute() {
    return { status: 'from-execute' };
  }
}

@Plugin({ name: 'respond-probe' })
class RespondProbe {
  @ToolHook.Did('execute')
  recordOutput(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    outputsSeenAfterExecute.push(flowCtx.state.toolContext?.output);
  }

  @ToolHook.Will('execute', { filter: (flowCtx) => flowCtx.state.tool?.name === 'get_cached_status' })
  answerFromHook(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    flowCtx.state.required.toolContext.respond({ status: 'from-hook', internalNote: 'not for the client' });
  }
}

@App({
  id: 'desk',
  name: 'Desk',
  plugins: [RespondProbe],
  tools: [GreetTool, CloseTicketTool, CountTicketsTool, DescribeTicketTool, ListTicketsTool, GetCachedStatusTool],
})
class DeskApp {}

describe('this.respond() in a tool', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'tool-respond', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  it('sends the value as the output, with content and structuredContent', async () => {
    const result = await server.callTool('greet', {});

    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ hello: 1 }) }],
      structuredContent: { hello: 1 },
    });
  });

  it('builds a text block from a string output', async () => {
    const result = await server.callTool('close_ticket', {});

    expect(result.content).toEqual([{ type: 'text', text: 'Closed' }]);
    expect(result).not.toHaveProperty('0');
  });

  it('fails the call with INVALID_OUTPUT when the value does not match outputSchema', async () => {
    await expect(server.callTool('count_tickets', {})).rejects.toBeInstanceOf(InvalidOutputError);
  });

  it('sends a value of a tool without outputSchema as a returned one', async () => {
    const result = await server.callTool('describe_ticket', {});

    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ id: 'T-1' }) }],
      structuredContent: { id: 'T-1' },
    });
  });

  it('keeps a complete CallToolResult as it is, as a returned one is', async () => {
    const result = await server.callTool('list_tickets', {});

    expect(result).toEqual({
      content: [{ type: 'text', text: 'T-1: Cannot log in' }],
      structuredContent: { count: 1 },
    });
  });

  it('gives Did("execute") hooks the value as the output', async () => {
    outputsSeenAfterExecute.length = 0;

    await server.callTool('describe_ticket', {});

    expect(outputsSeenAfterExecute).toEqual([{ id: 'T-1' }]);
  });

  it('finalizes the value a hook passes to the tool context respond() as the output', async () => {
    const result = await server.callTool('get_cached_status', {});

    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ status: 'from-hook' }) }],
      structuredContent: { status: 'from-hook' },
    });
  });
});
