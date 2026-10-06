/**
 * The `ui` options a host reads reach it, in the fields MCP Apps and the OpenAI Apps SDK define. Up
 * to 1.9.2 they were accepted and ignored.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext, type TemplateContext } from '../../../common';

@Tool({
  name: 'show_dashboard',
  inputSchema: { team: z.string() },
  ui: {
    template: (ctx: TemplateContext<{ team: string }, { team: string }>) =>
      ctx.helpers.html`<h1>${ctx.output.team}</h1>`,
    widgetDescription: 'The team dashboard, with open tickets by priority',
    widgetAccessible: true,
    displayMode: 'fullscreen',
    prefersBorder: true,
    sandboxDomain: 'https://dashboard.example',
    csp: { connectDomains: ['https://api.example'] },
  },
})
class ShowDashboardTool extends ToolContext {
  async execute(input: { team: string }) {
    return { team: input.team };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [ShowDashboardTool] })
class DeskApp {}

describe('ui options sent to the host', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({ info: { name: 'ui-host-meta', version: '1.0.0' }, apps: [DeskApp] });
  });

  it('lists widgetAccessible as openai/widgetAccessible', async () => {
    const { message } = await rpc20260728(server.handler, 'tools/list');
    const tools = (message.result?.['tools'] ?? []) as Array<{ name: string; _meta?: Record<string, unknown> }>;

    expect(tools.find((tool) => tool.name === 'show_dashboard')?._meta).toMatchObject({
      'openai/widgetAccessible': true,
    });
  });

  it('describes the widget resource with the border, domain, description and CSP', async () => {
    const { message } = await rpc20260728(server.handler, 'resources/read', {
      uri: 'ui://widget/show_dashboard.html',
    });
    const contents = message.result?.['contents'] as Array<{ _meta?: Record<string, unknown> }>;

    expect(contents[0]?._meta).toMatchObject({
      ui: { prefersBorder: true, domain: 'https://dashboard.example' },
      'openai/widgetDescription': 'The team dashboard, with open tickets by priority',
      'openai/widgetPrefersBorder': true,
      'openai/widgetDomain': 'https://dashboard.example',
      'openai/widgetCSP': { connect_domains: ['https://api.example'] },
    });
  });

  it('has the page ask the host for the display mode', async () => {
    const { message } = await rpc20260728(server.handler, 'tools/call', {
      name: 'show_dashboard',
      arguments: { team: 'support' },
    });
    const html = (message.result?.['_meta'] as Record<string, unknown>)['ui/html'];

    expect(html).toEqual(expect.stringContaining('window.__mcpDisplayMode = "fullscreen";'));
  });
});
