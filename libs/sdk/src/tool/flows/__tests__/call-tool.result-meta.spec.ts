/**
 * `resultMeta` is the call-tool flow's slot for metadata a hook adds to the result, so it never
 * has to be merged into the tool's output (#647). Finalize puts it on the result's own `_meta`.
 */
import 'reflect-metadata';

import { App, FlowHooksOf, LogLevel, Plugin, Tool, ToolContext, type FlowCtxOf } from '../../../common';
import { type DirectMcpServer } from '../../../direct/direct.types';
import { FrontMcpInstance } from '../../../front-mcp/front-mcp';

const ToolHook = FlowHooksOf('tools:call-tool');

@Tool({ name: 'get_status', inputSchema: {} })
class GetStatusTool extends ToolContext {
  async execute() {
    return { status: 'green' };
  }
}

@Tool({ name: 'get_tagged_status', inputSchema: {} })
class GetTaggedStatusTool extends ToolContext {
  async execute() {
    return { status: 'amber', _meta: { source: 'probe' } };
  }
}

@Tool({ name: 'get_answered_status', inputSchema: {} })
class GetAnsweredStatusTool extends ToolContext {
  async execute() {
    return { status: 'from-execute' };
  }
}

@Plugin({ name: 'result-meta' })
class ResultMetaPlugin {
  @ToolHook.Did('execute')
  tagResult(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    flowCtx.state.set('resultMeta', { ...flowCtx.state.resultMeta, traced: 'yes' });
  }

  @ToolHook.Will('execute', { filter: (flowCtx) => flowCtx.state.tool?.name === 'get_answered_status' })
  answerFromHook(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    const answer = { status: 'from-hook' };
    flowCtx.state.set('rawOutput', answer);
    flowCtx.state.set('resultMeta', { answeredBy: 'hook' });
    flowCtx.state.required.toolContext.respond(answer);
  }
}

@App({
  id: 'status',
  name: 'Status',
  plugins: [ResultMetaPlugin],
  tools: [GetStatusTool, GetTaggedStatusTool, GetAnsweredStatusTool],
})
class StatusApp {}

describe('tools/call resultMeta', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'result-meta', version: '1.0.0' },
      apps: [StatusApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  it('puts the metadata a hook recorded on the result _meta', async () => {
    const result = await server.callTool('get_status', {});

    expect(result._meta?.['traced']).toBe('yes');
  });

  it('keeps the metadata a hook recorded out of the tool output', async () => {
    const result = await server.callTool('get_status', {});
    const text = result.content.map((block) => (block.type === 'text' ? block.text : '')).join('\n');

    expect({ structuredContent: result.structuredContent, text }).toEqual({
      structuredContent: { status: 'green' },
      text: expect.not.stringContaining('traced'),
    });
  });

  it('keeps the _meta a tool returns itself next to the metadata a hook recorded', async () => {
    const result = await server.callTool('get_tagged_status', {});

    expect(result._meta).toMatchObject({ source: 'probe', traced: 'yes' });
  });

  it('puts the metadata of a hook that answers in place of execute on the result _meta', async () => {
    const result = await server.callTool('get_answered_status', {});

    expect({ structuredContent: result.structuredContent, answeredBy: result._meta?.['answeredBy'] }).toEqual({
      structuredContent: { status: 'from-hook' },
      answeredBy: 'hook',
    });
  });
});
