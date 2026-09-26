/**
 * Widget resources are served through the real `tools/call` and `resources/read` flows.
 *
 * GHSA-rhr9-vhpf-jqp7 (cross-caller widget leak): `renderAndRegisterAsync` rendered each call's
 * widget, with that caller's input and output embedded, and stored it in the same map that
 * `resources/read ui://widget/{tool}.html` serves. Any other caller then read the last caller's
 * page, and any markup injected through tool output became stored rather than reflected.
 *
 * GHSA-xp6r-ggxc-j7q8 (follow-up): `tools/list` advertises
 * `ui://widget/${encodeURIComponent(name)}.html`, but the URI parser accepted only raw
 * characters, so a namespaced `app:tool` widget (advertised as `app%3Atool`) could not be read.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { MCP_20260728_META } from '@frontmcp/protocol';

import {
  createTestFetchServer,
  rpc20260728,
  type JsonRpcMessage,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext, type TemplateContext } from '../../../common';

const CALLER_A_SECRET = 'acct-4417-balance-982341';

type StatementInput = { account: string };
type StatementOutput = { account: string; balance: string };

@Tool({
  name: 'get_statement',
  inputSchema: { account: z.string() },
  ui: {
    template: (ctx: TemplateContext<StatementInput, StatementOutput>) =>
      `<p>${ctx.helpers.escapeHtml(ctx.output.account)}: ${ctx.helpers.escapeHtml(ctx.output.balance)}</p>`,
  },
})
class GetStatementTool extends ToolContext {
  async execute(input: StatementInput): Promise<StatementOutput> {
    return { account: input.account, balance: input.account === 'A' ? CALLER_A_SECRET : 'none' };
  }
}

@App({ id: 'banking', name: 'Banking', tools: [GetStatementTool] })
class BankingApp {}

@Tool({ name: 'lookup', inputSchema: {}, ui: { template: '<div id="lookup-widget"></div>' } })
class CrmLookupTool extends ToolContext {
  async execute() {
    return { source: 'crm' };
  }
}

@App({ id: 'crm', name: 'crm', tools: [CrmLookupTool] })
class CrmApp {}

@Tool({ name: 'lookup', inputSchema: {}, ui: { template: '<div id="lookup-widget"></div>' } })
class ErpLookupTool extends ToolContext {
  async execute() {
    return { source: 'erp' };
  }
}

@App({ id: 'erp', name: 'erp', tools: [ErpLookupTool] })
class ErpApp {}

const CALLER_B_META = { [MCP_20260728_META.clientInfo]: { name: 'caller-b', version: '1.0.0' } };

function widgetText(message: JsonRpcMessage): string {
  const contents = message.result?.['contents'] as Array<{ text?: string }> | undefined;
  return contents?.[0]?.text ?? '';
}

describe('widget resources do not serve a render made for another caller (GHSA-rhr9-vhpf-jqp7)', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({ info: { name: 'widget-serving', version: '1.0.0' }, apps: [BankingApp] });
  });

  it('returns the per-call render to the caller that made the call', async () => {
    const { message } = await rpc20260728(server.handler, 'tools/call', {
      name: 'get_statement',
      arguments: { account: 'A' },
    });

    const meta = message.result?.['_meta'] as Record<string, unknown> | undefined;
    expect(meta?.['ui/html']).toEqual(expect.stringContaining(CALLER_A_SECRET));
  });

  it('does not hand the input or output of caller A to caller B through resources/read', async () => {
    await rpc20260728(server.handler, 'tools/call', { name: 'get_statement', arguments: { account: 'A' } });

    const { message } = await rpc20260728(
      server.handler,
      'resources/read',
      { uri: 'ui://widget/get_statement.html' },
      { meta: CALLER_B_META },
    );

    expect(message.error).toBeUndefined();
    expect(widgetText(message)).toContain('get_statement');
    expect(widgetText(message)).not.toContain(CALLER_A_SECRET);
  });
});

describe('widget URIs advertised by tools/list read back (GHSA-xp6r-ggxc-j7q8)', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({ info: { name: 'widget-uris', version: '1.0.0' }, apps: [CrmApp, ErpApp] });
  });

  it('reads the widget of a namespaced tool from the URI tools/list advertised', async () => {
    const { message: listed } = await rpc20260728(server.handler, 'tools/list');
    const tools = (listed.result?.['tools'] ?? []) as Array<{
      name: string;
      _meta?: { ui?: { resourceUri?: string } };
    }>;
    const namespaced = tools.find((tool) => tool.name.includes(':'));
    const resourceUri = namespaced?._meta?.ui?.resourceUri ?? '';

    expect(resourceUri).toMatch(/^ui:\/\/widget\/[a-z]+%3Alookup\.html$/);

    const { message } = await rpc20260728(server.handler, 'resources/read', { uri: resourceUri });

    expect(message.error).toBeUndefined();
    expect(widgetText(message)).toContain(namespaced?.name);
  });

  it.each([
    'ui://widget/</code><script>alert(1)</script>.html',
    'ui://widget/<img src=x onerror=alert(1)>.html',
    'ui://widget/%3Cscript%3Ealert(1)%3C%2Fscript%3E.html',
    'ui://widget/%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E.html',
    'ui://widget/%253Cscript%253E.html',
  ])('refuses %s', async (uri) => {
    const { message } = await rpc20260728(server.handler, 'resources/read', { uri });

    expect(message.result).toBeUndefined();
    expect(message.error).toBeDefined();
  });
});
