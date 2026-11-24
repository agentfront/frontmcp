import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { MCP_20260728_META } from '@frontmcp/protocol';

import {
  createTestFetchServer,
  rpc20260728,
  type Rpc20260728Options,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext } from '../../../common';

const MCP_APPS_HOST: Rpc20260728Options = { capabilities: { extensions: { 'io.modelcontextprotocol/ui': {} } } };
const CHATGPT: Rpc20260728Options = { meta: { [MCP_20260728_META.clientInfo]: { name: 'chatgpt', version: '1.0.0' } } };
const CODING_AGENT: Rpc20260728Options = {
  meta: { [MCP_20260728_META.clientInfo]: { name: 'coding-agent', version: '1.0.0' } },
};

@Tool({
  name: 'canvas_answer',
  inputSchema: { answer: z.string() },
  outputSchema: 'string',
  _meta: { ui: { visibility: ['app'] } },
})
class CanvasAnswerTool extends ToolContext {
  async execute(input: { answer: string }) {
    return `recorded ${input.answer}`;
  }
}

@Tool({
  name: 'show_canvas',
  inputSchema: {},
  ui: { template: '<div id="canvas"></div>' },
  _meta: { ui: { visibility: ['model', 'app'] } },
})
class ShowCanvasTool extends ToolContext {
  async execute() {
    return { shown: true };
  }
}

@App({ id: 'canvas', name: 'Canvas', tools: [CanvasAnswerTool, ShowCanvasTool] })
class CanvasApp {}

describe("a tool for the MCP Apps page only (_meta.ui.visibility: ['app'])", () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({ info: { name: 'app-only-tools', version: '1.0.0' }, apps: [CanvasApp] });
  });

  async function listedTools(client: Rpc20260728Options) {
    const { message } = await rpc20260728(server.handler, 'tools/list', {}, client);
    return (message.result?.['tools'] ?? []) as Array<{ name: string; _meta?: { ui?: Record<string, unknown> } }>;
  }

  async function answerFrom(client: Rpc20260728Options): Promise<string> {
    const { message } = await rpc20260728(
      server.handler,
      'tools/call',
      { name: 'canvas_answer', arguments: { answer: 'blue' } },
      client,
    );
    return JSON.stringify(message);
  }

  it.each([
    ['an MCP Apps host', MCP_APPS_HOST],
    ['ChatGPT', CHATGPT],
  ])('is listed to and callable by %s', async (_label, client) => {
    expect((await listedTools(client)).map(({ name }) => name)).toContain('canvas_answer');
    expect(await answerFrom(client)).toContain('recorded blue');
  });

  it('is left out of tools/list for a client that renders no app page', async () => {
    const names = (await listedTools(CODING_AGENT)).map(({ name }) => name);

    expect(names).toContain('show_canvas');
    expect(names).not.toContain('canvas_answer');
  });

  it('answers a client that renders no app page like an unknown tool', async () => {
    const answer = await answerFrom(CODING_AGENT);

    expect(answer).not.toContain('recorded blue');
    expect(answer).toMatch(/not found/i);
  });

  it("prefers the MCP Apps support a session negotiated over its user agent's guess", async () => {
    const scope = server.instance.getScopes()[0];
    const sessionId = 'session-mcp-apps-host';
    scope.notifications.registerServer(sessionId, { notification: jest.fn(), request: jest.fn() } as never);
    scope.notifications.setClientCapabilities(sessionId, { extensions: { 'io.modelcontextprotocol/ui': {} } });
    scope.notifications.setClientInfo(sessionId, { name: 'claude-desktop', version: '1.0.0' });
    const ctx = { authInfo: { sessionId, sessionIdPayload: { platformType: 'claude' } } };

    const listed = await scope.runFlowForOutput('tools:list-tools', {
      request: { method: 'tools/list', params: {} },
      ctx,
    });
    const called = await scope.runFlowForOutput('tools:call-tool', {
      request: { method: 'tools/call', params: { name: 'canvas_answer', arguments: { answer: 'blue' } } },
      ctx,
    });

    expect(listed.tools.map(({ name }) => name)).toContain('canvas_answer');
    expect(JSON.stringify(called)).toContain('recorded blue');
  });

  it('runs a task of a tool meant for the MCP Apps page, which the call that created it was checked for', async () => {
    const scope = server.instance.getScopes()[0];

    const answer = await scope.runFlowForOutput('tools:call-tool', {
      request: { method: 'tools/call', params: { name: 'canvas_answer', arguments: { answer: 'blue' } } },
      ctx: { taskId: 'task-canvas', authInfo: {} },
    });

    expect(JSON.stringify(answer)).toContain('recorded blue');
  });

  it("keeps the _meta.ui fields a tool with a widget declares in its listing's _meta.ui", async () => {
    const showCanvas = (await listedTools(MCP_APPS_HOST)).find(({ name }) => name === 'show_canvas');

    expect(showCanvas?._meta?.ui).toEqual(
      expect.objectContaining({ visibility: ['model', 'app'], resourceUri: 'ui://widget/show_canvas.html' }),
    );
  });
});
