/**
 * `ui.bundlingMode`: when the widget page is built, where `servingMode` leaves the choice open.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext, type FrontMcpConfigInput } from '../../../common';

const MCP_APPS_HOST = { capabilities: { extensions: { 'io.modelcontextprotocol/ui': {} } } };

@Tool({
  name: 'built_once',
  inputSchema: { city: z.string() },
  ui: { template: '<div id="built-once">once</div>', bundlingMode: 'static' },
})
class BuiltOnceTool extends ToolContext {
  async execute(input: { city: string }) {
    return { city: input.city };
  }
}

@Tool({
  name: 'built_per_call',
  inputSchema: { city: z.string() },
  ui: {
    template: (ctx: { output: { city?: string } }) => `<div id="built-per-call">${ctx.output.city ?? ''}</div>`,
    bundlingMode: 'dynamic',
    escapeStringResults: false,
  },
})
class BuiltPerCallTool extends ToolContext {
  async execute(input: { city: string }) {
    return { city: input.city };
  }
}

@App({ id: 'bundling', name: 'bundling', tools: [BuiltOnceTool, BuiltPerCallTool] })
class BundlingApp {}

async function serve(config: Omit<FrontMcpConfigInput, 'info'>): Promise<TestFetchServer> {
  return createTestFetchServer({ info: { name: 'bundling-mode', version: '1.0.0' }, ...config });
}

async function callMeta(server: TestFetchServer, name: string): Promise<Record<string, unknown>> {
  const { message } = await rpc20260728(
    server.handler,
    'tools/call',
    { name, arguments: { city: 'Lisbon' } },
    MCP_APPS_HOST,
  );
  expect(message.error).toBeUndefined();
  return (message.result?.['_meta'] ?? {}) as Record<string, unknown>;
}

describe('ui.bundlingMode', () => {
  it("'static' builds the page once at startup and sends no page with a call, where servingMode is unset", async () => {
    const server = await serve({ apps: [BundlingApp] });

    expect((await callMeta(server, 'built_once'))['ui/html']).toBeUndefined();
    const { message } = await rpc20260728(
      server.handler,
      'resources/read',
      { uri: 'ui://widget/built_once.html' },
      MCP_APPS_HOST,
    );
    expect((message.result?.['contents'] as Array<{ text: string }>)[0].text).toContain(
      '<div id="built-once">once</div>',
    );
  });

  it("'dynamic' renders the page with each call's data, over a server default of 'static'", async () => {
    const server = await serve({ apps: [BundlingApp], ui: { servingMode: 'static' } });

    expect((await callMeta(server, 'built_per_call'))['ui/html']).toEqual(
      expect.stringContaining('<div id="built-per-call">Lisbon</div>'),
    );
  });

  it("'static' keeps an inherited mode that builds the page once", async () => {
    const server = await serve({ apps: [BundlingApp], ui: { servingMode: 'direct-url' } });

    const response = await server.handler(new Request('http://localhost/widgets/built_once'));
    expect(await response.text()).toContain('built-once');
  });

  it("refuses to start when a tool's own servingMode contradicts its bundlingMode", async () => {
    @Tool({
      name: 'contradiction',
      inputSchema: {},
      ui: { template: '<p>x</p>', servingMode: 'inline', bundlingMode: 'static' },
    })
    class ContradictionTool extends ToolContext {
      async execute() {
        return {};
      }
    }
    @App({ id: 'contradiction', name: 'contradiction', tools: [ContradictionTool] })
    class ContradictionApp {}

    await expect(serve({ apps: [ContradictionApp] })).rejects.toThrow(
      "Tool \"contradiction\": `ui.bundlingMode: 'static'` builds the page once, at startup, but `ui.servingMode: 'inline'` renders it for each call.",
    );
  });
});
